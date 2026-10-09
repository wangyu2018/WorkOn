#!/usr/bin/env python3
"""WorkOn stdio 侧车：**与现有 ml/predict_server.py 协议兼容**的替换实现。

现有协议（src/main/recognition/modelClient.ts）
    就绪：  {"event":"ready"}
    请求：  {"id":1,"features":{9 个字段}}\\n
    响应：  {"id":1,"label":"coding","prob":0.87}\\n
    失败：  {"id":1,"error":"..."}\\n

因此可以**不改 TypeScript** 先替换后端；额外字段（scene/answers/latency_ms）老客户端会忽略。

新增增强请求（需要时再用）
    {"id":2,"context":{进程/标题/OCR/布局/行为...},"questions":["work_state","scene_l1"]}

两种模式
    fast（默认）：只问 work_state，单次前向，M4 上 ~0.2s，适合每个采样点调用；
    full        ：问全部 5 题，~0.7s，适合窗口切换时异步调用。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
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

from jev.infer.base import DEFAULT_QUESTIONS  # noqa: E402
from jev.infer.factory import default_model_dir, load_engine  # noqa: E402

# 现有 9 特征 -> WorkOn 上下文行
FEATURE_KEYS = ("app_category", "action_type", "field", "duration_ms", "hour",
                "day_of_week", "time_since_prev_ms", "text_length", "has_shortcut")


def features_to_context(features: dict) -> dict:
    row = {k: features.get(k) for k in FEATURE_KEYS}
    # app_category 无法还原进程名，但 render_state 会用不到进程名的那几行
    return row


class Sidecar:
    def __init__(self, model_dir: str, device: str, dtype: str, mode: str, include_title: str,
                 threads: int = 0):
        self.mode = mode
        self.include_title = include_title
        # 自动选后端：ml/jev/model（只有 onnx）走 onnxruntime，out/lora（adapter）走 torch
        self.engine = load_engine(model_dir, device=device, dtype=dtype, threads=threads)
        self.questions = ["work_state"] if mode == "fast" else list(DEFAULT_QUESTIONS)

    def handle(self, msg: dict) -> dict:
        rid = msg.get("id", -1)
        t0 = time.time()
        if "context" in msg:
            # 显式给 context 视为要走 full 通道：默认问全部内置题
            ctx = msg["context"]
            questions = msg.get("questions") or list(DEFAULT_QUESTIONS)
        elif "features" in msg:
            ctx = features_to_context(msg["features"] or {})
            questions = msg.get("questions") or self.questions
        else:
            return {"id": rid, "error": "缺少 features 或 context"}
        res = self.engine.decide(ctx, questions, include_title=self.include_title)
        answers = res["answers"]
        ws = answers.get("work_state") or {}
        out = {
            "id": rid,
            "label": ws.get("key"),
            "prob": round(ws.get("confidence", 0.0), 4),
            "state": ws.get("key"),
            "answers": {q: {"key": a["key"], "text": a["text"],
                            "prob": round(a["confidence"], 4),
                            "probs": {o["key"]: round(o["prob"], 4) for o in a["options"]}}
                        for q, a in answers.items()},
            "latency_ms": round((time.time() - t0) * 1000, 1),
        }
        if "scene_l1" in answers:
            out["scene"] = {q: answers[q]["text"] for q in ("scene_l1", "scene_l2", "scene_l3") if q in answers}
        return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", default=default_model_dir(),
                    help="LoRA adapter 目录或合并后的模型目录")
    ap.add_argument("--device", default=os.environ.get("JEV_DEVICE", "auto"))
    ap.add_argument("--dtype", default=os.environ.get("JEV_DTYPE", "auto"))
    ap.add_argument("--mode", default=os.environ.get("JEV_MODE", "fast"), choices=["fast", "full"])
    ap.add_argument("--include-title", default=os.environ.get("JEV_INCLUDE_TITLE", "hint"))
    ap.add_argument("--threads", type=int, default=int(os.environ.get("JEV_THREADS", 0)),
                    help="onnxruntime intra-op 线程数（0=默认）")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    side = Sidecar(args.model_dir, args.device, args.dtype, args.mode, args.include_title,
                   threads=args.threads)
    def emit(obj: dict) -> None:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    emit({"event": "ready", "model": Path(args.model_dir).name,
          "backend": type(side.engine).__name__, "device": side.engine.device,
          "mode": args.mode, "questions": side.questions})
    if not args.quiet:
        print(f"[sidecar] ready mode={args.mode} device={side.engine.device}", file=sys.stderr, flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            emit({"id": -1, "error": "非法 JSON"})
            continue
        try:
            emit(side.handle(msg))
        except Exception as e:  # noqa: BLE001 —— 单条失败不能拖垮常驻进程
            emit({"id": msg.get("id", -1), "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
