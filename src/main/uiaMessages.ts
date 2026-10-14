/**
 * L3（Windows only）：UIA 读 IM 窗口的消息文本叶子。
 * 策略：按进程名找 IM 窗口 → 遍历其 UI 树，收集 Text/Value 名字非空的叶子 →
 * 启发切分（时间行/系统行过滤）。微信 3.x/QQ/钉钉可读性较好；微信 4.0 自绘
 * UI 支持未知——失败返回空数组，上层回落窗口 OCR。
 * mac 无此能力（无 UIA），返回空。
 */
import { execFile } from 'child_process'

export interface UiaMessageItem {
  sender?: string
  text: string
}

const SYS_RE = /^(微信|WeChat|QQ|钉钉|飞书|企业微信|拍一拍|撤回了一条消息|重新编辑|\d{1,2}:\d{2}|昨天|星期|上午|下午)/

/** PowerShell：按进程名收集窗口内 Text/Value 叶子名（EncodedCommand 由调用方处理） */
const PS_SCRIPT = (procName: string) => `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$proc = Get-Process | Where-Object { $_.ProcessName -like '${procName}*' -or $_.MainWindowTitle -like '*${procName}*' } | Select-Object -First 1
if (-not $proc -or -not $proc.MainWindowHandle) { return '[]' }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
if (-not $root) { return '[]' }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @()
foreach ($el in $all) {
  $n = $el.Current.Name
  if (-not $n -or $n.Trim().Length -lt 2) { continue }
  $c = $el.Current.ControlType.ProgrammaticName -replace 'ControlType.',''
  if ($c -eq 'Text' -or $c -eq 'Edit' -or $c -eq 'ListItem') {
    $out += $n.Trim()
  }
}
$out | ConvertTo-Json -Compress
`

/** 读 IM 窗口最近消息文本（Windows only） */
export async function readIMWindowText(app: string): Promise<UiaMessageItem[] | null> {
  if (process.platform !== 'win32') return null
  // app 名→进程名启发（微信→WeChat 等；失败则直接用 app）
  const procName = app.replace(/\.exe$/i, '')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT(procName)],
      { timeout: 12_000, maxBuffer: 1024 * 256, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout?.trim()) return resolve(null)
        try {
          const raw = JSON.parse(stdout.trim()) as string[] | string
          const arr = Array.isArray(raw) ? raw : [raw]
          const items: UiaMessageItem[] = []
          for (const line of arr) {
            const t = (line ?? '').replace(SYS_RE, '').trim()
            if (t.length < 2) continue
            const sm = /^([^:：]{1,12})\s*[:：]\s*(.+)$/.exec(t)
            if (sm) items.push({ sender: sm[1], text: sm[2] })
            else items.push({ text: t })
            if (items.length >= 10) break
          }
          resolve(items.length ? items : null)
        } catch {
          resolve(null)
        }
      }
    )
  })
}
