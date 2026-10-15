/**
 * Shrinkable（v10 富件通用容器）：默认缩略（scale 缩小省空间），
 * hover/点击浮起放大——FEAT-7（QA 需求）：放大改整页居中 overlay（脱离左栏 360px 约束），
 * 点遮罩或 ESC 关闭。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Shrinkable(props: { children: ReactNode; scale?: number; hint?: string }): JSX.Element {
  const scale = props.scale ?? 0.62
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [naturalH, setNaturalH] = useState(0)
  const [zoom, setZoom] = useState(false)

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    const measure = (): void => setNaturalH(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ESC 关闭
  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setZoom(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  const inner = (
    <div
      ref={innerRef}
      className="v10-shrink-inner"
      style={{
        transform: `scale(${zoom ? 1 : scale})`,
        transformOrigin: 'top left',
        width: `${100 / scale}%`
      }}
    >
      {props.children}
    </div>
  )

  return (
    <div
      className={`v10-shrink${zoom ? ' zoom' : ''}`}
      style={{ height: zoom ? naturalH : naturalH * scale || undefined }}
      onMouseEnter={() => setZoom(true)}
      onMouseLeave={() => setZoom(false)}
      onClick={(e) => {
        // 点击=整页居中放大（portal 到 body，脱离左栏约束）
        if (!zoom) {
          setZoom(true)
          e.stopPropagation()
        }
      }}
    >
      {inner}
      {zoom
        ? createPortal(
            <div className="v10-zoom-overlay" onClick={() => setZoom(false)}>
              <div className="v10-zoom-body" onClick={(e) => e.stopPropagation()}>
                <button className="v10-zoom-close" onClick={() => setZoom(false)}>✕ ESC</button>
                {props.children}
              </div>
            </div>,
            document.body
          )
        : null}
      {!zoom && naturalH > 40 ? (
        <span className="v10-shrink-hint" title={props.hint ?? '点击整页放大 / 移过预览'}>
          ⤢ {props.hint ?? '点击放大'}
        </span>
      ) : null}
    </div>
  )
}
