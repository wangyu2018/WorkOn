/**
 * 应用内浏览器（参考 Qoder 海外版的内置浏览器形态）
 * - 浏览器由渲染层 <webview> 承载，主进程通过 guest webContents 操作页面
 * - Agent / 工作流可以直接：导航、读正文、点击、填表、截图
 * - 独立 partition（persist:workon-browser）保留登录态
 */
import { app, shell, webContents } from 'electron'
import type { WebContents } from 'electron'
import fs from 'fs'
import path from 'path'
import { sendTo } from './windows'
import {
  chromeNavigate, chromeBack, chromeForward, chromeReload, chromeActiveTab,
  chromeRead, chromeClick, chromeFill, chromeScreenshot, chromeInspect
} from './chromeConnector'

export type BrowserMode = 'embedded' | 'chrome'

let mode: BrowserMode = 'embedded'

export function setBrowserMode(next: string): BrowserMode {
  mode = next === 'chrome' ? 'chrome' : 'embedded'
  return mode
}

export function getBrowserMode(): BrowserMode {
  return mode
}

export interface BrowserState {
  attached: boolean
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserReadResult {
  ok: boolean
  title?: string
  url?: string
  text?: string
  items?: { tag: string; text: string; selector: string }[]
  error?: string
}

export interface PageInspectResult {
  ok: boolean
  title?: string
  url?: string
  readyState?: string
  textLen?: number
  images?: { total: number; broken: { src: string; alt: string }[] }
  links?: number
  buttons?: number
  forms?: number
  inputs?: { tag: string; type: string; name: string; placeholder: string; required: boolean; hasLabel: boolean }[]
  headings?: { tag: string; text: string }[]
  overflowX?: boolean
  errorTexts?: string[]
  alerts?: string[]
  consoleErrors?: { kind: string; message: string; source?: string; ts?: number }[]
  error?: string
}

export interface BrowserActionResult {
  ok: boolean
  detail?: string
  error?: string
}

let guestId: number | null = null
const prepared = new Set<number>()
const waiters: ((ok: boolean) => void)[] = []

/**
 * 保证内置浏览器已挂载：没挂载就通知渲染层打开右侧栏并切到「浏览器」标签，
 * 等 guest 回传（Agent 直接说“打开某网页”时也能自动就位）
 */
export function ensureBrowserGuest(): Promise<boolean> {
  if (guest()) return Promise.resolve(true)
  sendTo('main', 'browser:ensure')
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), 5000)
    waiters.push(finish)
  })
}

function guest(): WebContents | null {
  if (guestId === null) return null
  const wc = webContents.fromId(guestId)
  if (!wc || wc.isDestroyed()) {
    guestId = null
    return null
  }
  return wc
}

/** 地址归一化：域名补协议、空格走搜索；只允许 http(s) / about:blank */
export function normalizeUrl(raw: string): string | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (/^(javascript|data|file|blob):/i.test(text)) return null
  if (/^https?:\/\//i.test(text)) return text
  if (/^about:blank$/i.test(text)) return text
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`
  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`
  return `https://www.bing.com/search?q=${encodeURIComponent(text)}`
}

export function attachBrowserGuest(id: number): { ok: boolean } {
  const wc = webContents.fromId(Number(id))
  if (!wc || wc.isDestroyed()) return { ok: false }
  guestId = Number(id)
  if (!prepared.has(guestId)) {
    prepared.add(guestId)
    // 截图 / 后台读取时保持渲染，避免隐藏侧栏后 capturePage 挂起
    wc.setBackgroundThrottling(false)
    // 站内新窗口在本视图打开；mailto 等交给系统
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        void wc.loadURL(url)
        return { action: 'deny' }
      }
      if (/^mailto:/i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    // 只允许 http(s) / about:blank，避免 file:// 读本机文件
    wc.on('will-navigate', (e, url) => {
      if (!/^(https?|about):/i.test(url)) e.preventDefault()
    })
    wc.on('destroyed', () => {
      if (guestId !== null && !webContents.fromId(guestId)) guestId = null
    })
  }
  while (waiters.length) waiters.shift()?.(true)
  return { ok: true }
}

export function detachBrowserGuest(): void {
  guestId = null
}

export async function browserNavigate(raw: string): Promise<BrowserActionResult> {
  const url = normalizeUrl(raw)
  if (!url) return { ok: false, error: '地址无效：只支持 http / https' }
  if (mode === 'chrome') {
    try {
      await chromeNavigate(url)
      return { ok: true, detail: url }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  if (!guest() && !(await ensureBrowserGuest())) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  const wc = guest()
  if (!wc) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  try {
    await wc.loadURL(url)
    return { ok: true, detail: url }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function browserBack(): Promise<BrowserActionResult> {
  if (mode === 'chrome') {
    try {
      await chromeBack()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  const wc = guest()
  if (!wc) return { ok: false, error: '浏览器还没打开' }
  if (!wc.navigationHistory.canGoBack()) return { ok: false, error: '已经在第一页' }
  wc.navigationHistory.goBack()
  return { ok: true }
}

export async function browserForward(): Promise<BrowserActionResult> {
  if (mode === 'chrome') {
    try {
      await chromeForward()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  const wc = guest()
  if (!wc) return { ok: false, error: '浏览器还没打开' }
  if (!wc.navigationHistory.canGoForward()) return { ok: false, error: '已经在最后一页' }
  wc.navigationHistory.goForward()
  return { ok: true }
}

export async function browserReload(): Promise<BrowserActionResult> {
  if (mode === 'chrome') {
    try {
      await chromeReload()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  const wc = guest()
  if (!wc) return { ok: false, error: '浏览器还没打开' }
  wc.reload()
  return { ok: true }
}

export async function browserState(): Promise<BrowserState> {
  if (mode === 'chrome') {
    try {
      const tab = await chromeActiveTab()
      return {
        attached: true,
        url: tab?.url ?? '',
        title: tab?.title ?? '',
        loading: tab?.status === 'loading',
        canGoBack: false,
        canGoForward: false
      }
    } catch {
      return { attached: false, url: '', title: '', loading: false, canGoBack: false, canGoForward: false }
    }
  }
  const wc = guest()
  if (!wc) return { attached: false, url: '', title: '', loading: false, canGoBack: false, canGoForward: false }
  return {
    attached: true,
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward()
  }
}

/** 页面读取脚本：正文 + 可交互元素（带稳定选择器），供模型决策 */
const READ_SCRIPT = `(() => {
  const sel = (el) => {
    if (!el || el.nodeType !== 1) return ''
    if (el.id) return '#' + CSS.escape(el.id)
    const parts = []
    let n = el
    while (n && n.nodeType === 1 && parts.length < 4) {
      let s = n.tagName.toLowerCase()
      if (typeof n.className === 'string' && n.className.trim()) {
        const c = n.className.trim().split(/\\s+/).slice(0, 2).map((x) => '.' + CSS.escape(x)).join('')
        if (c) s += c
      }
      const p = n.parentElement
      if (p) {
        const idx = Array.from(p.children).indexOf(n) + 1
        s += ':nth-child(' + idx + ')'
      }
      parts.unshift(s)
      n = p
    }
    return parts.join(' > ')
  }
  const body = document.body ? document.body.innerText || '' : ''
  const items = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"]'))
    .filter((el) => el.offsetParent !== null)
    .slice(0, 80)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: String(el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      selector: sel(el)
    }))
    .filter((x) => x.text)
  return {
    title: document.title,
    url: location.href,
    text: body.replace(/\\n{3,}/g, '\\n\\n').slice(0, 20000),
    items
  }
})()`

export async function browserRead(): Promise<BrowserReadResult> {
  if (mode === 'chrome') {
    try {
      const r = await chromeRead()
      return { ok: true, title: r.title, url: r.url, text: r.text, items: r.items }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  if (!guest() && !(await ensureBrowserGuest())) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  const wc = guest()
  if (!wc) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  try {
    const data = (await wc.executeJavaScript(READ_SCRIPT, true)) as {
      title: string
      url: string
      text: string
      items: { tag: string; text: string; selector: string }[]
    }
    return { ok: true, ...data }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 页面巡检脚本（内置浏览器版；console 错误由 Chrome 扩展的 MAIN world 采集，这里为空） */
const INSPECT_SCRIPT = `(() => {
  const visible = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const images = Array.from(document.images)
  const broken = images
    .filter((img) => img.complete && img.naturalWidth === 0 && visible(img))
    .slice(0, 20)
    .map((img) => ({ src: String(img.currentSrc || img.src || '').slice(0, 300), alt: img.alt || '' }))
  const inputs = Array.from(document.querySelectorAll('input,textarea,select'))
    .filter(visible)
    .slice(0, 60)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      name: el.getAttribute('name') || '',
      placeholder: el.getAttribute('placeholder') || '',
      required: el.hasAttribute('required'),
      hasLabel: !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') ||
        (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label'))
    }))
  const body = document.body ? document.body.innerText || '' : ''
  const suspicious = /(404|500|not found|internal server error|系统错误|服务异常|网络异常|加载失败|出错了|无权限|forbidden)/i
  const errorTexts = body
    .split('\\n')
    .map((s) => s.replace(/\\s+/g, ' ').trim())
    .filter((s) => s && s.length <= 120 && suspicious.test(s))
    .slice(0, 10)
  const alerts = Array.from(document.querySelectorAll('[role="alert"],[aria-live="assertive"]'))
    .filter(visible)
    .slice(0, 10)
    .map((el) => String(el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120))
    .filter(Boolean)
  return {
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    textLen: body.replace(/\\s+/g, ' ').trim().length,
    images: { total: images.length, broken },
    links: document.querySelectorAll('a[href]').length,
    buttons: document.querySelectorAll('button,[role="button"],input[type="submit"]').length,
    forms: document.querySelectorAll('form').length,
    inputs,
    headings: Array.from(document.querySelectorAll('h1,h2')).slice(0, 10).map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: String(el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
    })),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
    errorTexts,
    alerts,
    consoleErrors: []
  }
})()`

/** 页面巡检（双模式）：结构指标 + 错误文本/控制台错误，供测试引擎生成问题清单 */
export async function browserInspect(): Promise<PageInspectResult> {
  if (mode === 'chrome') {
    try {
      const r = await chromeInspect()
      return { ok: true, ...r }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  if (!guest() && !(await ensureBrowserGuest())) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  const wc = guest()
  if (!wc) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  try {
    const start = Date.now()
    while (wc.isLoading() && Date.now() - start < 10000) await new Promise((r) => setTimeout(r, 250))
    const data = (await wc.executeJavaScript(INSPECT_SCRIPT, true)) as Omit<PageInspectResult, 'ok'>
    return { ok: true, ...data }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

const CLICK_SCRIPT = (target: string) => `(() => {
  const raw = ${JSON.stringify(target)}
  const css = raw.trim()
  let el = null
  try {
    if (/^[#.[]/.test(css) || css.includes('>') || css.includes(':nth')) el = document.querySelector(css)
  } catch {}
  if (!el) {
    const nodes = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],summary,label'))
    el = nodes.find((n) => {
      const t = String(n.innerText || n.value || n.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim()
      return t && (t === raw || t.includes(raw))
    }) || null
  }
  if (!el) return { ok: false, error: '没找到可点击元素：' + raw }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  el.click()
  return { ok: true, detail: (el.tagName || '').toLowerCase() + ' · ' + String(el.innerText || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 60) }
})()`

export async function browserClick(target: string): Promise<BrowserActionResult> {
  if (mode === 'chrome') {
    try {
      return await chromeClick(String(target ?? ''))
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  if (!guest() && !(await ensureBrowserGuest())) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  const wc = guest()
  if (!wc) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  if (!String(target ?? '').trim()) return { ok: false, error: '点击目标为空' }
  try {
    return (await wc.executeJavaScript(CLICK_SCRIPT(String(target)), true)) as BrowserActionResult
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

const FILL_SCRIPT = (selector: string, text: string) => `(() => {
  const selector = ${JSON.stringify(selector)}
  const value = ${JSON.stringify(text)}
  let el
  try { el = document.querySelector(selector) } catch { return { ok: false, error: '选择器无效：' + selector } }
  if (!el) return { ok: false, error: '没找到输入框：' + selector }
  el.scrollIntoView({ block: 'center' })
  el.focus()
  try {
    if (el.isContentEditable) {
      const range = document.createRange()
      range.selectNodeContents(el)
      const selection = window.getSelection()
      if (selection) { selection.removeAllRanges(); selection.addRange(range) }
      let done = false
      try { done = document.execCommand('insertText', false, value) } catch { done = false }
      if (!done) el.textContent = value
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      const got = String(el.innerText || el.textContent || '')
      return got.includes(value)
        ? { ok: true, detail: '已填写富文本 ' + selector }
        : { ok: false, error: '富文本写入未生效：' + selector }
    }
    if (el.tagName === 'SELECT') {
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return el.value === value
        ? { ok: true, detail: '已选择 ' + selector }
        : { ok: false, error: '选项不存在：' + value }
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')
    if (!setter || !setter.set) return { ok: false, error: '目标不可输入：' + selector }
    setter.set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return el.value === value
      ? { ok: true, detail: '已填写 ' + selector }
      : { ok: false, error: '写入未生效：' + selector }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})()`

export async function browserFill(selector: string, text: string): Promise<BrowserActionResult> {
  if (mode === 'chrome') {
    try {
      return await chromeFill(String(selector ?? ''), String(text ?? ''))
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  if (!guest() && !(await ensureBrowserGuest())) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  const wc = guest()
  if (!wc) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  if (!String(selector ?? '').trim()) return { ok: false, error: '选择器为空' }
  try {
    return (await wc.executeJavaScript(FILL_SCRIPT(String(selector), String(text ?? '')), true)) as BrowserActionResult
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/* ---------- 网页问答（DeepSeek / 豆包 / Qwen）：自动提问并等待回答 ---------- */

export type BrowserAskSite = 'deepseek' | 'doubao' | 'qwen' | 'chatglm' | 'wenxin' | 'yuanbao' | 'kimi' | 'custom'

export interface BrowserAskInput {
  site?: BrowserAskSite
  url?: string
  question: string
  answerSelector?: string
  timeoutMs?: number
}

export interface BrowserAskResult {
  ok: boolean
  answer?: string
  title?: string
  url?: string
  waitedMs?: number
  error?: string
}

interface AskPageState {
  editor: boolean
  login: boolean
  title: string
  url: string
}

interface AskSnapshot {
  count: number
  texts: string[]
  last: string
  streaming: boolean
  url: string
  title: string
}

const ASK_SITE_URLS: Record<Exclude<BrowserAskSite, 'custom'>, string> = {
  deepseek: 'https://chat.deepseek.com/',
  doubao: 'https://www.doubao.com/chat/',
  qwen: 'https://chat.qwen.ai/',
  chatglm: 'https://chatglm.cn/',
  wenxin: 'https://yiyan.baidu.com/',
  yuanbao: 'https://yuanbao.tencent.com/chat/',
  kimi: 'https://www.kimi.com/'
}

const ASK_SITE_LABELS: Record<Exclude<BrowserAskSite, 'custom'>, string> = {
  deepseek: 'DeepSeek',
  doubao: '豆包',
  qwen: 'Qwen',
  chatglm: '智谱清言',
  wenxin: '文心一言',
  yuanbao: '腾讯元宝',
  kimi: 'Kimi'
}

/** 页面脚本共用：元素可见判定 */
const ASK_VISIBLE = `const visible = (el) => {
  if (!el) return false
  const r = el.getBoundingClientRect()
  const s = getComputedStyle(el)
  return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none'
}`

const ASK_FIND_SCRIPT = `(() => {
  ${ASK_VISIBLE}
  const editors = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')).filter(visible)
  const el = editors[editors.length - 1] || null
  const body = document.body ? String(document.body.innerText || '') : ''
  const login = /扫码登录|登录后|登录\\s*\\/\\s*注册|手机号登录|立即登录|sign in|log in/i.test(body.slice(0, 5000))
  return { editor: !!el, login, title: document.title, url: location.href }
})()`

const askFillScript = (text: string): string => `(() => {
  ${ASK_VISIBLE}
  const editors = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')).filter(visible)
  const el = editors[editors.length - 1]
  if (!el) return { ok: false, error: '没有找到对话输入框' }
  const value = ${JSON.stringify(text)}
  el.scrollIntoView({ block: 'center' })
  el.focus()
  if (el.isContentEditable) {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()
    if (selection) { selection.removeAllRanges(); selection.addRange(range) }
    let done = false
    try { done = document.execCommand('insertText', false, value) } catch { done = false }
    if (!done) el.textContent = value
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
  } else {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')
    if (setter && setter.set) setter.set.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return { ok: true, chars: value.length }
})()`

const ASK_SEND_SCRIPT = `(() => {
  ${ASK_VISIBLE}
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible)
  const send = buttons.find((b) => {
    const btn = b
    const label = String((btn.getAttribute('aria-label') || '') + ' ' + (btn.innerText || btn.textContent || '')).replace(/\\s+/g, ' ').trim()
    const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true'
    return !disabled && /发送|send|提交/i.test(label)
  })
  if (send) { send.click(); return { ok: true, sentBy: 'button' } }
  const editors = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')).filter(visible)
  const el = editors[editors.length - 1]
  if (!el) return { ok: false, error: '没有找到对话输入框' }
  el.focus()
  for (const type of ['keydown', 'keypress', 'keyup']) {
    el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
  }
  return { ok: true, sentBy: 'enter' }
})()`

const askSnapshotScript = (selector: string): string => `(() => {
  ${ASK_VISIBLE}
  const custom = ${JSON.stringify(selector)}
  const selectors = custom ? [custom] : ['.ds-markdown', '.md-box-root', '.flow-markdown-body', '.markdown-body', '[class*="markdown"]', '[data-message-author-role="assistant"]']
  const suggestSelector = '[class*="follow-up"],[class*="suggest"],[class*="related"],[class*="recommend"],[class*="guess"]'
  let texts = []
  for (const s of selectors) {
    let found = []
    try { found = Array.from(document.querySelectorAll(s)).filter(visible) } catch { found = [] }
    // 追问建议 / 相关推荐不是主回答（如文心一言的 follow-up 块），默认站点下排除
    const kept = custom ? found : found.filter((el) => !el.closest(suggestSelector))
    // 同一段回答常有外层 + 内层 markdown 容器（如文心一言外层还带搜索摘要），只取最内层
    const leaves = kept.filter((el) => !kept.some((other) => other !== el && el.contains(other)))
    const seen = new Set()
    for (const el of leaves) {
      const text = String(el.innerText || '').trim()
      if (text && !seen.has(text)) { seen.add(text); texts.push(text) }
    }
    if (texts.length) break
  }
  const streaming = Array.from(document.querySelectorAll('button, [role="button"]')).some((el) => {
    if (!visible(el)) return false
    const label = String((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).trim()
    return /停止生成|停止回答|stop generating|^stop$/i.test(label)
  })
  return { count: texts.length, texts, last: texts[texts.length - 1] || '', streaming, url: location.href, title: document.title }
})()`

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 在内置浏览器里向网页版 AI（DeepSeek / 豆包 / Qwen）提一个问题并取回回答。
 * 依赖持久登录态：首次需用户手动登录，之后复用同一 partition。
 */
export async function browserAsk(input: BrowserAskInput): Promise<BrowserAskResult> {
  const question = String(input.question ?? '').trim()
  if (!question) return { ok: false, error: '提问内容为空' }
  if (mode === 'chrome') {
    return { ok: false, error: '网页问答目前仅支持内置浏览器；请切换到内置浏览器再运行' }
  }
  const site = input.site && input.site !== 'custom' ? input.site : null
  const rawUrl = String(input.url ?? '').trim() || (site ? ASK_SITE_URLS[site] : '')
  const url = normalizeUrl(rawUrl)
  if (!url) return { ok: false, error: '未指定问答站点或网址' }
  if (!guest() && !(await ensureBrowserGuest())) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  const wc = guest()
  if (!wc) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  const started = Date.now()
  const timeoutMs = Math.max(20_000, Math.min(600_000, Number(input.timeoutMs) || 180_000))
  const selector = String(input.answerSelector ?? '').trim()
  try {
    await wc.loadURL(url)
    // 等输入框出现（最多 20s，且不超过整体超时）；同时识别登录墙，给出可操作提示
    let page: AskPageState | null = null
    const readyBy = Date.now() + Math.min(20_000, timeoutMs)
    while (Date.now() < readyBy) {
      await wait(500)
      page = (await wc.executeJavaScript(ASK_FIND_SCRIPT, true)) as AskPageState
      if (page?.editor) break
    }
    // 登录墙优先：落地页也可能带输入框（如 Qwen），有输入框不代表已登录
    if (page?.login) {
      await wait(1200)
      page = (await wc.executeJavaScript(ASK_FIND_SCRIPT, true)) as AskPageState
      if (page?.login) {
        return { ok: false, error: `站点未登录：请先在内置浏览器登录 ${site ? ASK_SITE_LABELS[site] : url}，再运行（登录态会保留）` }
      }
    }
    if (!page?.editor) {
      return { ok: false, error: '没有找到对话输入框：页面可能未加载完、需要登录或站点已改版' }
    }
    const before = (await wc.executeJavaScript(askSnapshotScript(selector), true)) as AskSnapshot
    const beforeTexts = new Set(before.texts ?? [])
    const filled = (await wc.executeJavaScript(askFillScript(question), true)) as { ok: boolean; error?: string }
    if (!filled?.ok) return { ok: false, error: filled?.error || '填写问题失败' }
    await wait(400)
    const sent = (await wc.executeJavaScript(ASK_SEND_SCRIPT, true)) as { ok: boolean; error?: string }
    if (!sent?.ok) return { ok: false, error: sent?.error || '发送问题失败' }
    // 轮询回答：取发送后新增的回答块，多块拼接；连续稳定两次且不在生成中则结束
    let answer = ''
    let last = ''
    let stable = 0
    let finalUrl = page.url
    let finalTitle = page.title
    while (Date.now() - started < timeoutMs) {
      await wait(900)
      const snap = (await wc.executeJavaScript(askSnapshotScript(selector), true)) as AskSnapshot
      finalUrl = snap.url || finalUrl
      finalTitle = snap.title || finalTitle
      // 取发送后新增的回答块（按文本集合差，避免页面欢迎语 / 旧回答混入）；
      // 用户气泡也可能带同样式容器（如豆包），按问题文本剔除
      const qKey = question.replace(/\s+/g, ' ').trim()
      let next = (snap.texts ?? [])
        .filter((t) => !beforeTexts.has(t) && t.replace(/\s+/g, ' ').trim() !== qKey)
        .join('\n\n')
      if (!next) continue
      answer = next
      if (next === last) stable += 1
      else stable = 0
      last = next
      if (stable >= 2 && !snap.streaming) break
    }
    const waitedMs = Date.now() - started
    if (!answer.trim()) {
      return {
        ok: false,
        error: `等待回答超时（${Math.round(waitedMs / 1000)}s）：请确认站点已登录、输入框可用；也可在节点里指定回答选择器`
      }
    }
    return { ok: true, answer: answer.trim(), title: finalTitle, url: finalUrl, waitedMs }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function browserScreenshot(): Promise<{ ok: boolean; dataUrl?: string; path?: string; error?: string }> {
  if (mode === 'chrome') return chromeScreenshot()
  if (!guest() && !(await ensureBrowserGuest())) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  const wc = guest()
  if (!wc) return { ok: false, error: '浏览器还没打开（先切到「浏览器」标签）' }
  const captureOnce = async (timeoutMs: number) => {
    const shot = await Promise.race([
      wc.capturePage().catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ])
    return shot
  }
  try {
    let image = await captureOnce(2000)
    // 侧栏停在「对话」时 webview 仍挂载但不可见，capturePage 会挂起或返回空图；
    // 先让渲染层切到「浏览器」标签再补拍一次
    if (!image || image.isEmpty()) {
      sendTo('main', 'browser:ensure')
      await new Promise((r) => setTimeout(r, 450))
      image = await captureOnce(4000)
    }
    if (!image) {
      return { ok: false, error: '截图超时：浏览器面板当前不可见，请切到「浏览器」标签或把 WorkOn 窗口置前后重试' }
    }
    if (image.isEmpty()) {
      return { ok: false, error: '截图为空：浏览器面板当前不可见或页面尚未渲染，请切到「浏览器」标签后重试' }
    }
    const dataUrl = image.toDataURL()
    if (!dataUrl || dataUrl.length < 100) {
      return { ok: false, error: '截图为空：页面尚未渲染出可捕获画面' }
    }
    const dir = path.join(app.getPath('userData'), 'browser-shots')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'latest.png')
    fs.writeFileSync(file, image.toPNG())
    return { ok: true, dataUrl, path: file }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export function browserOpenExternal(url: string): BrowserActionResult {
  const target = normalizeUrl(url)
  if (!target || !/^https?:\/\//i.test(target)) return { ok: false, error: '只能打开 http / https 地址' }
  void shell.openExternal(target)
  return { ok: true, detail: target }
}
