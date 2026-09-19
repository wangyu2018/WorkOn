/**
 * 当前视角 hook：手动锁（settings.perspectiveLock）优先，否则按时钟。
 * 30s 重算一次，跨视角边界自然过渡。
 */
import { useEffect, useState } from 'react'
import { autoPerspective, type Perspective } from '@shared/perspective'
import { useSettingsStore } from '../stores/settingsStore'

export function usePerspective(): {
  perspective: Perspective
  /** 手动锁定的视角；null = 自动 */
  locked: Perspective | null
  lock: (p: Perspective | null) => Promise<void>
} {
  const locked = useSettingsStore((s) => s.settings.perspectiveLock ?? null)
  const patch = useSettingsStore((s) => s.patch)
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 30000)
    return () => window.clearInterval(t)
  }, [])
  return {
    perspective: locked ?? autoPerspective(),
    locked,
    lock: (p) => patch({ perspectiveLock: p })
  }
}
