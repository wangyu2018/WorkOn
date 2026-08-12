/**
 * 通知去重分发器（甲-4）
 * 桌面形象 + 浮窗同事件只呈现一次
 */
type NotifyListener = (id: string) => void
const listeners = new Map<string, Set<NotifyListener>>()
const recentIds = new Set<string>()

/** 发射通知事件，同 id 在 30s 内不重复 */
export function emitNotify(id: string, surface: string): void {
  const dedupKey = `${surface}:${id}`
  if (recentIds.has(dedupKey)) return
  recentIds.add(dedupKey)
  setTimeout(() => recentIds.delete(dedupKey), 30000)

  // 优先桌面表达，浮窗只浅闪
  const cbs = listeners.get(id)
  if (cbs) {
    for (const cb of cbs) cb(id)
  }
}

/** 注册通知监听 */
export function onNotify(id: string, cb: NotifyListener): () => void {
  let cbs = listeners.get(id)
  if (!cbs) { cbs = new Set(); listeners.set(id, cbs) }
  cbs.add(cb)
  return () => { cbs?.delete(cb); if (cbs?.size === 0) listeners.delete(id) }
}
