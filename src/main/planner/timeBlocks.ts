/**
 * 计划时间块：把「任务排序」升级为「可执行排期」
 * 只做确定性排版，不写库；是否落库由上层预览确认决定。
 */

export interface BusyRange {
  startMin: number
  endMin: number
}

export interface SchedulableTask {
  taskId: string
  title: string
  projectName?: string
  priority?: 'low' | 'medium' | 'high'
  estMin?: number
}

export interface PlanBlock {
  taskId: string
  title: string
  projectName?: string
  date: string
  startMin: number
  endMin: number
}

export interface PlanBlocksInput {
  date: string
  tasks: SchedulableTask[]
  busy?: BusyRange[]
  dayStartMin?: number
  dayEndMin?: number
  minBlock?: number
  bufferMin?: number
}

function mergeBusy(busy: BusyRange[]): BusyRange[] {
  const sorted = [...busy].filter((b) => b.endMin > b.startMin).sort((a, b) => a.startMin - b.startMin)
  const out: BusyRange[] = []
  for (const b of sorted) {
    const last = out[out.length - 1]
    if (last && b.startMin <= last.endMin) last.endMin = Math.max(last.endMin, b.endMin)
    else out.push({ ...b })
  }
  return out
}

/** 在忙碌区间之间顺序装箱；任务超过单块上限时自动拆分 */
export function planBlocks(input: PlanBlocksInput): PlanBlock[] {
  const dayStart = input.dayStartMin ?? 9 * 60
  const dayEnd = input.dayEndMin ?? 21 * 60
  const minBlock = Math.max(15, input.minBlock ?? 25)
  const buffer = Math.max(0, input.bufferMin ?? 10)
  const busy = mergeBusy(input.busy ?? [])
  const blocks: PlanBlock[] = []
  let pointer = dayStart

  const nextBusyStart = (from: number): number => {
    const hit = busy.find((b) => from >= b.startMin && from < b.endMin)
    if (hit) return hit.endMin
    return from
  }

  for (const task of input.tasks) {
    let remaining = Math.max(minBlock, task.estMin && task.estMin > 0 ? task.estMin : 60)
    let guard = 0
    while (remaining > 0 && guard < 24) {
      guard += 1
      pointer = nextBusyStart(pointer)
      if (pointer >= dayEnd) break
      const upcoming = busy.find((b) => b.startMin > pointer)
      const hardEnd = upcoming ? Math.min(dayEnd, upcoming.startMin) : dayEnd
      const room = hardEnd - pointer
      if (room < minBlock) {
        pointer = upcoming ? upcoming.endMin : dayEnd
        continue
      }
      const dur = Math.min(remaining, 120, room)
      blocks.push({
        taskId: task.taskId,
        title: task.title,
        projectName: task.projectName,
        date: input.date,
        startMin: pointer,
        endMin: pointer + dur
      })
      pointer += dur + buffer
      remaining -= dur
    }
  }
  return blocks
}

export interface ReplanSuggestion {
  taskId: string
  title: string
  action: 'defer' | 'split' | 'drop'
  startMin?: number
  endMin?: number
  reason: string
}

/** 每 15 分钟对比未完成块，产出顺延/拆分/放弃建议（不直接改库） */
export function replanSuggestions(input: {
  nowMin: number
  blocks: PlanBlock[]
  doneTaskIds?: string[]
  dayEndMin?: number
}): ReplanSuggestion[] {
  const done = new Set(input.doneTaskIds ?? [])
  const dayEnd = input.dayEndMin ?? 21 * 60
  const out: ReplanSuggestion[] = []
  for (const b of input.blocks) {
    if (done.has(b.taskId)) continue
    if (b.endMin <= input.nowMin) {
      out.push({ taskId: b.taskId, title: b.title, action: 'defer', reason: '已过计划时段，建议顺延到下一个空档' })
      continue
    }
    if (b.startMin < input.nowMin && b.endMin > input.nowMin) {
      const left = b.endMin - input.nowMin
      if (left < 25) {
        out.push({ taskId: b.taskId, title: b.title, action: 'drop', reason: '剩余时间不足 25 分钟，建议今天放弃' })
      } else {
        out.push({
          taskId: b.taskId,
          title: b.title,
          action: 'split',
          startMin: input.nowMin,
          endMin: b.endMin,
          reason: `从当前时间继续，剩余 ${left} 分钟`
        })
      }
      continue
    }
    if (b.startMin > dayEnd) {
      out.push({ taskId: b.taskId, title: b.title, action: 'defer', reason: '超出今日可用时间，建议顺延到明天' })
    }
  }
  return out
}
