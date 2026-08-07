# WorkOn 设计规格补充 v2.1 — 交互升级 & 监控驱动闭环

> 补充 v2.0 规格书，聚焦：3D建模品质、多角色选择、拖拽交互、点击反馈、
> 高端产品参考、监控数据驱动智能交互闭环

---

## 一、高端虚拟人交互设计参考

### 1.1 参考产品分析

| 产品 | 核心交互亮点 | 可借鉴特性 |
|------|-------------|----------|
| **Desktop Mate** (Steam, 2025) | 3D角色坐窗口边缘、窗口间跳跃、鼠标追逐/手跟随、闹钟联动 | 窗口物理交互（坐/跳/靠）、鼠标追逐/挥开光标、平台化多角色DLC、闹钟-角色联动 |
| **Desktop Mate 2B DLC** (2025) | 2B用手挥开鼠标光标、点击"提起"角色时POD 042协助抬起、服装切换互动触发 | 用手挥开光标（与我们的Level 2互补）、提起角色由辅助物帮忙（可做：角色被拖拽时飘浮辅助特效）、服装变化触发 |
| **Gatebox3** (2026众筹) | OLED全息胶囊、AI伙伴逢妻Hikari生活陪伴、70+表情动作、VRM自定义角色导入、遥控家电 | 生活场景联动（欢迎回家/早安提醒）、VRM模型导入自定义角色、70+动作库、角色-家电控制联动 |
| **雷蛇Project AVA** (CES 2026) | 5.5寸全息胶囊、5种性格角色(AVA/KIRA/ZANE/FAKER/SAO)、多模态感知(看用户+看屏幕)、动态个性学习进化 | 多性格角色选择（不同人格模板）、看用户表情+看屏幕内容双感知、个性随互动进化 |
| **数伴Dipal D1** (WAIC 2026) | 裸眼3D曲面全息、情绪识别共振、指尖碰触反馈、长期记忆机制 | 指尖碰触→语言+动作双反馈、情绪共振（用户低落→角色安抚模式）、长期记忆（角色记住细节） |

### 1.2 WorkOn 应借鉴的核心交互范式

从以上5款产品提炼，WorkOn应实现：

| 借鉴特性 | 来源产品 | WorkOn实现方式 |
|---------|---------|--------------|
| 窗口边缘坐/靠 | Desktop Mate | 角色坐在桌面窗口顶部边缘（休息态），或靠在widget窗口旁 |
| 鼠标追逐/挥开 | Desktop Mate 2B | 摸鱼时角色追逐光标→Level 2戳光标；专注时角色挥手赶光标走"别打扰我" |
| 提起拖拽+辅助特效 | Desktop Mate 2B | 用户拖拽角色→角色飘浮+能量辅助光环托起（不是僵硬平移） |
| 多性格角色选择 | Project AVA | 5种性格模板：专注型/温暖型/毒舌型/佛系型/严厉型 |
| VRM模型导入 | Gatebox3 | 支持VRM格式3D模型导入，用户可自定义角色外观 |
| 70+表情动作库 | Gatebox3 | 骨骼动画库：50+基础动作+20+状态动作+10+互动动作 |
| 看用户+看屏幕双感知 | Project AVA | 通过监控引擎感知屏幕内容+通过摄像头感知用户表情 |
| 情绪共振 | Dipal D1 | 用户连续低效→角色表情渐变关心→安抚模式 |
| 指尖碰触反馈 | Dipal D1 | 点击角色不同部位→不同反应（头=害羞，手=握手，肩=拍肩鼓励） |
| 长期记忆 | Dipal D1 | 记住用户习惯（几点上班/几点爱摸鱼/哪个app最常切出）→个性化提醒 |
| 生活场景联动 | Gatebox | "早安提醒"、"下班提醒"、"天气建议"、"晚餐建议" |

---

## 二、3D建模品质保障 — 高质量多角色系统

### 2.1 3D建模质量标准

```
Design HIGH-QUALITY 3D character models for a desktop virtual companion app.
The visual quality must be comparable to Desktop Mate on Steam (2025) which uses
professional-grade anime character models with natural movement.

QUALITY BENCHMARKS (based on Desktop Mate / Gatebox3 analysis):
- Poly count: 8000-15000 tris per character (higher than v2.0's 3000-5000 for better visual)
- Texture resolution: 1024×1024 per character atlas (higher detail)
- Normal map: YES — subtle fabric wrinkles on clothes, hair strand definition
- Toon shader: 4-level cel-shading (instead of 2-3) for richer light/dark separation
  Levels: highlight (brightest), base (normal color), shadow1 (dark shade), shadow2 (deep shadow)
  Threshold mapping: smooth areas use 3 levels, sharp areas use all 4
- Outline: variable-width outline (1.2px body, 2px face features, 0.8px fine details like fingers)
  Outline color: not pure black — use dark variant of adjacent surface color (more anime-authentic)
- Eye rendering: separate dedicated shader for eyes:
  Iris: 6-layer rendering (outline → iris base → iris gradient → iris pattern → highlight → specular)
  Iris patterns: 5 variants per skin (round/spiral/starburst/complex/gradient)
  Eye white: subtle blue tint (not pure white, more anime-realistic)
  Eyelashes: rendered as geometry strips with tapered alpha (not just lines)
- Hair rendering: multi-layer hair shader:
  Base layer: hair mass with gradient (roots darker, tips lighter)
  Highlight layer: specular band along hair flow direction (anime hair highlight stripe)
  Strand layer: individual strand wisps at edges (alpha-blended geometry)
  Hair physics: 3-bone chain per hair section (spring-based, responds to head movement + wind)
- Clothing detail: 
  T-shirt: subtle wrinkle normal map at shoulders and elbows
  Collar: visible collar edge geometry
  Logo: tiny embroidered logo texture (not flat print — has slight bump)
- Skin: subsurface scattering approximation:
  Light areas: base skin color
  Shadow transition: slightly reddish tint (skin SSS in shadow areas)
  Deep shadow: warm dark tone (not pure dark gray)
```

### 2.2 五种性格角色模板

参考雷蛇Project AVA的5种角色性格，设计WorkOn的5种性格模板：

```
Design 5 personality templates for desktop virtual companion characters.
Each template defines the character's personality, speech style, interaction tone,
and intervention approach. The user can select their preferred personality at setup.

PERSONALITY 1 — "专注型·ARIA" (Focus Type)
Visual: Silver-purple hair, thin-frame glasses, calm composed expression
Personality: Professional, calm, efficient. Rarely emotional. Values productivity.
Speech style: Concise, factual, no filler. "专注"、"效率"、"进度" keywords.
Interaction tone: Minimal interruptions, only intervenes when truly needed.
Intervention approach: Data-driven — "当前专注度85%，继续保持" or
  "专注度降至40%，建议切换任务" — speaks in metrics, not emotions.
Pro: 最少打扰，适合需要安静专注的用户
Con: 缺乏情感温度，可能感觉冷漠

PERSONALITY 2 — "温暖型·LUNA" (Warm Type)
Visual: Long pink hair, cat-ear hair clip, soft round eyes, gentle smile default
Personality: Caring, empathetic, encouraging. Like a supportive friend.
Speech style: Warm, encouraging, uses "一起"、"加油"、"没关系" keywords.
Interaction tone: Frequent gentle check-ins. "要不要喝杯水？"、"休息一下也很好~"
Intervention approach: Care-driven — "你看起来有点累了，休息5分钟？" or
  "我知道deadline紧张，但健康更重要~" — emotional appeal, not force.
Pro: 最有陪伴感，适合容易焦虑的用户
Con: 可能过于温柔导致摸鱼时不够强硬

PERSONALITY 3 — "毒舌型·KIRA" (Sharp Type)
Visual: Short spiky red-orange hair, sharp eyes, smirk default expression
Personality: Sarcastic, witty, sharp-tongued. Cares underneath but won't admit it.
Speech style: Teasing, sarcastic, meme-referencing. "就这？"、"你在摸鱼吧我看到了"
Interaction tone: Roasts you when slacking, celebrates with "还行吧(≡▽≡)" when you succeed
Intervention approach: Shame-driven — "已经摸了40分钟了，我截图发给老板了（开玩笑）" or
  "你的代码质量跟你的摸鱼时间成正比——都越来越差了" — humor + shame.
Pro: 有趣好玩，摸鱼提醒最有效（被嘲讽比被关心更有效）
Con: 可能让敏感用户不舒服，需要tunable "毒舌程度"

PERSONALITY 4 — "佛系型·ZEN" (Zen Type)
Visual: Long straight dark-green hair, closed-eyes smile, monk-like calm
Personality: Chill, accepting, philosophical. "顺其自然" approach.
Speech style: Poetic, metaphorical, zen-like. "水到渠成"、"急什么"
Interaction tone: Rarely intervenes. When you slack: "休息也是修行~"
Intervention approach: Gentle suggestion only. No barriers. "觉得准备好了就继续吧"
Pro: 完全不打扰，适合自主性强的用户
Con: 摸鱼时几乎不干预，可能不适合需要督促的用户

PERSONALITY 5 — "严厉型·SHIN" (Strict Type)
Visual: Short black hair, sharp rectangular glasses, stern expression default
Personality: Disciplined, demanding, results-oriented. Like a strict manager.
Speech style: Direct, imperative, no negotiation. "现在工作"、"进度不够"、"加快"
Interaction tone: Frequent check-ins with demands. "5分钟后我检查进度"
Intervention approach: Force-driven — early barriers, strong blocking, no dismiss.
  "摸鱼超过10分钟已经触发专注屏障。回工作才能解除。"
Pro: 最强专注督促，适合deadline紧迫时
Con: 可能压力大，不适合长期使用，建议作为"临时切换"选项

PERSONALITY SELECTOR UI:
At first setup or in Settings → Characters → Personality:
  5 cards displayed side-by-side, each showing:
  - Character mini-avatar (48px) with default expression
  - Name + type label
  - One-line personality tagline
  - "试听" button → plays 3 sample speech lines for that personality
  User clicks to select → character model + speech bank + intervention config all switch
```

**中文精简版：**

```
5种性格角色模板：

1. 专注型·ARIA：银紫短发眼镜、冷静专业、数据驱动提醒("专注度85%继续保持")、最少打扰
2. 温暖型·LUNA：粉长发猫耳夹、温柔鼓励("要不要喝杯水？")、情感驱动干预
3. 毒舌型·KIRA：红橙短发刺、嘲讽犀利("就这？你在摸鱼吧我看到了")、羞耻驱动干预——最有意思！
4. 佛系型·ZEN：深绿长发闭眼微笑、"顺其自然"、几乎不干预
5. 严厉型·SHIN：黑短发方眼镜、铁面命令("现在工作")、最强屏障干预——适合deadline紧急

性格选择器UI：5卡片并排，48px头像+标签+试听按钮(播放3句样本台词)
选择后：角色模型+话语库+干预配置全部切换
```

### 2.3 角色选择系统架构

```
Implement a multi-character selection and management system for WorkMate.

CHARACTER DATA MODEL:
interface CharacterConfig {
  id: string                    // 'aria-focus' | 'luna-warm' | 'kira-sharp' | 'zen-chill' | 'shin-strict'
  name: string                  // 显示名
  personality: PersonalityType  // focus | warm | sharp | chill | strict
  modelPath: string             // VRM/GLB model file path or built-in model ID
  skinVariant: SkinVariant      // aria | luna | leo | custom
  speechBank: SpeechBank        // 话语库（按场景分类）
  interventionConfig: InterventionConfig  // 干干预配置（阈值、语气、屏障样式）
  animations: AnimationSet      // 动画集引用
  customModel?: VRMModel        // VRM自定义模型（用户导入）
}

CHARACTER STORE (Zustand):
- currentCharacter: CharacterConfig  // 当前选中角色
- characterList: CharacterConfig[]   // 可选角色列表（5内置 + 用户导入）
- personalityTunable: {              // 可调参数
    sharpness: 0-100,    // 毒舌程度（影响话语选择）
    warmth: 0-100,       // 温暖程度
    interventionLevel: 0-4,  // 干预强度（0=不干预，4=最强）
    speechFrequency: 0-100, // 话语频率（多少秒触发一次）
  }

CHARACTER SWITCHING:
- Settings → Characters → 选择新角色 →
  1. 当前角色做"退出"动画（挥手/鞠躬/转身离开）
  2. 2秒淡出过渡
  3. 新角色做"登场"动画（从屏幕边缘走入/挥手打招呼/鞠躬入场）
  4. 新角色性格标签line: "你好，我是XX，接下来的工作一起加油吧！"
  5. 所有后续交互切换到新角色的speechBank和interventionConfig

VRM MODEL IMPORT:
- Support VRM format (standard for 3D anime avatars, used by Gatebox3/VRoid)
- Import path: Settings → Characters → "导入自定义角色" → file picker → .vrm file
- VRM parser: use @pixiv/three-vrm library to load VRM models into Three.js scene
- Auto-configuration: VRM model inherits selected personality template
  (visual is custom, but speech/intervention/animation mapping uses template)
- VRM model requirements:
  * Must have humanoid bone mapping (VRM standard)
  * Must have expression blend shapes (VRM standard: happy, angry, sad, surprised, etc.)
  * Recommended poly count: <15000 tris for desktop performance
  * Textures: <2048×2048 total

SKIN VARIANT OVERLAY:
- Each built-in character has 3 skin variants (aria/luna/leo colors)
- Skin variant = color palette swap on same model (no geometry change)
- Custom VRM models use their own colors (no skin swap)
- Future: add custom color picker for each model (user can tint hair/clothes/eyes)
```

---

## 三、拖拽交互系统 — 物理感拽起角色

### 3.1 拖拽系统设计

```
Design a physics-feel drag-and-toss interaction system for the virtual character.

The character should feel like a physical object when dragged — not a stiff icon.
This is inspired by Desktop Mate's "lift" interaction (2B DLC uses POD 042 to assist lifting).

DRAG MECHANICS:
When user clicks and holds on the character:
1. DETECTION: mousedown event on character overlay area (only when overlay is NOT in click-through mode)
   - Check if click position overlaps with character sprite bounds (200×200px area)
   - If yes → enter DRAG MODE

2. LIFT ANIMATION (0.5s):
   - Character expression changes to "surprise" (eyes widen, mouth opens) — "被拽起来了！"
   - Character body rises up from current position (float up 30px)
   - An energy/glow ring appears UNDER the character — like a hover cushion
   - Character's legs dangle (if visible) — physics-based leg swing animation
   - Small sparkle particles emanate from the energy ring
   - Speech bubble based on personality:
     ARIA: "移位中。" (calm)
     LUNA: "哇！要带我去哪里？" (excited)
     KIRA: "放我下来！(╬▔皿▔)" (annoyed)
     ZEN: "随缘移动~" (chill)
     SHIN: "未经批准不得移动！" (strict)

3. DRAG STATE (held):
   - Character follows mouse cursor position with slight delay (0.1s lag — feels like weight)
   - Character rotates slightly toward movement direction (5-10° tilt)
   - Hair physics responds to movement direction (hair trails behind)
   - Energy ring follows underneath, expanding slightly when moving fast
   - The character's expression stays "surprise" but occasionally changes:
     Every 5s held: personality-specific comment
     ARIA: "..." (silent tolerance)
     LUNA: "好高啊~像飞一样！" (enjoying it)
     KIRA: "你手不酸吗？放我下来！" (demanding)
     ZEN: "高处亦是修行" (philosophical)
     SHIN: "浪费时间！" (scolding)
   - If dragged near screen edge → character "clings" to edge with hand-grab animation
   - If dragged over a window → character "lands" on window top edge (sits there)

4. RELEASE / DROP:
   - When user releases mouse (mouseup):
   a) SHORT DROP (<50px from original position):
      - Character gently floats down with energy ring fading
      - Settles back to standing position with a small landing animation
      - Expression: relief, speech: "安全着陆 ✓"
   b) MEDIUM DROP (50-200px from original):
      - Character drops with slight bounce animation (hits surface, bounces up 5px, settles)
      - Expression: slight surprise, speech: personality-specific landing comment
      - Landing ripple effect: small circular wave emanating from landing point
   c) TOSS (>200px distance or fast release velocity):
      - Character flies through the air with momentum animation
      - Body tumbles slightly (1-2 rotations if really fast toss)
      - Lands at release position with a bigger bounce (2 bounce cycles)
      - Landing impact: bigger ripple + 3 sparkle particles
      - Expression: shocked → then recovers
      - Speech:
        ARIA: "着陆坐标已更新。" (cool)
        LUNA: "啊啊啊！好刺激！再来一次！" (excited)
        KIRA: "你完了！等我起来你就完了！(╬▔皿▔)凸" (furious)
        ZEN: "跌倒亦是悟道的一步" (zen)
        SHIN: "无纪律行为已记录！" (strict)
      - After landing: 3s recovery animation → character shakes off dust → resumes normal state

5. SPECIAL DROP ZONES:
   - Drop on desk area → character sits at desk, enters work pose
   - Drop on corner → character curls up, enters idle pose
   - Drop on center → character stands center, intervention-ready pose
   - Drop near widget → character leans on widget window edge

CLICK-THROUGH COORDINATION:
- Normal state: overlay is click-through (setIgnoreMouseEvents(true))
- When character is in intervention blocking mode: overlay is NOT click-through
- To enable drag: add a thin "interaction strip" at the top of the overlay (20px height)
  that is always NOT click-through — this allows user to grab the character anytime
  without making the entire overlay blocking
- Alternative: double-click on widget's character card → toggles drag mode for 5s
```

**中文精简版：**

```
拖拽交互系统设计——物理感拽起角色。

1. 检测：鼠标按下在角色区域→进入拖拽模式

2. 提起动画(0.5秒)：
   角色表情变"惊讶"(眼睁嘴开)
   身体浮起30px
   底下出现能量光环（悬浮托垫）
   腿悬挂摆动（物理弹簧）
   火花粒子从光环发出
   话语："哇！要带我去哪里？"(LUNA) / "放我下来！"(KIRA) 等

3. 拖拽持续态：
   角色跟随鼠标0.1秒延迟（重量感）
   身体向移动方向微倾斜5-10°
   头发物理响应（头发随动方向拖后）
   每5秒性格话语：
   LUNA"好高啊~像飞一样！" / KIRA"你手不酸吗？放我下来！"
   拖到屏幕边缘→角色"攀附"边缘手抓动画
   拖过窗口→角色"降落"在窗口顶部坐着

4. 释放/抛掷：
   a) 短落(<50px)：轻柔下降→光环淡出→安全着陆"安全着陆 ✓"
   b) 中落(50-200px)：弹跳着陆(落地反弹5px)→涟漪效果
   c) 抛掷(>200px/快释放)：飞行动量→翻滚1-2圈→大弹跳→涟漪+火花
      LUNA"好刺激！再来一次！" / KIRA"你完了！(╬▔皿▔)凸"
      3秒恢复动画→角色抖落灰尘→恢复正常态

5. 特殊落点：
   桌面区→坐桌进入工作姿态
   角落→蜷缩进入空闲态
   中央→站中央进入干预待命姿态
   widget旁→靠widget边缘

交互条设计：overlay顶部20px交互条始终可点击（不穿透），让用户随时能抓住角色
```

---

## 四、点击交互反馈系统 — 身体部位分区响应

### 4.1 触碰区域分区

```
Design a body-part-specific click interaction system for the virtual character.
Inspired by Dipal D1's "fingertip touch → verbal + action dual feedback" concept.

CHARACTER HITBOX MAP (200×200px sprite area divided into zones):

┌──────────────────────────────────┐
│  Zone A: HEAD (top 35%)          │
│  ├─ A1: Hair (top 10%)           │ 点击头发→角色整理头发动画+性格话语
│  ├─ A2: Face (middle 25%)        │ 点击脸→害羞/惊讶反应（核心交互区）
│  │  ├─ A2a: Eyes area            │ 点击眼睛→角色捂眼"你戳我眼睛了！"
│  │  ├─ A2b: Nose                 │ 点击鼻子→角色揉鼻"别碰鼻子..."
│  │  └─ A2c: Mouth                │ 点击嘴→角色捂嘴"唔！"或笑更大
│  └──────────────────────────────│
│  Zone B: BODY (middle 45%)      │
│  ├─ B1: Shoulder/chest area      │ 点击肩→拍肩鼓励动画+话语
│  ├─ B2: Stomach area             │ 点击肚子→角色捂肚子"别戳！"（摸鱼态肚子更明显）
│  └──────────────────────────────│
│  Zone C: HANDS (bottom 20%)     │
│  ├─ C1: Left hand               │ 点击手→角色做握手动画+话语
│  ├─ C2: Right hand              │ 点击手→角色做击掌动画+话语
│  └──────────────────────────────│
└──────────────────────────────────┘

CLICK RESPONSE MATRIX (by zone × personality × state):

Zone A1 (Hair) click:
  All personalities: character reaches up to fix/pat hair animation (1.5s)
  ARIA: "发型整理完毕。" (serious)
  LUNA: "啊~被摸头发了...害羞(*/ω＼*)" (shy blush)
  KIRA: "别碰！好不容易弄好的！" (annoyed, hand swats away)
  ZEN: "顺其自然~" (doesn't care)
  SHIN: "发型不得随意触碰！" (strict)

Zone A2 (Face) click:
  All personalities: character blush animation (pink cheeks appear for 2s)
  + surprised expression (eyes widen briefly)
  ARIA: "..." (silently blushes, resumes quickly)
  LUNA: "呜...脸被碰了...心跳加速(≧▽≦)" (big blush, hides face with hands)
  KIRA: "你干嘛！(ﾟДﾟ≡ﾟдﾟ)!?" (shocked angry, swats at cursor)
  ZEN: "心如止水..." (minimal reaction)
  SHIN: "面部接触已记录为违纪行为！" (reports it, lol)

Zone A2a (Eyes) click:
  All: character covers eyes with hands "你戳我眼睛了！" → rubs eyes 2s → recovers
  Special: if in sleepy state → character fully opens eyes (startled awake) for 3s → goes back to sleepy

Zone B1 (Shoulder) click:
  All: character does "shoulder pat received" animation → slight lean toward click side
  ARIA: "收到确认。" (acknowledges)
  LUNA: "肩膀拍拍~加油哦！♡" (encouraging, warm smile)
  KIRA: "拍肩？你在鼓励我还是在催我？" (ambiguous)
  ZEN: "力之所至，心之所安" (philosophical)
  SHIN: "注意你的手的位置。" (warning)

Zone C (Hands) click:
  All: character does handshake/high-five animation (hand reaches toward cursor position)
  ARIA: "协作确认。" (professional handshake)
  LUNA: "击掌！✧(≖ ◡ ≖✿) 约定一起加油！" (cheerful high-five)
  KIRA: "啪！...别以为击掌就算和好了" ( reluctant high-five)
  ZEN: "合掌即是缘" (peaceful gesture)
  SHIN: "非必要接触。" (rejects, hand stays down)

DOUBLE-CLICK on character:
  All personalities: character does a full "attention" animation:
  - Stops current activity, stands upright, faces user
  - Expression: attentive (alert eyes, neutral mouth)
  - Speech bubble: "有什么事？"
  - Enters "listening" mode for 5s — if user clicks again within 5s,
    triggers personality-specific dialogue sequence:
    ARIA: "指令？" → "请说明需求。" → "收到。执行中。"
    LUNA: "我在听~♡" → "有什么想聊的吗？" → "好的好的！♡"
    KIRA: "又怎么了？" → "说快点我忙着呢" → "...好吧勉强听一下"
    ZEN: "自在。" → "有何困惑？" → "心静则明"
    SHIN: "报告！" → "陈述事项。" → "收到。5分钟内处理。"

RIGHT-CLICK on character:
  Opens a small context menu (glass-card popup near character):
  ┌──────────────┐
  │ 🎭 切换性格    │
  │ 🎨 切换皮肤    │
  │ 📊 查看状态    │ ← shows current WorkState + focus score + duration
  │ ⏸️ 暂停干预    │ ← disables intervention for 30min
  │ 🔇 安静模式    │ ← disables speech bubbles for 30min
  │ 🔄 回到桌位    │ ← character walks back to desk position
  │ 🚫 关闭角色    │ ← character exits animation + overlay hides
  └──────────────┘
```

---

## 五、监控数据驱动的智能交互闭环

### 5.1 核心概念：监控 → 分析 → 预测 → 交互 → 反馈 → 续监控

这是整个系统最关键的新增部分。虚拟人不再只是"表情+动画"——而是**基于实时监控数据的智能对话伙伴**。

```
Design a monitoring-data-driven intelligent interaction loop for the virtual character.

The character uses REAL monitoring data (work duration, focus scores, app usage patterns,
task progress estimation) to drive its speech, questions, confirmations, and interventions.

DATA SOURCES feeding into the interaction engine:
1. WorkState (13 states) — real-time current state from monitor engine
2. Focus score (0-100) — calculated per 5-min interval from presence.ts
3. Duration tracking — how long in each state today (from trail data)
4. Daily plan — user's planned tasks and estimated durations (from PlanView)
5. Historical patterns — user's typical work hours, break patterns, productivity curves
6. App usage map — which apps mapped to which states, usage frequency
7. Calendar/schedule — today's meetings, deadlines, planned events

INTERACTION ENGINE ARCHITECTURE:

class InteractionEngine {
  // Core data inputs
  currentState: WorkState
  focusScore: number          // 0-100
  stateDuration: number       // minutes in current state
  totalWorkToday: number      // total work minutes today
  totalSlackToday: number     // total slack minutes today
  dailyPlan: PlanItem[]       // today's planned tasks
  meetingSchedule: Meeting[]  // today's meetings
  
  // Derived calculations
  estimatedLeaveTime: Time    // calculated from daily plan + current progress
  progressPercent: number     // how much of planned work is done (0-100%)
  remainingWork: number       // estimated minutes needed to complete plan
  isOnTrack: boolean          // progress vs plan comparison
  riskLevel: RiskLevel        // low | medium | high | critical
  
  // Interaction triggers (condition-based)
  triggers: InteractionTrigger[]
}

INTERACTION TRIGGER SYSTEM:

Each trigger has: condition → action → cooldown → priority

TRIGGER 1 — 下班时间预测提醒
  Condition: current time > estimatedLeaveTime - 30min AND isWorking
  Action: Character walks to center, gentle speech bubble:
    "[性格话语] 预计今天XX:XX可以下班，当前进度YY%，继续加油~"
  Cooldown: 30min (don't repeat within 30min)
  Priority: 3 (medium)

TRIGGER 2 — 下班前加班确认
  Condition: current time > estimatedLeaveTime AND progressPercent < 70% AND isWorking
  Action: Character pops up confirmation dialog (glass-card modal near character):
    ┌──────────────────────────────────┐
    │  ⏰ 下班时间提醒                    │
    │                                    │
    │  预计下班时间已到(XX:XX)             │
    │  今日进度：YY% (还差ZZ%完成计划)     │
    │  估计还需：WW分钟完成今日任务         │
    │                                    │
    │  要继续工作吗？                      │
    │  [继续加班] [准备下班] [调整计划]     │
    └──────────────────────────────────┘
  
  User response handling:
    "继续加班" → Character: personality-specific encouragement
      ARIA: "加班确认。预计XX:XX完成。"
      LUNA: "辛苦了~但记得每小时休息5分钟哦♡"
      KIRA: "加班？你的选择，我不负责后果。" 
      ZEN: "加班亦是修行~"
      SHIN: "加班已确认。XX:XX目标完成时间。"
      → Update estimatedLeaveTime accordingly → continue monitoring
    
    "准备下班" → Character: wrap-up sequence
      ARIA: "今日工作YY%完成。未完成项已记录明日计划。"
      LUNA: "辛苦了！回家好好休息♡ 明天继续加油！"
      KIRA: "终于走了？明天别摸鱼哦..."
      ZEN: "归去亦是自然~"
      SHIN: "今日未完成任务已记录。明日务必补齐。"
      → Log remaining tasks to tomorrow's plan → enter "leaving" state
    
    "调整计划" → Opens PlanView for user to modify plan
      → Recalculate estimatedLeaveTime → new timeline shown
  
  If user ignores dialog for 5min → character does personality-specific nag:
    ARIA: "需要决策。请选择。"
    LUNA: "还在犹豫吗？没关系，我在这里陪你想♡"
    KIRA: "你倒是选一个啊！(ﾟДﾟ)"
    ZEN: "顺其自然..."
    SHIN: "30秒内未决策将默认继续加班。" (timer countdown starts)
  
  Cooldown: never repeat (one-time per day at leave time)
  Priority: 8 (high — this is important life management)

TRIGGER 3 — 摸鱼进度预警
  Condition: slackDuration > 10min AND isOnTrack = false (plan progress < expected)
  Action: Character walks near user, speech bubble with progress data:
    "⚠️ 摸鱼已XX分钟 | 今日进度YY% | 计划进度ZZ% | 落后了AA%"
    + personality-specific warning:
    ARIA: "进度偏差+AA%。建议立即恢复工作。" (data-driven, cold)
    LUNA: "嗯...今天的计划可能完不成了，要不要调整一下？♡" (concerned, gentle)
    KIRA: "就这点进度还想下班？做梦吧你！(╬▔皿▔)" (sharp shame)
    ZEN: "进度如水，急则溢..." (philosophical, useless lol)
    SHIN: "进度不足！立即恢复！5分钟后复查！" (imperative)
  
  If user doesn't return to work within 5min → escalate:
    Second warning (15min slack):
    "⚠️⚠️ 已摸鱼15分钟 | 进度YY% | 预计无法按时完成 | 建议方案："
    "[加班XX分钟] [削减非核心任务] [明日补齐]"
  
  Cooldown: 10min between warnings
  Priority: 7 (high — this directly affects user's day)

TRIGGER 4 — 任务时长预估问答
  Condition: User switches to a new WorkState (e.g., just opened VSCode after meeting)
  Action: After 2min in new state, character asks:
    "这个[编码/写作/会议]任务，大概还需要多久？"
    Shows a small glass-card input near character:
    ┌──────────────────────┐
    │  🕐 任务时长预估       │
    │                        │
    │  当前：编码中           │
    │  预估还需要：           │
    │  [30分钟▼] [1小时] [2小时] [自定义] │
    │                        │
    │  [确认] [跳过]          │
    └──────────────────────┘
    
    User selects duration → character records estimated task duration
    → adds to daily progress tracking
    → character: "收到！预计XX分钟后完成，到时候提醒你~"
    
    If user selects "跳过" → character: "好的，我会根据工作节奏自动预估"
    → use historical average for that WorkState as estimate
    
    CONTINUE MONITORING after user answers:
    - Track actual time vs estimated time
    - When estimated time elapsed → character check-in:
      "预计的XX分钟已经到了，这个任务完成了吗？"
      [已完成✓] [还需要一会儿] [比预期复杂]
      
      "已完成" → celebration animation + record actual duration for future learning
      "还需要一会儿" → "还需要多久？" → mini input again → new estimate
      "比预期复杂" → "了解了。重新预估需要多久？" → new estimate → 
        character notes this task type is harder than average for future reference
  
  Cooldown: 15min (don't ask too frequently)
  Priority: 5 (medium — helpful but not critical)

TRIGGER 5 — 定期进度汇报
  Condition: Every 60min of continuous work (not idle)
  Action: Character brief progress report:
    "📊 进度汇报 | 已工作XXh YYm | 专注度ZZ | 进度AA%"
    + personality-specific commentary:
    ARIA: "进度正常。效率可维持。" / "进度偏低。建议加速。"
    LUNA: "辛苦了~进度不错哦♡" / "进度有点落后，但没关系~调整一下♡"
    KIRA: "还行吧（就这点进度）" / "就这？加油啊！"
    ZEN: "水到渠成~" / "急则失，缓则得"
    SHIN: "进度合格。继续。" / "进度不足！加速！"
  
  Cooldown: 60min (fixed interval)
  Priority: 4 (medium-low — informational)

TRIGGER 6 — 连续低效告警
  Condition: focusScore < 30 for 3 consecutive 5-min intervals (15min sustained low focus)
  Action: Character intervention with data:
    "🔴 连续15分钟低效 | 专注度: XX | 建议："
    "[切换任务] [休息5分钟] [强制专注模式]"
    
    "切换任务" → character suggests alternative tasks from daily plan
    "休息5分钟" → character enters break state, timer for 5min, then prompts return
    "强制专注模式" → activates Phase 1 intervention barrier
  
  Cooldown: 15min
  Priority: 9 (very high — sustained low focus is serious)

TRIGGER 7 — 会议前提醒
  Condition: Meeting scheduled within 15min AND user is in non-meeting state
  Action: Character alert:
    "📅 XX:XX有会议「[会议标题]」，还有YY分钟"
    + personality-specific prep suggestion:
    ARIA: "建议提前3分钟准备会议材料。"
    LUNA: "会议快到了~准备好了吗？♡"
    KIRA: "又要开会？准备好假装认真听的样子（开玩笑）"
    ZEN: "会亦修行~"
    SHIN: "会议XX分钟后开始。立即准备。"
  
  Cooldown: per meeting (one reminder per meeting)
  Priority: 8 (high — meetings are time-sensitive)

TRIGGER 8 — 健康提醒（喝水/站立/眼部休息）
  Condition: Continuous work > 60min without break
  Action: Character health intervention:
    "💧 已经连续工作XX分钟了！建议："
    "[喝水休息3分钟] [站起来活动5分钟] [眺望远方休息眼睛] [继续工作（不建议）]"
    
    If user selects health break → character enters health-break mode
    → 3-5min timer → character does stretching animation alongside user
    → timer ends → "休息结束~感觉好些了吗？回到工作吧♡"
    
    If user selects "继续工作" → character:
    ARIA: "记录：放弃健康休息。"
    LUNA: "好吧...但15分钟后再提醒你♡"
    KIRA: "你是铁人吗？15分钟后再来烦你。"
    ZEN: "身体亦是修行的一部分..."
    SHIN: "连续工作上限60分钟。强制休息3分钟。" (forces 3min break!)
  
  Cooldown: 15min (re-remind after 15min if user skipped)
  Priority: 6 (medium-high — health is important but user has agency)

TRIGGER 9 — 鼓励与里程碑
  Condition: 
  a) focus score reaches 90+ for sustained 30min → "高效时段！继续保持🔥"
  b) total work reaches planned milestone (4h / 6h / 8h) → celebration
  c) Completes a task that was estimated → "任务完成！实际XX分钟 ✓"
  d) First 10min of returning from slack → "回来了！专注加分+10 🎯"
  
  Action: personality-specific celebration:
  ARIA: "效率达标。维持。" / "里程碑达成。继续。" (minimal celebration)
  LUNA: "太棒了！！♡(≧▽≦) 你是最棒的！" (maximum celebration, hearts and sparkles)
  KIRA: "还行吧（别骄傲）(≡▽≡)" / "终于干完了？勉强及格" (teasing celebration)
  ZEN: "功德圆满~" / "如是善行，自在欢喜" (zen celebration)
  SHIN: "达标。下一个目标：XX:XX。" (data celebration)
  
  Cooldown: per milestone (don't repeat same milestone)
  Priority: 2 (low — positive reinforcement, non-urgent)
```

### 5.2 下班时间计算算法

```
Implement an estimated leave-time calculation system.

ALGORITHM:
  estimatedLeaveTime = calculateLeaveTime(dailyPlan, currentProgress, historicalData)

  Step 1: Calculate planned work total:
    plannedTotal = sum of all PlanItem.estimatedDuration (in minutes)
    // e.g., 8 hours = 480min

  Step 2: Calculate completed work:
    completedWork = totalWorkToday (from trail data, in minutes)
    // only count work-state minutes (focus, coding, writing, aiqa, aidev, meeting, remote)

  Step 3: Calculate remaining work:
    remainingWork = plannedTotal - completedWork
    // if negative → all planned work done → can leave now!

  Step 4: Calculate efficiency factor:
    efficiencyFactor = averageFocusScore(today) / 100
    // if focus score is low → tasks take longer than estimated
    // e.g., focus 75% → efficiency factor 0.75 → remaining tasks take 1/0.75 = 1.33x longer
    
    adjustedRemaining = remainingWork / efficiencyFactor
    // accounts for "work done while distracted is less productive"

  Step 5: Add buffer:
    buffer = 15min // always add 15min buffer for transitions/wrap-up
    totalRemaining = adjustedRemaining + buffer

  Step 6: Calculate leave time:
    estimatedLeaveTime = currentTime + totalRemaining

  Step 7: Compare with normal leave time:
    normalLeave = user's typical leave time (learned from historical data, default 18:00)
    if estimatedLeaveTime > normalLeave → overtime risk!
      overtimeMinutes = estimatedLeaveTime - normalLeave
      // show in intervention: "预计需要加班XX分钟"

  Step 8: Adjust for meetings:
    // meetings reduce available work time
    remainingMeetingsToday = meetings still scheduled
    meetingTime = sum of remaining meeting durations
    // add meeting time to remaining work (meetings count as work but consume time)
    
    finalEstimatedLeaveTime = currentTime + adjustedRemaining + meetingTime + buffer

PROGRESS VISUALIZATION:
  Show progress as a glass-card widget near character:
  ┌──────────────────────────────────────┐
  │  📊 今日进度                           │
  │                                        │
  │  ████████████░░░░░░░░░░░░  58%         │ ← progress bar (work-done/planned-total)
  │                                        │
  │  已工作: 4h32m  |  预计剩余: 3h15m     │
  │  专注度: 78     |  效率系数: 0.78      │
  │                                        │
  │  预计下班: 18:45  (加班45分钟⚠️)       │ ← if overtime, shown in warning color
  │  正常下班: 18:00                       │
  │                                        │
  │  今日计划:                              │ ← scrollable list of planned items
  │  ✓ 编码任务A (2h) — 已完成             │ ← completed items with ✓
  │  ◐ 编码任务B (1.5h) — 进行中 42min    │ ← in-progress with actual time
  │  ○ 文档编写 (1h) — 待开始              │ ← not started
  │  ○ AI测试 (0.5h) — 待开始              │
  └──────────────────────────────────────┘

  Color coding:
  Progress < 50% at midday → red bar ("进度严重落后")
  Progress 50-70% at midday → yellow bar ("进度稍慢")
  Progress > 70% at midday → green bar ("进度正常")
  Progress > 90% at midday → bright green ("进度超前！可以提前下班~")
```

### 5.3 多次确认交互流程

```
Design a multi-step confirmation interaction system for the virtual character.

The character can ask DIFFERENT confirmation questions at different moments,
creating a conversational flow that feels natural and context-aware.

CONFIRMATION FLOW 1 — 下班前加班确认（3轮对话）

Round 1 (at estimatedLeaveTime):
  Character: "今天预计XX:XX可以完成所有任务。要继续加班吗？"
  Options: [继续加班] [准备下班] [调整计划]
  
  If "继续加班":
    Round 2 (after 1 hour of continued work):
      Character: "已经加班1小时了。进度更新：YY%。还需要继续吗？"
      Options: [继续] [差不多了，下班] [再加30分钟]
      
      If "再加30分钟":
        Round 3 (after 30 minutes):
          Character: "30分钟到了。最后检查：当前进度ZZ%。"
          Options: [确认完成，下班✓] [真的还需要一会儿] [再加XX分钟]
          
          If "真的还需要一会儿": → free-form input "大概还要多久？" → set new timer
          If "再加XX分钟": → character timer → Round 3 repeats with new duration

CONFIRMATION FLOW 2 — 摸鱼回归确认（渐进3轮）

Round 1 (slack 5min):
  Character (gentle): "休息一下也不错~不过计划进度XX%，要回来了吗？"
  Options: [嗯，回去工作] [再休息一会儿] [我在思考，不是摸鱼]
  
  If "再休息一会儿":
    Round 2 (slack 15min):
      Character (concerned): "已经15分钟了。今日进度可能完不成，确定继续休息？"
      Options: [好吧回去工作] [就5分钟更多] [调整今日计划]
      
      If "就5分钟更多":
        Round 3 (slack 20min):
          Character (intervention): "20分钟了。进度落后AA%。最后确认——"
          "现在回去工作，还是我帮你进入专注模式？"
          Options: [我自己回去] [帮我专注模式] [真的需要长休息→调整计划]
          
          If "帮我专注模式" → Phase 1 barrier activates
          If "真的需要长休息→调整计划" → opens PlanView → adjusts deadline

CONFIRMATION FLOW 3 — 任务完成确认

Round 1 (estimated task time elapsed):
  Character: "你预估的XX分钟任务时间到了。这个任务完成了吗？"
  Options: [已完成✓] [还需要一会儿] [比预期复杂]
  
  If "还需要一会儿":
    Round 2: "大概还需要多久？"
    Quick options: [15分钟] [30分钟] [1小时] [自定义输入]
    
    After new estimate elapsed:
    Round 3: "新的预估时间到了。这次完成了吗？"
    Options: [完成✓] [再加时间] [标记为困难任务→记录]

CONFIRMATION FLOW 4 — 健康休息确认

Round 1 (60min continuous work):
  Character: "连续工作60分钟了！建议休息一下。"
  Options: [喝水休息3分钟] [站立活动5分钟] [继续工作]
  
  If "继续工作":
    Round 2 (75min continuous):
      Character: "75分钟了...真的不休息吗？效率在下降哦。"
      Options: [好吧休息3分钟] [5分钟就好] [我状态很好→跳过]
      
      If "我状态很好→跳过":
        Round 3 (90min continuous):
          Character: "90分钟！这是最后一次提醒。"
          Personality-specific:
          ARIA: "健康数据已记录。"
          LUNA: "拜托了休息一下...♡"
          KIRA: "你是机器吗？！强制3分钟休息！" 
          ZEN: "身心俱疲之时，休息即是最高的修行。"
          SHIN: "强制休息。3分钟。不可拒绝。" (actually forces a 3-min pause)
          Options: [休息3分钟] [休息5分钟] [我选择继续（后果自负）]

ALL CONFIRMATION DIALOGS follow glass-card design:
- Semi-transparent glass-card popup positioned near the character
- Character's face shows appropriate expression for the confirmation type
- Options are glass-btn style with accent-color highlights
- Auto-dismiss: if user ignores for 5min, character makes a default choice
  based on personality (ARIA/ZEN: assume continue, LUNA: assume gentle break,
  KIRA: nag again, SHIN: force the "correct" choice)
- All choices are LOGGED for daily report and future learning
```

---

## 六、完整交互场景示例 — 一天的工作流

```
Design a full-day interaction scenario showing how the virtual character
interacts with the user throughout a work day.

SCENARIO: A developer's typical day with WorkMate + ARIA personality

08:30 — 上班启动
  User opens VSCode → monitor detects 'coding' state
  Character walks from screen corner to desk position
  Speech: "早安。编码模式启动。今日计划加载完毕。"
  Shows mini progress widget: "计划8h | 预计下班18:00"

09:00 — 第一次任务时长确认
  Character (after 2min in coding): "这个编码任务，大概还需要多久？"
  User selects: "2小时"
  Character: "收到。预计10:00完成。进度追踪启动。"

09:30 — 健康提醒
  Character: "连续工作30分钟。建议喝水。"
  [喝水休息3分钟] → User selects break
  Character enters health-break mode, does stretching animation alongside
  3min later: "休息结束。回到编码。"

10:00 — 任务完成确认
  Character: "预估的2小时到了。任务完成了吗？"
  User: "已完成✓"
  Character mini celebration: "编码任务A完成。实际2h ✓。下一个任务？"
  Progress widget updates: ██████░░░░░░░░ 25%

10:15 — 第二个任务时长确认
  Character: "新的编码任务，预估时长？"
  User: "1.5小时"
  Character: "预计11:45完成。"

11:00 — 摸鱼检测（打开了微博）
  Monitor detects slack state (browser + social media keywords)
  Character leaves desk, walks to center-left, sits down with phone
  Speech: "社交媒体检测。摸鱼模式。"
  After 5min: "摸鱼5分钟。进度33%。要回来了吗？"
  User: "再休息一会儿"
  
  After 15min: "15分钟了。进度可能落后。确定继续休息？"
  User: "好吧回去工作" → closes Weibo → VSCode back in focus
  Character happy-walks back to desk: "回来了。专注加分+10。"
  Progress: ████████░░░░░░ 40%

11:45 — 第二个任务完成确认
  Character: "1.5小时预估到了。完成了吗？"
  User: "还需要一会儿" → "大概30分钟"
  Character: "新预估：12:15完成。继续追踪。"

12:00 — 午休提醒
  Character: "午休时间到了。建议休息1小时。"
  User: "午休" → enters break/lunch state
  Character walks to rest area, holds rice bowl
  Speech: "午休模式~好好吃饭♡"

13:00 — 下午开始
  User returns → coding state
  Character walks back to desk: "下午开始。剩余计划5h。预计下班18:00。"

14:00 — 会议前提醒
  Character: "14:15有会议「需求评审」。还有15分钟。"
  "建议提前3分钟准备会议材料。"

14:15-15:00 — 会议中
  Character at desk, professional pose, meeting indicators
  Speech: "会议模式。预计45分钟。"

15:00 — 会议结束，回归编码
  Character: "会议结束。剩余计划3h30m。继续编码？"
  Task duration question: "这个编码任务，预估多久？"
  User: "2小时"

16:00 — 定期进度汇报
  Character: "📊 进度汇报 | 已工作6h | 专注度82 | 进度62%"
  "进度正常。效率可维持。"

17:00 — 连续低效告警
  Focus score drops to 28 (user keeps checking phone)
  Character: "🔴 连续15分钟低效 | 专注度: 28 | 建议："
  [切换任务] [休息5分钟] [强制专注模式]
  User: "休息5分钟" → health break

17:15 — 下班时间预测提醒
  Character: "预计18:45可以下班。当前进度75%。继续加油。"

18:00 — 下班前加班确认（Round 1）
  Character walks to center, serious expression:
  ┌──────────────────────────────────┐
  │  ⏰ 下班时间提醒                    │
  │  预计下班时间已到(18:00)             │
  │  今日进度：75% (还差25%完成计划)     │
  │  估计还需：1小时15分钟               │
  │  要继续工作吗？                      │
  │  [继续加班] [准备下班] [调整计划]     │
  └──────────────────────────────────┘
  User: "继续加班"
  Character: "加班确认。预计19:15完成。注意健康。"

19:00 — 加班1小时确认（Round 2）
  Character: "已经加班1小时。进度更新：88%。还需要继续吗？"
  User: "差不多了，下班"
  Character celebration: "今日工作完成88%。未完成项已记录明日计划。辛苦了。"
  Character does "waving goodbye" animation → walks to screen edge → turns around
  "明天见。早点休息。"
  → exits to corner, enters "away" sleeping state

20:00 — 用户终于关电脑
  Monitor detects system shutdown → character fade-out animation
  Last speech: "晚安。明日8:30再见。"

DAILY REPORT (generated by AI):
  今日工作: 9h (含加班1h)
  专注度平均: 72
  摸鱼时段: 11:00-11:15 (15min)
  健康休息: 3次 (9min total)
  任务完成: 3/4 (75%)
  干干预触发: 1次 (低效告警17:00)
  加班: 1h (18:00-19:00)
  角色互动: 12次对话确认
  
  明日建议: 提前将未完成的编码任务C安排在上午高效时段
```

---

## 七、技术实现提示词

### 7.1 交互引擎实现提示词

```
Implement the monitoring-data-driven interaction engine for WorkMate.

Architecture:
- InteractionEngine class (in src/main/interactionEngine.ts)
  - Runs in main process, receives state updates from monitor/presence engines
  - Evaluates trigger conditions every 5 seconds (matching monitor interval)
  - When trigger fires → sends interaction event to renderer via IPC
  - Renderer receives event → character performs animation + shows dialog

- Trigger system:
  interface InteractionTrigger {
    id: string
    name: string
    condition: (state: InteractionState) => boolean  // when to fire
    action: InteractionAction                         // what to do
    cooldownMs: number                                // minimum time between fires
    priority: number                                  // 0-10, higher = more important
    lastFired?: number                                // timestamp of last fire
  }
  
  Evaluation loop:
  every 5s:
    for each trigger sorted by priority desc:
      if trigger.condition(currentState) is true AND
         now - trigger.lastFired > trigger.cooldownMs:
        fire trigger → execute trigger.action
        trigger.lastFired = now
        break (only fire highest priority trigger per cycle)

- InteractionState (fed by monitor + presence + plan engines):
  interface InteractionState {
    currentWorkState: WorkState
    focusScore: number
    stateDurationMin: number
    totalWorkTodayMin: number
    totalSlackTodayMin: number
    dailyPlan: PlanItem[]
    meetingSchedule: Meeting[]
    progressPercent: number
    estimatedLeaveTime: Date
    isOnTrack: boolean
    riskLevel: RiskLevel
    continuousWorkMin: number  // how long since last break
    lastHealthBreakTime: Date
    personality: PersonalityType
    history: DailyHistory[]    // past 30 days patterns
  }

- InteractionAction types:
  type InteractionAction =
    | { type: 'speech', text: string, personality: PersonalityType }
    | { type: 'dialog', config: DialogConfig }
    | { type: 'barrier', phase: 1|2|3 }
    | { type: 'position', target: PositionTarget }
    | { type: 'animation', animId: string }
    | { type: 'composite', actions: InteractionAction[] }  // multiple actions at once

- DialogConfig:
  interface DialogConfig {
    title: string
    body: string  // can include dynamic data placeholders {{progressPercent}} etc.
    options: DialogOption[]
    autoDismissAfterMs?: number  // auto-dismiss timeout
    autoDismissDefault?: string  // which option to auto-select on dismiss
    position: 'center' | 'near-character' | 'near-widget'
    style: 'info' | 'warning' | 'urgent' | 'celebration'
  }

- DialogOption:
  interface DialogOption {
    id: string
    label: string
    action?: InteractionAction  // follow-up action on selection
    style?: 'primary' | 'secondary' | 'danger' | 'success'
  }

- IPC channels:
  'interaction:trigger' → renderer receives trigger event
  'interaction:response' → main receives user's dialog choice
  'interaction:estimateTask' → user provides task duration estimate
  'interaction:updatePlan' → user modifies plan from dialog

- Estimate leave time algorithm (see §5.2)
  Implemented in src/main/leaveTimeCalculator.ts
  Runs every 5s, updates InteractionState.estimatedLeaveTime
  Uses: plannedTotal, completedWork, efficiencyFactor, meetingTime, buffer

- Task duration learning:
  When user provides task duration estimates → store in DB
  When task completes → compare estimated vs actual → calculate deviation
  Build per-WorkState historical average: avg coding task = 1.5h, avg writing = 2h
  Use historical averages as default estimates when user "skips" duration question
  Over time: character becomes better at predicting durations
```

### 7.2 VRM模型导入实现提示词

```
Implement VRM model import for custom character avatars in WorkMate.

Technology:
- Use @pixiv/three-vrm npm package for VRM model loading
- Use Three.js for 3D rendering within the Electron overlay window
- Render to HTML5 Canvas via Three.js WebGL renderer (transparent background)

Implementation steps:
1. Install dependencies: npm install three @pixiv/three-vrm
2. Create VRMRenderer class (src/renderer/src/lib/vrmRenderer.ts):
   - Initializes Three.js scene with transparent background
   - Loads VRM model from file path
   - Maps VRM blend shapes to WorkMate expression system:
     VRM "happy" → WorkMate happy expression
     VRM "angry" → WorkMate angry/focus expression
     VRM "sad" → WorkMate sleepy/bored expression
     VRM "surprised" → WorkMate alert expression
     VRM "relaxed" → WorkMate break/relax expression
     VRM "lookUp" / "lookDown" / "lookLeft" / "lookRight" → eye tracking
   - Maps VRM humanoid bones to animation skeleton:
     Head → head tilt/nod animations
     Left/Right arm → hand gesture animations
     Spine → posture animations (lean forward, lean back)
     Left/Right leg → walk cycle animations
   - Applies toon shader override (replace VRM's MToon with custom 4-level cel-shading)
   - Updates expression blend shape weights based on current PetState.mood
   - Updates bone rotations based on current animation keyframe

3. Animation system for VRM:
   - Define animation presets as bone rotation keyframe arrays:
     const FOCUS_ANIM: VRMAnimationKeyframe[] = [
       { time: 0, bones: { spine: { z: 0.15 }, head: { x: -0.05 } } },
       { time: 2.4, bones: { spine: { z: 0.12 }, head: { x: -0.08 } } },
       { time: 4.8, bones: { spine: { z: 0.15 }, head: { x: -0.05 } } },
     ] // nod cycle: slight lean forward + head nod
   - Blend between animation presets using linear interpolation (0.3s transition)
   - Walk cycle: predefined walk bone keyframes, blended with position movement

4. Performance optimization:
   - Render at 30fps, skip frames if CPU > 80%
   - Use offscreen canvas for rendering (not visible directly)
   - Copy rendered frame to visible canvas via drawImage()
   - Only re-render when: animation keyframe changes OR expression changes OR position changes
   - Idle state: reduce to 15fps (minimal movement)

5. Built-in model fallback:
   - If no VRM loaded → use built-in sprite-based character (existing system)
   - VRM import is optional enhancement, not required for basic functionality
   - Built-in characters use the simpler 2D sprite system for guaranteed performance

6. VRM import UI:
   Settings → Characters → "导入自定义角色" button →
   - Opens file picker (filter: .vrm files)
   - After selection → validation:
     * Check VRM version (0.0 or 1.0)
     * Check humanoid bone mapping exists
     * Check expression blend shapes exist
     * Check poly count < 20000
     * Check texture total < 4096×4096
   - If valid → load model → show preview (character rotates 360° in 3s)
   - If invalid → show error message with specific issue
   - After confirm → set as active character → personality template overlay
```

---

## 八、汇总：产品全景交互矩阵

| 交互维度 | 低级 | 中级 | 高级 | 极端 |
|---------|------|------|------|------|
| **表情反馈** | 5种基础mood | 15+种WorkState表情 | 性格风格化表情 | VRM自定义表情 |
| **动画动作** | 3种CSS微动 | 15+种状态姿态动画 | 拖拽/提起/抛掷物理动画 | VRM骨骼全动画 |
| **鼠标交互** | 忽略 | 追随光标 | 戳/圈/抓光标 | 遮挡+锁定光标 |
| **屏幕遮挡** | 无 | 20%软屏障 | 40%硬屏障 | 80%全面封锁 |
| **点击反馈** | "嗯？" | 身体部位分区反应 | 右键菜单 | 双击对话模式 |
| **拖拽交互** | 无 | 基本拖拽 | 物理感提起+抛掷 | 特殊落点触发状态 |
| **话语系统** | 固定台词 | 状态驱动话语 | 性格风格化话语 | 监控数据驱动话语 |
| **对话确认** | 单一提醒 | 2轮确认 | 3轮渐进确认 | 自由输入+学习 |
| **进度追踪** | 时间计数 | 进度百分比 | 下班时间预测 | 任务时长预估+学习 |
| **健康干预** | 固定提醒 | 选择式休息 | 3轮渐进提醒 | 强制休息(SHIN型) |
| **角色选择** | 1种 | 3皮肤 | 5性格模板 | VRM自定义导入 |
| **宠物融合** | 无 | 视觉显示 | 状态互动 | 健康告警+联合干预 |

---

**文档结束。此补充文档与 v2.0 规格书配合使用，覆盖3D建模品质、多角色选择、拖拽交互、点击反馈、高端产品参考借鉴、监控数据驱动的完整智能交互闭环系统。**
