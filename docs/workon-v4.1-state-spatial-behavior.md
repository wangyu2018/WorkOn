# WorkOn v4.1 状态空间行为补充规格
## 虚拟人按工作状态的全屏空间表现（专注小头 / 摸鱼陪伴 / 趴地等）

> **版本**：v4.1-supplement  
> **日期**：2026-07-21  
> **目标**：把每种工作状态精确映射到虚拟人的**屏幕位置、缩放比例、身体姿态、骨骼角度、入场/退场动画**，让角色真正"活在桌面"上。

---

## 1. 状态空间行为总览

### 1.1 设计原则

```
1. 用户专注时 → 角色尽量小、尽量不打扰、只给最小存在感
2. 用户摸鱼时 → 角色变大、变近、变互动、陪用户一起"玩"
3. 用户办公时 → 角色在视野边缘待命，可随时响应但不抢戏
4. 用户疲惫时 → 角色表现关心，缩到角落或趴下休息
5. 用户休息时 → 角色主动拉用户去休息
6. 每次状态切换必须有 0.5-2s 的过渡动画，不能瞬切
```

### 1.2 核心状态矩阵

| 工作状态 | 空间策略 | 默认位置 | 缩放 | Z层 | 身体姿态关键词 |
|---------|---------|---------|------|-----|---------------|
| **深度专注** | 最小打扰 | 屏幕底边探头 | 0.35x-0.5x | 可被窗口遮挡 | 只露小头，耳朵警觉 |
| **一般办公** | 边缘待命 | 右下角/左下角站立 | 0.8x-1.0x | 中间层 | 自然站立，微动 |
| **编程中** | 协助姿态 | 代码窗口右侧/上方 | 0.9x-1.1x | 前景（半透明） | 单手托腮看屏幕，偶尔指 |
| **写文档** | 安静陪伴 | 屏幕侧边坐着 | 0.8x-1.0x | 中后层 | 盘腿坐，手持羽毛笔 |
| **AI问答中** | 交流姿态 | 屏幕中央偏下 | 1.2x-1.5x | 前景 | 正对用户，手势讲解 |
| **AI开发中** | 围观姿态 | 代码窗口左上角 | 0.7x-0.9x | 后层 | 趴桌探头看代码 |
| **摸鱼/娱乐** | 一起摸鱼 | 屏幕侧边或窗口旁 | 1.0x-1.3x | 前景 | 坐着晃腿、趴地、歪头看 |
| **会议中** | 正式待命 | 屏幕底边正中 | 0.7x-0.9x | 后层 | 端坐，双手放膝 |
| **番茄钟-专注** | 倒计时中心 | 屏幕角落/任务栏 | 0.5x-0.7x | 顶层 | 头顶粒子倒计时 |
| **番茄钟-休息** | 拉人休息 | 屏幕中央/鼠标旁 | 1.3x-1.6x | 顶层 | 拖拽鼠标或张开双臂挡 |
| **过度劳累** | 关心姿态 | 屏幕角落 | 0.6x-0.8x | 中后层 | 趴地、蜷缩、叹气 |
| **睡眠/离开** | 休眠 | 任意角落 | 0.5x-0.7x | 最底层 | 蜷缩成球 |
| **全局问答** | 交流中心 | 屏幕中央 | 1.3x-1.8x | 前景 | 站立演讲姿态 |
| **屏幕遮挡** | 强制干预 | 屏幕中央 | 2.0x-2.5x | 最顶层 | 张开双臂，直视用户 |
| **下班提醒** | 温馨提醒 | 屏幕中央偏下 | 1.1x-1.4x | 前景 | 挥手、指时钟 |
| **加班确认** | 认真确认 | 屏幕中央 | 1.2x-1.5x | 前景 | 双手抱胸，严肃脸 |

---

## 2. 各状态空间行为详细规格

### 2.1 深度专注（Deep Focus）— "只冒个小头"

#### 2.1.1 空间参数

```
目标：用户高度专注，角色必须最小化存在感，但不能消失。

默认位置：
  - 主屏底部中央偏右（避开开始菜单/任务栏图标）
  - x = screenWidth × 0.70  （可配置 L/C/R）
  - y = screenHeight - taskbarHeight - 20px
  - 身体 80% 在屏幕下方，只有头部从屏幕底边探出

缩放：0.40x（默认）
  - 可自适应：屏幕越大 → 比例越小（27寸以上 0.35x，笔记本 0.45x）
  - 用户设置"极简模式" → 0.30x

Z层：
  - 默认在窗口后层（可被浏览器/代码编辑器遮挡）
  - 只有当她想提醒时才会短暂走到前景

碰撞：
  - 点击头部区域 → 弹出快捷菜单（静音/问候/查看状态）
  - 点击身体区域（屏幕外）→ 无效
```

#### 2.1.2 骨骼姿态（精确角度）

```
角色锚点：脚底在屏幕下方 80% 身体高度处（即 y = screenHeight + height×0.8）

spine_01:  x=0°  y=0°  z=0°（脊柱中立）
spine_02:  x=5°  y=0°  z=0°（上半身微微前倾探头）
spine_03:  x=8°  y=0°  z=0°
neck_01:   x=-15° y=0°  z=0°（脖子前伸抬头看屏幕）
head:      x=-20° y=0°  z=0°（脸正对上方屏幕）

 shoulders: x=0°  y=0°  z=0°（肩膀不动）
 upperarm_L/R: x=0°  y=0°  z=0°
 forearm_L/R:  x=0°  y=0°  z=0°
 hand_L/R:     x=0°  y=0°  z=0°

leg: 完全在屏幕外，可忽略或保持站立微屈
 thigh_L/R: x=0°   y=0° z=0°
 calf_L/R:  x=10°  y=0° z=0°

BlendShape:
  eyeBlinkLeft/Right: 0.0（睁眼警觉）
  browInnerUp: 0.1（轻微好奇）
  browOuterUpLeft/Right: 0.15（狐耳感警觉）
  mouthSmile: 0.05（极淡微笑）
  mouthPucker: 0.0
  eyeWideLeft/Right: 0.1（眼睛睁大一点点）
```

#### 2.1.3 入场动画

```
触发：从其他状态进入 DeepFocus

Sequence:
  Phase 1 (0.0-0.3s): 当前姿态 → 蹲下准备
    - spine快速弯曲，身体下沉
    - scale 1.0x → 0.6x
    - 位置向屏幕底边移动

  Phase 2 (0.3-1.0s): 钻到屏幕下方
    - 继续下沉，y 超过 screenHeight
    - scale 0.6x → 0.4x
    - 头部最后保持可见
    - 特效：身体边缘淡出（opacity 1.0→0.0，从脚到头）

  Phase 3 (1.0-1.5s): 探头定位
    - 头从底边冒出
    - 头部做 small wobble（左右各3°） settling
    - 眼睛眨一下，耳朵抖动一次

Easing: ease-in-out-back（探头时有轻微回弹）
```

#### 2.1.4 持续微行为

```
频率（每分钟）：
  eye_blink: 12-15 次（比正常少，表示专注观察）
  ear_twitch: 2-3 次（听到键盘声/鼠标声反应）
  head_bob: 1-2 次（轻微点头）
  gaze_track: 持续追踪鼠标/光标（滞后 0.3s）
  peek_more: 5% 概率多冒出一点肩膀（0.5s 后收回）

触发提醒时：
  - 头部从 0.4x 放大到 0.6x
  - 身体多冒出 20%
  - 头顶出现青色感叹号粒子
  - 3s 后如果没有交互，恢复最小状态
```

---

### 2.2 摸鱼/娱乐（Slacking）— "在旁边一起看"

#### 2.2.1 空间参数

```
目标：用户在看视频/刷社交媒体/玩游戏，角色加入"一起摸鱼"。

默认位置（根据用户当前窗口动态选择）：
  场景 A：浏览器/视频窗口在屏幕中央
    - 角色坐在窗口右侧边缘外 20px
    - x = videoWindow.right + 20px
    - y = videoWindow.bottom - 180px
    - 面朝窗口方向（z-rotation 微调）

  场景 B：全屏游戏/视频
    - 角色缩到角落（右下角或左下角）
    - x = screenWidth × 0.88
    - y = screenHeight × 0.75
    - scale = 0.7x（不挡画面）

  场景 C：桌面无焦点窗口
    - 角色坐在屏幕中央偏下
    - x = screenWidth × 0.5
    - y = screenHeight × 0.6
    - scale = 1.1x

缩放：0.9x-1.3x（根据窗口大小自适应）

Z层：
  - 默认前景（半透明 0.85-0.95）
  - 全屏娱乐时：中景（避免遮挡关键 UI）

互动：
  - 角色会偶尔笑、歪头、指屏幕
  - 检测到视频播放 5min+ → 角色打哈欠、提示"还看？"
```

#### 2.2.2 骨骼姿态

```
坐姿（最常见）:
  anchor = 臀部位置
  hip:      x=90°  y=0°  z=0°（坐下，大腿水平）
  thigh_L:  x=90°  y=-15° z=10°（左腿微外展）
  thigh_R:  x=90°  y=15°  z=-10°（右腿微外展）
  calf_L:   x=90°  y=0°  z=0°（小腿下垂）
  calf_R:   x=85°  y=0°  z=0°（右腿略收）
  foot_L/R: x=15°  y=0°  z=0°（脚尖自然下垂）

  spine_01: x=-5° y=0° z=0°（稍微驼背放松）
  spine_02: x=-8° y=0° z=0°
  spine_03: x=-5° y=0° z=5°（身体微微侧向屏幕）
  neck_01:  x=-10° y=0° z=-5°（头转向屏幕）
  head:     x=-5°  y=10° z=-5°（歪头看屏幕）

  upperarm_L: x=-20° y=20° z=-10°（左手撑地/撑椅）
  forearm_L:  x=-40° y=0°  z=0°
  upperarm_R: x=-30° y=-30° z=20°（右手指向/托腮）
  forearm_R:  x=-60° y=0°  z=0°

趴地姿态（变体1）:
  当检测到用户摸鱼超过 10min，30% 概率切换为趴地
  hip: x=0° y=0° z=0°（趴平）
  spine_01/02/03: x=-85°~-90°（几乎平躺）
  upperarm_L/R: x=-90° y=±30° z=0°（手臂前伸，像猫趴）
  head: x=30° y=0° z=0°（抬头看屏幕）
  thigh: x=0° y=0° z=0°，calf 向上微弯

BlendShape:
  eyeBlinkLeft/Right: 正常 18/min
  browInnerUp: 0.0（放松眉）
  cheekPuff: 0.1（微微鼓脸，可爱）
  mouthSmile: 0.25-0.45（开心/坏笑）
  mouthOpen: 0.05-0.15（看入神时张嘴）
  noseWrinkle: 0.05（看到好笑内容）
```

#### 2.2.3 入场动画

```
触发：从 DeepFocus/Working 进入 Slacking

Sequence:
  Phase 1 (0.0-0.5s): 从屏幕底边/角落快速升起
    - y 从 screenHeight+100 移动到目标 y
    - scale 0.4x → 1.0x
    - 身体旋转从探头姿态恢复直立

  Phase 2 (0.5-1.2s): 走到目标位置
    - WALK_FAST 或 RUN 动画
    - 路径略带弧线（不是直线）
    - 到达后做 small spin（转一圈坐下）

  Phase 3 (1.2-2.0s): 坐下 settling
    - hip 旋转到 90°，身体下沉
    - 腿自然摆动几下 settling
    - 头歪向屏幕，眨眼，微笑

特效：
  - 出现小云朵坐垫（0.5s 淡入）
  - 心情粒子：根据内容类型（视频→音符，游戏→像素块，社交→爱心/气泡）
```

#### 2.2.4 "一起看" 互动行为

```
检测到用户观看视频/娱乐内容时：
  1. 角色眼睛注视屏幕方向（不是鼠标）
  2. 每 30-60s 做一次反应：
     - 微笑加深（cheekPuff +0.1）
     - 轻笑点头
     - 手指屏幕
     - 歪头换边
  3. 内容静止超过 10s：
     - 角色转头看用户
     - 露出"你怎么不看了？"表情
  4. 摸鱼时间过长（>20min）：
     - 角色表情从开心变担忧
     - 站起来走到屏幕中央
     - 提示"今天的进度没问题吗？"

鼠标悬停角色时：
  - 角色抬头看鼠标
  - 可选语音："一起看吗？" / "这个有意思~"
```

---

### 2.3 编程中（Coding）— "在代码旁待命"

#### 2.3.1 空间参数

```
默认位置：
  - 代码编辑器窗口右侧外 30px
  - x = codeEditor.right + 30px
  - y = codeEditor.top + 100px（对齐代码区域）
  - 如果右侧空间不足，移到左侧

缩放：1.0x（标准大小）

Z层：中景（半透明 0.9，被代码窗口遮挡）

特殊：
  - 检测到连续编码 25min → 角色指着屏幕做"休息"手势
  - 检测到 debug 停滞 5min → 角色托腮思考
  - 检测到编译成功 → 角色跳起来小庆祝
```

#### 2.3.2 骨骼姿态

```
站立待命：
  spine_01: x=0° y=0° z=0°
  spine_02: x=2° y=0° z=0°
  spine_03: x=3° y=0° z=-5°（微微侧身向屏幕）
  neck_01: x=-5° y=0° z=5°
  head: x=0° y=5° z=0°（看代码方向）

  upperarm_L: x=0° y=10° z=0°
  forearm_L: x=-90° y=0° z=0°（左手叉腰）
  hand_L: x=0° y=0° z=0°
  upperarm_R: x=-40° y=-20° z=10°
  forearm_R: x=-90° y=0° z=0°（右手伸出指代码）
  hand_R: x=0° y=0° z=0°，食指伸直

托腮思考（debug 时）：
  spine_01: x=5° y=0° z=0°（前倾）
  upperarm_R: x=-30° y=-40° z=20°
  forearm_R: x=-90° y=0° z=0°
  hand_R: 托住下巴
  head: x=10° y=15° z=5°（歪头思考）

BlendShape:
  browInnerUp: 0.2（专注皱眉）
  mouthFrown: 0.05-0.15（根据 bug 严重程度）
  eyeSquintLeft/Right: 0.1（眯眼盯代码）
```

---

### 2.4 写文档中（Writing）— "安静陪伴"

#### 2.4.1 空间参数

```
默认位置：
  - 文档窗口左下角或右下角
  -  sitting on the floor beside the window
  - x = documentWindow.left - 80px 或 right + 80px
  - y = documentWindow.bottom - 120px

缩放：0.85x

姿态：盘腿坐或跪坐，手持羽毛笔/钢笔
```

#### 2.4.2 骨骼姿态

```
盘腿坐：
  hip: x=0° y=0° z=0°（坐地）
  thigh_L: x=45° y=-45° z=0°
  thigh_R: x=45° y=45° z=0°
  calf_L: x=-90° y=0° z=0°
  calf_R: x=-90° y=0° z=0°
  spine: 直立轻微前倾
  upperarm_R: 手持笔，在空气中写写画画
  head: 低头看地面/抬头看用户交替

羽毛笔动画：
  - 每 3-5s 在空中写一个字
  - 笔尖带金色墨迹粒子
  - 墨迹 1s 后消散
```

---

### 2.5 AI 问答中（AI Chat）— "交流中心"

#### 2.5.1 空间参数

```
默认位置：
  - 屏幕中央偏下
  - x = screenWidth × 0.5
  - y = screenHeight × 0.55

缩放：1.4x（放大以强调对话重要性）

Z层：前景

特殊：
  - 用户输入问题时，角色做"倾听"姿态
  - AI 回答时，角色做"讲解"手势
  - 回答结束，角色恢复较小 size 退到边缘
```

#### 2.5.2 骨骼姿态

```
讲解姿态：
  spine_01: x=0° y=0° z=0°
  spine_02: x=-3° y=0° z=0°
  spine_03: x=-5° y=0° z=0°（微微后仰，自信）
  neck_01: x=-5° y=0° z=0°
  head: x=0° y=0° z=0°（正对用户）

  upperarm_L: x=-30° y=40° z=0°（左手摊开）
  forearm_L: x=-60° y=0° z=0°
  upperarm_R: x=-40° y=-50° z=0°（右手比划）
  forearm_R: x=-70° y=0° z=0°

BlendShape:
  mouthSmile: 0.3
  browInnerUp: 0.1
  eyeWide: 0.1
```

---

### 2.6 AI 开发中（AI Coding）— "围观代码"

#### 2.6.1 空间参数

```
默认位置：
  - 代码窗口左上角或右上角边缘
  - x = codeEditor.left - 40px
  - y = codeEditor.top + 60px

缩放：0.75x（较小，不挡代码）

姿态：趴在窗口边框上，只露头看代码
```

#### 2.6.2 骨骼姿态

```
趴边框：
  spine_01: x=45° y=0° z=0°（身体趴在边框上）
  spine_02: x=30° y=0° z=0°
  spine_03: x=15° y=0° z=0°
  neck_01: x=-30° y=0° z=0°（抬头看代码）
  head: x=-15° y=0° z=0°

  upperarm_L/R: x=-70° y=±20° z=0°（手肘撑在边框）
  forearm_L/R: x=-60° y=0° z=0°（手托脸或悬空）
  leg: 悬空自然下垂

BlendShape:
  eyeSquint: 0.15
  browInnerUp: 0.25（"这代码有点东西"）
  mouthSmile: 0.1
```

---

### 2.7 会议中（Meeting）— "正式待命"

#### 2.7.1 空间参数

```
默认位置：
  - 屏幕底边正中，坐姿
  - x = screenWidth × 0.5
  - y = screenHeight - taskbarHeight - 50px

缩放：0.75x

Z层：后层（被会议窗口自然遮挡）

姿态：端坐，双手放膝，偶尔点头
```

#### 2.7.2 骨骼姿态

```
端坐：
  hip: x=90° y=0° z=0°
  thigh: x=90° y=0° z=0°
  calf: x=90° y=0° z=0°
  spine: 挺直
  upperarm_L/R: x=0° y=0° z=0°（自然下垂）
  forearm_L/R: x=0° y=0° z=0°
  hand_L/R: 放大腿上

BlendShape:
  mouthSmile: 0.1（礼貌微笑）
  eyeBlink: 15/min
  browInnerUp: 0.0
```

---

### 2.8 番茄钟专注（Pomodoro Focus）— "倒计时光环"

#### 2.8.1 空间参数

```
默认位置：
  - 屏幕右上角或左上角
  - x = screenWidth × 0.92
  - y = screenHeight × 0.08

缩放：0.55x（最小打扰）

特效：
  - 头顶有一个发光的倒计时环
  - 环的颜色随剩余时间变化：
    - >60%: 青色 #50C878
    - 30-60%: 黄色 #FFD700
    - <30%: 红色 #FF4444
  - 环上显示 MM:SS 数字
```

#### 2.8.2 骨骼姿态

```
蹲坐/盘腿漂浮：
  hip: x=0° y=0° z=0°（漂浮坐姿）
  thigh: x=60° y=±30° z=0°
  calf: x=-90° y=0° z=0°
  spine: 挺直
  upperarm_L/R: 结印姿势或放在膝上
  head: 闭眼冥想状

BlendShape:
  eyeBlink: 8/min（冥想少眨眼）
  mouthSmile: 0.15
  jawOpen: 0.0
```

---

### 2.9 番茄钟休息（Pomodoro Break）— "拉人去休息"

#### 2.9.1 空间参数

```
默认位置：
  - 屏幕中央或鼠标附近
  - x = mouseX + 100px（不挡鼠标）
  - y = mouseY - 150px

缩放：1.5x（放大强调）

行为：
  - 拖拽鼠标去休息区
  - 或张开双臂做"暂停"手势
  - 或躺在屏幕中央挡住部分工作区
```

#### 2.9.2 骨骼姿态

```
拦路姿态：
  spine: 挺直，双臂张开
  upperarm_L: x=0° y=90° z=0°
  upperarm_R: x=0° y=-90° z=0°
  forearm_L/R: x=0° y=0° z=0°
  head: 正对用户，表情认真

躺平挡屏幕：
  spine: x=-90°（平躺）
  arms: 向两侧张开
  legs: 伸直
  head: 抬起看用户
  expression: "不让你工作"的坏笑
```

---

### 2.10 过度劳累（Overworked）— "关心姿态"

#### 2.10.1 空间参数

```
默认位置：
  - 屏幕角落（不打扰但可见）
  - x = screenWidth × 0.10
  - y = screenHeight × 0.75

缩放：0.7x

姿态：
  - 趴在地上，脸朝下
  - 或蜷缩在角落
  - 或坐着叹气

特效：
  - 周围有暗淡的灰色粒子
  - 角色发光减弱 30%
```

#### 2.10.2 骨骼姿态

```
趴地休息：
  spine_01/02/03: x=-85°~-90°
  arms: 前伸，手掌朝下
  head: 侧脸贴地，一只眼睛看用户
  legs: 伸直或微弯

蜷缩角落：
  hip: x=0° y=0° z=0°
  thigh: x=90° y=±30° z=0°
  calf: x=-90° y=0° z=0°
  spine: 弯曲成 C 形
  arms: 抱住膝盖
  head: 埋在膝盖上

BlendShape:
  mouthFrown: 0.2
  browInnerUp: 0.3
  eyeSquint: 0.1
  cheekPuff: 0.0
```

---

### 2.11 睡眠/离开（Sleeping/AFK）— "休眠"

#### 2.11.1 空间参数

```
默认位置：
  - 最后所在位置，或预设"床位"（如屏幕右下角）
  - x = screenWidth × 0.90
  - y = screenHeight × 0.80

缩放：0.6x

特效：
  - 呼吸光效（opacity 0.3-0.5 脉动）
  - Zzz 粒子从头部升起
  - 周围有梦境气泡（可选）
```

---

### 2.12 全局问答（Global Chat Cmd+K）— "居中展示"

#### 2.12.1 空间参数

```
默认位置：
  - 屏幕中央偏下
  - x = screenWidth × 0.5
  - y = screenHeight × 0.50

缩放：1.5x-1.8x

Z层：前景

入场：
  - 从当前位置快速滑到中央
  - 或从屏幕底部升起
  - scale 放大
```

---

### 2.13 屏幕遮挡提醒（Screen Block）— "强制干预"

#### 2.13.1 空间参数

```
默认位置：
  - 屏幕正中央
  - x = screenWidth × 0.5
  - y = screenHeight × 0.45

缩放：2.0x-2.5x

Z层：最顶层（配合半透明遮罩层）

姿态：
  - 双臂张开
  - 或双手叉腰严肃脸
  - 或走过来挡住屏幕
```

---

## 3. 通用过渡与移动规则

### 3.1 状态切换过渡

```
所有状态切换必须通过 0.5-2.0s 的过渡动画，不能瞬切。

过渡类型：
  A. 行走过渡（Walk Transition）
     - 角色从当前位置走到目标位置
     - 同时 blend 姿态
     - 用于：Working↔Coding, Slacking↔Writing

  B. 缩放进出过渡（Scale Transition）
     - 用于：DeepFocus（缩到屏幕下）、Global Chat（放大）
     - 结合位置移动 + scale 变化

  C. 钻入/钻出过渡（Peel Transition）
     - 用于：DeepFocus（从底边探头）、Screen Block（从屏幕外走入）
     - 身体从屏幕边缘滑入/滑出

  D. 漂浮过渡（Float Transition）
     - 角色漂浮到目标位置
     - 用于：Pomodoro、冥想状态

  E. 奔跑冲刺过渡（Run Transition）
     - 用于紧急情况：Overworked提醒、下班提醒
     - 角色快速跑到目标位置

过渡优先级：
  - 打断规则：新状态优先级高于旧状态
  - 如果正在做微行为，先完成当前动作再切换
  - 紧急状态（Screen Block / 番茄钟休息）可立即打断
```

### 3.2 移动路径规划

```
目标点选择权重：
  - 用户当前工作窗口附近：+40%
  - 鼠标位置附近（但不挡鼠标）：+20%
  - 图标空白区：+15%
  - 桌面边缘/角落：+10%
  - 上次位置附近（惯性）：+15%

移动速度：
  - 正常漫步：80-120 px/s
  - 快步：150-250 px/s
  - 奔跑：300-500 px/s
  - 漂浮：50-100 px/s

路径曲线：
  - 默认使用二次贝塞尔曲线，带轻微弧线
  - 紧急情况用直线
  - 避开鼠标：路径与鼠标保持 ≥150px 距离
```

### 3.3 缩放规则

```
全局缩放公式：
  baseScale = 用户设置（默认 1.0）
  stateScale = 状态缩放系数（见各状态）
  distanceScale = 远近感系数（可选 0.8-1.2）
  finalScale = baseScale × stateScale × distanceScale

缩放动画：
  - duration: 0.3-0.8s
  - easing: ease-out-back（有弹性）

最小/最大限制：
  - 最小 0.25x（DeepFocus 极小探头）
  - 最大 2.5x（Screen Block）
```

### 3.4 遮挡与层级规则

```
Z层枚举：
  DESKTOP_BG = 0      // 壁纸层，被所有窗口遮挡
  WINDOW_BACK = 1     // 普通窗口后
  WINDOW_MID = 2      // 与普通窗口同层
  WINDOW_FRONT = 3    // 普通窗口前（半透明）
  TOPMOST = 4         // 永远最顶层（提醒/遮挡）

默认层级策略：
  - DeepFocus: DESKTOP_BG / WINDOW_BACK
  - Coding: WINDOW_BACK
  - Slacking: WINDOW_FRONT（半透明）
  - AI Chat: WINDOW_FRONT
  - Pomodoro Focus: TOPMOST
  - Screen Block: TOPMOST
  - Global Chat: WINDOW_FRONT

层级切换动画：
  - 层级变化时 opacity 先降到 0.3，再升到目标值
  - duration: 0.4s
```

---

## 4. 多显示器与分辨率适配

```
主显示器 = 鼠标当前所在显示器
角色默认跟随主显示器

跨屏行为：
  - 用户工作窗口移动到另一屏幕 → 角色延迟 1s 后走过去
  - 角色走到屏幕边缘 → 0.3s 后从另一屏幕边缘出现
  - 移动速度在跨屏时加快 50%

不同 DPI 适配：
  - 4K 屏幕：角色 scale 自动降低 0.15x
  - 笔记本小屏：角色 scale 提高 0.1x
  - 多屏不同 DPI：每个屏幕独立 scale

任务栏差异：
  - Windows 底部任务栏：y 减去 48-64px
  - Windows 左侧/右侧任务栏：x 偏移
  - macOS Dock：自动检测位置并避让
  - Linux：根据 WM 配置
```

---

## 5. 代码实现骨架

```ts
// character-spatial-state.ts

interface SpatialStateConfig {
  state: WorkState;
  defaultPos: { x: 'left' | 'center' | 'right' | number; y: 'top' | 'center' | 'bottom' | number };
  scale: number;
  zLayer: ZLayer;
  poseName: string;
  entryDuration: number;
  exitDuration: number;
  transparency: number;
  allowClickThrough: boolean;
}

const spatialStateTable: Record<WorkState, SpatialStateConfig> = {
  [WorkState.DeepFocus]: {
    state: WorkState.DeepFocus,
    defaultPos: { x: 0.70, y: 'bottom' },
    scale: 0.40,
    zLayer: ZLayer.WindowBack,
    poseName: 'peek_from_bottom',
    entryDuration: 1.5,
    exitDuration: 0.8,
    transparency: 1.0,
    allowClickThrough: true,
  },
  [WorkState.Slacking]: {
    state: WorkState.Slacking,
    defaultPos: { x: 'right', y: 'center' },
    scale: 1.10,
    zLayer: ZLayer.WindowFront,
    poseName: 'sit_watch_together',
    entryDuration: 1.8,
    exitDuration: 1.0,
    transparency: 0.90,
    allowClickThrough: false,
  },
  // ... 其他状态
};

class CharacterSpatialController {
  private currentState: WorkState;
  private targetState: WorkState;
  private position: Vector2;
  private scale: number;
  private vrm: VRM;

  async transitionTo(state: WorkState, context: TransitionContext) {
    const cfg = spatialStateTable[state];
    const targetPos = this.resolvePosition(cfg.defaultPos, context);
    
    // 1. exit current
    await this.playExitAnimation(this.currentState);
    
    // 2. move to target
    await this.moveTo(targetPos, cfg.entryDuration, context.urgency);
    
    // 3. scale
    await this.animateScale(cfg.scale, cfg.entryDuration * 0.6);
    
    // 4. z-layer
    this.setZLayer(cfg.zLayer);
    
    // 5. play pose
    await this.playPose(cfg.poseName, cfg.entryDuration);
    
    // 6. set transparency
    this.setTransparency(cfg.transparency);
    
    this.currentState = state;
  }

  private resolvePosition(
    pos: SpatialStateConfig['defaultPos'],
    ctx: TransitionContext
  ): Vector2 {
    const sw = screen.getPrimaryDisplay().bounds.width;
    const sh = screen.getPrimaryDisplay().bounds.height;
    const tb = this.taskbarHeight;

    let x = typeof pos.x === 'number' ? sw * pos.x : this.resolveAnchorX(pos.x, ctx);
    let y = typeof pos.y === 'number' ? sh * pos.y : this.resolveAnchorY(pos.y, ctx);

    // 状态偏移微调
    if (this.targetState === WorkState.DeepFocus) {
      y = sh - tb - 20; // 贴底边
    }

    return { x, y };
  }
}
```

---

## 6. 视觉参考文件

本规格配套概念图：
- `character-state-spatial-art/A_concept_art_illustration_sho_2026-07-21T08-07-30.png` — 6 状态网格图
- `character-state-spatial-art/A_detailed_concept_art_showing_2026-07-21T08-07-30.png` — 6 个亲密互动分镜
- `character-state-spatial-art/A_cinematic_concept_art_of_a_f_2026-07-21T08-07-50.png` — 趴地爬行特写
- `character-state-spatial-art/A_concept_art_illustration_sho_2026-07-21T08-07-20.png` — 专注探头特写

---

## 7. 与 v3.0 / v4.0 的关系

- **v3.0**：提供角色建模、材质、骨骼、BlendShape 基础
- **v4.0 Part1**：提供窗口架构、点击穿透、游荡 AI
- **v4.1 本文档**：在 v4.0 基础上，把**每种工作状态精确映射到空间位置+姿态+动画**
- 所有骨骼角度参数需要叠加到 v3.0 的基础骨骼绑定上
- 所有空间位置参数需要叠加到 v4.0 的坐标系和窗口架构上

---

## 8. 给 code 的使用说明

1. 先看概念图确认视觉方向
2. 根据 WorkState 查表得到位置/缩放/Z层
3. 根据 poseName 加载对应动画 clip
4. 使用 v3.0 的 BlendShape 预设做表情
5. 使用 v4.0 的窗口架构实现点击穿透和层级
6. 重点实现：DeepFocus 探头、Slacking 陪伴、Screen Block 遮挡、Pomodoro 倒计时
7. 优先保证 60fps，性能不足时降低粒子/阴影
