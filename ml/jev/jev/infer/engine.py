"""推理引擎：一次 STATE + 逐题提问 → 每题的概率分布（Jev 的核心口径）。

打分方式
--------
每题候选是**单字母**（A/B/C…），所以只需读生成点头部一个位置的 logits，
在该题实际使用的字母 token 上做带温度的 softmax，就得到整题的校准分布。
好处：一次前向拿到全部选项概率，不像"逐选项 teacher forcing"要跑 N 遍；
并且温度是逐题在验证集上拟合出来的，服务端直接可用（高置信自动执行、低置信交给人）。

KV 复用
-------
5 题串联时前缀递增，缓存上一轮 KV，下一轮只前送新增文本
（答案字母 + <|im_end|> + 下一轮提问块 + assistant 头）。
记账粒度是**文本**（sent_text），一旦发现前缀不匹配就整段重算，保证正确性优先。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

def _find_root() -> Path:
    """向上找到含 configs/questions.json 的目录。

    这样同一份脚本在开发仓库（workon-jev/）和交付目录（ml/jev/）里都能定位到项目根，
    不会因为被搬了位置就把路径算错。
    """
    here = Path(__file__).resolve()
    for p in [here.parent, *here.parents]:
        if (p / "configs" / "questions.json").exists():
            return p
    return here.parent.parent.parent


ROOT = _find_root()
sys.path.insert(0, str(ROOT))

import torch  # noqa: E402
from transformers import AutoModelForCausalLM, AutoTokenizer  # noqa: E402

from jev.catalog import load_catalog  # noqa: E402
from jev.infer.base import DEFAULT_QUESTIONS, BaseEngine  # noqa: E402
from jev.prompt import generation_prefix  # noqa: E402

__all__ = ["JevEngine", "DEFAULT_QUESTIONS", "pick_device"]


def pick_device(pref: str = "auto") -> str:
    if pref != "auto":
        return pref
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class JevEngine(BaseEngine):
    def __init__(self, model_path: str | Path, *, base_model: str | None = None,
                 device: str = "auto", dtype: str = "auto", catalog=None,
                 temperatures: dict | None = None):
        self.device = pick_device(device)
        if dtype == "auto":
            self.dtype = torch.bfloat16 if self.device in ("mps", "cuda") else torch.float32
        else:
            self.dtype = {"bf16": torch.bfloat16, "fp32": torch.float32, "fp16": torch.float16}[dtype]

        # 温度没随包自动加载的话，线上跑的就是未校准的 T=1.0。
        # OnnxEngine 早有这个逻辑，torch 后端漏了 —— 校准前后 ECE 差约 3 倍，
        # 而且只在「概率」上体现，argmax 不变，所以评估能过、上线才出事。
        model_path = Path(model_path)
        if temperatures is None:
            tpath = model_path / "temperatures.json"
            if tpath.exists():
                temperatures = json.loads(tpath.read_text(encoding="utf-8")).get("temperatures", {})

        super().__init__(catalog=catalog, temperatures=temperatures)
        self._past = None
        self._sent_text = ""
        # 实测：0.6B 在这台 M4 上"每题全量重算"反而比 KV 增量快
        # （增量每次只前送 6 个 token，MPS 利用率极低），且两者结果一致。
        self.use_kv_cache = False

        self.tok = AutoTokenizer.from_pretrained(str(model_path))
        if self.tok.pad_token_id is None:
            self.tok.pad_token = self.tok.eos_token

        if (model_path / "adapter_config.json").exists():
            import json as _json
            from peft import PeftModel
            base_id = base_model or _json.loads((model_path / "adapter_config.json").read_text())["base_model_name_or_path"]
            base = AutoModelForCausalLM.from_pretrained(base_id, dtype=self.dtype)
            self.model = PeftModel.from_pretrained(base, str(model_path)).to(self.device).eval()
        else:
            self.model = AutoModelForCausalLM.from_pretrained(str(model_path), dtype=self.dtype)
            self.model = self.model.to(self.device).eval()

        self.letter_ids: list[int] = []
        for ch in self.catalog.letters:
            ids = self.tok.encode(ch, add_special_tokens=False)
            if len(ids) != 1:
                raise RuntimeError(f"字母 {ch} 不是单 token（{ids}），单字母打分方案不成立")
            self.letter_ids.append(ids[0])

    # ────────────────────── 低层 ──────────────────────

    @torch.no_grad()
    def _step(self, text: str, *, reset: bool = False):
        """把 text 喂给模型并返回生成点 logits（内部维护 KV 缓存）。"""
        if (not self.use_kv_cache) or reset or self._past is None or not text.startswith(self._sent_text):
            self._past = None
            delta = text
        else:
            delta = text[len(self._sent_text):]
        ids = self.tok(delta, add_special_tokens=False)["input_ids"]
        if not ids:
            ids = [self.tok.eos_token_id]
        tensor = torch.tensor([ids], dtype=torch.long, device=self.device)
        out = self.model(input_ids=tensor, past_key_values=self._past, use_cache=True)
        self._past = out.past_key_values
        self._sent_text = text
        return out.logits[0, -1, :].float()

    def reset_cache(self) -> None:
        self._past = None
        self._sent_text = ""

    @torch.no_grad()
    def score_turn(self, messages: list[dict], n_options: int, temperature: float = 1.0) -> list[float]:
        text = generation_prefix(self.tok, messages)
        logits = self._step(text)
        sel = torch.tensor(self.letter_ids[:n_options], dtype=torch.long, device=logits.device)
        return torch.softmax(logits[sel] / max(temperature, 1e-3), dim=-1).tolist()

    # ask / decide 由 BaseEngine 提供（只依赖 score_turn，便于 torch / onnx 共用）
