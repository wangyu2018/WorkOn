#!/usr/bin/env python3
"""同一批真实测试行上，对比：现网 XGBoost 模型 vs WorkOn-Jev vs 多数类基线。

为什么必须做这个：`ml/models/action_model_v3_real_report.md` 里的准确率是在它自己的
划分上算的，和本项目的测试划分不同，直接比没有意义。这里把三方拉到**同一批行**上。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

FEATS = ["app_category", "action_type", "field", "duration_ms", "hour", "day_of_week",
         "time_since_prev_ms", "text_length", "has_shortcut"]
CATS = ["app_category", "action_type", "field"]


def real_test_rows(path: Path) -> list[dict]:
    rows = []
    for line in path.open(encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        if r.get("source") != "real_actions" or "work_state" not in r.get("questions", []):
            continue
        rows.append(r)
    return rows


def xgb_dump(out_path: Path, data_path: Path, baseline_dir: Path) -> None:
    """**子进程模式**：只做 XGBoost 推理并落盘。

    必须在独立进程里跑：macOS 上 torch 与 xgboost 各自链接了一份 libomp，
    同一个进程里先 import torch 再 `xgb.load_model` 会直接段错误（实测 exit 139，
    加 KMP_DUPLICATE_LIB_OK / OMP_NUM_THREADS 都救不回来）。
    """
    import pandas as pd
    from xgboost import XGBClassifier

    rows = real_test_rows(data_path)
    labels = json.loads((baseline_dir / "label_classes.json").read_text(encoding="utf-8"))
    feature_columns = json.loads((baseline_dir / "feature_columns.json").read_text(encoding="utf-8"))
    df = pd.DataFrame([r["state_row"] for r in rows])
    df["has_shortcut"] = df["has_shortcut"].astype(int)
    X = pd.get_dummies(df, columns=CATS, dtype=int).reindex(columns=feature_columns, fill_value=0)
    model = XGBClassifier(nthread=4)
    model.load_model(str(baseline_dir / "action_model_v3_real.json"))
    model.n_classes_ = len(labels)
    proba = model.predict_proba(X).tolist()
    out_path.write_text(json.dumps({"labels": labels, "proba": proba,
                                    "gold": [r["gold_keys"][0] for r in rows]},
                                   ensure_ascii=False), encoding="utf-8")
    print(f"[xgb-dump] {len(proba)} 条 -> {out_path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--xgb-dump", default=None, help="内部用：只跑 XGBoost 并落盘")
    ap.add_argument("--data", default=str(ROOT / "data" / "processed" / "test.jsonl"))
    ap.add_argument("--baseline-dir", default=str(ROOT / "baseline"))
    ap.add_argument("--model", default=str(ROOT / "out" / "lora"))
    ap.add_argument("--out", default=str(ROOT / "out" / "baseline.json"))
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()

    bdir = Path(args.baseline_dir)
    if args.xgb_dump:
        xgb_dump(Path(args.xgb_dump), Path(args.data), bdir)
        return

    rows = real_test_rows(Path(args.data))
    print(f"[baseline] 真实测试行 {len(rows)} 条")

    from jev.eval.harness import score_rows
    from jev.eval.metrics import macro_f1, softmax, summarize
    from jev.infer.engine import JevEngine

    gold_keys = [r["gold_keys"][0] for r in rows]
    labels = json.loads((bdir / "label_classes.json").read_text(encoding="utf-8"))
    label_to_id = {k: i for i, k in enumerate(labels)}
    gold_ids = [label_to_id[g] for g in gold_keys]
    feats = [r["state_row"] for r in rows]
    keep = [i for i, g in enumerate(gold_keys) if g in label_to_id]
    if len(keep) != len(gold_keys):
        print(f"[baseline] 丢弃金标不在 XGBoost 词表内的 {len(gold_keys)-len(keep)} 条")
    feats = [feats[i] for i in keep]
    gold_ids = [gold_ids[i] for i in keep]

    models: dict[str, dict] = {}

    # ── 1. 多数类基线 ──
    maj = Counter(gold_ids).most_common(1)[0][0]
    preds = [maj] * len(gold_ids)
    models["多数类（一直预测 other）"] = {
        "n": len(gold_ids),
        "accuracy": round(sum(1 for a, b in zip(preds, gold_ids) if a == b) / len(gold_ids), 4),
        "macro_f1": None, "ece": None,
    }

    # ── 2. 现网 XGBoost（独立子进程跑，见 xgb_dump 的说明）──
    dump = Path(args.out).parent / "_xgb_preds.json"
    r = subprocess.run([sys.executable, str(Path(__file__).resolve()),
                        "--xgb-dump", str(dump), "--data", args.data, "--baseline-dir", str(bdir)],
                       capture_output=True, text=True)
    if r.returncode != 0 or not dump.exists():
        print("[baseline] XGBoost 子进程失败，跳过该项:", (r.stderr or "")[-300:])
    else:
        print("  " + (r.stdout or "").strip().splitlines()[-1])
        d = json.loads(dump.read_text(encoding="utf-8"))
        lab2id = {k: i for i, k in enumerate(d["labels"])}
        xgold = [lab2id[g] for g in d["gold"] if g in lab2id]
        xproba = [p for g, p in zip(d["gold"], d["proba"]) if g in lab2id]
        xpred = [max(range(len(p)), key=lambda i: p[i]) for p in xproba]
        x_conf = [max(p) for p in xproba]
        models["现网 XGBoost action_model_v3_real"] = {
            "n": len(xgold),
            "accuracy": round(sum(1 for a, b in zip(xpred, xgold) if a == b) / max(len(xgold), 1), 4),
            "macro_f1": round(macro_f1(xgold, xpred, len(d["labels"])), 4),
            "ece": None,
            "mean_confidence": round(sum(x_conf) / max(len(x_conf), 1), 4),
            "coverage_at_0.75": round(sum(1 for c in x_conf if c >= 0.75) / max(len(x_conf), 1), 4),
        }
        dump.unlink(missing_ok=True)

    # ── 3. WorkOn-Jev ──
    engine = JevEngine(args.model, device=args.device)
    temps = engine.temperatures
    scored = score_rows(engine, rows, batch_size=4, max_len=896)
    ws = [s for s in scored if s["question"] == "work_state"]
    probs = [softmax(s["logits"], temps.get("work_state", 1.0)) for s in ws]
    g = [s["gold"] for s in ws]
    summ = summarize(probs, g, [s["n_options"] for s in ws])
    models["WorkOn-Jev (Qwen3-0.6B + LoRA)"] = {
        "n": summ["n"], "accuracy": summ["accuracy"], "macro_f1": summ["macro_f1"], "ece": summ["ece"],
        "mean_confidence": summ["mean_confidence"],
        "coverage_at_0.75": (summ.get("thresholds") or {}).get("0.75", {}).get("coverage"),
        "precision_at_0.75": (summ.get("thresholds") or {}).get("0.75", {}).get("precision"),
    }

    payload = {
        "n_rows": len(gold_ids),
        "split": "data/processed/test.jsonl 中 source=real_actions 的行",
        "models": models,
        "notes": {
            "口径": "三者都在完全相同的行上评测；XGBoost 用的是它自己训练时未见过的这批行。",
            "macro_f1 为什么有的是 null": "多数类基线只有一个类别，macro-F1 无意义；"
                                          "XGBoost 这里只报了准确率（它的混淆矩阵见其自带报告）。",
            "coverage_at_0.75": "置信度 ≥0.75 的比例 —— 也就是 decision.ts 里真正会被模型覆盖的比例。",
        },
    }
    Path(args.out).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(models, ensure_ascii=False, indent=2))
    print(f"[baseline] -> {args.out}")


if __name__ == "__main__":
    main()
