/**
 * 表情参数模型（ARKit BlendShape 的映射，VRM expressionManager 驱动）
 * 从旧 Q 版 face.ts 抽出的纯数据层，与渲染实现无关
 */

/** 表情参数（全部 0..1，browRaise -1..1） */
export interface Expression {
  smile: number
  frown: number
  mouthOpen: number
  eyeOpen: number
  eyeWide: number
  squint: number
  browRaise: number
  blush: number
}

export const NEUTRAL_EXPRESSION: Expression = {
  smile: 0.25, // 默认嘴角微扬
  frown: 0,
  mouthOpen: 0,
  eyeOpen: 1.0,
  eyeWide: 0,
  squint: 0,
  browRaise: 0.08,
  blush: 0.1
}

export function cloneExpression(e: Expression): Expression {
  return { ...e }
}

export function lerpExpression(a: Expression, b: Expression, t: number): Expression {
  const L = (x: number, y: number) => x + (y - x) * t
  return {
    smile: L(a.smile, b.smile),
    frown: L(a.frown, b.frown),
    mouthOpen: L(a.mouthOpen, b.mouthOpen),
    eyeOpen: L(a.eyeOpen, b.eyeOpen),
    eyeWide: L(a.eyeWide, b.eyeWide),
    squint: L(a.squint, b.squint),
    browRaise: L(a.browRaise, b.browRaise),
    blush: L(a.blush, b.blush)
  }
}
