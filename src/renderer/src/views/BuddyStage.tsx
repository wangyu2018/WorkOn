import { useEffect, useState, type ReactNode } from 'react'
import { usePresenceStore } from '../stores/presenceStore'
import { useSettingsStore } from '../stores/settingsStore'
import { StateBadge } from '../components/StateBadge'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Toggle } from '../components/Toggle'
import { MotionLab } from '../components/MotionLab'
import { AutomationLab } from '../components/AutomationLab'
// import { VrmUploader } from '../components/VrmUploader' // 角色自定义暂时下架
import {
  DEFAULT_WIDGET_DISPLAY,
  type DockRingContent,
  type WidgetDisplayOptions
} from '@shared/types'

/** 当前搭子角色（VRM 姵儿，单角色） */
const CHARACTER = {
  id: 'ling',
  name: '姵儿',
  cn: '猫耳耳机少女',
  rarity: 'SSR',
  tagline: 'VRM 实时 3D 搭子'
} as const

const WIDGET_ACCENTS = ['#22D3EE', '#A78BFA', '#34D399', '#FBBF24', '#F472B6'] as const

const DOCK_RING_OPTS: { id: DockRingContent; label: string }[] = [
  { id: 'app', label: '应用' },
  { id: 'focus', label: '专注分' },
  { id: 'chain', label: '链路' },
  { id: 'project', label: '项目' },
  { id: 'minutes', label: '分钟' }
]

function ChipToggle({
  on,
  label,
  onClick
}: {
  on: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold transition-all ${
        on
          ? 'border-[var(--teal-border)] bg-[var(--teal-soft)] text-[var(--teal-deep)]'
          : 'border-[var(--line)] text-slate-500 hover:border-white/20 hover:text-slate-300'
      }`}
      onClick={onClick}
    >
      {label}{on ? ' ✓' : ''}
    </button>
  )
}

function OptionRow({
  title,
  hint,
  children
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="-mx-1 rounded-lg px-1 py-2.5">
      <div className="mb-1.5">
        <div className="text-[12px] text-slate-300">{title}</div>
        {hint ? <div className="mt-0.5 text-[10px] text-slate-500">{hint}</div> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function PadBar({ label, value, color }: { label: string; value: number; color: string }) {
  // PAD -1..1 → 0..100
  const pct = Math.round(((value + 1) / 2) * 100)
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-4 text-slate-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}66` }}
        />
      </div>
      <span className="w-8 text-right tabular-nums text-slate-500">{value.toFixed(2)}</span>
    </div>
  )
}

/** 首次使用引导（4 步，可跳过） */
const GUIDE_STEPS = [
  { emoji: '🐱', title: '这是你的搭子姵儿', desc: '她会跟随你的工作状态实时变化心情和姿态，常驻屏幕右下角陪伴你工作。' },
  { emoji: '👆', title: '点她一下试试', desc: '点击不同部位有不同反应：头发→耳抖眯眼笑、脸→脸红歪头、肩→缩肩、手→挥手打招呼。' },
  { emoji: '💬', title: '右键和她聊天', desc: '右键点她会弹出输入框，输入文字后她会以气泡回复你（支持 AI 问答）。' },
  { emoji: '🖐️', title: '拖拽放她去任何地方', desc: '抓起→跟手→松手有抛物线弹跳。连续 3 分钟不操作，她会自己走回右下角。' }
]

function GuideModal({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const cur = GUIDE_STEPS[step]
  const last = step === GUIDE_STEPS.length - 1
  return (
    <div className="anim-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-sm">
      <div className="glass-card anim-scale-in w-[380px] text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.04] text-4xl">
          {cur.emoji}
        </div>
        <h3 className="mb-2 text-[15px] font-semibold text-slate-100">{cur.title}</h3>
        <p className="mb-4 text-[12px] leading-relaxed text-slate-400">{cur.desc}</p>
        <div className="mb-4 flex items-center justify-center gap-1.5">
          {GUIDE_STEPS.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-neon-cyan' : 'w-1.5 bg-white/15'}`} />
          ))}
        </div>
        <div className="flex justify-center gap-2">
          {!last ? (
            <>
              <button className="glass-btn" onClick={onDone}>
                跳过
              </button>
              <button className="glass-btn primary" onClick={() => setStep((s) => s + 1)}>
                下一步
              </button>
            </>
          ) : (
            <button className="glass-btn primary" onClick={onDone}>
              开始互动吧 →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** 养成指南（折叠式：默认收起，点标签展开） */
const GUIDES: { key: string; label: string; content: React.ReactNode }[] = [
  {
    key: 'interact',
    label: '互动说明',
    content: (
      <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-slate-400">
        <li>· 点击头发：耳抖动 + 眯眼笑，随机回复「好喜欢你呀」等</li>
        <li>· 点击脸部：脸红加深 + 歪头</li>
        <li>· 点击肩部：缩肩小动作</li>
        <li>· 点击手部：挥手打招呼</li>
        <li>· 右键输入：文字对话，用户气泡在侧下、她的回复在头顶</li>
        <li>· 拖拽移动：抓起 → 跟手 → 松手抛物线弹跳</li>
        <li>· 悬停 1s+：摸鱼状态下她会问「一起看吗？」</li>
      </ul>
    )
  },
  {
    key: 'intimacy',
    label: '亲密度',
    content: (
      <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-slate-400">
        <li>· 每点击 10 次，亲密度 +1（最高 Lv.5）</li>
        <li>· 亲密度影响回复语气：Lv.1 客气 → Lv.3 活泼 → Lv.5 亲昵</li>
        <li>· 亲密度只增不减，慢慢养成就好</li>
        <li>· 每次点击还会小幅提升她的愉悦度</li>
      </ul>
    )
  },
  {
    key: 'pad',
    label: 'PAD 心情',
    content: (
      <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-slate-400">
        <li>· P 愉悦：越高她笑得越甜；A 唤醒：越高眼睛睁越大、小动作越多；D 支配：越低越爱缩肩卖萌</li>
        <li>· 专注/编程 → 认真中略带压力；摸鱼 → 放松愉悦；会议 → 紧张被动；休息 → 放松主导</li>
        <li>· 心情随你的工作状态实时变化，看她表情就知道你今天过得怎么样</li>
      </ul>
    )
  },
  {
    key: 'spatial',
    label: '空间状态',
    content: (
      <div className="flex flex-col gap-1.5 text-[12px] text-slate-400">
        {[
          ['深度专注', '连续专注中', '下沿冒头，安静陪伴'],
          ['工作中', '正常工作态', '右下角全身，偶尔冒泡'],
          ['AI 开发', '检测到 AI IDE', '站立关注态'],
          ['会议中', '会议软件运行', '正襟危坐'],
          ['过劳', '能量过低', '疲惫态，劝你休息'],
          ['睡眠', '长时间离开', '闭目养神'],
          ['下班提醒', '到达下班时间', '站起来挥手']
        ].map(([state, trigger, behavior]) => (
          <div key={state} className="flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-white/[0.03]">
            <span className="chip w-20 shrink-0 justify-center !text-[10px]">{state}</span>
            <span className="w-28 shrink-0 text-slate-500">{trigger}</span>
            <span className="text-slate-400">{behavior}</span>
          </div>
        ))}
      </div>
    )
  }
]

/** 分区标题：左侧霓虹强调条 + 图标 + 标题 */
function SectionTitle({ icon, title }: { icon: Parameters<typeof Icon>[0]['name']; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-3.5 w-1 rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 8px var(--accent-glow)' }} />
      <span className="text-slate-500">
        <Icon name={icon} size={14} />
      </span>
      <h2 className="text-[15px] font-semibold text-slate-200">{title}</h2>
    </div>
  )
}

/** 搭子：搭子状态 + 行为控制（互动开关/显示参数）+ 折叠养成指南 */
export default function BuddyStage() {
  const pet = usePresenceStore((s) => s.pet)
  const settings = useSettingsStore((s) => s.settings)
  const patch = useSettingsStore((s) => s.patch)
  const [restored, setRestored] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [activeGuide, setActiveGuide] = useState<string | null>(null)
  const [petStats, setPetStats] = useState<{ fps: number; tier: string; degraded: boolean; drawCalls: number; triangles: number; textures: number } | null>(null)

  useEffect(() => {
    const off = window.api.onPetStats?.((s) => setPetStats(s as typeof petStats extends infer T ? T : never))
    return off
  }, [])

  // 首次进入搭子页：未看过引导则弹出
  useEffect(() => {
    if (!settings.petGuideShown) setShowGuide(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const closeGuide = () => {
    setShowGuide(false)
    void patch({ petGuideShown: true })
  }

  const restorePet = () => {
    window.api.petRestore()
    setRestored(true)
    window.setTimeout(() => setRestored(false), 1500)
  }

  const patchInteraction = (key: keyof typeof settings.petInteractions, v: boolean) => {
    void patch({ petInteractions: { ...settings.petInteractions, [key]: v } })
  }

  const display: WidgetDisplayOptions = {
    dock: { ...DEFAULT_WIDGET_DISPLAY.dock, ...(settings.widgetDisplay?.dock ?? {}) },
    mini: { ...DEFAULT_WIDGET_DISPLAY.mini, ...(settings.widgetDisplay?.mini ?? {}) },
    full: { ...DEFAULT_WIDGET_DISPLAY.full, ...(settings.widgetDisplay?.full ?? {}) },
    todo: { ...DEFAULT_WIDGET_DISPLAY.todo, ...(settings.widgetDisplay?.todo ?? {}) }
  }

  const patchDisplay = (partial: Partial<WidgetDisplayOptions>): void => {
    void patch({
      widgetDisplay: {
        dock: { ...display.dock, ...(partial.dock ?? {}) },
        mini: { ...display.mini, ...(partial.mini ?? {}) },
        full: { ...display.full, ...(partial.full ?? {}) },
        todo: { ...display.todo, ...(partial.todo ?? {}) }
      }
    })
  }

  return (
    <div className="view-enter flex flex-col gap-5">
      {/* 页面标题区 */}
      <PageHeader
        icon="cat"
        title="搭子"
        desc={`${CHARACTER.name} · ${CHARACTER.tagline} — 桌面叠层管控（角色 / 浮窗 / 待办）与养成`}
        actions={
          <span className="chip" style={{ borderColor: '#F59E0B66' }}>
            {CHARACTER.rarity}
          </span>
        }
      />

      {/* 桌面叠层总控：虚拟角色 / 悬浮窗 / 待办组件 一体管控 */}
      <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '40ms' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle icon="monitor" title="桌面叠层管控" />
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              className="glass-btn !px-2 !py-1 !text-[10px]"
              title="三层全部置顶"
              onClick={() =>
                void patch({
                  widgetOnTop: true,
                  widgetDockOnTop: true,
                  todoWidgetOnTop: true
                })
              }
            >
              全部顶层
            </button>
            <button
              className="glass-btn !px-2 !py-1 !text-[10px]"
              title="关闭穿透，恢复可点"
              onClick={() =>
                void patch({
                  widgetPenetration: false,
                  todoWidgetPenetration: false
                })
              }
            >
              取消穿透
            </button>
            <button
              className="glass-btn !px-2 !py-1 !text-[10px]"
              title="收起待办为迷你条"
              disabled={!settings.todoWidgetVisible}
              onClick={() => void window.api?.setTodoWidgetCollapsed?.(true)}
            >
              收起待办
            </button>
            <button
              className="glass-btn !px-2 !py-1 !text-[10px]"
              title="展开待办面板"
              disabled={!settings.todoWidgetVisible}
              onClick={() => void window.api?.setTodoWidgetCollapsed?.(false)}
            >
              展开待办
            </button>
          </div>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
          统一开关桌面三件套。开启后下方展开对应细控；也可从托盘右键菜单快捷切换。
        </p>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {(
            [
              {
                key: 'pet',
                label: '虚拟角色',
                desc: 'VRM 桌宠姵儿',
                on: settings.petEnabled,
                set: (v: boolean) => void patch({ petEnabled: v }),
                badges: settings.petEnabled
                  ? [
                      pet?.visible === false ? '已隐藏' : '显示中',
                      `透明 ${Math.round((settings.petOpacity ?? 1) * 100)}%`
                    ]
                  : ['已关闭']
              },
              {
                key: 'widget',
                label: '状态浮窗',
                desc: '专注环 · 迷你胶囊',
                on: settings.widgetVisible,
                set: (v: boolean) => void patch({ widgetVisible: v }),
                badges: settings.widgetVisible
                  ? [
                      settings.widgetPenetration ? '穿透' : '可点',
                      settings.widgetDesktopPin
                        ? '桌面钉'
                        : settings.widgetOnTop !== false
                          ? '顶层'
                          : '底层',
                      `${Math.round((settings.widgetOpacity ?? 1) * 100)}%`
                    ]
                  : ['已关闭']
              },
              {
                key: 'todo',
                label: '待办组件',
                desc: '桌面待办树',
                on: !!settings.todoWidgetVisible,
                set: (v: boolean) => void patch({ todoWidgetVisible: v }),
                badges: settings.todoWidgetVisible
                  ? [
                      settings.todoWidgetPenetration ? '穿透' : '可点',
                      settings.todoWidgetDesktopPin
                        ? '桌面钉'
                        : settings.todoWidgetOnTop !== false
                          ? '顶层'
                          : '底层',
                      `${Math.round((settings.todoWidgetOpacity ?? 1) * 100)}%`
                    ]
                  : ['已关闭']
              }
            ] as const
          ).map((card) => (
            <div
              key={card.key}
              className={`rounded-xl border px-3 py-2.5 transition-colors ${
                card.on ? 'border-neon-cyan/30 bg-neon-cyan/[0.06]' : 'border-white/[0.06] bg-white/[0.02]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-slate-200">{card.label}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">{card.desc}</div>
                </div>
                <Toggle checked={card.on} onChange={card.set} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {card.badges.map((b) => (
                  <span key={b} className="rounded border border-white/[0.08] px-1.5 py-px text-[9px] text-slate-400">
                    {b}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {settings.petEnabled ? (
      <div className="grid gap-5 lg:grid-cols-2">
        {/* 搭子状态卡 */}
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '60ms' }}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionTitle icon="cat" title="搭子状态" />
            <div className="flex items-center gap-2">
              <button
                className="glass-btn"
                title="重播首次启动的欢迎 CG"
                onClick={() => window.api.petIntroReplay()}
              >
                <Icon name="sparkles" size={13} />
                重播 CG
              </button>
              <button
                className="glass-btn"
                title="让她走回右下角锚点"
                onClick={restorePet}
              >
                <Icon name="target" size={13} />
                {restored ? '已回位 ✓' : '一键回位'}
              </button>
              <button className="glass-btn" onClick={() => window.api.togglePet()}>
                <Icon name={pet?.visible === false ? 'eye' : 'eyeOff'} size={13} />
                {pet?.visible === false ? '显示搭子' : '隐藏搭子'}
              </button>
            </div>
          </div>
          {pet ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <StateBadge state={pet.workState} size="lg" pulse />
                <span className="chip" style={{ borderColor: '#F59E0B66' }}>
                  {CHARACTER.name} · {CHARACTER.cn}
                </span>
              </div>
              {pet.message ? (
                <div className="anim-fade-in relative rounded-2xl rounded-tl-sm border border-neon-cyan/25 bg-neon-cyan/10 px-3 py-2 text-[12px] text-slate-200">
                  {pet.message}
                </div>
              ) : null}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="w-12 text-slate-500">能量</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-neon-green transition-all duration-300"
                      style={{ width: `${Math.round(pet.energy * 100)}%`, boxShadow: '0 0 8px rgba(52,211,153,0.45)' }}
                    />
                  </div>
                  <span className="w-8 text-right tabular-nums text-slate-500">{Math.round(pet.energy * 100)}%</span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="w-12 text-slate-500">亲密度</span>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <span
                        key={i}
                        className={`h-2.5 w-2.5 rounded-full transition-colors ${i <= pet.intimacy ? 'bg-neon-pink' : 'bg-white/10'}`}
                        style={i <= pet.intimacy ? { boxShadow: '0 0 6px rgba(236,72,153,0.5)' } : undefined}
                      />
                    ))}
                  </div>
                  <span className="text-slate-500">Lv.{pet.intimacy}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 border-t border-white/[0.06] pt-3">
                <div className="text-[11px] text-slate-500">心情同步（PAD 情感，随你的工作状态实时变化）</div>
                <PadBar label="P" value={pet.emotion.pleasure} color="var(--teal)" />
                <PadBar label="A" value={pet.emotion.arousal} color="#F59E0B" />
                <PadBar label="D" value={pet.emotion.dominance} color="#8B5CF6" />
              </div>
              {/* 养成指引：能量与亲密度怎么维护 */}
              <div className="rounded-lg border border-white/[0.05] bg-white/[0.03] px-3 py-2 text-[10px] leading-relaxed text-slate-500">
                <span className="text-slate-400">怎么养她：</span>
                能量随工作积累、摸鱼消耗，累了她会劝你休息；
                亲密度靠互动（每点击 10 次 +1 级，对话也涨），等级越高回复越亲昵；
                3 分钟不理她会自己走回右下角，拖她到喜欢的地方可以停 10 分钟。
              </div>
            </div>
          ) : (
            <EmptyState emoji="🐱" title="搭子未连接" hint="启动后这里会实时同步搭子的状态、情感与气泡消息。" />
          )}
        </section>

        {/* 搭子行为控制：互动开关（单列+效果描述）+ 显示参数 */}
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '120ms' }}>
          <div className="mb-3">
            <SectionTitle icon="sliders" title="搭子行为控制" />
          </div>
          <div className="mb-1 text-[11px] text-slate-500">互动开关（关闭即停用对应行为，降低开销）</div>
          <div className="mb-3 flex flex-col divide-y divide-white/[0.05]">
            <div className="text-[10px] uppercase text-slate-600 pt-1">互动</div>
            {(
              [
                ['click', '点击互动', '点击她时后仰小动作 + 回复气泡（好感度来源）'],
                ['drag', '拖拽移动', '抓起→跟手→松手停在落点，10 分钟内不被拉回'],
                ['dragPhysics', '拖拽物理', '拖拽中的摆动与松手抛物线弹跳（默认关，仅跟手位移）'],
                ['chat', '右键对话', '右键点她弹出输入框，支持 AI 问答']
              ] as const
            ).map(([key, label, desc]) => (
              <div key={key} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-slate-300">{label}</div>
                  <div className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{desc}</div>
                </div>
                <Toggle checked={settings.petInteractions[key]} onChange={(v) => patchInteraction(key, v)} />
              </div>
            ))}
            <div className="text-[10px] uppercase text-slate-600 pt-1">自动化</div>
            {(
              [
                ['emotion', '表情反馈', 'PAD 情感驱动的表情变化（默认关，保留接口）'],
                ['follow', '页面跟随', '主窗口翻页时她联动换姿态']
              ] as const
            ).map(([key, label, desc]) => (
              <div key={key} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-slate-300">{label}</div>
                  <div className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{desc}</div>
                </div>
                <Toggle checked={settings.petInteractions[key]} onChange={(v) => patchInteraction(key, v)} />
              </div>
            ))}
            <div className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-300">游荡模式</div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-slate-500">允许她离开右下角在屏幕底部自由走动（默认关）</div>
              </div>
              <Toggle checked={settings.petRoam} onChange={(v) => void patch({ petRoam: v })} />
            </div>
            <div className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-500">换装响应</div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-slate-600">单角色版本暂不可用（预留）</div>
              </div>
              <span className="text-[10px] text-slate-600">敬请期待</span>
            </div>

            {/* ── 动作工坊 + 动作库 + 积分（第三批） ── */}
            <MotionLab />
            {/* ── 自动化工坊（v7：触发器→条件→动作） ── */}
            <AutomationLab />
          </div>

          <div className="text-[10px] uppercase text-slate-600 pt-3">显示参数</div>
          <div className="flex flex-col gap-2.5 border-t border-white/[0.06] pt-2">
            {/* 角色自定义（VRM 换装）暂时下架，回头再加：还原此行 + 顶部 VrmUploader import
            <div className="flex items-center justify-between text-[12px] text-slate-300">
              <span>角色</span>
              <VrmUploader petVrmPath={settings.petVrmPath} />
            </div> */}
            <div className="flex items-center justify-between gap-3 text-[12px] text-slate-300">
              <span>
                缩放 <span className="tabular-nums text-neon-cyan">{(settings.petScale * 100).toFixed(0)}%</span>
              </span>
              <input
                type="range"
                className="w-44"
                min={0.5}
                max={1.5}
                step={0.05}
                value={settings.petScale}
                onChange={(e) => void patch({ petScale: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-[12px] text-slate-300">
              <span>帧率档位</span>
              <div className="flex gap-1.5">
                {(
                  [
                    ['eco', '省电', '10FPS'],
                    ['standard', '标准', '20FPS'],
                    ['smooth', '流畅', '30FPS'],
                    ['ultra', '极致', '不限帧']
                  ] as const
                ).map(([id, label, desc]) => (
                  <button
                    key={id}
                    className={`flex flex-col items-center rounded-lg border px-2 py-1 text-[11px] transition-all ${
                      settings.petFpsTier === id
                        ? 'border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan'
                        : 'border-white/[0.07] text-slate-400 hover:border-white/20 hover:text-slate-300'
                    }`}
                    title={desc}
                    onClick={() => void patch({ petFpsTier: id })}
                  >
                    <span>{label}</span>
                    <span className={`text-[9px] ${settings.petFpsTier === id ? 'text-neon-cyan/70' : 'text-slate-500'}`}>{desc}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between text-[12px] text-slate-300">
              <span title="硬件分级（GPU/显存）自动选择帧率档位；手动选档会关闭它">
                跟随硬件自动调档{settings.petFpsTierAuto === false ? '（已手动）' : ''}
              </span>
              <Toggle
                checked={settings.petFpsTierAuto !== false}
                onChange={(v) => void patch({ petFpsTierAuto: v, ...(v ? {} : {}) })}
              />
            </div>
            <div className="flex items-center justify-between text-[12px] text-slate-300">
              <span title="人物区域外鼠标事件穿透到桌面">区域外点击穿透</span>
              <Toggle checked={settings.petClickThrough} onChange={(v) => void patch({ petClickThrough: v })} />
            </div>
            <div className="flex items-center justify-between text-[12px] text-slate-300">
              <span title="主窗口翻页时搭子保持当前姿态">页面切换抑制</span>
              <Toggle checked={settings.suppressTransitionOnPageSwitch} onChange={(v) => void patch({ suppressTransitionOnPageSwitch: v })} />
            </div>
            <div className="flex items-center justify-between text-[12px] text-slate-300">
              <span title="重启后恢复上次拖拽放置的位置">记住拖拽位置</span>
              <Toggle checked={settings.petRememberPos} onChange={(v) => void patch({ petRememberPos: v })} />
            </div>
            <div className="flex items-center justify-between text-[12px] text-slate-300">
              <span title="超过该时间不操作，她自动走回右下角">闲置归位</span>
              <div className="flex gap-1.5">
                {([15, 30, 60] as const).map((min) => (
                  <button
                    key={min}
                    className={`rounded-lg border px-2 py-1 text-[11px] transition-all ${
                      settings.petReturnMin === min
                        ? 'border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan'
                        : 'border-white/[0.07] text-slate-400 hover:border-white/20 hover:text-slate-300'
                    }`}
                    onClick={() => void patch({ petReturnMin: min })}
                  >
                    {min}分钟
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
      ) : null}

      {/* 虚拟人资源占用（调试模式：设置 → 开发者选项 开启后显示） */}
      {settings.devMode && petStats ? (
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '180ms' }}>
          <div className="mb-3">
            <SectionTitle icon="activity" title="资源占用" />
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] p-2.5 text-center transition-colors hover:bg-white/[0.05]">
              <div className="text-lg font-bold tabular-nums text-neon-cyan">{petStats.fps}</div>
              <div className="mt-0.5 text-[10px] text-slate-500">FPS</div>
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] p-2.5 text-center transition-colors hover:bg-white/[0.05]">
              <div className="text-lg font-bold text-slate-200">{petStats.tier === 'eco' ? '省电' : petStats.tier === 'standard' ? '标准' : petStats.tier === 'smooth' ? '流畅' : '极致'}</div>
              <div className="mt-0.5 text-[10px] text-slate-500">档位</div>
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] p-2.5 text-center transition-colors hover:bg-white/[0.05]">
              <div className={`text-lg font-bold ${petStats.degraded ? 'text-neon-amber' : 'text-neon-green'}`}>{petStats.degraded ? '降级' : '正常'}</div>
              <div className="mt-0.5 text-[10px] text-slate-500">性能</div>
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] p-2.5 text-center transition-colors hover:bg-white/[0.05]">
              <div className="text-lg font-bold tabular-nums text-neon-violet">{petStats.drawCalls}</div>
              <div className="mt-0.5 text-[10px] text-slate-500">绘制批次</div>
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] p-2.5 text-center transition-colors hover:bg-white/[0.05]">
              <div className="text-lg font-bold tabular-nums text-neon-blue">{petStats.triangles.toLocaleString()}</div>
              <div className="mt-0.5 text-[10px] text-slate-500">三角面</div>
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] p-2.5 text-center transition-colors hover:bg-white/[0.05]">
              <div className="text-lg font-bold tabular-nums text-neon-pink">{petStats.textures}</div>
              <div className="mt-0.5 text-[10px] text-slate-500">纹理数</div>
            </div>
          </div>
        </section>
      ) : null}

      {/* 防分心：摸鱼自动隐身（仅虚拟角色开启时显示） */}
      {settings.petEnabled && (
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '180ms' }}>
          <div className="mb-3">
            <SectionTitle icon="shield" title="防分心" />
          </div>
          <p className="mb-3 text-[12px] leading-relaxed text-slate-500">
            姵儿在检测到你持续摸鱼（看视频/刷微信/打游戏等）超过设定时长后，自动隐藏悬浮窗，避免分心。回到工作状态后悬浮窗会自动恢复并弹出欢迎提示。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.05]">
              <span className="text-[13px] text-slate-300">启用自动隐身</span>
              <Toggle checked={settings.slackAutoHide} onChange={(v) => void patch({ slackAutoHide: v })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.05]">
              <span className="text-[13px] text-slate-300">触发阈值</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  className="glass-input w-20 text-right text-[12px] tabular-nums"
                  min={30}
                  max={3600}
                  step={30}
                  value={settings.slackHideSec}
                  onChange={(e) => {
                    const v = Math.max(30, Math.min(3600, Number(e.target.value) || 30))
                    void patch({ slackHideSec: v })
                  }}
                />
                <span className="text-[11px] text-slate-500">秒</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 养成指南（折叠式，仅虚拟角色开启时显示） */}
      {settings.petEnabled && (
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '240ms' }}>
          <div className="mb-3">
            <SectionTitle icon="brain" title="养成指南" />
          </div>
          <div className="flex flex-wrap gap-2">
            {GUIDES.map((g) => (
              <button
                key={g.key}
                className={`rounded-lg border px-3 py-1.5 text-[12px] transition-all ${
                  activeGuide === g.key
                    ? 'border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan'
                    : 'border-white/[0.07] text-slate-400 hover:border-white/20 hover:text-slate-200'
                }`}
                onClick={() => setActiveGuide((cur) => (cur === g.key ? null : g.key))}
              >
                {g.label}
              </button>
            ))}
          </div>
          {activeGuide ? (
            <div className="anim-fade-in mt-3 border-t border-white/[0.06] pt-3">
              {GUIDES.find((g) => g.key === activeGuide)?.content}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-slate-600">点击标签查看对应说明</div>
          )}
        </section>
      )}

      {/* 悬浮窗设置 — 仅悬浮窗开启时显示 */}
      {settings.widgetVisible && (
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '140ms' }}>
          <div className="mb-3">
            <SectionTitle icon="monitor" title="悬浮窗设置" />
          </div>
          <div className="mb-2 text-[11px] text-slate-500">
            屏幕侧边半透明浮窗：今日状态、专注环与快捷问答。会分别记住 mini / 吸附 / 展开 的位置，以及穿透与顶层习惯。
          </div>
          <div className="flex flex-col divide-y divide-white/[0.05]">
            <div className="-mx-1 rounded-lg px-1 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-slate-300">浮窗透明度</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">20% – 100%</div>
                </div>
                <span className="text-[11px] tabular-nums text-slate-400">{(settings.widgetOpacity * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                className="mt-1 w-full"
                value={settings.widgetOpacity}
                onChange={(e) => patch({ widgetOpacity: parseFloat(e.target.value) })}
              />
            </div>
            <div className="-mx-1 rounded-lg px-1 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-slate-300">悬浮窗颜色</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">状态环与气泡的强调色</div>
                </div>
                <div className="flex items-center gap-1.5">
                  {WIDGET_ACCENTS.map((c) => {
                    const cur = (settings.widgetAccent ?? '#22D3EE').toUpperCase()
                    return (
                      <button
                        key={c}
                        className={`h-5 w-5 rounded-full border transition-transform ${cur === c ? 'scale-110 border-white' : 'border-white/20 hover:scale-105'}`}
                        style={{ background: c }}
                        onClick={() => void patch({ widgetAccent: c })}
                        title={c}
                      />
                    )
                  })}
                  <input
                    type="color"
                    className="h-5 w-5 cursor-pointer rounded-full border border-white/20 bg-transparent p-0"
                    value={settings.widgetAccent ?? '#22D3EE'}
                    onChange={(e) => void patch({ widgetAccent: e.target.value })}
                    title="自定义颜色"
                  />
                </div>
              </div>
            </div>
            <div className="-mx-1 flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-300">紧凑模式</div>
                <div className="mt-0.5 text-[10px] text-slate-500">隐藏气泡与占位文本，只保留核心状态与活跃告警</div>
              </div>
              <Toggle checked={!!settings.widgetCompact} onChange={(v) => void patch({ widgetCompact: v })} />
            </div>
            <div className="-mx-1 flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-300">顶层显示</div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {settings.widgetDesktopPin
                    ? '已钉在桌面层时此项暂不生效'
                    : '迷你胶囊 / 展开面板始终浮在其他窗口之上'}
                </div>
              </div>
              <Toggle
                checked={settings.widgetOnTop !== false}
                onChange={(v) => void patch({ widgetOnTop: v })}
                disabled={!!settings.widgetDesktopPin}
              />
            </div>
            <div className="-mx-1 flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-300">吸附态顶层</div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {settings.widgetDesktopPin
                    ? '已钉在桌面层时此项暂不生效'
                    : '贴边水滴单独控制；关则可沉到普通窗口下'}
                </div>
              </div>
              <Toggle
                checked={settings.widgetDockOnTop !== false}
                onChange={(v) => void patch({ widgetDockOnTop: v })}
                disabled={!!settings.widgetDesktopPin}
              />
            </div>
            <div className="-mx-1 flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-300">钉在桌面层</div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  Windows：仅此浮窗挂到桌面图标同层，「显示桌面」后仍可见
                </div>
              </div>
              <Toggle
                checked={!!settings.widgetDesktopPin}
                onChange={(v) => void patch({ widgetDesktopPin: v })}
              />
            </div>
            <div className="-mx-1 flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-300">鼠标穿透</div>
                <div className="mt-0.5 text-[10px] text-slate-500">开启后浮窗不挡桌面操作（关闭需在本页操作）</div>
              </div>
              <Toggle checked={settings.widgetPenetration} onChange={(v) => void patch({ widgetPenetration: v })} />
            </div>

            <div className="my-1 border-t border-white/[0.05] pt-2">
              <div className="mb-1 px-1 text-[10px] uppercase tracking-wide text-slate-600">显示内容</div>
            </div>

            <OptionRow title="吸附态 · 左环" hint="贴边水滴左侧圆弧里显示什么">
              {DOCK_RING_OPTS.map((o) => (
                <ChipToggle
                  key={`L-${o.id}`}
                  on={display.dock.left === o.id}
                  label={o.label}
                  onClick={() => patchDisplay({ dock: { left: o.id, right: display.dock.right } })}
                />
              ))}
            </OptionRow>
            <OptionRow title="吸附态 · 右环" hint="贴边水滴右侧圆弧里显示什么">
              {DOCK_RING_OPTS.map((o) => (
                <ChipToggle
                  key={`R-${o.id}`}
                  on={display.dock.right === o.id}
                  label={o.label}
                  onClick={() => patchDisplay({ dock: { left: display.dock.left, right: o.id } })}
                />
              ))}
            </OptionRow>
            <OptionRow title="迷你态" hint="自由胶囊条上要显示的内容；「AI工具状态」首次开启会自动打开 AI 助手监控">
              {(
                [
                  ['focusRing', '专注环'],
                  ['project', '项目归属'],
                  ['chain', '专注链路'],
                  ['emptyHint', '空闲提示'],
                  ['classifyBtn', '归类按钮'],
                  ['penetrationBtn', '穿透按钮'],
                  ['aiDots', 'AI工具状态']
                ] as const
              ).map(([k, label]) => (
                <ChipToggle
                  key={k}
                  on={!!display.mini[k]}
                  label={label}
                  onClick={() => {
                    if (k === 'aiDots' && !display.mini.aiDots && !settings.aiAssistWatchEnabled) {
                      // 就地激活：连同 AI 助手监控总开关一起打开（默认监控常用 AI 编程工具）
                      void patch({ aiAssistWatchEnabled: true, aiAssistWatchApps: settings.aiAssistWatchApps?.length ? settings.aiAssistWatchApps : ['cursor', 'claude', 'chatgpt', 'windsurf'] })
                    }
                    patchDisplay({ mini: { ...display.mini, [k]: !display.mini[k] } })
                  }}
                />
              ))}
            </OptionRow>
            <OptionRow title="展开态 full" hint="完整面板可选区块（会议/归属告警始终显示）">
              {(
                [
                  ['status', '状态区'],
                  ['projectChip', '项目芯片'],
                  ['focusMinutes', '专注分钟'],
                  ['askBtn', 'AI 提问'],
                  ['attrPlans', '今日待办'],
                  ['petBubble', '搭子气泡'],
                  ['idleHint', '空闲占位'],
                  ['aiRing', 'AI状态环']
                ] as const
              ).map(([k, label]) => (
                <ChipToggle
                  key={k}
                  on={!!display.full[k]}
                  label={label}
                  onClick={() => patchDisplay({ full: { ...display.full, [k]: !display.full[k] } })}
                />
              ))}
            </OptionRow>
          </div>
        </section>
      )}

      {/* 待办桌面组件 — 与浮窗同级管控 */}
      {settings.todoWidgetVisible && (
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '160ms' }}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <SectionTitle icon="check" title="待办桌面组件" />
            <div className="flex items-center gap-1.5">
              <button
                className="glass-btn !px-2.5 !py-1 !text-[11px]"
                onClick={() => void window.api?.setTodoWidgetCollapsed?.(true)}
                title="收成迷你条"
              >
                <Icon name="minimize" size={12} /> 收起
              </button>
              <button
                className="glass-btn !px-2.5 !py-1 !text-[11px]"
                onClick={() => void window.api?.setTodoWidgetCollapsed?.(false)}
                title="展开完整待办树"
              >
                <Icon name="maximize" size={12} /> 展开
              </button>
              <button
                className="glass-btn !px-2.5 !py-1 !text-[11px]"
                onClick={() => void patch({ todoWidgetVisible: false })}
                title="从桌面隐藏"
              >
                <Icon name="eyeOff" size={12} /> 隐藏
              </button>
            </div>
          </div>
          <div className="mb-2 text-[11px] leading-relaxed text-slate-500">
            贴在桌面上的今日待办树：勾选完成、跟计划页同步。可独立设置穿透与顶层，避免挡工作或沉到桌面下找不到。
          </div>
          <div className="flex flex-col divide-y divide-white/[0.05]">
            <div className="-mx-1 rounded-lg px-1 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-slate-300">
                    {settings.overlayGlass ? '面板深浅' : '面板深浅'}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    左右拖动会连续改变待办面板底色（不是整窗透明）
                  </div>
                </div>
                <span className="text-[11px] tabular-nums text-slate-400">
                  {Math.round((settings.todoWidgetOpacity ?? 1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                className="mt-1 w-full"
                value={settings.todoWidgetOpacity ?? 1}
                onChange={(e) => void patch({ todoWidgetOpacity: parseFloat(e.target.value) })}
              />
            </div>
            <div className="-mx-1 flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-300">顶层显示</div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {settings.todoWidgetDesktopPin
                    ? '已钉在桌面层时此项暂不生效'
                    : '关闭后沉到底层，不挡全屏应用'}
                </div>
              </div>
              <Toggle
                checked={settings.todoWidgetOnTop !== false}
                onChange={(v) => void patch({ todoWidgetOnTop: v })}
                disabled={!!settings.todoWidgetDesktopPin}
              />
            </div>
            <div className="-mx-1 flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-300">钉在桌面层</div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  Windows：仅待办组件挂到桌面图标同层，「显示桌面」后仍可见
                </div>
              </div>
              <Toggle
                checked={!!settings.todoWidgetDesktopPin}
                onChange={(v) => void patch({ todoWidgetDesktopPin: v })}
              />
            </div>
            <div className="-mx-1 flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-300">鼠标穿透</div>
                <div className="mt-0.5 text-[10px] text-slate-500">穿透后点不到组件，需在本页关闭穿透才能再操作</div>
              </div>
              <Toggle
                checked={!!settings.todoWidgetPenetration}
                onChange={(v) => void patch({ todoWidgetPenetration: v })}
              />
            </div>
            <div className="-mx-1 flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-300">玻璃效果</div>
                <div className="mt-0.5 text-[10px] text-slate-500">待办组件与状态浮窗共用；Win 为磨砂圆角，关则为实心</div>
              </div>
              <Toggle
                checked={!!settings.overlayGlass}
                onChange={(v) => void patch({ overlayGlass: v })}
              />
            </div>
            <div className="my-1 border-t border-white/[0.05] pt-2">
              <div className="mb-1 px-1 text-[10px] uppercase tracking-wide text-slate-600">显示分区</div>
            </div>
            <OptionRow title="待办组件分区" hint="展开后显示哪些区块（与组件内 ⚙ 同步）">
              {(
                [
                  ['projects', '项目'],
                  ['todos', '待办'],
                  ['life', '生活']
                ] as const
              ).map(([k, label]) => (
                <ChipToggle
                  key={k}
                  on={!!display.todo[k]}
                  label={label}
                  onClick={() => patchDisplay({ todo: { ...display.todo, [k]: !display.todo[k] } })}
                />
              ))}
            </OptionRow>
          </div>
        </section>
      )}

      {showGuide ? <GuideModal onDone={closeGuide} /> : null}
    </div>
  )
}
