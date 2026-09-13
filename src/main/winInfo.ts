/**
 * 前台窗口采集 —— Windows Win32 P/Invoke（PowerShell 内联 C#）
 * 依据：PRD.md F1「不依赖 active-win 原生模块，规避本机编译失败」
 *
 * v5.3：常驻进程同时采样
 *  - GetCursorPos + WindowFromPoint → 鼠标下窗口（时间轴「激活」主记录）
 *  - GetForegroundWindow（系统键盘焦点，作回退）
 *  - 各屏中心 WindowFromPoint（副屏可见顶层，含后台 AI 窗）
 */
import { execFile, spawn } from 'child_process'
import type { ChildProcessByStdio } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { screen } from 'electron'
import type { ForegroundWindowInfo } from '@shared/types'

const DISPLAY_HINT_PATH = path.join(os.tmpdir(), 'workon-wininfo-displays.json')

const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint ga);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
  public struct POINT { public int X; public int Y; }
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$script:lastOut = ""
$hintPath = Join-Path $env:TEMP "workon-wininfo-displays.json"

function Get-WinObj([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return $null }
  $root = [FG]::GetAncestor($h, 2)
  if ($root -ne [IntPtr]::Zero) { $h = $root }
  if (-not [FG]::IsWindowVisible($h)) { return $null }
  $cloaked = 0
  [void][FG]::DwmGetWindowAttribute($h, 14, [ref]$cloaked, 4)
  if ($cloaked -ne 0) { return $null }
  $clsSb = New-Object System.Text.StringBuilder 256
  [void][FG]::GetClassName($h, $clsSb, 256)
  $cls = $clsSb.ToString()
  if ($cls -match '^(Shell_TrayWnd|Shell_SecondaryTrayWnd|Progman|WorkerW|NotifyIconOverflowWindow|Windows.UI.Core.CoreWindow)$') { return $null }
  $r = New-Object FG+RECT
  if (-not [FG]::GetWindowRect($h, [ref]$r)) { return $null }
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  if ($w -lt 40 -or $hh -lt 40) { return $null }
  $sb = New-Object System.Text.StringBuilder 512
  [void][FG]::GetWindowText($h, $sb, 512)
  $procId = 0
  [void][FG]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($procId -eq 0) { return $null }
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  $procName = if ($p) { $p.ProcessName } else { '' }
  if ($procName -match '^(SearchHost|StartMenuExperienceHost|TextInputHost|ShellExperienceHost|ApplicationFrameHost)$') { return $null }
  return [pscustomobject]@{
    app = if ($procName) { $procName + '.exe' } else { '' }
    title = $sb.ToString()
    x = $r.Left; y = $r.Top
    width = $w; height = $hh
    exePath = if ($p) { $p.Path } else { '' }
  }
}

function Sample-Point([int]$x, [int]$y, [bool]$skipSelf) {
  $offsets = @(
    @(0,0), @(120,0), @(-120,0), @(0,120), @(0,-120), @(180,100), @(-180,-100)
  )
  foreach ($o in $offsets) {
    $pt = New-Object FG+POINT
    $pt.X = $x + $o[0]; $pt.Y = $y + $o[1]
    $h = [FG]::WindowFromPoint($pt)
    $obj = Get-WinObj $h
    if ($null -ne $obj -and $obj.app) {
      if ($skipSelf -and ($obj.app -match '^(electron|WorkOn)\\.exe$')) { continue }
      return $obj
    }
  }
  return $null
}

while ($true) {
  try {
    $fgObj = $null
    $h = [FG]::GetForegroundWindow()
    if ($h -ne [IntPtr]::Zero) {
      $fgObj = Get-WinObj $h
      if ($null -eq $fgObj) {
        $sb = New-Object System.Text.StringBuilder 512
        [void][FG]::GetWindowText($h, $sb, 512)
        $r = New-Object FG+RECT
        [void][FG]::GetWindowRect($h, [ref]$r)
        $procId = 0
        [void][FG]::GetWindowThreadProcessId($h, [ref]$procId)
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        $fgObj = [pscustomobject]@{
          app = if ($p) { $p.ProcessName + '.exe' } else { '' }
          title = $sb.ToString()
          x = $r.Left; y = $r.Top
          width = $r.Right - $r.Left; height = $r.Bottom - $r.Top
          exePath = if ($p) { $p.Path } else { '' }
        }
      }
    }
    $ptr = New-Object FG+POINT
    $pointerObj = $null
    if ([FG]::GetCursorPos([ref]$ptr)) {
      $pointerObj = Sample-Point $ptr.X $ptr.Y $false
    }
    $tops = @()
    if (Test-Path $hintPath) {
      try {
        $hints = Get-Content -LiteralPath $hintPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($hint in @($hints)) {
          if ($null -eq $hint.cx -or $null -eq $hint.cy) { continue }
          $t = Sample-Point ([int]$hint.cx) ([int]$hint.cy) $true
          if ($null -ne $t) { $tops += $t }
        }
      } catch {}
    }
    $payload = [pscustomobject]@{ fg = $fgObj; pointer = $pointerObj; tops = $tops }
    $out = $payload | ConvertTo-Json -Compress -Depth 5
    if ($out -ne $script:lastOut) {
      [Console]::Out.WriteLine($out)
      $script:lastOut = $out
    }
  } catch {}
  Start-Sleep -Milliseconds 1000
}
`

const ENCODED_SERVER = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')

/** 一次性：鼠标下窗口 + 前台 + 各屏顶层（冷启动回退） */
const PS_SCRIPT_ONCE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint ga);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
  public struct POINT { public int X; public int Y; }
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$hintPath = Join-Path $env:TEMP "workon-wininfo-displays.json"
function Get-WinObj([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return $null }
  $root = [FG]::GetAncestor($h, 2)
  if ($root -ne [IntPtr]::Zero) { $h = $root }
  if (-not [FG]::IsWindowVisible($h)) { return $null }
  $cloaked = 0
  [void][FG]::DwmGetWindowAttribute($h, 14, [ref]$cloaked, 4)
  if ($cloaked -ne 0) { return $null }
  $clsSb = New-Object System.Text.StringBuilder 256
  [void][FG]::GetClassName($h, $clsSb, 256)
  $cls = $clsSb.ToString()
  if ($cls -match '^(Shell_TrayWnd|Shell_SecondaryTrayWnd|Progman|WorkerW|NotifyIconOverflowWindow|Windows.UI.Core.CoreWindow)$') { return $null }
  $r = New-Object FG+RECT
  if (-not [FG]::GetWindowRect($h, [ref]$r)) { return $null }
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  if ($w -lt 40 -or $hh -lt 40) { return $null }
  $sb = New-Object System.Text.StringBuilder 512
  [void][FG]::GetWindowText($h, $sb, 512)
  $procId = 0
  [void][FG]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($procId -eq 0) { return $null }
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  $procName = if ($p) { $p.ProcessName } else { '' }
  if ($procName -match '^(SearchHost|StartMenuExperienceHost|TextInputHost|ShellExperienceHost|ApplicationFrameHost)$') { return $null }
  return [pscustomobject]@{
    app = if ($procName) { $procName + '.exe' } else { '' }
    title = $sb.ToString()
    x = $r.Left; y = $r.Top
    width = $w; height = $hh
    exePath = if ($p) { $p.Path } else { '' }
  }
}
function Sample-Point([int]$x, [int]$y, [bool]$skipSelf) {
  $offsets = @(@(0,0), @(120,0), @(-120,0), @(0,120), @(0,-120))
  foreach ($o in $offsets) {
    $pt = New-Object FG+POINT
    $pt.X = $x + $o[0]; $pt.Y = $y + $o[1]
    $obj = Get-WinObj ([FG]::WindowFromPoint($pt))
    if ($null -ne $obj -and $obj.app) {
      if ($skipSelf -and ($obj.app -match '^(electron|WorkOn)\\.exe$')) { continue }
      return $obj
    }
  }
  return $null
}
$fgObj = Get-WinObj ([FG]::GetForegroundWindow())
$ptr = New-Object FG+POINT
$pointerObj = $null
if ([FG]::GetCursorPos([ref]$ptr)) { $pointerObj = Sample-Point $ptr.X $ptr.Y $false }
$tops = @()
if (Test-Path $hintPath) {
  try {
    $hints = Get-Content -LiteralPath $hintPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($hint in @($hints)) {
      $t = Sample-Point ([int]$hint.cx) ([int]$hint.cy) $true
      if ($null -ne $t) { $tops += $t }
    }
  } catch {}
}
[pscustomobject]@{ fg = $fgObj; pointer = $pointerObj; tops = $tops } | ConvertTo-Json -Compress -Depth 5
`

const ENCODED_ONCE = Buffer.from(PS_SCRIPT_ONCE, 'utf16le').toString('base64')

function runPsOnce(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_ONCE],
      { timeout: 12000, windowsHide: true, maxBuffer: 1024 * 64, encoding: 'utf8' },
      (err, stdout) => {
        if (err) {
          console.warn('[winInfo] PowerShell 调用失败:', err.message)
          resolve(null)
          return
        }
        resolve(stdout.trim())
      }
    )
  })
}

/** 根据窗口矩形中心点反查所在屏幕索引（与 Electron displays 顺序一致） */
function screenIndexOf(x: number, y: number, w: number, h: number): number {
  const cx = x + w / 2
  const cy = y + h / 2
  const displays = screen.getAllDisplays()
  for (let i = 0; i < displays.length; i++) {
    const b = displays[i].bounds
    if (cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height) return i
  }
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < displays.length; i++) {
    const b = displays[i].bounds
    const dx = Math.max(b.x - cx, 0, cx - (b.x + b.width))
    const dy = Math.max(b.y - cy, 0, cy - (b.y + b.height))
    const d = dx * dx + dy * dy
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

function parseWindow(raw: Record<string, unknown> | null | undefined): ForegroundWindowInfo | null {
  if (!raw || typeof raw.x !== 'number') return null
  const app = String(raw.app ?? '')
  if (!app) return null
  return {
    app,
    title: String(raw.title ?? ''),
    x: raw.x as number,
    y: raw.y as number,
    width: Number(raw.width ?? 0),
    height: Number(raw.height ?? 0),
    screen: screenIndexOf(raw.x as number, raw.y as number, Number(raw.width ?? 0), Number(raw.height ?? 0)),
    exePath: typeof raw.exePath === 'string' && raw.exePath ? raw.exePath : undefined
  }
}

/** 写出各屏采样点，供常驻 PS 用 WindowFromPoint（索引与 Electron 一致） */
export function writeDisplayHints(): void {
  try {
    const hints = screen.getAllDisplays().map((d, i) => ({
      i,
      cx: Math.round(d.bounds.x + d.bounds.width / 2),
      cy: Math.round(d.bounds.y + d.bounds.height / 2)
    }))
    fs.writeFileSync(DISPLAY_HINT_PATH, JSON.stringify(hints), 'utf8')
  } catch (e) {
    console.warn('[winInfo] 写入屏幕采样点失败:', e)
  }
}

let displayHooked = false
function ensureDisplayHooks(): void {
  if (displayHooked) return
  displayHooked = true
  writeDisplayHints()
  const refresh = (): void => writeDisplayHints()
  screen.on('display-added', refresh)
  screen.on('display-removed', refresh)
  screen.on('display-metrics-changed', refresh)
}

// ── 常驻服务器 ──
let server: ChildProcessByStdio<
  null,
  import('stream').Readable,
  import('stream').Readable
> | null = null
let serverAlive = false
let serverStarting = false
let serverFailures = 0
let stopped = false
let buffer = ''
let fgCache: ForegroundWindowInfo | null = null
let pointerCache: ForegroundWindowInfo | null = null
let pointerCacheAt = 0
let topsCache: ForegroundWindowInfo[] = []
const MAX_SERVER_FAILURES = 5
const RESTART_COOLDOWN_MS = 5000

export function isSelfOverlayApp(app: string): boolean {
  return /^(electron|workon)(\.exe)?$/i.test(app)
}

function applyPayload(parsed: Record<string, unknown>): void {
  if (parsed && ('fg' in parsed || 'tops' in parsed || 'pointer' in parsed)) {
    const fg = parseWindow(parsed.fg as Record<string, unknown> | null)
    if (fg) fgCache = fg
    const pointer = parseWindow(parsed.pointer as Record<string, unknown> | null)
    pointerCache = pointer
    pointerCacheAt = Date.now()
    const topsRaw = Array.isArray(parsed.tops) ? (parsed.tops as Record<string, unknown>[]) : []
    const mapped = topsRaw.map((t) => parseWindow(t)).filter((x): x is ForegroundWindowInfo => !!x)
    const byScr = new Map<number, ForegroundWindowInfo>()
    for (const t of mapped) byScr.set(t.screen, t)
    topsCache = [...byScr.values()]
    return
  }
  const legacy = parseWindow(parsed)
  if (legacy) {
    fgCache = legacy
  }
}

function handleLine(line: string): void {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    applyPayload(JSON.parse(trimmed) as Record<string, unknown>)
  } catch {
    /* 坏行忽略 */
  }
}

function startServer(): void {
  if (stopped || server || serverStarting) return
  if (serverFailures >= MAX_SERVER_FAILURES) return
  ensureDisplayHooks()
  serverStarting = true
  try {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_SERVER],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )
    server = proc
    function lowerPriority(pid: number | undefined): void {
      if (!pid) return
      try {
        os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
      } catch { /* ignore */ }
    }
    lowerPriority(proc.pid)
    proc.stdout.setEncoding('utf-8')
    proc.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        handleLine(line)
      }
    })
    proc.stderr.setEncoding('utf-8')
    proc.stderr.on('data', (d: string) => {
      const s = d.trim()
      if (s) console.warn('[winInfo][ps]', s.slice(0, 160))
    })
    proc.on('exit', (code) => {
      server = null
      serverAlive = false
      serverStarting = false
      serverFailures++
      console.warn(`[winInfo] 常驻采集进程退出 code=${code}（失败 ${serverFailures}/${MAX_SERVER_FAILURES}），${RESTART_COOLDOWN_MS}ms 后重试`)
      if (!stopped && serverFailures < MAX_SERVER_FAILURES) {
        setTimeout(() => startServer(), RESTART_COOLDOWN_MS)
      } else if (serverFailures >= MAX_SERVER_FAILURES) {
        console.warn('[winInfo] 常驻进程连续失败，回退冷启动模式')
      }
    })
    serverAlive = true
    console.info('[winInfo] 常驻采集已启动（1000ms · 鼠标下窗口 / 前台 / 各屏顶层）')
  } catch (e) {
    serverStarting = false
    serverFailures++
    console.warn('[winInfo] 常驻进程启动失败:', e)
  }
}

/** 获取当前前台窗口（含屏幕索引）；失败返回 null */
export async function getForegroundWindow(): Promise<ForegroundWindowInfo | null> {
  if (stopped) return null
  if (!server && !serverStarting && serverFailures < MAX_SERVER_FAILURES) startServer()
  if (server) {
    const deadline = Date.now() + 2000
    while (!fgCache && serverAlive && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 60))
    }
    if (fgCache) return fgCache
    if (!serverAlive) return null
    await new Promise((r) => setTimeout(r, 250))
    return fgCache
  }
  ensureDisplayHooks()
  const out = await runPsOnce()
  if (!out) return null
  try {
    applyPayload(JSON.parse(out) as Record<string, unknown>)
    return fgCache
  } catch {
    console.warn('[winInfo] 解析输出失败:', out.slice(0, 120))
    return null
  }
}

/**
 * 各显示器上当前视觉顶层窗口（非过期记忆）。
 */
export async function getDisplayTopWindows(): Promise<ForegroundWindowInfo[]> {
  if (stopped) return []
  await getForegroundWindow()
  if (topsCache.length) return topsCache
  if (!server || !serverAlive) {
    ensureDisplayHooks()
    const out = await runPsOnce()
    if (out) {
      try {
        applyPayload(JSON.parse(out) as Record<string, unknown>)
      } catch { /* ignore */ }
    }
  }
  return topsCache
}

/**
 * 注意力窗口 = 鼠标下的窗口（时间轴 active 主记录）。
 * 若点到 WorkOn 悬浮层，则改用该屏中心顶层；再不行回退键盘前台。
 */
export async function getAttentionWindow(): Promise<{
  attention: ForegroundWindowInfo | null
  fg: ForegroundWindowInfo | null
  tops: ForegroundWindowInfo[]
}> {
  const fg = await getForegroundWindow()
  const tops = await getDisplayTopWindows()
  // 保鲜：缓存超过 10s 视为过期（PS 静默失败时不拿旧窗口充数）
  if (pointerCache && Date.now() - pointerCacheAt > 10_000) pointerCache = null
  let attention = pointerCache
  if (attention && isSelfOverlayApp(attention.app)) {
    const alt = tops.find((t) => t.screen === attention!.screen && !isSelfOverlayApp(t.app))
    if (alt) attention = alt
    else if (fg && !isSelfOverlayApp(fg.app)) attention = fg
  }
  if (!attention?.app) attention = fg
  return { attention: attention?.app ? attention : null, fg, tops }
}

/** 应用退出时关闭常驻进程 */
export function stopWinInfoServer(): void {
  stopped = true
  if (server) {
    try { server.kill() } catch { /* ignore */ }
    server = null
    serverAlive = false
  }
}
