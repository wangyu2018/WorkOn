#!/usr/bin/env bash
# WorkOn-Jev 全流程一键脚本：选项表 -> 数据 -> 训练 -> 校准 -> 评测 -> 基线对比 -> ONNX -> 交付
#
#   ./run_all.sh                 # 全跑
#   ./run_all.sh data            # 从 data 阶段往后
#   STAGE=onnx ./run_all.sh      # 等价写法
#
# 注意：训练阶段很吃内存（实测约 8GB 峰值）。16G 机器上跑训练时不要再开别的重活，
#       否则会进 swap，训练速度会掉一个数量级（实测从 360 tok/s 掉到 160 tok/s）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
source ./env.sh
PY=".venv/bin/python"
STAGE="${1:-${STAGE:-all}}"

log() { printf '\n\033[1;36m=== %s ===\033[0m\n' "$*"; }

if [ ! -x "$PY" ]; then
  log "创建虚拟环境"
  uv venv --python 3.12 .venv
  uv pip install --python "$PY" torch transformers peft datasets accelerate \
      scikit-learn onnx onnxscript onnxruntime tokenizers numpy pandas \
      fastapi uvicorn pydantic pyyaml rich httpx xgboost
fi

ORDER=(labels data train calibrate eval baseline onnx report delivery)
START=0
if [ "$STAGE" != "all" ]; then
  for i in "${!ORDER[@]}"; do
    if [ "${ORDER[$i]}" = "$STAGE" ]; then START=$i; break; fi
  done
fi
want() { [ "$1" -ge "$START" ]; }

want 0 && { log "1/9 生成选项表"; $PY tools/prepare_labels.py; }
want 1 && { log "2/9 构建数据";   $PY jev/data/build.py --real-frac 0.25 --scene-cap 8; }
want 2 && { log "3/9 训练 LoRA（约 2.5 小时 / M4）"
            $PY jev/train/sft.py --out out/lora \
                --batch-size 8 --token-budget 1100 --grad-accum 4 --attn sdpa \
                --epochs 1 --lr 2e-4 --max-len 896 --eval-every 400 --save-every 200; }
want 3 && { log "4/9 逐题温度校准"; $PY jev/train/calibrate.py --model out/lora; }
want 4 && { log "5/9 评测（oracle + 端到端级联）"; $PY jev/eval/evaluate.py --model out/lora --cascade 1; }
want 5 && { log "6/9 与现网 XGBoost 同批对比"; $PY tools/baseline_compare.py --model out/lora; }
want 6 && { log "7/9 ONNX 导出 + int8 量化（需要 ~6GB 空闲内存）"
            $PY jev/export/export_onnx.py --model out/lora --merged out/merged \
                --out out/onnx --opset 20; }
want 7 && { log "8/9 生成 REPORT.md"; $PY tools/make_report.py; }
want 8 && { log "9/9 组装 ml/jev/ 交付物"
            $PY tools/make_delivery.py --onnx-dir out/onnx --lora-dir out/lora \
                --report REPORT.md --zip workon-jev-ml-jev.zip; }

log "完成"
