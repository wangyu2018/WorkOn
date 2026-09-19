/**
 * 硬件等级检测 — 启动时探测 GPU/CPU/RAM，自动选择功能降级策略
 *
 * 等级定义：
 *   L0 入门：核显 + ≤8GB RAM → eco 档桌宠, RapidOCR CPU, 云端 mini
 *   L1 中端：独显 4-6GB / 16GB RAM → smooth 档, RapidOCR CPU, 多模型路由
 *   L2 高端：独显 8GB+ / 32GB RAM → ultra 档, 可选 GPU OCR, 本地 LLM 回退
 */
import { execFile } from 'child_process'
import os from 'os'
import { getSettings, setSettings } from './settings'

export type HardwareTier = 'L0' | 'L1' | 'L2'

export interface HardwareInfo {
  tier: HardwareTier
  cpuModel: string
  cpuCores: number
  ramGB: number
  gpuModel: string
  gpuVRAMGB: number // 0 = 核显或无法检测
  hasDiscreteGPU: boolean
}

// PowerShell 脚本：获取 GPU 信息（复用 winInfo.ts 的 EncodedCommand 模式）
const PS_GPU_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class GPU {
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr hDC, int nIndex);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
}
"@
$gpu = Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$gpu | ConvertTo-Json -Compress
`

const ENCODED_GPU = Buffer.from(PS_GPU_SCRIPT, 'utf16le').toString('base64')

let cachedInfo: HardwareInfo | null = null

/** 运行 PowerShell 获取 GPU 信息 */
function queryGPU(): Promise<{ name: string; vramBytes: number }[]> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_GPU],
      { timeout: 10000, windowsHide: true, maxBuffer: 1024 * 64, encoding: 'utf8' },
      (err, stdout) => {
        if (err) {
          console.warn('[hardwareDetect] GPU 检测失败:', err.message)
          resolve([])
          return
        }
        try {
          const raw = stdout.trim()
          if (!raw || raw === 'null') return resolve([])
          const data = JSON.parse(raw)
          const arr = Array.isArray(data) ? data : [data]
          const gpus = arr
            .filter((d: { Name?: string }) => d?.Name)
            .map((d: { Name: string; AdapterRAM?: number }) => ({
              name: String(d.Name),
              vramBytes: Math.max(0, Number(d.AdapterRAM ?? 0))
            }))
          resolve(gpus)
        } catch {
          resolve([])
        }
      }
    )
  })
}

/** 判断是否为核显 */
function isIntegratedGPU(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.includes('intel') &&
    (lower.includes('uhd') || lower.includes('iris') || lower.includes('hd graphics') || lower.includes('arc'))
  ) || lower.includes('amd radeon(tm) graphics') ||
    lower.includes('amd radeon graphics') ||
    lower.includes('microsoft basic render')
}

/** 从 GPU 名称估算显存（AdapterRAM 在 >4GB 时会溢出为负数，需要从名称估算） */
function estimateVRAM(name: string, reportedBytes: number): number {
  // WMI 的 AdapterRAM 是 32 位上限（≥4GB 全报 4GB），已知型号先按名称查表
  const lower = name.toLowerCase()
  const known = [
    ['rtx 4090', 24], ['rtx 4080', 16], ['rtx 4070 ti', 16], ['rtx 4070', 12],
    ['rtx 4060 ti', 16], ['rtx 4060', 8], ['rtx 3090', 24], ['rtx 3080', 10],
    ['rtx 3070', 8], ['rtx 3060', 12], ['rtx 3050', 8],
    ['rx 7900', 24], ['rx 7800', 16], ['rx 6800', 16], ['rx 6900', 16],
    ['rx 6700', 8], ['rx 6600', 8]
  ] as [string, number][]
  for (const [key, gb] of known) {
    if (lower.includes(key)) return gb
  }
  // 名称带显存标注（如 "8GB"）直接取
  const m = lower.match(/(\d+)\s*(gb|g)/)
  if (m) return parseInt(m[1], 10)
  // 未知型号：WMI 上报值合理（1-16GB）就用
  if (reportedBytes > 512 * 1024 * 1024 && reportedBytes < 32 * 1024 * 1024 * 1024) {
    return Math.round(reportedBytes / (1024 * 1024 * 1024))
  }
  // 核显或未知
  return 0
}

/** 计算硬件等级 */
function calculateTier(ramGB: number, hasDiscreteGPU: boolean, gpuVRAMGB: number): HardwareTier {
  // L2 高端：独显 8GB+ 且 30GB+ RAM（32GB 条实际可见 31.x，四舍五入后别差 1GB 掉档）
  if (hasDiscreteGPU && gpuVRAMGB >= 8 && ramGB >= 30) return 'L2'
  // L1 中端：独显 4GB+ 或 16GB+ RAM
  if ((hasDiscreteGPU && gpuVRAMGB >= 4) || ramGB >= 16) return 'L1'
  // L0 入门：其余
  return 'L0'
}

/** 检测硬件信息（缓存结果，只跑一次） */
export async function detectHardware(): Promise<HardwareInfo> {
  if (cachedInfo) return cachedInfo

  const cpuModel = os.cpus()[0]?.model ?? 'Unknown CPU'
  const cpuCores = os.cpus().length
  const ramGB = Math.round(os.totalmem() / (1024 * 1024 * 1024))

  const gpus = await queryGPU()
  // 虚拟显示适配（向日葵 OrayIdd/远程串流等）不是真独显，排除掉避免污染等级判定
  const VIRTUAL_GPU_HINTS = ['idd', 'oray', 'virtual', 'indirect', 'basic render', 'hyper-v', 'vmware', 'vbox', 'parsec', 'mirror']
  const isVirtual = (name: string): boolean => {
    const low = name.toLowerCase()
    return VIRTUAL_GPU_HINTS.some((h) => low.includes(h))
  }
  // 找独显（非核显且非虚拟适配的第一个）
  const discreteGPU = gpus.find((g) => !isIntegratedGPU(g.name) && !isVirtual(g.name))
  const gpuModel = discreteGPU?.name ?? gpus[0]?.name ?? 'Unknown GPU'
  const gpuVRAMGB = discreteGPU ? estimateVRAM(discreteGPU.name, discreteGPU.vramBytes) : 0
  const hasDiscreteGPU = !!discreteGPU

  const tier = calculateTier(ramGB, hasDiscreteGPU, gpuVRAMGB)

  cachedInfo = {
    tier,
    cpuModel,
    cpuCores,
    ramGB,
    gpuModel,
    gpuVRAMGB,
    hasDiscreteGPU
  }

  console.log(`[hardwareDetect] 硬件等级: ${tier} | CPU: ${cpuModel} (${cpuCores}核) | RAM: ${ramGB}GB | GPU: ${gpuModel} (${gpuVRAMGB}GB VRAM)`)

  // 写入 settings（用户可手动覆盖）
  const settings = getSettings()
  if (!settings.hardwareTier || settings.hardwareTier !== tier) {
    const config = getTierConfig()
    setSettings({
      hardwareTier: tier,
      // 自动设置 VRM 路径（如果用户未手动指定 petVrmPath）
      ...(settings.petVrmPath ? {} : { petVrmPath: config.vrmModelPath }),
      // 自动设置帧率档位（用户在设置里手动改过档位后不再接管）
      ...(settings.petFpsTierAuto === false ? {} : { petFpsTier: config.petFpsTier })
    } as Partial<typeof settings>)
    // 分级变更即时推送（桌宠/模型懒加载完才探测完毕——首启不再等第二次启动）
    void (async () => {
      try {
        const { sendTo } = await import('./windows')
        const after = getSettings()
        sendTo('pet', 'pet:settings', { petFpsTier: after.petFpsTier ?? config.petFpsTier })
        if (!settings.petVrmPath) sendTo('pet', 'pet:reloadVrm')
      } catch { /* 窗口未就绪忽略 */ }
    })()
  }

  return cachedInfo
}

/** 获取缓存的硬件信息（未检测时返回 null） */
export function getHardwareInfo(): HardwareInfo | null {
  return cachedInfo
}

/** 获取当前硬件等级（未检测时返回 L1 作为安全默认值） */
export function getHardwareTier(): HardwareTier {
  return cachedInfo?.tier ?? (getSettings().hardwareTier as HardwareTier) ?? 'L1'
}

/**
 * 根据硬件等级获取功能配置
 * 各模块读取此配置决定启用/禁用功能
 */
export function getTierConfig(): {
  petFpsTier: 'eco' | 'standard' | 'smooth' | 'ultra'
  ocrUseGPU: boolean
  enableLivePortrait: boolean
  enableLocalLLM: boolean
  enableStreamingTTS: boolean
  maxConcurrentOCR: number
  particleDensity: 'low' | 'medium' | 'high'
  vrmModelPath: string // 硬件等级决定加载哪个 VRM 模型
} {
  const tier = getHardwareTier()
  switch (tier) {
    case 'L0':
      return {
        petFpsTier: 'eco',
        ocrUseGPU: false,
        enableLivePortrait: false,
        enableLocalLLM: false,
        enableStreamingTTS: false,
        maxConcurrentOCR: 1,
        particleDensity: 'low',
        vrmModelPath: 'vrm/peier-compressed.vrm' // 9MB 压缩版
      }
    case 'L1':
      return {
        petFpsTier: 'smooth',
        ocrUseGPU: false,
        enableLivePortrait: false,
        enableLocalLLM: false,
        enableStreamingTTS: true,
        maxConcurrentOCR: 2,
        particleDensity: 'medium',
        vrmModelPath: 'vrm/peier-compressed.vrm' // 9MB 压缩版
      }
    case 'L2':
      return {
        petFpsTier: 'ultra',
        ocrUseGPU: true,
        enableLivePortrait: true,
        enableLocalLLM: true,
        enableStreamingTTS: true,
        maxConcurrentOCR: 3,
        particleDensity: 'high',
        vrmModelPath: 'vrm/peier.vrm' // 21MB 原版高清
      }
  }
}
