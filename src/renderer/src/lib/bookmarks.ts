/**
 * 顶部数据书签：任意页面的一条数据都可以固定到顶部书签栏
 * - 只保存展示信息，不复制业务数据
 * - 点击时由来源页面自己定位（通过 workon:bookmark-open 事件）
 */
import { useCallback, useEffect, useState } from 'react'
import type { IconName } from '../components/Icon'

export interface BookmarkItem {
  /** 稳定唯一键：page + refId，例如 plan:xxx */
  id: string
  /** 来源页面（ViewKey 字符串） */
  page: string
  /** 来源数据 id */
  refId: string
  title: string
  /** 辅助信息：日期 / 时间等 */
  meta?: string
  icon?: IconName
  /** 来源页面定位参数（例如计划的日期） */
  locator?: string
  /** 来源页面内的分组（例如计划分类 / 项目组） */
  group?: string
  createdAt: number
}

const KEY = 'workon:bookmarks'
const CHANGED = 'workon:bookmarks-changed'
const LIMIT = 16

export function loadBookmarks(): BookmarkItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as BookmarkItem[]
    return (Array.isArray(raw) ? raw : []).filter((b) => b && b.id && b.title).slice(0, LIMIT)
  } catch {
    return []
  }
}

function save(list: BookmarkItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIMIT)))
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(CHANGED))
}

/** 添加（已存在则不重复添加） */
export function addBookmark(item: BookmarkItem): void {
  const list = loadBookmarks()
  if (list.some((b) => b.id === item.id)) return
  save([...list, { ...item, createdAt: item.createdAt || Date.now() }])
}

export function removeBookmark(id: string): void {
  save(loadBookmarks().filter((b) => b.id !== id))
}

/** 点图钉：已固定则取消，未固定则加入 */
export function toggleBookmark(item: BookmarkItem): boolean {
  const list = loadBookmarks()
  const exists = list.some((b) => b.id === item.id)
  if (exists) save(list.filter((b) => b.id !== item.id))
  else save([...list, { ...item, createdAt: item.createdAt || Date.now() }])
  return !exists
}

/** 拖动排序：把 fromId 插到 beforeId 前面 */
export function moveBookmark(fromId: string, beforeId: string): void {
  const list = loadBookmarks()
  const from = list.findIndex((b) => b.id === fromId)
  const to = list.findIndex((b) => b.id === beforeId)
  if (from < 0 || to < 0 || from === to) return
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  save(next)
}

export function useBookmarks(): {
  items: BookmarkItem[]
  has: (id: string) => boolean
  toggle: (item: BookmarkItem) => boolean
  remove: (id: string) => void
  move: (fromId: string, beforeId: string) => void
} {
  const [items, setItems] = useState<BookmarkItem[]>(loadBookmarks)

  useEffect(() => {
    const reload = (): void => setItems(loadBookmarks())
    window.addEventListener(CHANGED, reload)
    return () => window.removeEventListener(CHANGED, reload)
  }, [])

  const has = useCallback((id: string): boolean => items.some((b) => b.id === id), [items])
  const toggle = useCallback((item: BookmarkItem): boolean => toggleBookmark(item), [])
  const remove = useCallback((id: string): void => removeBookmark(id), [])
  const move = useCallback((fromId: string, beforeId: string): void => moveBookmark(fromId, beforeId), [])

  return { items, has, toggle, remove, move }
}
