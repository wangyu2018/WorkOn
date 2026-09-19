/**
 * 视角 → 界面编排：导航白名单 + 首页块白名单。
 * 减法原则：每视角只留此刻需要的入口；不在白名单的收进「更多」折叠组，能力不丢。
 */
import type { ViewKey } from '../stores/appStore'
import type { HomeBlockKey } from './homeLayout'
import type { Perspective } from '@shared/perspective'

export const PERSPECTIVE_NAV: Record<Perspective, ViewKey[]> = {
  architect: ['home', 'plan', 'calendar', 'mainline'],
  worker: ['home', 'mainline', 'knowledge'],
  manager: ['home', 'report', 'qa', 'profile']
}

/**
 * 首页块白名单：与用户显隐取交集；null = 视角不做减法（管理者=全景复盘）。
 * 归属原则：按「这个块在什么时刻有信息量」归位——
 * 晨=计划布局（时间轴）；昼=干活反馈（时间轴/实时状态/监控摘要）；晚=全部对账组件。
 */
export const PERSPECTIVE_HOME: Record<Perspective, HomeBlockKey[] | null> = {
  architect: ['dayplan', 'timeline', 'quote', 'soup', 'almanac', 'countdown'],
  worker: ['dayplan', 'timeline', 'presence', 'trail', 'quote', 'soup', 'almanac', 'countdown'],
  manager: null
}
