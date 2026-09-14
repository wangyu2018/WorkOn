/**
 * 从 AI 拆解文本抽出可执行步骤标题
 */
export function parseBreakdownSteps(text: string, limit = 5): string[] {
  const out: string[] = []
  for (const raw of String(text || '').split(/\n/)) {
    let t = raw.trim()
    if (!t) continue
    t = t
      .replace(/^[-*•·]\s*(?:\[[ xX]?\]\s*)?/, '')
      .replace(/^\d+[.)、]\s*/, '')
      .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '')
      .replace(/^步骤\s*\d+[:：]\s*/, '')
      .replace(/\s*[（(]?\s*\d+\s*(?:分钟|分|min|m|小时|h)\s*[）)]?\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (t.length < 2 || t.length > 72) continue
    if (/^(拆解|步骤|如下|以下|说明|预估|合计|总共|失败|未生成|粗目标|要求)/.test(t)) continue
    out.push(t)
    if (out.length >= limit) break
  }
  return [...new Set(out)]
}
