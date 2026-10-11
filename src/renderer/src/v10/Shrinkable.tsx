/**
 * Shrinkable（v10 富件通用容器）：默认缩略（scale 缩小省空间），hover 浮起放大完整可视化。
 * 缩略态占位 = 实际高 × scale（useLayoutEffect 实测）；hover 时内层绝对定位浮起（不推挤文档流）。
 * 用户拍板（2026-10-11）：再结构化的导图类默认折叠缩小，鼠标移过去自动放大。
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function Shrinkable(props: { children: ReactNode; scale?: number; hint?: string }): JSX.Element {
  const scale = props.scale ?? 0.62
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [naturalH, setNaturalH] = useState(0)
  const [hover, setHover] = useState(false)

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    const measure = () => setNaturalH(el.offsetHeight)
    measure()
    // 内容/宽度变化时重测
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      className={`v10-shrink${hover ? ' hover' : ''}`}
      style={{ height: hover ? naturalH : naturalH * scale || undefined }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        ref={innerRef}
        className="v10-shrink-inner"
        style={{
          transform: `scale(${hover ? 1 : scale})`,
          transformOrigin: 'top left',
          width: `${100 / scale}%`
        }}
      >
        {props.children}
      </div>
      {!hover && naturalH > 40 ? (
        <span className="v10-shrink-hint" title={props.hint ?? '鼠标移过去放大'}>
          ⤢ {props.hint ?? '移过放大'}
        </span>
      ) : null}
    </div>
  )
}
