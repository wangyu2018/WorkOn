/**
 * 左栏「问」：对话流（无气泡排版）+ 建议 chips + 输入场 + 对象芯片（块进化）
 * 你的话 = 2px 墨竖线引文；AI = ◇ aura kick + prose（v10 §3.2）
 * 快捷回复协议（v10 §7）：带选项的消息渲染 ①② 大按钮，输入框回数字即答
 * 块进化（v10 §4.C）：右页组件拖入输入场 → 挂对象芯片 → 一句话调参数
 */
import { useEffect, useState, type RefObject, type DragEvent } from 'react'
import type { JSX } from 'react'
import type { PresenceSnapshot, WorkState, ChatSession } from '@shared/types'
import { STATE_LABEL } from '@shared/stateMeta'
import { renderMarkdown } from './md'
import { detectStructured, StructuredCard } from './structured'
import { MindMap } from './mindmap'
import { Shrinkable } from './Shrinkable'
import { SESSION_CONTEXTS, type ContextKey } from './sessionContext'

/** 你的话/AI 的话 */
export interface ChatMsg {
  /** 流式定位 id（打字机更新用） */
  id?: string
  role: 'user' | 'ai'
  text: string
  options?: string[]
  picked?: string
  attach?: 'flowmap' | 'mindmap'
  attachSrc?: string
}

/** 引用芯片（v10）：拖消息/折下卡进来，发送时自动附为上下文 */
export interface QuoteChipData {
  text: string
  from: string
}

/** 块进化对象芯片：从右页拖入的组件描述 */
export interface ObjectChipData {
  blockKey: string
  label: string
  current: string
}

/**
 * 渲染路由表（OpenIntelligentUI 模式）：按内容特征显式路由渲染器。
 * 现在是规则路由；后续 jev choice 题当路由器（"这个回答该用什么形式呈现"）替换 when 判定。
 */
interface RenderRoute {
  id: string
  /** 命中判定（按序第一个命中者胜） */
  when: (text: string) => boolean
  render: (ctx: {
    text: string
    expanded: boolean
    setExpanded: (v: boolean) => void
    mapped: boolean
    setMapped: (v: boolean) => void
    onMindmap?: (src: string) => void
    onAsk?: (q: string) => void
    onSandbox?: (src: string) => void
    aiOn: boolean | null
    sandboxLoading?: boolean
  }) => JSX.Element
}

const RENDER_ROUTES: RenderRoute[] = [
  {
    id: 'structured',
    when: (t) => !!detectStructured(t),
    render: (ctx) => (
      <div className="v10-rich">
        <div className="v10-rich-head"><CopyBtn text={ctx.text} /></div>
        <StructuredCard s={detectStructured(ctx.text)!} onAsk={ctx.onAsk} />
        <MindChip ctx={ctx} />
      </div>
    )
  },
  {
    id: 'markdown',
    when: (t) => t.length > 420 || /^#{1,3}\s|\n[-*•·]\s|\n\s*\|/.test(t),
    render: (ctx) => {
      const long = ctx.text.length > 420
      return (
        <div className="v10-rich">
          <div className="v10-rich-head"><CopyBtn text={ctx.text} /></div>
          {long && !ctx.expanded ? (
            <>
              <div className="v10-clamp">{renderMarkdown(ctx.text)}</div>
              <button className="v10-more" onClick={() => ctx.setExpanded(true)}>展开全文（{ctx.text.length} 字）▾</button>
            </>
          ) : (
            renderMarkdown(ctx.text)
          )}
          <MindChip ctx={ctx} />
        </div>
      )
    }
  },
  {
    id: 'plain',
    when: () => true,
    render: (ctx) => (
      <div className="v10-rich">
        <div className="v10-rich-head"><CopyBtn text={ctx.text} /></div>
        {renderMarkdown(ctx.text)}
        <MindChip ctx={ctx} />
      </div>
    )
  }
]

/** 思维导图拆件 chip（长文/结构化回答的再结构化入口） */
function MindChip(props: { ctx: { mapped: boolean; setMapped: (v: boolean) => void; onMindmap?: (src: string) => void; onSandbox?: (src: string) => void; text: string; aiOn: boolean | null; sandboxLoading?: boolean } }): JSX.Element | null {
  const { ctx } = props
  const canMap = ctx.text.length > 120 || /^#{1,3}\s|\n[-*•·]\s|\n\s*\|/.test(ctx.text)
  if (!canMap) return null
  if (ctx.mapped) {
    return (
      <div className="v10-attachrow">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Shrinkable scale={0.55} hint="预览 · 点击放大">
              <MindMap text={ctx.text} rootLabel="回答" width={520} />
            </Shrinkable>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="v10-attach" onClick={() => ctx.onMindmap?.(`__page__${ctx.text}`)}>落右页 ▸</button>
            {ctx.aiOn ? (
              <button
                className="v10-attach"
                style={{ background: 'var(--celadon-2)' }}
                disabled={!!ctx.sandboxLoading}
                onClick={() => ctx.onSandbox?.(`__sandbox__${ctx.text}`)}
              >
                {ctx.sandboxLoading ? '◈ 生成中…' : '◇ 生成可视化'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="v10-attachrow">
      <button className="v10-attach" onClick={() => ctx.setMapped(true)}>◇ 再结构化：思维导图 ▾</button>
    </div>
  )
}

function CopyBtn(props: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="v10-copybtn"
      onClick={() => {
        void navigator.clipboard?.writeText(props.text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? '✓ 已复制' : '复制'}
    </button>
  )
}

function RichAnswer(props: { text: string; onMindmap?: (src: string) => void; onAsk?: (q: string) => void; onSandbox?: (src: string) => void; aiOn?: boolean | null; sandboxLoading?: boolean }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [mapped, setMapped] = useState(false)
  const ctx = {
    text: props.text,
    expanded,
    setExpanded,
    mapped,
    setMapped,
    onMindmap: props.onMindmap,
    onAsk: props.onAsk,
    onSandbox: props.onSandbox,
    aiOn: props.aiOn ?? null,
    sandboxLoading: props.sandboxLoading
  }
  const route = RENDER_ROUTES.find((r) => r.when(ctx.text)) ?? RENDER_ROUTES[RENDER_ROUTES.length - 1]
  return route.render(ctx)
}

function MsgActions(props: {
  idx: number
  open: boolean
  onToggle: () => void
  sessions: ChatSession[]
  onAddToSession: (sessionId: string | null, topic?: 'project' | 'life' | 'general') => void
  onDelete?: () => void
}): JSX.Element {
  const [level, setLevel] = useState<'root' | 'pick'>('root')
  if (!props.open) {
    return (
      <button className="v10-msgdots" onClick={props.onToggle} title="加入会话 / 归档 / 删除">
        ⋯
      </button>
    )
  }
  return (
    <div className="v10-msgmenu">
      {level === 'root' ? (
        <>
          <button onClick={() => props.onAddToSession(null, undefined)}>＋ 新建会话</button>
          {props.sessions.slice(0, 4).map((x) => (
            <button key={x.id} onClick={() => props.onAddToSession(x.id)}>{x.title.slice(0, 12)}</button>
          ))}
          {props.sessions.length > 0 ? <button onClick={() => setLevel('pick')}>更多会话…</button> : null}
          <button onClick={() => props.onAddToSession(null, 'project')}>归档 · 项目</button>
          <button onClick={() => props.onAddToSession(null, 'life')}>归档 · 生活</button>
          {props.onDelete ? (
            <button style={{ color: 'var(--red, #c0392b)' }} onClick={props.onDelete}>✕ 删除这条</button>
          ) : null}
        </>
      ) : (
        <>
          {props.sessions.map((x) => (
            <button key={x.id} onClick={() => props.onAddToSession(x.id)}>{x.title.slice(0, 12)}</button>
          ))}
        </>
      )}
    </div>
  )
}

function SessionInput(props: { onSend: (t: string) => void }): JSX.Element {
  const [t, setT] = useState('')
  return (
    <div className="v10-ask-inputbar">
      <textarea
        className="v10-input"
        rows={2}
        placeholder="继续这个会话…"
        value={t}
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && t.trim()) {
            props.onSend(t.trim())
            setT('')
          }
        }}
      />
    </div>
  )
}

export function AskPane(props: {
  chat: ChatMsg[]
  asking: boolean
  onSend: (text: string) => void
  scrollRef: RefObject<HTMLDivElement>
  presence: PresenceSnapshot | null
  objectChip?: ObjectChipData | null
  onClearChip?: () => void
  quoteChip?: QuoteChipData | null
  onClearQuote?: () => void
  onQuoteDrop?: (q: QuoteChipData) => void
  /** 桥 v0：卡片内交互（KPI 点击等）→ 回填输入场待用户确认发送 */
  onPrefill?: (q: string) => void
  /** 会话（v10）：列表 + 当前进入的会话 + 动作回调 */
  sessions?: ChatSession[]
  activeSessionId?: string | null
  onEnterSession?: (id: string | null) => void
  onAddToSession?: (msgIndex: number, sessionId: string | null, topic?: 'project' | 'life' | 'general') => void
  /** 删除主对话消息（chat 数组下标） */
  onDeleteMessage?: (msgIndex: number) => void
  /** 删除会话内消息（会话 items 下标） */
  onDeleteSessionItem?: (index: number) => void
  onSessionRenamed?: (id: string, title: string) => void
  onSessionRemoved?: (id: string) => void
  prefillText?: string | null
  onPrefillConsumed?: () => void
  aiOn?: boolean | null
  /** 沙箱可视化生成中（点了「生成可视化」后的进度反馈） */
  sandboxLoading?: boolean
  onSandboxGen?: (srcText: string) => void
  /** 玻璃片模式（pane=ask）：控制条按钮 */
  glassControls?: boolean
  /** 会话上下文（v10 简化模型：框即 session） */
  activeContext?: ContextKey
  onSetContext?: (k: ContextKey) => void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const [dropHot, setDropHot] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const state: WorkState | undefined = props.presence?.state
  // 桥 v0：卡片交互回填输入场（用户可改再发——human-in-the-loop）
  useEffect(() => {
    if (props.prefillText) {
      setDraft(props.prefillText)
      props.onPrefillConsumed?.()
    }
  }, [props.prefillText])
  // 对话自动折叠（v10）：只留最近 20 条活跃，更早的收成一行（点开全量）
  const HIDE_COUNT = props.chat.length - 20
  const visible = expanded || HIDE_COUNT <= 0 ? props.chat : props.chat.slice(HIDE_COUNT)

  const submit = (): void => {
    if (!draft.trim()) return
    props.onSend(draft)
    setDraft('')
  }

  const handleDrop = (e: DragEvent<HTMLTextAreaElement>): void => {
    e.preventDefault()
    setDropHot(false)
    try {
      const block = e.dataTransfer.getData('application/x-workon-block')
      if (block) {
        props.onSend(`__chip__${block}`)
        return
      }
      const quote = e.dataTransfer.getData('application/x-workon-quote')
      if (quote && props.onQuoteDrop) {
        props.onQuoteDrop(JSON.parse(quote) as QuoteChipData)
      }
    } catch { /* 非法拖拽忽略 */ }
  }

  const [menuIdx, setMenuIdx] = useState<number | null>(null) // 行内动作面板（零浮层：hover ⋯ 展开）
  const [listOpen, setListOpen] = useState(false) // 会话列表下拉
  const [armedSesId, setArmedSesId] = useState<string | null>(null) // 列表内删会话两次确认
  const active = props.sessions?.find((x) => x.id === props.activeSessionId) ?? null

  // 会话视图：进入某会话后左栏显示其消息 + 继续追问
  const [renameMode, setRenameMode] = useState(false)
  const [delArm, setDelArm] = useState(false)
  if (active) {
    return (
      <aside className="v10-ask">
        <div className="v10-sesstop">
          <button className="ses-back" style={{ background: 'var(--ink)', color: 'var(--paper)' }} onClick={() => props.onEnterSession?.(null)}>← 返回主对话</button>
          {renameMode ? (
            <input
              className="ses-rename"
              autoFocus
              defaultValue={active.title}
              onBlur={(e) => {
                void window.api?.renameSession?.(active.id, e.target.value.trim() || active.title)
                if (props.onSessionRenamed) props.onSessionRenamed(active.id, e.target.value.trim() || active.title)
                setRenameMode(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          ) : (
            <span className="ses-title" style={{ cursor: 'pointer' }} onClick={() => setRenameMode(true)} title="点击改名">
              {active.title}
            </span>
          )}
          <span className="ses-topic">{active.topic === 'project' ? '项目' : active.topic === 'life' ? '生活' : '通用'}</span>
          <button
            className={`ses-del${delArm ? ' armed' : ''}`}
            onClick={() => {
              if (!delArm) { setDelArm(true); window.setTimeout(() => setDelArm(false), 2500); return }
              void window.api?.removeSession?.(active.id)
              if (props.onSessionRemoved) props.onSessionRemoved(active.id)
              props.onEnterSession?.(null)
            }}
            title={delArm ? '再点一次确认删除' : '删除会话（两次点击确认）'}
          >
            {delArm ? '确认删?' : '✕'}
          </button>
        </div>
        <div className="v10-ask-scroll" ref={props.scrollRef}>
          {active.items.map((m, i) => (
            <div
              key={i}
              className={m.role === 'user' ? 'v10-msg-user' : 'v10-msg-ai'}
              style={{ position: 'relative' }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'application/x-workon-quote',
                  JSON.stringify({ text: m.text, from: `会话·${active.title.slice(0, 10)}` })
                )
              }}
            >
              {m.text}
              <button
                className="v10-msgdots"
                style={{ position: 'absolute', top: 2, right: m.role === 'user' ? 4 : undefined, left: m.role === 'user' ? undefined : 4, opacity: 0.5 }}
                title="删除这条"
                onClick={() => props.onDeleteSessionItem?.(i)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <SessionInput
          onSend={(t) => {
            props.onAddToSession?.(-1, active.id)
            props.onSend(t)
          }}
        />
      </aside>
    )
  }

  return (
    <aside className="v10-ask">
      {/* 会话上下文切换条（v10 简化模型：框即 session）——色点标识数据源 */}
      <div className="v10-ctxbar">
        {SESSION_CONTEXTS.map((c, ci) => (
          <button
            key={c.key}
            className={`ctx-chip${(props.activeContext ?? 'general') === c.key ? ' on' : ''}`}
            onClick={(e) => {
              props.onSetContext?.(c.key)
              // BUG-17：chip 抢了焦点导致打字/回车落空——切完立刻还给输入框
              ;(e.target as HTMLElement).blur()
              ;(document.querySelector('.v10-input') as HTMLTextAreaElement | null)?.focus()
            }}
            title={`切换到「${c.label}」会话——问答自动带上这份数据`}
          >
            <span className="ctx-dot" style={{ background: ['var(--ink-3)', '#0FB5A4', '#7C6FF0', '#D98E2B', '#38BDF8'][ci] }} />
            {c.label}
          </button>
        ))}
      </div>
      {props.glassControls ? (
        <div className="v10-sesstop" style={{ paddingBottom: 4 }}>
          <span className="ses-title" style={{ fontWeight: 600 }}>WorkOn · 问</span>
          <button
            className="mh-act"
            title="窗口置顶（浮在其他应用上）"
            onClick={(e) => {
              const on = (e.target as HTMLElement).classList.toggle('on')
              void window.api?.setPaneTop?.('ask', on)
            }}
          >
            📌
          </button>
          <button className="mh-act" style={{ marginLeft: 'auto' }} onClick={() => { void window.api?.snapPanes?.() }} title="两块玻璃片贴合固定（上下/左右按当前方位）">⎯ 吸附</button>
          <button className="mh-act" onClick={() => { void window.api?.collapsePane?.('ask') }} title="收起这块玻璃片（托盘玻璃模式唤回）">⇲ 收起</button>
          <button className="mh-act" onClick={() => { void window.api?.attachPanes?.() }} title="合回主窗一面">✕ 合回</button>
        </div>
      ) : null}
      {props.sessions && props.sessions.length > 0 ? (
        <div className="v10-sesstop" style={{ position: 'relative' }}>
          <button className="ses-back" onClick={() => setListOpen(!listOpen)}>会话 {props.sessions.length} ▸</button>
          {listOpen ? (
            <div className="v10-seslist">
              {props.sessions.map((x) => (
                <div key={x.id} className="v10-sesitem">
                  <button onClick={() => { props.onEnterSession?.(x.id); setListOpen(false) }}>
                    {x.title.slice(0, 16)}
                    <span className="ses-n">{x.items.length} 条</span>
                  </button>
                  <button
                    className={`ses-del${armedSesId === x.id ? ' armed' : ''}`}
                    title={armedSesId === x.id ? '再点一次确认删除' : '删除会话'}
                    onClick={() => {
                      if (armedSesId !== x.id) { setArmedSesId(x.id); window.setTimeout(() => setArmedSesId(null), 2500); return }
                      void window.api?.removeSession?.(x.id)
                      props.onSessionRemoved?.(x.id)
                      setArmedSesId(null)
                    }}
                  >
                    {armedSesId === x.id ? '确认删?' : '✕'}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="v10-ask-scroll" ref={props.scrollRef}>
        {!expanded && HIDE_COUNT > 0 ? (
          <button className="v10-chatfold" onClick={() => setExpanded(true)}>
            —— 更早的 {HIDE_COUNT} 条对话 · 点击展开 ——
          </button>
        ) : null}
        {visible.map((m, vi) => {
          const i = expanded || HIDE_COUNT <= 0 ? vi : HIDE_COUNT + vi
          return (
          <div
            key={i}
            className={m.role === 'user' ? 'v10-msg-user' : 'v10-msg-ai-wrap'}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                'application/x-workon-quote',
                JSON.stringify({ text: m.text, from: m.role === 'user' ? '我' : 'AI' })
              )
            }}
          >
            {m.role === 'ai' ? (
              <div className="v10-msg-ai" style={{ display: 'block' }}>
                <RichAnswer
                  text={m.text}
                  aiOn={props.aiOn}
                  sandboxLoading={props.sandboxLoading}
                  onMindmap={(src) => props.onSend(src.startsWith('__') ? src : `__page__${src}`)}
                  onAsk={(q) => props.onPrefill?.(q)}
                  onSandbox={(src) => props.onSend(src)}
                />
              </div>
            ) : (
              m.text
            )}
            <MsgActions
              idx={i}
              open={menuIdx === i}
              onToggle={() => setMenuIdx(menuIdx === i ? null : i)}
              sessions={props.sessions ?? []}
              onAddToSession={(sid, topic) => {
                props.onAddToSession?.(i, sid, topic)
                setMenuIdx(null)
              }}
              onDelete={() => {
                props.onDeleteMessage?.(i)
                setMenuIdx(null)
              }}
            />
            {m.options ? (
              <div className="v10-optrow">
                {m.options.map((o, oi) => (
                  <button
                    key={oi}
                    className={`v10-optbtn${m.picked === o ? ' picked' : ''}`}
                    onClick={() => props.onSend(String(oi + 1))}
                  >
                    {oi + 1}　{o}
                  </button>
                ))}
              </div>
            ) : null}
            {m.picked ? <div className="v10-picked">✓ {m.picked}</div> : null}
            {m.attach ? (
              <div className="v10-attachrow">
                <button className="v10-attach" onClick={() => props.onSend(`__${m.attach}__`)}>
                  ◇ 可拆件：状态导图 → 落右页
                </button>
              </div>
            ) : null}
          </div>
          )
        })}
        {props.asking ? <div className="v10-msg-ai v10-typing"><span /><span /><span /></div> : null}
        {props.sandboxLoading ? (
          <div className="v10-msg-ai v10-sandbox-loading">◈ 可视化生成中——AI 在画板块 <span className="v10-dots"><i /><i /><i /></span></div>
        ) : null}
      </div>
      <div className="v10-ask-inputbar">
        {props.quoteChip ? (
          <div className="v10-objchip quotec">
            <span className="chip-mark">❝</span>
            <span className="chip-label">引用 · {props.quoteChip.from}</span>
            <span className="chip-current">{props.quoteChip.text.slice(0, 26)}…</span>
            <button className="chip-x" onClick={() => props.onClearQuote?.()}>×</button>
          </div>
        ) : null}
        {props.objectChip ? (
          <div className="v10-objchip">
            <span className="chip-mark">◆</span>
            <span className="chip-label">{props.objectChip.label}</span>
            <span className="chip-current">{props.objectChip.current}</span>
            <button className="chip-x" onClick={() => props.onClearChip?.()}>×</button>
          </div>
        ) : null}
        <div className="v10-chiprow">
          <button className="v10-chip" onClick={() => props.onSend('我今天干了什么')}>
            我今天干了什么
          </button>
          <button className="v10-chip" onClick={() => props.onSend('晚上9点提醒我看日报')}>
            试试建提醒
          </button>
          {state ? (
            <button className="v10-chip" onClick={() => props.onSend(`我现在是什么状态？为什么是${STATE_LABEL[state]}`)}>
              现在的状态？
            </button>
          ) : null}
        </div>
        <textarea
          className={`v10-input${dropHot ? ' drop-hot' : ''}`}
          rows={2}
          placeholder={props.objectChip ? `调整「${props.objectChip.label}」：最近 7 天 / 换回来…` : '问点什么 / 说「晚上9点提醒我…」/ 回 ①② 编号…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-workon-block')) {
              e.preventDefault()
              setDropHot(true)
            }
          }}
          onDragLeave={() => setDropHot(false)}
          onDrop={handleDrop}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter 备用发送（输入法组合态吃 Enter 时的兜底）
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              submit()
              return
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
      </div>
    </aside>
  )
}
