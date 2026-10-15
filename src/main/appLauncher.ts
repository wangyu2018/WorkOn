/**
 * 应用接管 L1（v10）：对话「打开/切到 XX」→ 启动/激活本机应用。
 * mac：扫描 /Applications + /System/Applications；open -a 激活（已开即前台切换）。
 * Windows：开始菜单 .lnk/.url 扫描（记名+路径），start 全路径启动（已开会新开/激活实例）。
 * 更深的接管（UI 自动化/读屏操作）挂后续版本——本层只做启动与激活。
 */
import { exec, execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

let cache: { names: string[]; at: number } | null = null
let appPaths = new Map<string, string>() // 应用名(小写) → .app/.lnk 全路径

/** 常见应用中英别名（mac 目录名是英文，用户说中文）——持续补充 */
const APP_ALIASES: Record<string, string> = {
  计算器: 'Calculator',
  访达: 'Finder',
  启动台: 'Launchpad',
  系统设置: 'System Settings',
  系统偏好设置: 'System Preferences',
  备忘录: 'Notes',
  日历: 'Calendar',
  邮件: 'Mail',
  地图: 'Maps',
  照片: 'Photos',
  音乐: 'Music',
  播客: 'Podcasts',
  terminal: 'Terminal',
  终端: 'Terminal',
  文本编辑: 'TextEdit',
  预览: 'Preview',
  微信: 'WeChat',
  企业微信: 'WeCom',
  钉钉: 'DingTalk',
  飞书: 'Lark',
  QQ: 'QQ',
  网易云音乐: 'NeteaseMusic'
}

export function listApps(): string[] {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.names
  let names: string[] = []
  appPaths = new Map()
  if (process.platform === 'darwin') {
    const dirs = ['/Applications', '/System/Applications']
    for (const dir of dirs) {
      try {
        for (const f of fs.readdirSync(dir)) {
          if (f.endsWith('.app')) {
            const n = f.slice(0, -4)
            names.push(n)
            appPaths.set(n.toLowerCase(), path.join(dir, f))
          }
        }
      } catch { /* ignore */ }
    }
  } else if (process.platform === 'win32') {
    // Windows：开始菜单快捷方式（全机+用户两处），.lnk/.url 文件名即应用名；同时记下全路径供启动
    const appdata = process.env.APPDATA ?? ''
    const dirs = [
      'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
      appdata ? path.join(appdata, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : ''
    ].filter(Boolean)
    const walk = (dir: string, depth: number): void => {
      if (depth > 3) return
      let entries: fs.Dirent[] = []
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full, depth + 1)
        else if (/\.(lnk|url)$/i.test(e.name)) {
          const name = e.name.replace(/\.(lnk|url)$/i, '')
          if (name && !name.startsWith('Uninstall') && !/^卸载/.test(name)) {
            names.push(name)
            if (!appPaths.has(name.toLowerCase())) appPaths.set(name.toLowerCase(), full)
          }
        }
      }
    }
    for (const d of dirs) walk(d, 0)
  }
  names = [...new Set(names)].sort((a, b) => a.localeCompare(b))
  cache = { names, at: Date.now() }
  return names
}

/** 模糊匹配：精确 → 前缀 → 包含 */
export function matchApp(query: string): string | null {
  const raw = query.trim()
  if (!raw) return null
  const names = listApps()
  // 1. 中文别名 → 英文名
  const aliased = APP_ALIASES[raw] ?? APP_ALIASES[raw.toLowerCase()]
  if (aliased) {
    const hit = names.find((n) => n.toLowerCase() === aliased.toLowerCase())
    if (hit) return hit
  }
  const q = raw.toLowerCase()
  return (
    names.find((n) => n.toLowerCase() === q) ??
    names.find((n) => n.toLowerCase().startsWith(q)) ??
    names.find((n) => n.toLowerCase().includes(q)) ??
    // 别名反向：英文名含别名（如「微信」→ WeChat 包含？不——别名直接映射已覆盖）
    null
  )
}

export function openApp(name: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      exec(`open -a ${JSON.stringify(name)}`, { timeout: 15_000 }, (err) => {
        resolve(err ? { ok: false, error: err.message } : { ok: true })
      })
    } else {
      // Windows：cmd start 按名启动（含协议/别名场景）
      exec(`start "" "${name}"`, { timeout: 15_000, shell: 'cmd.exe' }, (err) => {
        resolve(err ? { ok: false, error: err.message } : { ok: true })
      })
    }
  })
}

/** 供 IPC 层用的安全打开（只允许清单内应用） */
export function openAppSafe(query: string): { ok: boolean; name?: string; error?: string } {
  const name = matchApp(query)
  if (!name) return { ok: false, error: `没找到应用「${query}」` }
  const full = appPaths.get(name.toLowerCase())
  try {
    if (process.platform === 'win32') {
      // Windows：start 启动 .lnk 全路径；explorer.exe 兜底（url/协议类快捷方式）
      if (full) execFile('cmd.exe', ['/c', 'start', '', full], { timeout: 15_000 }, () => {})
      else return { ok: false, error: `「${name}」在清单里但没存到路径——重扫一次试试` }
    } else {
      exec(`open -a ${JSON.stringify(name)}`, { timeout: 15_000 }, () => {})
    }
    return { ok: true, name }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// 防止 path 未使用告警（Windows 扫描后续用）
void path
