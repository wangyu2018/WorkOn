"""后端自动选择：同一个模型目录，能跑 ONNX 就不拉 torch。

为什么要这一步
--------------
`ml/jev/model/` 里只有 `model.int8.onnx` + tokenizer（端侧不装 torch，约 25MB 依赖）；
而开发目录 `out/lora/` 里只有 LoRA adapter（要 torch）。如果 sidecar/server 写死某一种，
交付出去就会在另一种目录上起不来 —— 这是最容易在上线当天才发现的那类问题。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def default_model_dir() -> str:
    """默认模型目录：交付目录用 `model/`，开发仓库用 `out/lora`。

    交付出去的 ml/jev/ 里权重在 `model/`，而开发时在 `out/lora`；
    写死任何一个都会让另一边起不来。JEV_MODEL_DIR 可覆盖。
    """
    env = os.environ.get("JEV_MODEL_DIR")
    if env:
        return env
    for cand in (ROOT / "model", ROOT / "out" / "lora", ROOT / "out" / "onnx"):
        if cand.exists():
            return str(cand)
    return str(ROOT / "model")


def detect_backend(model_dir: str | Path) -> str:
    p = Path(model_dir)
    if (p / "adapter_config.json").exists():
        return "torch"
    if (p / "config.json").exists() and list(p.glob("*.safetensors")):
        return "torch"
    if (p / "model.int8.onnx").exists() or (p / "model.onnx").exists():
        return "onnx"
    raise FileNotFoundError(
        f"{p} 下既没有 LoRA adapter / 完整 HF 权重，也没有 model.onnx / model.int8.onnx")


def load_engine(model_dir: str | Path, *, device: str = "auto", dtype: str = "auto",
                threads: int = 0, temperatures: dict | None = None, catalog=None):
    """按目录内容自动选 torch 还是 onnxruntime 后端。"""
    kind = detect_backend(model_dir)
    if kind == "torch":
        from jev.infer.engine import JevEngine
        return JevEngine(model_dir, device=device, dtype=dtype,
                         temperatures=temperatures, catalog=catalog)
    from jev.serve.onnx_backend import OnnxEngine
    return OnnxEngine(model_dir, threads=threads, temperatures=temperatures, catalog=catalog)
