/**
 * 左栏「问」：对话流（无气泡排版）+ 建议 chips + 输入场
 * 你的话 = 2px 墨竖线引文；AI = ◇ aura kick + prose（v10 §3.2）
 * 快捷回复协议（v10 §7）：带选项的消息渲染 ①② 大按钮，输入框回数字即答
 */
import { useState, type RefObject } from 'react'
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

export function AskPane(props: {
  chat: ChatMsg[]
  asking: boolean
  onSend: (text: string) => void
  scrollRef: RefObject<HTMLDivElement>
  presence: PresenceSnapshot | null
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const state: WorkState | undefined = props.presence?.state

  const submit = (): void => {
    if (!draft.trim()) return
    props.onSend(draft)
    setDraft('')
  }

  return (
    <aside className="v10-ask">
      <div className="v10-ask-scroll" ref={props.scrollRef}>
        {props.chat.map((m, i) => (
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
          className="v10-input"
          rows={2}
          placeholder="问点什么 / 说「晚上9点提醒我…」/ 回 ①② 编号…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
