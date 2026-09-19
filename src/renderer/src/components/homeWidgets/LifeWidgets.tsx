/**
 * 首页生活组件（移植自 oner 小程序 homepage widgets，Taro → React DOM）
 * 共同特征：纯本地数据/本地规则，无外部 API；跨零点自动换新。
 * P2 计划：TodoCountdown/LifeGoal 接 WorkOn 计划与项目进度，替代独立存储。
 */
import { useEffect, useMemo, useState } from 'react'

/* ── 每日一句 ── */
const QUOTES = [
  '生活不是等待暴风雨过去，而是学会在雨中跳舞。',
  '你只管努力，剩下的交给时间。',
  '今天的苦难，是明天故事的素材。',
  '万物皆有裂痕，那是光照进来的地方。',
  '不要因为走得太远，而忘记为什么出发。',
  '路虽远，行则将至；事虽难，做则必成。',
  '你所经历的，终将成为你的财富。',
  '真正的平静，不是远离喧嚣，而是在心中修篱种菊。',
  '把每一个平凡的日子，过成限量版。',
  '眼里有光，脚下有路。',
  '愿你出走半生，归来仍是少年。',
  '热爱可抵岁月漫长。',
  '慢一点也没关系，只要在走。',
  '愿你一生努力，一生被爱。',
  '星光不问赶路人，时光不负有心人。',
  '所有的丢失，都是为了珍爱之物的来临腾出位置。'
]
const SOUPS = [
  '努力不一定成功，但不努力一定很轻松。',
  '世上无难事，只要肯放弃。',
  '别灰心，人生就是起起落落落落落落。',
  '条条大路通罗马，而有些人就生在罗马。',
  '别总说自己没机会，机会像秃顶，等发现时已经晚了。',
  '现在的努力，是为了以后能心安理得地躺平。',
  '咸鱼翻身，还是咸鱼。',
  '只要我够躺平，内卷就卷不到我。',
  '你才二十几岁，慌什么，后面还有更慌的。',
  '梦想还是要有的，万一忘了呢。',
  '生活不止眼前的苟且，还有远方的苟且。',
  '别怕犯错，你犯的错还不够多吗？'
]

function daySeed(): number {
  const d = new Date()
  return d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate()
}

function pickStable(list: string[]): number {
  return ((daySeed() % list.length) + list.length) % list.length
}

/** 按天稳定出一句 + 手动换（语录/毒鸡汤共用骨架） */
export function DailyLineCard({ kind }: { kind: 'quote' | 'soup' }) {
  const list = kind === 'quote' ? QUOTES : SOUPS
  const isQuote = kind === 'quote'
  const [idx, setIdx] = useState(() => pickStable(list))
  useEffect(() => { setIdx(pickStable(list)) }, []) // 跨零点由整页刷新自然带动
  const refresh = (): void => {
    let n = Math.floor(Math.random() * list.length)
    if (n === idx) n = (n + 1) % list.length
    setIdx(n)
  }
  return (
    <section className="glass-card hoverable">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px]">{isQuote ? '💬' : '🍵'}</span>
        <h3 className="text-[13px] font-semibold text-slate-200">{isQuote ? '每日一句' : '毒鸡汤'}</h3>
        <button
          className="ml-auto rounded-full border border-dashed border-[var(--line)] px-2 py-0.5 text-[10px] text-slate-500 transition-colors hover:text-slate-200"
          onClick={refresh}
        >
          {isQuote ? '换一句' : '换一碗'}
        </button>
      </div>
      <p className="text-[12.5px] leading-relaxed text-slate-300">「{list[idx]}」</p>
    </section>
  )
}

/* ── 今日黄历（本地规则：非真实农历，仅供参考的轻仪式感） ── */
const YI = ['出行', '会友', '签约', '开业', '动土', '搬家', '求医', '纳财', '嫁娶', '安床', '栽种', '交易', '立券', '入学', '理发', '沐浴']
const JI = ['诉讼', '词讼', '安葬', '伐木', '作灶', '探病', '上梁', '安门', '开仓', '出货', '破土', '乘船', '移徙', '栽种']
const WUXING = ['金', '木', '水', '火', '土']
const SHENGXIAO = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪']

function hash32(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return h
}

export function AlmanacCard() {
  const a = useMemo(() => {
    const d = new Date()
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    const h = hash32(key)
    const yi = [YI[h % YI.length], YI[(h >>> 2) % YI.length], YI[(h >>> 4) % YI.length]]
    const ji = [JI[(h >>> 1) % JI.length], JI[(h >>> 3) % JI.length], JI[(h >>> 5) % JI.length]]
    return {
      yi: [...new Set(yi)],
      ji: [...new Set(ji)],
      wx: WUXING[h % 5],
      chong: SHENGXIAO[(Math.floor(d.getTime() / 86400000) + 4) % 12],
      sx: SHENGXIAO[((((d.getFullYear() - 4) % 12) + 12) % 12)]
    }
  }, [])
  return (
    <section className="glass-card hoverable">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px]">📜</span>
        <h3 className="text-[13px] font-semibold text-slate-200">今日黄历</h3>
        <span className="ml-auto text-[10px] text-slate-500">{a.wx} · 冲{a.chong} · {a.sx}年</span>
      </div>
      <div className="flex flex-col gap-1 text-[12px]">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">宜</span>
          <span className="min-w-0 truncate text-slate-300">{a.yi.join('、')}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-400">忌</span>
          <span className="min-w-0 truncate text-slate-400">{a.ji.join('、')}</span>
        </div>
      </div>
    </section>
  )
}

/* ── 倒数日（本地列表：加事件看距今天数） ── */
interface CD { id: string; name: string; date: string }
const CD_KEY = 'workonCountdowns'

function diffDays(dateStr: string): number {
  const target = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function loadCDs(): CD[] {
  try {
    const inited = !!localStorage.getItem(CD_KEY + '_init')
    let list: CD[] = []
    try { list = JSON.parse(localStorage.getItem(CD_KEY) ?? '[]') as CD[] } catch { list = [] }
    if (!inited) {
      if (!Array.isArray(list) || !list.length) {
        const y = new Date().getFullYear()
        list = [{ id: 'seed-gq', name: '国庆', date: `${y}-10-01` }]
      }
      localStorage.setItem(CD_KEY, JSON.stringify(list))
      localStorage.setItem(CD_KEY + '_init', '1')
      return list
    }
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

export function CountdownCard() {
  const [list, setList] = useState<CD[]>(() => loadCDs())
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [adding, setAdding] = useState(false)

  const save = (next: CD[]): void => {
    setList(next)
    try { localStorage.setItem(CD_KEY, JSON.stringify(next)) } catch { /* 写失败不阻断 */ }
  }
  const add = (): void => {
    const n = name.trim()
    if (!n || !date) return
    save([...list, { id: 'cd-' + Date.now(), name: n, date }])
    setName('')
    setDate('')
    setAdding(false)
  }
  const rows = [...list]
    .map((c) => ({ ...c, diff: diffDays(c.date) }))
    .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))
    .slice(0, 5)

  return (
    <section className="glass-card hoverable">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px]">⏳</span>
        <h3 className="text-[13px] font-semibold text-slate-200">倒数日</h3>
        <button
          className="ml-auto rounded-full border border-dashed border-[var(--line)] px-2 py-0.5 text-[10px] text-slate-500 transition-colors hover:text-slate-200"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? '收起' : '＋ 事件'}
        </button>
      </div>
      {adding ? (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <input
            className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 text-[11px] text-slate-200 outline-none placeholder:text-slate-600"
            placeholder="事件名，如：项目上线"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          />
          <input
            type="date"
            className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 text-[11px] text-slate-200 outline-none"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <button className="glass-btn primary !px-2 !py-1 !text-[10px]" onClick={add}>加</button>
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        {rows.map((c) => (
          <div key={c.id} className="group flex items-center gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate text-slate-300">{c.name}</span>
            <span
              className="shrink-0 tabular-nums font-bold"
              style={{ color: c.diff === 0 ? 'var(--teal)' : c.diff > 0 ? '#fbbf24' : '#94a3b8' }}
            >
              {c.diff === 0 ? '就是今天' : c.diff > 0 ? `${c.diff} 天后` : `已过 ${-c.diff} 天`}
            </span>
            <button
              className="shrink-0 text-slate-700 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
              title="删除"
              onClick={() => save(list.filter((x) => x.id !== c.id))}
            >✕</button>
          </div>
        ))}
        {!rows.length ? <div className="py-1 text-center text-[11px] text-slate-600">还没有倒数事件</div> : null}
      </div>
    </section>
  )
}
