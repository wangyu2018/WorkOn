/**
 * 简易弹簧阻尼器（金铃 SpringBone 近似，digest §6：stiffness 0.15, gravity 0.3, bounce 0.4）
 */
export class Spring {
  value = 0
  private vel = 0
  constructor(
    private stiffness = 60,
    private damping = 6
  ) {}

  impulse(v: number): void {
    this.vel += v
  }

  update(dt: number, target = 0): number {
    const acc = -this.stiffness * (this.value - target) - this.damping * this.vel
    this.vel += acc * dt
    this.value += this.vel * dt
    return this.value
  }
}
