"""纯 onnxruntime 后端：端侧部署用，不需要 torch / transformers。

依赖只有 `onnxruntime` + `tokenizers`（合计约 25MB），
渲染走 prompt_min（已逐字节比对过 transformers 路径）。
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np

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

from jev.infer.base import BaseEngine  # noqa: E402
from jev.serve.prompt_min import MiniTokenizer  # noqa: E402


class OnnxEngine(BaseEngine):
    def __init__(self, model_dir: str | Path, *, threads: int = 0, temperatures: dict | None = None,
                 catalog=None):
        import onnxruntime as ort
        model_dir = Path(model_dir)
        self.model_dir = model_dir
        cands = [model_dir / "model.int8.onnx", model_dir / "model.onnx"]
        path = next((p for p in cands if p.exists()), None)
        if path is None:
            raise FileNotFoundError(f"{model_dir} 下找不到 model.onnx / model.int8.onnx")
        so = ort.SessionOptions()
        if threads:
            so.intra_op_num_threads = threads
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])
        self.model_path = path

        tpath = model_dir / "temperatures.json"
        if temperatures is None and tpath.exists():
            temperatures = json.loads(tpath.read_text(encoding="utf-8")).get("temperatures", {})
        super().__init__(catalog=catalog, temperatures=temperatures)

        self.tok = MiniTokenizer(model_dir)
        self.letter_ids = np.array(self.tok.letter_ids(self.letters), dtype=np.int64)
        self.device = f"onnxruntime-cpu({path.name})"

    def score_turn(self, messages: list[dict], n_options: int, temperature: float = 1.0) -> list[float]:
        text = self.tok.generation_prefix(messages)
        ids = np.array([self.tok.encode(text)], dtype=np.int64)
        logits = self.session.run(None, {"input_ids": ids,
                                         "attention_mask": np.ones_like(ids)})[0][0]
        sel = logits[self.letter_ids[:n_options]].astype(np.float64) / max(temperature, 1e-3)
        sel -= sel.max()
        e = np.exp(sel)
        return (e / e.sum()).tolist()
