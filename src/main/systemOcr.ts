/**
 * 系统 OCR 桥（Windows.Media.Ocr）：OS 级识别，Windows 内部自走硬件加速，
 * WorkOn 进程几乎零 CPU 占用。多机器适配 = 启动探测 + 分级回落：
 *   探测可用（含中文语言包）→ 系统快扫
 *   缺语言包 / API 缺失 / 连续失败 3 次 → 回落 RapidOCR / Tesseract（ocrEngine.ts 兜底）
 */
import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

export interface SystemOcrProbe {
  available: boolean
  /** 首选语言 tag（zh-Hans 优先，其次 en，再次第一个可用） */
  lang: string | null
  /** 可用语言列表（诊断用） */
  tags: string[]
}

let cachedProbe: SystemOcrProbe | null = null
let consecutiveFailures = 0
const MAX_CONSECUTIVE_FAILURES = 3

const PS_PROBE = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
  $langs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
  if ($langs.Count -eq 0) { 'null' } else {
    $tags = (@($langs | ForEach-Object { $_.LanguageTag }) -join ',')
    $pref = @($langs | Where-Object { $_.LanguageTag -like 'zh-Hans*' })[0]
    if (-not $pref) { $pref = @($langs | Where-Object { $_.LanguageTag -like 'en*' })[0] }
    if (-not $pref) { $pref = $langs[0] }
    "OK " + $pref.LanguageTag + "|" + $tags
  }
} catch { 'null' }
`
const ENCODED_PROBE = Buffer.from(PS_PROBE, 'utf16le').toString('base64')

const PS_RECOGNIZE = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
  [Windows.Globalization.Language,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
  [Windows.Storage.StorageFile,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null

  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
  function Await($op, $type) {
    $m = $asTask.MakeGenericMethod($type)
    $t = $m.Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    $t.Result
  }

  $lang = $env:WORKON_OCR_LANG
  $engine = if ($lang) {
    [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($lang))
  } else {
    [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
  if (-not $engine) { throw 'ocr engine unavailable' }

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:WORKON_OCR_FILE)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @($result.Lines | ForEach-Object { $_.Text })
  [Console]::Out.WriteLine((ConvertTo-Json @{ text = $result.Text; lines = $lines } -Compress))
} catch {
  [Console]::Out.WriteLine('null')
}
`
const ENCODED_RECOGNIZE = Buffer.from(PS_RECOGNIZE, 'utf16le').toString('base64')

function runPs(script: string, env: Record<string, string>, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8', env: { ...process.env, ...env } },
      (err, stdout) => resolve(err ? '' : (stdout || '').trim())
    )
  })
}

/** 探测一次并缓存：系统 OCR 是否可用 + 首选语言 */
export function probeSystemOcr(): Promise<SystemOcrProbe> {
  if (cachedProbe) return Promise.resolve(cachedProbe)
  return (async () => {
    const out = await runPs(ENCODED_PROBE, {}, 8000)
    const m = /^OK ([^\s|]+)\|(.*)$/.exec(out)
    cachedProbe = m
      ? { available: true, lang: m[1], tags: m[2] ? m[2].split(',').filter(Boolean) : [] }
      : { available: false, lang: null, tags: [] }
    console.log(`[systemOcr] 探测：${cachedProbe.available ? `可用（${cachedProbe.lang}）` : '不可用，走精细引擎'}${cachedProbe.tags.length ? ' · 语言: ' + cachedProbe.tags.join(',') : ''}`)
    return cachedProbe
  })()
}

/** 当前是否可用（含会话内熔断：连续失败 3 次后本会话停用） */
export function systemOcrAvailable(): boolean {
  if (cachedProbe) return cachedProbe.available && consecutiveFailures < MAX_CONSECUTIVE_FAILURES
  return false
}

/** 探测 OK 后的实际可用性（探测是异步的，引擎选择前先确保已探测） */
export async function ensureSystemOcrReady(): Promise<boolean> {
  if (!cachedProbe) await probeSystemOcr()
  return systemOcrAvailable()
}

/** 识别 png buffer：临时落盘 → WinRT 桥 → 文本+行；失败返回 null（调用方回落） */
export async function recognizeWithSystemOcr(imageBuffer: Buffer): Promise<{ text: string; lines: string[]; elapsedMs: number } | null> {
  if (!systemOcrAvailable()) return null
  const start = Date.now()
  const file = path.join(os.tmpdir(), `workon-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)
  try {
    fs.writeFileSync(file, imageBuffer)
    const out = await runPs(ENCODED_RECOGNIZE, { WORKON_OCR_FILE: file, WORKON_OCR_LANG: cachedProbe?.lang ?? '' }, 15000)
    if (!out || out === 'null') {
      consecutiveFailures++
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(`[systemOcr] 连续失败 ${consecutiveFailures} 次，本会话回落精细引擎`)
      }
      return null
    }
    const parsed = JSON.parse(out) as { text?: string; lines?: string[] }
    consecutiveFailures = 0
    return {
      text: (parsed.text ?? '').trim(),
      lines: (parsed.lines ?? []).map((l) => String(l).trim()).filter(Boolean),
      elapsedMs: Date.now() - start
    }
  } catch {
    consecutiveFailures++
    return null
  } finally {
    try { fs.unlinkSync(file) } catch { /* ignore */ }
  }
}
