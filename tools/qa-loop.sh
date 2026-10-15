#!/bin/bash
# qa-loop：mac 侧 QA 协作循环监控（对面 qa-watch 的对端）
# 每 120s：fetch gitee → 有新提交 → pull → 扫 QA-ISSUES 变化 → 输出摘要（新增 BUG / 状态变更 / 回执）
cd "$(dirname "$0")/.." || exit 1
LAST_HEAD=""
while true; do
  git fetch gitee main 2>/dev/null
  REMOTE=$(git rev-parse gitee/main 2>/dev/null)
  if [ "$REMOTE" != "$LAST_HEAD" ] && [ -n "$REMOTE" ]; then
    echo "[$(date '+%H:%M:%S')] gitee 更新: $LAST_HEAD → $REMOTE"
    NEW=$(git log --oneline main..gitee/main 2>/dev/null | head -5)
    [ -n "$NEW" ] && echo "  新提交: $NEW"
    git pull gitee main --rebase 2>&1 | grep -E "error|conflict" && echo "  ⚠️ rebase 冲突——需要人工处理" 
    LAST_HEAD="$REMOTE"
    # QA-ISSUES 摘要：各 BUG 状态 + 回执非空标记
    grep -E "^## BUG|^\*\*状态|^- \[.*\] (✅|❌)" docs/QA-ISSUES.md 2>/dev/null | head -24
  fi
  sleep 120
done
