import { useEffect, useState } from 'react'

interface AiThinkingProps {
  /** 场景文案数组，随进度轮换 */
  hints?: string[]
  progress?: number
}

const DEFAULT_HINTS = ['正在翻阅你最近的时段…', '正在比对历史节奏…', '快要好了，别急…']

/** AI 思考态（v7）：✦ 渐变头像 + 跳动点 + 场景文案轮换 */
export function AiThinking({ hints = DEFAULT_HINTS, progress }: AiThinkingProps) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setIdx((i) => (i + 1) % hints.length), 2600)
    return () => window.clearInterval(t)
  }, [hints.length])
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-sm text-white"
        style={{ background: 'var(--aura)', boxShadow: 'var(--glow-i)' }}
      >
        ✦
      </span>
      <div>
        <div className="ai-think-dots flex items-center gap-1">
          <i />
          <i />
          <i />
        </div>
        <div className="mt-1 text-2xs text-slate-400">
          {hints[idx]}
          {typeof progress === 'number' ? ` ${Math.round(progress * 100)}%` : ''}
        </div>
      </div>
    </div>
  )
}

/** 思考点动效（全局注入一次） */
if (typeof document !== 'undefined' && !document.getElementById('ai-think-keyframes')) {
  const el = document.createElement('style')
  el.id = 'ai-think-keyframes'
  el.textContent = `
    .ai-think-dots i {
      width: 5px; height: 5px; border-radius: 50%;
      background: var(--violet); opacity: .4;
      animation: ai-think-bounce 1.2s ease-in-out infinite;
    }
    .ai-think-dots i:nth-child(2) { animation-delay: .15s; }
    .ai-think-dots i:nth-child(3) { animation-delay: .3s; }
    @keyframes ai-think-bounce {
      0%, 100% { transform: translateY(0); opacity: .35; }
      40% { transform: translateY(-4px); opacity: 1; }
    }
  `
  document.head.appendChild(el)
}
