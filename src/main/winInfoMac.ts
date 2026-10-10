/**
 * macOS 窗口采集（winInfo 的 darwin 分支，v10 采集跨平台化）
 * - 采集器：tools/wininfo-mac.swift → swiftc 编译（dev 首次自动编译到 tools/）
 * - 模式：常驻 loop（JSONL 行输出，等价 PowerShell 常驻服务器）
 * - 权限：辅助功能（AX 标题）/ 屏幕录制（CGWindowName 标题）；无权限时 app 名仍可用
 * - 只记元数据（app/标题/矩形），永不读内容——隐私红线与 Windows 侧一致
 */
import { spawn, execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { ForegroundWindowInfo } from '@shared/types'

interface MacWin {
  app: string
  title: string
  x: number
  y: number
  width: number
  height: number
  screen: number
  exePath?: string
}
interface MacPayload {
  fg: MacWin | null
  pointer: MacWin | null
  tops: MacWin[]
  ax: boolean
  screen: boolean
}

let server: ReturnType<typeof spawn> | null = null
let buffer = ''
let fgCache: ForegroundWindowInfo | null = null
let pointerCache: ForegroundWindowInfo | null = null
let pointerCacheAt = 0
let topsCache: ForegroundWindowInfo[] = []
let lastPerms = { ax: false, screen: false }
let binaryPath = ''

function toFG(w: MacWin | null): ForegroundWindowInfo | null {
  if (!w || !w.app) return null
  return {
    app: w.app,
    title: w.title ?? '',
    x: w.x,
    y: w.y,
    width: w.width,
    height: w.height,
    screen: w.screen ?? 0,
    exePath: w.exePath
  }
}

/** 编译采集器（无二进制时一次性 swiftc；编译失败返回 null → 上层降级） */
function ensureBinary(): string | null {
  if (binaryPath) return fs.existsSync(binaryPath) ? binaryPath : null
  const candidates = [
    path.join(process.cwd(), 'tools', 'wininfo-mac'),
    path.join(process.resourcesPath ?? '', 'tools', 'wininfo-mac')
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      binaryPath = c
      return c
    }
  }
  const src = path.join(process.cwd(), 'tools', 'wininfo-mac.swift')
  const out = path.join(process.cwd(), 'tools', 'wininfo-mac')
  if (!fs.existsSync(src)) return null
  try {
    // 同步编译一次（约 5-20s，只发生一次；后续走缓存二进制）
    require('child_process').execSync(`swiftc -O -o "${out}" "${src}"`, { stdio: 'pipe', timeout: 120_000 })
    binaryPath = out
    console.info('[winInfoMac] 采集器编译完成:', out)
    return out
  } catch (e) {
    console.warn('[winInfoMac] swiftc 编译失败（无 Xcode CLT？）', e)
    return null
  }
}

export function macCheckPermissions(): { ax: boolean; screen: boolean } {
  const bin = ensureBinary()
  if (!bin) return { ax: false, screen: false }
  try {
    const out = require('child_process').execFileSync(bin, ['check'], { timeout: 10_000 }).toString()
    const p = JSON.parse(out) as { ax: boolean; screen: boolean }
    lastPerms = p
    return p
  } catch {
    return lastPerms
  }
}

function handleLine(line: string): void {
  try {
    const p = JSON.parse(line) as MacPayload
    if (p.ax !== undefined) lastPerms = { ax: p.ax, screen: p.screen }
    fgCache = toFG(p.fg)
    if (p.pointer) {
      pointerCache = toFG(p.pointer)
      pointerCacheAt = Date.now()
    }
    topsCache = (p.tops ?? []).map((t) => toFG(t)).filter((t): t is ForegroundWindowInfo => !!t)
  } catch { /* 半行/坏行忽略 */ }
}

export function macStartServer(sleepMs = 1000): void {
  if (server) return
  const bin = ensureBinary()
  if (!bin) {
    console.warn('[winInfoMac] 无可用采集器，窗口采集停用（mac 降级）')
    return
  }
  const proc = spawn(bin, ['loop', String(sleepMs)], { stdio: ['ignore', 'pipe', 'pipe'] })
  server = proc
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
    if (s) console.warn('[winInfoMac][cli]', s.slice(0, 160))
  })
  proc.on('error', (e) => {
    console.warn('[winInfoMac] spawn 失败:', e.message)
    server = null
  })
  proc.on('exit', (code) => {
    server = null
    console.warn(`[winInfoMac] 采集进程退出 code=${code}，5s 后重试`)
    setTimeout(() => macStartServer(sleepMs), 5000)
  })
  console.info('[winInfoMac] 常驻采集已启动（mac · frontmost+AX/CGWindowName）')
}

export function macStop(): void {
  if (server) {
    try {
      server.kill()
    } catch { /* ignore */ }
    server = null
  }
}

export async function macGetForegroundWindow(): Promise<ForegroundWindowInfo | null> {
  if (!server) macStartServer()
  // 保鲜：缓存超过 10s 视为过期（CLI 静默失败时不拿旧窗口充数）
  if (fgCache && Date.now() - pointerCacheAt > 10_000 && !server) return null
  return fgCache
}

export function macGetPointerWindow(): ForegroundWindowInfo | null {
  if (pointerCache && Date.now() - pointerCacheAt > 10_000) return null
  return pointerCache
}

export function macGetTopWindows(): ForegroundWindowInfo[] {
  return topsCache
}

export function macLastPermissions(): { ax: boolean; screen: boolean } {
  return lastPerms
}
