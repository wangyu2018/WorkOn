# WorkOn 全产品设计规格书 v2.0

> 从"丑陋桌宠"升级为"动漫虚拟人 × 真实宠物 × 桌面生态"的完整交互系统
> 本文档为 AI 代码编辑器（Cursor/Copilot/Claude Code）提供可直接实现的素材与提示词

---

## 📋 目录

1. [产品定位与核心概念](#1-产品定位与核心概念)
2. [虚拟人角色系统](#2-虚拟人角色系统)
3. [各状态详细动画规格](#3-各状态详细动画规格)
4. [桌面漫游与鼠标交互系统](#4-桌面漫游与鼠标交互系统)
5. [屏幕遮挡与专注强制机制](#5-屏幕遮挡与专注强制机制)
6. [真实宠物融合管理系统](#6-真实宠物融合管理系统)
7. [多模型合并管理架构](#7-多模型合并管理架构)
8. [UI 整体改造方案](#8-ui-整体改造方案)
9. [图标与视觉资产体系](#9-图标与视觉资产体系)
10. [技术实现提示词汇总](#10-技术实现提示词汇总)

---

## 1. 产品定位与核心概念

### 1.1 产品重新定位

**原定位**：极简时间记录 + 丑陋圆形脸桌宠
**新定位**：**桌面上的二次元工作伙伴** — 一个动漫风格虚拟人住在你的电脑桌面上，实时感知你的工作状态，用动作、表情、甚至物理遮挡来帮你专注和健康。

核心体验三轴：
- **陪伴轴**：虚拟人在桌面上"活着"——敲键盘、抱手机、喝咖啡，和你同步
- **干预轴**：摸鱼太久 → 虚拟人拖走你的鼠标 / 遮挡屏幕 / 怒气冲冲走来
- **融合轴**：真实宠物（猫/狗）通过摄像头接入 → 桌面出现真实宠物的动画版本 + 虚拟人互动

### 1.2 三种桌面角色模型

| 角色 | 渲染风格 | 来源 | 交互层级 |
|------|---------|------|---------|
| **虚拟人（Buddy）** | 二次元动漫风 2.5D（3D建模+漫画着色） | 程序内置 | 高——可遮挡/拖拽/漫游 |
| **真实宠物（Pet）** | 卡通化2D动画（基于摄像头图像的风格化处理） | 用户摄像头 + AI视觉 | 中——桌面漫游/跟随虚拟人 |
| **桌面精灵（Sprite）** | 低多边形3D小动物（猫/狗/鸟/龙） | 程序内置皮肤库 | 低——纯漫游/装饰 |

### 1.4 产品名称建议

| 原名 | 新名候选 | 理由 |
|------|---------|------|
| WorkOn | **WorkMate** | 突出"伙伴"而非"监控" |
| WorkOn | **DeskBuddy** | 直白——桌面伙伴 |
| WorkOn | **FocusFriend** | 强调专注+友好 |
| WorkOn | **Companion** | 通用伙伴概念 |

---

## 2. 虚拟人角色系统

### 2.1 角色外观设计规格

```
Design a stylized anime-inspired 2.5D virtual human character for a desktop productivity companion app.
The character is rendered using 3D modeling with manga/comic-style cel-shading (toon shader).

CHARACTER SPECIFICATIONS:
- Style: Japanese anime/manga aesthetic with modern office culture twist
  Reference: characters from "New Game!" anime series — young office workers with expressive faces
- Render technique: 3D low-poly mesh (3000-5000 tris) + cel-shading toon shader
  (sharp light/dark boundary lines, no smooth gradient shading, 2-3 shade levels per surface)
- Outline: thick black contour lines (1.5px at render scale) around all body edges — classic manga outline
- Color palette: vibrant but not oversaturated, limited to 5-6 colors per skin variant
- Proportion: anime-standard — large head (1:1.3 head-body ratio), expressive eyes occupying 30% of face width
- Age appearance: 20-25 young professional, relatable to developer audience
- Gender: configurable (male/female/non-binary variants) — default female "Aria" variant

ARIA (default female variant):
- Hair: shoulder-length, straight with slight wave at tips, silver-purple tint (#9b8cff to #c3b8ff gradient)
  Hair physics: simple spring-based sway reacting to head movement and idle wind
- Face: oval anime face, large expressive eyes with colored iris (purple #9b8cff),
  small nose (single dot or short line), mouth range from tiny dot to wide open
- Eyes: anime-standard large eyes with:
  Upper lid: thick curved line with slight lash detail
  Iris: colored circle with white highlight dot (top-left) and black pupil
  Lower lid: thin line, visible mainly in happy/sleepy expressions
  Eye shapes: 8 expressions (see §3 below)
- Body: slim build, black V-neck T-shirt with subtle brand logo (WorkMate logo tiny on chest),
  optional thin-frame glasses (rectangular, slight blue tint)
- Hands: anime-standard simplified hands — 4-finger style, capable of holding objects (phone/keyboard/mug)
- Skin tone: light with subtle warm undertone (#fce4d6 base)

LEO (male variant):
- Hair: short messy spikes, warm orange (#ffb86b to #e89d52)
- Face: slightly angular jaw, narrower eyes, stronger brow line
- Body: broader shoulders, same black T-shirt, no glasses default
- Skin tone: light-medium (#f0d5b8)

LUNA (alternative female variant):
- Hair: long flowing pink (#f9a8d4 to #ffd0e6), more feminine silhouette
- Face: softer features, rounder eyes with sparkle highlights
- Accessories: cat-ear hair clip (nod to pet integration)
- Same black T-shirt with pink accent stitching
```

**中文精简版给代码编辑器：**

```
设计一个二次元动漫风格的2.5D虚拟人角色，用于桌面效率伙伴应用。
渲染技术：3D低面数网格(3000-5000面) + 漫画赛博着色器（cel-shading toon shader），
尖锐明暗边界线、2-3级色阶、1.5px黑色轮廓描边线。

角色规格：
- 动漫比例：大头1:1.3头身比，大眼占面部30%宽度
- 年龄外观：20-25岁年轻职业人
- 默认皮肤ARIA：银紫短发、紫虹膜大眼(#9b8cff)、浅肤色(#fce4d6)、黑V领T恤、细框眼镜
- 皮肤LEO：橙色短发刺、窄眼强眉、宽肩男版
- 皮肤LUNA：粉色长发流、猫耳发夹、柔和圆眼
- 手：动漫简化4指手，可持物（手机/键盘/杯子）
- 发物理：简易弹簧式摇晃响应头部运动和微风

参考风格：《New Game!》动画中的年轻办公角色 + 现代开发者文化
```

### 2.2 角色状态感知系统

虚拟人通过 WorkOn 的监控引擎获取用户的实时工作状态，然后驱动角色的：

| 驱动维度 | 来源 | 表现 |
|---------|------|------|
| **表情** | WorkState → mood 推导 | 眼形/嘴形/眉位变化 |
| **动作** | WorkState + 持续时间 | 敲键盘/抱手机/喝咖啡等肢体动作 |
| **位置** | WorkState + 干预策略 | 桌面漫游/停留在屏幕边缘/遮挡区域 |
| **语气** | WorkState + 专注度分数 | 话语气泡内容（鼓励/吐槽/警告） |
| **特效** | WorkState 类别 | 状态光环/粒子/屏幕滤镜 |
| **干预** | 摸鱼时长 + 专注度阈值 | 拖拽鼠标/遮挡屏幕/弹窗提醒 |

---

## 3. 各状态详细动画规格

### 🎯 专注办公（Focus）

**虚拟人位置**：屏幕右下角，坐在一个微型办公桌前

```
Anime-style 2.5D virtual character in focused office work state.

POSE: Character sits at a miniature desk (drawn as simple geometric desk object)
positioned at bottom-right of screen. Body facing screen (user's monitor),
slightly leaned forward 10° — the "deep work" hunch.

HANDS: Both hands on a tiny keyboard object, fingers in rapid typing position.
Typing animation: fingers alternate pressing keys in a natural rhythm (0.8s cycle),
occasionally pausing for 2s (reading/thinking) then resuming.

FACE: Eyes narrowed in concentration (slightly squinted, brows lowered 15%),
mouth a thin determined line. Occasional micro-frown when hitting a tough problem.
Every 30s: brief eye-squint intensifies (deep focus moment) lasting 0.5s.

BODY MICRO-MOVEMENTS:
- Slow rhythmic forward-back micro-rock (2° range, 2.4s cycle) — "engaged typing rhythm"
- Shoulders slightly tense/raised — professional tension
- Every 60s: brief shoulder-drop + head-shake (resetting focus posture)

SPOKEN BUBBLES (appear as small floating text near character):
- "专注模式启动 🔥" (on entering state)
- "这个bug有点意思..." (after 30min sustained focus)
- "进度不错，继续！" (when focus score > 85)

SURROUNDING EFFECTS:
- A faint blue-white glow line tracing the desk edge (focus zone visualization)
- Tiny floating progress-bar micro-widget near character showing current focus score
- Screen edge: subtle green tint gradient on the right 5% strip (focus zone marker)

INTERACTION: Character ignores mouse during deep focus (won't react to hover/click)
— too focused to notice you. Only responds to state changes.
```

**中文精简版：**
```
二次元虚拟人专注办公状态。
姿态：坐在微型办公桌前（屏幕右下角），身体面对屏幕前倾10°——深度工作驼背。
双手：放在小键盘物体上，手指交替按键0.8秒节奏，偶尔停顿2秒（阅读/思考）。
表情：眼微眯集中、嘴薄线决绝，偶见微皱眉。每30秒：眯眼加深0.5秒。
身体微动：2°前后微摇2.4秒节奏，肩微紧张上抬。每60秒：肩降+摇头重置姿态。
话语气泡："专注模式启动🔥"、"这个bug有点意思..."、"进度不错，继续！"
周围效果：桌边蓝白微光描边、漂浮迷你进度条、屏幕右侧5%绿色渐变条。
交互：深度专注时不响应鼠标——太专注了没注意到你。
```

---

### 💻 编程中（Coding）

**虚拟人位置**：屏幕右下角，紧贴屏幕边缘，"贴屏"姿态

```
Anime-style 2.5D virtual character in intense coding state.

POSE: Character at bottom-right, body aggressively leaned forward 15° toward screen,
almost "hugging the monitor". Chair/desk barely visible — the character has merged with the screen.

HANDS: Both hands hovering over keyboard in a rapid typing position,
fingers moving in a faster-than-normal rhythm (0.5s cycle).
Occasionally: right hand leaves keyboard to mouse position (click-click-click gesture),
then returns to keyboard. This happens every 8-10s for 2s duration.

FACE: Eyes wide and locked forward (laser focus stare),
brows in a V-shape concentration frown,
mouth pressed tight with visible jaw muscle tension.
Glasses reflecting faint green terminal light on both lenses.
Every 20s: eyes dart left-right briefly (scanning code), then lock back.

BODY MICRO-MOVEMENTS:
- Faster forward-back micro-rock (3° range, 1.2s cycle) — "high-speed coding rhythm"
- Occasional abrupt stop → freeze for 1-2s (encountering complex logic) → resume faster
- Neck occasionally extends forward then retracts (the "screen-peek" motion)

SPOKEN BUBBLES:
- "进入编码模式 💻" (on entering state)
- "别打扰我，正debug呢..." (after 20min sustained)
- "这段代码...有点东西" (after encountering complexity)
- "搞定！✓" (when transitioning away from coding after >30min)

SURROUNDING EFFECTS:
- Green terminal-glow particles emanating from screen edge near character
- Floating syntax-highlighted code lines in the background (very faint, decorative)
- A thin green progress bar under the character showing "lines written today"
- Mouse cursor area: when character's hand goes to mouse position,
  a tiny visual echo appears near actual cursor

INTERACTION: Character occasionally reaches toward user's actual cursor position
with one hand (visual-only, no actual cursor control in this state).
If user clicks near character, character briefly looks up "hmm?" then returns to coding.
```

**中文精简版：**
```
二次元虚拟人编程状态。
姿态：右下角，身体极端前倾15°贴屏——与屏幕合体。
双手：双手悬键盘区快速打字0.5秒节奏。每8-10秒右手移鼠标区2秒再回键盘。
表情：眼宽锁定前方、眉V皱、嘴紧颌张力。眼镜双镜片反射绿色终端光。
每20秒：眼左右扫射（扫代码）再锁定。
身体：3°快速前后摇1.2秒——高速编码节奏。偶见急停冻结1-2秒（复杂逻辑）再加速。
颈偶尔伸前缩回（偷看屏幕动作）。
话语："进入编码模式💻"、"别打扰我，正debug呢..."、"搞定！✓"
周围：绿色终端光粒子从屏幕边缘发出、背景极淡语法高亮代码行、
底部细绿进度条"今日代码行数"。
交互：偶见手伸向用户鼠标位置（纯视觉）。点击角色旁→角色抬头"嗯？"再回编码。
```

---

### 🐟 摸鱼中（Slack / Procrastinating）

**虚拟人位置**：从办公桌离开，游荡到屏幕中间偏左，坐在地上/椅子上玩手机

```
Anime-style 2.5D virtual character in slacking-off/procrastinating state.

POSE: Character has LEFT the mini desk. Now sitting on a cushion/floor
at center-left of screen, body tilted 15° right in a lazy slouch.
One leg crossed under the other — the "total chill" posture.

HANDS: Both hands holding a smartphone object (drawn as a glowing rectangle),
phone held up at face level, tilted slightly toward character's eyes.
Character's fingers occasionally tapping/swiping on phone surface (scrolling social media).

FACE: Eyes half-closed in a glazed/distracted look (70% closed, visible lower lid),
mouth a slight smile (enjoying the content on phone),
brows completely relaxed — zero tension.
Every 5s: eyes briefly widen (interesting content!) then return to half-closed.

BODY MICRO-MOVEMENTS:
- Gentle ±5° sway every 2.8s (the "scrolling rhythm")
- Occasional giggle-shake — small body vibration when seeing funny content (every 15s)
- Head bops slightly to invisible background music (1.2° tilt oscillation)

SPOKEN BUBBLES:
- "摸鱼时间~ 🐟" (on entering state)
- "这个视频太好笑了哈哈" (after 5min of slack)
- "再刷一会儿就回去..." (self-deception, after 15min)
- "已经摸了XX分钟了喂！" (after 30min, with increasingly worried tone)

SURROUNDING EFFECTS:
- Warm pink-orange ambient glow around character (relaxation zone)
- Floating social-media notification bubbles (tiny hearts/likes/comments icons)
- A small floating clock widget showing "slack time: XX min" with worried-red color
  after >15min, flashing-red after >30min

PROGRESSIVE BEHAVIOR (this is the KEY intervention mechanic):
- 0-5min: Character happily on phone, bubbles are fun/playful
- 5-15min: Character starts looking up occasionally with slight guilt expression
- 15-30min: Character puts phone down, stands up, walks toward user's cursor area,
  starts making "shouldn't you work?" gestures (hand pointing at screen)
- 30-60min: CHARACTER STANDS UP AND WALKS TO CENTER OF SCREEN.
  Starts BLOCKING screen area (see §5 for detailed blocking mechanics).
  Speech bubble: "进度赶不上了！！回去工作！" with angry/red font
- >60min: Full screen intervention — character occupies 30% of screen,
  draws a "focus barrier" wall, blocks mouse movement to slack apps.
```

**中文精简版：**
```
二次元虚拟人摸鱼状态。
姿态：离开办公桌！坐在屏幕中央偏左的垫子/地上，身体右倾15°懒散瘫坐，一腿盘在另一腿下——彻底放松。
双手：双手捧智能手机（发光矩形），举到面部高度，手指偶尔点刷（刷社交媒体）。
表情：眼半闭70%（ glazed/走神感）、嘴微笑（享受手机内容）、眉完全放松无张力。
每5秒：眼短暂睁大（有趣内容！）再回半闭。
身体：±5°轻摇2.8秒（刷屏节奏），每15秒咯咯笑震，头微点1.2°。
话语："摸鱼时间~🐟"、"再刷一会儿就回去..."、"已经摸了XX分钟了喂！"

渐进行为（关键干预机制）：
- 0-5分钟：开心玩手机，气泡有趣活泼
- 5-15分钟：偶尔抬头带微愧疚表情
- 15-30分钟：放下手机，站起来走向鼠标区域，做"该工作了吧"手势
- 30-60分钟：角色走到屏幕中央，开始遮挡屏幕区域！
  话语："进度赶不上了！！回去工作！"红色愤怒字体
- >60分钟：全屏干预——角色占屏幕30%，画"专注屏障"墙，阻挡鼠标移向摸鱼应用
```

---

### ✍️ 写文档中（Writing）

```
二次元虚拟人写文档状态。
姿态：回到微型办公桌前，一手持隐形笔在空中书写（空中画弧手势），
另一手托腮思考。身体端正但不紧张——"创作流动"姿态。

表情：右眉微抬（边想边写）、嘴唇微抿、视线偏左下（审视刚写内容）。
每10秒：抬头看远方（思考结构），2秒后低头继续写。

手部动作：左手笔弧书写2秒节奏，右手托腮偶尔换手指位置。
每20秒：左手暂停笔→右手从腮移到键盘位置→模拟打字几秒→再回笔。

话语："写作模式 ✍️"、"让我整理一下思路..."、"这段写得好！"
周围：悬浮半透明文档页面（隐约文字行），闪烁光标点，缓慢环绕笔记本图标。
脚下稳定薰衣草蓝光环。
```

---

### 💬 AI问答中（AI QA）

```
二次元虚拟人AI问答状态。
姿态：坐在桌前但面朝侧面（对着一个悬浮的AI助手图标），
一手托腮（思考提问），另一手向AI图标做"请求"手势。

表情：圆眼好奇注视AI图标、嘴微张15%（正提问/刚收到回答）。
眼镜镜片带紫色全息反射（AI界面光）。
每5秒：点头动作（收到回答的确认）。

手部交替动作：2秒向AI图标抬手请求→1秒等待→2秒点头确认回答→1秒思考。

话语："问AI一下 💬"、"这个回答有点意思！"、"AI说...让我想想"
周围：悬浮聊天气泡（闪烁特效），旋转AI大脑图标（几何神经网络球），
紫色数据流线连至头部。脚下闪烁紫色光环带火花环绕。
```

---

### 🤖 AI开发中（AI Dev）

```
二次元虚拟人AI开发状态。
姿态：坐在桌前，左手掌心向上"接收"AI输出，右手捏合手势"精选筛选"——
"与AI共创"姿态。身体前倾8°，比编程稍缓。

表情：眼集中但瞳孔放大（吸收AI生成代码）、眉V形收紧、嘴紧闭颌张力——"共创强度"。
眼镜双面反射：左紫AI输出，右绿终端输入。

手部动作：左手接收→右手筛选→双手合并确认，2秒循环。
每15秒：抬头对AI图标点头（确认采纳）。

话语："AI协作模式 🤖"、"这段AI写的...我再改改"、"人机共创效率起飞！"
周围：分屏全息——左紫AI代码流右绿人类编辑流，合并箭头互通，
悬浮AI助手图标。紫绿粒子阴阳漩涡环绕。
脚下双色光环半紫半青缓慢旋转。
```

---

### 📅 会议中（Meeting）

```
二次元虚拟人会议状态。
姿态：端正坐在桌前，面对一个悬浮的视频会议窗口（小方形框内有其他小头像）。
一手近肩部做讨论手势，另一手安静放置——聆听模式。
头完全端正居中——"职业在场"姿态。

表情：眼正常睁开注视会议窗口、嘴礼貌微笑、面职业友好。
每8秒：根据"发言"指示变化——发言时嘴开手势加大，聆听时嘴微笑手放下。

头发整理（会议形象），眼镜端正。

话语："会议模式 📅"、"我同意这个方案"、"下个议题..."、"会议结束！回去干活"
周围：4-6个悬浮小头像圆（参会者），红色摄像头指示点，
静音/非静音图标。底部细横进度条（会议时间线）。
脚下温暖金色光环稳稳专业。
```

---

### 💤 空闲/离开（Idle / Away）

```
二次元虚拟人空闲状态。
姿态：离开桌椅，在屏幕角落找个舒服的位置——
躺在地上/趴在桌旁/缩在角落蜷成一团。眼镜摘下悬浮在旁边。

表情：双眼闭合弧线（安详睡眼）、嘴小圆点（鼾声指示）、面完全放松。
Z字母从嘴边缓慢上升消散。

身体微动：3.6秒呼吸循环——身体微微扩张收缩。极慢几乎静止。
每20秒：Z字母消失一阵→眼微颤（差点醒）→又闭眼继续睡。

话语：无声（睡着），偶尔："嗯...zzZ"、"还早呢..."

周围：暗淡暮光、小月亮光源、暗星点背景。极稀疏尘埃粒子。
脚下极淡薰衣草光环3.6秒极慢脉动。

离开(Away)状态变体：
角色半透明0.7+边缘模糊虚化，悬浮WiFi关闭图标，
身体缩小0.95倍——"不完全在场"感。
```

---

### ☕ 休息/午休（Break / Lunch）

```
二次元虚拟人休息状态。
姿态：离开桌椅，走到屏幕一角的小休息区——
一手握咖啡杯近嘴，另一手放松放身侧。身体后仰5°——"充电时刻"。

表情：眯眼微笑弧线、嘴角满足上弯、面放松带腮红——享受休息。
每5秒：抿杯动作（手微抬杯），8秒满足叹气（肩降+嘴更大微笑）。

午休变体：一手握饭碗图标，筷子在嘴和碗之间移动。
每4秒筷子入口动作，12秒后仰伸展（饭困来袭）。

话语："休息一下 ☕"、"咖啡续命！"、"午休时间~ 🍚"、"吃饱了...好困"
周围：咖啡杯蒸汽/饭碗蒸汽粒子上升，小植物图标，暖阳光线纹。
脚下暖金绿光环温和滋养。
```

---

### 🎵 放松中（Relax）

```
二次元虚拟人放松/娱乐状态。
姿态：离开工作区，游荡到屏幕中央偏右——
一手近耳做聆听手势，另一手随意摆动。头随节奏微摆5°左右振荡。

表情：大弧眯眼笑、嘴宽笑弧、腮红鲜明——享受时光。
头发更蓬松动感（休闲造型）。

每1.2秒节奏点头，偶见全身微弹。

话语："下班模式 🎵"、"终于可以放松了！"、"这首歌好听~"
周围：♪ ♫音符粒子环绕，耳机图标，背景极光波纹。
脚下暖粉光环带闪粉活泼欢乐。
```

---

### 🖥️ 远程协作（Remote）

```
二次元虚拟人远程协作状态。
姿态：坐在桌前但面对两个悬浮屏幕——左本地右远程。
一手上指（讲解），另一手掌开（接收反馈）——"远程同步"姿势。

表情：眼警觉但聚焦、嘴微抿专业、眉略抬响应远程团队。
眼镜双屏反射——左本地代码，右远程小头像。

每3秒交替指/接手势，5秒左右转头（检查双屏）。

话语："远程协作模式 🖥️"、"我这边是这样的..."、"收到你的修改了"
周围：分屏悬浮——左本地右远程，同步箭头互通，
"已连接"绿色脉冲指示器。双向数据流粒子。
脚下双青白光环，绿色同步脉冲点环绕。
```

---

### 🔍 调试中（Debugging）

```
二次元虚拟人调试状态。
姿态：极端贴屏前倾15°，一手握额头（焦虑思考），另一手在键盘区急速按键。
身体微颤——压力反应。

表情：眉深皱V形、眼圆睁紧盯、嘴紧咬——"追踪bug"决绝脸。
每6秒：皱眉加深+叹气+额头手加重按压。

话语："debug模式 🔍"、"这个bug藏得深..."、"找到你了！🐛"
周围：红色错误高亮代码行闪烁，悬浮虫子图标，
断裂红色链线，告警三角。红色脉冲粒子急促0.8秒。
脚下红色急促脉冲光环。
```

---

### 🎉 开心/庆祝（Celebrating）

```
二次元虚拟人庆祝状态。
姿态：从桌椅站起来！一手高举拳头（胜利手势），另一手展开——"庆功"开放姿态。
身体微弹跳（上升1px回落），头发飞扬。

表情：大弧眯眼笑、嘴宽大笑弧、腮红鲜明——"胜利时刻"喜悦。

话语："搞定啦！🎉"、"太棒了！"、"这段代码完美！"
周围：金色星爆粒子从拳头爆发，五彩纸屑缓慢飘落，
奖杯图标，胜利旗帜。脚下金色辉煌光环带彩虹散射。
```

---

### 😤 压力大（Stressed）

```
二次元虚拟人高压焦虑状态。
姿态：双手抱头、肩膀紧缩上提——"崩溃边缘"防御姿态。
头发蓬乱眼镜略歪。身体微颤0.5秒周期。

表情：眉极度内皱、眼圆睁带微颤、嘴咬唇——"压力峰值"脸。
每8秒：深呼吸——肩降+嘴开2秒。

话语："压力有点大 😤"、"deadline要到了..."、"需要喘口气..."
周围：红色警告符号叠加，deadline倒计时急速，
噪音波形粒子，模糊重叠窗口。暗红紊乱光环不规则脉冲。
```

---

### 🥱 精疲力竭（Exhausted）

```
二次元虚拟人精疲力竭状态。
姿态：完全瘫趴在桌上——额头贴桌面，双手无力摊开。
眼镜摘下搁旁，头发完全散乱。

表情：眼半闭下垂弧、嘴微开无力、面完全无张力——"电量耗尽"。
极慢4秒呼吸周期，偶见挣扎抬头又趴下。

话语："累死了... 🥱"、"脑子不转了..."、"明天再说吧..."
周围：深夜时钟（23:XX），空咖啡杯，几乎熄灭的屏幕残光，月光微点。
极稀疏暗淡尘埃，能量粒子向下坠落。脚下极淡暗暖光环几乎不可见。
```

---

### 🔥 紧急处理（Urgent / P0）

```
二次元虚拟人紧急处理状态。
姿态：极端前倾20°，双手都在键盘区——"全速响应"战斗姿态。
头发微乱（急迫感）。身体微颤更频繁。

表情：眉强V皱、眼圆睁瞳孔缩小（高压聚焦）、嘴紧闭颌明显张力。
极快手指0.5秒周期，身体微颤。

话语："紧急处理！🔥"、"P0问题！全力排查！"、"分秒必争！"
周围：红色警报横条闪烁，倒计时数字，P0/P1标记，
系统健康指标红色闪烁。红色急促脉冲粒子环绕0.6秒。
脚下红色急促0.6秒脉冲光环。
```

---

### 🏃 健康休息（Health Break / 喝水/拉伸）

```
二次元虚拟人健康微休息状态。
姿态：离开桌椅，走到屏幕一侧做伸展动作——
一手举水瓶近嘴，另一手做肩部上抬伸展。3秒喝水→6秒伸展循环。

表情：眼微眯舒适、嘴微笑弧、腮红——"自我关怀"满足。
每6秒：肩抬→肩降伸展动画。

话语："喝水时间 💧"、"伸展一下！"、"注意颈椎健康~"
周围：水瓶水波纹粒子，心率正常图标，伸展引导图标，
窗外阳光线纹。脚下清新蓝绿光环活力脉动。
```

---

### 🎓 学习中（Learning）

```
二次元虚拟人学习/研究状态。
姿态：一手托腮思考，另一手在隐形笔记区翻页。
头微低看书方向，身体端正舒适后仰3°。

表情：眼专注带好奇、嘴微抿、眉一高一低思索态——"求知"面。
每4秒托腮微换手，偶见领悟——眼亮+嘴开0.3秒+灯泡闪。

话语："学习模式 🎓"、"这个概念有意思..."、"终于理解了！💡"
周围：书本图标、笔记图标、知识树状图粒子，
灯泡图标偶亮。脚下蓝白光环沉稳求知。
```

---

## 4. 桌面漫游与鼠标交互系统

### 4.1 桌面漫游机制

```
Design a desktop roaming system for the anime virtual character in WorkMate.

ROAMING BEHAVIOR:
The character lives on the user's desktop as a transparent-overlay window
(always-on-top, click-through most of the time, except during intervention).

POSITIONING SYSTEM:
- Default positions per WorkState (see §3 for each state's default location)
- Character can WALK between positions with a smooth 2s transition animation:
  Walking animation: body bobs up-down 3px, legs alternate forward/back,
  arms swing, head faces direction of movement, hair physics responds.
- Character has a "home spot" (bottom-right near the widget area) where it
  defaults to when no specific state position is defined.

ROAMING PATTERNS:
1. **Idle roam** (when idle/away/break): character walks randomly around screen edges,
   pauses at corners, sits down, gets up, explores. Changes direction every 8-15s.
   Speed: slow (2px/frame). Occasional curiosity: walks to mouse cursor position,
   looks at it for 3s, then wanders away.

2. **Focus position** (when working): character stays at designated spot,
   minimal movement — just the state-specific micro-animations.

3. **Intervention walk** (when slack > threshold): character deliberately walks
   FROM current position TO center/nearest-slack-area. Walk is faster (4px/frame),
   more determined stride, eyebrows furrowed. This walk is NOT random — it's purposeful.

4. **Return walk** (when returning to work after intervention): character walks
   back to desk position with a relieved/happy expression, sometimes doing a
   small victory jump. Speed: moderate (3px/frame).

PHYSICS:
- Character cannot walk through the widget window (treats it as obstacle, walks around)
- Character avoids overlapping with important UI elements (calendar, progress rings)
- Character respects screen boundaries (stays within 5-95% of screen area)
- Z-ordering: character appears BEHIND the widget window but IN FRONT of desktop

TRANSITION ANIMATION between positions:
- Walk cycle: 8-frame walk animation (legs alternating, body bob, arm swing)
- Walk speed scales with distance: short walks = moderate pace, long walks = faster
- On arrival: 0.5s settling animation (character adjusts posture to new state pose)
```

**中文精简版：**
```
桌面漫游系统设计。

定位系统：
- 每个工作态有默认位置（见§3）
- 角色在位置间走动：2秒平滑过渡，行走动画（身体3px上下颠、腿交替、臂摆、头发物理响应）
- "家"位置：右下角widget区域旁

漫游模式：
1. 空闲漫游：随机沿屏幕边缘走动，每8-15秒换方向，慢速2px/帧。
   好奇心：走到鼠标位置看3秒再走开。
2. 专注驻位：工作态固定位置，仅状态微动画。
3. 干涉行走：摸鱼超阈值→角色从当前位置刻意走向屏幕中央/摸鱼区域，
   快速4px/帧，步伐坚定，眉皱。非随机——有目的。
4. 回归行走：干涉后恢复工作→角色走回桌位，表情轻松/开心，偶见小胜利跳。

物理约束：
- 不穿越widget窗口（绕行）
- 不覆盖重要UI元素
- 5-95%屏幕范围内
- Z序：角色在widget后面，桌面前面
```

### 4.2 鼠标交互系统

```
Design a mouse interaction system for the anime virtual character.

MOUSE INTERACTION LEVELS (progressive, based on slack duration):

Level 0 (normal): Character ignores mouse. User clicks/hovers near character →
  character briefly looks up "hmm?" animation (0.5s) then returns to current activity.
  This is the default during all work states.

Level 1 (curious, idle states): When idle/break/relax, character occasionally
  walks TO the mouse cursor position, looks at it for 2-3s ("what's this?"),
  then wanders away. Frequency: every 30-60s.
  If mouse is near character: character's head turns to face mouse direction,
  eyes follow cursor movement (like a cat watching movement).

Level 2 (playful, >10min slack): Character starts INTERACTING with mouse:
  - Pokes the cursor with a finger (visual-only poke animation, no actual cursor movement)
  - Draws a tiny circle around the cursor with finger (like "hey, look at me")
  - Taps the cursor position 3 times in a row (insistent poke)
  - Speech bubble: "还在摸鱼？看看我~"

Level 3 (grabbing, >20min slack): Character ACTUALLY GRABS the mouse cursor:
  - Animation: character's hand reaches out toward cursor position,
    hand closes around cursor icon → cursor icon changes to "held by character" variant
  - CHARACTER DRAGS CURSOR AWAY from slack apps toward work apps or empty desktop area
  - Drag distance: 50-150px depending on how far from "work zone"
  - Duration: 1-2s drag, then releases cursor
  - Cursor returns to normal after release
  - Speech bubble: "来，回到工作区~" (gentle tone at 20min)
  - If user fights back (moves cursor back to slack app within 5s):
    character frowns, shakes head, but lets go. Will try again in 60s.
  - This happens ONCE per slack session at 20min, then again at 35min if still slacking

Level 4 (blocking, >30min slack): See §5 for full blocking mechanics.
  At this level, mouse interaction becomes FORCEFUL:
  - Character physically STANDS IN FRONT of slack app window area
  - If mouse moves toward slack app → character's hand intercepts cursor
    (cursor hits an invisible "wall" that character projects)
  - Cursor movement is SLOWED DOWN (0.5x speed) when moving toward slack apps
  - Speech bubble: "不行！进度赶不上了！" (urgent/red font)

MOUSE-HOVER REACTIONS (always active):
When mouse hovers over character (not clicking):
- Work states: character doesn't react (too focused)
- Idle states: character looks up at cursor, eyes follow it
- Slack states >10min: character pokes cursor, draws circles around it
- Any state: if mouse hovers for >5s, character does a brief "stare" animation
  (looks directly at cursor for 1s, then either returns to activity or does a reaction)

CLICK-ON-CHARACTER BEHAVIOR:
When user clicks on the character itself:
- Work states: character briefly pauses, looks up, speech bubble "需要什么？" then resumes work
- Idle states: character does a "surprise" animation (jumps slightly, eyes widen),
  then speech bubble "呀！你点了我~"
- Slack states: character responds based on slack duration:
  <10min: "啊，被抓到了~" (playful embarrassment)
  >10min: "我知道我在摸鱼...但你也一样啊！" (defensive humor)
  >30min: "别点我了！去工作！" (angry/urgent, character pushes cursor away)

IMPLEMENTATION NOTE:
Mouse grab/drag uses a temporary cursor-position override that:
- Reads cursor position every frame
- If character is in "grab" mode: applies a directional force vector toward target position
- Force magnitude: 50-150px/s, decay over 1-2s
- User can "fight" the force by moving cursor harder (force is advisory, not absolute lock)
- After release: cursor returns to user's intended position (no permanent hijacking)
- All interactions logged: "mouse intervention triggered at slack duration XXmin"
```

**中文精简版：**
```
鼠标交互系统设计（渐进式，基于摸鱼时长）。

Level 0 正常：角色忽略鼠标。点击角色旁→角色抬头"嗯？"0.5秒再回活动。

Level 1 好奇（空闲态）：角色每30-60秒走到鼠标位置看2-3秒再走开。
鼠标近角色→角色头转向鼠标方向，眼跟随光标移动（像猫看移动）。

Level 2 顽皮（摸鱼>10分钟）：角色开始与鼠标互动——
手指戳光标（纯视觉）、画小圈围绕光标、连续戳3次。
话语："还在摸鱼？看看我~"

Level 3 抓取（摸鱼>20分钟）：角色实际抓住鼠标光标——
手伸向光标→手合拢→光标变"被角色握住"变体
→角色拖拽光标远离摸鱼应用移向工作区/空桌面
→拖距50-150px→1-2秒后释放光标恢复正常
话语："来，回到工作区~"
用户反抗（5秒内移回摸鱼应用）：角色皱眉摇头放手，60秒后再试。
20分钟触发一次，35分钟再试一次。

Level 4 阻挡（摸鱼>30分钟）：见§5完整阻挡机制。
角色站在摸鱼应用窗口前。鼠标向摸鱼应用→角色手拦截光标（隐形墙）。
光标移向摸鱼应用时减速0.5倍。
话语："不行！进度赶不上了！"红色紧急字体。

悬停反应：鼠标悬停角色>5秒→角色注视光标1秒再反应。
点击角色：工作态"需要什么？"→空闲态"呀！你点了我~"
→摸鱼<10min"啊，被抓到了~"→摸鱼>10min"我知道我在摸鱼..."
→摸鱼>30min"别点我了！去工作！"角色推开光标。

技术实现：光标抓取使用临时位置覆写，
50-150px/s方向力向量，1-2秒衰减，
用户可以"对抗"力（力是建议性而非绝对锁定），
释放后光标回到用户意图位置（不永久劫持）。
```

---

## 5. 屏幕遮挡与专注强制机制

### 5.1 专注遮挡系统

```
Design a screen-blocking/focus-enforcement system for the anime virtual character.

This is the CORE innovation of WorkMate: the character physically intervenes
when the user is slacking too long, using screen-space blocking to force focus.

INTERVENTION PROGRESSION (based on slack duration + focus score):

PHASE 0 — Warning (slack 5-15min, focus > 50):
- Character leaves phone/relax pose, stands up, walks toward screen center
- Speech bubble: "应该回去工作了~" (gentle reminder, warm font)
- Character makes "pointing at screen" gesture toward user's work apps
- NO screen blocking yet, just visual nagging
- Duration: 5s animation, then character stays standing near center for 10s,
  then if user returns to work: character happy-walks back to desk
  if user continues slacking: enters Phase 1

PHASE 1 — Soft Block (slack 15-30min, focus < 50):
- Character walks to center of screen
- Creates a TRANSLUCENT BARRIER — a semi-transparent colored shield
  that covers 20-25% of screen area (positioned over the slack app window area)
- Barrier appearance: anime-style energy shield —
  a glowing hexagonal grid pattern (think "sci-fi force field"),
  color: warning orange/yellow with animated edge glow
  opacity: 0.3 (can see through it, but it's annoying/distracting)
- Character stands behind the barrier with arms crossed, shaking head
- Speech bubble: "已经摸了XX分钟了！专心！" (firm tone, orange font)
- Barrier has a small "dismiss" button (X icon) that user CAN click to remove it
  — but clicking dismiss triggers:
  * Character frowns, speech bubble: "好吧...但我会再来的"
  * 5-minute cooldown before next intervention (but next one will be Phase 2)
  * Dismiss clicks are logged and reported in daily summary
- Barrier slowly pulses opacity 0.2→0.4→0.2 every 2s (breathing animation)
- User CAN still work around the barrier (it's translucent, not blocking)

PHASE 2 — Hard Block (slack 30-60min, focus < 30):
- Barrier expands to 40-50% of screen area
- Opacity increases to 0.5-0.6
- Barrier pattern changes: hexagons become SOLID (no transparency between cells),
  edges glow brighter red
- Character NOW STANDS IN FRONT of the barrier, actively blocking view
- Character's body covers ~15-20% additional screen area
- Character's speech bubble: "不行！进度赶不上了！！" (angry, RED font, shaking)
- NO dismiss button on this barrier — it cannot be removed by clicking
- Barrier CAN be removed by:
  * Switching to a work-state app (VSCode, Word, etc.) — barrier dissolves in 2s
    with character doing "finally!" celebration animation
  * Pressing Ctrl+Shift+F (Force Focus shortcut) — same dissolution
  * Waiting 2 minutes — barrier reduces back to Phase 1 (but stays at Phase 1 level)
- Barrier has animated elements:
  * Small floating "countdown" numbers showing slack time
  * Red warning triangles pulsing at barrier edges
  * Character occasionally taps the barrier surface (knock-knock animation)
- Mouse cursor slowed to 0.5x speed when moving within barrier zone
- If user tries to alt-tab to another slack app while barrier is active:
  * Barrier shifts position to cover the new slack app window area
  * Character walks to reposition in front of the new window

PHASE 3 — Total Lockdown (slack >60min, focus < 15):
- Barrier expands to 65-80% of screen area (nearly full screen)
- Opacity: 0.7-0.85 (very hard to see through)
- Barrier pattern: solid red-orange blocks with "WARNING" text overlay
- Character is now in full "crisis mode":
  * Standing center-screen, arms wide, blocking maximum area
  * Expression: extremely angry/urgent — V-brow, wide eyes, shouting mouth
  * Speech bubble: "❗️ 紧急专注模式！今日进度严重落后！" (large, red, shaking)
  * Full body animation: character stomps feet, waves arms, pulls at user's screen edge
- Mouse cursor is LOCKED to work-app zones only:
  * Cursor cannot enter areas where slack apps are detected
  * If slack app is in focus → cursor is forced to desktop/work-app area
- Keyboard shortcut Ctrl+Shift+F still works to dismiss
- Auto-dismiss after 5 minutes of sustained work state
- Daily report logs: "Phase 3 intervention triggered at XX:XX, slack duration: XXmin"

BARRIER VISUAL DESIGN:
The barrier should look like an anime-style magical energy field:
- Base: hexagonal cell grid (think "Macross" or "Evangelion" AT Field aesthetic)
- Cell size: ~40px per hexagon
- Cell fill: semi-transparent color matching intervention phase (yellow→orange→red)
- Cell edges: glowing bright lines (energy field edges)
- Animated: cells ripple outward from character's position, expanding the field
- Sound effect (optional): gentle "energy field activate" hum (very quiet, subtle)

CHARACTER BEHAVIOR DURING BLOCKING:
- Phase 0-1: Character is concerned but not aggressive
  (like a friend gently reminding you: "hey, you should work")
- Phase 2: Character is frustrated and assertive
  (like a teammate whose deadline you're risking: "come ON, we need this done")
- Phase 3: Character is in full crisis mode
  (like a project manager whose project is failing: "THIS IS URGENT, WORK NOW!")
- After user returns to work: character does celebration animation:
  Phase 0-1 return: happy smile + "太好了！加油~"
  Phase 2 return: relieved sigh + "终于回来了..." + settles back to desk
  Phase 3 return: exhausted relief + "谢谢...我真的担心进度..." + walks slowly back

ETHICAL SAFEGUARDS:
- ALL interventions are visual-only — no actual app closing, file deleting, or system changes
- User ALWAYS has Ctrl+Shift+F escape route
- Phase 3 mouse-lock only restricts cursor zones, doesn't prevent keyboard shortcuts
- Interventions are logged transparently in daily report
- User can disable intervention system entirely in Settings (per-phase toggle)
- "Nag cooldown" after each dismiss: Phase 0 → 5min, Phase 1 → 10min, Phase 2 → 15min
- Maximum intervention duration: Phase 3 lasts max 5min then auto-reduces to Phase 2
```

**中文精简版：**
```
屏幕遮挡与专注强制机制设计——WorkMate核心创新。

干预渐进（基于摸鱼时长+专注度）：

Phase 0 提醒（摸鱼5-15分钟，专注>50）：
角色离开放松姿态→站起来→走向屏幕中心
话语："应该回去工作了~"温和字体
做"指向屏幕工作区"手势。不遮挡。5秒动画+10秒驻留。
用户回工作→角色开心走回桌；继续摸鱼→进Phase 1。

Phase 1 软遮挡（摸鱼15-30分钟，专注<50）：
角色走到屏幕中心→生成半透明屏障覆盖20-25%屏幕面积（定位在摸鱼应用窗口区域）
屏障外观：动漫风格能量盾——发光六角网格（科幻力场风格），
警告橙黄色+动画边缘光，透明度0.3（能看穿但烦人/分散注意力）
角色双手交叉站在屏障后摇头
话语："已经摸了XX分钟了！专心！"坚定橙字
屏障有小X关闭按钮——点击触发：角色皱眉"好吧...但我会再来的"，5分钟冷却后下次直接Phase 2
屏障缓慢脉动0.2→0.4→0.2每2秒。用户仍可在屏障周围绕行工作。

Phase 2 硬遮挡（摸鱼30-60分钟，专注<30）：
屏障扩展至40-50%屏幕面积，透明度0.5-0.6
六角变实心（不透明），边缘红光更亮
角色现在站在屏障前方主动遮挡，身体覆盖15-20%额外面积
话语："不行！进度赶不上了！！"愤怒红色字体震动
无关闭按钮——只能通过：切换工作态应用（VSCode等）→屏障2秒溶解+角色庆祝动画
或Ctrl+Shift+F强制专注快捷键→同溶解
或等待2分钟→屏障降回Phase 1水平
屏障动画元素：浮动倒计时数字、红色警告三角脉动、角色偶尔敲屏障（叩叩动画）
鼠标在屏障区内减速0.5倍。用户alt-tab到新摸鱼应用→屏障移位覆盖新窗口区域。

Phase 3 全面封锁（摸鱼>60分钟，专注<15）：
屏障扩展65-80%屏幕面积，透明度0.7-0.85
实心红橙块+WARNING文字覆盖
角色全面危机模式：中心站立手臂展开遮挡最大面积
表情极度愤怒/紧急——V眉、宽眼、喊嘴
话语："❗️紧急专注模式！今日进度严重落后！"大红色震动
全身动画：跺脚、挥手、拉屏幕边缘
鼠标锁定在工作应用区域——光标不能进入摸鱼应用区域
摸鱼应用在焦点→光标强制移至桌面/工作应用区
Ctrl+Shift+F仍可解除。持续工作5分钟后自动解除。
日报记录："Phase 3干预触发于XX:XX，摸鱼时长：XX分钟"

屏障视觉设计：动漫魔法能量场——六角网格(40px/格)、
半透明色随阶段变化(黄→橙→红)、发光边缘线、从角色位置向外涟漪扩散。

角色行为递进：
Phase 0-1：温和提醒（朋友："嘿，该工作了"）
Phase 2：坚定催促（队友："拜托，deadline要到了"）
Phase 3：危机警告（PM："紧急的！现在必须工作！"）
回工作后：Phase 0-1→开心"太好了！加油~"
Phase 2→释然"终于回来了..."
Phase 3→疲惫欣慰"谢谢...我真的担心进度..."

道德安全措施：
所有干预仅视觉——不关闭应用、不删文件、不改系统
用户总有Ctrl+Shift+F逃生路线
Phase 3鼠标锁仅限制光标区域、不阻止键盘快捷键
干预透明记录在日报
用户可在设置完全关闭干预系统（逐Phase开关）
每次解除后有冷却：Phase 0→5分钟，Phase 1→10分钟，Phase 2→15分钟
Phase 3最长5分钟后自动降为Phase 2
```

---

## 6. 真实宠物融合管理系统

### 6.1 概念：虚拟人 + 真实宠物 = 双伙伴

```
Design a real-pet integration system for WorkMate that connects the anime virtual character
with the user's ACTUAL pet (cat/dog) via webcam + AI vision.

CORE CONCEPT:
The user's real pet appears on the desktop as a STYLIZED ANIMATED VERSION
(2D cartoon rendering based on the pet's actual appearance), alongside the anime virtual character.
The two characters can interact with each other on the desktop.

PET AVATAR GENERATION:
- Input: webcam feed of user's real pet (using existing PetWatch/Qwen3-VL pipeline)
- Processing: AI vision model detects pet → extracts color/pattern/shape features
- Output: generates a 2D cartoon-style animated version of the pet
  (not a live video feed — a stylized animated representation)
- Style: same anime/manga aesthetic as the virtual human character, but more animal-cartoon style
  (think "Pusheen" or "Neko Atsume" aesthetic but customized to match the real pet's look)
- The pet avatar inherits the real pet's colors: orange tabby → orange cartoon cat,
  black cat → black cartoon cat with green eyes, golden retriever → golden cartoon dog, etc.

PET BEHAVIOR ON DESKTOP:
- When pet is detected on camera: pet avatar appears on desktop, walks around slowly
- Pet behavior patterns derived from AI vision analysis:
  * Pet sleeping on camera → pet avatar curls up in corner of screen, sleeping animation
  * Pet playing/active → pet avatar walks around screen edges, occasionally pokes virtual character
  * Pet looking at screen → pet avatar sits near virtual character, both look at screen together
  * Pet eating → pet avatar appears near food bowl icon, eating animation
  * Pet not visible (off-camera) → pet avatar fades out after 30s, "fluffy went somewhere~" speech

PET + VIRTUAL CHARACTER INTERACTIONS:
- Virtual character sees pet avatar appear → does a "hi pet!" reaction (waves, smiles)
- Pet avatar walks near virtual character → virtual character pets/strokes the pet (hand animation)
- When both are idle: pet avatar curls up next to virtual character, both nap together
- When virtual character is in focus/coding: pet avatar sits quietly nearby, watching
  (like a real cat sitting on your desk while you work)
- When virtual character enters intervention mode (blocking user):
  pet avatar ALSO joins — sits next to character, adds a small "meow" / "woof" bubble
  (the team approach: virtual character + your real pet both telling you to work!)
- Pet avatar occasionally catches virtual character's attention:
  character stops typing, looks at pet, pets it, then resumes work (5s break, health benefit)

PET HEALTH ALERTS:
- If AI vision detects pet health concern (from PetWatch pipeline):
  pet avatar gets a small red health indicator
  virtual character speech bubble: "毛孩子好像不太舒服，检查一下？"
- If pet is detected as stressed/anxious:
  pet avatar shows stress animation (tail twitching for cats, pacing for dogs)
  virtual character: "宠物有点焦虑，去安抚一下~"

IMPLEMENTATION ARCHITECTURE:
- Webcam capture: existing monitor.ts capture pipeline, add secondary webcam feed
- AI vision: Qwen3-VL 8B model via vLLM (local inference) — detect pet presence/activity
- Pet feature extraction: extract dominant colors, pattern type, body shape → map to avatar template
- Avatar template system: pre-built 2D animated templates for:
  * Cat (10 variants: tabby/black/white/calico/siamese/ragdoll/persian/bengal/sphynx/maine-coon)
  * Dog (8 variants: golden/lab/poodle/husky/corgi/bulldog/shiba/beagle)
  * Other: bird/hamster/rabbit/fish (lower priority)
- Pet avatar rendered as separate transparent window (like virtual character window)
- Two windows can be merged into single overlay for performance
```

**中文精简版：**
```
真实宠物融合系统设计。

核心概念：用户的真实宠物通过摄像头+AI视觉出现在桌面——
不是直播视频而是风格化2D卡通动画版（与虚拟人同一动漫美学）。
宠物外观继承真实宠物特征：橘猫→橘色卡通猫，黑猫→黑卡通猫绿眼等。

宠物行为：
摄像头检测到宠物→宠物头像出现桌面慢速走动
AI视觉分析驱动行为：宠物睡觉→头像蜷缩角落；活跃→沿屏幕边缘走动；
看屏幕→坐在虚拟人旁一起看；吃东西→在食物碗图标旁吃。
离开摄像头30秒→头像淡出"毛孩子走了~"

宠物+虚拟人互动：
虚拟人见宠物→"嗨毛孩子！"挥手微笑反应
宠物靠近→虚拟人抚摸/摸头动画
双空闲→宠物蜷在虚拟人旁一起打盹
虚拟人专注/编码→宠物安静坐旁观看（像真猫在你桌上陪工作）
虚拟人干预模式→宠物也加入！坐角色旁加"喵~"/"汪~"气泡（双伙伴催你工作！）
宠物偶尔吸引虚拟人注意→角色停打字看宠物→摸5秒→恢复工作（健康益处）

宠物健康告警：
AI视觉检测健康问题→头像小红健康指示器→
虚拟人："毛孩子好像不太舒服，检查一下？"
宠物焦虑→头像焦虑动画（猫尾巴抖/狗来回走）→
虚拟人："宠物有点焦虑，去安抚一下~"

技术架构：
摄像头捕获 → monitor.ts采集管道加副摄像头
AI视觉 → Qwen3-VL 8B + vLLM本地推理检测宠物存在/活动
特征提取 → 主色/花纹/体型 → 映射头像模板
头像模板 → 预建2D动画模板：猫10变种/狗8变种/其他
宠物头像独立透明窗口（或与虚拟人合并为单overlay）
```

---

## 7. 多模型合并管理架构

### 7.1 三角色管理器

```
Design a multi-character manager for WorkMate that orchestrates three desktop character types:
1. Virtual Human (Buddy) — anime-style 2.5D human
2. Real Pet Avatar — cartoon-style 2D animal based on user's real pet
3. Desktop Sprite — low-poly 3D decorative creature (optional cosmetic)

MULTI-CHARACTER ORCHESTRATION:

Character Layer System (Z-ordering, front to back):
  Layer 3: Intervention barriers (when active, these are in front of everything)
  Layer 2: Virtual Human character (primary interaction agent)
  Layer 1: Real Pet Avatar (secondary, follows/interacts with Layer 2)
  Layer 0: Desktop Sprite (background decoration, slow roaming)
  Layer -1: Desktop wallpaper / other apps

Render Pipeline:
  All characters rendered on a SINGLE transparent overlay window (Electron BrowserWindow)
  with always-on-top, click-through (except during intervention blocking).
  Internal canvas: all three characters drawn on same canvas with proper layering.
  This avoids z-order conflicts between multiple windows.

Character State Synchronization:
  - All characters share the SAME WorkState source (from monitor engine)
  - Virtual Human: maps WorkState → human pose/animation (primary mapping, see §3)
  - Real Pet: maps WorkState → pet behavior (secondary mapping, simpler set of states)
  - Desktop Sprite: independent idle roaming (no WorkState mapping, pure decoration)

  When WorkState changes:
  1. Virtual Human transitions to new pose (0.3s morph + 2s walk-to-position if needed)
  2. Real Pet transitions to related behavior (1s simpler transition)
  3. Desktop Sprite: unaffected, continues roaming

CHARACTER INTERACTION MATRIX:

| Event | Virtual Human | Real Pet | Desktop Sprite |
|-------|--------------|----------|---------------|
| User starts coding | Goes to desk, types | Sits nearby, watches | Continues roaming |
| User starts slacking | Leaves desk, grabs phone | Walks to human, nuzzles | Avoids center area |
| Slack >15min | Phase 1 barrier | Sits beside barrier, meows | Hides in corner |
| User returns to work | Celebrates, walks back | Happy bounce, follows | Comes back out |
| Pet detected sleeping | — | Sleeps in corner | — |
| Pet detected active | — | Roams, pokes human | — |
| User clicks on pet | — | Surprise animation | — |
| User clicks on sprite | — | — | Surprise bounce |

CHARACTER SETTINGS UI:
In SettingsView, add a new "Characters" section:

┌─────────────────────────────────────────────┐
│  🎭 角色管理                                  │
│                                               │
│  ┌─ 虚拟人 ──────────────────────────────┐   │
│  │ 皮肤: [Aria▼] [Leo] [Luna]             │   │
│  │ 干预等级: Phase 0 ● 1 ● 2 ● 3 ●      │   │
│  │ 话语: ●开 ○关                           │   │
│  │ 漫游: ●开 ○关                           │   │
│  │ 鼠标交互: ●开 ○关                       │   │
│  └─────────────────────────────────────────┘   │
│                                               │
│  ┌─ 真实宠物 ────────────────────────────┐   │
│  │ 摄像头: [默认▼] [USB-2]                │   │
│  │ AI视觉: ●开 ○关 (Qwen3-VL本地)        │   │
│  │ 宠物类型: [猫▼] [狗] [其他]            │   │
│  │ 桌面显示: ●开 ○关                       │   │
│  │ 健康告警: ●开 ○关                       │   │
│  └─────────────────────────────────────────┘   │
│                                               │
│  ┌─ 桌面精灵 ────────────────────────────┐   │
│  │ 类型: [猫▼] [狗] [鸟] [龙] [狐狸]     │   │
│  │ 漫游速度: ●慢 ○中 ○快                  │   │
│  │ 显示: ●开 ○关                           │   │
│  └─────────────────────────────────────────┘   │
│                                               │
│  ┌─ 全局 ────────────────────────────────┐   │
│  │ 角色透明度: [0.92 ——————]             │   │
│  │ 干涉冷却: 5分钟/10分钟/15分钟          │   │
│  │ Ctrl+Shift+F 强制专注: ●开 ○关        │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────┘

PERFORMANCE OPTIMIZATION:
- Single overlay window reduces GPU overhead vs 3 separate windows
- Virtual Human: ~5000 tris + toon shader (moderate GPU)
- Real Pet: ~1000 tris + 2D sprite animation (low GPU)
- Desktop Sprite: ~500 tris + simple animation (minimal GPU)
- Total GPU impact: <5% on modern hardware
- Canvas-based rendering: requestAnimationFrame at 30fps,
  skip frames if system is under load (>80% CPU → reduce to 15fps)
```

**中文精简版：**
```
多角色管理架构设计。

三层角色系统（Z序，前→后）：
Layer 3: 干预屏障（激活时最前）
Layer 2: 虚拟人（主交互代理）
Layer 1: 真实宠物头像（次级，跟随/与Layer 2互动）
Layer 0: 桌面精灵（背景装饰，慢漫游）
Layer -1: 桌面壁纸/其他应用

渲染管线：所有角色在单透明overlay窗口(Electron BrowserWindow)内渲染，
always-on-top + click-through（干预遮挡除外）。单canvas绘制避免Z序冲突。

状态同步：所有角色共享同一WorkState源。
虚拟人→完整姿态动画映射(§3)
真实宠物→简化行为映射
桌面精灵→独立漫游不受WorkState影响

角色设置UI（设置页新增"角色管理"区块）：
- 虚拟人：皮肤选择/干预等级开关/话语开关/漫游开关/鼠标交互开关
- 真实宠物：摄像头选择/AI视觉开关(Qwen3-VL)/宠物类型/桌面显示开关/健康告警开关
- 桌面精灵：类型选择(猫/狗/鸟/龙/狐狸)/漫游速度/显示开关
- 全局：角色透明度/干涉冷却时间/Ctrl+Shift+F开关

性能优化：单overlay减GPU开销，虚拟人~5000面+toon shader，
宠物~1000面2D动画，精灵~500面简动画，总GPU<5%，30fps降15fps保护CPU。
```

---

## 8. UI 整体改造方案

### 8.1 主窗口改造

```
Redesign the WorkMate main window (1100×720) with a premium modern dark theme.

The main window serves as the "control center" for the productivity system,
while the actual interaction happens through the overlay characters on the desktop.

MAIN WINDOW LAYOUT:
┌──────────────────────────────────────────────────────┐
│ [状态栏] 🎯专注 · VSCode · 今日4h32m · 专注度92环    │ ← 48px glass strip
├────┬─────────────────────────────────────────────────┤
│ 📅 │                                                 │
│ 📊 │              内容区域                             │
│ 🔥 │           (8个视图切换)                            │
│    │                                                 │
│ 🎯 │                                                 │
│ 💬 │                                                 │
│    │                                                 │
│ 🧠 │                                                 │
│ 🐱 │                                                 │
│ ⚙️ │                                                 │
├────┴─────────────────────────────────────────────────┤
│ [底部] 角色状态: Aria·专注 · 宠物: 橘猫·睡觉 · 精灵:关 │ ← 32px info bar
└──────────────────────────────────────────────────────┘

LEFT NAVIGATION (56px):
- Icon-only with hover tooltip (Lucide icons, 20px, stroke variant)
- 3 visual groups separated by thin divider lines:
  Group 1 "监控": calendar / activity / flame (日历|监控|热度)
  Group 2 "计划": target / message-circle (计划|问答)
  Group 3 "AI+角色": brain / cat-with-sparkles / settings (画像|角色|设置)
- Active item: icon changes to filled variant, background has state-accent glow
  (focus → green glow, coding → blue glow, slack → red glow)
- Hover: icon scales 1.15x, subtle glow appears

TOP STATUS STRIP (48px):
Glass-card style strip with backdrop-filter blur.
Left section: StateBadge (animated color dot + state emoji + Chinese label + app name)
  State dot pulses on state change (1.5s animation)
  App name shown in text-muted color
Center section: "今日工作" duration counter (H2 font, text-primary) + mini sparkline of today's states
Right section: Focus score ProgressRing (28px) + raw score number

BOTTOM INFO BAR (32px):
Thin glass strip showing character status:
  "Aria·专注" | "橘猫·睡觉" | "精灵:关" — each with a tiny icon and state dot
  Clickable: clicking opens the BuddyView / Pet settings respectively

CONTENT AREA:
Full glass-card background with subtle state-aware gradient mesh:
  - A CSS gradient that slowly shifts color temperature based on WorkState
  - focus → green-tinted (#6bd8a8 at 5% opacity overlay)
  - coding → blue-tinted (#7c9eff at 5%)
  - slack → red-tinted (#ff7c7c at 8% — slightly stronger, urgency)
  - The gradient mesh uses 2-3 color stops positioned based on time of day
  - Animation: gradient position shifts slowly over 30s (ambient breathing effect)

VIEW TRANSITIONS:
When switching views: crossfade animation (0.25s, ease-out)
Old view fades out + slides left 20px, new view fades in + slides from right 20px
```

### 8.2 悬浮窗（Widget）改造

```
Redesign the WorkMate widget window (320×420, bottom-right corner, transparent always-on-top).

WIDGET IS THE PRIMARY QUICK-VIEW — it should feel like a "desk assistant display"
rather than a "monitoring panel".

WIDGET LAYOUT:
┌─────────────────────────────────────┐
│ ┌─ 角色卡 ──────────────────────┐   │ ← 动态背景区域
│ │  [虚拟人头像 64px]             │   │
│ │  🎯 专注 · VSCode · 32分钟     │   │
│ │  ──── 今日4h32m ──── 92环 ──  │   │
│ └────────────────────────────────┘   │
│                                       │
│ ┌─ 上下文卡 ────────────────────┐   │ ← 根据状态动态切换
│ │  [AI建议/摸鱼确认/宠物状态]    │   │
│ │  内容随WorkState变化           │   │
│ └────────────────────────────────┘   │
│                                       │
│ ┌─ 操作栏 ──────────────────────┐   │
│ │ [展开] [透明度—] [打开主面板]  │   │
│ └────────────────────────────────┘   │
└─────────────────────────────────────┘

DYNAMIC BACKGROUND:
The widget has a subtle animated gradient mesh background that shifts with WorkState:
- Focus/coding: cool blue-green gradient, gentle movement
- Slack: warm pink-orange gradient, faster movement (alert feel)
- Idle: dim lavender, nearly static (sleepy feel)
- Meeting: warm golden, steady (professional feel)
When slack >180s: entire widget opacity fades to 0.18 (existing behavior, but smoother transition)

CHARACTER CARD (top section):
- Virtual Human avatar: 64px rendered inline (2.5D mini version of the desktop character)
  NOT the old circle-face — the actual anime character in current pose, miniaturized
- State line: animated StateBadge + app name + duration
- Mini stats: "今日XXhXXm" + tiny focus score ring (24px)

CONTEXT CARD (middle section) — changes by WorkState:
  Working states → TipCard: AI suggestion for productivity
    "建议：接下来处理优先级最高的XX任务" + [采纳] [忽略] buttons
  Slack states → CheckCard: "还在摸鱼？确认/否定" + [我在休息] [回去工作] buttons
  Meeting → InfoCard: "会议中 · XX分钟后结束" + progress indicator
  Idle → RestCard: "休息中~记得喝水" + health reminder
  Pet detected → PetCard: "毛孩子在旁边~" + tiny pet avatar + health status

ACTION BAR (bottom section):
  Glass-button-row with 3 elements:
  - Expand/collapse button (icon: chevron-down/up)
  - Opacity slider (custom styled: accent track, glass thumb)
  - Open main panel button (icon: layout-dashboard)
  All buttons use glass-button style:
    bg-glass + border-subtle + rounded-12px + hover: border-active + glow
```

### 8.3 命令面板改造

```
Redesign the command palette (560×380, Ctrl+Space trigger).

LAYOUT:
┌──────────────────────────────────────────────┐
│ 🔍 搜索动作或输入计划...                       │ ← glass input
├──────────────────────────────────────────────┤
│  📅 日历视图                                  │
│  📊 监控大屏                                  │
│  🔥 工作热度                                  │ ← glass result items
│  🎯 计划管理                                  │
│  💬 问答回顾                                  │
│  🧠 AI画像                                    │
│  🐱 角色管理                                  │ ← NEW entry
│  ⚙️ 设置                                      │
│                                               │
│  ── 快捷动作 ──                                │ ← divider
│  ⌨️ Ctrl+Shift+F 强制专注                     │ ← NEW action
│  🖥️ 显/隐悬浮窗                               │
│  🔄 刷新AI画像                                │
│  🚪 退出                                      │
└──────────────────────────────────────────────┘

All items: glass-card hover style, keyboard nav (↑↓ + Enter + Esc)
Search input: glass-style with accent border on focus, Lucide search icon
New actions: "角色管理" and "强制专注" added to the palette
```

---

## 9. 图标与视觉资产体系

### 9.1 图标系统迁移

```
Replace all hand-drawn stroke SVG icons with Lucide icon library.

Lucide provides:
- Consistent 24×24 stroke-width 2 icon set
- Both stroke and filled variants (stroke for inactive, filled for active nav)
- 1000+ icons covering all needed categories

Icon mapping for WorkMate navigation:
  日历 → lucide:calendar
  监控 → lucide:activity
  度 → lucide:flame
  计划 → lucide:target
  问答 → lucide:message-circle
  画像 → lucide:brain
  角色 → lucide:cat (for pet) / lucide:user (for virtual human) — custom combined icon
  设置 → lucide:settings

Icon mapping for WorkState badges:
  专注 → lucide:crosshair (replaces emoji 🎯)
  摸鱼 → lucide:fish (replaces emoji 🐟)
  写作 → lucide:pencil-line (replaces emoji ✍️)
  编码 → lucide:code-2 (replaces emoji 💻)
  AI问答 → lucide:message-square (replaces emoji 💬)
  AI开发 → lucide:robot (replaces emoji 🤖)
  会议 → lucide:video (replaces emoji 📅)
  空闲 → lucide:moon (replaces emoji 💤)
  休息 → lucide:coffee (replaces emoji ☕)
  离开 → lucide:log-out (replaces emoji 🚶)
  放松 → lucide:music (replaces emoji 🎵)
  午休 → lucide:utensils (replaces emoji 🍚)
  远程 → lucide:monitor (replaces emoji 🖥️)

Additional icons for new features:
  强制专注 → lucide:shield-check
  角色管理 → lucide:users
  宠物 → lucide:cat / lucide:dog
  精灵 → lucide:sparkles
  干预 → lucide:shield-alert
  阻挡 → lucide:ban
  喝水 → lucide:droplets
  拉伸 → lucide:stretch-horizontal (custom)

APP ICON (taskbar/dock):
Design a unified app icon for WorkMate:
- Concept: an anime character face outline (simple, recognizable) inside a hexagonal shield
- The shield represents "focus protection" — the core product promise
- Colors: dark background (#0a0d14) + accent blue (#7c9eff) outline + green (#6bd8a8) highlight
- Formats: 16×16, 32×32, 48×48, 256×256 (ICO for Windows, ICNS for macOS)
- Style: flat icon, no 3D effects, clean geometric lines

Prompt for app icon:
"Design a flat geometric app icon for a desktop productivity companion app called WorkMate.
The icon features: a simple anime character face outline (two large eyes + small smile)
enclosed within a hexagonal shield shape (representing focus protection).
Colors: dark navy background, bright blue hexagonal outline, green accent highlight on eyes.
Clean flat style, no gradients, no 3D effects. Recognizable at 16px and elegant at 256px.
For Windows ICO and macOS ICNS formats."
```

---

## 10. 技术实现提示词汇总

### 10.1 虚拟人渲染引擎提示词

```
Implement a 2.5D anime virtual character renderer for the WorkMate Electron app.

Technical requirements:
- Use HTML5 Canvas 2D context for rendering (no WebGL needed for this style)
- Cel-shading effect achieved via:
  1. Draw base color fills for each body part
  2. Apply shadow/highlight overlays using clip paths (2-3 shade levels)
  3. Draw thick black outline contours around all edges (1.5px equivalent)
- Character sprites: pre-render sprite sheets for each state pose
  (8-12 key poses per state, 30fps animation → 240-360 frames per state)
  Total sprite sheet budget: ~15 states × 300 frames = 4500 frames
  At 200×200px per frame → ~9MB total sprite data (acceptable)
- Alternative: procedural animation using skeletal keyframes
  (skeleton: head/neck/shoulders/arms/hands/torso, ~12 joints)
  Keyframe animation: 5-8 keyframes per state loop, interpolated at 30fps
  This reduces sprite data to ~15 states × 8 keyframes = 120 keyframes
  Plus 3 skin variants × color palette swaps = manageable data budget
- Animation blending: 0.3s crossfade between state animations
  (blend weights: old_state decreasing, new_state increasing, linear interpolation)
- Character position: CSS transform on canvas element, animated via requestAnimationFrame
- Walking animation: separate walk-cycle keyframes, blended with state animation during position transitions

Sprite sheet generation prompt (for AI image generation tools):
"For each WorkState, generate a 200×200px anime-style character sprite sheet showing
the virtual character in the specified pose with cel-shading toon rendering.
Character: young anime professional, black T-shirt, [skin-specific hair/eye color],
[state-specific pose described in §3].
8 keyframes per animation cycle, arranged in 2×4 grid.
Black outline contours, 2-3 shade levels per surface, vibrant anime colors.
Transparent background (PNG with alpha)."
```

### 10.2 桌面漫游系统实现提示词

```
Implement a desktop character roaming system in WorkMate Electron app.

Architecture:
- Character overlay window: Electron BrowserWindow with:
  transparent: true, alwaysOnTop: true, skipTaskbar: true,
  frame: false, resizable: false,
  width: screen.width, height: screen.height (full screen overlay)
  setIgnoreMouseEvents(true) for click-through (except during intervention)
  webPreferences: offscreen rendering for performance

- Character rendering canvas: positioned absolutely within the overlay,
  character drawn at (x, y) position on the canvas
  Canvas size: matches character sprite size (200×200px area)
  Canvas position: animated via requestAnimationFrame moving (x,y)

- Position system:
  Default positions stored as {x_pct, y_pct} percentages of screen dimensions:
    focus: {right: 15%, bottom: 25%}  (near bottom-right, at mini-desk)
    coding: {right: 8%, bottom: 20%}  (closer to edge, hugging screen)
    slack-early: {center: 40%, left: 30%} (wandering center-left, on phone)
    slack-late: {center: 50%, center: 50%} (screen center for intervention)
    idle: {right: 5%, bottom: 5%} (corner, sleeping)
    meeting: {right: 20%, bottom: 30%} (at desk, attentive)
  Transition: animate from current position to target position over 2s
  Easing: cubic-bezier(0.4, 0, 0.2, 1)
  During transition: walk-cycle animation blended with current state animation

- Mouse interaction system:
  Level 0-1: visual-only (character looks at cursor, no actual mouse events)
  Level 2: visual pokes (character animation near cursor, no mouse override)
  Level 3: cursor advisory force —
    Register a timer that reads cursor position every frame (via Electron screen API)
    Calculate force vector toward target position (work app area / away from slack app)
    Apply advisory mouse-move event: ipcMain → send mouse-move to OS
    Force magnitude decays over 1-2s
    User can override by moving mouse harder (force is weak advisory, ~50-150px/s)
    Log intervention event with timestamp and slack duration
  Level 4: cursor zone restriction —
    Define "allowed zones" (work app windows, desktop area)
    Define "blocked zones" (slack app windows)
    If cursor enters blocked zone → advisory force pushes cursor to nearest allowed zone
    Force is stronger at this level (~200-300px/s) but still overrideable by determined movement
    Visual: character's hand animation overlaps cursor position (blocking gesture)
```

### 10.3 屏幕遮挡系统实现提示词

```
Implement the screen-blocking focus enforcement system for WorkMate.

Architecture:
- Barrier overlay: same Electron BrowserWindow as character overlay
  (shared canvas — character and barrier both drawn on same canvas)
- Barrier rendering:
  Phase 1: Draw hexagonal grid pattern at target area (20-25% screen)
    Each hexagon: filled with semi-transparent color, glowing edges
    Grid expands outward from character position over 1s animation
    Opacity: 0.3, color: warning yellow-orange (#ffb86b at 30% alpha)
  Phase 2: Same grid but cells are solid (no transparency between them)
    Expanded to 40-50% screen, opacity 0.5-0.6
    Color: stronger orange-red (#ff7c7c at 50% alpha)
    Edges glow brighter
  Phase 3: Nearly full screen (65-80%), opacity 0.7-0.85
    Solid red-orange blocks with WARNING text overlay
    Strongest edge glow, pulsing animation

- Barrier position logic:
    Detect slack app window position (via Electron screen API + window detection)
    Position barrier to cover slack app window area primarily
    Character stands in front of barrier center
    If user alt-tabs to new slack app → barrier repositions over new window

- Click-through toggle:
    Normal states: overlay window setIgnoreMouseEvents(true) (click-through)
    Intervention Phase 1: barrier area setIgnoreMouseEvents(false) for dismiss button only
    Intervention Phase 2+: entire overlay setIgnoreMouseEvents(false)
    BUT: allow keyboard shortcuts (Ctrl+Shift+F) via globalShortcut module
    User CANNOT click through barrier in Phase 2+

- Dismiss logic:
    Phase 1: dismiss button (X icon) visible → onclick → remove barrier,
      character reaction: frown + "好吧...但我会再来的"
      cooldown timer: 5min before next intervention (escalates to Phase 2 next time)
    Phase 2: no dismiss button. Only dismiss via:
      - Work state change detected (monitor engine detects work app in focus)
      - Ctrl+Shift+F global shortcut
      - 2min timeout → reduce to Phase 1 level
    Phase 3: same as Phase 2, plus auto-dismiss after 5min sustained work

- Daily report logging:
    Each intervention event logged with:
    {timestamp, slack_duration_min, intervention_phase, dismiss_method, user_response}
    Displayed in MonitorView as "干预记录" section
    Summary in AIView: "今日被提醒X次，平均摸鱼恢复时间Y分钟"

- Settings toggles:
    Per-phase enable/disable:
    Phase 0 (提醒): toggle
    Phase 1 (软遮挡): toggle
    Phase 2 (硬遮挡): toggle
    Phase 3 (全面封锁): toggle
    Cooldown duration: 5/10/15/20min selector
    Ctrl+Shift+F enable: toggle
    Intervention sound: toggle (optional gentle hum sound effect)
```

### 10.4 真实宠物系统实现提示词

```
Implement the real-pet integration system for WorkMate.

Architecture:
- Webcam capture: use Electron's desktopCapturer or navigator.mediaDevices.getUserMedia
  for secondary webcam feed (distinct from the monitor engine's screen capture)
  Capture rate: 1 frame per 5s (low frequency, just for pet detection)
  Send frame to Qwen3-VL 8B model via vLLM local inference server

- Pet detection pipeline:
  1. Capture webcam frame
  2. Send to Qwen3-VL with prompt: "Detect if there is a pet (cat/dog) in this image.
     If yes, describe: species, color pattern, body position, activity state (sleeping/playing/eating/looking_at_screen/anxious/stressed/normal)"
  3. Parse response → extract: pet_present (bool), species, colors, pattern, activity
  4. Map to pet avatar template: species → template selection, colors → template colorization
  5. Map activity → pet desktop behavior animation

- Pet avatar templates:
  Pre-built 2D animated sprite templates for each species variant
  Each template: 4-6 animation cycles (idle/walk/sleep/play/eat/alert)
  8 keyframes per cycle, 200×200px
  Color customization: replace base colors with detected pet colors
  (orange tabby → swap template orange values, black cat → swap to black values)

- Pet avatar rendering:
  Same overlay canvas as virtual human character
  Pet drawn at separate (x,y) position on canvas
  Z-layer: behind virtual human, in front of desktop
  Pet behavior animation driven by detected activity state
  Update frequency: every 5s (when new webcam frame processed)

- Pet-Virtual Human interaction:
  When pet avatar appears near virtual human → trigger interaction animation
  Interaction set: {pet_nuzzles_human, human_pets_pet, both_sleep, pet_watches_human_work,
                   both_intervene_user (pet+human blocking)}
  Interaction trigger: when pet (x,y) is within 100px of human (x,y)
  Interaction duration: 3-5s, then both resume independent behaviors

- Pet health alerts:
  If Qwen3-VL detects health concern keywords in response → trigger alert
  Alert: pet avatar gets red indicator dot, virtual human speech bubble with health warning
  Severity levels:
    Low: "毛孩子好像有点不安~" (pet detected anxious)
    Medium: "宠物状态不太对，检查一下？" (unusual behavior pattern)
    High: "宠物可能需要关注！请查看" (detected distress signals)
```

---

## 📌 附录：给代码编辑器的快速参考

### A. 关键 CSS Custom Properties

```css
:root {
  /* Backgrounds */
  --bg-deep: #0a0d14;
  --bg-surface: #12161f;
  --bg-elevated: #1a2030;
  --bg-glass: rgba(18, 22, 31, 0.75);

  /* Borders */
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-active: rgba(124, 158, 255, 0.3);

  /* Text */
  --text-primary: #e8edf5;
  --text-secondary: #8a93a6;
  --text-muted: #5a6478;

  /* Semantic Colors */
  --accent-focus: #6bd8a8;
  --accent-work: #7c9eff;
  --accent-ai: #9b8cff;
  --accent-slack: #ff7c7c;
  --accent-warm: #ffb86b;
  --accent-meeting: #67e8f9;

  /* Glow Shadows */
  --glow-focus: 0 0 20px rgba(107, 216, 168, 0.15);
  --glow-work: 0 0 20px rgba(124, 158, 255, 0.15);
  --glow-slack: 0 0 20px rgba(255, 124, 124, 0.15);

  /* Typography */
  --font-primary: 'Inter', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Consolas', monospace;

  /* Radius */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;

  /* Transitions */
  --transition-fast: 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}
```

### B. Glass-Card 组件模板

```css
.glass-card {
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(12px) saturate(1.2);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3),
              inset 0 1px 0 rgba(255, 255, 255, 0.04);
  padding: 16px;
  transition: all var(--transition-normal);
}

.glass-card:hover {
  border-color: var(--border-active);
  box-shadow: var(--glow-work), 0 4px 24px rgba(0, 0, 0, 0.3);
  transform: translateY(-2px);
}

.glass-card[data-state="focus"] {
  border-color: rgba(107, 216, 168, 0.3);
  box-shadow: var(--glow-focus), 0 4px 24px rgba(0, 0, 0, 0.3);
}

.glass-card[data-state="slack"] {
  border-color: rgba(255, 124, 124, 0.3);
  box-shadow: var(--glow-slack), 0 4px 24px rgba(0, 0, 0, 0.3);
}
```

### C. Glass-Button 组件模板

```css
.glass-btn {
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  backdrop-filter: blur(8px);
  padding: 8px 16px;
  color: var(--text-primary);
  font: 13px/1 var(--font-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.glass-btn:hover {
  border-color: var(--border-active);
  background: rgba(124, 158, 255, 0.1);
}

.glass-btn:active {
  transform: scale(0.97);
  border-color: var(--accent-work);
}
```

### D. 干预屏障六角网格 SVG/CSS 模板

```css
.focus-barrier {
  position: absolute;
  pointer-events: none; /* Phase 1: click-through except dismiss btn */
  /* Phase 2+: pointer-events: all */

  /* Hexagonal grid via SVG background */
  background-image: url("data:image/svg+xml,..."); /* inline SVG hex grid pattern */

  opacity: 0.3; /* Phase 1 */
  /* Phase 2: opacity: 0.55 */
  /* Phase 3: opacity: 0.8 */

  border: 2px solid rgba(255, 184, 107, 0.5); /* Phase 1: orange */
  /* Phase 2: border-color: rgba(255, 124, 124, 0.7) */
  /* Phase 3: border-color: rgba(255, 60, 60, 0.9) */

  border-radius: var(--radius-lg);
  backdrop-filter: blur(4px); /* slight blur on barrier itself */
  animation: barrier-pulse 2s ease-in-out infinite;
}

@keyframes barrier-pulse {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 0.35; }
}
```

### E. 完整 WorkState → 角色行为映射表

| WorkState | 虚拟人位置 | 虚拟人姿态 | 虚拟人表情 | 宠物行为 | 屏幕效果 |
|-----------|----------|----------|----------|---------|---------|
| focus | 右下桌前 | 前倾10°打字 | 眼眯聚焦、嘴薄线 | 安静坐旁 | 右5%绿渐变条 |
| coding | 右下贴屏 | 前倾15°狂敲 | V眉圆眼紧嘴 | 坐旁看 | 绿终端粒子 |
| writing | 右下桌前 | 端正笔写 | 右眉抬嘴微抿 | 安静 | 薰衣草蓝光 |
| aiqa | 桌前侧看AI | 托腮+抬手 | 圆眼好奇嘴微张 | — | 紫数据流线 |
| aidev | 桌前共创 | 接收+筛选手势 | 瞳放大V眉 | — | 紫绿阴阳漩涡 |
| meeting | 桌前端正 | 职业手势 | 注视微笑 | — | 金色稳光环 |
| slack(<15min) | 中央左坐地 | 抱手机瘫坐 | 半闭眼微笑 | 走近蹭 | 橙粉暖光 |
| slack(15-30min) | 向中心走 | 放手机站起 | 愧疚抬头 | 站旁喵 | 屏障Phase1 |
| slack(30-60min) | 中心挡屏 | 双手叉腰站 | 愤怒V眉 | 加入阻挡 | 屏障Phase2 |
| slack(>60min) | 中心大面积 | 手展开怒站 | 极怒喊嘴 | 加入 | 屏障Phase3 |
| idle | 右下角蜷 | 趴地闭眼 | 睡眼鼾点 | 蜷旁睡 | 暗暮光 |
| break | 一角休息区 | 握杯后仰 | 眯笑腮红 | 走近 | 暖金光 |
| away | 右下角虚化 | 半透明 | 空洞半闭 | — | 极暗 |
| relax | 中央右游荡 | 听音乐摆 | 大笑腮红 | 玩耍 | 彩虹光 |
| lunch | 一角用餐 | 碗筷入口 | 满足笑腮红 | 等食 | 暖琥珀光 |
| remote | 桌前双屏 | 指点双屏 | 警觉嘴微抿 | — | 青白双光 |
| debug | 贴屏极端 | 抱额急敲 | V皱圆眼咬唇 | — | 红脉冲0.8s |
| celebrating | 中心站起 | 拳头高举 | 大笑腮红 | 跳跃 | 金色星爆 |
| stressed | 中心 | 双手抱头 | 内皱圆颤咬唇 | 避开 | 红紊乱脉冲 |
| exhausted | 趴桌 | 瘫摊 | 半闭无力 | — | 极暗月光 |
| urgent | 贴屏极端 | 双手键盘急 | 强V皱瞳小 | — | 红0.6s急脉 |
| health | 一侧伸展 | 举瓶伸展 | 眯笑腮红 | 看着 | 蓝绿活力光 |
| learning | 桌前看书 | 托腮翻页 | 好奇思索 | 坐旁 | 蓝白求知光 |

---

**文档结束。以上所有提示词可直接提供给 Cursor/Copilot/Claude Code 等 AI 代码编辑器作为开发素材和设计指导。**
