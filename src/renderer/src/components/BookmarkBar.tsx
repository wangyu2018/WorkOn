/**
 * 顶部数据书签栏：挂在主顶栏下方
 * - 任意页面的一条数据（如计划）都可以固定成书签
 * - 点击跳回来源页面并定位；可拖动排序，拖入时高亮吸附
 */
import { useState, type DragEvent } from 'react'
import { useAppStore, type ViewKey } from '../stores/appStore'
import { Icon, type IconName } from './Icon'
import { addBookmark, useBookmarks, type BookmarkItem } from '../lib/bookmarks'

const MIME_BOOKMARK = 'application/x-workon-bookmark'
const MIME_MOVE = 'application/x-workon-bookmark-id'

export function BookmarkBar(): JSX.Element {
  const { items, remove, move } = useBookmarks()
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropHot, setDropHot] = useState(false)

  const open = (b: BookmarkItem): void => {
    setView(b.page as ViewKey)
    // 页面可能刚挂载，等一拍再派发定位事件
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('workon:bookmark-open', { detail: b }))
    }, 80)
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    const types = Array.from(e.dataTransfer.types)
    if (types.includes(MIME_BOOKMARK)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDropHot(true)
    } else if (types.includes(MIME_MOVE)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }

  const onDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHot(false)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    setDropHot(false)
    const raw = e.dataTransfer.getData(MIME_BOOKMARK)
    if (!raw) return
    e.preventDefault()
    try {
      const item = JSON.parse(raw) as BookmarkItem
      if (item?.id && item?.title) addBookmark(item)
    } catch { /* ignore */ }
  }

  return (
    <div
      className="relative z-20 flex h-9 shrink-0 items-center gap-2 px-4"
      style={{
        background: dropHot ? 'var(--accent-soft)' : 'var(--surface-2)',
        borderBottom: '1px solid var(--line)',
        boxShadow: dropHot ? 'inset 0 0 0 1px var(--border-active)' : undefined,
        transition: 'background 140ms ease, box-shadow 140ms ease'
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className="flex shrink-0 items-center gap-1 text-2xs text-[var(--text-3)]">
        <Icon name="pin" size={11} />
        书签
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {items.length === 0 ? (
          <span className="shrink-0 text-2xs text-[var(--text-3)]">
            在计划条目上点图钉固定到这里，或把图钉直接拖进来
          </span>
        ) : null}
        {items.map((b) => {
          const active = view === b.page
          return (
            <div
              key={b.id}
              draggable
              onDragStart={(e) => {
                setDragId(b.id)
                e.dataTransfer.setData(MIME_MOVE, b.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (!dragId || dragId === b.id) return
                e.preventDefault()
                move(dragId, b.id)
              }}
              className={`group relative flex shrink-0 items-center rounded-full pl-2.5 pr-1 text-2xs transition-all duration-150 ${
                dragId === b.id ? 'scale-105 opacity-60' : 'hover:-translate-y-0.5 hover:shadow-sm'
              }`}
              style={{
                background: active ? 'var(--accent-soft)' : 'var(--surface-3)',
                border: `1px solid ${active ? 'var(--border-active)' : 'var(--line)'}`,
                color: active ? 'var(--accent)' : 'var(--text-2)',
                cursor: 'grab'
              }}
            >
              <button
                type="button"
                onClick={() => open(b)}
                title={`${b.title}${b.meta ? ` · ${b.meta}` : ''}`}
                className="flex min-w-0 items-center gap-1.5 py-1 text-left"
              >
                <Icon name={(b.icon ?? 'pin') as IconName} size={11} className="shrink-0 opacity-70" />
                <span className="max-w-[200px] truncate">{b.title}</span>
                {b.meta ? <span className="shrink-0 opacity-55">{b.meta}</span> : null}
              </button>
              <button
                type="button"
                className="ml-1 hidden h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)] group-hover:flex"
                title="取消固定"
                aria-label="取消固定"
                onClick={() => remove(b.id)}
              >
                <Icon name="x" size={9} />
              </button>
            </div>
          )
        })}
      </div>

      <span className="shrink-0 text-2xs text-[var(--text-3)]">
        {items.length > 0 ? `${items.length} 条 · 拖动排序` : null}
      </span>
      {dropHot ? (
        <span
          className="pointer-events-none absolute inset-x-2 inset-y-0 rounded-lg border border-dashed"
          style={{ borderColor: 'var(--accent)', opacity: 0.8 }}
        />
      ) : null}
    </div>
  )
}
