/**
 * 点击反馈（统一单一反馈版）：
 * 4 命中区（头发/脸/肩/手）暂不做差异化，统一为「微微后仰 + 眯眼笑 + 星辉 + 回复气泡」，
 * 回复池扩充降低重复感；后续优化时再恢复分区差异动画。
 */
import type { Animator } from '../anim/Animator'
import type { MicroBehaviors } from '../anim/microBehaviors'
import type { ParticleSystem } from '../fx/particles'
import type { Bubble } from '../fx/bubble'

interface TimedAction {
  t: number
  dur: number
  apply: (env: number, anim: Animator) => void
}

/** 点击回复语池（按心情/亲密度分档，扩充版） */
const REPLY_PLAYFUL = ['你好讨厌哦', '别闹啦~', '再点我就生气咯', '哼，不理你了', '干嘛老戳我']
const REPLY_TIRED = ['让我歇会儿…', '好累…让我睡会儿', '别点啦，困…', '眼睛都睁不开了…']
const REPLY_HAPPY = [
  '好喜欢你呀', '贴贴~', '今天也一起加油吧！', '嘿嘿，被你点到啦', '最喜欢你了！',
  '被你rua秃啦', '摸摸头，心情会变好哦～', '主人，贴贴！', '你是不是想我啦？'
]
const REPLY_NEUTRAL = [
  '怎么啦？', '我在呢', '点我也要加油啊', '嗯？什么事', '叫我干嘛呀',
  '戳我干嘛，痒死啦！', '我在这儿，哪儿也不去', '让我看看你在干嘛～', '有事就说嘛～'
]

export interface ReplyMood {
  /** 当前空间状态名 */
  state: string
  /** 亲密度 1-5 */
  intimacy: number
}

function pickReply(mood: ReplyMood): string {
  const pick = (pool: string[]) => pool[Math.floor(Math.random() * pool.length)]
  // 12% 概率触发小脾气
  if (Math.random() < 0.12) return pick(REPLY_PLAYFUL)
  if (mood.state === 'overworked' || mood.state === 'sleeping') return pick(REPLY_TIRED)
  if (
    mood.intimacy >= 3 ||
    mood.state === 'slack' ||
    mood.state === 'global_chat' ||
    mood.state === 'offwork_remind' ||
    mood.state === 'aiqa'
  ) {
    return pick(REPLY_HAPPY)
  }
  return pick(REPLY_NEUTRAL)
}

export class ClickFeedback {
  private anim: Animator
  private micro: MicroBehaviors
  private particles: ParticleSystem
  private bubble: Bubble
  private actions: TimedAction[] = []
  private getAnchor: () => { x: number; y: number }
  private slackMode: () => boolean
  private moodProvider: () => ReplyMood

  constructor(
    anim: Animator,
    micro: MicroBehaviors,
    particles: ParticleSystem,
    bubble: Bubble,
    getAnchor: () => { x: number; y: number },
    slackMode: () => boolean,
    moodProvider: () => ReplyMood
  ) {
    this.anim = anim
    this.micro = micro
    this.particles = particles
    this.bubble = bubble
    this.getAnchor = getAnchor
    this.slackMode = slackMode
    this.moodProvider = moodProvider
  }

  /** 点击命中：统一单一反馈（后仰小动作 + 眯眼笑 + 星辉 + 回复气泡） */
  click(_part: string): void {
    const anchor = this.getAnchor()
    const sparkleN = 1 + Math.floor(Math.random() * 3)
    // 回复气泡 + 好感度累计
    this.bubble.show(pickReply(this.moodProvider()), undefined, 'character')
    try {
      void window.api?.petAffection?.()
    } catch {
      /* preload 未就绪时忽略 */
    }
    // 统一动作：轻微后仰（0.55s，正弦包络自动回正）+ 眯眼笑
    this.actions.push({
      t: 0,
      dur: 0.55,
      apply: (env, a) => {
        a.add('spine_02', -5 * env)
        a.add('head', 0, 0, 6 * env)
      }
    })
    this.anim.expressionImpulse({ smile: 0.35, squint: 0.2 }, 0.7)
    this.micro.triggerEarTwitch()
    this.particles.burst(anchor.x, anchor.y + 60, sparkleN, 0xffe9a8)
  }

  /** 悬停 1s+（slack 状态显示小气泡） */
  hoverLong(): void {
    if (this.slackMode() && !this.bubble.visible) {
      this.bubble.show('一起看吗？', 3, 'character')
    }
  }

  update(dt: number): void {
    this.actions = this.actions.filter((act) => {
      act.t += dt
      if (act.t >= act.dur) return false
      const env = Math.sin((act.t / act.dur) * Math.PI)
      act.apply(env, this.anim)
      return true
    })
  }
}
