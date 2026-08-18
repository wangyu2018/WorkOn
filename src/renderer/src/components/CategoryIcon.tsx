import { CATEGORY_META, type AppCategory } from '@shared/appCategory'

/**
 * 分类图标：优先 sprite `<use href="#cat-xxx">`（线性图标），
 * 降级为内联 path，再降级 emoji。
 * 颜色统一用 meta.color（分类 hex）。
 */
export function CategoryIcon({ cat, size = 14 }: { cat: AppCategory; size?: number }) {
  const meta = CATEGORY_META[cat]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: meta.color, flexShrink: 0 }}
      aria-hidden
    >
      <use href={`#cat-${cat}`} />
    </svg>
  )
}
