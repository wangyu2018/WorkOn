#!/usr/bin/env bash
# QA 监控：轮询 gitee/main，QA-ISSUES.md 有变化就打印 diff
# 用法: bash tools/qa-watch.sh [间隔秒，默认120]
cd "$(dirname "$0")/.." || exit 1
INTERVAL="${1:-120}"
FILE="docs/QA-ISSUES.md"
last=""
echo "[qa-watch] 监控 $FILE @ gitee/main，每 ${INTERVAL}s 轮询一次"
while true; do
  git fetch gitee -q 2>/dev/null
  cur=$(git rev-parse "gitee/main:$FILE" 2>/dev/null)
  if [ -z "$cur" ]; then
    echo "[qa-watch] $(date +%H:%M:%S) 远端没有 $FILE"
  elif [ "$cur" != "$last" ]; then
    if [ -n "$last" ]; then
      echo "======== $(date '+%H:%M:%S') QA-ISSUES.md 有更新 ========"
      git show "gitee/main:$FILE" > /tmp/qa-new.md 2>/dev/null
      git show "$last:$FILE" > /tmp/qa-old.md 2>/dev/null || git cat-file blob "$last" > /tmp/qa-old.md
      diff -u /tmp/qa-old.md /tmp/qa-new.md | grep -E "^[+-]" | grep -v "^[+-][+-][+-]" | head -60
      echo "======== 状态概览 ========"
      grep -nE "状态|修复记录|QA 回执" /tmp/qa-new.md | head -30
      cp /tmp/qa-new.md /tmp/qa-last.md
    else
      echo "[qa-watch] $(date +%H:%M:%S) 基线已记录 ($cur)"
      git show "gitee/main:$FILE" > /tmp/qa-last.md 2>/dev/null
    fi
    last="$cur"
  fi
  sleep "$INTERVAL"
done
