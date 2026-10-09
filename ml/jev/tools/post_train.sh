#!/usr/bin/env bash
# 等训练进程退出后，自动跑完 校准 -> 评测 -> 基线对比 -> ONNX -> 报告 -> 交付。
# 用法：nohup ./tools/post_train.sh > out/post_train.log 2>&1 &
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
source ./env.sh
PY=".venv/bin/python"

log() { printf '\n[%s] === %s ===\n' "$(date +%H:%M:%S)" "$*"; }

# 等训练产出 train_config.json（训练脚本最后一步写它）。
# 不用 pgrep 是因为 `pgrep -f "jev/train/sft.py"` 会匹配到守护脚本自己的命令行，
# 导致永远等不完（踩过）。
log "等待训练产出 out/lora/train_config.json"
while [ ! -f out/lora/train_config.json ]; do
  if ! pgrep -f "sft.py --out out/lora" > /dev/null && [ ! -f out/lora/train_config.json ]; then
    sleep 60   # 进程没了但也没产物，再给一分钟（可能是刚崩、或脚本正在写盘）
    if [ ! -f out/lora/train_config.json ]; then
      log "训练进程消失且没有 train_config.json，判定失败并中止"
      exit 1
    fi
  fi
  sleep 30
done
sleep 5

if [ ! -f out/lora/adapter_config.json ]; then
  log "训练未产出 adapter（out/lora/adapter_config.json 不存在），中止"
  exit 1
fi
if [ ! -f out/lora/tokenizer.json ]; then
  log "警告：adapter 目录缺 tokenizer.json，从底座补一份"
  $PY - <<'EOF'
from transformers import AutoTokenizer
t = AutoTokenizer.from_pretrained("Qwen/Qwen3-0.6B")
t.save_pretrained("out/lora")
EOF
fi
log "训练完成，最后 3 行日志："; tail -3 out/train_run.log

log "1/6 逐题温度校准"
$PY jev/train/calibrate.py --model out/lora --batch-size 4 2>&1 | tail -12

log "2/6 评测（oracle + 级联）"
$PY jev/eval/evaluate.py --model out/lora --batch-size 4 --cascade 1 --cascade-limit 250 2>&1 | tail -30

log "3/6 与现网 XGBoost 同批对比"
$PY tools/baseline_compare.py --model out/lora 2>&1 | tail -30

log "4/6 ONNX 导出 + int8 量化"
$PY jev/export/export_onnx.py --model out/lora --merged out/merged --out out/onnx --opset 20 2>&1 | tail -25
# 注意：不要在这里手删 model.onnx.data —— 量化失败时它是唯一能重试的中间产物（踩过）

log "5/6 生成 REPORT.md"
$PY tools/make_report.py 2>&1 | tail -5

log "6/6 组装 ml/jev/ 交付物"
$PY tools/make_delivery.py --onnx-dir out/onnx --lora-dir out/lora \
    --report REPORT.md --zip workon-jev-ml-jev.zip 2>&1 | tail -20

log "全部完成"
