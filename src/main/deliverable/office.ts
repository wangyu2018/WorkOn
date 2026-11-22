/**
 * Office 产物（P2）：docx / xlsx / pptx
 * 依赖按需加载；未安装时抛出可读错误，不影响 md/html/pdf/png。
 */
import { createRequire } from 'module'
import type { DeliverableFormat, DeliverableSpec } from '@shared/deliverable/spec'

export async function renderOffice(format: DeliverableFormat, spec: DeliverableSpec): Promise<Buffer> {
  if (format === 'xlsx') return renderXlsx(spec)
  if (format === 'docx') return renderDocx(spec)
  if (format === 'pptx') return renderPptx(spec)
  throw new Error(`不支持的格式：${format}`)
}

type AnyModule = Record<string, unknown>
/** 用 CJS require 加载：pptxgenjs 的 exports.import 指向 ESM，动态 import 会在 CJS 主进程里报错 */
const nodeRequire = createRequire(__filename)
async function optionalImport(name: string): Promise<AnyModule> {
  try {
    return nodeRequire(name) as AnyModule
  } catch (e) {
    throw new Error(`缺少依赖 ${name}，请先安装后再导出 ${name} 产物：${(e as Error).message}`)
  }
}

function rowsOf(spec: DeliverableSpec): string[][] {
  const rows: string[][] = [['章节', '内容']]
  for (const b of spec.blocks) {
    if (b.type === 'heading') rows.push([b.text, ''])
    else if (b.type === 'paragraph') rows.push(['', b.text])
    else if (b.type === 'metrics') {
      for (const m of b.items) rows.push([m.label, `${m.value}${m.unit ?? ''}`])
    } else if (b.type === 'table') {
      for (const r of b.rows) rows.push(r.map((v) => String(v ?? '')))
    } else if (b.type === 'timeline') {
      for (const it of b.items) rows.push([it.time, `${it.title}${it.detail ? ` ${it.detail}` : ''}`])
    }
  }
  return rows
}

async function renderXlsx(spec: DeliverableSpec): Promise<Buffer> {
  const mod = await optionalImport('exceljs')
  const ExcelJS = (mod.default ?? mod) as {
    Workbook: new () => {
      addWorksheet: (name: string) => {
        addRow: (row: string[]) => void
        columns: Array<{ width: number }>
      }
      xlsx: { writeBuffer: () => Promise<ArrayBuffer> }
    }
  }
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(spec.title.slice(0, 28) || 'Sheet1')
  ws.columns = [{ width: 28 }, { width: 72 }]
  for (const row of rowsOf(spec)) ws.addRow(row)
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

async function renderDocx(spec: DeliverableSpec): Promise<Buffer> {
  const mod = await optionalImport('docx')
  const d = mod as {
    Document: new (o: unknown) => unknown
    Packer: { toBuffer: (doc: unknown) => Promise<Buffer> }
    Paragraph: new (o: unknown) => unknown
    HeadingLevel: Record<string, string>
    TextRun: new (o: unknown) => unknown
  }
  const children: unknown[] = [new d.Paragraph({ text: spec.title, heading: d.HeadingLevel.TITLE })]
  if (spec.subtitle) children.push(new d.Paragraph({ text: spec.subtitle }))
  for (const b of spec.blocks) {
    if (b.type === 'heading') {
      children.push(
        new d.Paragraph({
          text: b.text,
          heading: b.level === 1 ? d.HeadingLevel.HEADING_1 : b.level === 2 ? d.HeadingLevel.HEADING_2 : d.HeadingLevel.HEADING_3
        })
      )
    } else if (b.type === 'paragraph') {
      children.push(new d.Paragraph({ children: [new d.TextRun(b.text)] }))
    } else if (b.type === 'metrics') {
      for (const m of b.items) children.push(new d.Paragraph({ text: `${m.label}：${m.value}${m.unit ?? ''}` }))
    } else if (b.type === 'table') {
      for (const r of b.rows) children.push(new d.Paragraph({ text: r.map((v) => String(v ?? '')).join(' | ') }))
    } else if (b.type === 'timeline') {
      for (const it of b.items) children.push(new d.Paragraph({ text: `${it.time} ${it.title}${it.detail ? ` — ${it.detail}` : ''}` }))
    } else if (b.type === 'callout') {
      children.push(new d.Paragraph({ text: `${b.title ? `${b.title}：` : ''}${b.text}` }))
    }
  }
  const doc = new d.Document({ sections: [{ children }] })
  return await d.Packer.toBuffer(doc)
}

async function renderPptx(spec: DeliverableSpec): Promise<Buffer> {
  const mod = await optionalImport('pptxgenjs')
  const PptxGenJS = (mod.default ?? mod) as new () => {
    layout: string
    addSlide: () => {
      addText: (text: string, o: Record<string, unknown>) => void
      addTable: (rows: unknown[][], o: Record<string, unknown>) => void
    }
    write: (o: { outputType: 'nodebuffer' }) => Promise<Buffer>
  }
  const pptx = new PptxGenJS()
  let slide = pptx.addSlide()
  slide.addText(spec.title, { x: 0.6, y: 2.2, w: 9, h: 1, fontSize: 32, bold: true })
  if (spec.subtitle) slide.addText(spec.subtitle, { x: 0.6, y: 3.2, w: 9, h: 0.6, fontSize: 16 })
  for (const b of spec.blocks) {
    if (b.type === 'cover') continue
    if (b.type === 'heading' || b.type === 'chart' || b.type === 'flow') {
      slide = pptx.addSlide()
      slide.addText(b.type === 'heading' ? b.text : b.title ?? spec.title, {
        x: 0.5,
        y: 0.35,
        w: 9,
        h: 0.7,
        fontSize: 24,
        bold: true
      })
      if (b.type === 'chart') {
        const header = ['标签', '数值']
        const rows = [header, ...(b.points ?? []).map((p) => [p.label, p.value])]
        slide.addTable(rows, { x: 0.6, y: 1.2, w: 8.8, fontSize: 12 })
      }
    } else if (b.type === 'paragraph') {
      slide.addText(b.text, { x: 0.6, y: 1.2, w: 8.8, h: 2, fontSize: 14 })
    } else if (b.type === 'metrics') {
      slide.addText(b.items.map((m) => `${m.label} ${m.value}${m.unit ?? ''}`).join('    '), {
        x: 0.6,
        y: 1.4,
        w: 8.8,
        h: 1,
        fontSize: 18
      })
    }
  }
  return await pptx.write({ outputType: 'nodebuffer' })
}
