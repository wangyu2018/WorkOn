/**
 * 忙时轻档（负载感知降频）：整机 CPU/内存达到可感知卡顿的水位时，
 * 主动放慢 WorkOn 的后台节奏；回落后自动恢复。
 *
 * 设计：
 * - 纯 os.cpus/os.totalmem 采样，无新依赖，5s 一采
 * - 滞回状态机防止在阈值附近反复横跳：进档连续 2 次超高位、出档连续 3 次低于低位
 * - 复用手动「性能模式」的同款旋钮（停读屏/重启监控），不碰用户手动设置
 * - 桌宠降档走 load:eco 广播，由宠物窗口自行处理
 */
import os from 'os'
import { BrowserWindow } from 'electron'
import { getSettings } from './settings'
import { stopOcr, startOcr } from './ocrWorker'
import { setWinInfoSlow, getWinInfoSleepMs } from './winInfo'

const SAMPLE_MS = 5000
const CPU_HIGH = 70 // 进档：CPU ≥ 70%
const MEM_HIGH = 85 // 或内存 ≥ 85%
const CPU_LOW = 45 // 出档：CPU ≤ 45% 且内存 ≤ 75%
const MEM_LOW = 75
const ENTER_STREAK = 2
const EXIT_STREAK = 3

export interface LoadStatus {
  cpuPercent: number
  memPercent: number
  /** normal=顺畅 high=省力中 */
  pressure: 'normal' | 'high'
  /** 当前档位起始时间 */
  sinceTs: number
  enabled: boolean
}

let lastCpus = os.cpus()
let cpuPercent = 0
let memPercent = 0
let pressure: LoadStatus['pressure'] = 'normal'
let pressureSinceTs = Date.now()
let highStreak = 0
let lowStreak = 0
let timer: ReturnType<typeof setInterval> | null = null

function sampleOnce(): void {
  const now = os.cpus()
  let idle = 0
  let total = 0
  for (let i = 0; i < now.length; i++) {
    const c = now[i].times
    const p = lastCpus[i]?.times
    if (!p) break
    idle += c.idle - p.idle
    total += c.user - p.user + (c.nice - p.nice) + (c.sys - p.sys) + (c.idle - p.idle) + (c.irq - p.irq)
  }
  lastCpus = now
  cpuPercent = total > 0 ? Math.max(0, Math.min(100, Math.round(100 - (idle / total) * 100))) : 0
  memPercent = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)

  const hot = cpuPercent >= CPU_HIGH || memPercent >= MEM_HIGH
  const cool = cpuPercent <= CPU_LOW && memPercent <= MEM_LOW
  highStreak = hot ? highStreak + 1 : 0
  lowStreak = cool ? lowStreak + 1 : 0

  if (pressure === 'normal' && highStreak >= ENTER_STREAK) setPressure('high')
  else if (pressure === 'high' && lowStreak >= EXIT_STREAK) setPressure('normal')
}

function setPressure(next: LoadStatus['pressure']): void {
  if (pressure === next) return
  pressure = next
  pressureSinceTs = Date.now()
  apply()
}

/** 当前是否处于降档（含用户手动性能模式：外部旋钮据此再叠加降频） */
export function isLoadGuardEngaged(): boolean {
  if (getSettings().performanceMode) return true
  return getSettings().loadGuardEnabled !== false && pressure === 'high'
}

/** 应用当前档位到各后台旋钮（幂等） */
function apply(): void {
  const engaged = isLoadGuardEngaged()
  const manual = getSettings().performanceMode
  // 读屏采集：降档或手动性能模式 → 停；恢复时仅在用户没开手动性能模式且开了 deepMode 时重启
  try {
    if (engaged) stopOcr()
    else if (!manual && getSettings().deepMode) startOcr()
  } catch { /* ignore */ }
  try {
    setWinInfoSlow(engaged)
  } catch { /* ignore */ }
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('load:eco', engaged)
    }
  } catch { /* ignore */ }
  console.log(`[load] 忙时轻档：${engaged ? '省力中（CPU ' + cpuPercent + '% · 内存 ' + memPercent + '%）' : '已恢复正常节奏（CPU ' + cpuPercent + '% · 内存 ' + memPercent + '%）'}`)
}

export function getLoadStatus(): LoadStatus {
  return {
    cpuPercent,
    memPercent,
    pressure,
    sinceTs: pressureSinceTs,
    enabled: getSettings().loadGuardEnabled !== false
  }
}

export function startLoadGuard(): void {
  if (timer) return
  sampleOnce()
  timer = setInterval(sampleOnce, SAMPLE_MS)
  console.log('[load] 忙时轻档已启动（5s 采样 · CPU≥70%/内存≥85% 降档）')
}

export function stopLoadGuard(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (pressure === 'high') {
    pressure = 'normal'
    pressureSinceTs = Date.now()
    apply()
  }
}
