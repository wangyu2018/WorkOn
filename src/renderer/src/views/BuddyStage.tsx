import { useEffect, useState } from 'react'
import { usePresenceStore } from '../stores/presenceStore'
import { useSettingsStore } from '../stores/settingsStore'
import { StateBadge } from '../components/StateBadge'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { Toggle } from '../components/Toggle'

/** 当前桌搭角色（VRM 姵儿，单角色） */
const CHARACTER = {
  id: 'ling',
  name: '姵儿',
  cn: '猫耳耳机少女',
  rarity: 'SSR',
  tagline: 'VRM 实时 3D 桌搭'
} as const

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
  { emoji: '🐱', title: '这是你的桌搭姵儿', desc: '她会跟随你的工作状态实时变化心情和姿态，常驻屏幕右下角陪伴你工作。' },
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

/** 桌搭：桌搭状态 + 行为控制（互动开关/显示参数）+ 折叠养成指南 */
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

  // 首次进入桌搭页：未看过引导则弹出
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

  return (
    <div className="view-enter flex flex-col gap-5">
      {/* 页面标题区 */}
      <header className="anim-fade-up flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-neon-cyan"
          style={{ borderColor: 'var(--accent-glow)', background: 'var(--accent-softer)', boxShadow: '0 0 14px var(--accent-glow)' }}
        >
          <Icon name="cat" size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight text-slate-100">桌搭</h1>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {CHARACTER.name} · {CHARACTER.tagline} — 实时状态、互动控制与养成指南
          </p>
        </div>
        <span className="chip" style={{ borderColor: '#F59E0B66' }}>
          {CHARACTER.rarity}
        </span>
      </header>

      {/* 总控卡：桌面形象 + 浮窗 + 互斥模式，三开关并列 */}
      <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '40ms' }}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-semibold text-slate-200">桌面形象</span>
            <Toggle checked={settings.petEnabled} onChange={(v) => void patch({ petEnabled: v })} />
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-semibold text-slate-200">浮窗与托盘</span>
            <Toggle checked={settings.petEnabled} onChange={(v) => void patch({ petEnabled: v })} />
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-500">互斥模式</span>
            <Toggle checked={settings.mutualExclusive ?? false} onChange={(v) => {
              void patch({ mutualExclusive: v })
              if (v && settings.petEnabled) void patch({ widgetVisible: false })
            }} />
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 桌搭状态卡 */}
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '60ms' }}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionTitle icon="cat" title="桌搭状态" />
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
                {pet?.visible === false ? '显示桌搭' : '隐藏桌搭'}
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
                <PadBar label="P" value={pet.emotion.pleasure} color="#10B981" />
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
            <EmptyState emoji="🐱" title="桌搭未连接" hint="启动后这里会实时同步桌搭的状态、情感与气泡消息。" />
          )}
        </section>

        {/* 桌搭行为控制：互动开关（单列+效果描述）+ 显示参数 */}
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '120ms' }}>
          <div className="mb-3">
            <SectionTitle icon="sliders" title="桌搭行为控制" />
          </div>
          <div className="mb-1 text-[11px] text-slate-500">互动开关（关闭即停用对应行为，降低开销）</div>
          <div className="mb-3 flex flex-col divide-y divide-white/[0.05]">
            {(
              [
                ['click', '点击互动', '点击她时后仰小动作 + 回复气泡（好感度来源）'],
                ['drag', '拖拽移动', '抓起→跟手→松手停在落点，10 分钟内不被拉回'],
                ['dragPhysics', '拖拽物理', '拖拽中的摆动与松手抛物线弹跳（默认关，仅跟手位移）'],
                ['chat', '右键对话', '右键点她弹出输入框，支持 AI 问答'],
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
          </div>

          <div className="flex flex-col gap-2.5 border-t border-white/[0.06] pt-3">
            <div className="flex items-center justify-between text-[12px] text-slate-300">
              <span>启用桌搭</span>
              <Toggle checked={settings.petEnabled} onChange={(v) => void patch({ petEnabled: v })} />
            </div>
            <div className="flex items-center justify-between text-[12px] text-slate-300">
              <span>角色</span>
              <div className="flex items-center gap-2">
                <select
                  className="glass-input w-32"
                  value={settings.petVrmPath ? 'custom' : 'ling'}
                  onChange={(e) => {
                    if (e.target.value === 'ling') void window.api?.resetVrm?.()
                  }}
                >
                  <option value="ling">姵儿（默认）</option>
                  {settings.petVrmPath && <option value="custom">自定义角色</option>}
                </select>
                <button
                  className="rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 px-3 py-1 text-[11px] text-neon-cyan transition-all hover:bg-neon-cyan/20"
                  onClick={() => void window.api?.selectVrmFile?.()}
                >
                  上传 VRM
                </button>
              </div>
            </div>
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
              <span title="人物区域外鼠标事件穿透到桌面">区域外点击穿透</span>
              <Toggle checked={settings.petClickThrough} onChange={(v) => void patch({ petClickThrough: v })} />
            </div>
            <div className="flex items-center justify-between text-[12px] text-slate-300">
              <span title="主窗口翻页时桌搭保持当前姿态">页面切换抑制</span>
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

      {/* 防分心：摸鱼自动隐身 */}
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

      {/* 养成指南（折叠式） */}
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

      {/* 浮窗与托盘 — 与桌搭并列主开关 */}
      <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '140ms' }}>
        <div className="mb-3">
          <SectionTitle icon="monitor" title="浮窗与托盘" />
        </div>
        <div className="mb-2 text-[11px] text-slate-500">
          托盘图标是桌搭的"手柄"——左键展开状态浮窗，右键弹出快捷菜单。与桌搭伴侣的开关独立但联动。
        </div>

        {/* 主开关：浮窗与托盘 */}
        <div className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-slate-200">启用托盘与浮窗</div>
            <div className="mt-0.5 text-[10px] text-slate-500">系统托盘常驻 WorkOn 图标，左键展开/右键菜单</div>
          </div>
          <Toggle checked={settings.petEnabled} onChange={(v) => void patch({ petEnabled: v })} />
        </div>

        {/* 管控细节（开关开启后展开） */}
        {settings.petEnabled && (
          <div className="mt-2 ml-2 flex flex-col divide-y divide-white/[0.05] border-l border-white/[0.06] pl-3">
            <div className="-mx-1 flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-300">桌面浮窗</div>
                <div className="mt-0.5 text-[10px] text-slate-500">屏幕右侧半透明悬浮窗，显示今日状态概览与快捷问答</div>
              </div>
              <Toggle checked={settings.widgetVisible} onChange={(v) => void patch({ widgetVisible: v })} />
            </div>
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
            <div className="-mx-1 flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-300">摸鱼自动隐身</div>
                <div className="mt-0.5 text-[10px] text-slate-500">持续摸鱼超过设定时长后自动隐藏，回到工作恢复</div>
              </div>
              <Toggle checked={settings.slackAutoHide} onChange={(v) => void patch({ slackAutoHide: v })} />
            </div>
            {settings.slackAutoHide && (
              <div className="-mx-1 flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.03]">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-slate-300">隐身触发时长</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">摸鱼持续 X 秒后自动隐藏</div>
                </div>
                <select className="glass-input w-24" value={settings.slackHideSec} onChange={(e) => void patch({ slackHideSec: Number(e.target.value) })}>
                  {[30, 60, 120, 180, 300].map((s) => <option key={s} value={s}>{s >= 60 ? `${s/60}分钟` : `${s}秒`}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
      </section>

      {showGuide ? <GuideModal onDone={closeGuide} /> : null}
    </div>
  )
}
