/**
 * 消息中心 v2（v10 signals·消息信号）：
 * L1 未读信号（标题多格式）→ L2 窗口级捕获 OCR（只认 IM 窗口内容）→
 * L3 Windows UIA 读消息列表（失败/非 Windows 回落 OCR）。
 *
 * 隐私红线：默认关（messageWatchEnabled）；只监控白名单 IM；文本只进本地对话流。
 * payload 增强：{ app, label, unread, via, text, messages:[{sender?,text}], ts }
 */
import { desktopCapturer } from 'electron'
import { getSettings } from './settings'
import { presence } from './presence'
import { recognizePngBuffer } from './ocrEngine'
import { sendTo } from './windows'

export interface IncomingMessageItem {
  sender?: string
  text: string
}
export interface IncomingPayload {
  app: string
  label: string
  unread: number
  via: 'uia' | 'ocr'
  text: string
  messages: IncomingMessageItem[]
  ts: number
}

/** IM 识别表（可扩展） */
export const IM_PATTERNS: Array<{ match: RegExp; label: string }> = [
  { match: /^(微信|WeChat)/i, label: '微信' },
  { match: /^(企业微信|WeCom)/i, label: '企业微信' },
  { match: /^QQ/i, label: 'QQ' },
  { match: /^(钉钉|DingTalk)/i, label: '钉钉' },
  { match: /^(飞书|Lark)/i, label: '飞书' },
  { match: /^Telegram/i, label: 'Telegram' },
  { match: /^(Outlook|网易邮箱大师)/i, label: '邮箱' }
]

/** L1：标题未读数——多格式放宽：(3) 【3】 [3] 「3」 ·3 */
const UNREAD_RES = [
  /[(（]\s*(\d+)\s*[)）]/,
  /[【\[]\s*(\d+)\s*[】\]]/,
  /[「『]\s*(\d+)\s*[」』]/,
  /·\s*(\d+)\s*$/
]

export function detectUnread(title: string): number | null {
  for (const re of UNREAD_RES) {
    const m = re.exec(title ?? '')
    if (m) return parseInt(m[1], 10)
  }
  return null
}

/** OCR 文本清洗+消息切分（L2 增强）：滤时间/系统行，启发发送者 */
export function splitOcrMessages(lines: string[]): IncomingMessageItem[] {
  const SYS_RE = /^(微信|WeChat|QQ|钉钉|飞书|企业微信|拍一拍|撤回了一条消息|重新编辑|\d{1,2}:\d{2}|昨天|星期)/
  const out: IncomingMessageItem[] = []
  for (const raw of lines) {
    const line = raw.replace(SYS_RE, '').trim()
    if (line.length < 2) continue
    const sm = /^([^:：]{1,12})\s*[:：]\s*(.+)$/.exec(line)
    if (sm) out.push({ sender: sm[1], text: sm[2] })
    else out.push({ text: line })
    if (out.length >= 8) break
  }
  return out
}

let timer: NodeJS.Timeout | null = null
const lastUnread = new Map<string, number>()
const lastCaptureAt = new Map<string, number>()
const THROTTLE_MS = 90_000

type IncomingHandler = (p: IncomingPayload) => void
let handler: IncomingHandler | null = null
/** 查询式 ring buffer（BUG-30）：最近来件存一份，「微信消息」问句可查 */
const recentRing: IncomingPayload[] = []
const RING_MAX = 20
type HintHandler = (app: string) => void
let hintHandler: HintHandler | null = null
let hinted = false

export function initMessageWatch(onIncoming: IncomingHandler, onHint?: HintHandler): void {
  handler = onIncoming
  hintHandler = onHint ?? null
}

export function startMessageWatch(): void {
  if (timer) return
  timer = setInterval(poll, 8_000)
  console.info('[messageWatch] 已启动（L1 未读 → L2 窗口 OCR → L3 UIA）')
}

/** 查询式：最近来件（BUG-30，「微信消息」问句用） */
export function recentIncoming(): IncomingPayload[] {
  return recentRing.slice()
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
  // 可接管提示（一次性）：IM 前台但监控未开
  if (!s.messageWatchEnabled && !hinted && hintHandler) {
    const imScreen = (snap.screens ?? []).find((sc) => IM_PATTERNS.some((p) => p.match.test(sc.app ?? '')))
    if (imScreen) {
      hinted = true
      const label = IM_PATTERNS.find((p) => p.match.test(imScreen.app ?? ''))?.label ?? imScreen.app
      hintHandler(label)
    }
  }
  if (!s.messageWatchEnabled) return
  for (const sc of snap.screens ?? []) {
    const app = sc.app ?? ''
    const pat = IM_PATTERNS.find((p) => p.match.test(app))
    if (!pat) continue
    const unread = detectUnread(sc.title ?? '')
    if (unread === null) continue
    const prev = lastUnread.get(app)
    lastUnread.set(app, unread)
    if (prev === undefined || unread <= prev) continue
    const last = lastCaptureAt.get(app) ?? 0
    if (Date.now() - last < THROTTLE_MS) continue
    lastCaptureAt.set(app, Date.now())
    console.info(`[messageWatch] ${pat.label} 未读 ${prev}→${unread}，采集中`)
    void captureIncoming(pat.label, app, unread)
      .then((payload) => {
        if (!payload) return
        recentRing.unshift(payload)
        if (recentRing.length > RING_MAX) recentRing.pop()
        handler?.(payload)
      })
      .catch(() => { /* ignore */ })
  }
}

/** L2：窗口级捕获（title 匹配 IM 窗口，非全屏）→ OCR → 切分 */
async function captureIncoming(label: string, app: string, unread: number): Promise<IncomingPayload | null> {
  let via: 'uia' | 'ocr' = 'ocr'
  let text = ''
  let messages: IncomingMessageItem[] = []

  // L3 尝试（Windows）：UIA 读 IM 窗口文本叶子（微信3.x/QQ 可读性好）
  if (process.platform === 'win32') {
    try {
      const { readIMWindowText } = (await import('./uiaMessages')) as typeof import('./uiaMessages')
      const uia = await readIMWindowText(app)
      if (uia && uia.length) {
        via = 'uia'
        messages = uia
        text = uia.map((m) => (m.sender ? `${m.sender}：${m.text}` : m.text)).join('\n')
      }
    } catch { /* UIA 失败回落 OCR */ }
  }

  // L2 回落：窗口捕获 + OCR
  if (!messages.length) {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1600, height: 1200 },
      fetchWindowIcons: false
    })
    const win = sources.find((w) => {
      const t = (w.name ?? '').toLowerCase()
      return t.includes(label.toLowerCase()) || t.includes(app.toLowerCase())
    })
    if (!win) return null
    const png = win.thumbnail.toPNG()
    const r = await recognizePngBuffer(png)
    if (r.error || !r.lines?.length) return null
    messages = splitOcrMessages(r.lines)
    text = r.lines.slice(-14).join('\n')
  }

  if (!text) return null
  return { app, label, unread, via, text, messages, ts: Date.now() }
}
