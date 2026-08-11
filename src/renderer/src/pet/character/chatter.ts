/**
 * 场景化主动说话：5 角色性格矩阵 + 场景频率（PRD §3.1/§5）
 * - 虚拟人角色色 + 台词按性格差异化
 * - 深度专注(focusLevel>85)静默，中度(60-85)仅耳语
 */
export type ChatterScene = 'general' | 'focus' | 'slack' | 'meeting' | 'overworked' | 'lunch' | 'standup' | 'offwork' | 'lateNight'

export type CharacterRole = 'ARIA' | 'LUNA' | 'KIRA' | 'ZEN' | 'SHIN'

export const ROLE_COLORS: Record<CharacterRole, { hex: string; label: string; avatar: string }> = {
  ARIA: { hex: '#60A5FA', label: '冷蓝', avatar: '🔵' },
  LUNA: { hex: '#F8BBD0', label: '暖粉', avatar: '🌸' },
  KIRA: { hex: '#FB923C', label: '橙', avatar: '🔥' },
  ZEN:  { hex: '#4ADE80', label: '绿', avatar: '🌿' },
  SHIN: { hex: '#94A3B8', label: '灰', avatar: '⚡' }
}

const ROLE_CHATTER: Record<CharacterRole, Partial<Record<ChatterScene, string[]>>> = {
  ARIA: {
    focus: ['专注度 87%，保持。', '进度正常，继续。', '当前节奏可维持。'],
    slack: ['效率 -12%。建议回归。', '偏离工作态，需要纠正。', '检测到非工作活动。'],
    overworked: ['连续工作 3h+，建议暂停。', '疲劳指数偏高，休息。', '心率推测偏高，请休息。'],
    lunch: ['12:00，建议进食。', '能量补充窗口。', '建议午餐，避免低效。'],
    offwork: ['今日任务完成率 68%。', '既定工作时间结束。'],
  },
  LUNA: {
    focus: ['加油加油~我陪着你呢！', '工作真棒，摸摸头~', '我们一起加油吧♥'],
    slack: ['回来工作吧~♥', '偷懒也没关系，慢慢来~', '该回来啦，我等你~'],
    overworked: ['太累啦！抱抱你~', '休息一下吧，我心疼你。', '睡一会儿嘛，好不好？'],
    lunch: ['午饭时间到！去吃点好吃的~', '再忙也别忘了吃饭哦♥', '今天中午想吃什么呢~'],
    offwork: ['下班啦！今天辛苦啦~♥', '一起享受晚上的时光吧~'],
  },
  KIRA: {
    focus: ['啧，终于认真了？', '保持住，别让我失望。', '这个状态不错嘛。'],
    slack: ['啧，又在摸鱼？', '╬▔皿▔ 你够了！', '摸鱼被我看到了哦~'],
    overworked: ['喂，该休息了，笨蛋！', '你这样会坏掉的。', '╬ 给我停下，立刻！'],
    lunch: ['吃饭！不然没力气跟我斗嘴。', '去吃饭！别磨蹭。'],
    offwork: ['终于下班了，真磨叽。', '可以下班了，还赖着干嘛！'],
  },
  ZEN: {
    focus: ['心在此时，便是修行。', '专注即禅。', '水到渠成，不急不慢。'],
    slack: ['心在何处？', '短暂的放空也是充电。', '风过了无痕，回来吧。'],
    overworked: ['一杯水，一呼吸。', '物极必反，休息。', '片刻安宁即可。'],
    lunch: ['一粥一饭，皆是修行。', '该用斋了。'],
    offwork: ['今日已了，归去吧。', '日出而作，日落而息。'],
  },
  SHIN: {
    focus: ['效率 +8%，继续。', '当前最优策略：保持。', '数据良好，推进。'],
    slack: ['效率 -12%。回归。', '偏离指标，立即纠正。', '非生产性活动：已记录。'],
    overworked: ['疲劳阈值触发，强制休息。', '超时工作：危险性增加。', '建议关屏 5 分钟恢复。'],
    lunch: ['定时进食：建议 12:00。', '能量补充：必需。'],
    offwork: ['今日指标已达标。','工作时间结束。','效率报告已生成。'],
  }
}

export const CHATTER_POOLS: Record<ChatterScene, string[]> = {
  general: [
    '戳我干嘛，痒死啦！', '嘿嘿，被你发现了～', '今天也要元气满满哦！', '别老盯着我看嘛，害羞了。',
    '咕噜咕噜，我在打滚～', '你回来啦！等你好久了！', '我是不是很可爱？快说是！', '别难过，我陪着你呢。',
    '鼠标别走，陪我玩！', '摸摸头，心情会变好哦～', '嘿嘿，趁你不注意卖个萌。', '给我取个新外号嘛！',
    '歪歪头，表示我在认真听。', '让我看看你在干嘛～', '一起度过美好的一天吧！', '有我陪着，不孤单哦。',
    '我在认真工作！（并没有）', '元气补充完毕，出发！', '今天的幸运色是……我！', '保持可爱，是我的工作！'
  ],
  focus: ['工作加油，我给你打气！', '看起来很专注呢~', '加油加油，马上就好啦！', '我们一起加油吧！', '专注的样子真好看！', '我在认真陪你工作哦！', '这个状态保持住！'],
  slack: ['抓到你摸鱼啦！', '在摸鱼吗？我装作没看见~', '偷偷休息一下也没关系~', '摸鱼被抓包啦？'],
  meeting: ['开会中~我安静等着', '会议加油，我不打扰你~'],
  overworked: ['工作太久了，休息一下吧…', '你看起来好累，喝口水吧~', '别太累啦，我心疼你！', '休息一下吧，我帮你放风。', '抱抱你，今天辛苦了。'],
  lunch: ['该吃午饭啦！别忘了吃饭~', '午饭时间到了，去吃点好吃的吧~', '再忙也要记得吃饭哦。'],
  standup: ['坐太久啦，起来活动活动！', '该伸伸懒腰啦！', '久坐伤身，起来走两步吧~'],
  offwork: ['下班时间到啦！今天辛苦了~', '该下班啦，别太累了~'],
  lateNight: ['这么晚了还在工作？早点休息吧~', '熬夜对身体不好哦…', '哈欠……有点困了。', '呼——呼——我在假装睡觉。']
}

export const SCENE_MIN_INTERVAL: Record<ChatterScene, number> = {
  general: 30 * 60_000, focus: 30 * 60_000, slack: 15 * 60_000, meeting: 60 * 60_000,
  overworked: 30 * 60_000, lunch: 20 * 60_000, standup: 60 * 60_000, offwork: 20 * 60_000, lateNight: 60 * 60_000
}

/** 按角色性格选取台词：有角色专属台词则优先用，否则用通用池 */
export function pickChatter(scene: ChatterScene, recent: string[], role?: CharacterRole): string {
  let pool: string[]
  if (role && ROLE_CHATTER[role]?.[scene]?.length) {
    pool = ROLE_CHATTER[role][scene]!
  } else {
    pool = CHATTER_POOLS[scene]
  }
  const fresh = pool.filter(l => !recent.includes(l))
  const from = fresh.length > 0 ? fresh : pool
  return from[Math.floor(Math.random() * from.length)]
}

/** 当前激活的角色（默认 LUNA） */
let activeRole: CharacterRole = 'LUNA'

export function setActiveRole(role: CharacterRole): void { activeRole = role }
export function getActiveRole(): CharacterRole { return activeRole }
