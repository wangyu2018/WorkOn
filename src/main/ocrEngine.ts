/**
 * OCR 引擎抽象层 — 支持 Tesseract.js（默认回退）和 RapidOCR-json（5x 提速）
 *
 * RapidOCR-json 需要单独下载：
 *   1. 从 https://github.com/hiroi-sora/RapidOCR-json/releases 下载 Windows 版
 *   2. 解压到 assets/rapidocr/ 目录
 *   3. 内含 RapidOCR-json.exe + models/ 目录
 *
 * 引擎选择：settings.ocrEngine = 'rapidocr' | 'tesseract'
 * 自动降级：选 rapidocr 但二进制不存在时自动回退 tesseract
 */
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { getSettings } from './settings'

export interface OcrResult {
  text: string
  lines: string[]
  engine: 'tesseract' | 'rapidocr'
  elapsedMs: number
}

type OcrEngine = 'tesseract' | 'rapidocr'

let cachedEngine: OcrEngine | null = null
let rapidocrAvailable = false
let rapidocrChecked = false

/** RapidOCR-json 可执行文件路径 */
function rapidocrExePath(): string {
  // 开发环境：assets/rapidocr/RapidOCR-json.exe
  // 生产环境：resources/assets/rapidocr/RapidOCR-json.exe
  const devPath = path.join(app.getAppPath(), 'assets', 'rapidocr', 'RapidOCR-json.exe')
  if (fs.existsSync(devPath)) return devPath
  // electron-builder 打包后 assets 在 resources 下
  const prodPath = path.join(process.resourcesPath || '', 'assets', 'rapidocr', 'RapidOCR-json.exe')
  if (fs.existsSync(prodPath)) return prodPath
  return devPath // 返回开发路径（existsSync 会返回 false）
}

/** 检查 RapidOCR-json 是否可用 */
export function isRapidOCRAvailable(): boolean {
  if (rapidocrChecked) return rapidocrAvailable
  rapidocrChecked = true
  rapidocrAvailable = fs.existsSync(rapidocrExePath())
  if (rapidocrAvailable) {
    console.log('[ocrEngine] RapidOCR-json 可用:', rapidocrExePath())
  }
  return rapidocrAvailable
}

/** 获取当前使用的 OCR 引擎 */
export function getActiveEngine(): OcrEngine {
  if (cachedEngine) return cachedEngine
  const preferred = (getSettings().ocrEngine as OcrEngine) || 'rapidocr'
  if (preferred === 'rapidocr' && isRapidOCRAvailable()) {
    cachedEngine = 'rapidocr'
  } else {
    cachedEngine = 'tesseract'
    if (preferred === 'rapidocr' && !rapidocrAvailable) {
      console.warn('[ocrEngine] RapidOCR 不可用，回退 Tesseract.js')
    }
  }
  return cachedEngine
}

/** RapidOCR-json 调用：传入图片 Buffer，返回识别文本 */
function runRapidOCR(imageBuffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const exe = rapidocrExePath()
    const exeDir = path.dirname(exe)
    // RapidOCR-json 支持 stdin 模式：-i=- 表示从 stdin 读取
    // 输出格式：JSON 数组 [text, confidence, [[x1,y1],[x2,y2],...]], ...]
    const child = execFile(
      exe,
      ['-i=-', '--format=json', '--det=true', '--rec=true', '--cls=true'],
      {
        timeout: 15000,
        windowsHide: true,
        maxBuffer: 1024 * 512,
        encoding: 'utf8',
        cwd: exeDir // RapidOCR 需要在 exe 目录下运行（找 models/）
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`RapidOCR 执行失败: ${err.message}`))
          return
        }
        resolve(stdout.trim())
      }
    )
    // 通过 stdin 传入图片
    if (child.stdin) {
      child.stdin.write(imageBuffer)
      child.stdin.end()
    }
  })
}

/** 解析 RapidOCR-json 输出为文本行 */
function parseRapidOCRJson(jsonStr: string): string[] {
  try {
    const data = JSON.parse(jsonStr)
    if (!Array.isArray(data)) return []
    // 每项格式：[text, confidence, boxCoords]
    const lines: string[] = []
    for (const item of data) {
      if (Array.isArray(item) && typeof item[0] === 'string') {
        const text = item[0] as string
        if (text.trim()) lines.push(text.trim())
      }
    }
    return lines
  } catch {
    // 非 JSON 输出（可能是错误信息）
    return []
  }
}

/** 用 RapidOCR 识别图片 */
export async function recognizeWithRapidOCR(imageBuffer: Buffer): Promise<OcrResult> {
  const start = Date.now()
  const jsonOutput = await runRapidOCR(imageBuffer)
  const lines = parseRapidOCRJson(jsonOutput)
  const text = lines.join('\n')
  return {
    text,
    lines,
    engine: 'rapidocr',
    elapsedMs: Date.now() - start
  }
}

/** 引擎信息（供 UI 展示） */
export function getEngineInfo(): { engine: OcrEngine; rapidocrAvailable: boolean; rapidocrPath: string } {
  return {
    engine: getActiveEngine(),
    rapidocrAvailable: isRapidOCRAvailable(),
    rapidocrPath: rapidocrExePath()
  }
}

/** 重置引擎缓存（设置变更后调用） */
export function resetEngineCache(): void {
  cachedEngine = null
  rapidocrChecked = false
}
