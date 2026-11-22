/**
 * DeliverableSpec → 单文件 HTML（CSS 内联，图表内联 SVG，含 print CSS）
 */
import type {
  DeliverableBlock,
  DeliverableSpec
} from '@shared/deliverable/spec'
import { renderChart } from '@shared/viz/svg'
import { renderFlow } from '@shared/viz/flow'
import { documentShell } from './theme'

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => {
    if (c === '&') return '&amp;'
    if (c === '<') return '&lt;'
    if (c === '>') return '&gt;'
    if (c === '"') return '&quot;'
    return '&#39;'
  })
}

/** 轻量行内格式：**强调**、`code`、换行 */
export function inlineText(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br />')
}

function imgSrc(src: string): string {
  const v = String(src ?? '')
  if (/^(https?:|data:image\/|file:)/i.test(v)) return escapeHtml(v)
  if (v.startsWith('/')) return escapeHtml(`file://${v}`)
  return ''
}

function renderBlock(block: DeliverableBlock): string {
  if (block.type === 'cover') {
    return `<div class="cover block" data-block="${escapeHtml(block.id)}">
<div class="meta">${escapeHtml(block.date ?? '')}</div>
<h1>${escapeHtml(block.title)}</h1>
${block.subtitle ? `<div class="sub">${inlineText(block.subtitle)}</div>` : ''}
${block.author ? `<div class="meta">${escapeHtml(block.author)}</div>` : ''}
</div>`
  }
  if (block.type === 'heading') {
    const tag = block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4'
    return `<${tag} class="block" data-block="${escapeHtml(block.id)}">${inlineText(block.text)}</${tag}>`
  }
  if (block.type === 'paragraph') {
    return `<p class="block" data-block="${escapeHtml(block.id)}">${inlineText(block.text)}</p>`
  }
  if (block.type === 'metrics') {
    const items = block.items
      .map(
        (m) =>
          `<div class="metric"><div class="label">${escapeHtml(m.label)}</div><div class="value">${escapeHtml(
            String(m.value)
          )}${m.unit ? `<span class="unit">${escapeHtml(m.unit)}</span>` : ''}</div>${
            m.delta ? `<div class="delta">${escapeHtml(m.delta)}</div>` : ''
          }</div>`
      )
      .join('')
    return `<div class="metrics block" data-block="${escapeHtml(block.id)}">${items}</div>`
  }
  if (block.type === 'table') {
    const head = block.columns
      .map((c, i) => `<th class="${block.align?.[i] === 'right' ? 'right' : ''}">${escapeHtml(c)}</th>`)
      .join('')
    const rows = block.rows
      .map(
        (r) =>
          `<tr>${block.columns
            .map((_, i) => {
              const v = r[i]
              const cls = block.align?.[i] === 'right' ? 'right' : ''
              return `<td class="${cls}">${v === null || v === undefined ? '' : escapeHtml(String(v))}</td>`
            })
            .join('')}</tr>`
      )
      .join('')
    return `<div class="block" data-block="${escapeHtml(block.id)}">${
      block.title ? `<div class="muted" style="font-size:12px;margin-bottom:6px">${escapeHtml(block.title)}</div>` : ''
    }<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
  }
  if (block.type === 'chart') {
    const svg = renderChart(
      {
        kind: block.kind,
        points: block.points,
        matrix: block.matrix,
        rowLabels: block.rowLabels,
        colLabels: block.colLabels
      },
      {
        max: block.max,
        caption: block.caption,
        fg: 'var(--fg)',
        muted: 'var(--muted)'
      }
    )
    return `<div class="chart block" data-block="${escapeHtml(block.id)}">${
      block.title ? `<div class="cap">${escapeHtml(block.title)}</div>` : ''
    }${svg}</div>`
  }
  if (block.type === 'flow') {
    const svg = renderFlow(
      { nodes: block.nodes, edges: block.edges },
      { fg: 'var(--fg)', muted: 'var(--muted)' }
    )
    return `<div class="chart block" data-block="${escapeHtml(block.id)}">${
      block.title ? `<div class="cap">${escapeHtml(block.title)}</div>` : ''
    }${svg}</div>`
  }
  if (block.type === 'timeline') {
    const rows = block.items
      .map(
        (it) =>
          `<div class="row"><div class="time">${escapeHtml(it.time)}</div><div class="dot"></div><div><div class="t">${escapeHtml(
            it.title
          )}</div>${it.detail ? `<div class="d">${escapeHtml(it.detail)}</div>` : ''}</div></div>`
      )
      .join('')
    return `<div class="block" data-block="${escapeHtml(block.id)}">${
      block.title ? `<div class="muted" style="font-size:12px;margin-bottom:6px">${escapeHtml(block.title)}</div>` : ''
    }<div class="timeline">${rows}</div></div>`
  }
  if (block.type === 'callout') {
    return `<div class="callout ${block.kind} block" data-block="${escapeHtml(block.id)}">${
      block.title ? `<div class="t">${escapeHtml(block.title)}</div>` : ''
    }<div class="x">${inlineText(block.text)}</div></div>`
  }
  if (block.type === 'image') {
    const src = imgSrc(block.src)
    if (!src) return ''
    return `<figure class="block" data-block="${escapeHtml(block.id)}"><img src="${src}" alt="${escapeHtml(
      block.alt ?? ''
    )}" />${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''}</figure>`
  }
  return `<footer data-block="${escapeHtml(block.id)}"><span>${escapeHtml(block.text)}</span></footer>`
}

/** deck：按 cover / 一级标题 / 图表 切页 */
function splitSlides(blocks: DeliverableBlock[]): DeliverableBlock[][] {
  const slides: DeliverableBlock[][] = []
  let cur: DeliverableBlock[] = []
  const flush = (): void => {
    if (cur.length) slides.push(cur)
    cur = []
  }
  for (const b of blocks) {
    if (b.type === 'footer') continue
    if (b.type === 'cover') {
      flush()
      cur = [b]
      flush()
      continue
    }
    if (b.type === 'heading' && b.level === 1) {
      flush()
      cur.push(b)
      continue
    }
    cur.push(b)
    if (b.type === 'chart' || b.type === 'flow') flush()
  }
  flush()
  return slides.length ? slides : [[{ type: 'paragraph', id: 'empty', text: '（无内容）' }]]
}

export function renderHtml(spec: DeliverableSpec, opts: { standalone?: boolean } = {}): string {
  const theme = spec.theme ?? 'dark'
  if (spec.template === 'deck') {
    const slides = splitSlides(spec.blocks)
    const body = slides
      .map((blocks, i) => {
        const isCover = blocks.length === 1 && blocks[0].type === 'cover'
        const head = isCover
          ? ''
          : `<div class="header"><span>${escapeHtml(spec.title)}</span><span>${escapeHtml(spec.date ?? '')}</span></div>`
        const foot = isCover
          ? ''
          : `<div class="footer-bar"><span>${escapeHtml(spec.author ?? 'WorkOn')}</span><span>${i + 1} / ${slides.length}</span></div>`
        return `<section class="slide">${head}${blocks.map(renderBlock).join('')}${foot}</section>`
      })
      .join('')
    const html = documentShell({ title: spec.title, template: 'deck', theme, body })
    return html
  }
  const body = spec.blocks.map(renderBlock).join('')
  return documentShell({ title: spec.title, template: spec.template, theme, body })
}

/** Markdown 出口：图表/流程图以内联 SVG 保留 */
export function renderMarkdown(spec: DeliverableSpec): string {
  const lines: string[] = [`# ${spec.title}`]
  if (spec.subtitle) lines.push('', spec.subtitle)
  if (spec.date) lines.push('', `> ${spec.date}`)
  for (const b of spec.blocks) {
    if (b.type === 'cover') continue
    if (b.type === 'heading') {
      lines.push('', `${'#'.repeat(Math.min(4, b.level + 1))} ${b.text}`)
    } else if (b.type === 'paragraph') {
      lines.push('', b.text)
    } else if (b.type === 'metrics') {
      lines.push('')
      for (const m of b.items) lines.push(`- **${m.label}**：${m.value}${m.unit ?? ''}${m.delta ? `（${m.delta}）` : ''}`)
    } else if (b.type === 'table') {
      lines.push('', `| ${b.columns.join(' | ')} |`, `| ${b.columns.map(() => '---').join(' | ')} |`)
      for (const r of b.rows) lines.push(`| ${r.map((v) => String(v ?? '')).join(' | ')} |`)
    } else if (b.type === 'chart') {
      lines.push('', b.title ? `**${b.title}**` : '')
      lines.push(
        renderChart(
          { kind: b.kind, points: b.points, matrix: b.matrix, rowLabels: b.rowLabels, colLabels: b.colLabels },
          { max: b.max, caption: b.caption, fg: '#E2E8F0', muted: '#94A3B8' }
        )
      )
    } else if (b.type === 'flow') {
      lines.push('', b.title ? `**${b.title}**` : '')
      lines.push(renderFlow({ nodes: b.nodes, edges: b.edges }, { fg: '#E2E8F0', muted: '#94A3B8' }))
    } else if (b.type === 'timeline') {
      lines.push('')
      for (const it of b.items) lines.push(`- ${it.time} ${it.title}${it.detail ? ` — ${it.detail}` : ''}`)
    } else if (b.type === 'callout') {
      lines.push('', `> ${b.title ? `**${b.title}**：` : ''}${b.text}`)
    } else if (b.type === 'image') {
      const src = imgSrc(b.src)
      if (src) lines.push('', `![${b.alt ?? ''}](${src})${b.caption ? `\n\n${b.caption}` : ''}`)
    } else if (b.type === 'footer') {
      lines.push('', '---', b.text)
    }
  }
  return lines.join('\n')
}
