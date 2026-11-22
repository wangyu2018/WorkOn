/**
 * 富文档解析（P1）：txt/md/json/csv/log + docx + pdf + xlsx
 * 依赖按需加载，单文件失败不影响整批导入。
 */
import fs from 'fs'
import path from 'path'

export type ParsedKind = 'text' | 'docx' | 'pdf' | 'xlsx' | 'pptx' | 'image'

export interface ParsedFile {
  text: string
  kind: ParsedKind
  meta?: Record<string, unknown>
}

type AnyModule = Record<string, unknown>

async function optionalImport(name: string): Promise<AnyModule> {
  try {
    return (await import(/* @vite-ignore */ name)) as AnyModule
  } catch (e) {
    throw new Error(`缺少依赖 ${name}：${(e as Error).message}`)
  }
}

export async function parseFile(filePath: string): Promise<ParsedFile> {
  const ext = path.extname(filePath).toLowerCase()
  if (['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.tsv', '.yaml', '.yml'].includes(ext)) {
    return { text: fs.readFileSync(filePath, 'utf-8'), kind: 'text' }
  }
  if (ext === '.docx') {
    const mod = await optionalImport('mammoth')
    const mammoth = (mod.default ?? mod) as {
      extractRawText: (o: { path: string }) => Promise<{ value: string; messages?: unknown[] }>
    }
    const r = await mammoth.extractRawText({ path: filePath })
    return { text: r.value ?? '', kind: 'docx', meta: { messages: r.messages?.length ?? 0 } }
  }
  if (ext === '.pdf') {
    const mod = await optionalImport('pdf-parse')
    const fn = (mod.default ?? mod) as unknown as (buf: Buffer) => Promise<{ text: string; numpages?: number }>
    const r = await fn(fs.readFileSync(filePath))
    return { text: r.text ?? '', kind: 'pdf', meta: { pages: r.numpages ?? 0 } }
  }
  if (ext === '.xlsx' || ext === '.xlsm') {
    const mod = await optionalImport('exceljs')
    const ExcelJS = (mod.default ?? mod) as {
      Workbook: new () => {
        xlsx: { readFile: (p: string) => Promise<unknown> }
        worksheets: Array<{ name: string; eachRow: (cb: (row: { values: unknown[] }, i: number) => void) => void }> | undefined
      }
    }
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    const lines: string[] = []
    for (const ws of wb.worksheets ?? []) {
      lines.push(`# ${ws.name}`)
      ws.eachRow((row) => {
        const vals = (row.values ?? []).slice(1).map((v) => (v === null || v === undefined ? '' : String(v)))
        if (vals.some(Boolean)) lines.push(vals.join('\t'))
      })
    }
    return { text: lines.join('\n'), kind: 'xlsx', meta: { sheets: wb.worksheets?.length ?? 0 } }
  }
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    return { text: '', kind: 'image' }
  }
  if (ext === '.pptx') {
    throw new Error('pptx 解析暂未支持（可以先导出后再处理）')
  }
  // 未知类型：尝试按文本读，失败则报错
  const raw = fs.readFileSync(filePath, 'utf-8')
  if (!raw || raw.includes('\u0000')) throw new Error(`不支持的文件类型：${ext || '(无扩展名)'}`)
  return { text: raw, kind: 'text' }
}
