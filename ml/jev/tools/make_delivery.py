#!/usr/bin/env python3
"""把训练产物 + 运行时代码组装成可并入 WorkOn 仓库的 ml/jev/ 目录，并打包 zip。

产物结构（相对 WorkOn 仓库根）
    ml/jev/
      README.md
      requirements-serve.txt        端侧推理依赖（onnxruntime + tokenizers，约 25MB）
      requirements-train.txt        训练依赖（torch + transformers + peft）
      configs/questions.json        选项表（固定口径）
      model/                        合并后的模型：model.int8.onnx + tokenizer + 温度
      jev/                          python 包（运行时代码）
      tools/                        数据构建 / 训练 / 校准 / 评测 / 导出
      integration/                  WorkOn 侧 TypeScript 接入补丁
      REPORT.md                     精度与校准报告
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 整个 jev 包都发（运行时 + 数据/训练/评测/导出），这样 tools/ 下的脚本
# 仍然能用 `from jev.xxx import ...`，不会因为扁平化而 import 断裂。
DEV_TOOLS = [
    "tools/prepare_labels.py",
    "tools/make_report.py",
    "tools/make_delivery.py",
    "tools/baseline_compare.py",
    "tools/baseline_retrain.py",
    "tools/selftest.py",
    "tools/test_onnx_path.py",
    "tools/post_train.sh",
    "run_all.sh",
]

REQ_SERVE = """# WorkOn-Jev 端侧推理依赖（不含 torch/transformers，约 25MB）
onnxruntime>=1.17
tokenizers>=0.20
numpy>=1.24
# 只有跑 HTTP 服务时才需要下面三个；只用 stdio 侧车可以去掉
fastapi>=0.110
uvicorn>=0.27
pydantic>=2.5
"""

REQ_TRAIN = """# WorkOn-Jev 训练/校准/评测/导出依赖
torch>=2.4
transformers>=4.44
peft>=0.11
datasets>=2.20
accelerate>=0.30
scikit-learn>=1.4
onnx>=1.16
onnxscript>=0.1.1
onnxruntime>=1.17
numpy>=1.24
pandas>=2.0
fastapi>=0.110
uvicorn>=0.27
pydantic>=2.5
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx-dir", default=str(ROOT / "out" / "onnx"))
    ap.add_argument("--lora-dir", default=str(ROOT / "out" / "lora"))
    ap.add_argument("--out", default=str(ROOT / "delivery"))
    ap.add_argument("--report", default=str(ROOT / "out" / "eval_report.md"))
    ap.add_argument("--zip", default=str(ROOT / "workon-jev-ml-jev.zip"))
    args = ap.parse_args()

    onnx_dir, lora_dir = Path(args.onnx_dir), Path(args.lora_dir)
    out = Path(args.out) / "ml" / "jev"
    if out.exists():
        shutil.rmtree(out)
    (out / "configs").mkdir(parents=True)
    (out / "model").mkdir(parents=True)
    (out / "tools").mkdir(parents=True)
    (out / "integration").mkdir(parents=True)

    # ── 整个 jev 包 ──
    shutil.copytree(ROOT / "jev", out / "jev",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for d in ("", "data", "train", "eval", "infer", "serve", "export"):
        (out / "jev" / d).mkdir(parents=True, exist_ok=True)
        init = out / "jev" / d / "__init__.py"
        if not init.exists():
            init.write_text("", encoding="utf-8")

    # ── 模型与配置 ──
    for name in ("model.int8.onnx", "model.onnx", "tokenizer.json", "tokenizer_config.json",
                 "vocab.json", "merges.txt", "chat_template.jinja", "questions.json",
                 "temperatures.json", "export_report.json"):
        src = onnx_dir / name
        if src.exists():
            shutil.copy(src, out / "model" / name)
    shutil.copy(ROOT / "configs" / "questions.json", out / "configs" / "questions.json")
    if (lora_dir / "train_config.json").exists():
        shutil.copy(lora_dir / "train_config.json", out / "model" / "train_config.json")

    # ── 训练/评测工具 ──
    for rel in DEV_TOOLS:
        src = ROOT / rel
        if src.exists():
            dst = out / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(src, dst)

    # ── 依赖与文档 ──
    (out / "env.example.sh").write_text(
        "# 训练/评测时用：把所有缓存指到仓库内，避免污染 ~/.cache\n"
        "export UV_CACHE_DIR=\"$PWD/.cache/uv\"\n"
        "export HF_HOME=\"$PWD/.cache/huggingface\"\n"
        "export TORCH_HOME=\"$PWD/.cache/torch\"\n"
        "export TOKENIZERS_PARALLELISM=false\n"
        "export PYTORCH_ENABLE_MPS_FALLBACK=1\n",
        encoding="utf-8")
    (out / "requirements-serve.txt").write_text(REQ_SERVE, encoding="utf-8")
    (out / "requirements-train.txt").write_text(REQ_TRAIN, encoding="utf-8")
    for name in ("README.md", "REPORT.md"):
        src = ROOT / name if name == "README.md" else Path(args.report)
        if src.exists():
            shutil.copy(src, out / name)

    # ── 接入补丁 ──
    integ = ROOT / "integration"
    if integ.exists():
        for p in integ.glob("*.patch"):
            shutil.copy(p, out / "integration" / p.name)
        if (integ / "patches").exists():
            shutil.copytree(integ / "patches", out / "integration" / "patches", dirs_exist_ok=True)
        for sub in ("base", "new"):   # 原始文件与改后文件，方便自行 diff/覆盖
            if (integ / sub).exists():
                shutil.copytree(integ / sub, out / "integration" / sub, dirs_exist_ok=True)
        if (integ / "README.md").exists():
            shutil.copy(integ / "README.md", out / "integration" / "README.md")

    # ── 启动脚本（免装包，直接 python 跑） ──
    (out / "serve.py").write_text(
        "#!/usr/bin/env python3\n"
        '"""HTTP 服务入口：python ml/jev/serve.py --port 8765"""\n'
        "import sys, pathlib\n"
        "sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))\n"
        "from jev.serve.server import main\n"
        "main()\n", encoding="utf-8")
    (out / "sidecar.py").write_text(
        "#!/usr/bin/env python3\n"
        '"""stdio 侧车入口（WorkOn modelClient 调用）：python ml/jev/sidecar.py --mode fast"""\n'
        "import sys, pathlib\n"
        "sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))\n"
        "from jev.serve.sidecar import main\n"
        "main()\n", encoding="utf-8")

    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"[delivery] {out}  ({total/1e6:.0f} MB)")
    for f in sorted(out.rglob("*")):
        if f.is_file() and f.stat().st_size > 200_000:
            print(f"   {f.relative_to(out)}  {f.stat().st_size/1e6:.0f} MB")

    if args.zip:
        zpath = Path(args.zip).resolve()
        if zpath.exists():
            sapp = zpath.resolve()
            raise SystemExit(f"拒绝覆盖已存在的压缩包：{sapp}")
        subprocess.run(["zip", "-qr", str(zpath), "ml"], cwd=Path(args.out), check=True)
        print(f"[delivery] zip -> {zpath} ({zpath.stat().st_size/1e6:.0f} MB)")
    print(json.dumps({"ok": True, "out": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
