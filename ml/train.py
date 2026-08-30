#!/usr/bin/env python3
"""WorkOn 动作分类模型训练脚本（XGBoost v1）。

用法:
    python train.py --data data/simulated_actions.jsonl \
        --output models/action_model.json

支持传入多个数据文件混入本地真实数据:
    python train.py --data a.jsonl b.jsonl --output models/action_model.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

CATEGORICAL_COLS = ["app_category", "action_type", "field"]
NUMERIC_COLS = [
    "duration_ms",
    "hour",
    "day_of_week",
    "time_since_prev_ms",
    "text_length",
]
BOOL_COLS = ["has_shortcut"]
LABEL_COL = "label"


def load_data(paths: list[str]) -> pd.DataFrame:
    """从多个 JSONL 文件加载数据。"""
    frames: list[pd.DataFrame] = []
    for path in paths:
        p = Path(path)
        if not p.exists():
            raise FileNotFoundError(f"Data file not found: {p}")
        with p.open("r", encoding="utf-8-sig") as f:
            rows = [json.loads(line) for line in f if line.strip()]
        df = pd.DataFrame(rows)
        if LABEL_COL not in df.columns:
            raise ValueError(f"Missing label column in {p}")
        frames.append(df)
    if not frames:
        raise ValueError("No data loaded")
    return pd.concat(frames, ignore_index=True)


def prepare_features(df: pd.DataFrame, drop_cols: list[str] | None = None) -> pd.DataFrame:
    """把原始 JSON 字段转成模型输入特征矩阵。

    drop_cols: 训练前剔除的原始特征列（如 field/action_type），用于去泄漏对照实验——
    合成数据里这两列与标签存在函数性绑定，不剔除会高估泛化性能。
    """
    used_cols = [c for c in CATEGORICAL_COLS + NUMERIC_COLS + BOOL_COLS if c not in (drop_cols or [])]
    missing = [col for col in used_cols if col not in df.columns]
    if missing:
        raise ValueError(f"Missing feature columns: {missing}")

    X = df[used_cols].copy()
    for col in BOOL_COLS:
        if col in X.columns:
            X[col] = X[col].astype(int)

    # 简单 one-hot；部署时按保存的 feature_columns 对齐即可
    cat_used = [c for c in CATEGORICAL_COLS if c in X.columns]
    X_encoded = pd.get_dummies(
        X,
        columns=cat_used,
        dtype=int,
    )
    return X_encoded


def main() -> None:
    parser = argparse.ArgumentParser(description="Train WorkOn action classifier")
    parser.add_argument(
        "--data",
        nargs="+",
        required=True,
        help="JSONL data file(s); can pass multiple files to mix simulated and real data",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="models/action_model.json",
        help="Output XGBoost model path",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument(
        "--drop-cols",
        nargs="*",
        default=[],
        help="训练前剔除的特征列（去泄漏对照实验，如 --drop-cols field action_type）",
    )
    args = parser.parse_args()

    df = load_data(args.data)
    print(f"Loaded {len(df)} samples, labels: {sorted(df[LABEL_COL].unique())}")

    X = prepare_features(df, drop_cols=args.drop_cols)
    y = df[LABEL_COL].astype(str)
    label_classes = sorted(y.unique())
    label_to_id = {label: i for i, label in enumerate(label_classes)}
    y_id = y.map(label_to_id).astype(int)

    # 按标签分层划分，避免某些类别在测试集缺失；
    # 若某个类别样本太少（如刚混入小批量真实数据），退化为普通随机划分
    try:
        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y_id,
            test_size=args.test_size,
            stratify=y_id,
            random_state=args.seed,
        )
    except ValueError:
        print("Warning: class too small for stratified split; using random split")
        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y_id,
            test_size=args.test_size,
            random_state=args.seed,
        )

    model = XGBClassifier(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=1,
        eval_metric="mlogloss",
        random_state=args.seed,
        n_jobs=-1,
    )

    model.fit(X_train, y_train, verbose=False)

    y_pred_id = model.predict(X_test)
    y_pred = [label_classes[i] for i in y_pred_id]
    y_test_labels = [label_classes[i] for i in y_test]
    report_text = classification_report(y_test_labels, y_pred, zero_division=0)
    cm_text = str(confusion_matrix(y_test_labels, y_pred))
    print("\n=== Classification Report (test set) ===")
    print(report_text)

    print("=== Confusion Matrix ===")
    print(cm_text)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    model.save_model(str(output_path))

    # 评估报告落盘（此前只打控制台，跑完就丢）
    accuracy = float((y_pred_id == y_test.to_numpy()).mean()) if hasattr(y_test, "to_numpy") else 0.0
    report_lines = [
        f"# 训练报告 — {output_path.name}",
        "",
        f"- 时间: {pd.Timestamp.now().isoformat(timespec='seconds')}",
        f"- 数据: {', '.join(args.data)}",
        f"- 样本数: {len(df)}（测试集 {len(y_test)}）",
        f"- 剔除列: {args.drop_cols or '无'}",
        f"- 参数: n_estimators=300, max_depth=6, lr=0.05, seed={args.seed}",
        f"- Accuracy: {accuracy:.4f}",
        "",
        "## Classification Report",
        "",
        "```",
        report_text,
        "```",
        "",
        "## Confusion Matrix",
        "",
        "```",
        cm_text,
        "```",
        "",
    ]
    (output_path.with_name(output_path.stem + "_report.md")).write_text(
        "\n".join(report_lines), encoding="utf-8"
    )

    # 保存部署时重建特征向量所需的元信息
    feature_columns_path = output_path.with_name("feature_columns.json")
    label_classes_path = output_path.with_name("label_classes.json")
    feature_columns_path.write_text(
        json.dumps(list(X.columns), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    label_classes_path.write_text(
        json.dumps(sorted(y.unique()), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\nModel saved: {output_path}")
    print(f"Feature columns saved: {feature_columns_path}")
    print(f"Label classes saved: {label_classes_path}")


if __name__ == "__main__":
    main()
