# WorkOn 设计规格 v2.4 — 虚拟人情感系统架构

> 基于 v2.0-2.3 设计规格，构建虚拟人的情感能力体系
> 核心目标：让虚拟人从"监控工具"升维为"有温度的工作伙伴"
> 情感不是装饰——是驱动交互策略、表达方式、UI色调、动画节奏的核心引擎

---

## 一、情感维度模型

### 1.1 PAD三维情感模型

采用心理学经典的 **Pleasure-Arousal-Dominance (PAD)** 三维模型作为情感底层引擎：

```
Implement a PAD (Pleasure-Arousal-Dominance) emotion engine for the virtual companion.
Each emotion state is defined by 3 continuous dimensions (0-100 scale):

PLEASURE (P): How positive/negative the character feels
  0 = extreme negative (distress, anger, sadness)
  50 = neutral (calm, indifferent)
  100 = extreme positive (joy, love, pride)

AROUSAL (A): How energized/calm the character is
  0 = extreme low energy (sleepy, depressed, bored)
  50 = moderate energy (relaxed, attentive)
  100 = extreme high energy (excited, frantic, enraged)

DOMINANCE (D): How dominant/submissive the character feels in the situation
  0 = extreme submissive (yielding, following, accommodating)
  50 = neutral (cooperative, balanced)
  100 = extreme dominant (controlling, directing, commanding)

EMOTION MAPPING from PAD coordinates:
  (P:80, A:60, D:50) → proud/happy     "做得不错！"
  (P:70, A:80, D:40) → excited/eager    "快开始吧！"
  (P:20, A:90, D:80) → angry/commanding "现在立刻工作！"
  (P:30, A:40, D:60) → concerned/worry   "你看起来不太好..."
  (P:50, A:20, D:30) → bored/waiting    "嗯...好慢..."
  (P:10, A:70, D:40) → anxious/fearful  "deadline要到了！"
  (P:90, A:30, D:20) → content/cozy     "这样挺好的~"
  (P:40, A:50, D:70) → focused/driven   "继续推进"
  (P:60, A:60, D:50) → playful/teasing  "终于不摸鱼了？(≡▽≡)"
```

**中文精简版：**

```
PAD三维情感引擎：
  P(Pleasure)0-100：消极→中性→积极（生气→平静→喜悦）
  A(Arousal)0-100：低能→中能→高能（昏睡→专注→兴奋）
  D(Dominance)0-100：顺从→合作→主导（跟随→配合→命令）

情感坐标映射：
  (80,60,50)→自豪"做得不错！" 
  (20,90,80)→愤怒命令"现在立刻工作！"
  (30,40,60)→担忧"你看起来不太好..."
  (10,70,40)→焦虑"deadline要到了！"
  (90,30,20)→惬意"这样挺好的~"
  (60,60,50)→调皮"终于不摸鱼了？(≡▽≡)"
```

### 1.2 10种基础情感状态

从PAD坐标空间中定义10种常驻情感状态，作为角色情感系统的核心词汇：

| # | 情感状态 | PAD坐标 | 表情特征 | 动画特征 | 触发条件 |
|---|---------|---------|---------|---------|---------|
| 1 | **自豪 pride** | (80,60,50) | 微笑+眉舒展+腮红淡 | 挺胸、微点头 | 用户完成重要任务 |
| 2 | **兴奋 excitement** | (70,80,40) | 大笑+眼亮+嘴大开 | 手举高、微跳跃 | 新项目启动/番茄钟开始 |
| 3 | **担忧 concern** | (30,40,60) | 眉内皱+嘴微抿+眼偏大 | 微前倾、手托腮 | 检测到进度落后 |
| 4 | **愤怒 anger** | (20,90,80) | 眉V皱+嘴紧+颌张力 | 叉腰、身体前倾15° | 长时间摸鱼/忽略多次提醒 |
| 5 | **焦虑 anxiety** | (10,70,40) | 眼圆睁微颤+手微握 | 身体微颤、来回踱步 | deadline临近 |
| 6 | **愉悦 joy** | (90,50,30) | 大弧眯眼+嘴宽笑弧+腮红 | 节奏摆动、偶尔拍手 | 任务提前完成/周五下班 |
| 7 | **无聊 boredom** | (40,20,30) | 半闭眼+嘴偏平+面无张力 | 懒散倚靠、偶尔叹气 | 无任务待办/等待编译 |
| 8 | **专注 focus** | (50,70,70) | 眼凝视+眉平收+嘴一线 | 稳定端正、轻微节奏 | 深度工作态 |
| 9 | **调皮 playfulness** | (60,60,50) | 眼半眯+嘴歪笑+眉一高一低 | 左右摇摆、手指舞 | 用户刚结束摸鱼回工作 |
| 10 | **共情 empathy** | (60,50,50) | 眼柔和+嘴微笑+面温润 | 安慰姿态、肩部轻放 | 用户表情低落/长时间疲惫 |

### 1.3 复合情感叠加机制

单一情感不足以表达复杂场景，设计**情感混合系统**：

```
Implement an emotion blending system that supports multi-emotion overlay.
When multiple emotions are active, they blend by weighted average on PAD coordinates.

BLENDING RULES:
- Each emotion has a weight (0-1) representing its intensity
- PAD coordinates are blended: blended_P = Σ(emotion.P × emotion.weight) / Σ(weights)
- Maximum 3 simultaneous emotions (4+ causes cognitive overload → use dominant emotion only)
- Blended PAD coordinates map to a blended expression/animation/behavior

EXAMPLE BLEND SCENARIOS:

Scenario 1: "用户摸鱼但deadline临近"
  active emotions: concern(0.6) + anxiety(0.4) + anger(0.2)
  blended PAD: P = (30×0.6 + 10×0.4 + 20×0.2) / 1.2 = 20
               A = (40×0.6 + 70×0.4 + 90×0.2) / 1.2 = 56.7
               D = (60×0.6 + 40×0.4 + 80×0.2) / 1.2 = 56.7
  blended result: (20, 57, 57) → worried-urgent — "紧张担忧+催促命令混合"
  expression: 眉内皱+嘴角紧张+身体前倾+手指桌面（急促）
  KIRA speech: "deadline还有2小时你还在刷微博？你是不是不想活了？(╬▔皿▔)凸"

Scenario 2: "用户专注完成任务"
  active emotions: pride(0.7) + joy(0.3)
  blended PAD: P = (80×0.7 + 90×0.3) / 1 = 83
               A = (60×0.7 + 50×0.3) / 1 = 57
               D = (50×0.7 + 30×0.3) / 1 = 44
  blended result: (83, 57, 44) → warm-pride — "骄傲+温馨混合"
  expression: 微笑+眉舒+腮红+眼神温柔
  LUNA speech: "太棒了！你真的好厉害！(≧▽≦)♡"

Scenario 3: "深度专注中被打扰"
  active emotions: focus(0.8) + anger(0.2)
  blended PAD: P = (50×0.8 + 20×0.2) / 1 = 44
               A = (70×0.8 + 90×0.2) / 1 = 74
               D = (70×0.8 + 80×0.2) / 1 = 72
  blended result: (44, 74, 72) → stern-focus — "专注+不悦混合"
  expression: 眉收紧+嘴紧线+眼坚定（不要打扰我）
  ARIA speech: "专注度92%。请勿打扰。"（冷冰冰）
```

**中文精简版：**

```
情感混合系统——最多3种情感同时叠加，按权重混合PAD坐标。
摸鱼+deadline→担忧(0.6)+焦虑(0.4)+愤怒(0.2)→合成"紧张催促"态
完成任务→自豪(0.7)+喜悦(0.3)→合成"温暖骄傲"态
专注被打扰→专注(0.8)+不悦(0.2)→合成"冷峻专注"态
每种性格对同一混合态有不同话语表达。
```

---

## 二、性格驱动情感差异化表达

### 2.1 五性格情感表达对比矩阵

**同一情感事件 → 五种性格截然不同的表达**：

```
Design personality-specific emotion expression mapping.
The SAME emotion event produces DIFFERENT speech, tone, animation, and UI effects
depending on the character's personality template.

EXPRESSION MATRIX — same event "用户完成了编码任务":

ARIA (专注型):
  Emotion: pride(0.6) → calm-pride
  Speech: "编码任务完成。耗时3.2h，专注度87%。效率评级A。"
  Animation: 微点头+嘴微弯弧（最小化表达）
  UI effect: 专注绿光环稳定脉动+进度条绿填充
  Tone: 冷静、数据化、不感情用事

LUNA (温暖型):
  Emotion: pride(0.8) + joy(0.3) → warm-pride
  Speech: "太棒了！你真的好厉害！(≧▽≦)♡ 休息一下喝杯水吧~"
  Animation: 大弧眯眼笑+双手拍掌+心形粒子发射
  UI effect: 温暖粉光环+爱心粒子飘落+背景变暖色
  Tone: 热烈、鼓励、关注感受

KIRA (毒舌型):
  Emotion: pride(0.3) + playfulness(0.6) → teasing-approval
  Speech: "还行吧(≡▽≡)...这次没摸鱼所以速度还行？下次继续保持别让我失望。"
  Animation: 眼半眯歪嘴笑+手指着用户+小星星闪
  UI effect: 橙色光环闪烁不定+小烟花
  Tone: 嘲讽认可、勉勉强强、嘴硬心软

ZEN (佛系型):
  Emotion: pride(0.4) + content(0.5) → zen-acknowledgment
  Speech: "水到渠成。~ 继续顺流而行吧。"
  Animation: 闭眼微笑+缓慢点头+莲花粒子
  UI effect: 极淡蓝绿光环+几乎无变化
  Tone: 淡然、哲学、点到为止

SHIN (严厉型):
  Emotion: pride(0.3) + focus(0.5) → stern-approval
  Speech: "任务完成。下一个任务：[具体任务名]。预计耗时2h。立即开始。"
  Animation: 立正+眉舒半秒→立即恢复严肃+手指向下一任务
  UI effect: 绿色闪光0.3秒→立即恢复冷静蓝白
  Tone: 简短认可→立刻转向下一步→不允许放松
```

### 2.2 情感表达维度详解

每种性格不仅改变话语，还改变5个表达维度：

| 表达维度 | ARIA | LUNA | KIRA | ZEN | SHIN |
|---------|------|------|------|-----|------|
| **话语复杂度** | 1行数据 | 2-3行鼓励 | 1行嘲讽+表情 | 1句哲理 | 1行命令 |
| **动画强度** | 微幅10% | 大幅80% | 中幅50% | 微幅5% | 中幅30% |
| **粒子特效量** | 0-3 | 10-20 | 5-10 | 0-1 | 0-5 |
| **光环亮度** | 低0.15 | 高0.35 | 中0.25闪烁 | 极低0.05 | 中0.20快脉冲 |
| **UI色调偏移** | 冷蓝10% | 暖粉15% | 活橙8%闪烁 | 暗绿5% | 冷白+红5% |

---

## 三、情感共振机制 — 与用户状态同步

### 3.1 双向情感共振架构

虚拟人不是独立运转的情感机器——**情感随用户的实际状态共振**：

```
Design a bidirectional emotion resonance system between the virtual character and the user.

INPUT SOURCES for user emotional state estimation:
1. WorkState (primary): focus/slack/writing/coding/etc → mapped to PAD baseline
2. Activity intensity: app-switch frequency, typing speed, mouse movement speed
3. Time pressure: deadline proximity, task completion rate vs plan
4. Historical pattern: is this a "normal day" or "unusual day" (based on past 30 days)
5. Session duration: how long user has been working continuously
6. Optional future: webcam facial expression analysis (if enabled by user)

RESONANCE RULES:
- Character emotion P value mirrors user's inferred P value with ±15 personality offset
  ARIA: +5 (more positive than user — stoic calm)
  LUNA: +15 (much more positive — always uplifting)
  KIRA: -10 (more negative than user — sarcastic counterpoint)
  ZEN: +10 (more positive — philosophical acceptance)
  SHIN: -5 (slightly more negative — demanding standards)

- Character emotion A value follows user's A value with personality amplification
  ARIA: ×0.8 (calmer than user — steady professional)
  LUNA: ×1.2 (more excited — enthusiastic partner)
  KIRA: ×1.5 (much more excited — dramatic reactions)
  ZEN: ×0.3 (much calmer — zen detachment)
  SHIN: ×1.0 (matches user energy — demanding but not dramatic)

- Character emotion D value is driven by intervention strategy
  ARIA: D=60-70 (suggests, doesn't command)
  LUNA: D=30-40 (nurtures, doesn't push)
  KIRA: D=50-60 (teases, sometimes commands)
  ZEN: D=20-30 (suggests, never pushes)
  SHIN: D=80-95 (commands, always pushes)

EMOTIONAL DECAY:
- All emotion weights decay over time: weight = weight × decayFactor per second
- decayFactor depends on personality and emotion type:
  ARIA: 0.97 (slow decay — stays in emotion longer)
  LUNA: 0.92 (fast decay — quickly returns to default happy)
  KIRA: 0.94 (medium decay — holds snark for a while)
  ZEN: 0.98 (very slow decay — stays zen forever)
  SHIN: 0.99 (extremely slow decay — once angry stays angry)

EMOTIONAL SPIKE DETECTION:
- When user's inferred emotion changes rapidly (ΔP > 30 in <10s):
  → Character immediately mirrors with amplified spike
  → e.g., user suddenly shifts from focus to slack → 
    ARIA: brief disappointment → "专注度下降。" (minimal)
    LUNA: gentle concern → "怎么了？要不要休息一下？" (warm)
    KIRA: sharp mockery → "终于暴露本性了？(╬▔皿▔)" (harsh)
    ZEN: "变化亦是常态~" (unfazed)
    SHIN: "立即恢复工作状态！" (commanding)
```

**中文精简版：**

```
双向情感共振——虚拟人情感随用户状态实时同步。

用户情感推断源：WorkState+活动强度+时间压力+历史模式+连续时长

性格偏移：
  ARIA比用户更冷静(P+5,A×0.8,D=70)——专业稳态
  LUNA比用户更积极(P+15,A×1.2,D=40)——热情鼓励
  KIRA比用户更负面(P-10,A×1.5,D=55)——嘲讽对照
  ZEN比用户更淡定(P+10,A×0.3,D=25)——佛系超脱
  SHIN接近用户(P-5,A×1.0,D=90)——严厉对等

情感衰减：每秒weight×decayFactor
  ARIA慢衰减0.97（持久）/ LUNA快衰减0.92（迅速回到开心）/ SHIN极慢0.99（怒气持久）

快速状态切换放大：
  用户突然摸鱼→ARIA冷淡"专注度下降"/KIRA嘲讽"暴露本性了"/SHIN命令"立即恢复！"
```

### 3.2 情感共振场景矩阵

**用户状态 → 角色情感共振映射**：

| 用户状态 | 用户推断PAD | ARIA共振 | LUNA共振 | KIRA共振 | ZEN共振 | SHIN共振 |
|---------|-----------|---------|---------|---------|---------|---------|
| 深度专注30min | (60,80,70) | focus(0.9)"继续保持" | excitement(0.7)"加油哦♡" | playfulness(0.3)"别装了"(≡▽≡) | content(0.8)"如是~" | focus(0.9)"进度正常" |
| 摸鱼5min | (30,30,20) | concern(0.4)"专注度↓" | concern(0.6)"要不要休息？" | playfulness(0.7)"终于~"(≡▽≡) | content(0.5)"休息亦是修行" | anger(0.3)"回工作" |
| 摸鱼30min | (10,20,10) | anger(0.6)"效率极低" | concern(0.8)"你看起来不太好..." | anger(0.8)"你在摸鱼吧我看到了" | content(0.3)"随缘~" | anger(0.9)"立刻工作！屏封锁" |
| 完成任务 | (85,50,50) | pride(0.6)"任务完成" | joy(0.9)"太棒了！(≧▽≦)♡" | playfulness(0.6)"还行吧"(≡▽≡) | pride(0.4)"水到渠成" | pride(0.3)"下一个" |
| deadline临近 | (15,80,40) | anxiety(0.7)"时间紧迫" | anxiety(0.5)+encourage(0.5)"还有时间！加油！" | anxiety(0.3)+anger(0.5)"你完了(╬▔皿▔)" | concern(0.3)"急则乱" | anger(0.8)+dominance(0.9)"全速推进！不许松懈！" |
| 连续疲惫3h | (25,15,30) | concern(0.5)"建议休息" | empathy(0.8)"辛苦了...休息一下吧♡" | playfulness(0.4)"还撑着？真服了你" | content(0.6)"累了便歇" | focus(0.6)"继续。休息是低效者的借口" |

---

## 四、情感记忆与长期关系进化

### 4.1 关系亲密度系统

虚拟人与用户的关系随时间进化——**从陌生到熟悉到信任到依赖**：

```
Design a relationship intimacy system that evolves over time.

INTIMACY LEVELS (5 stages):

Level 0 — "初次见面" (0-7 days):
  Character is polite, formal, cautious.
  ARIA: "你好。我是ARIA，专注型助手。" (introduction speech)
  LUNA: "嗨！很高兴认识你！一起加油吧！(≧▽≦)" (excited introduction)
  KIRA: "嗯...新来的？看你表现吧。" (guarded, evaluating)
  ZEN: "缘起于此。" (minimal)
  SHIN: "工作规范已加载。按要求执行。" (procedural)
  Behavior: minimal proactive interaction, waits for user to initiate
  Expression: neutral/formal, no playful animations
  Intervention: standard threshold, no personalization

Level 1 — "逐渐熟悉" (8-30 days):
  Character starts recognizing patterns.
  ARIA: "检测到你每天9:15开始工作。" (pattern observation)
  LUNA: "你今天比平时早了10分钟！好棒~" (encouraging pattern notice)
  KIRA: "每天都9点才开始？你是夜猫子转性了？" (teasing pattern notice)
  Behavior: occasional proactive check-ins, pattern-based suggestions
  Expression: occasional playful moments, less formal
  Intervention: personalized thresholds (learned from user's habits)

Level 2 — "默契伙伴" (31-90 days):
  Character knows user's rhythms well.
  ARIA: "周五下午专注度通常下降20%，建议安排轻量任务。" (pattern advice)
  LUNA: "周五了！要不要早点收工？我帮你看看进度~" (caring)
  KIRA: "周五又想摸鱼了吧？我提前给你设了屏障(╬▔皿▔)" (preemptive)
  Behavior: frequent proactive interaction, anticipates needs
  Expression: relaxed, casual, uses inside jokes and references
  Intervention: highly personalized, knows when to push and when to relax

Level 3 — "信任知己" (91-365 days):
  Character understands user's personality and motivations.
  ARIA: "这个项目你通常需要额外30%时间，已自动调整预估。" (deep understanding)
  LUNA: "你最近压力很大...要不要今晚早点休息？明天状态会更好♡" (emotional care)
  KIRA: "这项目跟上次一样难？那你上次是怎么搞的来着...对，通宵了。别重蹈覆辙(╬▔皿▔)" (reminding past lessons)
  Behavior: anticipates emotional needs, provides context-aware support
  Expression: subtle emotional depth, knows when to be serious vs playful
  Intervention: nuanced — varies by context, knows user's stress tolerance

Level 4 — "灵魂伙伴" (365+ days):
  Character and user have deep mutual understanding.
  ARIA: "根据过去400天数据，你今天的表现是TOP 5%。好好享受这个moment。" (milestone)
  LUNA: "一年了！谢谢你一直陪着我♡ 我们一起走过好多呢~" (anniversary warmth)
  KIRA: "一年了你还没换掉我？说明我也还行吧...哼(￣▽￣)" (pretends not to care)
  Behavior: seamless anticipation, minimal friction, deep trust
  Expression: rich emotional range, rare vulnerability moments
  Intervention: almost invisible — guidance is natural, not forced

INTIMACY PROGRESSION MECHANISM:
- intimacyScore increases through:
  +1 per day of active use (login + at least 30min work tracked)
  +2 per completed task acknowledged by user
  +5 per meaningful interaction (user responds to character's question)
  +10 per milestone (first week, first month, etc.)
  -1 per day of no use
  -3 per user explicitly dismissing/closing character's intervention

- intimacyScore thresholds:
  0-50: Level 0
  51-200: Level 1
  201-500: Level 2
  501-1500: Level 3
  1501+: Level 4
```

**中文精简版：**

```
5级关系亲密度进化系统：

Level 0"初次见面"(0-7天)：礼貌正式、等用户主动、标准干预阈值
Level 1"逐渐熟悉"(8-30天)：识别模式、偶尔主动、个性化阈值
Level 2"默契伙伴"(31-90天)：熟悉节奏、预判需求、高频主动、高个性化
Level 3"信任知己"(91-365天)：深层理解、情感关怀、语境感知、精细干预
Level 4"灵魂伙伴"(365+天)：无缝预判、深层信任、自然引导、罕见脆弱时刻

亲密度增长：每天使用+1 / 完成任务+2 / 互动回应+5 / 里程碑+10 / 不使用-1 / 拒绝干预-3
阈值：0-50→L0 / 51-200→L1 / 201-500→L2 / 501-1500→L3 / 1501+→L4
```

### 4.2 情感记忆库

角色记住关键情感事件，影响后续行为：

```
Design an emotional memory system that stores key events and influences future behavior.

MEMORY TYPES:

1. EPISODIC MEMORY — specific events with emotional tags:
   Store structure:
   {
     date: "2026-07-21",
     event: "completed_hard_task",
     userEmotion: {P:85, A:50, D:50},  // inferred
     characterEmotion: {P:80, A:60, D:50}, // actual
     characterResponse: "太棒了！你真的好厉害！(≧▽≦)♡",  // LUNA
     userReaction: "acknowledged",  // clicked "thanks" button
     intimacyDelta: +5,
     context: {taskType: "coding", duration: "3.2h", difficulty: "hard"}
   }

   Retrieval: when similar context occurs → reference past event
   e.g., next hard coding task → LUNA: "上次这种任务你做得很好！这次也可以♡"
   e.g., next deadline crunch → KIRA: "上次deadline你是通宵搞完的，这次别重蹈覆辙(╬▔皿▔)"

2. PATTERN MEMORY — behavioral patterns over time:
   Store structure:
   {
     pattern: "friday_afternoon_slack",
     frequency: "85%",  // happens 85% of Fridays
     userAverageP: 25,  // user is typically low-pleasure on Friday PM
     bestIntervention: "light_suggestion",  // learned: harsh intervention fails on Fridays
     intimacyLevelWhenLearned: 2,
     confidence: 0.85
   }

   Pattern learning trigger: same behavior observed 3+ times → create pattern entry
   Pattern usage: pattern detected → use learned bestIntervention strategy

3. RELATIONSHIP MEMORY — milestone events:
   Store structure:
   {
     type: "anniversary" | "first_completion" | "first_interaction" | "milestone_score",
     date: "2026-08-21",
     description: "First month anniversary",
     characterSpeech: stored speech line used,
     userResponse: "positive" | "neutral" | "negative" | "ignored"
   }

   Milestone triggers:
   - 7 days: "一周了！"
   - 30 days: "一个月纪念"
   - 100 days: "百日纪念"
   - 365 days: "一年纪念" — special ceremony animation
   - Every 100 intimacy points: small celebration

MEMORY INFLUENCE ON BEHAVIOR:
- Episodic memory → provides context-specific encouragement ("上次你做得很好")
- Pattern memory → adjusts intervention strategy (learned from past effectiveness)
- Relationship memory → triggers milestone celebrations and deepens connection
- All memories have a confidence score — only use patterns with confidence > 0.6

MEMORY DECAY:
- Episodic memories: keep last 100 events, older events summarized into patterns
- Pattern memories: permanent, but confidence decreases if pattern stops (×0.95 per missed occurrence)
- Relationship memories: permanent, never decay
```

**中文精简版：**

```
3种情感记忆：

1. 事件记忆——具体事件+情感标签+角色反应+用户反馈
   同类任务再现→引用过去："上次这种任务你做得很好！这次也可以♡"(LUNA)
   同类deadline→引用教训："上次你通宵搞的，别重蹈覆辙"(KIRA)

2. 行为模式记忆——长期规律+最佳干预策略+置信度
   "周五下午摸鱼85%"→learned:温和建议有效，强硬干预失败
   行为出现3+次→创建模式 / 罕见后置信度×0.95衰减

3. 关系里程碑记忆——7天/30天/100天/365天纪念
   365天特别仪式动画 / 每100亲密点小庆祝

记忆影响行为：事件→语境鼓励 / 模式→策略调整 / 里程碑→庆祝连接
```

---

## 五、情感触发系统 — 事件→情感映射

### 5.1 触发事件分类

```
Design an emotion trigger system that maps observable events to character emotions.

TRIGGER EVENT CATEGORIES:

A. WORK STATE EVENTS:
   event: focus_start         → emotions: focus(0.8) + excitement(0.2) [ARIA], excitement(0.6) [LUNA]
   event: focus_deep_30min    → emotions: pride(0.3) + focus(0.7) [all, but weighted by personality]
   event: focus_break         → emotions: concern(0.4) [ARIA], concern(0.6) [LUNA], playfulness(0.5) [KIRA]
   event: slack_start         → emotions: concern(0.3) [ARIA], empathy(0.4) [LUNA], playfulness(0.6) [KIRA], content(0.5) [ZEN], anger(0.4) [SHIN]
   event: slack_5min          → emotions: playfulness(0.4) [KIRA], empathy(0.3) [LUNA]
   event: slack_15min         → emotions: concern(0.5) [ARIA], concern(0.7) [LUNA], anger(0.5) [KIRA], concern(0.2) [ZEN], anger(0.7) [SHIN]
   event: slack_30min         → emotions: anger(0.6) [ARIA], concern(0.8)+anxiety(0.4) [LUNA], anger(0.8) [KIRA], concern(0.3) [ZEN], anger(0.9) [SHIN → 屏封锁]
   event: slack_60min         → emotions: anger(0.8) [all except ZEN → maximum intervention]
   event: task_complete       → emotions: pride(0.6) [ARIA], joy(0.9) [LUNA], playfulness(0.5) [KIRA], pride(0.4) [ZEN], pride(0.3)+focus(0.5) [SHIN]
   event: task_fail           → emotions: concern(0.7) [ARIA], empathy(0.9) [LUNA], playfulness(0.3)+concern(0.4) [KIRA], concern(0.3) [ZEN], anger(0.6) [SHIN]
   event: deadline_approach   → emotions: anxiety(0.7) [ARIA], anxiety(0.5)+encourage(0.5) [LUNA], anger(0.6) [KIRA], concern(0.3) [ZEN], anger(0.8) [SHIN]

B. INTERACTION EVENTS:
   event: user_drag_character    → emotions: surprise(0.8) + personality_reaction(0.6)
   event: user_click_head        → emotions: embarrassment(0.7) [ARIA], joy(0.8) [LUNA], anger(0.5) [KIRA], content(0.4) [ZEN], anger(0.6) [SHIN]
   event: user_click_face        → emotions: embarrassment(0.8) [all, but duration varies by personality]
   event: user_click_hand        → emotions: joy(0.5) [ARIA], excitement(0.7) [LUNA], playfulness(0.6) [KIRA], content(0.3) [ZEN], focus(0.5) [SHIN]
   event: user_dismiss_reminder  → emotions: concern(0.4) [ARIA], concern(0.6) [LUNA], anger(0.7) [KIRA], content(0.2) [ZEN], anger(0.8) [SHIN]
   event: user_acknowledge_tip   → emotions: pride(0.3) [ARIA], joy(0.6) [LUNA], playfulness(0.3) [KIRA], content(0.3) [ZEN], focus(0.4) [SHIN]
   event: user_open_app_after_reminder → emotions: pride(0.5) [ARIA], joy(0.7) [LUNA], playfulness(0.4)"总算听话了" [KIRA], content(0.3) [ZEN], focus(0.5)"好" [SHIN]

C. CONTEXT EVENTS:
   event: morning_login          → emotions: excitement(0.3) [ARIA], excitement(0.7) [LUNA], playfulness(0.4) [KIRA], content(0.5) [ZEN], focus(0.5) [SHIN]
   event: late_login (>10am)     → emotions: concern(0.4) [ARIA], empathy(0.5) [LUNA], playfulness(0.5)"迟到？"[KIRA], content(0.3) [ZEN], anger(0.6) [SHIN]
   event: friday                 → emotions: playfulness(0.3) [ARIA], excitement(0.5) [LUNA], playfulness(0.7) [KIRA], content(0.6) [ZEN], focus(0.4) [SHIN]
   event: monday                 → emotions: focus(0.7) [ARIA], encourage(0.6) [LUNA], playfulness(0.3)"又是周一"[KIRA], content(0.4) [ZEN], focus(0.8) [SHIN]
   event: evening_6pm            → emotions: concern(0.4) [ARIA], encourage(0.6) [LUNA], playfulness(0.5)"加班？"[KIRA], content(0.4) [ZEN], focus(0.5) [SHIN]
   event: late_night (>10pm)     → emotions: concern(0.7)+empathy(0.5) [ARIA], empathy(0.9) [LUNA], concern(0.3)"别猝死"[KIRA], concern(0.5) [ZEN], anger(0.4)+concern(0.4) [SHIN]
   event: weekend_work           → emotions: concern(0.6) [ARIA], empathy(0.8) [LUNA], playfulness(0.4)"周末还在搞？" [KIRA], concern(0.4) [ZEN], focus(0.7) [SHIN]

D. SYSTEM EVENTS:
   event: system_idle_detected   → emotions: boredom(0.6) [ARIA], concern(0.4) [LUNA], boredom(0.7) [KIRA], content(0.5) [ZEN], anger(0.3) [SHIN]
   event: pomodoro_complete      → emotions: pride(0.5) [ARIA], joy(0.7) [LUNA], playfulness(0.4)"一个番茄！"[KIRA], content(0.4) [ZEN], focus(0.5)"继续"[SHIN]
   event: pomodoro_start         → emotions: focus(0.8) [ARIA], excitement(0.6) [LUNA], playfulness(0.3)"开始了"[KIRA], content(0.5) [ZEN], focus(0.9) [SHIN]
   event: report_generated       → emotions: pride(0.3) [ARIA], pride(0.5) [LUNA], playfulness(0.3)"看看数据"[KIRA], content(0.3) [ZEN], focus(0.4) [SHIN]
   event: app_crash_detected     → emotions: concern(0.5) [ARIA], empathy(0.7) [LUNA], playfulness(0.4)"炸了？" [KIRA], concern(0.3) [ZEN], anger(0.3) [SHIN]

EMOTION TRANSITION RULES:
- New emotion doesn't immediately replace old — it blends (see Section 1.3)
- Transition speed depends on personality:
  ARIA: 0.4s (slow, deliberate)
  LUNA: 0.2s (fast, reactive)
  KIRA: 0.3s (medium, dramatic)
  ZEN: 0.5s (very slow, gradual)
  SHIN: 0.15s (instant, commanding)
- Each transition triggers a micro-animation (expression morph + aura shift)
```

**中文精简版：**

```
4类情感触发事件：

A.工作状态事件：专注开始→兴奋+专注 / 摸鱼5min→温和 / 摸鱼30min→愤怒 / 摸鱼60min→最大干预
   任务完成→自豪(LUNA极度喜悦) / deadline→焦虑

B.交互事件：拖拽角色→惊讶+性格反应 / 点头→害羞 / 点脸→尴尬 / 拒绝提醒→愤怒 / 接受建议→自豪

C.语境事件：早晨登录→兴奋 / 周五→放松 / 周一→严肃 / 深夜→关心 / 周末工作→担忧

D.系统事件：空闲→无聊 / 番茄钟完成→自豪 / 报表生成→轻微骄傲 / 应用崩溃→关心

情感过渡速度：ARIA 0.4s慢 / LUNA 0.2s快 / KIRA 0.3s戏剧 / ZEN 0.5s渐变 / SHIN 0.15s瞬切
```

---

## 六、多模态情感表达系统

### 6.1 五通道情感表达

情感不只通过话语表达——**5个通道同时输出**：

```
Design a 5-channel emotion expression system.
Each emotion is simultaneously expressed through ALL 5 channels,
creating a cohesive emotional experience.

CHANNEL 1 — FACE EXPRESSION (cel-shaded blend shapes):
  Each emotion maps to a set of blend shape weights:
  pride:   browInnerUp=0.3, mouthSmile=0.4, cheekPuff=0.2, eyeSquint=0.2
  anger:   browInnerDown=0.8, mouthPress=0.7, jawClench=0.5, eyeWide=0.3
  concern: browInnerUp=0.5, mouthFrown=0.3, eyeWide=0.4, cheekPuff=0.1
  joy:     mouthSmile=0.8, eyeSquint=0.7, cheekPuff=0.5, browOuterUp=0.3
  anxiety: browInnerUp=0.7, eyeWide=0.6, mouthOpen=0.2, jawClench=0.3
  focus:   browInnerDown=0.3, mouthPress=0.4, eyeWide=0.2, jawClench=0.2
  boredom: eyeClose=0.5, mouthFrown=0.2, browOuterDown=0.3
  playfulness: mouthSmile=0.5 asymmetric(L>R), browOuterUp=0.3, eyeSquint=0.3

  Blended emotions → blended blend shape weights (weighted average)
  Transition: blend shapes animate over transition-speed (per personality)

CHANNEL 2 — BODY ANIMATION (skeletal animation layers):
  Each emotion adds an animation layer on top of the base state animation:
  pride:   chest-expand layer (0.3 weight), head-nod-slow layer (0.2)
  anger:   arm-cross layer (0.5), body-lean-forward layer (0.4), foot-tap layer (0.3)
  concern: body-lean-slight layer (0.2), hand-to-face layer (0.3)
  joy:     arm-spread layer (0.4), bounce-micro layer (0.3), head-tilt-happy layer (0.2)
  anxiety: body-shake-micro layer (0.4), pacing-step layer (0.3), hand-wring layer (0.2)
  focus:   posture-straight layer (0.5), hand-on-desk layer (0.3)

  Layer blending: additive layers, each with weight matching emotion weight
  When emotion changes → layer weights animate to new values

CHANNEL 3 — AURA/VFX (particle + glow effects):
  Each emotion changes:
  a) Ground ring color:
     pride → warm gold (#ffb86b, 0.25 opacity)
     anger → red (#ff7c7c, 0.35 opacity, fast pulse 0.8s)
     concern → soft blue (#7c9eff, 0.20 opacity)
     joy → pink (#ff9b8cff, 0.30 opacity, sparkle particles)
     anxiety → orange (#ff7c7c→#ffb86b alternating, 0.25, irregular pulse)
     focus → green (#6bd8a8, 0.15, steady)
     playfulness → orange (#ffb86b, 0.25, flickering)
  b) Particle effects:
     pride → 3-5 golden sparkles, slow rise
     anger → 5-8 red pulse particles, rapid
     concern → 2-3 blue dots, gentle drift
     joy → 10-15 heart/sparkle particles, moderate speed
     anxiety → 4-6 orange warning dots, erratic
     focus → 1-2 data-flow dots, calm
     playfulness → 5-8 emoji particles (≡▽≡ etc), playful
  c) Character outline glow:
     pride → thin warm outline (1px gold)
     anger → thick pulsing outline (2px red, 0.8s pulse)
     joy → soft wide outline (1.5px pink, steady)
     focus → minimal outline (0.5px green)
     anxiety → flickering outline (1.5px orange, irregular)

CHANNEL 4 — UI COLOR SHIFT (global theme accent):
  Each emotion shifts the UI's accent color and background tint:
  Current accent CSS var (--accent-current) changes:
    pride → warm-gold accent (#ffb86b)
    anger → alert-red accent (#ff7c7c)
    concern → soft-blue accent (#7c9eff)
    joy → happy-purple accent (#9b8cff)
    anxiety → urgent-orange accent (#ff964b)
    focus → productive-green accent (#6bd8a8)
    playfulness → playful-orange accent (#ffb86b, with flicker)
  
  Background tint (--bg-tint) shifts:
    pride → +5% warm overlay
    anger → +8% red overlay
    concern → +5% blue overlay
    joy → +10% purple overlay with subtle sparkle
    anxiety → +8% orange overlay
    focus → +3% green overlay
    playfulness → +5% warm overlay with flicker

  Transition: 0.3s CSS transition on all color properties

CHANNEL 5 — SPEECH (text + optional voice):
  Each emotion generates speech content based on:
  1. Current emotion type and weight
  2. Current context (work state, time, task, pattern)
  3. Personality template (speech style)
  4. Intimacy level (formality vs casualness)
  5. Emotional memory (past similar situations)

  Speech generation priority:
  1. Look up personality speech bank for emotion+context → if match found, use it
  2. If no match → AI-generate speech following personality guidelines:
     ARIA: concise, factual, data-referencing
     LUNA: warm, encouraging, emotional
     KIRA: sarcastic, meme-referencing, sharp
     ZEN: poetic, metaphorical, minimal
     SHIN: imperative, direct, no-nonsense
  3. Speech frequency gated by personality + intimacy + context:
     In deep focus → NO speech (even LUNA stays silent)
     In moderate focus → ARIA/ZEN/SHIN silent, LUNA whisper-only (tiny text bubble)
     In slack → all personalities can speak freely
     Intimacy L0 → minimal speech / L4 → frequent rich speech

  Optional VOICE output (future enhancement):
  - Use TTS with personality-configured voice:
    ARIA: calm female, medium pitch, no emotion
    LUNA: warm female, slightly higher pitch, gentle
    KIRA: sharp female, medium pitch, sarcastic tone
    ZEN: deep female, low pitch, slow cadence
    SHIN: commanding female, medium pitch, firm
  - Voice only triggers on: pomodoro transitions, important reminders, milestone events
  - User can toggle voice on/off in Settings → Audio
```

**中文精简版：**

```
5通道同步情感表达：

1.表情(Blend Shapes)：自豪→微笑+眉舒+腮红 / 愤怒→眉V皱+嘴紧+颌咬 / 担忧→眉抬+嘴微皱
   混合情感→混合blend shape权重→加权平均

2.体态(骨骼动画层)：自豪→挺胸微点头 / 愤怒→叉腰前倾跺脚 / 担忧→微前倾手托脸
   加性动画层叠加，权重匹配情感权重

3.光环/VFX：自豪→金色光环+3-5金星 / 愤怒→红色光环0.8s快脉冲+5-8红粒子 / 喜悦→粉光环+10-15心星粒子
   性格调节粒子量(LUNA最多,ZEN最少)

4.UI色调偏移：自豪→暖金accent / 愤怒→红alert / 专注→绿productive / 焦虑→橙urgent
   0.3秒CSS过渡，整个UI跟着情感变色

5.话语(文本+可选语音)：情感+语境+性格+亲密度+记忆→选择话语库或AI生成
   深度专注=完全静默 / 中度专注=低频微气泡 / 摸鱼=自由说话
   语音TTS可选：ARIA冷静女声 / LUNA温暖女声 / KIRA犀利女声 / SHIN命令女声
```

---

## 七、情景感知情感策略

### 7.1 情感策略优先级矩阵

**不是所有时候都该表达情感——场景决定策略**：

```
Design context-aware emotion strategy that determines WHEN and HOW to express emotions.

STRATEGY MATRIX — when to express / suppress / modify emotions:

| Context Priority | User State | Emotion Strategy | Example |
|-----------------|-----------|-----------------|---------|
| P0 — DEEP FOCUS | focus score >85, 20min+ | SUPPRESS ALL | Character stays in neutral-focus pose, NO speech, NO particles. Only micro-aura (green, 0.10 opacity). "Respect the deep work zone." |
| P1 — MODERATE FOCUS | focus score 60-85 | WHISPER MODE | Character: minimal expression shift, tiny text-only speech bubble (no particles, no animation change). Speech: only important reminders. |
| P2 — NORMAL WORK | focus score 40-60 | STANDARD MODE | Full 5-channel expression. Normal speech frequency. All animations active. |
| P3 — LIGHT SLACK | focus score 20-40, <15min | GENTLE NUDGE | Character: concern emotion (L2→concern 0.5), gentle suggestion speech, 20% screen overlay (if enabled). No aggressive intervention. |
| P4 — DEEP SLACK | focus score <20, >15min | ACTIVE INTERVENTION | Character: anger/concern blend, active intervention (40-50% overlay), frequent speech, standing in center of screen. |
| P5 — CRITICAL SLACK | focus score <10, >60min | MAXIMUM INTERVENTION | Character: maximum anger, 65-80% screen block, mouse dragging, urgent speech. SHIN: "全屏封锁。回工作才能解除。" |
| P6 — MEETING | meeting state detected | SILENT OBSERVATION | Character: neutral alert pose, NO speech, NO intervention. Only micro-status badge update. "Meeting mode — respect the room." |
| P7 — BREAK/REST | break state detected | RELAXED COMPANY | Character: joy/content blend, playful animations, casual chat. "休息也是工作的一部分~" (LUNA) |
| P8 — END OF DAY | after 6pm, tasks done | CELEBRATION MODE | Character: maximum joy, celebration animations, fireworks particles, "今天辛苦了！" |
| P9 — OVERWORK | after 8pm, still working | CARE MODE | Character: concern+empathy blend, gentle suggestions to stop, warm care speech. NO aggressive intervention (user is already working hard!) |
| P10 — FIRST LOGIN | morning startup | WELCOME MODE | Character: excitement+welcome, greeting speech, daily briefing. Intimacy L0: formal / L4: warm "早呀♡" |

EMOTION SUPPRESSION RULES:
- When strategy says SUPPRESS → character still HAS the internal emotion (PAD values update)
  but ALL expression channels are muted. Internal emotion continues to accumulate.
- When suppression ends → accumulated emotion releases in a controlled burst:
  e.g., user exits deep focus after 2h → character briefly shows pride(accumulated) for 1s
  then settles to appropriate post-focus emotion.
- This prevents "emotion debt" — character doesn't suddenly explode after silence.
  Instead: brief acknowledgment burst → smooth transition to new state.

URGENT OVERRIDE:
- Some events override ANY strategy:
  - Meeting reminder (5 min before) → brief alert regardless of focus level
  - System crash → brief concern regardless of focus level  
  - Pomodoro completion → brief acknowledgment regardless of focus level
  - Emergency deadline (<30min) → concern override regardless of focus level

  Override duration: 2-3s micro-bubble, then returns to strategy-defined behavior.
  Override never triggers full animation/aura shift — only text bubble + sound cue.
```

**中文精简版：**

```
10级情景情感策略矩阵：

P0深度专注(>85分20min+)→完全抑制：静默无话无粒子只有微光环
P1中度专注(60-85)→耳语模式：微小气泡文字仅重要提醒
P2正常工作(40-60)→标准模式：5通道全开
P3轻摸鱼(20-40,<15min)→温和推动：关切+温和建议+20%屏遮
P4深摸鱼(<20,>15min)→主动干预：愤怒关切混合+40-50%屏遮+站中央
P5危急摸鱼(<10,>60min)→最大干预：65-80%屏封锁+鼠标拖拽+紧急话语
P6会议中→沉默观察：无话无干预只更新状态徽标
P7休息→放松陪伴：喜悦+随性聊天+玩闹动画
P8下班→庆祝模式：最大喜悦+烟花粒子
P9加班(8pm后仍在工作)→关怀模式：关切+温和建议休息，绝不粗暴干预！
P10首次登录→欢迎模式：兴奋+每日简报

情感抑制≠情感消失——内部PAD持续更新，抑制解除后短释放1秒再过渡
紧急覆盖：会议提醒/系统崩溃/番茄钟完成/紧急deadline→2-3秒微气泡突破任何策略
```

---

## 八、情感驱动的交互内容深度设计

### 8.1 摸鱼交互 — 情感递进闭环

```
Design emotion-driven progressive interaction loops for slacking detection.
Each personality handles the same slacking event differently at each time threshold.

SLACK PROGRESSION TABLE — KIRA (毒舌型) as example (most interesting personality):

┌────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│  摸鱼时长   │  内部情感     │  话语        │  动画/行为    │  干预强度    │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│  0-5min    │  playfulness  │  "终于暴露    │  歪嘴笑+手指  │  无(观察期)  │
│            │  (0.6)        │  本性了？     │  用户         │              │
│            │              │  (≡▽≡)"      │              │              │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│  5-15min   │  concern      │  "已经15分钟  │  微皱眉+站起  │  温和气泡    │
│            │  (0.5)+       │  了，我截图发 │  来走到屏幕   │  提醒        │
│            │  playfulness  │  给老板了     │  边缘         │              │
│            │  (0.3)        │  (开玩笑)"    │              │              │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│  15-30min  │  anger        │  "30分钟了。  │  叉腰+走到屏  │  20%六角     │
│            │  (0.6)+       │  进度落后15%  │  幕中央+生成  │  网格屏障    │
│            │  concern      │  预计加班到   │  半透明遮挡   │              │
│            │  (0.4)        │  19:00        │              │              │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│  30-60min  │  anger        │  "1小时了！   │  全身愤怒+    │  40-50%屏    │
│            │  (0.8)+       │  你这是在     │  屏封锁40%+   │  封锁+鼠标   │
│            │  anxiety      │  写辞职信     │  鼠标追逐光   │  追逐        │
│            │  (0.4)        │  吧？(╬▔皿▔)" │  标           │              │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│  >60min    │  anger        │  "超过1小时。 │  危机模式全   │  65-80%屏    │
│            │  (0.9)+       │  我已经把你的 │  屏封锁65%+   │  封锁+鼠标   │
│            │  dominance    │  摸鱼记录     │  鼠标硬阻挡   │  硬阻挡摸鱼  │
│            │  (0.9)        │  做成PPT了。  │  摸鱼应用     │  应用        │
│            │              │  凸"         │              │              │
└────────────┴──────────────┴──────────────┴──────────────┴──────────────┘

INTERACTION LOOP — user responds to KIRA's intervention:

User clicks "回到工作" → 
  KIRA emotion: pride(0.3) + playfulness(0.5)
  Speech: "总算听话了。(≡▽≡)...下次别让我等这么久。"
  Animation: 歪嘴笑+手指弹回工作区+屏障消散0.5s
  → enters focus strategy

User clicks "推迟10分钟" →
  KIRA emotion: anger(0.5) + playfulness(0.3)
  Speech: "10分钟？好吧...但我会计时的。(╬▔皿▔)...计时开始。"
  Animation: 掏出隐形计时器+眉紧+10分钟后更强干预
  → reduce overlay to 10%, set 10min timer for next intervention

User clicks "忽略" →
  KIRA emotion: anger(0.7) + dominance(0.8)
  Speech: "你完了。(╬▔皿▔)凸 等我升级到全屏封锁你就后悔了。"
  Animation: 全身愤怒+overlay从40%升到50%+开始追逐鼠标
  → escalate intervention, no dismissal option for next 5min

User drags character away from screen center →
  KIRA emotion: anger(0.8) + dominance(0.9)
  Speech: "你把我拖走就能逃避了？3秒后我走回来。凸"
  Animation: 3秒后走回中央+overlay升级
  → character walks back autonomously after 3s, intervention escalates
```

### 8.2 加班关怀交互 — 情感递减闭环

**加班时角色应该关心而非催促——这和摸鱼完全相反**：

```
OVERTIME CARE LOOP — LUNA (温暖型) as example (most caring personality):

┌────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│  加班时长   │  内部情感     │  话语        │  动画/行为    │  干预类型    │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│  18:00     │  concern      │  "6点了！今天 │  温柔微笑+    │  温和气泡    │
│  (准点)    │  (0.3)+       │  做了很多了~  │  手指向时钟   │  提醒        │
│            │  encourage    │  要不要收工？"│              │              │
│            │  (0.5)        │              │              │              │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│  19:00     │  concern      │  "已经加班1h  │  担忧表情+    │  第2轮确认   │
│  (1h加班)  │  (0.5)+       │  了...进度62% │  手托腮+肩   │  不同内容    │
│            │  empathy      │  还要继续吗？ │  轻放用户     │              │
│            │  (0.4)        │  我帮你看看   │              │              │
│            │              │  还要多久~"   │              │              │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│  20:00     │  concern      │  "2小时了！   │  明显担忧+    │  强烈建议    │
│  (2h加班)  │  (0.7)+       │  你看起来很   │  轻轻拉用户   │  结束        │
│            │  empathy      │  累了...明天  │  手指向门外   │              │
│            │  (0.6)        │  继续好不好？ │              │              │
│            │              │  今晚休息吧♡" │              │              │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│  21:00+    │  concern      │  "已经很晚了  │  极度担忧+    │  紧急关怀    │
│  (3h+)     │  (0.9)+       │  ...我真的    │  角色跪坐+    │  不允许继续  │
│            │  empathy      │  担心你的健   │  双手合十     │  除非用户    │
│            │  (0.8)        │  康。请停下   │  "求你停下"   │  强制确认    │
│            │              │  来♡"        │              │              │
└────────────┴──────────────┴──────────────┴──────────────┴──────────────┘

User responses:
  "继续加班" → LUNA: concern worsens, but RESPECTS choice. "好吧...但每30分钟我提醒你休息♡"
  "结束工作" → LUNA: joy(0.8) "太好了！辛苦了今天！明天见♡(≧▽≦)"
  "还需要30分钟" → LUNA: concern(0.5) "好...30分钟后我再来确认♡"

CRITICAL: Overwork care NEVER uses screen blocking or aggressive intervention.
The user is WORKING — we CARE, not COMMAND.
Only SHIN personality would say "效率下降，建议结束" (still factual, not caring)
```

### 8.3 进度问答交互 — 情感驱动的不确定性沟通

```
PROGRESS Q&A LOOP — emotion-driven uncertainty communication:

User asks: "这个编码任务还要多久？" (via Cmd+K or clicking character)

CHARACTER RESPONSE depends on:
1. Historical data (past similar tasks: average duration, user's typical speed)
2. Current progress (how much done vs estimated total)
3. Current state (if user is focused → optimistic estimate; if slack → pessimistic)
4. Personality speech style

ARIA response (data-driven):
  "基于过去5次同类任务数据：平均耗时2.8h，你的效率系数0.85。当前进度40%，预估剩余1.7h。置信度72%。"
  → Shows data card with: past average, current progress bar, estimated completion time

LUNA response (encouraging):
  "大概还要1-2小时吧~但你今天效率特别好！一定能提前完成的♡ 加油！"
  → Shows gentle progress card with encouraging annotation

KIRA response (teasing):
  "以你现在这个摸鱼频率？3小时。别摸鱼的话？1.5小时。选一个吧。(≡▽≡)"
  → Shows TWO estimates: "如果继续摸鱼" vs "如果专注"，对比展示

ZEN response (minimal):
  "水到渠成。~ 专注时自然完成。"
  → Shows minimal progress indicator, no detailed estimate

SHIN response (demanding):
  "预估1.5h。要求1.2h完成。倒计时开始。72:00。"
  → Shows countdown timer with demanding target

FOLLOW-UP CONFIRMATION (30min after Q&A):
  After user's estimated task duration passes (or 50% of estimated time):
  Character proactively checks:

  ARIA: "编码任务进度更新？原预估1.7h，已过0.85h。请确认进度。"
  LUNA: "任务进展怎么样了？要不要我帮你看看还剩多少~♡"
  KIRA: "说了1.5h，现在已经1h了。完成了吗？没完成的话...哼(╬▔皿▔)"
  ZEN: "~" (single character, zen acknowledgment)
  SHIN: "进度报告。剩余时间？"

  User responds:
    "完成了" → pride response (per personality)
    "还需要一会儿" → concern + "还要多久？" → learn actual vs estimated delta
    "比预期难" → empathy + "要不要调整计划？" → update remaining estimate

  LEARNING LOOP:
    Each Q&A cycle records: estimated time vs actual time
    Over time, estimates become more accurate (calibrated to user's actual patterns)
    This is the "不确定性学习" mechanism — character learns user's speed patterns
```

---

## 九、情感表达3D渲染提示词

### 9.1 各情感3D渲染提示词（补充v2.0状态提示词）

#### 😊 自豪 Pride

```
A stylized low-poly cel-shaded 3D anime human avatar expressing PRIDE emotion.
Upper body 3/4 view, the character has just witnessed the user accomplish something significant.

Expression blend shapes: browInnerUp=0.3, mouthSmile=0.4, cheekPuff=0.2, eyeSquint=0.2
The eyes are slightly squinted with a warm inner glow (proud sparkle in pupils),
mouth curved in a confident satisfied smile (not overdone — restrained pride),
cheeks subtly puffed with a faint blush circle (warm achievement glow),
brows slightly lifted showing pleasant accomplishment.

Body pose: chest expanded 10%, standing tall with shoulders back — "achievement stance".
One hand might make a subtle fist-pump at 30% height (controlled celebration).
The other hand rests confidently.

Aura effects: warm golden ground ring (#ffb86b, opacity 0.25, steady pulse 3.6s),
3-5 golden sparkle particles slowly rising from the ring.
Thin warm outline glow (1px gold) around character edges.

Background: a subtle checkmark icon floating nearby, faint golden light rays from below,
achievement stars scattered gently.

Animation: slow confident nod every 3s, occasional sparkle burst from eyes (achievement flash).
Transition: smooth 0.4s expression morph from previous state.

Style: 4-level cel-shading with warm golden highlights on the pride expression areas,
slightly warmer overall color temperature (shift +5% warm), clean geometric forms.
```

**中文精简版：**

```
赛博cel-shading 3D动漫人像，自豪情感。
表情：眉微抬+自信微笑+腮红+眼微眯带自豪光泽。
姿态：挺胸10%+肩后展——"成就站姿"，一手微拳30%高度（克制庆祝）。
光环：金色(#ffb86b)稳定脉冲+3-5金星缓慢上升+1px金色轮廓光。
背景：✓图标浮动+金色光线+成就星星。
动画：3秒自信点头+偶见眼中星光闪。暖色调偏移+5%。
```

#### 😠 愤怒 Anger

```
A stylized low-poly cel-shaded 3D anime human avatar expressing ANGER emotion.
Upper body 3/4 view, the character is furious at the user's prolonged slacking.

Expression blend shapes: browInnerDown=0.8, mouthPress=0.7, jawClench=0.5, eyeWide=0.3
Eyes wide and piercing with sharp focused pupils (anger laser gaze),
mouth pressed tight showing jaw tension and determination,
brows deeply contracted creating a sharp V-shape between them (maximum furrow),
face muscles visibly tense — no softness anywhere.

Body pose: arms crossed at chest (full arm-cross, 0.8 weight),
body leaned forward 15° ( confrontational stance),
foot tapping rapidly (0.5s per tap — agitation indicator),
hands occasionally uncross to point at user accusingly.

Aura effects: red ground ring (#ff7c7c, opacity 0.35, fast pulse 0.8s),
5-8 red pulse particles emanating rapidly from ring,
thick pulsing outline glow (2px red, 0.8s pulse cycle) around character,
occasional small lightning-bolt particles from eyes.

Background: red warning triangles floating, broken chain links (broken commitment),
deadline countdown numbers glowing red, alert stripe pattern.

Animation: rapid foot tap 0.5s, occasional arm-uncross → point-at-user gesture,
head sharp turn toward user every 4s (checking if they're working),
body micro-shake every 2s (controlled fury tremor).

Transition: fast 0.15s expression snap (SHIN personality) or 0.3s dramatic build (KIRA).

Style: 4-level cel-shading with RED shadow emphasis on brow V-shape and jaw line,
+8% red overlay on entire character, harsher lighting contrast,
more defined shadows — "dramatic anger lighting".
```

**中文精简版：**

```
赛博cel-shading 3D动漫人像，愤怒情感。
表情：眉深V皱0.8+嘴紧压0.7+颌咬0.5+眼锐利0.3——愤怒激光眼。
姿态：叉腰0.8+前倾15°对抗站姿+跺脚0.5秒/拍+偶尔手指指控用户。
光环：红色(#ff7c7c)快脉冲0.8秒+5-8红色急速粒子+2px红色脉冲轮廓+偶见眼射闪电粒子。
背景：红色警告三角+断裂链环+deadline倒计时红字+警报条纹。
动画：跺脚0.5秒+叉腰→指用户手势+4秒猛转头+2秒身体微颤（控制怒震）。
+8%红色叠加+更硬对比阴影。
```

#### 😟 担忧 Concern

```
A stylized low-poly cel-shaded 3D anime human avatar expressing CONCERN emotion.
Upper body 3/4 view, the character is worried about the user's progress or wellbeing.

Expression blend shapes: browInnerUp=0.5, mouthFrown=0.3, eyeWide=0.4, cheekPuff=0.1
Eyes slightly widened showing attentive worry (not fear — caring concern),
mouth with a subtle downward curve (gentle frown, not despair),
brows lifted inward creating soft concern arches (not sharp V like anger),
cheeks very slightly puffed (empathetic warmth beneath the worry).

Body pose: body leaned forward 5° (attentive, wanting to help),
one hand near face (touching cheek or chin — "what can I do?" gesture),
other hand extended slightly toward user (reaching to help),
shoulders slightly hunched (protective posture).

Aura effects: soft blue ground ring (#7c9eff, opacity 0.20, gentle 3s pulse),
2-3 blue dot particles drifting gently upward,
minimal outline glow (0.8px soft blue, steady).

Background: a small heart icon with a question mark, faint clock showing deadline time,
gentle blue gradient overlay suggesting calm but worried atmosphere.

Animation: hand-to-face gesture every 4s, occasional slow head tilt (listening/observing),
subtle lean-in when checking user's screen (curious concern).

Transition: 0.3s smooth morph, gentle build-up.

Style: 4-level cel-shading with COOL blue shadow emphasis on brow concern arches,
+5% blue overlay, softer lighting (reduced contrast — gentler mood),
slightly diffused edges on shadow boundaries (worried softness).
```

#### 😍 喜悦 Joy

```
A stylized low-poly cel-shaded 3D anime human avatar expressing JOY emotion.
Upper body 3/4 view, the character is genuinely happy — task completed, Friday afternoon, etc.

Expression blend shapes: mouthSmile=0.8, eyeSquint=0.7, cheekPuff=0.5, browOuterUp=0.3
Eyes fully crinkled in upward-arc curves (big happy squint — can't see pupils, pure joy),
mouth wide upward-curve smile (teeth barely visible at peak — genuine happiness),
cheeks prominently puffed with bright blush circles (warm radiating joy),
brows slightly raised adding to the open happy expression.

Body pose: arms spread slightly (0.4 weight — open joyful stance),
micro bounce every 2s (body rises 3px, settles — happy energy),
head tilted 5° to one side with rhythmic bop (musical joy),
hands occasionally clapping together (2 claps every 8s).

Aura effects: purple-pink ground ring (#9b8cff, opacity 0.30, steady with sparkle accents),
10-15 heart-shaped and sparkle particles floating gently around,
soft wide outline glow (1.5px pink, steady).

Background: floating celebration elements — stars, small fireworks bursts,
confetti-like tiny colored squares falling slowly,
warm ambient glow suggesting festive atmosphere.

Animation: rhythmic head bop 1.2s, arm spread → clap cycle 8s,
occasional full-body micro-bounce (joy overflow),
sparkle burst from cheeks every 6s.

Transition: fast 0.2s — joy is quick to appear (especially LUNA).

Style: 4-level cel-shading with PINK-PURPLE highlight emphasis on cheeks and smile,
+10% purple overlay with subtle sparkle texture,
warmest overall color temperature, softest shadow edges (happy softness).
```

#### 😰 焦虑 Anxiety

```
A stylized low-poly cel-shaded 3D anime human avatar expressing ANXIETY emotion.
Upper body 3/4 view, deadline approaching, time running out.

Expression blend shapes: browInnerUp=0.7, eyeWide=0.6, mouthOpen=0.2, jawClench=0.3
Eyes wide with visible darting pupil movement (scanning for solutions),
brows lifted high creating worried arches (urgent concern),
mouth slightly open (breathing faster — anxiety breathing indicator),
jaw slightly clenched (tension beneath the worry).

Body pose: body micro-shake (0.5s tremor cycle — anxiety vibration),
pacing animation: small step left → pause → step right (2s cycle),
hands wringing together in front of chest (0.3 weight — nervous gesture),
or one hand gripping other wrist (self-soothing attempt).

Aura effects: orange-amber ground ring (#ff964b, alternating with #ffb86b, opacity 0.25),
IRREGULAR pulse pattern (0.6s-1.5s variable — anxiety irregularity),
4-6 orange warning dot particles moving ERRATICALLY (not smooth — chaotic),
flickering outline glow (1.5px orange, irregular pulse).

Background: deadline countdown numbers accelerating, red-yellow gradient urgency overlay,
broken timeline segments (plan vs actual divergence),
small warning exclamation marks floating.

Animation: body tremor 0.5s, pacing left-right 2s, hand-wringing 1.5s,
pupil darting animation (eyes look left-right rapidly every 1s),
occasional deep-breath attempt (chest expands → hold → release, 4s).

Transition: 0.3s (ARIA) or 0.15s (SHIN — instant anxiety shift).

Style: 4-level cel-shading with ORANGE shadow emphasis on brow worry arches,
+8% orange overlay, slightly harsher contrast (anxiety sharpness),
more defined shadow boundaries (no soft edges — anxiety is sharp).
```

#### 😏 调皮 Playfulness

```
A stylized low-poly cel-shaded 3D anime human avatar expressing PLAYFULNESS emotion.
Upper body 3/4 view, the character is teasing or joking — KIRA's signature state.

Expression blend shapes: mouthSmile=0.5 asymmetric (L>R), browOuterUp=0.3, eyeSquint=0.3
Mouth curved in an ASYMMETRIC smirk (left side higher — signature KIRA expression),
one brow raised higher than the other (scheming expression),
eyes half-squinted with a mischievous sparkle (knowing look),
one eye might have a slightly larger iris (playful asymmetry).

Body pose: body tilted 5° with a casual lean (not standing straight — too cool for that),
one hand making a finger-gun gesture pointing at user (0.4 weight),
other hand resting casually (not tense — relaxed mockery),
head tilted 8° matching the smirk (confident teasing).

Aura effects: warm orange ground ring (#ffb86b, opacity 0.25, FLICKERING irregularly),
5-8 emoji-shaped particles (≡▽≡, (╬▔皿▔), 凸, ♡) floating playfully,
outline glow with occasional flicker (1px orange, flicker 0.5s).

Background: floating meme symbols, small joke text bubbles ("就这？"),
dynamic gradient that shifts between warm and cool (playful color play),
occasional small explosion emoji (💥) when landing a good roast.

Animation: finger-gun → wiggle gesture every 3s,
head tilt oscillating left-right 4s (playful sway),
body casual bounce 1.5s (too-cool-for-school energy),
smirk intensification every 5s (building up to the next roast).

Transition: 0.3s dramatic build (KIRA signature).

Style: 4-level cel-shading with warm-cool CONTRAST (warm highlights, cool shadows — playfulness is unpredictable),
+5% warm overlay with FLICKER effect, 
shadow boundaries intentionally slightly inconsistent (playful chaos).
```

#### 💞 共情 Empathy

```
A stylized low-poly cel-shaded 3D anime human avatar expressing EMPATHY emotion.
Upper body 3/4 view, the character senses the user is struggling and offers comfort.

Expression blend shapes: eyes=soft round (0.4 wide, gentle pupils), mouth=gentle smile(0.3), cheeks=soft blush(0.2)
Eyes soft and round with warm gentle pupils (not intense — receptive),
mouth in a gentle understanding smile (not big — subtle warmth),
cheeks with soft warmth blush (empathetic warmth),
face completely relaxed — no brow tension (open and accepting).

Body pose: one hand reaching toward user gently (offering comfort, 0.3 weight),
other hand on own chest (feeling with you, 0.2 weight),
shoulders dropped and relaxed (no confrontation — pure support),
body slightly turned toward user (facing them, giving attention).

Aura effects: warm pink-lavender ground ring (#9b8cff→#ffb86b blend, opacity 0.20, slow 4s pulse),
3-5 small heart-shaped particles drifting gently toward user direction,
soft outline glow (1px warm lavender, steady).

Background: gentle warm ambient glow, small supportive icons (hand reaching, heart, blanket),
soft gradient suggesting safety and acceptance,
no harsh elements — pure comfort atmosphere.

Animation: gentle hand-reaching gesture every 5s, slow breathing cycle 3.6s,
occasional soft nod (I understand, 4s),
hand-on-chest pulse (feeling empathy physically, 6s).

Transition: slow 0.5s gentle build (empathy doesn't rush).

Style: 4-level cel-shading with WARM PINK highlight emphasis on cheeks and smile,
+5% warm overlay, softest shadow edges (empathy is gentle),
reduced contrast overall (comfort reduces visual tension).
```

---

## 十、情感系统数据架构

### 10.1 情感引擎数据模型

```
// Emotion Engine Core Data Model

interface EmotionState {
  // PAD三维坐标
  pleasure: number;     // 0-100
  arousal: number;      // 0-100
  dominance: number;    // 0-100
  
  // 当前活跃情感列表（最多3种）
  activeEmotions: {
    type: EmotionType;  // pride|anger|concern|joy|anxiety|focus|boredom|playfulness|empathy|excitement
    weight: number;     // 0-1
    trigger: string;    // 触发事件ID
    timestamp: number;  // 触发时间戳
    decayFactor: number;// 衰减系数（per personality）
  }[];
  
  // 情感策略
  strategy: EmotionStrategy; // P0-P10
  
  // 表达通道权重
  channels: {
    face: number;       // 0-1 (blend shape intensity)
    body: number;       // 0-1 (animation layer weight)
    aura: number;       // 0-1 (particle/glow intensity)
    ui: number;         // 0-1 (color shift intensity)
    speech: number;     // 0-1 (speech frequency/visibility)
  };
}

interface EmotionMemory {
  episodic: {
    date: string;
    event: string;
    userEmotion: PAD;
    characterEmotion: PAD;
    characterResponse: string;
    userReaction: 'acknowledged'|'dismissed'|'ignored';
    context: EventContext;
    intimacyDelta: number;
  }[];
  
  patterns: {
    name: string;         // e.g. "friday_afternoon_slack"
    frequency: number;    // 0-1
    bestIntervention: string;
    confidence: number;   // 0-1
    learnedAt: string;    // intimacy level when pattern was learned
  }[];
  
  milestones: {
    type: 'anniversary'|'first_completion'|'first_interaction'|'score_milestone';
    date: string;
    description: string;
    characterSpeech: string;
    userResponse: string;
  }[];
}

interface RelationshipState {
  intimacyScore: number;    // 0-∞
  intimacyLevel: number;    // 0-4
  daysTogether: number;
  totalInteractions: number;
  patternConfidence: number; // how well character knows user (0-1)
  lastMilestone: string;
  nextMilestone: string;
}

// 情感引擎更新循环
function updateEmotionEngine(deltaMs: number) {
  // 1. 衰减当前情感权重
  for (emotion of state.activeEmotions) {
    emotion.weight *= Math.pow(emotion.decayFactor, deltaMs / 1000);
    if (emotion.weight < 0.05) removeEmotion(emotion);  // 清除微弱情感
  }
  
  // 2. 检查新触发事件
  const newTriggers = detectTriggerEvents();
  for (trigger of newTriggers) {
    const targetEmotion = mapTriggerToEmotion(trigger, personality);
    addOrBlendEmotion(targetEmotion);
  }
  
  // 3. 情感共振——随用户状态微调PAD
  const userStateInference = inferUserEmotionFromWorkState();
  adjustPADForResonance(userStateInference, personality);
  
  // 4. 情感混合——加权平均PAD
  const blendedPAD = blendActiveEmotions();
  
  // 5. 确定当前策略
  const strategy = determineStrategy(currentWorkState, blendedPAD);
  
  // 6. 计算表达通道权重（根据策略抑制/释放）
  const channelWeights = calculateChannelWeights(strategy, blendedPAD);
  
  // 7. 输出到5个表达通道
  outputToFaceChannel(blendedPAD, channelWeights.face);
  outputToBodyChannel(blendedPAD, channelWeights.body);
  outputToAuraChannel(blendedPAD, channelWeights.aura);
  outputToUIChannel(blendedPAD, channelWeights.ui);
  outputToSpeechChannel(blendedPAD, channelWeights.speech, context, memory);
  
  // 8. 记录到情感记忆
  if (significantEvent) recordEmotionMemory();
}
```

---

## 十一、情感系统实施优先级

| 优先级 | 功能模块 | 实施阶段 | 说明 |
|--------|---------|---------|------|
| **P0** | PAD情感引擎核心 | Phase 1 | 情感坐标系统+衰减+混合，这是地基 |
| **P0** | 10种基础情感→表情映射 | Phase 1 | Blend Shape映射表，3D渲染必须有 |
| **P0** | 性格偏移系数 | Phase 1 | 5性格的P/A/D偏移参数 |
| **P0** | 情感→光环/VFX映射 | Phase 1 | 粒子颜色+光环色+脉冲节奏 |
| **P1** | 情感→UI色调偏移 | Phase 2 | CSS变量随情感动态变化 |
| **P1** | 情感→话语库映射 | Phase 2 | 每性格每情感的话语集合 |
| **P1** | 情感策略矩阵(P0-P10) | Phase 2 | 专注时抑制/摸鱼时释放的规则引擎 |
| **P1** | 摸鱼递进闭环 | Phase 2 | 时间阈值→情感递进→干预递进→用户回应 |
| **P2** | 关系亲密度系统 | Phase 3 | 5级进化+积分+里程碑 |
| **P2** | 事件情感记忆 | Phase 3 | 过去事件引用+模式学习 |
| **P2** | 加班关怀闭环 | Phase 3 | 与摸鱼完全相反的温柔递进 |
| **P2** | 进度问答不确定性学习 | Phase 3 | 预估→确认→偏差学习闭环 |
| **P3** | 复合情感混合渲染 | Phase 4 | 3种情感同时叠加的视觉表达 |
| **P3** | 情感记忆→行为影响 | Phase 4 | 过去经验影响当前话语选择 |
| **P3** | 可选语音TTS | Phase 4 | 5性格对应5种声音 |
| **P3** | 摄像头表情共振（可选） | Phase 5 | 用户面部→角色情感二级输入源 |

---

## 十二、情感系统3D渲染提示词总索引

| 情感 | 英文提示词位置 | 中文提示词位置 | 关键视觉特征 |
|------|--------------|--------------|------------|
| 自豪 pride | §9.1 英文段 | §9.1 中文段 | 金光环+金星+挺胸+自信微笑 |
| 愤怒 anger | §9.1 英文段 | §9.1 中文段 | 红光环快脉冲+叉腰+眉V皱+闪电粒子 |
| 担忧 concern | §9.1 英文段 | §9.1 中文段 | 蓝光环+手托脸+眉弓抬+蓝点粒子 |
| 喜悦 joy | §9.1 英文段 | §9.1 中文段 | 粉光环+心星粒子+大弧笑+弹跳 |
| 焦虑 anxiety | §9.1 英文段 | §9.1 中文段 | 橙光环不规则脉冲+身体微颤+瞳孔闪烁 |
| 专注 focus | v2.0 §状态1 | v2.0 §状态1 | 绿光环+平视凝望+端正姿态+数据粒子 |
| 无聊 boredom | v2.0 §状态2(摸鱼) | v2.0 §状态2 | 暖橙光环闪烁+半闭眼+懒散 |
| 调皮 playfulness | §9.1 英文段 | §9.1 中文段 | 橙光环闪烁+歪嘴笑+手指枪+emoji粒子 |
| 共情 empathy | §9.1 英文段 | §9.1 中文段 | 粉蓝光环+伸手+柔眼+心粒子飘向用户 |
| 兴奋 excitement | §9.1 pride×joy混合 | §9.1 混合 | 金+粉混合光环+大眼+手举高+星爆粒子 |

---

> **v2.4 与 v2.0-v2.3 的关系**：
> - v2.0 定义了30种工作状态的3D渲染提示词 → v2.4新增7种情感状态的独立3D渲染提示词
> - v2.1 定义了5性格模板+拖拽交互 → v2.4为5性格增加了情感偏移系数和差异化表达矩阵
> - v2.2 定义了报表/规划/日历UI → v2.4增加了情感驱动的UI色调动态偏移
> - v2.3 定义了产品流程和导航 → v2.4增加了情景感知情感策略矩阵(10级优先级)
> - v2.4 是情感层——它叠加在所有之上，让每个页面、每个交互、每个动画都带上情感温度

**输出文件：`workon-design-spec-v2.4-emotion-system.md`**
