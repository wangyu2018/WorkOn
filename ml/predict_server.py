#!/usr/bin/env python3
"""WorkOn 小模型常驻推理服务（供 Electron 主进程通过 stdio/NDJSON 调用）。

协议：
    启动加载完模型后输出一行 {"event":"ready"}
    请求：{"id":1,"features":{"app_category":"browser",...}}\n
    响应：{"id":1,"label":"code","prob":0.87}\n 或 {"id":1,"error":"..."}\n

用法：
    python predict_server.py --model-dir models

预处理与 predict.py 完全一致（one-hot 后按 feature_columns.json 对齐列序），
未知类别值自动落在全零块，不会崩。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd
from xgboost import XGBClassifier

CATEGORICAL_COLS = ["app_category", "action_type", "field"]


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def prepare_single(row: dict, feature_columns: list[str]) -> pd.DataFrame:
    df = pd.DataFrame([row])
    df["has_shortcut"] = df["has_shortcut"].astype(int)
    X_encoded = pd.get_dummies(df, columns=CATEGORICAL_COLS, dtype=int)
    return X_encoded.reindex(columns=feature_columns, fill_value=0)


def main() -> None:
    parser = argparse.ArgumentParser(description="WorkOn model inference sidecar")
    parser.add_argument("--model-dir", type=str, default=None)
    args = parser.parse_args()

    # Windows 控制台默认 GBK，强制 UTF-8 与 Node 端对齐
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")

    model_dir = Path(args.model_dir) if args.model_dir else Path(__file__).parent / "models"
    model_path = model_dir / "action_model_v2.json"
    feature_columns = json.loads((model_dir / "feature_columns.json").read_text(encoding="utf-8"))
    label_classes = json.loads((model_dir / "label_classes.json").read_text(encoding="utf-8"))

    try:
        model = XGBClassifier()
        model.load_model(str(model_path))
        model.n_classes_ = len(label_classes)
    except Exception as e:  # noqa: BLE001
        emit({"event": "fatal", "error": f"load model failed: {e}"})
        sys.exit(1)

    emit({"event": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = -1
        try:
            req = json.loads(line)
            req_id = int(req.get("id", -1))
            features = req.get("features")
            if not isinstance(features, dict):
                raise ValueError("missing 'features' object")
            X = prepare_single(features, feature_columns)
            pred_id = int(model.predict(X)[0])
            probs = model.predict_proba(X)[0]
            emit({"id": req_id, "label": label_classes[pred_id], "prob": round(float(max(probs)), 4)})
        except Exception as e:  # noqa: BLE001
            emit({"id": req_id, "error": str(e)})


if __name__ == "__main__":
    main()
