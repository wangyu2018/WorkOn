/**
 * UIAutomation 集成 —— Windows UI Automation 读取前台窗口 UI 元素
 *
 * 功能：
 *  - getFocusedElement(): 获取当前焦点元素（轻量，~500ms）
 *  - getForegroundUITree(): 获取前台窗口 UI 树（重量，~1-2s）
 *
 * 用途：
 *  - 深度模式下注入 presence.uiaContext，让 AI 知道用户在操作什么控件
 *  - Function Calling 工具 get_focused_element 供 LLM 主动查询
 *  - 为后续 UI 自动化（点击/输入）打基础
 *
 * 技术方案：
 *  - PowerShell + UIAutomationClient / UIAutomationTypes 程序集
 *  - -EncodedCommand（UTF-16LE base64）避免引号转义问题
 *  - 3 秒缓存避免频繁调用
 */

import { execFile } from 'child_process'
import type { UIElementInfo, UITreeNode } from '@shared/types'

// ───────────────────────── PowerShell 脚本 ─────────────────────────

/** 获取焦点元素：名称、控件类型、值、选中文本 */
const PS_FOCUSED = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$elm = [System.Windows.Automation.AutomationElement]::FocusedElement
if (-not $elm) { '{}' ; exit }
$name = $elm.Current.Name
$ctrl = $elm.Current.ControlType.ProgrammaticName
$cls = $elm.Current.ClassName
$autoId = $elm.Current.AutomationId
$procId = $elm.Current.ProcessId
$value = ''
try {
  $vp = $elm.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  if ($vp -and $vp.Current.Value) { $value = $vp.Current.Value }
} catch {}
$selText = ''
try {
  $tp = $elm.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
  if ($tp) {
    $sels = $tp.GetSelection()
    if ($sels -and $sels.Count -gt 0) {
      foreach ($s in $sels) {
        $ranges = $s.GetTextRanges()
        foreach ($r in $ranges) { $selText += $r.GetText(-1) + ' ' }
      }
    }
  }
} catch {}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[pscustomobject]@{
  name = $name
  controlType = $ctrl
  className = $cls
  automationId = $autoId
  value = if ($value) { $value.Substring(0, [Math]::Min(500, $value.Length)) } else { '' }
  selectedText = if ($selText) { $selText.Trim().Substring(0, [Math]::Min(200, $selText.Trim().Length)) } else { '' }
  processId = $procId
  isFocused = $true
} | ConvertTo-Json -Compress
`

/** 获取前台窗口 UI 树（深度 3，最多 50 个元素） */
const PS_TREE = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FG2 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$h = [FG2]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { '{}' ; exit }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
if (-not $root) { '{}' ; exit }
$script:count = 0
function Walk-Tree($elm, $depth, $maxDepth, $maxCount) {
  if ($script:count -gt $maxCount) { return $null }
  $script:count++
  $name = $elm.Current.Name
  $ctrl = $elm.Current.ControlType.ProgrammaticName
  $autoId = $elm.Current.AutomationId
  $obj = [pscustomobject]@{ name = $name; controlType = $ctrl; automationId = $autoId }
  try {
    $vp = $elm.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($vp -and $vp.Current.Value) {
      $v = $vp.Current.Value
      $obj | Add-Member -NotePropertyName value -NotePropertyValue ($v.Substring(0, [Math]::Min(100, $v.Length)))
    }
  } catch {}
  if ($depth -lt $maxDepth) {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($elm)
    $kids = @()
    while ($child -and $script:count -le $maxCount) {
      $r = Walk-Tree $child ($depth + 1) $maxDepth $maxCount
      if ($r) { $kids += $r }
      $child = $walker.GetNextSibling($child)
    }
    if ($kids.Count -gt 0) { $obj | Add-Member -NotePropertyName children -NotePropertyValue $kids }
  }
  return $obj
}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$result = Walk-Tree $root 0 3 50
if ($result) { $result | ConvertTo-Json -Compress -Depth 5 } else { '{}' }
`

const ENCODED_FOCUSED = Buffer.from(PS_FOCUSED, 'utf16le').toString('base64')
const ENCODED_TREE = Buffer.from(PS_TREE, 'utf16le').toString('base64')

// ───────────────────────── 缓存 ─────────────────────────

let focusedCache: { data: UIElementInfo | null; ts: number } = { data: null, ts: 0 }
let treeCache: { data: UITreeNode | null; ts: number } = { data: null, ts: 0 }
const FOCUSED_CACHE_MS = 3000  // 焦点元素 3 秒缓存
const TREE_CACHE_MS = 10000    // UI 树 10 秒缓存

// ───────────────────────── PowerShell 执行 ─────────────────────────

function runPs(encoded: string, timeoutMs: number, maxBuf: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: maxBuf, encoding: 'utf8' },
      (err, stdout) => {
        if (err) {
          // 超时或错误不中断，静默返回 null
          if (!/timed out/i.test(err.message)) {
            console.warn('[uia] PowerShell 调用失败:', err.message.slice(0, 100))
          }
          resolve(null)
          return
        }
        resolve(stdout.trim())
      }
    )
  })
}

// ───────────────────────── 公开 API ─────────────────────────

/**
 * 获取当前焦点 UI 元素
 * - 包含名称、控件类型、值、选中文本
 * - 3 秒缓存，避免高频调用
 * - 失败返回 null（不中断调用方）
 */
export async function getFocusedElement(): Promise<UIElementInfo | null> {
  const now = Date.now()
  if (now - focusedCache.ts < FOCUSED_CACHE_MS) {
    return focusedCache.data
  }
  const out = await runPs(ENCODED_FOCUSED, 8000, 1024 * 32)
  if (!out || out === '{}') {
    focusedCache = { data: null, ts: now }
    return null
  }
  try {
    const raw = JSON.parse(out)
    const info: UIElementInfo = {
      name: String(raw.name ?? ''),
      controlType: String(raw.controlType ?? ''),
      className: String(raw.className ?? ''),
      automationId: String(raw.automationId ?? ''),
      value: String(raw.value ?? ''),
      selectedText: String(raw.selectedText ?? ''),
      processId: Number(raw.processId ?? 0),
      isFocused: true
    }
    focusedCache = { data: info, ts: now }
    return info
  } catch {
    console.warn('[uia] 焦点元素解析失败:', out.slice(0, 120))
    focusedCache = { data: null, ts: now }
    return null
  }
}

/**
 * 获取前台窗口 UI 树（精简版）
 * - 深度 3，最多 50 个元素
 * - 10 秒缓存
 * - 仅含 ControlView（排除 RawView 中的布局容器）
 */
export async function getForegroundUITree(): Promise<UITreeNode | null> {
  const now = Date.now()
  if (now - treeCache.ts < TREE_CACHE_MS) {
    return treeCache.data
  }
  const out = await runPs(ENCODED_TREE, 15000, 1024 * 128)
  if (!out || out === '{}') {
    treeCache = { data: null, ts: now }
    return null
  }
  try {
    const tree = JSON.parse(out) as UITreeNode
    treeCache = { data: tree, ts: now }
    return tree
  } catch {
    console.warn('[uia] UI 树解析失败:', out.slice(0, 120))
    treeCache = { data: null, ts: now }
    return null
  }
}

/**
 * 生成焦点元素摘要文本（注入 presence.uiaContext）
 * 格式示例："焦点: Edit「搜索框」值: \"hello world\""
 */
export function summarizeFocusedElement(info: UIElementInfo | null): string {
  if (!info) return ''
  const parts: string[] = []
  // 控件类型简称映射
  const typeMap: Record<string, string> = {
    'Edit': '文本框',
    'Button': '按钮',
    'ComboBox': '下拉框',
    'CheckBox': '复选框',
    'RadioButton': '单选框',
    'ListItem': '列表项',
    'MenuItem': '菜单项',
    'TabItem': '标签页',
    'Hyperlink': '链接',
    'Document': '文档',
    'Text': '文本',
    'DataItem': '数据项',
    'TreeItem': '树节点'
  }
  const typeLabel = typeMap[info.controlType] ?? info.controlType ?? '元素'
  if (info.name) parts.push(`${typeLabel}「${info.name}」`)
  else parts.push(typeLabel)
  if (info.value) parts.push(`值: "${info.value.slice(0, 80)}"`)
  if (info.selectedText) parts.push(`选中: "${info.selectedText.slice(0, 60)}"`)
  return `焦点: ${parts.join(' ')}`
}

/** 清除缓存（设置变更时调用） */
export function clearUiaCache(): void {
  focusedCache = { data: null, ts: 0 }
  treeCache = { data: null, ts: 0 }
}
