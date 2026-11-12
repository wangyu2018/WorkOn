import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

interface PageHeaderProps {
  icon: IconName
  title: string
  desc?: string
  /** 右侧操作区（按钮 / chip 等） */
  actions?: ReactNode
}

/** 统一页面头部：大标题 + 一句说明 + 右侧操作（Today 式，不放图标盒） */
export function PageHeader({ icon, title, desc, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold leading-tight tracking-[-0.02em] text-slate-100">
          <Icon name={icon} size={18} className="shrink-0 text-slate-500" />
          {title}
        </h1>
        {desc ? <div className="mt-1 text-sm text-slate-500">{desc}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}
