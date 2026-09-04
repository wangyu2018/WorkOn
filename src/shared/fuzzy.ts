/**
 * 模糊匹配工具（共享）：项目名/软件名/标题之间的容错匹配
 * 大小写不区分；忽略空格与标点；支持驼峰/下划线分词与编辑距离
 */

/** 归一化：小写、去空白与标点（保留中英文数字） */
export function normText(s: string): string {
  return s.toLowerCase().replace(/[\s\-_/\\.,:;'"（）()【】\[\]·。、！？?!]+/g, '')
}

/** 分词：驼峰 / 下划线 / 连字符 / 中英文边界切词，过滤单字符噪音 */
export function tokens(s: string): string[] {
  const lower = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  const raw = lower.split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/).filter(Boolean)
  const out: string[] = []
  for (const r of raw) {
    // 中英混排再切一刀（如 "workon开发" → workon + 开发）
    const parts = r.match(/[a-zA-Z0-9]+|\u4e00-\u9fa5/g) ?? [r]
    for (const part of parts) {
      if (part.length >= 2) out.push(part.toLowerCase())
    }
  }
  return out
}

/** 编辑距离（Levenshtein，滚动数组） */
export function levDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = new Array<number>(b.length + 1)
  let cur = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

/** 相似度 0~1 */
export function similarity(a: string, b: string): number {
  const x = normText(a)
  const y = normText(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const max = Math.max(x.length, y.length)
  return 1 - levDistance(x, y) / max
}

/**
 * 模糊匹配：命中任一策略即 true
 * 1) 归一化子串（双向）
 * 2) 分词交集（≥1 个长度 ≥3 的实词，或覆盖短词全部 token）
 * 3) 编辑距离相似度 ≥ threshold
 */
export function fuzzyMatch(a: string, b: string, threshold = 0.72): boolean {
  const x = normText(a)
  const y = normText(b)
  if (!x || !y) return false
  if (x.includes(y) || y.includes(x)) return true
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.length && tb.length) {
    const overlap = ta.filter((t) => tb.some((u) => u.includes(t) || t.includes(u)))
    const significant = overlap.filter((t) => t.length >= 3)
    if (significant.length > 0) return true
    if (ta.length === 1 && tb.length === 1 && overlap.length === 1) return true
  }
  return similarity(a, b) >= threshold
}

/** 在候选列表里找最相似的（>=threshold），返回相似度最高的 */
export function bestMatch<T>(query: string, candidates: T[], get: (c: T) => string, threshold = 0.72): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null
  for (const c of candidates) {
    const s = similarity(query, get(c))
    if (!best || s > best.score) best = { item: c, score: s }
    if (fuzzyMatch(query, get(c), threshold) && s >= (best?.score ?? 0)) {
      if (!best || s >= best.score) best = { item: c, score: s }
    }
  }
  if (best && (best.score >= threshold || fuzzyMatch(query, get(best.item)))) return best
  return null
}
