/**
 * 沙箱可视化拆件（v10，OpenIntelligentUI 模式本地化）：
 * AI（llmChat）生成轻量 HTML/CSS 可视化 → 会话级沙箱块 → 隔离 iframe 渲染。
 * 安全模型（同 OIUI）：iframe sandbox="allow-scripts"（无 same-origin——
 * 沙箱内无 cookie/localStorage/DOM 访问）；与宿主通信仅限 postMessage 白名单协议。
 */
import { llmChat, extractJson } from './ai'
import { getSettings } from './settings'
import { genId } from '@shared/types'

export interface SandboxPiece {
  id: string
  html: string
  css: string
  title: string
}

const SYSTEM_RULES = `你是 WorkOn 的可视化生成器。输出一个 JSON：{"title":"不超过10字","html":"主体结构","css":"样式"}。
要求：
- html 里只写一个根元素 <div class="viz">…</div>，展示用户要的可视化（图表用纯 div/CSS 条形、SVG、或简单交互按钮）
- css 写 .viz 及其子元素样式；配色用米白底 #F7F4EE、墨色 #2B2B28、青 #0FB5A4、琥珀 #D98E2B；字体 sans-serif；尺寸自适应容器宽
- 如需交互，按钮用 <button data-ask="要点名的追问">文案</button>——点击会通知宿主把追问送进对话
- 禁止 <script> 标签、禁止外部资源、禁止 iframe
- 只输出 JSON 本体`

/** AI 生成沙箱块；未配 Key/失败返回 null（调用方回退引导） */
export async function generateSandbox(srcText: string, ask?: string): Promise<SandboxPiece | null> {
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) return null
  const user = `基于下面的内容做一个轻量可视化展示：\n"""\n${srcText.slice(0, 1200)}\n"""\n${ask ? `侧重：${ask}` : ''}`
  const out = await llmChat(
    [
      { role: 'system', content: SYSTEM_RULES },
      { role: 'user', content: user }
    ],
    60_000,
    'standard'
  )
  if (!out) return null
  const parsed = extractJson(out) as { title?: string; html?: string; css?: string } | null
  if (!parsed?.html) return null
  return {
    id: genId('sb'),
    title: (parsed.title ?? '可视化').slice(0, 12),
    html: parsed.html,
    css: parsed.css ?? ''
  }
}
