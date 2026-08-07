/**
 * 自由游荡 FSM（digest-v4 §4）：IDLE_STAND / IDLE_SIT / 移动三档速度
 * 仅在无特定空间态（working/idle）时由 SpatialController 驱动
 */
export type RoamState = 'stand' | 'sit' | 'move'

export interface RoamTarget {
  x: number
  y: number
}

export interface RoamUpdate {
  moving: boolean
  /** 当前速度 px/s（未移动为 0） */
  speed: number
  mode: 'walk' | 'run' | null
}

const SPEED_SLOW: [number, number] = [80, 120]
const SPEED_FAST: [number, number] = [150, 250]
const SPEED_RUN: [number, number] = [300, 500]

export class RoamFSM {
  state: RoamState = 'stand'
  target: RoamTarget | null = null
  private decisionTimer = 8 // 首次决策较快
  private speed = 0
  private rand = Math.random

  /** 重置计时（状态被打断时调用） */
  reset(delay = 10): void {
    this.state = 'stand'
    this.target = null
    this.decisionTimer = delay
  }

  /**
   * 每帧更新
   * @param pos 当前位置（屏幕 px）
   * @param bounds 可游荡区域
   * @param mouse 鼠标位置（避开 200px）
   * @param avoid 前台窗口矩形（避开：不在窗口遮挡区内选目标）
   */
  update(
    dt: number,
    pos: RoamTarget,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
    mouse: RoamTarget,
    avoid?: { x: number; y: number; width: number; height: number } | null
  ): RoamUpdate {
    if (this.state === 'move' && this.target) {
      const dx = this.target.x - pos.x
      const dy = this.target.y - pos.y
      const dist = Math.hypot(dx, dy)
      const step = this.speed * dt
      if (dist <= Math.max(4, step)) {
        // 到达：70% 站立 30% 坐下
        this.state = this.rand() < 0.3 ? 'sit' : 'stand'
        this.target = null
        this.decisionTimer = 10 + this.rand() * 50
        return { moving: false, speed: 0, mode: null }
      }
      return { moving: true, speed: this.speed, mode: this.speed > 260 ? 'run' : 'walk' }
    }

    this.decisionTimer -= dt
    if (this.decisionTimer <= 0) {
      this.target = this.pickTarget(bounds, mouse, avoid)
      const dist = Math.hypot(this.target.x - pos.x, this.target.y - pos.y)
      const [lo, hi] = dist < 200 ? SPEED_SLOW : dist <= 600 ? SPEED_FAST : SPEED_RUN
      this.speed = lo + this.rand() * (hi - lo)
      this.state = 'move'
      return { moving: true, speed: this.speed, mode: this.speed > 260 ? 'run' : 'walk' }
    }
    return { moving: false, speed: 0, mode: null }
  }

  private pickTarget(
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
    mouse: RoamTarget,
    avoid?: { x: number; y: number; width: number; height: number } | null
  ): RoamTarget {
    // 避让边距：角色身体半径 + 一点缓冲，防止贴着窗口边缘走
    const M = 110
    const inAvoid = (x: number, y: number): boolean =>
      !!avoid &&
      x > avoid.x - M &&
      x < avoid.x + avoid.width + M &&
      y > avoid.y - M &&
      y < avoid.y + avoid.height + M
    for (let i = 0; i < 12; i++) {
      const x = bounds.minX + this.rand() * (bounds.maxX - bounds.minX)
      const y = bounds.minY + this.rand() * (bounds.maxY - bounds.minY)
      if (Math.hypot(x - mouse.x, y - mouse.y) <= 200) continue
      if (inAvoid(x, y)) continue
      return { x, y }
    }
    // 兜底：沿屏幕边缘（窗口外一圈）找可行点；都不行就取离鼠标最远的角
    const edgeY = bounds.maxY
    const candidates: RoamTarget[] = [
      { x: bounds.minX, y: edgeY },
      { x: bounds.maxX, y: edgeY },
      { x: bounds.minX, y: (bounds.minY + bounds.maxY) / 2 },
      { x: bounds.maxX, y: (bounds.minY + bounds.maxY) / 2 },
      { x: (bounds.minX + bounds.maxX) / 2, y: edgeY }
    ]
    const free = candidates.filter((c) => !inAvoid(c.x, c.y) && Math.hypot(c.x - mouse.x, c.y - mouse.y) > 120)
    if (free.length > 0) return free[Math.floor(this.rand() * free.length)]
    const cx = mouse.x < (bounds.minX + bounds.maxX) / 2 ? bounds.maxX : bounds.minX
    return { x: cx, y: bounds.maxY }
  }
}
