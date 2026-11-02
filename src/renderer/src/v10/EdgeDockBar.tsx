/**
 * EdgeDockBar（边缘 Dock 分组系统渲染层）：
 * 三边（顶/左/右）条形 Dock——应用图标 + 运行状态点 + 分组批量启动。
 * 形态：顶部横条 / 左右竖条，透明贴边置顶。
 */
import { useEffect, useState } from 'react'
interface DockItem { id: string; appKey: string; label: string; icon: string; order: number }
interface DockGroup { title: string; items: DockItem[] }

interface Props {
  edge: 'top' | 'left' | 'right'
}

export function EdgeDockBar(props: Props): JSX.Element {
  const { edge } = props
  const isTop = edge === 'top'
  const [group, setGroup] = useState<DockGroup>({ title: '', items: [] })
  const [status, setStatus] = useState<{ running: string[]; aiBusy: string[] }>({ running: [], aiBusy: [] })
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const pull = (): void => {
      void (window.api as unknown as { dockGet?: (e: string) => Promise<DockGroup> })?.dockGet?.(edge).then((g) => setGroup(g ?? { title: '', items: [] }))
    }
    pull()
    // 轮询兜底：对话加/删条目后 3s 内自动同步（比推事件简单可靠）
    const t = window.setInterval(pull, 3000)
    const off = (window.api as unknown as { onDockStatus?: (cb: (p: { edge: string; running: string[]; aiBusy: string[] }) => void) => () => void })?.onDockStatus?.((p) => {
      if (p.edge === edge) setStatus({ running: p.running, aiBusy: p.aiBusy })
    })
    return () => { off?.(); window.clearInterval(t) }
  }, [edge])

  const itemState = (appKey: string): 'off' | 'on' | 'ai' => {
    if (status.aiBusy.includes(appKey)) return 'ai'
    if (status.running.includes(appKey)) return 'on'
    return 'off'
  }

  if (collapsed) {
    return (
      <div className={`edock edock-collapsed edock-${edge}`} onClick={() => setCollapsed(false)} title="展开 Dock">
        <span className="edock-edge-label">{edge === 'top' ? '▾' : edge === 'left' ? '▸' : '◂'}</span>
      </div>
    )
  }

  return (
    <div className={`edock edock-${edge} ${isTop ? 'edock-h' : 'edock-v'}`}>
      {/* 组标题：点击批量启动（工作分解），右键收起 */}
      <button
        className="edock-group-title"
        title={`${group.title}：点击按序启动全部（${group.items.length} 个）`}
        onClick={() => {
          void (window.api as unknown as { dockLaunchGroup?: (e: string) => Promise<number> })?.dockLaunchGroup?.(edge)
        }}
        onContextMenu={(e) => { e.preventDefault(); setCollapsed(true) }}
      >
        {group.title || edge}
      </button>

      {/* 应用图标列表 */}
      <div className={`edock-items ${isTop ? 'edock-items-h' : 'edock-items-v'}`}>
        {group.items.length === 0 ? (
          <span className="edock-empty">对 WorkOn 说「把 Chrome 加到{edge === 'top' ? '顶部' : edge === 'left' ? '左侧' : '右侧'}」</span>
        ) : (
          [...group.items].sort((a, b) => a.order - b.order).map((item) => {
            const st = itemState(item.appKey)
            return (
              <button
                key={item.id}
                className={`edock-item ${st}`}
                title={`${item.label}${st === 'on' ? ' · 运行中' : st === 'ai' ? ' · AI 在跑' : ''}\n点击启动/切到 · 右键移除`}
                onClick={() => {
                  void (window.api as unknown as { dockLaunchItem?: (e: string, id: string) => Promise<boolean> })?.dockLaunchItem?.(edge, item.id)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  void (window.api as unknown as { dockRemove?: (e: string, id: string) => Promise<boolean> })?.dockRemove?.(edge, item.id)
                  setGroup((g: DockGroup) => ({ ...g, items: g.items.filter((x: DockItem) => x.id !== item.id) }))
                }}
              >
                <span className="edock-icon">{item.icon}</span>
                <span className="edock-dot" />
                {!isTop ? <span className="edock-label">{item.label.slice(0, 6)}</span> : null}
              </button>
            )
          })
        )}
      </div>

      {/* 收起钮 */}
      <button className="edock-collapse" onClick={() => setCollapsed(true)} title="收起（点边角展开）">
        {isTop ? '▴' : '×'}
      </button>
    </div>
  )
}
