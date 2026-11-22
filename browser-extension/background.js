/**
 * WorkOn Browser Connector
 * 架构参考 Qoder CN：扩展通过本地 WebSocket 连接桌面端，
 * 用 chrome.tabs / chrome.scripting / captureVisibleTab 操作用户真实的 Chrome。
 * 只连接 127.0.0.1，不上传页面数据。
 */
const WS_URL = 'ws://127.0.0.1:18794/'

let ws = null
let reconnectTimer = null

function setBadge(on) {
  try {
    chrome.action.setBadgeText({ text: on ? 'ON' : '' })
    chrome.action.setBadgeBackgroundColor({ color: on ? '#22c55e' : '#ef4444' })
  } catch { /* ignore */ }
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  try {
    ws = new WebSocket(WS_URL)
  } catch {
    schedule()
    return
  }
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', version: '0.2.0', browser: 'chrome' }))
    setBadge(true)
  }
  ws.onmessage = (ev) => { void handle(ev.data) }
  ws.onclose = () => { setBadge(false); schedule() }
  ws.onerror = () => { setBadge(false) }
}

function schedule() {
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(connect, 3000)
}

async function handle(raw) {
  let msg = null
  try { msg = JSON.parse(raw) } catch { return }
  if (!msg || typeof msg.id !== 'number' || !msg.action) return
  try {
    const result = await run(msg.action, msg.params || {})
    ws.send(JSON.stringify({ id: msg.id, ok: true, result }))
  } catch (e) {
    ws.send(JSON.stringify({ id: msg.id, ok: false, error: (e && e.message) || String(e) }))
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function resolveTab(tabId) {
  if (typeof tabId === 'number') {
    const tab = await chrome.tabs.get(tabId)
    if (!tab) throw new Error('标签页不存在')
    return tab
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (tab) return tab
  const [any] = await chrome.tabs.query({ active: true })
  if (!any) throw new Error('没有可用的标签页')
  return any
}

function tabInfo(tab) {
  return {
    id: tab.id,
    title: tab.title || '',
    url: tab.url || '',
    active: !!tab.active,
    windowId: tab.windowId,
    status: tab.status || ''
  }
}

async function inject(tabId, func, args, world) {
  const [entry] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args: args || [],
    ...(world ? { world } : {})
  })
  return entry ? entry.result : null
}

async function waitTabReady(tabId, timeout = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const tab = await chrome.tabs.get(tabId)
      if (tab && tab.status === 'complete') return true
    } catch {
      return false
    }
    await sleep(250)
  }
  return false
}

/* ---- 注入到页面的函数（必须自包含） ---- */

function readPage() {
  function sel(el) {
    if (!el || el.nodeType !== 1) return ''
    if (el.id) return '#' + CSS.escape(el.id)
    const parts = []
    let n = el
    while (n && n.nodeType === 1 && parts.length < 4) {
      let s = n.tagName.toLowerCase()
      if (typeof n.className === 'string' && n.className.trim()) {
        const c = n.className.trim().split(/\s+/).slice(0, 2).map((x) => '.' + CSS.escape(x)).join('')
        if (c) s += c
      }
      const p = n.parentElement
      if (p) s += ':nth-child(' + (Array.from(p.children).indexOf(n) + 1) + ')'
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
      text: String(el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      selector: sel(el)
    }))
    .filter((x) => x.text)
  return {
    title: document.title,
    url: location.href,
    text: body.replace(/\n{3,}/g, '\n\n').slice(0, 20000),
    items
  }
}

function clickPage(raw) {
  const target = String(raw || '').trim()
  let el = null
  try {
    if (/^[#.[]/.test(target) || target.includes('>') || target.includes(':nth')) el = document.querySelector(target)
  } catch { /* ignore */ }
  if (!el) {
    const nodes = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],summary,label'))
    el = nodes.find((n) => {
      const t = String(n.innerText || n.value || n.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
      return t && (t === target || t.includes(target))
    }) || null
  }
  if (!el) return { ok: false, error: '没找到可点击元素：' + target }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  el.click()
  return {
    ok: true,
    detail: (el.tagName || '').toLowerCase() + ' · ' + String(el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  }
}

function fillPage(selector, text) {
  const el = document.querySelector(selector)
  if (!el) return { ok: false, error: '没找到输入框：' + selector }
  el.scrollIntoView({ block: 'center' })
  el.focus()
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')
  if (setter && setter.set) setter.set.call(el, text)
  else el.value = text
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true, detail: '已填写 ' + selector }
}

/** 页面巡检（MAIN world）：结构指标 + 运行期错误（page-observer.js 采集） */
function inspectPage() {
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
      hasLabel: !!(
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) ||
        el.closest('label')
      )
    }))
  const body = document.body ? document.body.innerText || '' : ''
  const suspicious = /(404|500|not found|internal server error|系统错误|服务异常|网络异常|加载失败|出错了|无权限|forbidden)/i
  const errorTexts = body
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s && s.length <= 120 && suspicious.test(s))
    .slice(0, 10)
  const alertNodes = Array.from(document.querySelectorAll('[role="alert"],[aria-live="assertive"]'))
    .filter(visible)
    .slice(0, 10)
    .map((el) => String(el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120))
    .filter(Boolean)
  return {
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    textLen: body.replace(/\s+/g, ' ').trim().length,
    images: { total: images.length, broken },
    links: document.querySelectorAll('a[href]').length,
    buttons: document.querySelectorAll('button,[role="button"],input[type="submit"]').length,
    forms: document.querySelectorAll('form').length,
    inputs,
    headings: Array.from(document.querySelectorAll('h1,h2')).slice(0, 10).map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: String(el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    })),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
    errorTexts,
    alerts: alertNodes,
    consoleErrors: (window.__workonErrors || []).slice(-30)
  }
}

/* ---- 命令路由 ---- */

async function run(action, params) {
  if (action === 'state') {
    const tab = await resolveTab(params.tabId)
    return tabInfo(tab)
  }
  if (action === 'tabs.list') {
    const tabs = await chrome.tabs.query({})
    return tabs.map(tabInfo)
  }
  if (action === 'tabs.open') {
    const url = String(params.url || '')
    if (!/^https?:\/\//i.test(url)) throw new Error('只支持 http / https 地址')
    const tab = await chrome.tabs.create({ url, active: params.active !== false })
    return tabInfo(tab)
  }
  if (action === 'tabs.activate') {
    const tab = await chrome.tabs.update(Number(params.tabId), { active: true })
    if (tab && tab.windowId != null) {
      try { await chrome.windows.update(tab.windowId, { focused: true }) } catch { /* ignore */ }
    }
    return tab ? tabInfo(tab) : null
  }

  const tab = await resolveTab(params.tabId)
  if (action === 'page.navigate') {
    const url = String(params.url || '')
    if (!/^(https?|about):/i.test(url)) throw new Error('只支持 http / https 地址')
    await chrome.tabs.update(tab.id, { url })
    return { ok: true, tabId: tab.id, url }
  }
  if (action === 'page.back') {
    await chrome.tabs.goBack(tab.id)
    return { ok: true }
  }
  if (action === 'page.forward') {
    await chrome.tabs.goForward(tab.id)
    return { ok: true }
  }
  if (action === 'page.reload') {
    await chrome.tabs.reload(tab.id)
    return { ok: true }
  }
  if (action === 'page.read') {
    await waitTabReady(tab.id)
    return await inject(tab.id, readPage)
  }
  if (action === 'page.inspect') {
    await waitTabReady(tab.id)
    return await inject(tab.id, inspectPage, [], 'MAIN')
  }
  if (action === 'page.click') {
    return await inject(tab.id, clickPage, [String(params.target || '')])
  }
  if (action === 'page.fill') {
    return await inject(tab.id, fillPage, [String(params.selector || ''), String(params.text || '')])
  }
  if (action === 'page.screenshot') {
    if (!tab.active) {
      await chrome.tabs.update(tab.id, { active: true })
      await sleep(250)
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    return { dataUrl, url: tab.url || '', title: tab.title || '' }
  }
  throw new Error('未知动作：' + action)
}

chrome.runtime.onStartup.addListener(connect)
chrome.runtime.onInstalled.addListener(connect)
connect()
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
}, 20000)
