/**
 * OCR 引擎：RapidOCR-json（主）+ Tesseract（回退）
 * RapidOCR 成功时 data 为 [{ text, score, box }, ...]，必须按数组解析。
 */
import { execFile } from 'child_process'
import os from 'os'
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

function rapidocrExePath(): string {
  const devPath = path.join(app.getAppPath(), 'assets', 'rapidocr', 'RapidOCR-json.exe')
  if (fs.existsSync(devPath)) return devPath
  const prodPath = path.join(process.resourcesPath || '', 'assets', 'rapidocr', 'RapidOCR-json.exe')
  if (fs.existsSync(prodPath)) return prodPath
  return devPath
}

export function isRapidOCRAvailable(): boolean {
  if (rapidocrChecked) return rapidocrAvailable
  rapidocrChecked = true
  rapidocrAvailable = fs.existsSync(rapidocrExePath())
  if (rapidocrAvailable) {
    console.log('[ocrEngine] RapidOCR-json 可用:', rapidocrExePath())
  }
  return rapidocrAvailable
}

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

/** 粘贴/截图预处理：保证可读分辨率，避免过糊或超大图拖垮检测 */
async function preprocessForOcr(imageBuffer: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import('sharp')).default
    const img = sharp(imageBuffer, { failOn: 'none' })
    const meta = await img.metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    let pipeline = img.rotate() // 尊重 EXIF
    // 过小（缩略图/低清截图）拉大，聊天小字才检得着
    if (w > 0 && h > 0 && Math.max(w, h) < 900) {
      pipeline = pipeline.resize({
        width: w >= h ? 1600 : undefined,
        height: h > w ? 1600 : undefined,
        fit: 'inside',
        kernel: 'lanczos3'
      })
    }
    // 极大图先缩到长边 2800，再交给 RapidOCR（其 maxSideLen 会再控）
    if (w > 0 && h > 0 && Math.max(w, h) > 3200) {
      pipeline = pipeline.resize({
        width: w >= h ? 2800 : undefined,
        height: h > w ? 2800 : undefined,
        fit: 'inside',
        withoutEnlargement: true
      })
    }
    return await pipeline
      .ensureAlpha()
      .removeAlpha()
      .png({ compressionLevel: 1 })
      .toBuffer()
  } catch (e) {
    console.warn('[ocrEngine] preprocess failed, use raw', e)
    return imageBuffer
  }
}

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

    // 粘贴聊天截图：提高 maxSideLen、降低框阈值、加大 padding/unClip
    const args = [
      '--models=.',
      '--det=ch_PP-OCRv4_det_infer.onnx',
      '--cls=ch_ppocr_mobile_v2.0_cls_infer.onnx',
      '--rec=rec_ch_PP-OCRv4_infer.onnx',
      '--keys=ppocr_keys_v1.txt',
      '--padding=80',
      '--maxSideLen=2560',
      '--boxScoreThresh=0.35',
      '--boxThresh=0.3',
      '--unClipRatio=2.0',
      '--doAngle=1',
      '--mostAngle=1',
      '--numThread=4',
      `--image_path=${tmpFile}`
    ]

    execFile(
      exe,
      args,
      {
        timeout: 60000,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 4,
        encoding: 'utf8',
        cwd: exeDir
      },
      (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
        if (err && !stdout) {
          reject(new Error(`RapidOCR 执行失败: ${err.message}${stderr ? ` | ${stderr}` : ''}`))
          return
        }
        resolve(String(stdout ?? '').trim())
      }
    )
  })
}

type RapidBox = { text?: string; score?: number; box?: number[][] }

/** 解析 RapidOCR-json：data 可能是行数组或纯字符串 */
export function parseRapidOCRJson(jsonStr: string): string[] {
  const raw = String(jsonStr ?? '').trim()
  if (!raw) return []
  // 输出常带 "OCR init completed." 前缀；必须从根对象 {"code":...} 起解析，
  // 不能 lastIndexOf('{')（会误切到 data[] 里的子对象）
  let payload = raw
  const codeAt = raw.search(/\{\s*"code"\s*:/)
  if (codeAt >= 0) payload = raw.slice(codeAt)
  else {
    const start = raw.indexOf('{')
    if (start >= 0) payload = raw.slice(start)
  }

  try {
    const data = JSON.parse(payload) as {
      code?: number
      data?: string | RapidBox[] | null
    }
    if (!data || typeof data.code !== 'number') return []
    // 100 = 成功；其它多为无字/路径错误
    if (data.code !== 100) {
      console.warn('[ocrEngine] RapidOCR code', data.code, typeof data.data === 'string' ? data.data : '')
      return []
    }

    if (typeof data.data === 'string') {
      return data.data.split(/\n/).map((l) => l.trim()).filter(Boolean)
    }

    if (Array.isArray(data.data)) {
      const rows = data.data
        .map((item, idx) => {
          const text = String(item?.text ?? '').trim()
          const box = item?.box
          const y =
            Array.isArray(box) && box[0] && typeof box[0][1] === 'number'
              ? box[0][1]
              : idx
          const x =
            Array.isArray(box) && box[0] && typeof box[0][0] === 'number'
              ? box[0][0]
              : 0
          const score = typeof item?.score === 'number' ? item.score : 1
          return { text, y, x, score }
        })
        .filter((r) => r.text.length > 0 && r.score >= 0.25)
        // 阅读顺序：先上后下，同行按左到右
        .sort((a, b) => (Math.abs(a.y - b.y) < 12 ? a.x - b.x : a.y - b.y))

      return rows.map((r) => r.text)
    }
    return []
  } catch (e) {
    console.warn('[ocrEngine] parse RapidOCR JSON failed', e)
    return []
  }
}

export async function recognizeWithRapidOCR(imageBuffer: Buffer): Promise<OcrResult> {
  const start = Date.now()
  const prepared = await preprocessForOcr(imageBuffer)
  const jsonOutput = await runRapidOCR(prepared)
  const lines = parseRapidOCRJson(jsonOutput)
  const text = lines.join('\n')
  if (!text) {
    console.warn('[ocrEngine] RapidOCR empty text, raw head:', jsonOutput.slice(0, 180))
  } else {
    console.log('[ocrEngine] RapidOCR ok', { lines: lines.length, chars: text.length, ms: Date.now() - start })
  }
  return {
    text,
    lines,
    engine: 'rapidocr',
    elapsedMs: Date.now() - start
  }
}

/** 统一入口：RapidOCR → 不足时 Tesseract 补救 */
export async function recognizePngBuffer(imageBuffer: Buffer): Promise<OcrResult & { error?: string }> {
  const start = Date.now()
  if (!imageBuffer?.length) {
    return { text: '', lines: [], engine: 'rapidocr', elapsedMs: 0, error: '空图片' }
  }

  if (isRapidOCRAvailable()) {
    try {
      const r = await recognizeWithRapidOCR(imageBuffer)
      if (r.text.trim().length >= 2) return r
    } catch (e) {
      console.warn('[ocrEngine] RapidOCR failed', e)
    }
  }

  try {
    const prepared = await preprocessForOcr(imageBuffer)
    const mod = await import('tesseract.js')
    const recognize =
      (mod as { recognize?: typeof import('tesseract.js').recognize }).recognize
      ?? (mod as { default: { recognize: typeof import('tesseract.js').recognize } }).default.recognize
    const { data } = await recognize(prepared, 'chi_sim+eng', {
      // @ts-expect-error tesseract options
      tessedit_pageseg_mode: '6',
      workerPath: path.join(app.getAppPath(), 'assets', 'tesseractWorker.js'),
      langPath: path.join(app.getAppPath(), 'assets'),
      gzip: false,
      cacheMethod: 'read'
    })
    const text = (data?.text ?? '').trim()
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean)
    return {
      text,
      lines,
      engine: 'tesseract',
      elapsedMs: Date.now() - start,
      error: text ? undefined : '未识别到文字'
    }
  } catch (e) {
    return {
      text: '',
      lines: [],
      engine: 'tesseract',
      elapsedMs: Date.now() - start,
      error: (e as Error).message
    }
  }
}

export function getEngineInfo(): { engine: OcrEngine; rapidocrAvailable: boolean; rapidocrPath: string } {
  return {
    engine: getActiveEngine(),
    rapidocrAvailable: isRapidOCRAvailable(),
    rapidocrPath: rapidocrExePath()
  }
}

export function resetEngineCache(): void {
  cachedEngine = null
  rapidocrChecked = false
}
