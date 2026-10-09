#!/usr/bin/env python3
"""公平对照：用**本项目的训练划分**重训一个 XGBoost，再在本项目的测试划分上评测。

为什么必须单独做这件事
----------------------
现网 `ml/models/action_model_v3_real.json` 是在全部 real_actions.jsonl 上训的，
而真实数据只有 **33 个 (app_category, field, label) 组合**（极度冗余）。
拿它在我们划出的"测试集"上评测时，那些行它训练时基本都见过 ——
所以它报 99.84% 是**记忆**，不是泛化（`ml/EXPERIMENTS.md` 里记的也是同一回事）。

这里把两边拉到同一起跑线：同样只在这些真实行上训、同样只在这些真实行上测。

本脚本刻意**不 import torch**：macOS 上 torch 与 xgboost 各带一份 libomp，
同进程里先 import torch 再 xgb.load_model 会直接段错误。
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

CATS = ["app_category", "action_type", "field"]
FEATS = ["app_category", "action_type", "field", "duration_ms", "hour", "day_of_week",
         "time_since_prev_ms", "text_length", "has_shortcut"]


def load_real(path: Path) -> tuple[list[dict], list[str]]:
    feats, gold = [], []
    for line in path.open(encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        if r.get("source") == "real_actions" and "work_state" in r.get("questions", []):
            feats.append({k: r["state_row"][k] for k in FEATS if k in r["state_row"]})
            gold.append(r["gold_keys"][0])
    return feats, gold


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", default=str(ROOT / "data" / "processed" / "train.jsonl"))
    ap.add_argument("--test", default=str(ROOT / "data" / "processed" / "test.jsonl"))
    ap.add_argument("--out", default=str(ROOT / "out" / "baseline_retrain.json"))
    args = ap.parse_args()

    import pandas as pd
    from sklearn.metrics import accuracy_score, f1_score
    from xgboost import XGBClassifier

    trf, trg = load_real(Path(args.train))
    tef, teg = load_real(Path(args.test))
    labels = sorted(set(trg) | set(teg))
    lab2id = {k: i for i, k in enumerate(labels)}
    print(f"[retrain] train={len(trf)} test={len(tef)} labels={labels}")

    def matrix(rows):
        df = pd.DataFrame(rows)
        df["has_shortcut"] = df["has_shortcut"].astype(int)
        return pd.get_dummies(df, columns=CATS, dtype=int)

    Xtr_all, Xte_all = matrix(trf), matrix(tef)
    cols = sorted(set(Xtr_all.columns) | set(Xte_all.columns))
    Xtr = Xtr_all.reindex(columns=cols, fill_value=0)
    Xte = Xte_all.reindex(columns=cols, fill_value=0)
    ytr = [lab2id[g] for g in trg]
    yte = [lab2id[g] for g in teg]

    model = XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.05,
                          subsample=0.8, colsample_bytree=0.8, nthread=4)
    model.fit(Xtr, ytr)
    proba = model.predict_proba(Xte)
    pred = [max(range(len(p)), key=lambda i: p[i]) for p in proba]
    conf = [float(max(p)) for p in proba]
    proba = [[float(x) for x in p] for p in proba]

    maj = Counter(yte).most_common(1)[0][0]
    maj_acc = sum(1 for y in yte if y == maj) / len(yte)

    out = {
        "note": "在**本项目**的训练划分上重训、在**本项目**的测试划分上评测，与 WorkOn-Jev 同起跑线",
        "n_train": len(trf), "n_test": len(tef),
        "labels": labels,
        "xgboost_retrained": {
            "accuracy": round(float(accuracy_score(yte, pred)), 4),
            "macro_f1": round(float(f1_score(yte, pred, average="macro")), 4),
            "mean_confidence": round(sum(conf) / len(conf), 4),
            "coverage_at_0.75": round(sum(1 for c in conf if c >= 0.75) / len(conf), 4),
            "precision_at_0.75": round(
                sum(1 for p, y, c in zip(pred, yte, conf) if c >= 0.75 and p == y)
                / max(sum(1 for c in conf if c >= 0.75), 1), 4),
        },
        "majority_class": {"accuracy": round(maj_acc, 4), "class": labels[maj]},
        "label_dist": {labels[i]: sum(1 for y in yte if y == i) for i in range(len(labels))},
    }
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out["xgboost_retrained"], ensure_ascii=False))
    print("多数类基线:", json.dumps(out["majority_class"], ensure_ascii=False))
    print(f"[retrain] -> {args.out}")


if __name__ == "__main__":
    main()
