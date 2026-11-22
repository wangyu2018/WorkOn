/**
 * 本机 Chrome 连接器（架构参考 Qoder CN 的 browser-connector）
 * - Chrome 扩展连接 127.0.0.1:18794 的本地 WebSocket
 * - WorkOn 主进程通过扩展操作真实 Chrome：标签、导航、读页、点击、填表、截图
 * - 只用本机回环地址，不经过云端
 */
import { app, shell } from 'electron'
import { WebSocketServer, WebSocket } from 'ws'
import fs from 'fs'
import path from 'path'
import { sendTo } from './windows'

const PORT = 18794
const SHOT_DIR = () => path.join(app.getPath('userData'), 'browser-shots')

let wss: WebSocketServer | null = null
let socket: WebSocket | null = null
let extVersion = ''
let nextId = 1

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}
const pending = new Map<number, Pending>()

export interface ChromeConnectorStatus {
  connected: boolean
  version: string
  port: number
}

export interface ChromeTabInfo {
  id: number
  title: string
  url: string
  active: boolean
  windowId: number
  status?: string
}

export function chromeStatus(): ChromeConnectorStatus {
  return {
    connected: !!socket && socket.readyState === WebSocket.OPEN,
    version: extVersion,
    port: PORT
  }
}

function pushStatus(): void {
  sendTo('main', 'chrome:status', chromeStatus())
}

export function startChromeConnector(): void {
  if (wss) return
  try {
    wss = new WebSocketServer({ host: '127.0.0.1', port: PORT })
  } catch (e) {
    console.warn('[chrome-connector] 启动失败', (e as Error).message)
    return
  }
  wss.on('error', (e) => console.warn('[chrome-connector]', e.message))
  wss.on('connection', (ws, req) => {
    // 只接受 Chrome 扩展的连接
    const origin = String(req.headers.origin ?? '')
    if (!origin.startsWith('chrome-extension://')) {
      ws.close(1008, 'origin-not-allowed')
      return
    }
    socket?.close()
    socket = ws
    console.info('[chrome-connector] 扩展已连接')
    ws.on('message', (raw) => handleMessage(String(raw)))
    ws.on('close', () => {
      if (socket === ws) {
        socket = null
        extVersion = ''
        console.info('[chrome-connector] 扩展已断开')
        pushStatus()
      }
    })
  })
  console.info(`[chrome-connector] 本地桥接就绪 127.0.0.1:${PORT}`)
}

function handleMessage(raw: string): void {
  let msg: {
    type?: string
    id?: number
    ok?: boolean
    result?: unknown
    error?: string
    version?: string
  }
  try {
    msg = JSON.parse(raw) as typeof msg
  } catch {
    return
  }
  if (msg?.type === 'hello') {
    extVersion = String(msg.version ?? '')
    pushStatus()
    return
  }
  if (typeof msg?.id !== 'number') return
  const p = pending.get(msg.id)
  if (!p) return
  pending.delete(msg.id)
  clearTimeout(p.timer)
  if (msg.ok) p.resolve(msg.result)
  else p.reject(new Error(String(msg.error ?? '扩展执行失败')))
}

export function chromeRequest<T>(action: string, params?: Record<string, unknown>, timeoutMs = 20000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error('本机 Chrome 未连接：请安装/启用 WorkOn 浏览器连接器'))
      return
    }
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Chrome 扩展超时（${Math.round(timeoutMs / 1000)}s）`))
    }, timeoutMs)
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
    socket.send(JSON.stringify({ id, action, params: params ?? {} }))
  })
}

export function chromeTabs(): Promise<ChromeTabInfo[]> {
  return chromeRequest<ChromeTabInfo[]>('tabs.list')
}

export function chromeActiveTab(): Promise<ChromeTabInfo> {
  return chromeRequest<ChromeTabInfo>('state')
}

export function chromeOpen(url: string): Promise<ChromeTabInfo> {
  return chromeRequest<ChromeTabInfo>('tabs.open', { url })
}

export function chromeActivate(tabId: number): Promise<ChromeTabInfo | null> {
  return chromeRequest<ChromeTabInfo | null>('tabs.activate', { tabId })
}

export function chromeNavigate(url: string, tabId?: number): Promise<{ ok: boolean }> {
  return chromeRequest<{ ok: boolean }>('page.navigate', { url, tabId })
}

export function chromeBack(tabId?: number): Promise<{ ok: boolean }> {
  return chromeRequest<{ ok: boolean }>('page.back', { tabId })
}

export function chromeForward(tabId?: number): Promise<{ ok: boolean }> {
  return chromeRequest<{ ok: boolean }>('page.forward', { tabId })
}

export function chromeReload(tabId?: number): Promise<{ ok: boolean }> {
  return chromeRequest<{ ok: boolean }>('page.reload', { tabId })
}

export interface ChromeReadResult {
  title: string
  url: string
  text: string
  items: { tag: string; text: string; selector: string }[]
}

export interface ChromeInspectResult {
  title: string
  url: string
  readyState: string
  textLen: number
  images: { total: number; broken: { src: string; alt: string }[] }
  links: number
  buttons: number
  forms: number
  inputs: { tag: string; type: string; name: string; placeholder: string; required: boolean; hasLabel: boolean }[]
  headings: { tag: string; text: string }[]
  overflowX: boolean
  errorTexts: string[]
  alerts: string[]
  consoleErrors: { kind: string; message: string; source?: string; ts?: number }[]
}

export function chromeRead(tabId?: number): Promise<ChromeReadResult> {
  return chromeRequest<ChromeReadResult>('page.read', { tabId })
}

export function chromeInspect(tabId?: number): Promise<ChromeInspectResult> {
  return chromeRequest<ChromeInspectResult>('page.inspect', { tabId }, 30000)
}

export function chromeClick(target: string, tabId?: number): Promise<{ ok: boolean; detail?: string; error?: string }> {
  return chromeRequest('page.click', { target, tabId })
}

export function chromeFill(selector: string, text: string, tabId?: number): Promise<{ ok: boolean; detail?: string; error?: string }> {
  return chromeRequest('page.fill', { selector, text, tabId })
}

export async function chromeScreenshot(tabId?: number): Promise<{ ok: boolean; dataUrl?: string; path?: string; error?: string }> {
  try {
    const res = await chromeRequest<{ dataUrl: string }>('page.screenshot', { tabId }, 30000)
    if (!res?.dataUrl) return { ok: false, error: '截图失败' }
    fs.mkdirSync(SHOT_DIR(), { recursive: true })
    const file = path.join(SHOT_DIR(), 'chrome-latest.png')
    fs.writeFileSync(file, Buffer.from(res.dataUrl.split(',')[1] ?? '', 'base64'))
    return { ok: true, dataUrl: res.dataUrl, path: file }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 扩展目录：开发态在仓库根，打包后在 resources */
export function chromeExtensionDir(): string {
  const candidates = [
    path.join(app.getAppPath(), 'browser-extension'),
    path.join(process.resourcesPath ?? '', 'browser-extension')
  ]
  return candidates.find((p) => p && fs.existsSync(path.join(p, 'manifest.json'))) ?? candidates[0]
}

export async function chromeOpenExtensionFolder(): Promise<{ ok: boolean; path: string; error?: string }> {
  const dir = chromeExtensionDir()
  if (!fs.existsSync(dir)) return { ok: false, path: dir, error: '扩展目录不存在' }
  const error = await shell.openPath(dir)
  return { ok: !error, path: dir, error: error || undefined }
}
