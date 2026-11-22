/**
 * 适配器事件队列：把子进程 / HTTP 的回调输出转成可消费的 AsyncIterable
 */
import { genId } from '@shared/types'
import type { AgentErrorCode, AgentEvent, AgentRunHandle } from '@shared/agentAdapter'

export class AgentEventQueue implements AsyncIterable<AgentEvent> {
  private buffer: AgentEvent[] = []
  private waiters: Array<(result: IteratorResult<AgentEvent>) => void> = []
  private closed = false

  push(event: AgentEvent): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value: event, done: false })
    else this.buffer.push(event)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return {
      next: () => {
        if (this.buffer.length) {
          return Promise.resolve({ value: this.buffer.shift() as AgentEvent, done: false })
        }
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      }
    }
  }
}

/** 不支持派发的协议返回一个立即报错的运行句柄，保持调用方路径一致 */
export function unsupportedRun(error: string, code: AgentErrorCode = 'unsupported'): AgentRunHandle {
  const runId = genId('run')
  const queue = new AgentEventQueue()
  const at = Date.now()
  queue.push({ type: 'run_started', runId, at })
  queue.push({ type: 'run_error', runId, code, error, at })
  queue.close()
  return {
    runId,
    events: queue,
    cancel: async () => { /* 已结束，无需取消 */ }
  }
}
