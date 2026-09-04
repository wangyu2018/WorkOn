interface SkeletonProps {
  className?: string
}

/** 骨架屏块（v7 加载态）：shimmer 微光，结构与真实内容一致避免跳版 */
export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`skeleton-block ${className}`} />
}

/** 骨架屏动效（全局注入一次） */
if (typeof document !== 'undefined' && !document.getElementById('skeleton-keyframes')) {
  const el = document.createElement('style')
  el.id = 'skeleton-keyframes'
  el.textContent = `
    .skeleton-block {
      border-radius: 8px;
      background: linear-gradient(100deg, var(--surface-3) 40%, var(--surface-2) 50%, var(--surface-3) 60%);
      background-size: 200% 100%;
      animation: skeleton-shimmer 1.4s ease infinite;
    }
    @keyframes skeleton-shimmer {
      0% { background-position: 120% 0; }
      100% { background-position: -80% 0; }
    }
  `
  document.head.appendChild(el)
}
