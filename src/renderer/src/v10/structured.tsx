/**
 * 结构化答卡（AI 回答清晰化第二层）
 * 检测本地小结/统计类回答的文本模式 → KPI 格 + 占比条形 + 应用 TOP 横条图。
 * 规则先行；AI 有 Key 时回答走 markdown（md.tsx），二者互补。
 */
import type { JSX } from 'react'

interface Kpi {
  label: string
  value: string
}
interface Bar {
  label: string
  value: number
  valueLabel: string
  color?: string
  /** 归一化分母（如墙钟总分钟/100%），缺省用 bars 最大值 */
  maxHint?: number
}
export interface Structured {
  kpis: Kpi[]
  bars: Bar[]
  note?: string
  raw: string
}

const num = (s: string): number => parseFloat(s.replace(/,/g, '')) || 0

/** 从回答文本检测可结构化的模式；不匹配返回 null（走 markdown 渲染） */
export function detectStructured(text: string): Structured | null {
  // 诚实模式：本地兜底的「需要 AI」提示不硬塞 KPI 卡（否则问啥都是同一张卡）
  if (text.includes('这个问题需要 AI') || text.includes('配置后即可解锁')) return null
  const kpis: Kpi[] = []
  const bars: Bar[] = []
  let note: string | undefined

  // 模式①：本地小结「墙钟 X 分钟，工作 Y 分钟，摸鱼 Z 分钟」
  const m1 = /墙钟\s*([\d.]+)\s*分钟.*?工作\s*([\d.]+)\s*分钟.*?摸鱼\s*([\d.]+)\s*分钟/s.exec(text)
  if (m1) {
    const total = num(m1[1])
    const work = num(m1[2])
    const slack = num(m1[3])
    kpis.push(
      { label: '墙钟', value: `${Math.round(total)} 分` },
      { label: '工作', value: `${Math.round(work)} 分` },
      { label: '摸鱼', value: `${Math.round(slack)} 分` }
    )
    if (total > 0) {
      bars.push({ label: '工作占比', value: work, valueLabel: `${Math.round((work / total) * 100)}%`, color: '#0FB5A4', maxHint: total })
      bars.push({ label: '摸鱼占比', value: slack, valueLabel: `${Math.round((slack / total) * 100)}%`, color: '#D98E2B', maxHint: total })
    }
  }

  // 模式②：专注占比「今日工作 X 分钟 / 墙钟 Y 分钟（专注占比 Z%）」
  const m2 = /今日工作\s*([\d.]+)\s*分钟\s*\/\s*墙钟\s*([\d.]+)\s*分钟（专注占比\s*(\d+)%）/.exec(text)
  if (m2) {
    kpis.push(
      { label: '工作', value: `${Math.round(num(m2[1]))} 分` },
      { label: '墙钟', value: `${Math.round(num(m2[2]))} 分` },
      { label: '专注占比', value: `${m2[3]}%` }
    )
    bars.push({ label: '专注占比', value: num(m2[3]), valueLabel: `${m2[3]}%`, color: '#0FB5A4', maxHint: 100 })
    const bh = /高效时段：([^.。]+)/.exec(text)
    if (bh) note = `高效时段：${bh[1]}`
  }

  // 模式③：应用 TOP「A（N分钟）、B（M分钟）…」（注意时长可能带小数，非贪婪到句号）
  const m3 = /最常用的应用：(.+?)[。.]/.exec(text)
  if (m3) {
    const re = /([^\s（）()、]+)（([\d.]+)分钟）/g
    let mm: RegExpExecArray | null
    while ((mm = re.exec(m3[1]))) {
      bars.push({ label: mm[1], value: num(mm[2]), valueLabel: `${Math.round(num(mm[2]))} 分` })
    }
  }

  if (!kpis.length && bars.length < 2) return null

  // note：去掉已结构化的句子，剩下的尾注保留
  const stripped = text
    .replace(/^[^：]*：/, '')
    .replace(/今日墙钟.*?分钟。?/, '')
    .replace(/今日最常用的应用：[^。]*。?/, '')
    .trim()
  if (stripped && !note) note = stripped.slice(0, 80)

  return { kpis, bars, note, raw: text }
}

/** 结构化答卡渲染：KPI 格 + 占比/横条图 + 尾注（原文折叠保留） */
export function StructuredCard(props: { s: Structured; onAsk?: (q: string) => void }): JSX.Element {
  const { s } = props
  const maxBar = Math.max(...s.bars.map((b) => b.maxHint ?? b.value), 1)
  return (
    <div className="v10-scard">
      {s.kpis.length ? (
        <div className="sc-kpis">
          {s.kpis.map((k, i) => (
            <div
              className="sc-kpi clickable"
              key={i}
              title={`追问：${k.label}为什么是这个数？`}
              onClick={() => props.onAsk?.(`${k.label}（${k.value}）为什么是这个数？怎么改善？`)}
            >
              <div className="sc-kv">{k.value}</div>
              <div className="sc-kl">{k.label}</div>
            </div>
          ))}
        </div>
      ) : null}
      {s.bars.length ? (
        <div className="sc-bars">
          {s.bars.map((b, i) => (
            <div className="sc-bar" key={i}>
              <span className="sc-bl">{b.label}</span>
              <span className="sc-btrack">
                <span
                  className="sc-bfill"
                  style={{ width: `${Math.min(100, (b.value / maxBar) * 100)}%`, background: b.color ?? 'var(--teal)' }}
                />
              </span>
              <span className="sc-bv">{b.valueLabel}</span>
            </div>
          ))}
        </div>
      ) : null}
      {s.note ? <div className="sc-note">{s.note}</div> : null}
    </div>
  )
}
