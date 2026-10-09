"""评测指标：准确率 / macro-F1 / NLL / ECE / 误差预算下的自动化率。"""
from __future__ import annotations

import math


def softmax(xs: list[float], temperature: float = 1.0) -> list[float]:
    t = max(temperature, 1e-3)
    m = max(xs) / t
    ex = [math.exp(x / t - m) for x in xs]
    s = sum(ex) or 1.0
    return [e / s for e in ex]


def macro_f1(y_true: list[int], y_pred: list[int], n_classes: int) -> float:
    f1s = []
    for c in range(n_classes):
        tp = sum(1 for a, b in zip(y_true, y_pred) if a == c and b == c)
        fp = sum(1 for a, b in zip(y_true, y_pred) if a != c and b == c)
        fn = sum(1 for a, b in zip(y_true, y_pred) if a == c and b != c)
        if tp == 0 and fp == 0 and fn == 0:
            continue
        p = tp / (tp + fp) if tp + fp else 0.0
        r = tp / (tp + fn) if tp + fn else 0.0
        f1s.append(2 * p * r / (p + r) if p + r else 0.0)
    return sum(f1s) / len(f1s) if f1s else 0.0


def nll(probs: list[list[float]], gold: list[int]) -> float:
    tot = 0.0
    for p, g in zip(probs, gold):
        tot += -math.log(max(p[g], 1e-12))
    return tot / max(len(probs), 1)


def ece(probs: list[list[float]], gold: list[int], n_bins: int = 15) -> float:
    """期望校准误差：|置信度 - 实际正确率| 的分箱加权平均。"""
    if not probs:
        return 0.0
    bins = [[] for _ in range(n_bins)]
    for p, g in zip(probs, gold):
        conf = max(p)
        pred = p.index(conf)
        bins[min(int(conf * n_bins), n_bins - 1)].append((conf, 1.0 if pred == g else 0.0))
    total = 0.0
    for b in bins:
        if not b:
            continue
        conf = sum(x[0] for x in b) / len(b)
        acc = sum(x[1] for x in b) / len(b)
        total += len(b) / len(probs) * abs(acc - conf)
    return total


def reliability(probs: list[list[float]], gold: list[int], n_bins: int = 10) -> list[dict]:
    bins = [[] for _ in range(n_bins)]
    for p, g in zip(probs, gold):
        conf = max(p)
        pred = p.index(conf)
        bins[min(int(conf * n_bins), n_bins - 1)].append((conf, 1.0 if pred == g else 0.0))
    out = []
    for i, b in enumerate(bins):
        if not b:
            continue
        out.append({
            "bin": f"{i / n_bins:.1f}-{(i + 1) / n_bins:.1f}",
            "n": len(b),
            "confidence": round(sum(x[0] for x in b) / len(b), 4),
            "accuracy": round(sum(x[1] for x in b) / len(b), 4),
        })
    return out


def automation_rate(probs: list[list[float]], gold: list[int], budgets=(0.01, 0.05, 0.10)) -> dict:
    """在给定错误预算下，按置信度从高到低最多能自动执行多少比例。"""
    if not probs:
        return {}
    confs = [max(p) for p in probs]
    correct = [1 if p.index(max(p)) == g else 0 for p, g in zip(probs, gold)]
    order = sorted(range(len(confs)), key=lambda i: -confs[i])
    out = {}
    for b in budgets:
        best_k = 0
        errs = 0
        for rank, i in enumerate(order, start=1):
            errs += 0 if correct[i] else 1
            if errs / rank <= b:
                best_k = rank
        out[f"budget_{int(b * 100)}pct"] = {
            "coverage": round(best_k / len(order), 4),
            "n": best_k,
            "threshold": round(confs[order[best_k - 1]], 4) if best_k else None,
        }
    return out


def threshold_table(probs: list[list[float]], gold: list[int], thresholds=(0.5, 0.75, 0.9)) -> dict:
    """按置信度阈值切分：覆盖率（会被模型接管的比例）与其上的精确率。

    WorkOn 的 decision.ts 用 MODEL_PROB_THRESHOLD = 0.75，所以 0.75 那一行
    直接对应"开了 model_first 之后，有多少比例的判定真的会被模型改写、改对多少"。
    """
    out = {}
    for t in thresholds:
        sel = [i for i, p in enumerate(probs) if max(p) >= t]
        if not sel:
            out[f"{t}"] = {"coverage": 0.0, "n": 0, "precision": None}
            continue
        acc = sum(1 for i in sel if probs[i].index(max(probs[i])) == gold[i]) / len(sel)
        out[f"{t}"] = {"coverage": round(len(sel) / len(probs), 4), "n": len(sel),
                       "precision": round(acc, 4)}
    return out


def summarize(probs: list[list[float]], gold: list[int], n_options: list[int] | None = None) -> dict:
    if not probs:
        return {"n": 0}
    preds = [p.index(max(p)) for p in probs]
    acc = sum(1 for a, b in zip(preds, gold) if a == b) / len(gold)
    n_cls = max(max(gold), max(preds)) + 1 if gold else 1
    if n_options:
        n_cls = max(n_options)
    return {
        "n": len(gold),
        "accuracy": round(acc, 4),
        "macro_f1": round(macro_f1(gold, preds, n_cls), 4),
        "nll": round(nll(probs, gold), 4),
        "ece": round(ece(probs, gold), 4),
        "mean_confidence": round(sum(max(p) for p in probs) / len(probs), 4),
        "automation": automation_rate(probs, gold),
        "thresholds": threshold_table(probs, gold),
    }
