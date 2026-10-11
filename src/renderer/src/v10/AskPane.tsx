/**
 * 左栏「问」：对话流（无气泡排版）+ 建议 chips + 输入场 + 对象芯片（块进化）
 * 你的话 = 2px 墨竖线引文；AI = ◇ aura kick + prose（v10 §3.2）
 * 快捷回复协议（v10 §7）：带选项的消息渲染 ①② 大按钮，输入框回数字即答
 * 块进化（v10 §4.C）：右页组件拖入输入场 → 挂对象芯片 → 一句话调参数
 */
import { useState, type RefObject, type DragEvent } from 'react'
import type { PresenceSnapshot, WorkState, ChatSession } from '@shared/types'
import { STATE_LABEL } from '@shared/stateMeta'
import { renderMarkdown } from './md'
import { detectStructured, StructuredCard } from './structured'
import { MindMap } from './mindmap'
import { Shrinkable } from './Shrinkable'

/** AI 回答富呈现（v10）：结构化答卡优先（KPI/条形）→ markdown → 长文折叠 */
function RichAnswer(props: { text: string; onMindmap?: (src: string) => void }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [mapped, setMapped] = useState(false)
  const s = detectStructured(props.text)
  const long = props.text.length > 420
  // 思维导图拆件资格：长回答或含 markdown 结构（标题/列表/表格）——信息的再结构化
  const mdStructured = /^#{1,3}\s|\n[-*•]\s|\n\s*\|/.test(props.text)
  const canMap = props.text.length > 120 || mdStructured

  const mapBlock = canMap ? (
    mapped ? (
      <div className="v10-attachrow">
        <Shrinkable scale={0.66} hint="思维导图 · 移过放大">
          <MindMap text={props.text} rootLabel="回答" width={520} />
        </Shrinkable>
      </div>
    ) : (
      <div className="v10-attachrow">
        <button
          className="v10-attach"
          onClick={() => {
            setMapped(true)
            props.onMindmap?.(props.text)
          }}
        >
          ◇ 再结构化：思维导图 ▾
        </button>
      </div>
    )
  ) : null

  if (s) {
    return (
      <div className="v10-rich">
        <StructuredCard s={s} />
        {mapBlock}
      </div>
    )
  }
  const body = renderMarkdown(props.text)
  if (long && !expanded) {
    return (
      <div className="v10-rich">
        <div className="v10-clamp">{body}</div>
        <button className="v10-more" onClick={() => setExpanded(true)}>展开全文（{props.text.length} 字）▾</button>
        {mapBlock}
      </div>
    )
  }
  return (
    <div className="v10-rich">
      {body}
      {mapBlock}
    </div>
  )
}

export interface ChatMsg {
  role: 'user' | 'ai'
  text: string
  /** 快捷回复选项（带编号展示，回数字或点按） */
  options?: string[]
  /** 已选择的选项（应答后定格显示） */
  picked?: string
  /** 答卡可拆件：回答附带的落页件（点按触发） */
  attach?: 'flowmap' | 'mindmap'
  /** 拆件数据源（mindmap 用：原始回答文本） */
  attachSrc?: string
}

/** 块进化对象芯片：从右页拖入的组件描述 */
export interface ObjectChipData {
  blockKey: string
  label: string
  current: string
}

export function MsgActions(props: {
  idx: number
  open: boolean
  onToggle: () => void
  sessions: ChatSession[]
  onAddToSession: (sessionId: string | null, topic?: 'project' | 'life' | 'general') => void
}): JSX.Element {
  const [level, setLevel] = useState<'root' | 'pick'>('root')
  if (!props.open) {
    return (
      <button className="v10-msgdots" onClick={props.onToggle} title="加入会话 / 归档">
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
  /** 会话（v10）：列表 + 当前进入的会话 + 动作回调 */
  sessions?: ChatSession[]
  activeSessionId?: string | null
  onEnterSession?: (id: string | null) => void
  onAddToSession?: (msgIndex: number, sessionId: string | null, topic?: 'project' | 'life' | 'general') => void
  onSessionRenamed?: (id: string, title: string) => void
  onSessionRemoved?: (id: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const [dropHot, setDropHot] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const state: WorkState | undefined = props.presence?.state
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
      const raw = e.dataTransfer.getData('application/x-workon-block')
      if (raw) {
        const data = JSON.parse(raw) as ObjectChipData
        if (props.onClearChip !== undefined) {
          // 挂芯片（覆盖旧的）
          props.onSend(`__chip__${JSON.stringify(data)}`)
        }
      }
    } catch { /* 非块拖拽忽略 */ }
  }

  const [menuIdx, setMenuIdx] = useState<number | null>(null) // 行内动作面板（零浮层：hover ⋯ 展开）
  const [listOpen, setListOpen] = useState(false) // 会话列表下拉
  const active = props.sessions?.find((x) => x.id === props.activeSessionId) ?? null

  // 会话视图：进入某会话后左栏显示其消息 + 继续追问
  const [renameMode, setRenameMode] = useState(false)
  const [delArm, setDelArm] = useState(false)
  if (active) {
    return (
      <aside className="v10-ask">
        <div className="v10-sesstop">
          <button className="ses-back" onClick={() => props.onEnterSession?.(null)}>← 对话</button>
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
            <div key={i} className={m.role === 'user' ? 'v10-msg-user' : 'v10-msg-ai'}>
              {m.text}
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
      {props.sessions && props.sessions.length > 0 ? (
        <div className="v10-sesstop" style={{ position: 'relative' }}>
          <button className="ses-back" onClick={() => setListOpen(!listOpen)}>会话 {props.sessions.length} ▸</button>
          {listOpen ? (
            <div className="v10-seslist">
              {props.sessions.map((x) => (
                <button key={x.id} onClick={() => { props.onEnterSession?.(x.id); setListOpen(false) }}>
                  {x.title.slice(0, 16)}
                  <span className="ses-n">{x.items.length} 条</span>
                </button>
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
          <div key={i} className={m.role === 'user' ? 'v10-msg-user' : 'v10-msg-ai-wrap'}>
            {m.role === 'ai' ? (
              <div className="v10-msg-ai" style={{ display: 'block' }}>
                <RichAnswer text={m.text} />
              </div>
            ) : (
              <div className="v10-msg-user">{m.text}</div>
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
        {props.asking ? <div className="v10-msg-ai">…</div> : null}
      </div>
      <div className="v10-ask-inputbar">
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
