/**
 * 左栏「问」：对话流（无气泡排版）+ 建议 chips + 输入场
 * 你的话 = 2px 墨竖线引文；AI = ◇ aura kick + prose（v10 §3.2）
 */
import { useState, type RefObject } from 'react'
import type { PresenceSnapshot, WorkState } from '@shared/types'
import { STATE_LABEL } from '@shared/stateMeta'

export interface ChatMsg {
  role: 'user' | 'ai'
  text: string
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
        {props.chat.map((m, i) =>
          m.role === 'user' ? (
            <div className="v10-msg-user" key={i}>{m.text}</div>
          ) : (
            <div className="v10-msg-ai" key={i}>{m.text}</div>
          )
        )}
        {props.asking ? <div className="v10-msg-ai">…</div> : null}
      </div>
      <div className="v10-ask-inputbar">
        <div className="v10-chiprow">
          <button className="v10-chip" onClick={() => props.onSend('我今天干了什么')}>
            我今天干了什么
          </button>
          <button className="v10-chip" onClick={() => props.onSend('这周专注趋势怎么样')}>
            这周专注趋势
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
          placeholder="问点什么，或把右页的东西拖到这里…"
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
