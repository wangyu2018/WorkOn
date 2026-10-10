/**
 * 左栏「问」：对话流（无气泡排版）+ 建议 chips + 输入场 + 对象芯片（块进化）
 * 你的话 = 2px 墨竖线引文；AI = ◇ aura kick + prose（v10 §3.2）
 * 快捷回复协议（v10 §7）：带选项的消息渲染 ①② 大按钮，输入框回数字即答
 * 块进化（v10 §4.C）：右页组件拖入输入场 → 挂对象芯片 → 一句话调参数
 */
import { useState, type RefObject, type DragEvent } from 'react'
import type { PresenceSnapshot, WorkState } from '@shared/types'
import { STATE_LABEL } from '@shared/stateMeta'

export interface ChatMsg {
  role: 'user' | 'ai'
  text: string
  /** 快捷回复选项（带编号展示，回数字或点按） */
  options?: string[]
  /** 已选择的选项（应答后定格显示） */
  picked?: string
}

/** 块进化对象芯片：从右页拖入的组件描述 */
export interface ObjectChipData {
  blockKey: string
  label: string
  current: string
}

export function AskPane(props: {
  chat: ChatMsg[]
  asking: boolean
  onSend: (text: string) => void
  scrollRef: RefObject<HTMLDivElement>
  presence: PresenceSnapshot | null
  objectChip?: ObjectChipData | null
  onClearChip?: () => void
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

  return (
    <aside className="v10-ask">
      <div className="v10-ask-scroll" ref={props.scrollRef}>
        {!expanded && HIDE_COUNT > 0 ? (
          <button className="v10-chatfold" onClick={() => setExpanded(true)}>
            —— 更早的 {HIDE_COUNT} 条对话 · 点击展开 ——
          </button>
        ) : null}
        {visible.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'v10-msg-user' : 'v10-msg-ai-wrap'}>
            <div className={m.role === 'user' ? undefined : 'v10-msg-ai'} style={m.role === 'user' ? undefined : { display: 'inline' }}>
              {m.role === 'ai' ? <span style={{ display: 'inline' }}>{m.text}</span> : m.text}
            </div>
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
          </div>
        ))}
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
