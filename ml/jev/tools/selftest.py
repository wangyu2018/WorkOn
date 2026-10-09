#!/usr/bin/env python3
"""交付前自检：把"会静默掉精度/静默失效"的几处全部卡一遍。

    python tools/selftest.py                 # 轻量检查（不加载模型）
    python tools/selftest.py --with-model    # 加上侧车/服务/ONNX 一致性（需要模型产物）
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

OK, FAIL = "[ok]  ", "[FAIL]"
results: list[tuple[bool, str]] = []


def check(cond: bool, msg: str) -> None:
    results.append((bool(cond), msg))
    print(f"{OK if cond else FAIL} {msg}", flush=True)


def t_render_equality(model_dir: Path) -> None:
    """1. transformers-free 渲染必须与 transformers 逐字节一致（不一致会静默掉精度）"""
    try:
        # 注意别用 `from ... import check`：会把本模块自己的 check(cond, msg) 遮蔽掉，
        # 后面 check(False, "...") 就会去调 prompt_min.check 并把 bool 当模型路径用（踩过）
        from jev.serve import prompt_min as pm
        rc = pm.check(str(model_dir), n=40)
        check(rc == 0, "prompt_min 渲染/分词 与 transformers 完全一致")
    except Exception as e:  # noqa: BLE001
        check(False, f"渲染一致性检查异常: {type(e).__name__}: {e}")


def t_schema() -> None:
    """2. SystemOne 三种题型转换"""
    from jev.serve.schema import Question, question_to_spec, spec_to_answer
    c = question_to_spec("team", Question(type="choice", instructions="x",
                                          criteria={"a": "甲", "b": "乙"}))
    check([o["key"] for o in c["options"]] == ["a", "b"], "choice -> 选项表")
    n = question_to_spec("urgent", Question(type="noul", instructions="x"))
    check([o["key"] for o in n["options"]] == ["true", "false"], "noul -> 是/否 两选项")
    s = question_to_spec("sev", Question(type="score", instructions="x", criteria=["低", "中", "高"]))
    check(len(s["options"]) == 3, "score -> 有序档位")
    ans = spec_to_answer(s, {"key": "1", "confidence": 0.6,
                             "options": [{"key": "0", "text": "低", "prob": 0.1},
                                         {"key": "1", "text": "中", "prob": 0.6},
                                         {"key": "2", "text": "高", "prob": 0.3}]})
    check(abs(ans.score - 1.2) < 1e-6, "score 期望档位 = Σ i·p_i")
    big = Question(type="choice", instructions="x", criteria={str(i): str(i) for i in range(27)})
    try:
        question_to_spec("big", big)
        check(False, "27 个选项应当被拒绝")
    except ValueError:
        check(True, "超过 26 个选项被拒绝（单字母上限）")


def t_options() -> None:
    """3. 选项表与层级结构完整性"""
    from jev.catalog import load_catalog
    cat = load_catalog()
    check(len(cat.options("scene_l1")) == 21, f"scene_l1 选项数 = {len(cat.options('scene_l1'))}")
    # 上限是"单个问题实例"的候选数，不是层级总候选数（总候选 70/168 正是分层的意义）
    for q in ("scene_l1", "action", "work_state"):
        n = len(cat.options(q))
        check(n <= 26, f"{q} 候选 {n} ≤ 26")
    for q in ("scene_l2", "scene_l3"):
        worst = max((len(v) for v in cat.questions[q]["options_by_parent"].values()), default=0)
        check(worst <= 26, f"{q} 单父候选最大 {worst} ≤ 26（总共 "
                          f"{sum(len(v) for v in cat.questions[q]['options_by_parent'].values())} 个候选，按父节点分批）")
    l1 = cat.options("scene_l1")[0]["key"]
    kids = cat.options("scene_l2", l1)
    check(len(kids) >= 1 and all(k["key"].startswith(l1 + "//") for k in kids),
          f"scene_l2 层级 key 带父路径（{l1} -> {len(kids)} 个）")
    empty = [k["key"] for k in kids if len(cat.options("scene_l3", k["key"])) < 1]
    check(not empty, f"每个 L2 至少有一个 L3 子项（空: {empty}）")


def t_server() -> None:
    """4. HTTP 服务可创建、/health 可用（不加载模型）"""
    os.environ["JEV_WARMUP"] = "0"
    try:
        from fastapi.testclient import TestClient
        from jev.serve.server import create_app
        app = create_app(model_dir=str(ROOT / "out" / "lora"))
        c = TestClient(app)
        r = c.get("/health")
        check(r.status_code == 200 and r.json()["ok"], "GET /health 正常")
        ready = (ROOT / "out" / "lora" / "tokenizer.json").exists()
        if ready:
            r2 = c.post("/v1/systemone", json={"state": "用户正在 VS Code 改 TypeScript",
                                               "questions": {"q": {"type": "choice", "instructions": "在写代码吗",
                                                                   "criteria": {"a": "是", "b": "否"}}}})
            ok = r2.status_code == 200 and r2.json()["answers"]["q"]["type"] == "choice"
            check(ok, f"POST /v1/systemone 返回 choice 答案（{r2.status_code}）")
        else:
            check(True, "模型未就绪，跳过 /v1/systemone 实际推理检查（先用 --no-warmup 起服务）")
    except ImportError as e:
        check(False, f"缺少依赖（pip install fastapi httpx）: {e}")
    except Exception as e:  # noqa: BLE001
        check(False, f"服务创建异常: {type(e).__name__}: {e}")


def t_sidecar(model_dir: Path, mode: str = "fast") -> None:
    """5. stdio 侧车协议（与 modelClient.ts 约定的 NDJSON）"""
    script = ROOT / "jev" / "serve" / "sidecar.py"
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    p = subprocess.Popen([sys.executable, str(script), "--model-dir", str(model_dir),
                          "--mode", mode, "--quiet"],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                         text=True, encoding="utf-8", env=env, cwd=str(ROOT))
    try:
        first = p.stdout.readline()
        msg = json.loads(first)
        check(msg.get("event") == "ready", f"侧车 ready 事件（mode={mode}）")
        req = {"id": 1, "features": {
            "app_category": "browser", "action_type": "TYPE", "field": "web_page",
            "duration_ms": 5000, "hour": 10, "day_of_week": 3, "time_since_prev_ms": 3000,
            "text_length": 18, "has_shortcut": False}}
        p.stdin.write(json.dumps(req) + "\n")
        p.stdin.flush()
        resp = json.loads(p.stdout.readline())
        check(resp.get("id") == 1 and isinstance(resp.get("label"), str)
              and isinstance(resp.get("prob"), (int, float)),
              f"侧车单条推理: label={resp.get('label')} prob={resp.get('prob')} "
              f"latency={resp.get('latency_ms')}ms")
    except Exception as e:  # noqa: BLE001
        check(False, f"侧车协议异常: {type(e).__name__}: {e}")
    finally:
        p.kill()


def t_onnx_equivalence(onnx_dir: Path, rows: int = 8) -> None:
    """6. onnxruntime 后端与 torch 后端在真实样本上必须给出一致的分布"""
    if not (onnx_dir / "model.onnx").exists() and not (onnx_dir / "model.int8.onnx").exists():
        check(False, f"未找到 ONNX 产物: {onnx_dir}")
        return
    try:
        import random
        from jev.infer.engine import JevEngine
        from jev.serve.onnx_backend import OnnxEngine
        data = [json.loads(l) for l in (ROOT / "data" / "processed" / "test.jsonl").open(encoding="utf-8") if l.strip()]
        random.Random(0).shuffle(data)
        data = data[:rows]
        t = JevEngine(str(ROOT / "out" / "lora"), device="cpu")
        o = OnnxEngine(onnx_dir)
        same = 0
        maxdiff = 0.0
        for r in data:
            a = t.decide(r["state_row"], r["questions"])
            b = o.decide(r["state_row"], r["questions"])
            if all(a["answers"][k]["key"] == b["answers"][k]["key"] for k in a["answers"]):
                same += 1
            for k in a["answers"]:
                pa = {x["key"]: x["prob"] for x in a["answers"][k]["options"]}
                pb = {x["key"]: x["prob"] for x in b["answers"][k]["options"]}
                maxdiff = max(maxdiff, max(abs(pa[kk] - pb[kk]) for kk in pa))
        check(same == len(data), f"onnx 与 torch 选择一致 {same}/{len(data)}（最大概率差 {maxdiff:.4f}）")
    except Exception as e:  # noqa: BLE001
        check(False, f"ONNX 一致性检查异常: {type(e).__name__}: {e}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-model", action="store_true")
    ap.add_argument("--model", default=str(ROOT / "out" / "lora"))
    ap.add_argument("--onnx", default=str(ROOT / "out" / "onnx"))
    args = ap.parse_args()

    model_dir = Path(args.model)
    print(f"=== WorkOn-Jev 自检 (model={model_dir}) ===")
    t_options()
    t_schema()
    t_server()
    if (model_dir / "tokenizer.json").exists():
        t_render_equality(model_dir)
    else:
        check(False, f"{model_dir} 下没有 tokenizer.json，跳过渲染一致性检查")
    if args.with_model and (model_dir / "adapter_config.json").exists():
        t_sidecar(model_dir, "fast")
        t_onnx_equivalence(Path(args.onnx))
    elif args.with_model:
        check(False, f"{model_dir} 不是 LoRA adapter 目录，跳过侧车检查")

    bad = [m for ok, m in results if not ok]
    print(f"\n=== {len(results) - len(bad)}/{len(results)} 通过 ===")
    for m in bad:
        print("  未通过:", m)
    sys.stdout.flush()
    # 用 os._exit 跳过解释器清理：macOS 上 torch 与 onnxruntime 同时加载时，
    # 退出阶段的析构顺序会让进程以 SIGABRT(134) 收尾（实测），
    # 结果已经打印完毕，这里直接给出干净的退出码。
    os._exit(1 if bad else 0)


if __name__ == "__main__":
    main()
