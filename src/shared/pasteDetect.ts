/**
 * 主窗口粘贴分拣：进展卡 / 待办列表 / 备忘
 * 规则优先，供 Ctrl+V 预览框默认选中意图
 */

export type PasteKind = 'progress' | 'todos' | 'memo'

/** 是否像项目进展回传（LLM / 进展卡 / 会话复盘） */
export function looksLikeProgressPaste(text: string): boolean {
  const q = text.trim()
  if (q.length < 60) return false
  const hits =
    (/-\s*\[[ xX]\]/.test(q) ? 1 : 0) +
    (/(进展|完成|待办|下一步|阻塞|风险|checklist|项目进展|最近进展|本会话|现状|改动)/i.test(q) ? 1 : 0) +
    (q.split(/\n/).length >= 4 ? 1 : 0) +
    (/#{1,3}\s/.test(q) ? 1 : 0) +
    (/[一二三四五六七八]、/.test(q) ? 1 : 0) +
    (/(【必须|【推荐|【可选)/.test(q) ? 1 : 0) +
    (/维度\s*[|｜]/.test(q) || /\|.+\|/.test(q) ? 1 : 0)
  return hits >= 2
}

/** 是否像待办/计划清单（含截图 OCR 后常见排版） */
export function looksLikeTodosPaste(text: string): boolean {
  const q = text.trim()
  if (!q) return false
  const lines = q.split(/\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return false
  const bulletish = lines.filter((l) =>
    /^([-*\u2022\u25CF\u25A0]|\d+[.)、]|□|☐|☑|✓|【.】|待办|计划)/.test(l) || /^-\s*\[[ xX]?\]/.test(l)
  ).length
  if (bulletish >= 2) return true
  if (lines.length >= 3 && lines.every((l) => l.length <= 40) && bulletish >= 1) return true
  if (/(今日待办|待办清单|计划表|TODO|to-?do)/i.test(q) && lines.length >= 2) return true
  return false
}

/** 默认意图：进展 > 待办 > 备忘；图片来源略偏向待办 */
export function classifyPaste(text: string, opts?: { fromImage?: boolean }): PasteKind {
  const q = text.trim()
  if (!q) return 'memo'
  if (looksLikeProgressPaste(q)) return 'progress'
  if (looksLikeTodosPaste(q)) return 'todos'
  if (opts?.fromImage && q.length >= 8) return 'todos'
  // 短文本更像随手备忘
  if (q.length <= 200 && q.split(/\n/).filter(Boolean).length <= 3) return 'memo'
  return 'memo'
}

/** 无 AI 时从文本粗提取待办标题 */
export function extractTodoTitlesHeuristic(text: string, limit = 20): string[] {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean)
  const out: string[] = []
  for (const l of lines) {
    // 聊天截图常见：保留「我/对方」两侧内容，只剥说话人前缀
    let t = l
      .replace(/^(我|自己|本人|对方|同事|客户|用户|TA|Ta|对方说|我说)\s*[：:]\s*/i, '')
      .replace(/^[-*\u2022\u25CF\u25A0]\s*/, '')
      .replace(/^\d+[.)、]\s*/, '')
      .replace(/^-\s*\[[ xX]?\]\s*/, '')
      .replace(/^[□☐☑✓]\s*/, '')
      .replace(/^(待办|计划|TODO)[：:]\s*/i, '')
      .trim()
    if (t.length < 2 || t.length > 120) continue
    if (/^(#{1,6}|---|===)/.test(t)) continue
    // 纯时间戳 / 纯昵称行跳过
    if (/^(\d{1,2}:\d{2}(:\d{2})?|\d{4}[-/]\d{1,2}[-/]\d{1,2})$/.test(t)) continue
    out.push(t)
    if (out.length >= limit) break
  }
  return [...new Set(out)]
}
