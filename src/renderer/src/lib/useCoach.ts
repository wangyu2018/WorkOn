import { useCallback, useEffect, useState } from 'react'
import type { CoachActionKey, CoachState } from '@shared/coach'

const EMPTY: CoachState = {
  items: [],
  stats: { shown: 0, accepted: 0, followed: 0, followRate: 0 },
  snoozeUntil: 0
}

/** 闭环助手状态：加载今日提示 + 订阅新卡片/状态变更 */
export function useCoach() {
  const [state, setState] = useState<CoachState>(EMPTY)

  const refresh = useCallback(() => {
    void window.api.coachList().then(setState).catch(() => undefined)
  }, [])

  useEffect(() => {
    refresh()
    const offCard = window.api.onCoachCard(() => refresh())
    const offUpdate = window.api.onCoachUpdate(() => refresh())
    return () => {
      offCard()
      offUpdate()
    }
  }, [refresh])

  const act = useCallback(async (id: string, action: CoachActionKey) => {
    try {
      setState(await window.api.coachAct(id, action))
    } catch {
      /* ignore */
    }
  }, [])

  const evaluate = useCallback(async () => {
    try {
      await window.api.coachEvaluate(true)
    } catch {
      /* ignore */
    }
    refresh()
  }, [refresh])

  const snooze = useCallback(async (minutes?: number) => {
    try {
      setState(await window.api.coachSnooze(minutes))
    } catch {
      /* ignore */
    }
  }, [])

  const clear = useCallback(async () => {
    try {
      setState(await window.api.coachClear())
    } catch {
      /* ignore */
    }
  }, [])

  return { state, refresh, act, evaluate, snooze, clear }
}
