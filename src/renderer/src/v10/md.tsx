/**
 * v10 轻量 Markdown 渲染（AI 回答清晰化第一层）
 * 自写安全白名单渲染：表格/无序有序列表/粗体/行内代码/代码块/标题/分隔线。
 * 不渲染任何原生 HTML（防注入）；不引第三方库。
 */
import type { JSX } from 'react'

/** 行内：**粗体** `代码` [文本](url→仅显示文本+title) */
function inline(text: string, keyBase: string): JSX.Element[] {
  const out: JSX.Element[] = []
  // 拆分行内标记（粗体/行内代码交替扫描）
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<span key={`${keyBase}-t${i++}`}>{text.slice(last, m.index)}</span>)
    const tok = m[0]
    if (tok.startsWith('**')) {
      out.push(<strong key={`${keyBase}-b${i++}`}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      out.push(<code key={`${keyBase}-c${i++}`}>{tok.slice(1, -1)}</code>)
    } else {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)
      out.push(
        <span key={`${keyBase}-l${i++}`} title={lm?.[2]} style={{ color: 'var(--teal-ink)', textDecoration: 'underline dotted' }}>
          {lm?.[1] ?? tok}
        </span>
      )
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(<span key={`${keyBase}-t${i++}`}>{text.slice(last)}</span>)
  return out
}

export function renderMarkdown(src: string): JSX.Element {
  const lines = src.replace(/\r/g, '').split('\n')
  const blocks: JSX.Element[] = []
  let i = 0
  let k = 0

  while (i < lines.length) {
    const line = lines[i]

    // 代码块 ```...```
    if (line.trim().startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++])
      i++
      blocks.push(
        <pre className="v10-md-pre" key={k++}>
          <code>{buf.join('\n')}</code>
        </pre>
      )
      continue
    }

    // 表格：| a | b |  +  |---|---|
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = line.split('|').slice(1, -1).map((c) => c.trim())
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()))
        i++
      }
      blocks.push(
        <table className="v10-md-table" key={k++}>
          <thead>
            <tr>{head.map((h, hi) => <th key={hi}>{inline(h, `th${k}-${hi}`)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c, `td${k}-${ri}-${ci}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )
      continue
    }

    // 标题 ###
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      blocks.push(
        <div className={`v10-md-h v10-md-h${h[1].length}`} key={k++}>
          {inline(h[2], `h${k}`)}
        </div>
      )
      i++
      continue
    }

    // 分隔线
    if (/^\s*---+\s*$/.test(line)) {
      blocks.push(<hr className="v10-md-hr" key={k++} />)
      i++
      continue
    }

    // 无序列表（含缩进二级）
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ''))
        i++
      }
      blocks.push(
        <ul className="v10-md-ul" key={k++}>
          {items.map((it, ii) => <li key={ii}>{inline(it, `ul${k}-${ii}`)}</li>)}
        </ul>
      )
      continue
    }

    // 有序列表
    if (/^\s*\d+[.、]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.、]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.、]\s+/, ''))
        i++
      }
      blocks.push(
        <ol className="v10-md-ol" key={k++}>
          {items.map((it, ii) => <li key={ii}>{inline(it, `ol${k}-${ii}`)}</li>)}
        </ol>
      )
      continue
    }

    // 空行
    if (!line.trim()) {
      i++
      continue
    }

    // 普通段落（连续非空行合并）
    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^\s*([-*•]|\d+[.、]|#{1,4}\s|\||```|---)/.test(lines[i])) {
      para.push(lines[i++])
    }
    blocks.push(
      <p className="v10-md-p" key={k++}>
        {inline(para.join(' '), `p${k}`)}
      </p>
    )
  }

  return <div className="v10-md">{blocks}</div>
}
