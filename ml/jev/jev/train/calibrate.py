#!/usr/bin/env python3
"""逐题温度校准：在验证集上最小化 NLL，得到 softmax(logits / T_q)。

Jev 的"校准概率"就落在这一步：模型给出的是 logits，温度决定它敢不敢说 0.9。
WorkOn 的决策层用 `prob >= 0.75` 才覆盖规则，因此温度直接决定误覆盖率。
"""
from __future__ import annotations

import argparse
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

from jev.eval.harness import score_rows  # noqa: E402
from jev.eval.metrics import ece, nll, reliability, summarize, softmax  # noqa: E402
from jev.infer.engine import JevEngine  # noqa: E402


def fit_temperature(logits: list[list[float]], gold: list[int]) -> float:
    best_t, best_nll = 1.0, float("inf")
    t = 0.05
    while t <= 10.0001:
        v = nll([softmax(l, t) for l in logits], gold)
        if v < best_nll:
            best_nll, best_t = v, t
        t += 0.05
    # 粗搜后细化
    lo, hi = max(0.05, best_t - 0.05), best_t + 0.05
    t = lo
    while t <= hi:
        v = nll([softmax(l, t) for l in logits], gold)
        if v < best_nll:
            best_nll, best_t = v, t
        t += 0.005
    return round(best_t, 3)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(ROOT / "out" / "lora"))
    ap.add_argument("--data", default=str(ROOT / "data" / "processed" / "val.jsonl"))
    ap.add_argument("--out", default=None, help="默认写到 <model>/temperatures.json")
    ap.add_argument("--batch-size", type=int, default=4)
    ap.add_argument("--max-len", type=int, default=896)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--exclude-synthetic-calib", type=int, default=0,
                    help="1=只用真实样本拟合 work_state 温度（合成行先验不同）")
    args = ap.parse_args()

    rows = [json.loads(l) for l in Path(args.data).open(encoding="utf-8") if l.strip()]
    if args.limit:
        import random as _rnd
        _rnd.Random(args.seed).shuffle(rows)   # 数据文件里真实行在前，直接切前 N 条会只抽到真实行
        rows = rows[: args.limit]
    print(f"[calib] {len(rows)} 条验证样本，加载模型 {args.model} ...")
    engine = JevEngine(args.model, device=args.device)
    scored = score_rows(engine, rows, batch_size=args.batch_size, max_len=args.max_len)
    print(f"[calib] 收集 {len(scored)} 个 (题,样本) 打分")

    by_q: dict[str, list[dict]] = {}
    for s in scored:
        by_q.setdefault(s["question"], []).append(s)

    before_temps = dict(engine.temperatures)
    temps: dict[str, float] = {}
    report: dict[str, dict] = {}
    for q, items in sorted(by_q.items()):
        logits = [x["logits"] for x in items]
        gold = [x["gold"] for x in items]
        base_t = before_temps.get(q, 1.0)
        p_before = [softmax(l, base_t) for l in logits]
        t = fit_temperature(logits, gold)
        temps[q] = t
        p_after = [softmax(l, t) for l in logits]
        report[q] = {
            "n": len(items),
            "temperature": t,
            "before": {"nll": round(nll(p_before, gold), 4), "ece": round(ece(p_before, gold), 4),
                       "summary": summarize(p_before, gold, [x["n_options"] for x in items])},
            "after": {"nll": round(nll(p_after, gold), 4), "ece": round(ece(p_after, gold), 4),
                      "summary": summarize(p_after, gold, [x["n_options"] for x in items])},
            "reliability_after": reliability(p_after, gold),
        }
        print(f"  {q:10s} T={t:<6} nll {report[q]['before']['nll']:.3f} -> {report[q]['after']['nll']:.3f}  "
              f"ece {report[q]['before']['ece']:.3f} -> {report[q]['after']['ece']:.3f}  "
              f"acc {report[q]['after']['summary']['accuracy']:.3f}")

    out = Path(args.out) if args.out else Path(args.model) / "temperatures.json"
    payload = {"temperatures": temps, "report": report,
               "fitted_on": args.data, "n_rows": len(rows)}
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[calib] 写入 {out}")
    print("温度:", temps)


if __name__ == "__main__":
    main()
