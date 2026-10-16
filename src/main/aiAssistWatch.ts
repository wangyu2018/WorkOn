/**
 * AI 助手后台监控：名单内进程忙碌→完成时通知前端闪点
 */
import { execFile } from 'child_process'
import { isLoadGuardEngaged } from './loadGuard'
import { app } from 'electron'
import { listBindings } from './attributions'
import { projectRecentDirActivity } from './dirWatcher'
import { getSettings } from './settings'
import { sendTo } from './windows'
import {
  isAssistBusyTitle,
  labelOfAssist,
  normalizeAssistKey,
  type AiAssistItem,
  type AiAssistStatus
} from '@shared/aiAssistWatch'

interface Track {
  key: string
  status: AiAssistStatus
  busySince: number
  doneUntil: number
  title: string
  seen: boolean
}

const tracks = new Map<string, Track>()
let lastSampleAt = 0
let sampling = false
let lastBroadcast = ''
const SAMPLE_MIN_MS = 60_000
const DONE_FLASH_MS = 45_000
const BUSY_MIN_MS = 2500

function runPs(script: string): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: 8000, windowsHide: true, maxBuffer: 64 * 1024, encoding: 'utf8' },
      (_err, stdout) => resolve((stdout || '').trim())
    )
  })
}

/** 反查：某工具名（软绑定 apps）对应哪些主线 id */
function projectsForTool(key: string): string[] {
  const k = key.toLowerCase()
  return listBindings()
    .filter((b) => b.apps.some((a) => a.toLowerCase().includes(k) || k.includes(a.toLowerCase())))
    .map((b) => b.projectId)
}

async function sampleProcesses(keys: string[]): Promise<{ key: string; title: string }[]> {
  const uniq = [...new Set(keys.map(normalizeAssistKey).filter(Boolean))]
  if (!uniq.length) return []
  // Get-Process 接受短名列表；没有的进程会静默跳过
  const isDev = !app.isPackaged
  const list = (isDev ? ['electron'] : uniq).map((k) => `'${k.replace(/'/g, '')}'`).join(',')
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$names = @(${list})
$labels = @(${JSON.stringify(uniq)})
$out = @()
foreach ($n in $names) {
  $ps = Get-Process -Name $n -ErrorAction SilentlyContinue
  if (-not $ps) { continue }
  $title = ''
  foreach ($p in @($ps)) {
    if ($p.MainWindowTitle) { $title = [string]$p.MainWindowTitle; break }
  }
  if (-not $title) { continue }
  $hit = $n
  if ($n -eq 'electron') {
    $hit = ''
    foreach ($l in $labels) {
      if ($title -like ('*' + $l + '*')) { $hit = $l; break }
    }
    if (-not $hit) { continue }
  }
  $out += [pscustomobject]@{ key = $hit; title = $title }
}
$out | ConvertTo-Json -Compress
`
  const raw = await runPs(script)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { key: string; title?: string } | { key: string; title?: string }[]
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    return arr
      .map((x) => ({ key: normalizeAssistKey(x.key), title: String(x.title ?? '') }))
      .filter((x) => x.key)
  } catch {
    return []
  }
}

function broadcast(items: AiAssistItem[]): void {
  const payload = { enabled: true, items }
  const sig = JSON.stringify(payload)
  if (sig === lastBroadcast) return
  lastBroadcast = sig
  sendTo('widget', 'ai-assist:update', payload)
  sendTo('main', 'ai-assist:update', payload)
  sendTo('todoWidget', 'ai-assist:update', payload)
}

function clearBroadcast(): void {
  if (!lastBroadcast) return
  lastBroadcast = ''
  const payload = { enabled: false, items: [] as AiAssistItem[] }
  sendTo('widget', 'ai-assist:update', payload)
  sendTo('main', 'ai-assist:update', payload)
  sendTo('todoWidget', 'ai-assist:update', payload)
}

/** monitor tick 调用（内部节流） */
/** Layer4：agent hook 直报开始干活（外部钩子调用） */
export function markToolBusy(key: string, title?: string): void {
  const k = normalizeAssistKey(key)
  if (!k) return
  let tr = tracks.get(k)
  if (!tr) {
    tr = { key: k, status: 'busy', busySince: Date.now(), doneUntil: 0, title: title ?? '', seen: true }
    tracks.set(k, tr)
  } else {
    if (tr.status !== 'busy') tr.busySince = Date.now()
    tr.status = 'busy'
    if (title) tr.title = title
    tr.seen = true
  }
  broadcast([{ key: k, label: labelOfAssist(k), status: 'busy', title: tr.title }])
}

/** Layer4：agent hook 直报干完了（完成闪点） */
export function markToolDone(key: string, flashMs = 45_000): void {
  const k = normalizeAssistKey(key)
  const tr = tracks.get(k)
  if (!tr) return
  tr.status = 'done'
  tr.doneUntil = Date.now() + flashMs
  tr.busySince = 0
  broadcast([{ key: k, label: labelOfAssist(k), status: 'done', title: tr.title, doneUntil: tr.doneUntil }])
}

export async function aiAssistWatchTick(ts = Date.now()): Promise<void> {
  void ts
  const s = getSettings()
  if (!s.aiAssistWatchEnabled) {
    if (tracks.size) tracks.clear()
    clearBroadcast()
    return
  }
  const watched = (s.aiAssistWatchApps ?? []).map(normalizeAssistKey).filter(Boolean)
  if (!watched.length) {
    tracks.clear()
    broadcast([])
    return
  }
  for (const key of [...tracks.keys()]) {
    if (!watched.includes(key)) tracks.delete(key)
  }
  const minMs = SAMPLE_MIN_MS * (isLoadGuardEngaged() ? 3 : 1)
  if (sampling || ts - lastSampleAt < minMs) return
  lastSampleAt = ts
  sampling = true
  // 可见性门控（BUG-22 修）：v10 主窗/玻璃窗也是消费者——任何窗口可见就采样
  const { widgetWindow: ww, todoWidgetWindow: tw, mainWindow: mw, getWorkbenchWindow: gwb } = (await import('./windows')) as never
  const mod = (await import('./windows')) as { mainWindow?: import('electron').BrowserWindow | null; getWorkbenchWindow?: () => import('electron').BrowserWindow | null }
  const vis = (w?: import('electron').BrowserWindow | null): boolean => !!w && !w.isDestroyed() && w.isVisible()
  const mainVis = vis(mod.mainWindow)
  if (!vis(ww) && !vis(tw) && !mainVis) return

  const live = await sampleProcesses(watched)
  const liveMap = new Map(live.map((x) => [x.key, x]))

  for (const key of watched) {
    let tr = tracks.get(key)
    if (!tr) {
      tr = { key, status: 'off', busySince: 0, doneUntil: 0, title: '', seen: false }
      tracks.set(key, tr)
    }
    const hit = liveMap.get(key)
    if (!hit) {
      // 进程退出：若之前 busy，视为完成闪一下
      if (tr.status === 'busy' || (tr.busySince && ts - tr.busySince >= BUSY_MIN_MS)) {
        tr.status = 'done'
        tr.doneUntil = ts + DONE_FLASH_MS
        tr.busySince = 0
      } else if (tr.status !== 'done' || ts > tr.doneUntil) {
        tr.status = 'off'
        tr.doneUntil = 0
      }
      tr.seen = false
      tr.title = ''
      continue
    }
    tr.seen = true
    tr.title = hit.title
    // Layer2：目录在写 = 真在后台干活（覆盖"对话完进后台不改标题"盲区）
    const dirBusy = projectsForTool(key).some((pid) => projectRecentDirActivity(pid, 180_000))
    const busy = isAssistBusyTitle(hit.title) || dirBusy
    if (busy) {
      if (tr.status !== 'busy') tr.busySince = ts
      tr.status = 'busy'
      tr.doneUntil = 0
    } else if (tr.status === 'busy' && tr.busySince && ts - tr.busySince >= BUSY_MIN_MS) {
      tr.status = 'done'
      tr.doneUntil = ts + DONE_FLASH_MS
      tr.busySince = 0
    } else if (tr.status === 'done' && ts > tr.doneUntil) {
      tr.status = 'idle'
      tr.doneUntil = 0
    } else if (tr.status === 'off') {
      tr.status = 'idle'
    }
  }

  // 清掉已不在名单的 track
  for (const key of [...tracks.keys()]) {
    if (!watched.includes(key)) tracks.delete(key)
  }

  const items: AiAssistItem[] = watched.map((key) => {
    const tr = tracks.get(key)
    let status: AiAssistStatus = tr?.status ?? 'off'
    if (status === 'done' && tr && ts > tr.doneUntil) status = tr.seen ? 'idle' : 'off'
    return {
      key,
      label: labelOfAssist(key),
      status,
      title: tr?.title || undefined,
      doneUntil: status === 'done' ? tr?.doneUntil : undefined
    }
  })
  sampling = false
  broadcast(items)
}

/** 忙时轻档面板用：当前采样节奏 */
export function getAiAssistPace(): { minIntervalMs: number } {
  return { minIntervalMs: SAMPLE_MIN_MS * (isLoadGuardEngaged() ? 3 : 1) }
}
