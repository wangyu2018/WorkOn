/**
 * 统计页取数缓存：进页先用旧数据画（0ms），后台重取后原地更新。
 * - key 级缓存跨挂载存活（模块级 Map），页面来回切不再逐天重拉
 * - effect 每次挂载都会重新拉取（stale-while-revalidate），缓存只负责首帧
 * - refreshing=true 表示正在用旧数据 + 后台更新，可给一个小「更新中」点
 */
import { useEffect, useState } from 'react'

const cache = new Map<string, unknown>()

export function useSWRish<T>(key: string, loader: () => Promise<T>): { data: T | null; refreshing: boolean } {
  const [data, setData] = useState<T | null>(() => (cache.get(key) as T | undefined) ?? null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let alive = true
    const hit = cache.get(key)
    if (hit !== undefined) setRefreshing(true)
    loader()
      .then((d) => {
        if (!alive) return
        cache.set(key, d)
        setData(d)
        setRefreshing(false)
      })
      .catch(() => { if (alive) setRefreshing(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { data, refreshing }
}
