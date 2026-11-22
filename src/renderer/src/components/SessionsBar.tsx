/**
 * 左侧会话栏：全局会话入口（默认展示最近 10 条，其余「更多」）
 * - 可收起为左侧窄条
 * - 点击会话 → 打开全局会话悬浮窗并切换
 * - 与右侧栏、页面浮窗互不遮挡
 */
import { useCallback, useEffect, useState } from 'react'
import type { ChatSession } from '@shared/types'
import { Icon } from './Icon'

const LEFT_OPEN_KEY = 'workon:leftbar-open'
const DEFAULT_VISIBLE = 10

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 会话摘要：优先首条用户消息（比 AI 兜底文案更能看懂在做什么） */
function sessionSummary(s: ChatSession): string {
  const u = s.items.find((m) => m.role === 'user' && String(m.text ?? '').trim())
  return String(u?.text || s.title || '未命名会话').replace(/\s+/g, ' ').trim()
}

export function SessionsBar({
  activeId,
  onOpenSession
}: {
  activeId: string
  onOpenSession: (id: string) => void
}): JSX.Element {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [expanded, setExpanded] = useState(false)
  /** 归档视图：只显示 archived=true 的会话，可恢复 */
  const [showArchived, setShowArchived] = useState(false)
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(LEFT_OPEN_KEY) !== '0'
    } catch {
      return true
    }
  })

  const load = useCallback((): void => {
    void window.api
      .listSessions()
      .then((list) => setSessions(((list as ChatSession[]) ?? []).slice(0, 200)))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    load()
    const offChanged = (): void => load()
    window.addEventListener('workon:sessions-changed', offChanged)
    return () => {
      window.removeEventListener('workon:sessions-changed', offChanged)
    }
  }, [load])

  const setArchived = async (id: string, archived: boolean): Promise<void> => {
    await window.api.archiveSession?.(id, archived)
    load()
    window.dispatchEvent(new CustomEvent('workon:sessions-changed'))
  }

  const toggle = (): void => {
    setOpen((v) => {
      const next = !v
      try {
        localStorage.setItem(LEFT_OPEN_KEY, next ? '1' : '0')
      } catch { /* ignore */ }
      return next
    })
  }

  if (!open) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center py-3">
        <button
          type="button"
          onClick={toggle}
          title="展开会话栏"
          aria-label="展开会话栏"
          className="flex h-24 w-11 flex-col items-center justify-center gap-2 rounded-xl text-2xs transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--line-strong)',
            color: 'var(--text-2)'
          }}
        >
          <Icon name="chevronRight" size={13} />
          <span style={{ writingMode: 'vertical-rl' }}>会话</span>
        </button>
      </div>
    )
  }

  const activeSessions = sessions.filter((s) => !s.archived)
  const archivedSessions = sessions.filter((s) => s.archived)
  const source = showArchived ? archivedSessions : activeSessions
  const visible = showArchived || expanded ? source : source.slice(0, DEFAULT_VISIBLE)
  const rest = showArchived ? 0 : Math.max(0, source.length - DEFAULT_VISIBLE)

  return (
    <aside className="flex w-[248px] shrink-0 flex-col p-2">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--line-strong)',
          boxShadow: 'var(--shadow-md)'
        }}
      >
        <div
          className="flex shrink-0 items-center gap-1.5 px-2.5 py-2"
          style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}
        >
          <span className="text-xs font-medium text-[var(--text-2)]">{showArchived ? '已归档' : '会话'}</span>
          <span className="text-2xs text-[var(--text-3)]">{source.length}</span>
          <button
            type="button"
            className="ml-auto flex h-7 shrink-0 items-center gap-1 rounded-lg px-1.5 text-2xs text-[var(--text-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            style={{ border: '1px solid var(--line)' }}
            title={showArchived ? '返回会话列表' : `查看归档会话（${archivedSessions.length}）`}
            aria-label={showArchived ? '返回会话列表' : '查看归档会话'}
            onClick={() => {
              setShowArchived((v) => !v)
              setExpanded(false)
            }}
          >
            <Icon name={showArchived ? 'chevronLeft' : 'folder'} size={12} />
            {showArchived ? '返回' : `归档 ${archivedSessions.length}`}
          </button>
          <button
            type="button"
            className="ui-icon-btn"
            style={{ background: 'var(--accent-soft)', border: '1px solid var(--border-active)', color: 'var(--accent)' }}
            title="新建会话"
            aria-label="新建会话"
            onClick={() => {
              onOpenSession('')
              window.setTimeout(() => window.dispatchEvent(new CustomEvent('workon:new-chat')), 60)
            }}
          >
            <Icon name="plus" size={13} />
          </button>
          <button
            type="button"
            className="ui-icon-btn"
            style={{ border: '1px solid var(--line)', color: 'var(--text-2)' }}
            title="收起会话栏"
            aria-label="收起会话栏"
            onClick={toggle}
          >
            <Icon name="chevronLeft" size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-1">
          {visible.length === 0 ? (
            <div className="px-2 py-3 text-2xs text-[var(--text-3)]">
              {showArchived ? '还没有归档会话' : '还没有会话，点右上角 ＋ 开始'}
            </div>
          ) : null}
          {visible.map((s) => (
            <div
              key={s.id}
              className={`group mb-0.5 flex items-center gap-1 rounded-lg pr-1 ${
                s.id === activeId ? 'bg-[var(--surface-3)]' : 'hover:bg-[var(--surface-2)]'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  onOpenSession(s.id)
                  // 浮窗刚打开时监听器才挂载，延迟一拍再切换会话
                  window.setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('workon:open-session', { detail: s.id }))
                  }, 60)
                }}
                className={`flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1.5 text-left ${
                  s.id === activeId ? 'text-[var(--text-1)]' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
                }`}
                title={`${s.title}${s.items.length ? ` · ${s.items.length} 条` : ''}`}
              >
                <Icon name="message" size={11} className="mt-0.5 shrink-0 opacity-50" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-2xs">{sessionSummary(s)}</span>
                  <span className="text-[10px] text-[var(--text-3)]">
                    {s.items.length} 条 · {fmtTime(s.updatedAt)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={`shrink-0 rounded px-1 py-0.5 text-2xs text-[var(--text-3)] hover:text-[var(--accent)] group-hover:opacity-100 ${
                  showArchived ? '' : 'opacity-0'
                }`}
                title={showArchived ? '恢复会话' : '归档会话'}
                onClick={() => void setArchived(s.id, !showArchived)}
              >
                {showArchived ? '恢复' : '归档'}
              </button>
            </div>
          ))}
        </div>

        {rest > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 px-2.5 py-2 text-2xs text-[var(--text-3)] hover:text-[var(--text-1)]"
            style={{ borderTop: '1px solid var(--line)' }}
          >
            {expanded ? '收起' : `更多（${rest}）`}
          </button>
        ) : null}
      </div>
    </aside>
  )
}
