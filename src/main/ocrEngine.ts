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
import os from 'os'
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
  const devPath = path.join(app.getAppPath(), 'assets', 'rapidocr', 'RapidOCR-json.exe')
  if (fs.existsSync(devPath)) return devPath
  const prodPath = path.join(process.resourcesPath || '', 'assets', 'rapidocr', 'RapidOCR-json.exe')
  if (fs.existsSync(prodPath)) return prodPath
  return devPath
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

/** RapidOCR-json 调用：写入临时文件 → 传入路径识别 */
function runRapidOCR(imageBuffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const exe = rapidocrExePath()
    const exeDir = path.dirname(exe)
    const tmpFile = path.join(os.tmpdir(), `rapidocr_${Date.now()}_${Math.random().toString(36).slice(2)}.png`)

    try {
      fs.writeFileSync(tmpFile, imageBuffer)
    } catch (e) {
      reject(new Error(`RapidOCR 写临时文件失败: ${(e as Error).message}`))
      return
    }

    execFile(
      exe,
      [
        '--models=.',
        `--det=ch_PP-OCRv4_det_infer.onnx`,
        `--cls=ch_ppocr_mobile_v2.0_cls_infer.onnx`,
        `--rec=rec_ch_PP-OCRv4_infer.onnx`,
        `--keys=ppocr_keys_v1.txt`,
        `--image_path=${tmpFile}`
      ],
      {
        timeout: 15000,
        windowsHide: true,
        maxBuffer: 1024 * 512,
        encoding: 'utf8',
        cwd: exeDir
      },
      (err, stdout, _stderr) => {
        try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
        if (err) {
          reject(new Error(`RapidOCR 执行失败: ${err.message}`))
          return
        }
        resolve(stdout.trim())
      }
    )
  })
}

/** 解析 RapidOCR-json 输出为文本行
 *  输出格式：{"code":100,"data":"第一行\n第二行"} 或 {"code":101,"data":"No text found in image."} */
function parseRapidOCRJson(jsonStr: string): string[] {
  try {
    const data = JSON.parse(jsonStr)
    if (!data || typeof data.code !== 'number') return []

    if (data.code !== 100) return []

    const text = typeof data.data === 'string' ? data.data : ''
    return text.split('\n').map((l: string) => l.trim()).filter(Boolean)
  } catch {
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
