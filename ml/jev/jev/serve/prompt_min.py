"""不依赖 transformers 的对话渲染 + 分词（部署路径）。

为什么需要它：ONNX 部署端只装 `onnxruntime + tokenizers`（约 25MB），
不必装 torch/transformers（约 1GB）。为此要么跑 jinja2 模板，要么把模板固化下来。
这里选择**固化**，并用 `--check` 在训练数据上逐字节比对 transformers 的渲染结果，
确保两条路径完全一致（不一致就会静默掉精度，这是最危险的一类 bug）。
"""
from __future__ import annotations

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

from jev.prompt import SYSTEM_PROMPT, _THINK  # noqa: E402

IM_START = "<|im_start|>"
IM_END = "<|im_end|>\n"


def render(messages: list[dict], add_generation_prompt: bool = False) -> str:
    """复刻 prompt.py 规范化后的 Qwen3 渲染（每个 assistant 头后都带空 think 块）。"""
    out: list[str] = []
    for m in messages:
        role, content = m["role"], m["content"]
        if role == "assistant":
            out.append(f"{IM_START}assistant\n{_THINK}{content}{IM_END}")
        else:
            out.append(f"{IM_START}{role}\n{content}{IM_END}")
    if add_generation_prompt:
        out.append(f"{IM_START}assistant\n{_THINK}")
    return "".join(out)


class MiniTokenizer:
    """只做我们用到的事：渲染 + 编码 + 字母 token id。"""

    def __init__(self, model_dir: str | Path):
        from tokenizers import Tokenizer
        self._tok = Tokenizer.from_file(str(Path(model_dir) / "tokenizer.json"))

    def encode(self, text: str) -> list[int]:
        return self._tok.encode(text, add_special_tokens=False).ids

    def generation_prefix(self, messages: list[dict]) -> str:
        return render(messages, add_generation_prompt=True)

    def letter_ids(self, letters: str) -> list[int]:
        ids = []
        for ch in letters:
            e = self.encode(ch)
            if len(e) != 1:
                raise RuntimeError(f"字母 {ch} 不是单 token: {e}")
            ids.append(e[0])
        return ids


def check(model_dir: str, n: int = 200) -> int:
    """在真实训练数据上比对 MiniTokenizer 与 transformers 的渲染/分词是否一致。"""
    import json
    from transformers import AutoTokenizer
    from jev.prompt import generation_prefix as tf_prefix
    from jev.prompt import answer_spans

    tok = AutoTokenizer.from_pretrained(model_dir)
    mini = MiniTokenizer(model_dir)
    rows = []
    for split in ("train", "val", "test"):
        p = ROOT / "data" / "processed" / f"{split}.jsonl"
        if p.exists():
            rows += [json.loads(l) for l in p.open(encoding="utf-8") if l.strip()][:n]
    bad_text = bad_ids = 0
    for r in rows:
        if mini.generation_prefix(r["messages"]) != tf_prefix(tok, r["messages"]):
            bad_text += 1
        full_tf, _ = answer_spans(tok, r["messages"])
        if mini.encode(full_tf) != tok(full_tf, add_special_tokens=False)["input_ids"]:
            bad_ids += 1
    print(f"比对 {len(rows)} 条：文本不一致 {bad_text}，分词不一致 {bad_ids}")
    if bad_text or bad_ids:
        # 打印第一个反例，方便定位
        for r in rows:
            a, b = mini.generation_prefix(r["messages"]), tf_prefix(tok, r["messages"])
            if a != b:
                c = 0
                while c < min(len(a), len(b)) and a[c] == b[c]:
                    c += 1
                print("首个反例 id:", r["id"])
                print("  mini:", repr(a[max(0, c - 50):c + 50]))
                print("  tf  :", repr(b[max(0, c - 50):c + 50]))
                break
        return 1
    print("两条渲染路径完全一致 ✓")
    return 0


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(ROOT / "Qwen" / "Qwen3-0.6B"))
    ap.add_argument("--check-dir", default=str(ROOT / "out" / "lora"))
    ap.add_argument("--n", type=int, default=200)
    args = ap.parse_args()
    sys.exit(check(args.check_dir, args.n))
