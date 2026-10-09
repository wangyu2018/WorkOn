#!/usr/bin/env python3
"""WorkOn-Jev 本地服务：SystemOne 兼容 HTTP API。

启动
----
    python -m jev.serve.server --model out/lora --port 8765
    # 环境变量：JEV_MODEL_DIR / JEV_DEVICE / JEV_DTYPE

接口
----
    GET  /health                 健康与模型信息
    POST /v1/systemone           通用（对齐 jev-style / jev-smol）
    POST /v1/workon/decide       WorkOn 原生：上下文 -> 场景/动作/工作状态
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

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from jev.infer.base import DEFAULT_QUESTIONS  # noqa: E402
from jev.infer.factory import default_model_dir, load_engine  # noqa: E402
from jev.serve.schema import (Question, SystemOneRequest, SystemOneResponse,  # noqa: E402
                              question_to_spec, spec_to_answer)


class WorkOnDecideRequest(BaseModel):
    context: dict
    questions: list[str] = DEFAULT_QUESTIONS
    include_title: str = "hint"


def create_app(model_dir: str | None = None, device: str = "auto", dtype: str = "auto") -> FastAPI:
    app = FastAPI(title="WorkOn-Jev", version="0.1.0")
    state: dict = {"engine": None, "model_dir": model_dir or default_model_dir()}

    def engine():
        if state["engine"] is None:
            t0 = time.time()
            state["engine"] = load_engine(
                state["model_dir"],
                device=device or os.environ.get("JEV_DEVICE", "auto"),
                dtype=dtype or os.environ.get("JEV_DTYPE", "auto"),
                threads=int(os.environ.get("JEV_THREADS", 0)))
            state["load_s"] = round(time.time() - t0, 2)
            print(f"[serve] 模型载入完成 {state['model_dir']} ({state['load_s']}s) device={state['engine'].device}")
        return state["engine"]

    @app.on_event("startup")
    def _warm() -> None:
        if os.environ.get("JEV_WARMUP", "1") == "1":
            try:
                engine()
            except Exception as e:  # noqa: BLE001
                print("[serve] 预加载失败（首个请求会重试）:", e)

    @app.get("/health")
    def health() -> dict:
        eng = state["engine"]
        return {
            "ok": True,
            "model_dir": state["model_dir"],
            "loaded": eng is not None,
            "load_s": state.get("load_s"),
            "device": getattr(eng, "device", None),
            "temperatures": getattr(eng, "temperatures", None),
            "questions": DEFAULT_QUESTIONS,
        }

    @app.post("/v1/systemone", response_model=SystemOneResponse)
    def systemone(req: SystemOneRequest) -> SystemOneResponse:
        eng = engine()
        t0 = time.time()
        # WorkOn 预设题：state 必须是上下文 dict，走层级选项表
        if isinstance(req.questions, list):
            if not isinstance(req.state, dict):
                raise HTTPException(400, "questions 为内置题名列表时，state 必须给 WorkOn 上下文 dict")
            res = eng.decide(req.state, req.questions, include_title=req.include_title)
            answers = {}
            for q, a in res["answers"].items():
                answers[q] = spec_to_answer(
                    {"type": "choice", "options": a["options"]}, a)
            usage = {"state_tokens": len(eng.tok(res["state"])["input_ids"]), "output_tokens": 0}
            return SystemOneResponse(
                model=req.model or Path(state["model_dir"]).name, answers=answers,
                usage=usage, latency_ms=round((time.time() - t0) * 1000, 1), backend=eng.device)

        # 通用 SystemOne：任意 state 文本 + 任意题
        if isinstance(req.state, str):
            state_text = req.state
        else:
            from jev.state import render_state
            state_text = render_state(req.state, include_title=req.include_title)
        specs = [question_to_spec(name, q) for name, q in req.questions.items()]
        prev_t = dict(eng.temperatures)
        if req.temperature is not None:
            for s in specs:
                eng.temperatures[s["name"]] = req.temperature
        try:
            res = eng.ask(state_text, specs)
        finally:
            eng.temperatures = prev_t
        answers = {s["name"]: spec_to_answer(s, res[s["name"]]) for s in specs}
        usage = {"state_tokens": len(eng.tok(state_text)["input_ids"]), "output_tokens": 0}
        return SystemOneResponse(
            model=req.model or Path(state["model_dir"]).name, answers=answers,
            usage=usage, latency_ms=round((time.time() - t0) * 1000, 1), backend=eng.device)

    @app.post("/v1/workon/decide")
    def workon_decide(req: WorkOnDecideRequest) -> JSONResponse:
        eng = engine()
        t0 = time.time()
        res = eng.decide(req.context, req.questions, include_title=req.include_title)
        payload = {
            "model": Path(state["model_dir"]).name,
            "answers": {q: {"key": a["key"], "text": a["text"], "confidence": round(a["confidence"], 4),
                            "probabilities": {o["key"]: round(o["prob"], 4) for o in a["options"]}}
                        for q, a in res["answers"].items()},
            "work_state": (res["answers"].get("work_state") or {}).get("key"),
            "work_state_prob": round((res["answers"].get("work_state") or {}).get("confidence", 0.0), 4),
            "scene": {q: (res["answers"].get(q) or {}).get("text") for q in ("scene_l1", "scene_l2", "scene_l3")},
            "latency_ms": round((time.time() - t0) * 1000, 1),
            "backend": eng.device,
        }
        return JSONResponse(payload)

    @app.get("/")
    def index() -> dict:
        return {"name": "WorkOn-Jev", "systemone": "/v1/systemone", "workon": "/v1/workon/decide",
                "docs": "/docs"}

    return app


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=default_model_dir())
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=int(os.environ.get("JEV_PORT", 8765)))
    ap.add_argument("--device", default=os.environ.get("JEV_DEVICE", "auto"))
    ap.add_argument("--dtype", default=os.environ.get("JEV_DTYPE", "auto"))
    args = ap.parse_args()
    import uvicorn
    uvicorn.run(create_app(args.model, args.device, args.dtype), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
