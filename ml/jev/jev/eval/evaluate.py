#!/usr/bin/env python3
"""评测 WorkOn-Jev：准确率 / macro-F1 / NLL / ECE / 误差预算下的自动化率。

两种口径
--------
oracle  （默认，快）：teacher forcing，层级题的父节点用金标，衡量**单题能力**；
cascade （慢，诚实）：真·自回归级联，父节点用模型自己的答案，衡量**端到端**。
两份都要看：oracle 掉分说明模型不行，cascade 比 oracle 掉太多说明层级结构在放大错误。
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
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
from jev.eval.metrics import reliability, softmax, summarize  # noqa: E402
from jev.infer.engine import JevEngine  # noqa: E402


def group_report(scored: list[dict], temps: dict, keyfn) -> list[dict]:
    groups: dict = defaultdict(list)
    for s in scored:
        groups[keyfn(s)].append(s)
    out = []
    for g, items in sorted(groups.items(), key=lambda kv: str(kv[0])):
        probs = [softmax(x["logits"], temps.get(x["question"], 1.0)) for x in items]
        gold = [x["gold"] for x in items]
        summ = summarize(probs, gold, [x["n_options"] for x in items])
        summ["group"] = g
        summ["reliability"] = reliability(probs, gold)
        out.append(summ)
    return out


def run_cascade(engine, rows: list[dict], limit: int) -> list[dict]:
    ok = 0
    tot = 0
    per_q = defaultdict(lambda: [0, 0])
    per_source = defaultdict(lambda: [0, 0])
    for r in rows[:limit]:
        try:
            res = engine.decide(r["state_row"], r["questions"])
        except Exception as e:  # noqa: BLE001
            print("  cascade error:", e)
            continue
        golds = dict(zip(r["questions"], r["gold_keys"]))
        for q in r["questions"]:
            if q not in res["answers"]:
                continue
            tot += 1
            hit = res["answers"][q]["key"] == golds.get(q)
            ok += hit
            per_q[q][0] += hit
            per_q[q][1] += 1
            per_source[r["source"]][0] += hit
            per_source[r["source"]][1] += 1
    return {
        "n": tot,
        "accuracy": round(ok / tot, 4) if tot else 0.0,
        "per_question": {q: {"n": v[1], "acc": round(v[0] / v[1], 4)} for q, v in sorted(per_q.items())},
        "per_source": {s: {"n": v[1], "acc": round(v[0] / v[1], 4)} for s, v in sorted(per_source.items())},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(ROOT / "out" / "lora"))
    ap.add_argument("--data", default=str(ROOT / "data" / "processed" / "test.jsonl"))
    ap.add_argument("--temperatures", default=None, help="默认读 <model>/temperatures.json")
    ap.add_argument("--out", default=str(ROOT / "out" / "eval_report.json"))
    ap.add_argument("--batch-size", type=int, default=4)
    ap.add_argument("--max-len", type=int, default=896)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--cascade", type=int, default=0, help="1=额外跑自回归级联口径")
    ap.add_argument("--cascade-limit", type=int, default=300)
    args = ap.parse_args()

    rows = [json.loads(l) for l in Path(args.data).open(encoding="utf-8") if l.strip()]
    if args.limit:
        import random as _rnd
        _rnd.Random(args.seed).shuffle(rows)   # 数据文件里真实行在前，直接切前 N 条会只抽到真实行
        rows = rows[: args.limit]

    temps = {}
    tpath = Path(args.temperatures) if args.temperatures else Path(args.model) / "temperatures.json"
    if tpath.exists():
        temps = json.loads(tpath.read_text(encoding="utf-8")).get("temperatures", {})
        print(f"[eval] 载入温度 {tpath}: {temps}")
    else:
        print("[eval] 未找到温度文件，按 T=1 评测")

    print(f"[eval] {len(rows)} 条测试样本（oracle 口径）...")
    engine = JevEngine(args.model, device=args.device, temperatures=temps)
    scored = score_rows(engine, rows, batch_size=args.batch_size, max_len=args.max_len)

    report = {
        "model": args.model,
        "data": args.data,
        "n_rows": len(rows),
        "temperatures": temps,
        "by_question": group_report(scored, temps, lambda s: s["question"]),
        "by_source": group_report(scored, temps, lambda s: s["source"]),
        "by_question_source": group_report(
            scored, temps, lambda s: f"{s['source']}::{s['question']}"),
    }
    if args.cascade:
        print(f"[eval] cascade 口径（前 {args.cascade_limit} 条，逐题自回归）...")
        report["cascade"] = run_cascade(engine, rows, args.cascade_limit)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n=== 分题（oracle）===")
    for r in report["by_question"]:
        a = r["automation"]
        print(f"  {r['group']:10s} n={r['n']:5d} acc={r['accuracy']:.4f} f1={r['macro_f1']:.4f} "
              f"nll={r['nll']:.3f} ece={r['ece']:.3f} | 1%预算覆盖 {a['budget_1pct']['coverage']:.2f} "
              f"5% {a['budget_5pct']['coverage']:.2f} 10% {a['budget_10pct']['coverage']:.2f}")
    print("\n=== 分来源（oracle）===")
    for r in report["by_source"]:
        print(f"  {r['group']:14s} n={r['n']:5d} acc={r['accuracy']:.4f} ece={r['ece']:.3f}")
    if args.cascade:
        print("\n=== 端到端级联 ===")
        c = report["cascade"]
        print(f"  总 acc={c['accuracy']:.4f} (n={c['n']})")
        for q, v in c["per_question"].items():
            print(f"    {q:10s} acc={v['acc']:.4f} n={v['n']}")
    print(f"\n[eval] 报告 -> {out}")


if __name__ == "__main__":
    main()
