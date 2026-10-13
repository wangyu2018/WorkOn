/**
 * 消息监控（v10 signals·消息信号，隐私红线内）：
 * IM 应用（微信/企业微信/QQ/钉钉/飞书）标题未读数上升 → 截屏 OCR →
 * 来件内容广播到 v10 对话流（jev-route 提议通道的前置感知层）。
 *
 * 隐私红线（SIGNALS-ARCHITECTURE 同源）：
 * - 默认关闭（messageWatchEnabled=false），用户显式开启才工作
 * - 只监控白名单 IM 的「未读数变化」信号，不是持续读屏
 * - OCR 文本只进本地对话流，绝不出网
 */
import { getSettings } from './settings'
import { presence } from './presence'
import { recognizePngBuffer } from './ocrEngine'
import { desktopCapturer } from 'electron'
import { sendTo } from './windows'

const IM_PATTERNS: Array<{ match: RegExp; label: string }> = [
  { match: /^(微信|WeChat)/i, label: '微信' },
  { match: /^(企业微信|WeCom)/i, label: '企业微信' },
  { match: /^(QQ)/i, label: 'QQ' },
  { match: /^(钉钉|DingTalk)/i, label: '钉钉' },
  { match: /^(飞书|Lark)/i, label: '飞书' }
]
/** 标题未读数：「微信(3)」「企业微信(12)」 */
const UNREAD_RE = /[(（]\s*(\d+)\s*[)）]/

let timer: NodeJS.Timeout | null = null
const lastUnread = new Map<string, number>()
const lastOcrAt = new Map<string, number>()
const THROTTLE_MS = 90_000

type IncomingHandler = (p: { app: string; unread: number; text: string; ts: number }) => void
let handler: IncomingHandler | null = null
type HintHandler = (app: string) => void
let hintHandler: HintHandler | null = null
let hinted = false // 每次启动只提示一次（可接管消息）

export function initMessageWatch(onIncoming: IncomingHandler, onHint?: HintHandler): void {
  handler = onIncoming
  hintHandler = onHint ?? null
}

export function startMessageWatch(): void {
  if (timer) return
  timer = setInterval(poll, 8_000)
  console.info('[messageWatch] 已启动（IM 未读数信号）')
}

export function stopMessageWatch(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

async function poll(): Promise<void> {
  const s = getSettings()
  const snap = presence.getSnapshot()
  // 可接管提示（一次性）：检测到 IM 前台但监控未开 → 告诉用户能力存在（不擅自开）
  if (!s.messageWatchEnabled && !hinted && hintHandler) {
    const imFront = (snap.screens ?? []).some((sc) => IM_PATTERNS.some((p) => p.match.test(sc.app ?? '')))
    if (imFront) {
      hinted = true
      hintHandler((snap.screens ?? []).find((sc) => IM_PATTERNS.some((p) => p.match.test(sc.app ?? '')))!.app)
    }
  }
  if (!s.messageWatchEnabled) return
  for (const sc of snap.screens ?? []) {
    const app = sc.app ?? ''
    const pat = IM_PATTERNS.find((p) => p.match.test(app))
    if (!pat) continue
    const m = UNREAD_RE.exec(sc.title ?? '')
    if (!m) continue
    const unread = parseInt(m[1], 10)
    const prev = lastUnread.get(app)
    lastUnread.set(app, unread)
    if (prev === undefined || unread <= prev) continue
    // 未读上升：节流后触发截屏 OCR
    const last = lastOcrAt.get(app) ?? 0
    if (Date.now() - last < THROTTLE_MS) continue
    lastOcrAt.set(app, Date.now())
    console.info(`[messageWatch] ${pat.label} 未读 ${prev}→${unread}，截屏识别`)
    void captureAndRecognize(pat.label)
      .then((text) => {
        if (!text) return
        handler?.({ app: pat.label, unread, text, ts: Date.now() })
      })
      .catch(() => { /* OCR 失败静默 */ })
  }
}

async function captureAndRecognize(source: string): Promise<string | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 }
    })
    if (!sources.length) return null
    const png = sources[0].thumbnail.toPNG()
    const r = await recognizePngBuffer(png)
    if (r.error || !r.lines?.length) return null
    // 清洗：取后半（消息区通常在下半屏），过滤系统 UI 词
    const lines = r.lines.filter((l) => l.trim().length > 1)
    const tail = lines.slice(-12).join('\n')
    return tail || null
  } catch (e) {
    console.warn('[messageWatch] 截屏识别失败', e)
    return null
  }
}
