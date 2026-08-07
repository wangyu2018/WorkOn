/**
 * 前台窗口采集 —— Windows Win32 P/Invoke（PowerShell 内联 C#）
 * 依据：PRD.md F1「不依赖 active-win 原生模块，规避本机编译失败」
 * 通过 -EncodedCommand（UTF-16LE base64）传脚本，避免引号转义问题
 */
import { execFile } from 'child_process'
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
$h = [FG]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { '{}' ; exit }
$sb = New-Object System.Text.StringBuilder 512
[void][FG]::GetWindowText($h, $sb, 512)
$r = New-Object FG+RECT
[void][FG]::GetWindowRect($h, [ref]$r)
$procId = 0
[void][FG]::GetWindowThreadProcessId($h, [ref]$procId)
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$obj = [pscustomobject]@{
  app = if ($p) { $p.ProcessName + '.exe' } else { '' }
  title = $sb.ToString()
  x = $r.Left; y = $r.Top
  width = $r.Right - $r.Left; height = $r.Bottom - $r.Top
}
$obj | ConvertTo-Json -Compress
`

const ENCODED = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')

function runPs(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED],
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

/** 获取当前前台窗口（含屏幕索引）；失败返回 null（不中断监控） */
export async function getForegroundWindow(): Promise<ForegroundWindowInfo | null> {
  const out = await runPs()
  if (!out) return null
  try {
    const raw = JSON.parse(out)
    if (!raw || typeof raw.x !== 'number') return null
    return {
      app: String(raw.app ?? ''),
      title: String(raw.title ?? ''),
      x: raw.x,
      y: raw.y,
      width: raw.width,
      height: raw.height,
      screen: screenIndexOf(raw.x, raw.y, raw.width, raw.height)
    }
  } catch {
    console.warn('[winInfo] 解析输出失败:', out.slice(0, 120))
    return null
  }
}
