/**
 * 前台窗口采集 —— Windows Win32 P/Invoke（PowerShell 内联 C#）
 * 依据：PRD.md F1「不依赖 active-win 原生模块，规避本机编译失败」
 *
 * v5.1 性能重构：常驻 PowerShell 辅助进程（500ms 轮询 + 变化才输出 NDJSON），
 * 替代旧版"每 tick 冷启动 powershell.exe"——原模式每次 200-600ms CPU 突发，
 * 2s 轮询下常态吃掉 ~10-30% 单核。现模式进程内轮询开销 <1%。
 * 进程退出自动重启（退避），连续失败达上限回退旧冷启动路径。
 */
import { execFile, spawn } from 'child_process'
import type { ChildProcessByStdio } from 'child_process'
import { screen } from 'electron'
import type { ForegroundWindowInfo } from '@shared/types'

const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$script:lastOut = ""
while ($true) {
  try {
    $h = [FG]::GetForegroundWindow()
    $out = "{}"
    if ($h -ne [IntPtr]::Zero) {
      $sb = New-Object System.Text.StringBuilder 512
      [void][FG]::GetWindowText($h, $sb, 512)
      $r = New-Object FG+RECT
      [void][FG]::GetWindowRect($h, [ref]$r)
      $procId = 0
      [void][FG]::GetWindowThreadProcessId($h, [ref]$procId)
      $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
      $obj = [pscustomobject]@{
        app = if ($p) { $p.ProcessName + '.exe' } else { '' }
        title = $sb.ToString()
        x = $r.Left; y = $r.Top
        width = $r.Right - $r.Left; height = $r.Bottom - $r.Top
        exePath = if ($p) { $p.Path } else { '' }
      }
      $out = $obj | ConvertTo-Json -Compress
    }
    if ($out -ne $script:lastOut) {
      [Console]::Out.WriteLine($out)
      $script:lastOut = $out
    }
  } catch {}
  Start-Sleep -Milliseconds 500
}
`

const ENCODED_SERVER = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')

// ── 旧冷启动路径（探针服务器不可用时的回退） ──
const PS_SCRIPT_ONCE = PS_SCRIPT.split('while ($true) {')[0] + '$h = [FG]::GetForegroundWindow()\nif ($h -eq [IntPtr]::Zero) { \'{}\' ; exit }\n$sb = New-Object System.Text.StringBuilder 512\n[void][FG]::GetWindowText($h, $sb, 512)\n$r = New-Object FG+RECT\n[void][FG]::GetWindowRect($h, [ref]$r)\n$procId = 0\n[void][FG]::GetWindowThreadProcessId($h, [ref]$procId)\n$p = Get-Process -Id $procId -ErrorAction SilentlyContinue\n[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$obj = [pscustomobject]@{\n  app = if ($p) { $p.ProcessName + \'.exe\' } else { \'\' }\n  title = $sb.ToString()\n  x = $r.Left; y = $r.Top\n  width = $r.Right - $r.Left; height = $r.Bottom - $r.Top\n  exePath = if ($p) { $p.Path } else { \'\' }\n}\n$obj | ConvertTo-Json -Compress\n'

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

/** 根据窗口矩形中心点反查所在屏幕索引 */
function screenIndexOf(x: number, y: number, w: number, h: number): number {
  const cx = x + w / 2
  const cy = y + h / 2
  const displays = screen.getAllDisplays()
  for (let i = 0; i < displays.length; i++) {
    const b = displays[i].bounds
    if (cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height) return i
  }
  // 找最近屏
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

function parseInfo(raw: Record<string, unknown>): ForegroundWindowInfo | null {
  if (!raw || typeof raw.x !== 'number') return null
  return {
    app: String(raw.app ?? ''),
    title: String(raw.title ?? ''),
    x: raw.x as number,
    y: raw.y as number,
    width: raw.width as number,
    height: raw.height as number,
    screen: screenIndexOf(raw.x as number, raw.y as number, raw.width as number, raw.height as number),
    exePath: typeof raw.exePath === 'string' && raw.exePath ? raw.exePath : undefined
  }
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
const MAX_SERVER_FAILURES = 5
const RESTART_COOLDOWN_MS = 5000

function handleLine(line: string): void {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    const info = parseInfo(JSON.parse(trimmed))
    if (info) fgCache = info
  } catch {
    /* 坏行忽略 */
  }
}

function startServer(): void {
  if (stopped || server || serverStarting) return
  if (serverFailures >= MAX_SERVER_FAILURES) return
  serverStarting = true
  try {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_SERVER],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )
    server = proc
    // 后台工作进程降优先级：绝不允许抢占前台鼠标/键盘的调度
    function lowerPriority(pid: number | undefined): void {
      if (!pid) return
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const os = require('os') as typeof import('os')
        os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
      } catch { /* 平台不支持/已退出则忽略 */ }
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
    console.info('[winInfo] 常驻前台采集进程已启动（500ms 轮询，替代每 tick 冷启动 PowerShell）')
  } catch (e) {
    serverStarting = false
    serverFailures++
    console.warn('[winInfo] 常驻进程启动失败:', e)
  }
}

/** 获取当前前台窗口（含屏幕索引）；失败返回 null（不中断监控）。
 *  常驻服务器存活时直接读缓存（0 开销）；否则等待首行/回退冷启动。 */
export async function getForegroundWindow(): Promise<ForegroundWindowInfo | null> {
  if (stopped) return null
  if (!server && !serverStarting && serverFailures < MAX_SERVER_FAILURES) startServer()
  if (server) {
    // 等首行最多 2s（冷启动 PS 初始化）；之后缓存即时返回
    const deadline = Date.now() + 2000
    while (!fgCache && serverAlive && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 60))
    }
    if (fgCache) return fgCache
    if (!serverAlive) return null
    // 服务器活着但尚无首行 → 再稍等一轮
    await new Promise((r) => setTimeout(r, 250))
    return fgCache
  }
  // 回退：冷启动一次性调用
  const out = await runPsOnce()
  if (!out) return null
  try {
    return parseInfo(JSON.parse(out))
  } catch {
    console.warn('[winInfo] 解析输出失败:', out.slice(0, 120))
    return null
  }
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
