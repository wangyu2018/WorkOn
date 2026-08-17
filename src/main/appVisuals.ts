/**
 * 应用视觉元数据 —— 自动提取应用图标 + 主题色并持久化
 * 依据：监控识别到新应用时，从进程 exe 提取真实图标，计算主题色，缓存到 userData/app-visuals.json
 * 渲染层（星图/时间轴等）用真实图标和主题色替代 emoji / 默认色
 */
import { app, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'

export interface AppVisual {
  iconDataUrl: string // 32×32 PNG dataURL
  themeColor: string // 主题色 hex，如 #22D3EE
}

let cache: Record<string, AppVisual> | null = null

function visualsFile(): string {
  return path.join(app.getPath('userData'), 'app-visuals.json')
}

function load(): Record<string, AppVisual> {
  if (cache) return cache
  try {
    const raw = JSON.parse(fs.readFileSync(visualsFile(), 'utf8')) as Record<string, AppVisual>
    // 兼容旧数据：key 可能是带 .exe 的，规范化去后缀
    cache = {}
    for (const [k, v] of Object.entries(raw)) {
      const nk = normalizeKey(k)
      if (nk) cache[nk] = v
    }
  } catch {
    cache = {}
  }
  return cache
}

function save(): void {
  try {
    fs.writeFileSync(visualsFile(), JSON.stringify(cache ?? {}))
  } catch (e) {
    console.warn('[appVisuals] 写入失败:', (e as Error).message)
  }
}

/** 从图标位图计算主题色（排除透明/近白近黑，加权平均后取饱和色） */
function dominantColor(img: Electron.NativeImage): string {
  try {
    const small = img.resize({ width: 16, height: 16 })
    const buf = small.toBitmap() // BGRA
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i + 3 < buf.length; i += 4) {
      const bv = buf[i], gv = buf[i + 1], rv = buf[i + 2], av = buf[i + 3]
      if (av < 128) continue
      const max = Math.max(rv, gv, bv), min = Math.min(rv, gv, bv)
      // 跳过近灰/近白/近黑（避免把白色背景当成主题色）
      if (max - min < 30) continue
      if (max > 240 && min > 200) continue
      if (max < 24) continue
      r += rv; g += gv; b += bv; n++
    }
    if (n === 0) {
      // 无彩色像素则退回最亮的不透明像素
      let best = 0
      for (let i = 0; i + 3 < buf.length; i += 4) {
        const av = buf[i + 3], rv = buf[i + 2], gv = buf[i + 1], bv = buf[i]
        if (av < 128) continue
        if (rv + gv + bv > best) { best = rv + gv + bv; r = rv; g = gv; b = bv }
      }
    } else {
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n)
    }
    const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
    return `#${hex(r)}${hex(g)}${hex(b)}`
  } catch {
    return '#22D3EE'
  }
}

/** 提取并缓存某应用的图标+主题色；已缓存则直接返回。aliasKey 用于写友好名别名（渲染层用 seg.mainApp=appName 匹配） */
export async function captureAppVisual(appKey: string, exePath?: string, aliasKey?: string): Promise<AppVisual | null> {
  const key = normalizeKey(appKey)
  if (!key) return null
  const all = load()
  // 进程名 key 已缓存：补写别名即可（避免重复提取）
  if (all[key]) {
    if (aliasKey) {
      const alias = normalizeKey(aliasKey)
      if (alias && alias !== key && !all[alias]) {
        all[alias] = all[key]
        save()
      }
    }
    return all[key]
  }
  try {
    const icon = exePath ? await app.getFileIcon(exePath, { size: 'large' }) : null
    if (!icon || icon.isEmpty()) return null
    const visual: AppVisual = {
      iconDataUrl: icon.resize({ width: 32, height: 32 }).toDataURL(),
      themeColor: dominantColor(icon)
    }
    all[key] = visual
    if (aliasKey) {
      const alias = normalizeKey(aliasKey)
      if (alias && alias !== key) all[alias] = visual
    }
    save()
    return visual
  } catch {
    return null
  }
}

/** 统一 key：小写去 .exe，与渲染层/displayApp 口径一致 */
export function normalizeKey(app: string): string {
  return (app || '').trim().toLowerCase().replace(/\.exe$/i, '')
}

/** 读取全部已缓存的应用视觉元数据（renderer 查询用） */
export function getAllAppVisuals(): Record<string, AppVisual> {
  return load()
}

/** 移除某个应用的视觉缓存（隐私排除时顺带清理） */
export function removeAppVisual(appKey: string): void {
  const key = normalizeKey(appKey)
  if (!key) return
  const all = load()
  if (all[key]) {
    delete all[key]
    save()
  }
}
