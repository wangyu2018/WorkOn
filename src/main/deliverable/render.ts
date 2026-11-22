/**
 * 交付物渲染：md / html / pdf / png（P2 再扩 docx/xlsx/pptx）
 * 落盘：~/Documents/WorkOn Deliverables/<YYYY-MM-DD>/
 */
import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { DeliverableFormat, DeliverableSpec } from '@shared/deliverable/spec'
import { renderHtml, renderMarkdown } from './html'

export function todayKey(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function deliverablesDir(date?: string): string {
  const key = (date ?? todayKey()).slice(0, 10)
  const dir = path.join(app.getPath('documents'), 'WorkOn Deliverables', key)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function specHash(spec: DeliverableSpec, dataSnapshotTs?: number): string {
  const canonical = JSON.stringify({ spec, dataSnapshotTs: dataSnapshotTs ?? spec.meta?.dataSnapshotTs ?? 0 })
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

function fileName(spec: DeliverableSpec, format: DeliverableFormat, revision: number): string {
  const date = (spec.date ?? todayKey()).slice(0, 10)
  const safe = (spec.title || 'deliverable').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40)
  return `${safe}-${spec.template}-${date}-r${revision}.${format}`
}

export function createHiddenWindow(width = 1080): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      offscreen: false
    }
  })
}

export async function loadHtml(win: BrowserWindow, html: string): Promise<void> {
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  // 等一帧，确保布局与字体就绪
  await new Promise((r) => setTimeout(r, 120))
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const win = createHiddenWindow(900)
  try {
    await loadHtml(win, html)
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' }
    })
  } finally {
    win.destroy()
  }
}

export async function htmlToPng(html: string, opts: { width?: number } = {}): Promise<Buffer> {
  const width = Math.max(320, Math.min(1600, opts.width ?? 1080))
  const win = createHiddenWindow(width)
  try {
    await loadHtml(win, html)
    const rawH = await win.webContents.executeJavaScript(
      'Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 600)'
    )
    const height = Math.max(600, Math.min(8000, Number(rawH) || 900))
    win.setContentSize(width, height)
    await new Promise((r) => setTimeout(r, 180))
    const shot = await win.webContents.capturePage()
    const img = shot.getSize().width === width ? shot : shot.resize({ width, quality: 'best' })
    return img.toPNG()
  } finally {
    win.destroy()
  }
}

export interface RenderResult {
  path: string
  bytes: number
}

export async function renderDeliverable(
  format: DeliverableFormat,
  spec: DeliverableSpec,
  opts: { revision?: number; dir?: string } = {}
): Promise<RenderResult> {
  const revision = Math.max(1, opts.revision ?? spec.meta?.revision ?? 1)
  const dir = opts.dir ?? deliverablesDir(spec.date)
  const file = path.join(dir, fileName(spec, format, revision))

  if (format === 'md') {
    fs.writeFileSync(file, renderMarkdown(spec), 'utf-8')
    return { path: file, bytes: fs.statSync(file).size }
  }
  if (format === 'html') {
    fs.writeFileSync(file, renderHtml(spec), 'utf-8')
    return { path: file, bytes: fs.statSync(file).size }
  }
  const html = renderHtml(spec)
  if (format === 'pdf') {
    const buf = await htmlToPdf(html)
    fs.writeFileSync(file, buf)
    return { path: file, bytes: buf.length }
  }
  if (format === 'png') {
    const buf = await htmlToPng(html)
    fs.writeFileSync(file, buf)
    return { path: file, bytes: buf.length }
  }
  // docx / xlsx / pptx：由 P2 的 office 渲染器接管
  const { renderOffice } = await import('./office')
  const buf = await renderOffice(format, spec)
  fs.writeFileSync(file, buf)
  return { path: file, bytes: buf.length }
}
