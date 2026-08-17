import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

interface PageHeaderProps {
  icon: IconName
  title: string
  desc?: string
  /** 右侧操作区（按钮 / chip 等） */
  actions?: ReactNode
}

/** 统一页面头部：accent 图标盒 + 标题 + 副标题 + 右侧操作区（换主题自动联动） */
export function PageHeader({ icon, title, desc, actions }: PageHeaderProps) {
  return (
    <header className="flex items-center gap-3 px-0.5">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border"
        style={{
          background: 'var(--accent-softer)',
          borderColor: 'var(--border-active)',
          color: 'var(--accent)'
        }}
      >
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="text-[15px] font-semibold leading-tight tracking-wide text-slate-100">{title}</h1>
        {desc ? <p className="mt-0.5 text-[11px] leading-tight text-slate-500">{desc}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}
