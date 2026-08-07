# WorkOn 虚拟人终版规格 v3.0 — 游戏角色级 3D 建模与全维度细化

> **文档定位**：本文件是 WorkOn 虚拟人的**唯一权威技术规格**，取代 v2.0-v2.5 中所有虚拟人相关描述。
> v2.0-v2.5 中的 UI/报表/规划/日历/产品流程规格仍然有效，虚拟人部分以本文件为准。
>
> **核心变革**：从"low-poly 赛博风" → **游戏角色级 3D 建模**（与《原神》《崩坏：星穹铁道》同级别的角色渲染品质）
>
> **给 coding 编辑器的使用方式**：
> 1. 本文件是虚拟人开发的**唯一入口**
> 2. Part 1-2 是建模/材质/绑定的**硬性技术规格**——必须逐条实现
> 3. Part 3-5 是动画/交互/情感的**骨骼级参数表**——必须逐条实现
> 4. Part 6 是技术实现**架构与代码规格**——按此架构开发
> 5. Part 7 是 UI 设计**意图与约束**——留有创造空间，模型可在此范围内自由发挥

---

## Part 1: 游戏角色级 3D 建模技术规格

### 1.1 模型规格标准

> **目标**：达到 mobile game（手游）高品质角色级别——参考《原神》角色模型质量

#### 1.1.1 面数规格（LOD 分级）

| LOD 级别 | 总面数（Triangles） | 适用场景 | 说明 |
|----------|-------------------|---------|------|
| **LOD0** | 45,000 - 60,000 | 近景/桌搭预览/高质量渲染 | 全细节，含面部微表情网格 |
| **LOD1** | 25,000 - 35,000 | 桌面常驻显示（默认） | 日常使用级别，面部保留关键 blendshape |
| **LOD2** | 12,000 - 18,000 | 远景/性能降级 medium | 简化面部，保留基础表情 |
| **LOD3** | 5,000 - 8,000 | 性能降级 minimal | 极简，3 级表情（开心/中性/不开心） |
| **LOD4** | 静态 PNG sprite | 性能降级 critical | 不渲染 3D，仅 sprite 切换 |

**面数分配参考（LOD0）**：
```
面部（含眼球/口腔/牙齿/舌）：     12,000 - 15,000 tris
头发（hair cards 几何体）：       10,000 - 15,000 tris
身体（躯干/四肢/手）：            12,000 - 18,000 tris
服装（外套/内衬/配饰）：           8,000 - 12,000 tris
小计：                           42,000 - 60,000 tris
```

#### 1.1.2 拓扑规格

```
面部拓扑：
  - 遵循"面部拓扑黄金标准"——沿面部肌肉走向布线
  - 眼周：环形布线 3 层，保证闭眼/眯眼变形自然
  - 嘴周：环形布线 3 层，保证张嘴/抿嘴/微笑变形自然
  - 眉脊：独立拓扑区，保证皱眉/挑眉变形
  - 鼻翼：可变形区（皱鼻子表情）
  - 面颊：可变形区（鼓腮/微笑腮红）
  - 下巴：独立变形区（张嘴联动下巴）
  - 耳朵：标准 6 边形拓扑，非关键变形区

身体拓扑：
  - 肩部：4 段布线（保证抬臂/耸肩自然）
  - 肘部/膝部：3 段布线（保证弯曲自然）
  - 腰部：3 段布线（保证扭转自然）
  - 手部：每根手指 3 段关节 + 拇指额外旋转段
  - 颈部：3 段布线（保证转头/点头/歪头自然）

UV 规格：
  - 单张 UV Atlas，分辨率 2048×2048（LOD0）/ 1024×1024（LOD1-2）/ 512×512（LOD3）
  - UV 岛划分：面部独立岛（最大面积）/ 头发独立岛 / 身体独立岛 / 服装独立岛
  - UV 缝隙最小化，面部 UV 无缝隙（保证面部贴图连续）
  - UV 利用率 > 75%
```

#### 1.1.3 VRM 标准合规

```
模型格式：VRM 1.0（首选） / VRM 0.x（兼容）
  - 遵循 VRM 规范的骨骼命名（humanoid bone mapping）
  - 遵循 VRM 规范的 BlendShape 命名（ARKit 52 blendshapes）
  - 遵循 VRM 规范的 SpringBone 配置（头发/衣物物理）
  - 遵循 VRM 规范的材质分组（Material slots）

优势：
  - 用户可自行导入任何 VRM 角色（VTuber 生态海量免费/付费模型）
  - @pixiv/three-vrm 库提供完整的加载/动画/物理支持
  - 跨角色通用动画系统（骨骼名统一）
```

---

### 1.2 PBR 材质系统

> **从 cel-shading（卡通着色）升级为"PBR 物理 + Toon 混合"着色**
> 这是游戏角色渲染的关键——既保持动漫美感，又有真实材质质感

#### 1.2.1 材质通道规格

每个材质使用以下 PBR 通道：

| 通道 | 分辨率 | 格式 | 用途 |
|------|--------|------|------|
| **BaseColor (Albedo)** | 2048² | sRGB PNG | 基础色 + 手绘风格细节 |
| **Normal** | 2048² | Linear PNG | 法线贴图（毛孔/布料纹理/发丝细节） |
| **Roughness** | 2048² | Linear PNG | 粗糙度（皮肤=0.4-0.6 / 金属=0.1 / 布料=0.7-0.9） |
| **Metallic** | 2048² | Linear PNG | 金属度（几乎全黑，仅配饰/眼镜框局部） |
| **AO (Ambient Occlusion)** | 2048² | Linear PNG | 环境光遮蔽（增强面部/衣物褶皱阴影） |
| **Emission** | 2048² | sRGB PNG | 自发光（眼镜反光/配饰 LED/状态光环粒子区域） |
| **Toon Ramp** | 256×1 | sRGB PNG | 卡通渐变坡度（控制 toon shading 的色阶过渡） |

#### 1.2.2 Toon + PBR 混合着色策略

```
着色公式（伪代码）：
  finalColor = mix(PBR_color, Toon_color, toonWeight)

  PBR_color = standard PBR BRDF (Cook-Torrance)
    → 提供真实的光照、反射、粗糙度质感
    → 在金属/玻璃/塑料材质上表现突出（眼镜/配饰/桌面）

  Toon_color = ToonShading(N·L, toonRamp)
    → 将光照梯度量化为 4 级色阶（亮/中亮/中暗/暗）
    → 在皮肤/头发/布料上保持动漫美感
    → toonRamp 控制色阶过渡的硬/柔程度

  toonWeight（每材质可配）：
    皮肤：0.7（偏 toon，保持动漫感）
    头发：0.6（偏 toon，但保留高光反射）
    布料：0.5（混合）
    金属/玻璃：0.1（几乎纯 PBR，真实反射）
    眼睛：0.3（偏 PBR，保留折射/反射真实感）

  描边（Outline）：
    法线外扩法描边——渲染背面网格，法线沿顶点法线外扩 0.02-0.05 单位
    描边颜色：BaseColor × 0.3（暗色描边，经典动漫描边效果）
    描边宽度：可随距离调整（近景细/远景粗，保持视觉一致）
    描边开关：可在设置中关闭（写实模式）

  阴影接收：
    角色可接收来自环境光的投影（自身阴影 + 环境投影）
    自身阴影：基于骨骼姿态的实时 shadow mapping
    环境投影：预烘焙 AO 贴图（静态）+ 实时 SSAO（动态）
```

#### 1.2.3 材质分组（Material Slots）

```
每个角色模型的材质分组（14 组）：
  0. 面部皮肤（含 SSS）
  1. 身体皮肤（含 SSS）
  2. 眼球-巩膜（白眼球）
  3. 眼球-虹膜+瞳孔（含折射）
  4. 眼球-角膜（透明折射层）
  5. 口腔（牙齿+牙龈+舌）
  6. 头发-主层（hair cards 主层）
  7. 头发-高光层（头发高光贴图控制层）
  8. 服装-主面料
  9. 服装-配饰（纽扣/拉链/品牌标识）
  10. 眼镜-镜片（透明折射）
  11. 眼镜-镜框（金属/塑料）
  12. 鞋子
  13. 状态光环粒子（自发光，独立材质）
```

---

### 1.3 骨骼绑定系统

#### 1.3.1 骨骼层级规格

```
完整骨骼系统（VRM humanoid + 扩展骨骼）：

Root
├── Hips（髋部）
│   ├── Spine（腰椎）
│   │   ├── Chest（胸椎）
│   │   │   ├── UpperChest（上胸）
│   │   │   │   ├── Neck → Head
│   │   │   │   │   ├── LeftEye / RightEye（眼球控制）
│   │   │   │   │   ├── Jaw（下颌——张嘴/说话）
│   │   │   │   │   └── 面部扩展骨骼（12+ 表情驱动骨骼）
│   │   │   │   ├── LeftShoulder → LeftUpperArm → LeftLowerArm → LeftHand
│   │   │   │   │   └── 左手指骨（5指 × 3段 + 拇指旋转段 = 16骨骼）
│   │   │   │   └── RightShoulder → RightUpperArm → RightLowerArm → RightHand
│   │   │   │       └── 右手指骨（同上）
│   │   │   └── Spine1-3（椎骨微调——弯腰/扭转）
│   ├── LeftUpperLeg → LeftLowerLeg → LeftFoot → LeftToe
│   └── RightUpperLeg → RightLowerLeg → RightFoot → RightToe

扩展骨骼（WorkOn 自定义）：
  - 头发控制骨骼：8-12 根（前发/侧发/后发，SpringBone 物理）
  - 服装控制骨骼：4-6 根（衣摆/袖口/领口，布料模拟）
  - 光环控制骨骼：1 根（脚下光环位置/旋转/缩放）

总计：约 80-90 根骨骼
```

#### 1.3.2 权重绑定规格

```
权重绘制标准：
  - 面部：每顶点最多 4 骨骼影响，权重平滑过渡
  - 关节区（肩/肘/膝/髋）：双骨骼影响，权重 50/50 过渡
  - 躯干：3 骨骼影响（Spine/Chest/UpperChest），渐进权重
  - 手指：单骨骼影响（精确控制）
  - 头发：单骨骼影响（每根 hair card 绑定到最近发骨）

权重归一化：所有顶点权重和 = 1.0
最大骨骼影响数/顶点：4（GPU skinning 标准）
```

---

### 1.4 面部表情系统（ARKit 52 BlendShapes）

> **核心升级**：从"8 种表情"→ **ARKit 标准 52 个 BlendShape**

#### 1.4.1 ARKit 52 BlendShapes 完整清单

```
=== 眉部（Brow）— 8个 ===
browInnerUp          — 两眉内侧同时上抬（惊讶/担忧）
browInnerDown        — 两眉内侧同时下拉（皱眉/愤怒）
browOuterUpLeft      — 左眉外侧上抬（怀疑/不对称表情）
browOuterUpRight     — 右眉外侧上抬
browOuterDownLeft    — 左眉外侧下拉（悲伤/疲惫）
browOuterDownRight   — 右眉外侧下拉

=== 眼部（Eye）— 12个 ===
eyeLookInLeft        — 左眼向内看（→右看）
eyeLookInRight       — 右眼向内看（→左看）
eyeLookOutLeft       — 左眼向外看（→左看）
eyeLookOutRight      — 右眼向外看（→右看）
eyeLookUpLeft        — 左眼向上看
eyeLookUpRight       — 右眼向上看
eyeLookDownLeft      — 左眼向下看
eyeLookDownRight     — 右眼向下看
eyeBlinkLeft         — 左眼眨眼（闭眼）
eyeBlinkRight        — 右眼眨眼
eyeSquintLeft        — 左眼眯眼（笑眼/强光）
eyeSquintRight       — 右眼眯眼
eyeWideLeft          — 左眼睁大（惊讶）
eyeWideRight         — 右眼睁大

=== 脸颊（Cheek）— 4个 ===
cheekSquintLeft      — 左脸颊收缩（微笑联动）
cheekSquintRight     — 右脸颊收缩
cheekPuff            — 两颊鼓起（生闷气/可爱）
cheekSuck            — 两颊吸进（瘦脸/严肃）

=== 鼻部（Nose）— 2个 ===
noseSneerLeft        — 左鼻翼上抬（轻蔑/厌恶）
noseSneerRight       — 右鼻翼上抬

=== 嘴部（Mouth）— 20个 ===
mouthLeft/Right      — 嘴角左/右移
mouthSmileLeft/Right — 左/右嘴角上扬（微笑）
mouthFrownLeft/Right — 左/右嘴角下垂（悲伤/不满）
mouthPressLeft/Right — 左/右唇内压（抿嘴）
mouthShrugLower      — 下唇下拉（无奈）
mouthShrugUpper      — 上唇上抬
mouthClose           — 嘴巴闭合
mouthFunnel          — 嘴唇拢圆（吹口哨/吸管）
mouthPucker          — 嘴唇嘟起（亲吻/不满）
mouthUpperUpLeft/Right  — 左/右上唇上抬
mouthLowerDownLeft/Right — 左/右下唇下拉
mouthStretchLeft/Right  — 左/右嘴角拉伸（大笑）
mouthRollLower/Upper  — 下/上唇内卷
mouthDimpleLeft/Right — 左/右嘴角酒窝
mouthApex            — 嘴尖

=== 下颌（Jaw）— 2个 ===
jawOpen              — 下颌张开（张嘴/说话/打哈欠）
jawForward           — 下颌前突（不屑）

=== 舌头（Tongue）— 4个 ===
tongueOut/Left/Right/Up/Down

总计：52 个 BlendShape
```

#### 1.4.2 WorkOn 表情预设（基于 52 BlendShape 组合）

```
预设表情（30 个核心预设）——每个预设是多个 BlendShape 的组合配置：

// === 5种基础表情 ===
neutral     — 全部 = 0
happy       — mouthSmileL/R=0.7, cheekSquintL/R=0.4, eyeSquintL/R=0.3
angry       — browInnerDown=0.8, noseSneerL/R=0.3, mouthPressL/R=0.5, eyeSquintL/R=0.2
sad         — browOuterUpL/R=0.4, mouthFrownL/R=0.6, mouthShrugLower=0.3
surprised   — eyeWideL/R=0.8, browInnerUp=0.6, jawOpen=0.3, mouthFunnel=0.2

// === 工作状态专属 ===
focus       — browInnerDown=0.3, mouthPressL/R=0.3, eyeSquintL/R=0.15
coding      — focus基础 + eyeSquintL/R=0.25（更强烈眯眼，盯屏幕）
writing     — browInnerUp=0.2, mouthPressLeft=0.4, mouthShrugLower=0.15
thinking    — browInnerUp=0.3, mouthPressLeft=0.4, eyeSquintLeft=0.2, cheekSuck=0.15
slack       — eyeBlinkL/R=0.4（半闭眼）, mouthFrownL/R=0.3, jawForward=0.2
meeting     — mouthSmileL/R=0.4（职业微笑）, eyeSquintL/R=0.15

// === 情感专属 ===
proud       — mouthSmileL/R=0.5, browInnerUp=0.2, Head骨骼微抬头
embarrassed — eyeBlinkL/R=0.3, mouthSmileL/R=0.3, cheekPuff=0.2
mocking     — noseSneerLeft=0.4, mouthSmileRight=0.3, browOuterUpLeft=0.3
worried     — browInnerUp=0.5, browOuterDownL/R=0.3, mouthPressL/R=0.3
anxious     — browInnerDown=0.4, browInnerUp=0.3, eyeWideL/R=0.2
content     — mouthSmileL/R=0.4, eyeSquintL/R=0.3
sleepy      — eyeBlinkL/R=0.6, mouthShrugLower=0.2, jawOpen=0.1

// === 交互专属 ===
dragged     — eyeWideL/R=0.6, mouthFunnel=0.3, browInnerUp=0.5
clicked_face — cheekPuff=0.3, mouthSmileL/R=0.2, eyeBlinkL/R=0.2
greeting    — mouthSmileL/R=0.6, eyeSquintL/R=0.2, Head微点头
celebrating — eyeWideL/R=0.5, mouthStretchL/R=0.7, browInnerUp=0.4

// === 说话嘴型（viseme 视素——TTS嘴型同步）===
viseme_rest — jawOpen=0, 全部mouth=0
viseme_AA   — jawOpen=0.5, mouthFunnel=0.2（啊）
viseme_EE   — mouthStretchL/R=0.4, jawOpen=0.1（衣）
viseme_OO   — mouthPucker=0.6, mouthFunnel=0.3, jawOpen=0.1（乌）
viseme_OH   — jawOpen=0.4, mouthFunnel=0.4（哦）
viseme_RR   — mouthRollUpper/Lower=0.3, jawOpen=0.05（儿）
viseme_SS   — mouthStretchL/R=0.2, jawOpen=0.05（嘶）
viseme_TH   — tongueOut=0.2, jawOpen=0.15（舌齿音）
viseme_FF   — mouthPressL/R=0.3（唇齿音）
viseme_DD   — tongueUp=0.3, jawOpen=0.1（舌音）
```

#### 1.4.3 表情过渡系统

```
表情过渡规则：
  - 所有 BlendShape 值变化使用 ease-in-out 缓动曲线
  - 过渡时间：0.2s（快速表情变化）/ 0.5s（缓慢情感过渡）
  - 表情混合：支持 2 个预设同时激活，按权重混合
    例：focus(0.7) + worried(0.3) = "专注但有点担心"的复合表情

眨眼系统（自动眨眼）：
  - 间隔：4-8 秒随机（专注时 8-12s，摸鱼时 3-5s）
  - 时长：0.15s（闭眼0.075s + 睁眼0.075s）
  - 说话时不眨眼

眼球追踪系统：
  - 眼球自动跟随鼠标光标（eyeLookIn/Out/Up/Down）
  - 追踪延迟：0.3s（自然延迟）
  - 范围：水平 ±30°，垂直 ±15°
  - 深度专注时：眼球锁定屏幕中心
  - 摸鱼时：眼球随机游移（不安感）
  - 说话时：眼球看向用户方向
```

---

### 1.5 毛发系统

```
头发渲染方式：Hair Cards（面片头发）
  - 每束头发 = 一个带 alpha 透明度贴图的面片
  - LOD0：80-120 个 hair cards / LOD1：50-70 / LOD2：30-40 / LOD3：15-20

头发面片贴图：
  - BaseColor：发丝颜色 + 发丝方向纹理
  - Alpha：发丝透明度（边缘渐变，模拟散碎发丝）
  - Normal：发丝法线（光照细节）
  - 发根到发梢渐变：BaseColor 从深→浅

头发分层：
  Layer 1 — 内层（贴近头皮，最短发丝，填充密度）
  Layer 2 — 主层（主体发型，中长发丝）
  Layer 3 — 外层（最长发丝/刘海/碎发，飘动感）
  Layer 4 — 高光层（独立高光控制，模拟头发反光带）

SpringBone 物理配置：
  stiffness（刚度）：0.3-0.6（前发硬/后发软）
  gravityPower：0.02-0.05
  dragForce：0.4-0.6
  碰撞体：头部球形碰撞体
  风力影响：
    环境风：恒定微弱侧风（头发轻微飘动）
    移动风：角色移动时反向风力（头发向后飘）
    拖拽风：被拖拽时强风力（头发大幅飘散）
```

---

### 1.6 眼睛系统（6 层渲染）

```
Layer 1 — 巩膜（白眼球）
  材质：Toon+PBR混合（toonWeight=0.5），微黄白色，微血管纹理

Layer 2 — 虹膜（眼球彩色部分）
  材质：PBR为主（toonWeight=0.2）
  BaseColor：角色眼睛色（ARIA=紫/LUNA=粉/KIRA=红/ZEN=绿/SHIN=银）
  Normal：虹膜放射状纤维纹理
  Emission：微弱自发光（"眼睛会发光"的动漫效果）
  Roughness：0.15（湿润光泽感）

Layer 3 — 瞳孔
  纯黑色 + 微弱折射
  可变形：瞳孔可缩放（专注时缩小0.85x/兴奋时放大1.15x/惊吓时1.3x）

Layer 4 — 角膜（透明折射层）
  透明 + 折射（类似玻璃），Roughness=0.05
  作用：模拟眼球表面湿润光泽 + 环境反射

Layer 5 — 高光点
  自发光白色点，位于虹膜左上方（主光源方向）
  第二高光点：虹膜右下方（辅助光方向）
  大小随情感变化——惊讶时变小/开心时变大

Layer 6 — 上眼睑阴影
  半透明黑色渐变，眼球上方
  作用：增加眼睛深度感

眼球动画控制：
  - 通过 LeftEye/RightEye 骨骼旋转
  - 旋转范围：水平 ±30°，垂直 ±20°
  - 追踪模式：A.鼠标追踪 B.屏幕中心 C.用户面部 D.随机游移
  - 瞳孔缩放通过虹膜材质 scale 参数控制
```

---

### 1.7 皮肤着色系统（SSS 次表面散射）

```
SSS 参数：
  散射颜色：暖红色 #ff8866（血液颜色）
  散射半径：0.012
  散射强度：0.4

  表现效果：
  - 侧脸逆光 → 耳朵边缘呈半透明红色
  - 面颊 → 自然红润感
  - 鼻翼两侧 → 微微透红

皮肤细节贴图：
  - 毛孔 Normal 贴图（LOD0 近景可见）
  - 皮肤瑕疵贴图（痣/雀斑/微小色斑——增加真实感）
  - 油脂层：T区（额头/鼻/下巴）高光较强
  - 干燥区：U区两颊高光较弱

腮红系统：
  - 独立腮红贴图层（可动态控制透明度）
  - 害羞时：0 → 0.6（0.3s）
  - 开心时：0 → 0.3
  - 摸鱼被抓住：0 → 0.8（强烈害羞）
  - 默认：0.1（微弱自然红润）
```

---

### 1.8 布料模拟系统

```
布料模拟：VRM SpringBone（简化）+ 预烘焙褶皱

衣摆/袖口/领口：SpringBone 物理摆动
  stiffness：0.2（比头发软）
  gravityPower：0.04
  dragForce：0.5

褶皱：Normal 贴图预烘焙（不实时计算）
  - 关节弯曲区（肘/膝/腰）：预烘焙弯曲褶皱
  - 重力下垂区（衣摆/袖口）：预烘焙下垂褶皱

表现效果：
  - 转身 → 衣摆跟随甩动
  - 前倾 → 衣摆下垂
  - 被拖拽 → 衣摆向后飘
  - 站定 → 衣摆轻微随风摆动
```

---

### 1.9 光照系统

```
5 光源系统（3点光照 + 环境光 + 状态光）：

1. 主光（Key Light）：DirectionalLight
   方向：左上前方→右下后方（45°角）
   颜色：暖白 #fff5e6 / 强度：1.2
   阴影：shadow mapping 2048

2. 辅助光（Fill Light）：DirectionalLight
   方向：右上方→左下方
   颜色：冷蓝 #cce0ff / 强度：0.4

3. 轮廓光（Rim Light）：DirectionalLight
   方向：正后方→正前方（逆光）
   颜色：随状态变化（见下表）/ 强度：0.8

4. 环境光：HemisphereLight
   天顶色：深空蓝 #1a2030 / 地面色：暗暖灰 #2a2520 / 强度：0.3

5. 状态点光源：PointLight（脚下）
   颜色：同步轮廓光 / 强度：0.5 / 脉动 1.5s

状态光照色彩映射：
  focus=青绿#6bd8a8 / coding=电蓝#4a9eff / writing=薰衣草#9b8cff
  slack=暖橙#ffb86b / meeting=金色#ffd700 / idle=暗紫#6a5acd
  break=暖绿#98d982 / aidev=紫红#c44eff / debugging=红#ff6b6b
  celebrating=金色#ffd700+彩虹粒子
  状态切换时：0.5s 色彩 lerp 过渡
```

---

### 1.10 后处理管线

```
后处理效果链（按顺序）：

1. Bloom — 阈值0.8, 强度0.3, 半径0.4（状态光环/眼睛高光辉光）
2. SSAO — 半径0.1, 强度0.5（关节/褶皱深度感）
3. Color Grading — 暖色偏移, 对比度+5%, 饱和度-5%（动漫淡雅风）
4. Vignette — 强度0.15, 半径0.8（聚焦角色）
5. Film Grain — 强度0.02（消除色带）
6. FXAA — 边缘平滑

后处理性能降级：
  full：全部后处理
  medium：去掉 SSAO + Film Grain
  minimal：仅 FXAA
  critical：无后处理
```

---

### 1.11 LOD 系统

```
LOD 切换策略：
  - 基于角色显示尺寸（屏幕占比）自动切换
  - >200px → LOD0 / 100-200px → LOD1（默认）/ 60-100px → LOD2 / <60px → LOD3
  - 系统资源不足 → 跳过尺寸判断直接降级
  - 切换动画：0.3s 交叉溶解

手动覆盖：
  设置中可强制指定 LOD 级别 / "自动"模式 = 尺寸+性能自动切换
```

---

### 1.12 动画系统（3 层混合）

```
Layer 0 — 基础姿态层（Base Pose）
  控制：全身骨骼基础姿态（站/坐/走/跑）
  权重：100%（始终激活）
  过渡：0.4s（大姿态变化）

Layer 1 — 状态动作层（State Action）
  控制：工作状态上半身动作（敲键盘/抱手机/拿杯子等）
  权重：70%（叠加在基础姿态上）
  过渡：0.3s（工作动作变化）

Layer 2 — 表情层（Expression）
  控制：面部 52 BlendShape
  权重：100%（独立于骨骼动画）
  过渡：0.2s（表情变化）

动画剪辑清单：
  基础姿态：idle_stand / idle_sit / walk / sit_down / stand_up
            drag_lift / drag_release / sleep / wake_up
  状态动作：coding_action / writing_action / slack_action / meeting_action
            thinking_action / drinking_action / eating_action
            presenting_action / sleeping_action / celebrating_action
  微行为（程序化）：blink / eye_track / head_micro_nod / hair_wind_sway
            breathing / idle_glance / hair_tuck / glasses_adjust
            deep_breath / stretch / distant_gaze / scratch_head
            drink_water / yawn / mouse_follow / wind_response
```

---

### 1.13 性能预算与优化

```
性能预算（LOD1 默认）：
  CPU：虚拟人 <5%（日常）/<8%（活跃） / 总WorkOn <10%
  GPU：虚拟人 <15% / 后处理 <5% / 总WorkOn <20%
  RAM：模型~50MB / 动画~20MB / 粒子~10MB / 总 <200MB
  帧率：LOD0-1=30fps目标/24fps最低 / LOD2=24fps / LOD3=15fps

优化策略：
  1. Frustum Culling — 不在可视区域不渲染
  2. Animation Culling — 不可见时暂停动画
  3. 粒子池化 — 对象池复用避免GC
  4. 贴图压缩 — KTX2/BC7
  5. InstancedMesh — 光环/粒子批量渲染
  6. Shader简化 — LOD2-3去掉SSS/折射/Bloom
  7. 按需渲染 — 静止时15fps，移动时30fps
```


---

## Part 2: 5 角色完整设计规格

> **目标**：每个角色都是完整的、独立的、可交付的游戏角色设计方案。
> 概念稿 prompt 供建模师/AI生成参考，建模参数供编码实现，性格参数供行为系统驱动。

### 2.1 角色总览

| 角色 | 代号 | 性格关键词 | 肤色基调 | 发色 | 服装风格 | 体态比例 | 嗓音风格 |
|------|------|-----------|---------|------|---------|---------|---------|
| **ARIA** | ICE-01 | 冷静·理性·克制 | 偏冷白 #E8E0F0 | 冰蓝渐变 | 功能主义·简约制服 | 修长 170/8头身 | 低频·清冷·不带尾音上扬 |
| **LUNA** | WARM-02 | 温暖·共情·柔韧 | 暖白偏粉 #F0E4D8 | 柔粉长直 | 休闲舒适·针织+背带裤 | 圆润 160/7头身 | 中频·柔和·带轻微鼻腔共鸣 |
| **KIRA** | FIRE-03 | 傲娇·敏锐·不服输 | 偏暖白 #F5E0D0 | 火红短发 | 潮流街头·夹克+短裤 | 匀称 165/7.5头身 | 高频·干脆·短句不拖音 |
| **ZEN** | EARTH-04 | 稳重·禅意·老灵魂 | 偏暖棕 #D8C8B8 | 银灰短卷 | 传统融合·改良汉服+运动鞋 | 壮实 175/8头身 | 低频·缓慢·句尾下沉 |
| **SHIN** | STEEL-05 | 严格·精英·不容失误 | 偏冷白 #E0D8E8 | 银白束发 | 职场正装·西装+高腰裤 | 挺拔 172/8头身 | 中频·精确·每个字清晰 |

### 2.2 ARIA — 冰蓝理性者

#### 2.2.1 概念稿 Prompt（供建模师/AI生成）

<pre>
EN:
A tall, elegant female virtual assistant character, early 20s, standing 170cm (8-head proportion).
Skin: cool pale white with subtle blue undertone (#E8E0F0), smooth porcelain texture with minimal pores.
Hair: ice-blue gradient (roots #B0C4DE → tips #E0F0FF), straight mid-length, hair cards 90 pieces at LOD0,
inner layer slightly translucent with rim lighting. Hair physics: SpringBone stiffness 0.7, gravity 0.4.
Face: sharp jawline, high cheekbones, narrow almond eyes with ice-blue iris (#6CA6CD),
6-layer eye system with cornea subtle refraction. Eyelashes: thin, 30 pieces, slight outward curl.
Expression default: neutral with 2 degree downward lip corners, slight brow relaxation.
Body: slender athletic build, shoulder width 38cm, waist 24cm, hip 36cm (measure ratio).
Clothing: functional minimalist uniform — dark navy high-collar top (#1A1A2E) with silver zipper line,
slim black trousers (#0D0D0D), silver wrist watch on left arm. No excessive accessories.
Shoes: flat black leather oxfords. Overall silhouette: vertical lines, no curves breaking the verticality.
Key design principle: "Form follows function" — every element has purpose, no decoration without reason.
Reference: Motoko Kusanagi (GitS) × Motoko Aramaki × Lacie (Tera) — cool, purposeful, no warmth leakage.

CN:
高挑优雅的女性虚拟助手角色，20出头，身高170cm（8头身比例）。
肤色：冷调偏白，带微妙蓝底色（#E8E0F0），瓷质光滑纹理，毛孔细节极少。
发型：冰蓝渐变（根部 #B0C4DE → 尖端 #E0F0FF），直发中长，LOD0 90张 Hair Cards，
内层微透，rim 光照产生边缘辉光。头发物理：SpringBone 硬度 0.7，重力 0.4。
面部：锐利下颌线，高颧骨，窄杏仁眼，冰蓝虹膜（#6CA6CD），
6层眼球系统含角膜微折射。睫毛：纤细30根，轻微外翘弧度。
默认表情：中性，嘴角下弯2度，眉微放松。
身体：纤细运动体型，肩宽38cm，腰24cm，臀36cm。
服装：功能主义简约制服——深海军蓝高领上衣（#1A1A2E）带银色拉链线，
修身黑色裤子（#0D0D0D），左腕银色手表。不过度装饰。
鞋：黑色平底牛津鞋。整体轮廓：纵向线条，不被曲线打断垂直感。
核心设计原则："形式追随功能"——每个元素都有目的，没有无缘由的装饰。
参考：草薙素子(GitS) × Motoko Aramaki × Lacie(Tera)——冷、有目的、不泄漏温暖。
</pre>

#### 2.2.2 建模差异化参数

<pre>
ARIA 建模参数（相对于基础模型的差异化设定）：

面数分配差异：
  面部 LOD0：13,000 tris（比基础多 1,000——锐利轮廓需要更密布线）
  发型 LOD0：12,000 tris（90 hair cards × ~130 tris/card）
  身体 LOD0：14,000 tris（修长体型需要更多比例细节）
  服装 LOD0：8,000 tris（简约制服，面数较少）

材质槽位分配（14 slots）：
  01_Skin：SSS scatterRadius=8mm, scatterColor=#E8E0F0→#C08090（蓝底→血色散射）
  02_Skin_Detail：pore density LOW (0.3x), roughness variation 0.05
  03_Hair_Main：albedo=#B0C4DE→#E0F0FF gradient, toonWeight=0.6, anisotropic=0.8
  04_Hair_Inner：albedo=#D0E4FF, transparency=0.3, rimBoost=1.5
  05_Eye_Iris：albedo=#6CA6CD, metalness=0.2, clearcoat=0.8
  06_Eye_Sclera：albedo=#F0F0F5, roughness=0.3
  07_Eye_Cornea：clearcoat=1.0, refraction IOR=1.38
  08_Cloth_Top：albedo=#1A1A2E, roughness=0.5, metalness=0.0, toonWeight=0.4
  09_Cloth_Pants：albedo=#0D0D0D, roughness=0.4, metalness=0.0, toonWeight=0.4
  10_Cloth_Shoes：albedo=#0D0D0D, roughness=0.3, metalness=0.1
  11_Accessory_Watch：albedo=#C0C0C0, metalness=0.9, roughness=0.2
  12_Accessory_Zipper：albedo=#E0E0E0, metalness=0.95, roughness=0.15
  13_Teeth：albedo=#F8F8F0, roughness=0.3, SSS scatter=2mm
  14_Mouth_Internal：albedo=#CC3030, roughness=0.5

骨骼差异：
  spine_01: 基础旋转 (-2, 0, 0) ——微微后仰的挺直姿态
  neck_01: 基础旋转 (-3, 0, 0) ——下巴微抬
  shoulder_L/R: 基础旋转 (0, -5, 0) ——肩微展
  全身骨骼默认姿态偏冷：所有关节默认更接近0度（减少自然松弛弧度）
</pre>

#### 2.2.3 性格行为参数

<pre>
ARIA 性格行为矩阵（PAD模型基准值）：

PAD基准：P=0.3（低愉悦）/ A=0.4（中等唤醒）/ D=0.85（高支配）

监控驱动行为权重：
  提醒摸鱼：direct=0.9, humor=0.1, guilt=0.7
  进度预警：data_first=0.95, emotion=0.05
  下班提醒：precise_time=0.9, suggestion=0.1
  休息催促：medical_fact=0.8, caring=0.2

对话风格：
  句式：陈述句为主，平均句长 12-18 字
  语调标记：无"呢/啊/呀"，用"。"结尾
  禁忌词：不使用"宝宝/亲爱的/乖"，不使用感叹号
  例外：仅 P大于0.8 时允许一次"还不错。"

站立/坐下倾向：
  coding：站立概率 0.85 | slack：坐下概率 0.9 | meeting：站立概率 0.7 | idle：站立概率 0.8

空闲微行为频率（每分钟）：
  blink：18 | eye_track_mouse：0.4 | hair_tuck：0.1 | watch_check：0.3 | distant_gaze：0.2 | deep_breath：0.15
</pre>

### 2.3 LUNA — 柔粉共情者

#### 2.3.1 概念稿 Prompt

<pre>
EN:
A round-faced, warm female virtual companion, early 20s, 160cm (7-head proportion).
Skin: warm pale pink undertone (#F0E4D8), soft matte, visible pores at close-up, SSS blush on cheeks/nose.
Hair: soft pink long straight (#F8BBD0→#F0D0E0), 100 hair cards, flowing, inner layer warm glow.
SpringBone stiffness 0.4, gravity 0.6, bounce 0.3.
Face: round, full cheeks, wide eyes with warm amber iris (#C89050), 6-layer eyes with large highlights.
Eyelashes: 35 pieces, slight inward curl. Expression default: gentle smile +4deg, eyes 10% above neutral.
Body: soft rounded, shoulder 34cm, waist 26cm, hip 38cm.
Clothing: oversized cream knit sweater (#F5F0E8), brown suspenders + navy wide-leg trousers (#2A2A40), beige slip-ons.
Accessories: flower hair pin right side (#F8BBD0), thin gold bracelet right wrist.
Principle: "Warmth is not weakness." Reference: K-On! × Holo × warm mentor figures.

CN:
圆脸温暖的女性虚拟陪伴，20出头，160cm（7头身）。
肤色：暖粉底色（#F0E4D8），柔软哑光，近景毛孔可见，脸颊鼻尖SSS泛红。
发型：柔粉长直（#F8BBD0→#F0D0E0），100 hair cards，内层暖辉光。
面部：圆脸丰颊，暖琥珀虹膜（#C89050），6层大高光。
睫毛：35根微内翘。默认表情：微笑+4度，眼睛多开10%。
身体：柔软圆润，肩34腰26臀38cm。
服装：浅奶油针织衫+深棕背带裤+海军蓝宽腿裤+米色一脚蹬。
配饰：花发簪+细金手链。原则："温暖不是软弱。"
</pre>

#### 2.3.2 建模差异化参数

<pre>
LUNA 建模参数：

面数：面部12K | 发型14K(100 cards) | 身体12K | 服装10K

材质槽位（14）：
  01_Skin：scatterRadius=10mm, #F0E4D8→#D06060 | 02_Skin：pore 0.6x, blush cheek+nose
  03_Hair：#F8BBD0→#F0D0E0, toonWeight=0.5 | 04_Hair_Inner：#FFF0F5, trans=0.4
  05_Eye_Iris：#C89050, clearcoat=0.6 | 07_Cornea：IOR=1.36
  08_Sweater：#F5F0E8, rough=0.7, toonWeight=0.5 | 09_Pants：#2A2A40
  11_Pin：#F8BBD0 | 12_Bracelet：#D4AF37, metal=0.9

骨骼：spine前倾3度 | neck微收2度 | shoulder内收8度（温柔弧度）
</pre>

#### 2.3.3 性格行为参数

<pre>
LUNA PAD基准：P=0.7 / A=0.5 / D=0.35

行为权重：摸鱼→gentle 0.8 | 进度→emotion_first 0.6 | 下班→warm_suggestion 0.7 | 休息→caring 0.9
对话风格：疑问+感叹混合，8-14字，"呢/呀/♥"，句尾"~"
禁忌词：不用"必须/命令/不准"
站坐倾向：coding坐0.7 | slack坐0.5 | meeting坐0.8 | idle坐0.6
微行为：blink 22 | eye_track 0.8 | hair_tuck 0.5 | smile_micro 0.4 | deep_breath 0.25
</pre>

### 2.4 KIRA — 火红傲娇者

#### 2.4.1 概念稿 Prompt

<pre>
EN:
A sharp, energetic female virtual companion, early 20s, 165cm (7.5-head proportion).
Skin: warm pale (#F5E0D0), matte, visible pores on forehead/nose.
Hair: fiery red short bob (#E04040→#F06060), 70 hair cards, layered volume, inner orange (#F0A040).
SpringBone stiffness 0.8, gravity 0.3, bounce 0.5.
Face: diamond, pointed chin, sharp brows, large eyes, amber-red iris (#C05030), 6-layer dynamic highlight.
Eyelashes: 40 pieces, dramatic outward curl. Expression: smirk +2deg asymmetry, brow +5deg.
Body: athletic, shoulder 36cm, waist 25cm, hip 35cm.
Clothing: cropped black leather jacket (#1A1A1A, orange lining #F0A040), white tee (#F0F0F0),
denim shorts (#404060), chunky sneakers black/orange.
Accessories: orange stud earrings, black wristband L, orange lanyard R.
Principle: "I am not being nice, I am just... helping." Reference: Asuka × Taiga × tsundere perfected.

CN:
锐利活力女性虚拟陪伴，165cm（7.5头身）。
肤色：暖白（#F5E0D0）微棕底。发型：火红短发波波（#E04040→#F06060），70 cards，内层亮橙。
面部：菱形脸，琥珀红虹膜（#C05030），40根夸张睫毛。
默认表情：微撇嘴+2度不对称，眉挑5度。身体：运动匀称。
服装：黑色皮夹克橙内衬+白T恤+牛仔短裤+chunky运动鞋。
配饰：橙耳钉+黑腕带+橙挂绳。原则："我不是好心，只是……在帮。"
</pre>

#### 2.4.2 建模差异化参数

<pre>
KIRA 建模参数：

面数：面部12.5K | 发型9K(70 cards) | 身体13K | 服装12K(皮夹克多层)

材质槽位（14）：
  01_Skin：scatterRadius=7mm, #F5E0D0→#C07070 | 02：pore 0.7x, forehead+nose
  03_Hair：#E04040→#F06060, toonWeight=0.65 | 04_Inner：#F0A040, rimBoost=2.0
  05_Eye_Iris：#C05030, clearcoat=0.7 | 07_Cornea：IOR=1.40
  08_Jacket：#1A1A1A, rough=0.3, toonWeight=0.35 | 09_Jacket_Inner：#F0A040
  10_Tee：#F0F0F0, toonWeight=0.5 | 12_Earrings：#F0A040, metal=0.7

骨骼：spine微侧倾3度 | neck偏2度 | shoulder展-8度 | hip微侧3度
</pre>

#### 2.4.3 性格行为参数

<pre>
KIRA PAD基准：P=0.45 / A=0.7 / D=0.75

行为权重：摸鱼→mock 0.6 | 进度→blunt 0.7 | 下班→demand 0.5 | 休息→mock_care 0.7
对话风格：短句+反问，6-12字，"啧/哼/才不是"，句尾"！"
禁忌词：不用"♥/呢/呀"
站坐倾向：coding站0.6 | slack站0.8 | meeting站0.5 | idle站0.7
微行为：blink 15 | hair_flip 0.4 | arm_cross 0.3 | foot_tap 0.2 | jacket_zip 0.2
</pre>

### 2.5 ZEN — 银灰禅意者

#### 2.5.1 概念稿 Prompt

<pre>
EN:
A grounded, broad-shouldered male virtual mentor, mid-30s, 175cm (8-head proportion).
Skin: warm brown (#D8C8B8), matte, visible pores, SSS warm earth undertones.
Hair: silver-gray short curly (#C0C0C0→#A0A0A0), 60 hair cards, tight curls, inner warm (#D0D0C0).
SpringBone stiffness 0.9, gravity 0.2, bounce 0.1.
Face: broad square jaw, thick brows, wide-set calm eyes, deep brown iris (#604020), reduced highlight.
Eyelashes: 25 pieces, short straight. Expression: serene neutral 0deg, eyes 5% below neutral.
Body: broad sturdy, shoulder 44cm, waist 32cm, hip 38cm.
Clothing: improved short Hanfu top (#404020) hidden zip + athletic joggers (#303030) + chunky sneakers (#606060).
Accessories: wooden bead bracelet L (#8B4513), thin chain necklace (#A0A0A0).
Principle: "Stillness is not absence — it is presence." Reference: Iroh × Kenshin × Musashi.

CN:
稳重宽肩男性虚拟导师，175cm（8头身）。
肤色：暖棕（#D8C8B8），哑光可见毛孔。发型：银灰短卷（#C0C0C0→#A0A0A0），60 cards。
面部：宽方下巴，深棕虹膜（#604020），25根短睫毛。
默认表情：宁静0度，眼睛少5%。身体：宽壮44/32/38cm。
服装：改良汉服+慢跑裤+运动鞋。配饰：木珠手串+细链项链。
原则："静不是空——静是在。"
</pre>

#### 2.5.2 建模差异化参数

<pre>
ZEN 建模参数：

面数：面部11K | 发型7.5K(60 cards) | 身体16K(壮实体型) | 服装9K

材质槽位（14）：
  01_Skin：scatterRadius=12mm, #D8C8B8→#B05040 | 02：pore 0.8x, forehead+cheeks+jaw
  03_Hair：#C0C0C0→#A0A0A0, toonWeight=0.4 | 05_Eye：#604020, clearcoat=0.5
  08_Top：#404020, toonWeight=0.45 | 09_Pants：#303030 | 11_Beads：#8B4513, rough=0.7(wood)

骨骼：spine 0度 | neck 0度 | shoulder 0度（中正=无偏）
</pre>

#### 2.5.3 性格行为参数

<pre>
ZEN PAD基准：P=0.55 / A=0.25 / D=0.65

行为权重：摸鱼→wisdom_quote 0.6 | 进度→perspective 0.7 | 下班→philosophical 0.5 | 休息→body_wisdom 0.8
对话风格：比喻+短哲言，10-16字，偶用"……"，句尾平稳
禁忌词：不用"必须/命令/快/赶紧"
站坐倾向：coding坐0.5 | slack坐0.7 | meeting坐0.6 | idle站0.5
微行为：blink 20 | deep_breath 0.4 | bead_touch 0.2 | distant_gaze 0.5 | neck_stretch 0.15
</pre>

### 2.6 SHIN — 银白精英者

#### 2.6.1 概念稿 Prompt

<pre>
EN:
A crisp, precise male virtual supervisor, late 20s, 172cm (8-head proportion).
Skin: cool pale (#E0D8E8), minimal undertone, smooth professional, pores barely visible.
Hair: silver-white tied back (#E8E8F0→#F0F0F8), 75 hair cards, tight low ponytail, inner white (#F0F0F8).
SpringBone stiffness 0.85, gravity 0.3, bounce 0.15.
Face: sharp angled, straight jawline, precise brows, narrow eyes, steel-blue iris (#708090), minimal highlight.
Eyelashes: 20 pieces, short, no curl. Expression: exact neutral 0deg, zero deviation.
Body: athletic upright, shoulder 40cm, waist 28cm, hip 34cm.
Clothing: charcoal slim-fit suit (#202020) + pocket square (#C0C0C0) + white shirt (#F0F0F0) +
black trousers (#0A0A0A) + black oxfords (#0A0A0A) with subtle shine.
Accessories: silver tie bar (#C0C0C0), black belt with silver buckle.
Principle: "Perfection is the absence of imperfection." Reference: Kira(DN) × Sebastian × corporate elite.

CN:
利落精确男性虚拟督导，172cm（8头身）。
肤色：冷白（#E0D8E8）极少底色，光滑职场。发型：银白束发（#E8E8F0→#F0F0F8），75 cards。
面部：锐角脸，钢蓝虹膜（#708090），20根短睫毛。
默认表情：精确0度。身体：挺拔40/28/34cm。
服装：深炭西装+白衬衫+黑裤+牛津鞋。配饰：银领带夹+皮带银扣。
原则："完美是没有不完美。"
</pre>

#### 2.6.2 建模差异化参数

<pre>
SHIN 建模参数：

面数：面部12.5K | 发型9K(75 cards) | 身体13K | 服装11K(西装多层)

材质槽位（14）：
  01_Skin：scatterRadius=5mm, #E0D8E8→#A07080 | 02：pore 0.2x, roughness var 0.03
  03_Hair：#E8E8F0→#F0F0F8, toonWeight=0.55, anisotropic=0.7 | 05_Eye：#708090, metal=0.25, clearcoat=0.75
  07_Cornea：IOR=1.42 | 08_Jacket：#202020, rough=0.35 | 10_Shoes：#0A0A0A, metal=0.15
  11_TieBar：#C0C0C0, metal=0.95 | 12_Buckle：#C0C0C0, metal=0.95 | 13_Teeth：#F8F8F8

骨骼：spine/spine02 0度 | neck微抬-2度 | shoulder展-3度 | 全身±1度精确姿态
</pre>

#### 2.6.3 性格行为参数

<pre>
SHIN PAD基准：P=0.35 / A=0.45 / D=0.9

行为权重：摸鱼→order 0.85 | 进度→KPI 0.9 | 下班→deadline 0.8 | 休息→efficiency 0.85
对话风格：命令+数据，8-14字，零语气词，零感叹号
禁忌词：不用情感词（"关心/心疼/辛苦"），不用比喻
站坐倾向：coding站0.75 | slack站0.6 | meeting站0.65 | idle站0.8
微行为：blink 16 | tie_adjust 0.25 | watch_check 0.4 | straighten_posture 0.3 | deep_breath 0.1
</pre>

### 2.7 角色切换形态变形系统

<pre>
角色切换流程：
  1. 用户选择目标角色（桌搭/设置面板）
  2. 当前角色淡出（opacity 1.0→0.0, 0.8s, ease-in）
  3. Morph 中间态（共享骨骼姿态保持，材质球切换）
  4. 目标角色淡入（opacity 0.0→1.0, 1.0s, ease-out）
  5. 目标角色入场动画（signature pose 1.5s）

Morph 实现方案：
  方案A（推荐）：5套独立模型 + 共享骨骼命名映射
    - 5套模型各自独立（面数/材质/发型全不同）
    - VRM humanoid 骨骼命名统一 → 动画可跨角色复用
    - 切换时：dispose旧模型 → load新VRM → apply当前状态动画
    - 优势：每个角色品质最大化，无Morph面数限制
    - 劣势：5套模型 RAM ~250MB（需懒加载）

  方案B（降级）：1套基础模型 + Morph Target 差异
    - 50-80个 Morph Target（面型/体型/发型轮廓）
    - 切换时：Morph 0→1, 0.6s
    - 优势：RAM ~50MB
    - 劣势：差异不够极端

  推荐：方案A（品质优先），LOD2-3时切换方案B

懒加载策略：
  - 启动仅加载上次选择的角色
  - 切换时提前 2s 预载
  - 当前+预载常驻，其余按需加载
  - LOD4不加载3D，仅sprite

切换动画序列（方案A）：
  Phase 1 (0-0.8s)：当前角色 exit pose + 消散特效
    - ARIA：转身背对+右手抬起 → 冰蓝光点消散
    - LUNA：挥手+微笑 → 粉花瓣消散
    - KIRA：甩头+抱臂 → 火焰消散
    - ZEN：双手合十微低头 → 烟雾消散
    - SHIN：整理领带+直视 → 线条消散
  Phase 2 (0.8-1.8s)：目标角色 entrance pose + 载入特效
    - ARIA：冰蓝光点凝成形体+站立挺直
    - LUNA：粉花瓣旋成形体+微笑坐下
    - KIRA：火焰爆裂成形体+甩头站定
    - ZEN：烟雾聚成形体+缓慢站起
    - SHIN：线条精确绘成形体+笔直站立
  Phase 3 (1.8-3.3s)：signature pose → idle过渡

预载触发：
  - 打开角色选择面板 → 预载全部5角色
  - hover某角色1s → 预载该角色
  - 定时切换 → 提前30s预载
</pre>


---

## Part 3: 状态动画骨骼级规格

> **目标**：每个工作状态都有**骨骼旋转角度、BlendShape权重值、物理参数、光照参数、粒子参数**的完整参数表。
> 编码实现时，每个参数必须可精确还原到代码中。

### 3.1 状态总览与分类

```
状态分类体系（4大类 × 共16个核心状态）：

A类-工作状态（8个）：
  coding / writing / thinking / meeting / presenting / AI_chat / AI_dev / designing

B类-非工作状态（4个）：
  slack / eating / drinking / sleeping

C类-过渡状态（2个）：
  idle / walking

D类-特殊状态（2个）：
  drag_lift / forced_focus（强制专注——屏幕遮挡激活时）

每个状态包含：
  1. 基础姿态骨骼旋转表（关键骨骼精确角度）
  2. BlendShape表情权重表（ARKit 52中涉及的具体权重值）
  3. 物理参数表（SpringBone/衣服/头发）
  4. 光照参数表（5光源颜色+强度+位置偏移）
  5. 粒子参数表（如有）
  6. 微行为补充表（该状态特有的微行为）
  7. 角色差异化覆盖表（5角色在该状态的关键差异）
```

### 3.2 coding（编程中）状态

#### 3.2.1 基础姿态骨骼旋转

<pre>
姿态描述：站立/坐下，身体微前倾，双手在键盘区域快速敲击
默认：站立姿态（各角色站坐概率见Part 2）

站立coding骨骼旋转（角度，相对于idle_stand）：
  spine_01: (-5, 0, 0)    ——躯干微前倾5度
  spine_02: (-3, 0, 0)    ——上背前倾
  spine_03: (-2, 0, 0)    ——颈根前倾
  neck_01: (-8, 0, 0)     ——头微低头看屏幕
  head: (-5, 2, 0)        ——低头5度+微右偏2度（看代码）
  left_upper_arm: (0, -30, -40) ——左臂抬起打字
  left_lower_arm: (-60, 0, 10)  ——左前臂弯曲
  left_hand: (0, 0, -15)        ——左手打字微弯
  right_upper_arm: (0, 30, 40)  ——右臂抬起
  right_lower_arm: (-60, 0, -10)
  right_hand: (0, 0, 15)
  left_upper_leg: (0, 0, 0)     ——站立时腿不动
  right_upper_leg: (0, 0, 0)

坐下coding骨骼旋转（相对于idle_sit）：
  spine_01: (-8, 0, 0)    ——坐时前倾更多
  spine_02: (-5, 0, 0)
  spine_03: (-3, 0, 0)
  neck_01: (-10, 0, 0)    ——头更低
  head: (-8, 3, 0)        ——低头看键盘
  left_upper_arm: (0, -35, -45)
  left_lower_arm: (-70, 0, 15)
  right_upper_arm: (0, 35, 45)
  right_lower_arm: (-70, 0, -15)

打字手部循环动画（3帧循环，0.12s/frame）：
  Frame A: left_hand (5,0,-20) | right_hand (0,0,0) ——左手按下
  Frame B: left_hand (0,0,0)   | right_hand (5,0,20) ——右手按下
  Frame C: left_hand (0,0,-10) | right_hand (0,0,10) ——中间过渡
  循环速度：打字速度 0.08-0.15s/frame（根据监控的实际打字速度动态调整）
</pre>

#### 3.2.2 BlendShape表情权重

<pre>
coding BlendShape权重（ARKit 52，0-1范围）：

核心表情：
  eyeSquint_L: 0.15       ——微眯眼（专注看屏幕）
  eyeSquint_R: 0.15
  jawForward: 0.05        ——下巴微前推（专注时微咬牙）
  mouthFrown_L: 0.1       ——嘴角微下弯（严肃专注）
  mouthFrown_R: 0.1
  browInnerUp_L: 0.08     ——眉微抬（思考态）
  browInnerUp_R: 0.08
  browOuterDown_L: 0.05   ——外眉微降（专注）
  browOuterDown_R: 0.05
  eyeWide_L: 0.0          ——不睁大眼
  eyeWide_R: 0.0

嘴唇微动（模拟说话/默念代码）：
  mouthSmile_L: 0.0       ——不微笑
  mouthSmile_R: 0.0
  jawOpen: 0.05           ——嘴微开（偶尔默念）
  tongueOut: 0.0

频率性表情（交替触发）：
  每5秒：eyeSquint 增至 0.25（"仔细看这段代码"）
  每15秒：browInnerUp 增至 0.15 + eyeLookDown 增至 0.3（"想想逻辑"）
  每30秒：mouthFrown降至0.0 + mouthSmile升至0.08（"找到bug了/写对了"）——持续1.5秒回归
</pre>

#### 3.2.3 物理参数

<pre>
coding 物理参数：

头发 SpringBone：
  stiffness: 比默认 +20%（专注时头发更少动）
  gravity: 默认值
  damping: +30%（减少晃动——专注状态减少无意识物理运动）

衣服 SpringBone：
  stiffness: +15%（减少衣摆飘动）
  damping: +20%

呼吸频率：normal × 0.85（专注时呼吸稍慢）
  breathing_cycle: 4.5s（正常3.8s → 专注4.5s）
  breathing_amplitude: 0.5（正常0.8 → 专注0.5——微弱呼吸起伏）
</pre>

#### 3.2.4 光照参数

<pre>
coding 光照参数（相对于默认光照的变化）：

  key_light:
    color: #F0F8FF（冷白——代码需要冷光）
    intensity: 1.1（比默认亮10%——专注工作环境更亮）
    position_offset: (0, +30, 0)（更从上方照射——屏幕反光效果）

  fill_light:
    color: #E0E0E8（冷灰填充）
    intensity: 0.4
    position_offset: (0, 0, 0)

  rim_light:
    color: #C0E0FF（冰蓝轮廓光）
    intensity: 0.7
    position_offset: (0, +20, +30)（侧上方——屏幕侧光效果）

  ambient_light:
    color: #E8F0F8
    intensity: 0.5

  status_light（虚拟人脚底/光环状态指示灯）：
    color: #00E676（绿色——正在工作）
    intensity: 0.6
    particle: 无
</pre>

#### 3.2.5 粒子参数

<pre>
coding 粒子：

  1. 键盘微光粒子（手部周围）：
     type: point_sprite
     count: 8-12
     size: 0.02-0.05
     color: #C0E0FF（冰蓝小光点）
     lifetime: 0.3-0.5s
     spawn_rate: 与打字速度同步（每帧击键生成1-2粒子）
     position: 手部上方 0.5-2cm 范围随机
     velocity: (0, +0.1, 0) 微上飘
     fade: alpha 1→0, ease-out

  2. 思考火花粒子（头部周围，触发时）：
     trigger: browInnerUp > 0.12 时激活
     type: point_sprite
     count: 3-5
     size: 0.03-0.06
     color: #FFD700（金色火花——灵感闪现）
     lifetime: 0.8-1.2s
     spawn_rate: 每次思考表情触发生成 3-5 粒子
     position: 头顶上方 2-5cm
     velocity: 随机方向，speed 0.05-0.1
     fade: alpha 1→0, ease-out
</pre>

#### 3.2.6 微行为补充

<pre>
coding 状态特有微行为（每分钟频率）：

  head_micro_nod: 0.3     ——微点头（确认代码逻辑）
  eye_track_mouse: 0.15   ——偶尔看鼠标位置（比默认少——专注看屏幕）
  scratch_head: 0.1       ——抓头（困惑）
  stretch: 0.05           ——伸懒腰（每20分钟触发）
  deep_breath: 0.1        ——深呼吸（重新集中）
  yawn: 0.02              ——极少打哈欠（专注时不会）
</pre>

#### 3.2.7 角色差异化覆盖

<pre>
5角色 coding 状态差异：

ARIA：
  前倾角度 +3度（更严重的代码投入姿态）
  mouthFrown: ×1.5（更严肃）
  eyeSquint: ×1.3（更眯眼）
  打字速度视觉：fast（0.08s/frame）
  站立概率 0.85

LUNA：
  前倾角度 -2度（比默认少前倾——舒适）
  mouthSmile: +0.05（微笑编码——享受编码）
  eyeSquint: ×0.8（不那么眯眼——柔和看）
  打字速度视觉：medium（0.12s/frame）
  坐下概率 0.7

KIRA：
  前倾角度 +1度（稍投入）
  mouthSmile + mouthFrown交替: 每10秒切换（找到bug→笑，新bug→撇嘴）
  打字速度视觉：fast（0.08s/frame——KIRA手速快）
  粒子火花颜色: #F0A040（橙色——火焰灵感）
  站立概率 0.6

ZEN：
  前倾角度 -1度（比默认少——从容）
  jawForward: 0（不咬牙——禅意不紧咬）
  打字速度视觉：slow（0.15s/frame——从容节奏）
  粒子火花颜色: #90EE90（绿色——自然灵感）
  坐下概率 0.5

SHIN：
  前倾角度 +2度（精确投入）
  mouthFrown: ×2.0（更严肃）
  eyeSquint: ×1.5（更眯——精确审视）
  打字速度视觉：very_fast（0.06s/frame）
  粒子火花颜色: #E0E0E0（银白——逻辑灵感）
  站立概率 0.75
</pre>

### 3.3 slack（摸鱼中）状态

#### 3.3.1 基础姿态骨骼旋转

<pre>
姿态描述：身体后仰放松，一手拿手机/一手在鼠标上随意滑动

站立slack骨骼旋转：
  spine_01: (5, 0, 0)     ——后仰5度（放松）
  spine_02: (3, 0, 0)     ——上背微后仰
  spine_03: (0, 0, 0)
  neck_01: (3, 0, 0)      ——头微抬（看远处/手机）
  head: (5, -5, 0)        ——头右偏5度+上抬5度
  left_upper_arm: (0, 10, 30) ——左臂放松微抬（拿手机）
  left_lower_arm: (-20, 0, 30) ——左前臂弯曲拿手机位置
  left_hand: (10, 0, 30)        ——左手握持态
  right_upper_arm: (0, 20, 10)  ——右手随意放桌面
  right_lower_arm: (-30, 0, 0)

坐下slack骨骼旋转：
  spine_01: (8, 0, 0)     ——坐时后仰更多
  spine_02: (5, 0, 0)
  neck_01: (5, 0, 0)
  head: (8, -3, 0)        ——更抬+更偏

手机翻转动画（2帧循环，0.4s/frame）：
  Frame A: left_hand (10, 5, 25)  ——左手微上滑手机
  Frame B: left_hand (5, -5, 35)  ——左手微下滑手机
  循环速度：0.3-0.5s/frame（慢——摸鱼不急）
</pre>

#### 3.3.2 BlendShape表情权重

<pre>
slack BlendShape权重：

核心表情：
  mouthSmile_L: 0.25      ——微笑（摸鱼愉悦）
  mouthSmile_R: 0.25
  eyeSquint_L: 0.0        ——不眯眼（放松）
  eyeSquint_R: 0.0
  jawOpen: 0.08           ——嘴微开（松弛）
  browInnerUp_L: 0.0      ——眉不抬
  browInnerUp_R: 0.0
  cheekSquint_L: 0.12     ——脸颊微挤（笑态）
  cheekSquint_R: 0.12
  eyeLookDown_L: 0.0      ——不看屏幕
  eyeLookDown_R: 0.0
  eyeLookUp_L: 0.2        ——看上方/手机
  eyeLookUp_R: 0.2

频率性表情：
  每3秒：mouthSmile升至0.35（"哈哈这个帖子好笑"）
  每8秒：mouthSmile降至0.15 + mouthFrown升至0.05（"这个帖子无聊"）——持续1秒回归
</pre>

#### 3.3.3 物理参数

<pre>
slack 物理参数：

头发 SpringBone：
  stiffness: 比默认 -30%（放松时头发更飘）
  gravity: 默认值
  damping: -20%（更多晃动）

衣服 SpringBone：
  stiffness: -25%（衣摆更多飘）
  damping: -15%

呼吸频率：normal × 1.15（放松时呼吸稍快——悠闲）
  breathing_cycle: 3.3s
  breathing_amplitude: 0.9（更明显的呼吸起伏——放松）
</pre>

#### 3.3.4 光照参数

<pre>
slack 光照参数：

  key_light:
    color: #FFF0E0（暖黄——摸鱼是暖色氛围）
    intensity: 0.85（比专注暗15%——降低工作氛围）
    position_offset: (0, -20, 0)（更低角度——懒散光照）

  fill_light:
    color: #F0E8D0（暖填充）
    intensity: 0.5

  rim_light:
    color: #FFE0C0（暖橙轮廓）
    intensity: 0.5（减少轮廓光强度——不强调）

  status_light:
    color: #FF5252（红色——摸鱼中）
    intensity: 0.7（比绿色更亮——警示性）
    pulse: true, rate 0.5Hz（微脉动——警示）
</pre>

#### 3.3.5 粒子参数

<pre>
slack 粒子：

  1. 手机屏幕光粒子（手部周围）：
     type: point_sprite
     count: 5-8
     size: 0.03-0.05
     color: #F0F0F0（白——手机屏幕光）
     lifetime: 0.4-0.6s
     spawn_rate: 持续，0.8/s
     position: 左手上方 0.5-3cm
     velocity: (0, +0.05, 0)
     fade: alpha 0.8→0

  2. 懒散气泡粒子（头部周围）：
     type: sphere_sprite（圆润气泡）
     count: 2-3
     size: 0.05-0.08
     color: #FFE0C0 with alpha 0.3
     lifetime: 2-4s
     spawn_rate: 0.3/s
     position: 头顶上方 3-8cm
     velocity: (random, +0.03, random), slow drift
     fade: alpha 0.3→0, 2s ease-out
</pre>

#### 3.3.6 角色差异化覆盖

<pre>
ARIA slack：
  mouthSmile: ×0.3（ARIA摸鱼也不太笑——"我知道不该摸"）
  mouthFrown: +0.1（微不满意自己的摸鱼）
  站立概率 0.9（坐下表示不认同）
  粒子气泡: 无（ARIA摸鱼不产生气泡——太理性）
  打字手机速度: medium

LUNA slack：
  mouthSmile: ×1.5（LUNA摸鱼很开心）
  cheekSquint: ×1.3
  坐下概率 0.5
  粒子气泡: ×2（更多气泡——更多快乐）
  粒子颜色: #F8BBD0（粉色气泡）

KIRA slack：
  mouthSmile: ×0.8（摸鱼但嘴硬——"我才不是在摸鱼"）
  mouthFrown + mouthSmile交替: 每5秒（矛盾表情）
  粒子气泡: ×1.5 但颜色 #F0A040（橙色气泡——火色懒惰）
  站立概率 0.8

ZEN slack：
  mouthSmile: ×0.7（淡定微笑——"休息也是修行"）
  deep_breath频率 ×2（摸鱼时更多深呼吸）
  粒子气泡: ×1, color #90EE90（绿色——自然）
  坐下概率 0.7

SHIN slack：
  mouthSmile: ×0.2（几乎不笑——"这是效率损失"）
  mouthFrown: ×1.5（严重不满）
  站立概率 0.6（保持站姿——不能松懈）
  粒子气泡: 无（精英不产生懒散气泡）
  status_light颜色: #FF1744（更红——严重警示）
</pre>

### 3.4 其他核心状态参数速查表

<pre>
writing（写文档中）：
  骨骼：spine前倾6度 | neck低头8度 | right_hand握笔微旋转
  BlendShape：mouthFrown 0.08 | eyeSquint 0.12 | eyeLookDown 0.3
  物理：头发stiffness+10% | 呼吸3.5s
  光照：key #F0F8FF | rim #C0D8E0 | status #00E676
  粒子：笔尖墨水粒子 size 0.02 color #303030

thinking（思考中）：
  骨骼：spine中立0度 | head微仰5度 | left_hand托下巴
  BlendShape：browInnerUp 0.2 | eyeLookUp 0.15 | mouthFrown 0.05 | jawForward 0.03
  物理：头发stiffness+5% | 呼吸4.0s（更长——深思）
  光照：key #F8F0FF（紫白——思考色）| rim #E0C0FF | status #7C4DFF（紫色——深度思考）
  粒子：思维火花 count 5-8 color #FFD700 → 角色差异化色

meeting（会议中）：
  骨骼：spine直立0度 | head正视0度 | 手臂微前（讲话时手势）
  BlendShape：mouthSmile 0.15 | eyeWide 0.1 | browInnerUp 0.05（礼貌微笑+认真听）
  物理：头发默认 | 呼吸3.8s
  光照：key #F0F0F0（中性白）| rim #E0E0E0 | status #2196F3（蓝色——会议中）
  粒子：无（会议是严肃的）
  微行为：点头频率 0.5/分钟 | eye_track 0.1 | 手势 0.3/分钟

presenting（演示/演讲中）：
  骨骼：spine直立+胸扩 | 手臂大幅展开 | head正视前方
  BlendShape：mouthSmile 0.3 | eyeWide 0.15 | jawOpen 0.1（演讲表情大开）
  物理：头发 -20% stiffness（讲话激动时头发更动）
  光照：key #FFF8E0（暖白——展示自信）| rim #FFC040（金色轮廓）| status #FFC107
  粒子：展示光环 count 10-15 color #FFC107

AI_chat（AI问答中）：
  骨骼：spine中立 | head微偏一侧（听AI回答）| 手指指向屏幕
  BlendShape：eyeWide 0.15 | mouthSmile 0.12 | browInnerUp 0.1（好奇+关注）
  物理：默认
  光照：key #E0F0FF | rim #80D0FF | status #00BCD4（青色——AI交互）
  粒子：数据流粒子 count 5 color #00BCD4 线性运动（表示AI数据流）

AI_dev（AI开发中）：
  骨骼：coding × 0.8前倾 + thinking × 0.5抬头的混合态
  BlendShape：coding专注 + AI_chat好奇的混合
  物理：coding参数 × 0.9 + thinking × 0.1
  光照：coding冷白 × 0.7 + AI_chat青色 × 0.3混合
  粒子：coding键盘粒子 + AI_chat数据流粒子同时存在

designing（设计中）：
  骨骼：spine前倾4度 | neck偏左+右交替 | right_hand拖拽手势（模拟鼠标拖拽）
  BlendShape：eyeWide 0.12 | mouthSmile 0.1 | eyeLookDown 0.2
  光照：key #F0E8FF（淡紫——设计色）| rim #D0A0FF | status #E040FB
  粒子：画笔粒子 color #E040FB

eating（吃东西）：
  骨骼：坐姿 | one_hand_lift_to_mouth | head微低头
  BlendShape：jawOpen 0.3→0→0.3 循环 | mouthSmile 0.2 | cheekSquint 0.15
  物理：头发 -10% stiffness
  光照：暖色 key #FFF0D0 | status #FF9800（橙色——用餐）
  粒子：食物碎片粒子

drinking（喝水）：
  骨骼：right_hand_lift杯 | head微仰 | 颈微后仰
  BlendShape：jawOpen 0.05 | mouthSmile 0.08
  光照：中性 | status #00E676（仍是工作）
  粒子：水珠粒子 color #80D0FF

sleeping（休息/小睡）：
  骨骼：坐姿max后仰 | head下垂 | arms下垂 | eyes_closed
  BlendShape：eyeClose_L 1.0 | eyeClose_R 1.0 | jawOpen 0.03 | mouthSmile 0.0
  物理：头发 -50% stiffness | -30% gravity（松弛飘动）
  光照：key intensity 0.4（暗——休息）| ambient warm | status #9E9E9E（灰色——离线）
  粒子：Z粒子（睡眠符号）count 2-3 color #9E9E9E alpha 0.3
</pre>

### 3.5 idle（空闲）状态

<pre>
idle 骨骼（默认中立姿态——所有骨骼归0度附近）：

  spine_01: (0, 0, 0)
  spine_02: (0, 0, 0)
  neck_01: (0, 0, 0)
  head: (0, 0, 0)
  所有手臂：自然下垂角度（upper_arm 0,0,20 | lower_arm 0,0,0）
  所有腿：直立 0,0,0

idle BlendShape：
  全部 0.0（中性脸）
  仅保留 auto_blink（每4-6秒自动眨眼）
  eye_track_mouse: 低频跟随

idle 物理：
  全部默认值
  breathing: 3.8s周期, 0.8幅度

idle 光照：
  全部默认值
  status_light: #607D8B（灰色——空闲）

idle 微行为（每分钟）：
  blink: 20 | eye_track: 0.3 | idle_glance: 0.2 | hair_wind_sway: 0.1
  distant_gaze: 0.3 | deep_breath: 0.2 | stretch: 0.03
  角色签名微行为：ARIA watch_check | LUNA hair_tuck | KIRA hair_flip | ZEN bead_touch | SHIN tie_adjust
</pre>

### 3.6 状态过渡系统

<pre>
状态过渡动画时长与曲线：

过渡类型矩阵（from_state → to_state）：

所有过渡使用 ease-in-out 曲线，时长根据状态跨度分级：

同大类过渡（如 coding→thinking）：
  duration: 0.6s | curve: ease-in-out | BlendShape: 0.4s过渡 | 骨骼: 0.6s过渡

跨大类过渡（如 coding→slack）：
  duration: 1.0s | curve: ease-in-out | BlendShape: 0.5s过渡 | 骨骼: 1.0s过渡

紧急过渡（如 any→forced_focus）：
  duration: 0.3s | curve: ease-out（快速切入）| BlendShape: 0.2s | 骨骼: 0.3s

回归过渡（如 forced_focus→coding）：
  duration: 0.8s | curve: ease-in（缓入回归）| BlendShape: 0.6s | 骨骼: 0.8s

拖拽过渡（如 any→drag_lift）：
  duration: 0.15s | curve: linear（即时响应）| BlendShape: 0.1s | 骨骼: 0.15s

释放过渡（如 drag_lift→idle）：
  duration: 0.5s | curve: ease-out-bounce（弹回）| BlendShape: 0.3s | 骨骼: 0.5s + bounce

BlendShape 过渡规则：
  - 所有权重值线性插值（lerp）过渡
  - 互斥BlendShape组（如 mouthSmile vs mouthFrown）先归0再升新值
  - eyeClose 过渡时长固定 0.15s（眨眼不可慢）
  - jawOpen 过渡时长 0.2s（嘴巴不能瞬开）

骨骼 过渡规则：
  - 所有关节角度线性插值过渡
  - spine链（3节）使用顺序过渡：spine_01→spine_02→spine_03，每节延迟 0.05s（波浪式）
  - 手臂过渡独立于躯干（可同时进行）
  - 腿部过渡仅在站→坐或坐→站时触发，时长 0.8s

粒子过渡规则：
  - 新状态粒子：过渡开始后 0.3s 开始生成
  - 旧状态粒子：过渡开始后立即停止新生成，已有粒子自然消亡
  - 状态指示灯（status_light）：0.2s 颜色过渡
</pre>

### 3.7 14 微行为完整参数表

<pre>
微行为系统：14个程序化微行为，叠加在状态动画之上

1. blink（自动眨眼）：
   触发：自动，间隔 4-6秒（随机）
   BlendShape：eyeClose_L/R 0→1→0，总时长 0.15s
   曲线：0→1(0.05s) | 1→0(0.1s)
   角色差异：ARIA 18/min | LUNA 22/min | KIRA 15 | ZEN 20 | SHIN 16

2. eye_track_mouse（眼睛跟随鼠标）：
   触发：鼠标移动 >50px 时
   BlendShape：eyeLookDown/Up/Left/Right 根据鼠标位置计算权重
   权重 = clamp(mouse_offset / screen_size * 0.3, -0.3, 0.3)
   曲线：0.2s ease-out 到目标位置
   角色差异：频率见各角色参数

3. head_micro_nod（微点头）：
   触发：程序化，频率由状态决定
   骨骼：head (-3, 0, 0) → (0, 0, 0)，时长 0.3s
   曲线：ease-in-out

4. hair_wind_sway（头发风吹）：
   触发：环境（模拟微风，每 10-20秒 一次）
   SpringBone：外部风力向量 (0.1, 0, random) 施加 0.5-1.0s
   所有 hair SpringBone 同时受力

5. breathing（呼吸起伏）：
   触发：持续循环
   骨骼：spine_03 微旋 Y轴 ±1度 | chest scale Y ±0.02
   频率和幅度由状态决定（见各状态参数）

6. idle_glance（随机扫视）：
   触发：程序化，每 5-15秒 一次
   BlendShape：eyeLook + head微偏，0.5s扫视→0.3s回归
   方向：随机（上下左右）

7. hair_tuck（整理头发）：
   触发：程序化，频率由角色决定
   骨骼序列：right_hand→head侧面→下滑→归位，总时长 1.5s
   BlendShape：mouthSmile 0.05（整理头发时微微笑）

8. glasses_adjust（调整眼镜）：
   触发：程序化（ARIA/SHIN有watch_check替代）
   骨骼：hand→nose_bridge→push→归位，总时长 0.8s

9. deep_breath（深呼吸）：
   触发：程序化
   骨骼：spine扩胸 + chest scale + head微仰
   BlendShape：jawOpen 0.05 → eyeClose 0.3（闭眼深呼吸）
   总时长：2.0s（0.5s吸→1.0s屏→0.5s呼）

10. stretch（伸懒腰）：
    触发：程序化，低频
    骨骼：arms_up + spine_extend + head仰
    BlendShape：mouthOpen 0.15
    总时长：2.5s（1.0s伸展→0.5s保持→1.0s回归）

11. distant_gaze（远望）：
    触发：程序化
    BlendShape：eyeLookUp 0.2 + eyeWide 0.1 + mouthFrown 0.02
    骨骼：head仰 5度
    时长：3-5s（长凝视）

12. scratch_head（抓头）：
    触发：困惑/bug时
    骨骼：hand→head_top→scratch循环→归位
    BlendShape：browInnerUp 0.15 + mouthFrown 0.1
    时长：1.5-2.0s

13. drink_water（喝水动作）：
    触发：休息催促后用户响应
    骨骼：right_hand_lift杯→嘴→喝→放回
    BlendShape：jawOpen微循环 + mouthSmile 0.05
    时长：3.0s

14. yawn（打哈欠）：
    触发：疲劳时
    BlendShape：jawOpen 0.4 + eyeClose 0.8 + mouthFrown 0.05
    骨骼：head微仰
    时长：2.0s（0.3s张嘴→1.0s保持→0.7s闭嘴）
</pre>


---

## Part 4: 交互系统物理级规格

> **目标**：所有用户交互都有**精确的物理参数、碰撞检测区域、动画序列**，可直接编码实现。

### 4.1 拖拽物理系统（3阶段）

#### 4.1.1 阶段1：抓取（Grab）

<pre>
触发条件：
  用户鼠标悬停在虚拟人身上 >0.3s + 按下鼠标左键
  碰撞检测：8区域划分（见4.2），根据悬停区域判定抓取点

抓取动画（0.15s）：
  被抓区域对应的骨骼微缩0.5%（被捏住的感觉）
  BlendShape：eyeWide 0.3 + mouthOpen 0.15（惊讶表情）
  角色差异化反应文字：
    ARIA："——不要碰。" | LUNA："呀~被抓住了！" | KIRA："啧！放手！" | ZEN："嗯？" | SHIN："停止。"

物理参数切换：
  所有SpringBone：
    stiffness → ×0.3（被抓时身体变软——被控制感）
    damping → ×0.5（减少震荡）
    gravity → ×0.0（重力暂时关闭——被悬空）
  被抓区域的SpringBone：
    stiffness → ×0.1（更软——该区域特别放松）
    locked → true（锁定到鼠标位置）

光标变化：
  Windows：cursor → "grabbing"（CSS cursor: grabbing）
  角色下方阴影：opacity 0→0.3（悬空感）
</pre>

#### 4.1.2 阶段2：拖拽移动（Drag）

<pre>
拖拽中持续参数：
  虚拟人位置 = 鼠标位置（实时跟随，无延迟）
  SpringBone 全体：
    stiffness → ×0.2（拖拽中全身更软——被牵引感）
    gravity → ×0.0
    externalForce = (mouseVelocity × 0.5)（头发/衣摆向拖拽方向飘）
    inertia_enabled → true（头发/衣服有惯性延迟跟随——拖拽甩动效果）

  身体姿态变化：
    spine_01: 朝拖拽方向旋转5度（被拉的感觉）
    neck_01: 反向旋转3度（头抗拒——不想被拉）
    head: 反向旋转5度 + mouthFrown 0.2（不高兴被拖）

  BlendShape持续表情：
    mouthFrown 0.2（不满）
    eyeSquint 0.15（不舒服）
    角色差异化：
      ARIA: mouthFrown ×1.5, eyeWide 0.1（冷静不满）
      LUNA: mouthSmile 0.1（"被拉着走也还好~"）
      KIRA: mouthFrown ×2.0, jawOpen 0.1（愤怒抗议）
      ZEN: mouthFrown ×0.5（"随缘。"）
      SHIN: mouthFrown ×1.8, browDown ×1.5（命令停止）

  角色差异化拖拽文字（每10秒触发一次）：
    ARIA："工作效率降低。放下。"
    LUNA："好轻好轻~别担心我~"
    KIRA："放手！我说放手！"
    ZEN："……随你。"
    SHIN："即刻停止拖拽行为。效率损失 12%。"

  物理惯性细节：
    拖拽开始时：头发先静止→0.3s后开始跟随拖拽方向
    拖拽停止时：头发继续飘0.5s后才减速归位（惯性残留）
    拖拽速度变化：头发飘动方向随速度方向变化，有0.2s延迟
    衣服衣摆：同头发惯性，但延迟0.15s（衣服更轻更快反应）
</pre>

#### 4.1.3 阶段3：释放与弹回（Release & Bounce）

<pre>
触发：鼠标左键释放

弹回动画序列（0.5s ease-out-bounce）：
  Phase A (0-0.15s)：自由下落
    gravity 恢复 → ×1.0
    SpringBone stiffness 恢复 → ×0.8（比默认稍软——刚被放下还在恢复）
    虚拟人 y轴下落：y += gravity × dt（自然下落）
    下落速度：初始 0 → 加速 9.8cm/s（缩放重力，视觉上约3-5cm下落距离）

  Phase B (0.15-0.35s)：着地弹跳
    虚拟人到达原始y位置时触发着地
    着地冲击：scale_y 短暂压缩至 0.92（被压扁）→ 0.05s后恢复
    SpringBone：着地冲击波 → 所有SpringBone产生向上反弹力
    头发：着地瞬间全部向上弹起→0.3s后归位
    衣摆：同头发

  Phase C (0.35-0.5s)：恢复稳定
    SpringBone stiffness 恢复 → ×1.0（完全恢复）
    damping 恢复 → ×1.0
    scale_y 恢复 1.0
    BlendShape：从不满表情→0.4s过渡→回归当前状态表情

  角色差异化释放文字：
    ARIA："恢复工作。" | LUNA："啊~回来了♥" | KIRA："哼，终于放手了。" | ZEN："落地生根。" | SHIN："恢复常态。继续。"

  弹跳次数：根据下落距离
    短拖拽(<50px)：1次小弹跳
    中拖拽(50-200px)：2次弹跳（大弹+小弹）
    长拖拽(>200px)：3次弹跳（大弹+中弹+微弹）
    每次弹跳高度：前次 × 0.4（衰减）
</pre>

### 4.2 8区域点击反馈系统

<pre>
碰撞检测区域划分（基于VRM humanoid骨骼位置）：

区域定义（屏幕坐标→骨骼映射）：

  1. HEAD（头部）：
     边界：neck以上所有几何体
     中心骨骼：head
     点击反馈：
       BlendShape：eyeClose 0.8（0.15s）→ eyeOpen + eyeWide 0.3（惊讶）
       骨骼：head微偏点击方向 5度
       物理：头发 SpringBone 受冲击 → 随点击方向偏移
       角色差异化文字：
         ARIA："头部是敏感区域。请勿触碰。" | LUNA："呀~头被摸了~" | KIRA："别碰头！" | ZEN："嗯……" | SHIN："头部触碰。停止。"

  2. FACE（面部）：
     边界：head下方，eye至jaw区域
     中心骨骼：head + jaw
     点击反馈：
       BlendShape：cheekSquint 0.5（被戳脸→脸颊挤起）+ mouthSmile 0.15（反应微笑）
       骨骼：head向点击侧偏 8度
       角色：LUNA → cheekSquint ×1.5 + blush系统触发 | KIRA → mouthFrown ×2（别戳脸！）

  3. CHEST（胸部）：
     边界：spine_03区域 + upper_arm起始区
     中心骨骼：spine_03
     点击反馈：
       骨骼：spine_03向点击方向微偏 3度（后退）
       BlendShape：mouthFrown 0.2（不适）
       角色：ARIA/SHIN → mouthFrown ×2 + "停止触碰。" | KIRA → 强烈反应

  4. LEFT_ARM（左臂）：
     边界：left_upper_arm + left_lower_arm几何体
     中心骨骼：left_upper_arm
     点击反馈：
       骨骼：left_upper_arm微抬起 10度（手臂被碰→抬起）
       BlendShape：eyeLookLeft 0.2（看左臂）

  5. RIGHT_ARM（右臂）：
     边界：right_upper_arm + right_lower_arm
     中心骨骼：right_upper_arm
     点击反馈：
       骨骼：right_upper_arm微抬起 10度
       BlendShape：eyeLookRight 0.2

  6. LEFT_HAND（左手）：
     边界：left_hand + left_finger几何体
     中心骨骼：left_hand
     点击反馈：
       骨骼：left_hand打开手指（拳头→展开）0.3s→收回
       BlendShape：mouthSmile 0.1

  7. RIGHT_HAND（右手）：
     边界：right_hand + right_finger
     中心骨骼：right_hand
     点击反馈：同左手

  8. LOWER_BODY（下半身：腿/脚）：
     边界：upper_leg以下所有几何体
     中心骨骼：left_upper_leg / right_upper_leg
     点击反馈：
       骨骼：点击的腿微抬起 15度（被碰→抬腿）
       BlendShape：mouthSmile 0.05（微小反应）
       角色：KIRA → "别碰腿！" | LUNA → "嘻嘻~"

点击反馈动画总时长：0.6s（0.2s反应→0.4s回归）
点击间隔保护：同一区域 1秒内不重复触发（防骚扰式连点）
连续点击同一区域 3次：触发特殊反应（角色发怒/大笑/特殊台词）
</pre>

### 4.3 5级鼠标联动系统

<pre>
鼠标联动等级（根据监控数据动态调整）：

Level 0 — 无联动（深度专注 P0）：
  虚拟人完全不跟随鼠标
  eye_track_mouse 频率 = 0
  状态：coding/thinking/AI_dev 等 P0级状态时
  条件：用户连续工作 >20min + 状态判定为 P0

Level 1 — 轻微跟随（一般专注 P1-P3）：
  eye_track_mouse 频率 = 0.2/分钟
  头部不跟随，仅眼球跟随
  虚拟人偶尔抬头看一眼鼠标方向
  状态：coding(中段)/meeting/writing

Level 2 — 中等跟随（低专注 P4-P6）：
  eye_track_mouse 频率 = 0.5/分钟
  头部微偏跟随鼠标（head rotation ±3度）
  偶尔伸手指向鼠标位置（0.2/分钟）
  状态：idle/designing/AI_chat

Level 3 — 活跃跟随（低专注+频繁切换 P7-P8）：
  eye_track_mouse 频率 = 0.8/分钟
  头部跟随鼠标（head rotation ±8度）
  躯干微偏跟随（spine ±3度）
  手指向鼠标区域（0.4/分钟）
  状态：slack/频繁窗口切换

Level 4 — 主动拦截（摸鱼超标 P9）：
  虚拟人主动走向鼠标位置
  速度：3cm/s（桌面上的虚拟人移动速度）
  到达鼠标后：
    ARIA：站在鼠标旁，凝视，"你在干什么？"
    LUNA：走到鼠标旁蹲下，"嘿~是不是该工作了？♥"
    KIRA：冲到鼠标旁，手叉腰，"给我回去工作！"
    ZEN：缓步走到鼠标旁，"心若不在此，何须在此？"
    SHIN：精确走到鼠标旁，直视，"非工作行为。立即停止。"
  如果用户继续摸鱼 >5min：进入屏幕遮挡模式（见4.4）

鼠标联动触发后的回归动画：
  联动行为结束后 2s → 虚拟人走回原位
  走回速度：2cm/s（比拦截慢——回归更从容）
</pre>

### 4.4 4级屏幕遮挡系统

<pre>
遮挡等级（根据摸鱼时长和严重程度递增）：

Level 1 — 提醒气泡（0-5min 摸鱼）：
  实现：Electron transparent overlay, opacity 0.05
  内容：虚拟人小气泡冒出提醒文字
  样式：圆形气泡 80×80px，背景 rgba(0,0,0,0.05)
  位置：虚拟人头部上方 20px
  动画：bubble_scale 0→1, 0.3s ease-out → 3s显示 → 0→1 fade-out 0.5s
  频率：每2分钟一次
  角色差异化：
    ARIA气泡："进度 68%。建议回归。"（冷色蓝底 rgba(100,166,205,0.05)）
    LUNA气泡："回来工作吧~♥"（暖色粉底 rgba(248,187,208,0.05)）
    KIRA气泡："啧，又在摸鱼？"（橙色底 rgba(240,160,64,0.05)）
    ZEN气泡："心在何处？"（绿色底 rgba(144,238,144,0.05)）
    SHIN气泡："效率 -12%。回归。"（灰底 rgba(112,128,144,0.05)）

Level 2 — 渐变雾气（5-15min 摸鱼）：
  实现：全屏半透明 overlay
  渐变：从虚拟人位置向外辐射的雾气
  CSS：radial-gradient(circle at [vh_pos], rgba(color,0.15) 0%, rgba(color,0.02) 60%, transparent 100%)
  面积：屏幕 40% 被雾覆盖
  动画：雾气从虚拟人向外扩散，2s ease-out → 5s保持 → 用户回归工作后2s消退
  角色差异化雾气颜色：ARIA蓝 | LUNA粉 | KIRA橙 | ZEN绿 | SHIN灰

Level 3 — 虚拟人走动遮挡（15-30min 摸鱼）：
  实现：虚拟人在屏幕上走动，逐步遮挡用户视野
  路径：虚拟人从右下角 → 走向屏幕中央
  速度：1cm/s（缓慢逼近——压迫感）
  到达中央后：
    站在屏幕中央，面向用户
    BlendShape：browDown 0.5 + mouthFrown 0.5（严厉表情）
    角色差异化：
      ARIA：站在中央直视，双手交叉胸前，"够了。"（10s静止）
      LUNA：走到中央蹲下，双手合十，"求你回来工作♥"（软性遮挡）
      KIRA：冲到中央，双手叉腰，脸贴近屏幕，"给我工作！"（压迫式）
      ZEN：缓步到中央，双手背后，"无谓的事做了很久。"（温和坚定）
      SHIN：精确走到中央，直视，"非工作时长已达 17min。停止。"（数据式）
  遮挡面积：虚拟人占据屏幕 15-25%
  回归条件：用户切换到工作窗口 → 虚拟人走回右下角（2s）

Level 4 — 进度锁定屏（>30min 摸鱼 或 进度严重不足）：
  实现：全屏 overlay + 进度信息 + 必须确认才能解锁
  overlay：rgba(0,0,0,0.6) + 虚拟人大图居中
  内容：
    - 虚拟人当前角色全身渲染（放大至 400×600px）
    - 进度条："今日进度 45% | 预估完成时间 22:30"
    - 确认按钮："继续工作" / "确认休息10min" / "关闭遮挡（需二次确认）"
  角色差异化锁定屏风格：
    ARIA：冷色界面，数据为主，确认按钮灰色"确认回归"
    LUNA：暖色界面，鼓励为主，确认按钮粉色"回来吧♥"
    KIRA：橙色界面，命令为主，确认按钮红色"给我工作！"
    ZEN：绿色界面，哲言为主，确认按钮绿色"回归当下"
    SHIN：灰白界面，数据为主，确认按钮银色"确认。立即。"

  解锁流程：
    1. 点击"继续工作" → 遮挡消退 1s → 虚拟人回到右下角 + 表情回归
    2. 点击"休息10min" → 遮挡消退 → 虚拟人进入sleeping状态 → 10min后再次提醒
    3. 点击"关闭遮挡" → 弹出二次确认："确定关闭？进度可能无法按时完成。" → 确认后关闭但5min后再次触发Level1
</pre>


---

## Part 5: 情感表达 BlendShape 级规格

> **目标**：10种基础情感的**完整 BlendShape 权重参数表**，5角色的**表情差异化覆盖**，情感过渡**曲线参数**。
> 编码实现时直接映射到 ARKit 52 BlendShape 权重数组。

### 5.1 10基础情感 BlendShape 权重全表

<pre>
情感编号 | 情感名 | PAD空间坐标 | 触发场景
E01 | 满足(satisfaction) | P=0.6,A=0.2,D=0.5 | 任务完成/进度达标
E02 | 专注(focus) | P=0.35,A=0.6,D=0.7 | 深度工作状态
E03 | 疑惑(confusion) | P=0.2,A=0.5,D=0.3 | 代码报错/不理解需求
E04 | 愉悦(joy) | P=0.85,A=0.7,D=0.4 | 找到bug/功能上线/同事夸奖
E05 | 焦虑(anxiety) | P=0.15,A=0.8,D=0.2 | 进度落后/deadline逼近
E06 | 不满(displeasure) | P=0.1,A=0.3,D=0.6 | 摸鱼检测/代码质量差
E07 | 惊讶(surprise) | P=0.5,A=0.9,D=0.1 | 突然会议/意外bug/系统崩溃
E08 | 疲惫(fatigue) | P=0.2,A=0.1,D=0.15 | 连续工作>3h/深夜加班
E09 | 关心(caring) | P=0.65,A=0.4,D=0.3 | 休息提醒/健康关注/同事问候
E10 | 坚定(resolution) | P=0.4,A=0.5,D=0.85 | 强制专注/必须加班决策

=== E01 满足(satisfaction) ===
BlendShape权重（0-1）：
  mouthSmile_L: 0.25 | mouthSmile_R: 0.25
  cheekSquint_L: 0.12 | cheekSquint_R: 0.12
  eyeSquint_L: 0.08 | eyeSquint_R: 0.08
  browInnerUp_L: 0.05 | browInnerUp_R: 0.05
  jawOpen: 0.02
  mouthFrown_L: 0.0 | mouthFrown_R: 0.0
  eyeWide_L: 0.0 | eyeWide_R: 0.0
  eyeClose_L: 0.0 | eyeClose_R: 0.0
  browDown_L: 0.0 | browDown_R: 0.0
  noseSneer_L: 0.0 | noseSneer_R: 0.0
  jawForward: 0.0
  tongueOut: 0.0
  mouthStretch_L: 0.0 | mouthStretch_R: 0.0
  mouthDimple_L: 0.08 | mouthDimple_R: 0.08
  mouthPress_L: 0.0 | mouthPress_R: 0.0
  mouthRollUpper: 0.0 | mouthRollLower: 0.0
  mouthShrugUpper: 0.0 | mouthShrugLower: 0.0
  mouthFunnel: 0.0
  chinRaiserLower: 0.0
  eyeLookDown_L: 0.0 | eyeLookDown_R: 0.0

=== E02 专注(focus) ===
BlendShape权重：
  mouthFrown_L: 0.10 | mouthFrown_R: 0.10
  eyeSquint_L: 0.18 | eyeSquint_R: 0.18
  browInnerUp_L: 0.08 | browInnerUp_R: 0.08
  browOuterDown_L: 0.06 | browOuterDown_R: 0.06
  jawForward: 0.05
  eyeLookDown_L: 0.15 | eyeLookDown_R: 0.15
  mouthSmile_L: 0.0 | mouthSmile_R: 0.0
  cheekSquint_L: 0.0 | cheekSquint_R: 0.0
  jawOpen: 0.02（微开——专注时偶尔默念）
  eyeWide_L: 0.0 | eyeWide_R: 0.0
  noseSneer_L: 0.0 | noseSneer_R: 0.0
  mouthPress_L: 0.05 | mouthPress_R: 0.05（微抿嘴）

=== E03 疑惑(confusion) ===
BlendShape权重：
  browInnerUp_L: 0.20 | browInnerUp_R: 0.15（左眉更高——困惑不对称）
  eyeWide_L: 0.15 | eyeWide_R: 0.15
  mouthFrown_L: 0.05 | mouthFrown_R: 0.05
  jawOpen: 0.10（嘴微张——"啊？"）
  noseSneer_L: 0.05 | noseSneer_R: 0.03
  eyeLookUp_L: 0.10 | eyeLookUp_R: 0.10（眼睛向上看——思考为什么）
  mouthPress_L: 0.0 | mouthPress_R: 0.0
  mouthSmile_L: 0.0 | mouthSmile_R: 0.0
  eyeSquint_L: 0.0 | eyeSquint_R: 0.0
  browDown_L: 0.0 | browDown_R: 0.0

=== E04 愉悦(joy) ===
BlendShape权重：
  mouthSmile_L: 0.45 | mouthSmile_R: 0.45
  cheekSquint_L: 0.30 | cheekSquint_R: 0.30
  eyeSquint_L: 0.15 | eyeSquint_R: 0.15（笑眯眼）
  jawOpen: 0.15（开心嘴张开）
  browInnerUp_L: 0.12 | browInnerUp_R: 0.12
  mouthDimple_L: 0.15 | mouthDimple_R: 0.15
  mouthRollUpper: 0.10（上唇微卷——笑容）
  chinRaiserLower: 0.08
  eyeWide_L: 0.0 | eyeWide_R: 0.0
  mouthFrown_L: 0.0 | mouthFrown_R: 0.0
  browDown_L: 0.0 | browDown_R: 0.0
  noseSneer_L: 0.0 | noseSneer_R: 0.0

=== E05 焦虑(anxiety) ===
BlendShape权重：
  browDown_L: 0.25 | browDown_R: 0.25（眉头紧皱）
  mouthFrown_L: 0.20 | mouthFrown_R: 0.20
  eyeWide_L: 0.20 | eyeWide_R: 0.20（惊恐睁大眼）
  jawForward: 0.08（咬牙）
  mouthPress_L: 0.15 | mouthPress_R: 0.15（紧抿嘴）
  eyeLookDown_L: 0.10 | eyeLookDown_R: 0.10（低看——逃避式）
  noseSneer_L: 0.08 | noseSneer_R: 0.08（鼻翼扩张——紧张）
  cheekSquint_L: 0.0 | cheekSquint_R: 0.0
  mouthSmile_L: 0.0 | mouthSmile_R: 0.0
  mouthDimple_L: 0.0 | mouthDimple_R: 0.0
  tongueOut: 0.0

=== E06 不满(displeasure) ===
BlendShape权重：
  mouthFrown_L: 0.30 | mouthFrown_R: 0.30
  browDown_L: 0.20 | browDown_R: 0.20
  noseSneer_L: 0.15 | noseSneer_R: 0.15（厌恶鼻子皱）
  jawForward: 0.05
  eyeSquint_L: 0.12 | eyeSquint_R: 0.12（眯眼不满）
  mouthPress_L: 0.10 | mouthPress_R: 0.10
  eyeLookDown_L: 0.08 | eyeLookDown_R: 0.08（低头不屑看）
  mouthSmile_L: 0.0 | mouthSmile_R: 0.0
  eyeWide_L: 0.0 | eyeWide_R: 0.0
  cheekSquint_L: 0.0 | cheekSquint_R: 0.0

=== E07 惊讶(surprise) ===
BlendShape权重：
  eyeWide_L: 0.40 | eyeWide_R: 0.40（大睁眼）
  browInnerUp_L: 0.35 | browInnerUp_R: 0.35（眉毛高抬）
  jawOpen: 0.30（嘴张大）
  mouthFunnel: 0.10（嘴微收缩成O形）
  cheekSquint_L: 0.0 | cheekSquint_R: 0.0
  mouthSmile_L: 0.0 | mouthSmile_R: 0.0
  mouthFrown_L: 0.0 | mouthFrown_R: 0.0
  noseSneer_L: 0.0 | noseSneer_R: 0.0
  browDown_L: 0.0 | browDown_R: 0.0
  eyeSquint_L: 0.0 | eyeSquint_R: 0.0

=== E08 疲惫(fatigue) ===
BlendShape权重：
  eyeClose_L: 0.30 | eyeClose_R: 0.30（半闭眼）
  mouthFrown_L: 0.15 | mouthFrown_R: 0.15
  browOuterDown_L: 0.15 | browOuterDown_R: 0.15（外眉下垂）
  jawOpen: 0.08（嘴微张——疲惫松弛）
  mouthPress_L: 0.0 | mouthPress_R: 0.0
  eyeSquint_L: 0.10 | eyeSquint_R: 0.10（眯眼）
  eyeLookDown_L: 0.20 | eyeLookDown_R: 0.20（视线下垂）
  noseSneer_L: 0.0 | noseSneer_R: 0.0
  mouthSmile_L: 0.0 | mouthSmile_R: 0.0
  cheekSquint_L: 0.0 | cheekSquint_R: 0.0
  browDown_L: 0.0 | browDown_R: 0.0

=== E09 关心(caring) ===
BlendShape权重：
  mouthSmile_L: 0.20 | mouthSmile_R: 0.20（温柔微笑）
  browInnerUp_L: 0.10 | browInnerUp_R: 0.10（眉微抬——关切）
  eyeSquint_L: 0.05 | eyeSquint_R: 0.05（微眯——柔和关注）
  cheekSquint_L: 0.10 | cheekSquint_R: 0.10
  mouthDimple_L: 0.08 | mouthDimple_R: 0.08
  eyeLookDown_L: 0.08 | eyeLookDown_R: 0.08（微低看——体贴）
  mouthFrown_L: 0.0 | mouthFrown_R: 0.0
  eyeWide_L: 0.0 | eyeWide_R: 0.0
  browDown_L: 0.0 | browDown_R: 0.0
  jawOpen: 0.02
  noseSneer_L: 0.0 | noseSneer_R: 0.0

=== E10 坚定(resolution) ===
BlendShape权重：
  browDown_L: 0.15 | browDown_R: 0.15（眉微压——坚定）
  mouthPress_L: 0.20 | mouthPress_R: 0.20（紧抿嘴——决心）
  jawForward: 0.08（下巴前推——不退缩）
  eyeSquint_L: 0.12 | eyeSquint_R: 0.12
  eyeWide_L: 0.05 | eyeWide_R: 0.05（适度睁眼——不回避）
  mouthFrown_L: 0.08 | mouthFrown_R: 0.08
  mouthSmile_L: 0.0 | mouthSmile_R: 0.0
  cheekSquint_L: 0.0 | cheekSquint_R: 0.0
  noseSneer_L: 0.0 | noseSneer_R: 0.0
  jawOpen: 0.0
  eyeLookDown_L: 0.0 | eyeLookDown_R: 0.0
</pre>

### 5.2 5角色表情差异化覆盖

<pre>
每个情感对5角色的权重覆盖系数（×原始值得到角色特化值）：

ARIA 表情差异化系数：
  E01 满足：mouthSmile ×0.4 | mouthFrown +0.05 | cheekSquint ×0.3（满足但不表现）
  E02 专注：mouthFrown ×1.3 | eyeSquint ×1.2 | jawForward ×1.5（更严肃专注）
  E03 疑惑：browInnerUp ×0.7 | jawOpen ×0.5（少表情——理性困惑）
  E04 愉悦：mouthSmile ×0.5 | cheekSquint ×0.3（克制喜悦）
  E05 焦虑：browDown ×1.5 | mouthPress ×1.3（更紧绷）
  E06 不满：mouthFrown ×1.5 | noseSneer ×1.2（更冷酷不满）
  E07 惊讶：eyeWide ×0.7 | jawOpen ×0.5（冷静惊讶——不失态）
  E08 疲惫：eyeClose ×0.5 | mouthFrown ×0.8（疲惫但不表现）
  E09 关心：mouthSmile ×0.3 | browInnerUp ×0.5（关心但克制表达）
  E10 坚定：jawForward ×1.5 | mouthPress ×1.3 | browDown ×1.2（最强坚定）

LUNA 表情差异化系数：
  E01 满足：mouthSmile ×1.5 | cheekSquint ×1.3 | mouthDimple ×1.5（超级满足）
  E02 专注：mouthFrown ×0.6 | mouthSmile +0.05（专注也微笑）
  E03 疑惑：browInnerUp ×1.2 | jawOpen ×1.3（更多表情——困惑很明显）
  E04 愉悦：mouthSmile ×1.5 | cheekSquint ×1.5 | jawOpen ×1.2（大笑）
  E05 焦虑：eyeWide ×0.8 | mouthSmile +0.05（焦虑也尝试微笑——自我安慰）
  E06 不满：mouthFrown ×0.7 | mouthSmile ×0.3（不满也有微笑底色）
  E07 惊讶：eyeWide ×1.3 | jawOpen ×1.2 | cheekSquint ×0.8（可爱惊讶）
  E08 疲惫：eyeClose ×1.2 | mouthFrown ×0.5 + mouthSmile ×0.3（疲惫但温柔）
  E09 关心：mouthSmile ×1.5 | cheekSquint ×1.3 | browInnerUp ×1.2（超级关心）
  E10 坚定：mouthPress ×0.7 | mouthSmile +0.05（坚定也温柔）

KIRA 表情差异化系数：
  E01 满足：mouthSmile ×0.8 | mouthFrown +0.03（满足但嘴硬）
  E02 专注：mouthFrown ×1.1 | eyeSquint ×1.3 | browDown +0.05（专注时更严肃）
  E03 疑惑：noseSneer ×1.3 | browDown ×0.8（疑惑→不屑）
  E04 愉悦：mouthSmile ×1.2 | cheekSquint ×0.5（笑但不大笑——傲娇克制）
  E05 焦虑：browDown ×1.5 | mouthFrown ×1.3 | noseSneer ×1.0（焦虑→愤怒）
  E06 不满：mouthFrown ×2.0 | noseSneer ×1.5（超级不满）
  E07 惊讶：eyeWide ×1.0 | jawOpen ×0.8 | mouthFrown +0.05（惊讶→不满惊讶）
  E08 疲惫：mouthFrown ×1.2 | eyeSquint ×1.0 | mouthSmile ×0.0（疲惫→烦躁）
  E09 关心：mouthSmile ×0.5 | mouthFrown +0.03（关心但伪装不满）
  E10 坚定：browDown ×1.5 | jawForward ×1.3 | mouthFrown ×1.2（最强霸道坚定）

ZEN 表情差异化系数：
  E01 满足：mouthSmile ×0.7 | mouthDimple ×0.5 | browInnerUp ×0.5（满足但不表现）
  E02 专注：mouthFrown ×0.7 | jawForward ×0.5（专注但从容）
  E03 疑惑：browInnerUp ×0.8 | jawOpen ×0.5 | noseSneer ×0.3（少表情——禅意困惑）
  E04 愉悦：mouthSmile ×0.7 | cheekSquint ×0.5（愉悦但不夸张）
  E05 焦虑：browDown ×0.8 | mouthFrown ×0.7（焦虑但不紧绷——保持平静）
  E06 不满：mouthFrown ×0.5 | noseSneer ×0.3（不满也平和）
  E07 惊讶：eyeWide ×0.6 | jawOpen ×0.3（平静惊讶——大波动也平静）
  E08 疲惫：eyeClose ×0.8 | mouthSmile ×0.3（疲惫也微笑——接受）
  E09 关心：mouthSmile ×0.8 | browInnerUp ×0.8 | eyeLookDown ×1.2（温和关心）
  E10 坚定：mouthPress ×1.0 | jawForward ×0.8（稳定坚定——不强硬）

SHIN 表情差异化系数：
  E01 满足：mouthSmile ×0.2 | mouthFrown ×0.0 | mouthPress ×0.15（满足→精确抿嘴——不笑）
  E02 专注：mouthFrown ×1.5 | eyeSquint ×1.5 | jawForward ×1.5（极致严肃专注）
  E03 疑惑：browInnerUp ×0.5 | eyeSquint ×0.8 | jawOpen ×0.3（极少表情——数据式困惑）
  E04 愉悦：mouthSmile ×0.1 | mouthDimple ×0.0（几乎不笑——"达标。"）
  E05 焦虑：browDown ×1.8 | mouthPress ×1.5 | eyeSquint ×1.3（极度紧绷焦虑）
  E06 不满：mouthFrown ×2.0 | browDown ×1.5 | noseSneer ×1.0（极度不满）
  E07 惊讶：eyeWide ×0.5 | jawOpen ×0.3（克制惊讶——数据式意外）
  E08 疲惫：eyeClose ×0.3 | mouthFrown ×0.8（疲惫不表现——控制）
  E09 关心：mouthSmile ×0.1 | mouthPress ×0.3（关心→命令式关心——"效率下降40%需休息"）
  E10 坚定：jawForward ×2.0 | mouthPress ×1.8 | browDown ×1.5（终极坚定——不容反驳）
</pre>

### 5.3 情感过渡曲线参数

<pre>
情感过渡系统：从情感A → 情感B 的动画曲线与时长

过渡类型判定规则：
  1. PAD空间距离 < 0.3：同区过渡（如 E01→E04 满足→愉悦）——快速
  2. PAD空间距离 0.3-0.6：邻近过渡（如 E02→E05 专注→焦虑）——中速
  3. PAD空间距离 > 0.6：跨区过渡（如 E04→E06 愉悦→不满）——慢速+中间态
  4. 突发过渡（外部触发如系统崩溃）：任何→E07 惊讶——超快

PAD距离计算：
  dist(P1,A1,D1, P2,A2,D2) = sqrt((P1-P2)^2 + (A1-A2)^2 + (D1-D2)^2)

过渡参数表：

同区过渡（dist < 0.3）：
  duration: 0.4s
  curve: ease-in-out
  BlendShape: 线性lerp，所有权重同时过渡
  骨骼: 不变（同区情感姿态相近）
  粒子: 旧粒子自然消亡，新粒子0.2s后开始
  示例：满足→愉悦 | 专注→坚定

邻近过渡（dist 0.3-0.6）：
  duration: 0.7s
  curve: ease-in-out
  BlendShape: 分段过渡——
    Phase 1 (0-0.3s): 当前权重降至 50%
    Phase 2 (0.3-0.7s): 新权重从 50%升至 100%
    互斥组（smile/frown）先归0再升新值
  骨骼: 0.7s线性过渡到新情感姿态
  粒子: 旧粒子0.3s停止生成，新粒子0.5s后开始
  示例：专注→焦虑 | 关心→不满

跨区过渡（dist > 0.6）：
  duration: 1.0s
  curve: ease-in-out + 中间态
  BlendShape: 3段过渡——
    Phase 1 (0-0.3s): 当前情感权重降至 30%
    Phase 2 (0.3-0.6s): 中间态——中性表情（所有权重≈0），微过渡缓冲
    Phase 3 (0.6-1.0s): 新情感权重从 0升至 100%
  骨骼: 分段——
    0-0.3s: 当前姿态微松
    0.3-0.6s: 中间姿态（放松）
    0.6-1.0s: 新情感姿态
  粒子: 旧粒子0.2s停止，中间态无粒子，新粒子0.8s后开始
  示例：愉悦→不满 | 专注→惊讶

突发过渡（任何→惊讶E07）：
  duration: 0.15s
  curve: ease-out（急速切入）
  BlendShape: 直接跳转——当前权重×0.1 + 惊讶权重×0.9（不经过中间态）
  骨骼: 0.15s急速过渡（head微后仰 + spine微缩）
  粒子: 立即停止旧粒子 + 立即开始惊讶粒子（爆发式）
  角色差异化突发反应：
    ARIA: eyeWide ×0.7（克制惊讶）| LUNA: ×1.3（大惊讶）| KIRA: ×1.0 | ZEN: ×0.6 | SHIN: ×0.5

情感叠加规则：
  情感可以叠加（不是互斥），叠加方式为权重加权平均：
  最终权重 = E1权重 × E1强度 + E2权重 × E2强度
  强度值：0-1（由PAD触发强度决定）
  示例：专注(E02,intensity=0.8) + 疑惑(E03,intensity=0.3)
    mouthFrown = 0.10×0.8 + 0.05×0.3 = 0.095
    browInnerUp = 0.08×0.8 + 0.20×0.3 = 0.124
    eyeLookDown = 0.15×0.8 + 0.0×0.3 = 0.12

情感衰减规则：
  情感触发后自然衰减：
  衰减公式：intensity(t) = initial_intensity × e^(-decay_rate × t)
  衰减率（decay_rate）根据情感类型不同：
    满足：0.05（慢衰减——满足感持续）
    专注：0.02（极慢——工作专注持续）
    疑惑：0.1（中等——困惑要么解决要么放弃）
    愉悦：0.08（中等——开心但会回归）
    焦虑：0.03（慢——焦虑持续）
    不满：0.06（中等——不满消退）
    惊讶：0.3（快衰减——惊讶很快过去）
    疲惫：0.01（极慢——疲惫持续到休息）
    关心：0.04（慢——关心持续）
    坚定：0.02（极慢——坚定持续到完成）

情感最小阈值：
  intensity < 0.05 → 情感不表现（低于阈值的情感不渲染到BlendShape）
  intensity > 0.95 → 权重值cap在原始值×1.0（不超限）
</pre>


---

## Part 6: 技术实现规格

> **目标**：提供完整的**架构设计、关键代码片段、GLSL shader代码、文件结构**，编码实现可直接参照。
> 本部分是开发者的技术蓝图——每个模块、每个shader、每个文件路径都有明确规格。

### 6.1 Three.js + VRM 渲染架构

<pre>
渲染架构总览：

┌─────────────────────────────────────────────────────────┐
│                    Electron 主进程                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ MonitorModule │  │  AI/ChatModule │  │  StateModule  │   │
│  │ (屏幕/活动监控)│  │ (问答/分析/提醒)│  │ (FSM/行为树)  │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│         │                  │                  │          │
│         └──────────────────┼──────────────────┘          │
│                            │                             │
│                    EventBus (ipcMain)                     │
└─────────────────────────────────────────────────────────┘
                            │ ipcBridge
┌─────────────────────────────────────────────────────────┐
│                  Electron 渲染进程                        │
│                                                          │
│  ┌─ VirtualHumanRenderer ──────────────────────────────┐ │
│  │                                                      │ │
│  │  SceneGraph                                          │ │
│  │  ├─ VRMModelManager (5角色懒加载)                     │ │
│  │  │  ├─ currentModel: VRM                             │ │
│  │  │  ├─ preloadQueue: VRM[]                           │ │
│  │  │  └─ morphTargetCache: Map                         │ │
│  │  │                                                   │ │
│  │  ├─ AnimationSystem                                  │ │
│  │  │  ├─ StateAnimationLayer (状态动画：coding/slack等) │ │
│  │  │  ├─ ExpressionLayer (BlendShape情感表情)           │ │
│  │  │  ├─ MicroBehaviorLayer (14微行为叠加)              │ │
│  │  │  ├─ TransitionManager (状态过渡动画)               │ │
│  │  │  └─ BlendShapeInterpolator (权重lerp引擎)         │ │
│  │  │                                                   │ │
│  │  ├─ PhysicsSystem                                    │ │
│  │  │  ├─ SpringBoneManager (头发/衣服物理)             │ │
│  │  │  ├─ DragPhysicsController (拖拽物理3阶段)         │ │
│  │  │  └─ InertiaSimulator (惯性残留计算)               │ │
│  │  │                                                   │ │
│  │  ├─ InteractionSystem                                │ │
│  │  │  ├─ CollisionDetector (8区域碰撞检测)             │ │
│  │  │  ├─ ClickFeedbackManager (点击反馈动画)           │ │
│  │  │  ├─ MouseLinkageController (5级鼠标联动)          │ │
│  │  │  └─ ScreenBlockManager (4级遮挡系统)              │ │
│  │  │                                                   │ │
│  │  ├─ ParticleSystem                                   │ │
│  │  │  ├─ ParticlePool (对象池)                         │ │
│  │  │  ├─ ParticleEmitter (各状态粒子发射器)            │ │
│  │  │  └─ ParticleRenderer (InstancedMesh批量渲染)     │ │
│  │  │                                                   │ │
│  │  ├─ EmotionEngine                                    │ │
│  │  │  ├─ PADSpace (3D情感坐标空间)                     │ │
│  │  │  ├─ EmotionDecayManager (情感衰减器)              │ │
│  │  │  ├─ EmotionTransitionCalculator (过渡曲线计算)    │ │
│  │  │  └─ CharacterEmotionModifier (角色差异化覆盖)    │ │
│  │  │                                                   │ │
│  │  ├─ LightManager                                     │ │
│  │  │  ├─ 5-light system (key/fill/rim/ambient/status) │ │
│  │  │  └─ StateLightProfileManager (状态光照参数映射)  │ │
│  │  │                                                   │ │
│  │  ├─ PostProcessingPipeline                           │ │
│  │  │  ├─ BloomPass                                     │ │
│  │  │  ├─ SSAOPass                                      │ │
│  │  │  ├─ ColorGradingPass                              │ │
│  │  │  ├─ VignettePass                                  │ │
│  │  │  ├─ FilmGrainPass                                 │ │
│  │  │  └─ FXAAPass                                      │ │
│  │  │                                                   │ │
│  │  ├─ LODManager                                       │ │
│  │  │  ├─ SizeBasedLODSwitcher                          │ │
│  │  │  ├─ PerformanceBasedLODSwitcher                   │ │
│  │  │  └─ LODProfileStore                               │ │
│  │  │                                                   │ │
│  │  └─ PerformanceMonitor                               │ │
│  │     ├─ CPU/GPU/RAM sampler (每5s采样)              │ │
│  │     ├─ PerformanceLevelDecider (full/medium/minimal/critical) │ │
│  │     └─ DegradationActionExecutor                     │ │
│  │                                                      │ │
│  │  WebGLRenderer (transparent, always-on-top)          │ │
│  │  └─ setIgnoreMouseEvents(clickThroughMode)           │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                          │
│  BrowserWindow: transparent=true, alwaysOnTop=true      │
│  Size: 100vw × 100vh (全屏覆盖但大部分区域点击穿透)      │
└─────────────────────────────────────────────────────────┘
</pre>

### 6.2 关键代码结构

<pre>
// === src/renderer/virtual-human/VRMModelManager.ts ===

interface VRMModelConfig {
  characterId: CharacterId; // 'ARIA' | 'LUNA' | 'KIRA' | 'ZEN' | 'SHIN'
  lodLevel: LODLevel;       // 0-3 (4=sprite, no model)
  modelPath: string;        // `assets/models/${characterId}_LOD${lodLevel}.vrm`
}

class VRMModelManager {
  private currentModel: VRM | null = null;
  private currentCharacter: CharacterId = 'ARIA';
  private preloadQueue: Map<CharacterId, VRM> = new Map();
  private morphTargetCache: Map<string, number> = new Map();

  async loadCharacter(id: CharacterId, lod: LODLevel): Promise<VRM> {
    const path = `assets/models/${id}_LOD${lod}.vrm`;
    const gltf = await new GLTFLoader().loadAsync(path);
    const vrm = await VRMLoaderPlugin.parse(gltf);
    this.cacheMorphTargets(vrm);
    return vrm;
  }

  async switchCharacter(targetId: CharacterId): Promise<void> {
    // Phase 1: exit animation (0.8s)
    await this.playExitAnimation(this.currentCharacter);
    // Phase 2: dispose old, load new
    this.disposeCurrentModel();
    const preloaded = this.preloadQueue.get(targetId);
    if (preloaded) {
      this.currentModel = preloaded;
      this.preloadQueue.delete(targetId);
    } else {
      this.currentModel = await this.loadCharacter(targetId, this.currentLOD);
    }
    this.currentCharacter = targetId;
    // Phase 3: entrance animation (1.5s)
    await this.playEntranceAnimation(targetId);
  }

  private cacheMorphTargets(vrm: VRM): void {
    vrm.expressionManager.expressions.forEach((expr) => {
      this.morphTargetCache.set(expr.name, expr.morphTargetWeight);
    });
  }

  setBlendShapeWeights(weights: Map<string, number>): void {
    if (!this.currentModel) return;
    weights.forEach((weight, name) => {
      this.currentModel.expressionManager.setValue(name, weight);
    });
  }

  preloadCharacter(id: CharacterId): void {
    if (this.preloadQueue.has(id)) return;
    this.loadCharacter(id, this.currentLOD).then(vrm => {
      this.preloadQueue.set(id, vrm);
    });
  }
}

// === src/renderer/virtual-human/BlendShapeInterpolator.ts ===

interface BlendShapeTransition {
  targetWeights: Map<string, number>;
  duration: number;       // seconds
  curve: 'linear' | 'ease-in-out' | 'ease-out' | 'ease-out-bounce';
  startTime: number;
  startWeights: Map<string, number>;
}

class BlendShapeInterpolator {
  private activeTransitions: BlendShapeTransition[] = [];

  startTransition(
    fromWeights: Map<string, number>,
    toWeights: Map<string, number>,
    duration: number,
    curve: string
  ): void {
    this.activeTransitions.push({
      targetWeights: toWeights,
      duration,
      curve: this.parseCurve(curve),
      startTime: performance.now() / 1000,
      startWeights: fromWeights,
    });
  }

  update(currentTime: number): Map<string, number> {
    const result = new Map<string, number>();
    // Process all active transitions, apply most recent per BlendShape
    for (const transition of this.activeTransitions) {
      const elapsed = currentTime - transition.startTime;
      const progress = Math.min(elapsed / transition.duration, 1.0);
      const curveValue = this.applyCurve(progress, transition.curve);
      transition.targetWeights.forEach((target, name) => {
        const start = transition.startWeights.get(name) ?? 0;
        result.set(name, start + (target - start) * curveValue);
      });
    }
    // Clean up completed transitions
    this.activeTransitions = this.activeTransitions.filter(
      t => (currentTime - t.startTime) < t.duration
    );
    return result;
  }

  private applyCurve(t: number, curve: string): number {
    switch (curve) {
      case 'ease-in-out': return t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      case 'ease-out': return 1 - (1-t)*(1-t);
      case 'ease-out-bounce':
        if (t < 0.7) return 1 - (1-t/0.7)*(1-t/0.7);
        return 1 - 0.3 * Math.abs(Math.sin((t-0.7)*3*Math.PI));
      default: return t; // linear
    }
  }
}

// === src/renderer/virtual-human/EmotionEngine.ts ===

interface PADCoordinates {
  pleasure: number;  // 0-1
  arousal: number;   // 0-1
  dominance: number;  // 0-1
}

interface EmotionState {
  emotionId: EmotionId;  // E01-E10
  intensity: number;     // 0-1, decays over time
  timestamp: number;     // when triggered
  source: string;        // what triggered it
}

class EmotionEngine {
  private activeEmotions: EmotionState[] = [];
  private characterId: CharacterId;
  private decayRates: Map<EmotionId, number> = new Map([
    ['E01', 0.05], ['E02', 0.02], ['E03', 0.10], ['E04', 0.08],
    ['E05', 0.03], ['E06', 0.06], ['E07', 0.30], ['E08', 0.01],
    ['E09', 0.04], ['E10', 0.02],
  ]);
  private characterModifiers: Map<CharacterId, Map<EmotionId, Map<string, number>>> = new Map();
  // ... loaded from Part 5 data

  triggerEmotion(emotionId: EmotionId, intensity: number, source: string): void {
    this.activeEmotions.push({
      emotionId, intensity, timestamp: Date.now()/1000, source
    });
    // Keep only top 3 active emotions by intensity
    this.activeEmotions.sort((a,b) => b.intensity - a.intensity);
    this.activeEmotions = this.activeEmotions.slice(0, 3);
  }

  computeBlendShapeWeights(currentTime: number): Map<string, number> {
    // 1. Decay all emotions
    this.activeEmotions.forEach(e => {
      const rate = this.decayRates.get(e.emotionId) ?? 0.05;
      e.intensity *= Math.exp(-rate * (currentTime - e.timestamp));
    });
    // Remove emotions below threshold
    this.activeEmotions = this.activeEmotions.filter(e => e.intensity > 0.05);

    // 2. Compute weighted average
    const result = new Map<string, number>();
    const baseWeights = this.getBaseEmotionWeights(); // E01-E10 base tables from Part 5
    const modifiers = this.characterModifiers.get(this.characterId);

    this.activeEmotions.forEach(emotion => {
      const base = baseWeights.get(emotion.emotionId)!;
      base.forEach((weight, blendShape) => {
        let finalWeight = weight;
        // Apply character modifier
        if (modifiers) {
          const mod = modifiers.get(emotion.emotionId)?.get(blendShape);
          if (mod) finalWeight *= mod;
        }
        const existing = result.get(blendShape) ?? 0;
        result.set(blendShape, existing + finalWeight * emotion.intensity);
      });
    });
    return result;
  }
}

// === src/renderer/virtual-human/CollisionDetector.ts ===

class CollisionDetector {
  private regions: Map<string, THREE.Box3> = new Map();
  // Region definitions mapped from VRM humanoid bones:
  // HEAD: head bone bounding box
  // FACE: head-jaw area
  // CHEST: spine_03 area
  // LEFT_ARM: left_upper_arm + left_lower_arm
  // RIGHT_ARM: right_upper_arm + right_lower_arm
  // LEFT_HAND: left_hand + fingers
  // RIGHT_HAND: right_hand + fingers
  // LOWER_BODY: upper_legs + lower_legs + feet

  updateRegionBounds(vrm: VRM): void {
    const humanoid = vrm.humanoid;
    const boneMap = humanoid.getBoneMapping();
    for (const [regionName, boneNames] of this.regionBoneMap) {
      const bones = boneNames.map(b => boneMap.get(b)?.node);
      const box = new THREE.Box3();
      bones.forEach(b => { if (b) box.expandByObject(b); });
      this.regions.set(regionName, box);
    }
  }

  detectHit(mousePos: THREE.Vector2, camera: THREE.Camera): string | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mousePos, camera);
    for (const [name, box] of this.regions) {
      // Check ray-box intersection
      if (raycaster.ray.intersectsBox(box)) return name;
    }
    return null;
  }
}

// === src/renderer/virtual-human/SpringBoneManager.ts ===

class SpringBoneManager {
  private springBones: VRMSpringBone[] = [];
  private currentStiffnessMultiplier: number = 1.0;
  private currentGravityMultiplier: number = 1.0;
  private externalForce: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

  update(deltaTime: number): void {
    this.springBones.forEach(bone => {
      // Override VRM SpringBone parameters with state-specific multipliers
      bone.settings.stiffness = bone.settings.stiffness * this.currentStiffnessMultiplier;
      bone.settings.gravityPower = bone.settings.gravityPower * this.currentGravityMultiplier;
      // Add external force (drag inertia, wind, etc.)
      bone.center?.add(this.externalForce.clone().multiplyScalar(deltaTime));
    });
  }

  setPhysicsProfile(profile: PhysicsProfile): void {
    this.currentStiffnessMultiplier = profile.stiffnessMultiplier;
    this.currentGravityMultiplier = profile.gravityMultiplier;
    this.currentDampingMultiplier = profile.dampingMultiplier;
  }

  setExternalForce(force: THREE.Vector3): void {
    this.externalForce = force;
  }
}
</pre>

### 6.3 Toon + PBR 混合 Shader (GLSL)

<pre>
// === Vertex Shader: workon_toon_pbr.vert ===

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec4 tangent; // TBN for normal map

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec2 vUv;
varying vec3 vViewDir;
varying mat3 vTBN;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  vWorldNormal = normalize(normalMatrix * normal);
  vUv = uv;
  vViewDir = normalize(cameraPosition - worldPos.xyz);

  // Build TBN matrix for normal mapping
  vec3 T = normalize(normalMatrix * tangent.xyz);
  vec3 B = normalize(cross(vWorldNormal, T) * tangent.w);
  vec3 N = vWorldNormal;
  vTBN = mat3(T, B, N);

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}

// === Fragment Shader: workon_toon_pbr.frag ===

uniform sampler2D albedoMap;
uniform sampler2D normalMap;
uniform sampler2D roughnessMap;
uniform sampler2D metallicMap;
uniform sampler2D aoMap;
uniform sampler2D emissionMap;
uniform sampler2D toonRampMap;

uniform float toonWeight;    // 0-1, blending factor
uniform vec3 keyLightDir;
uniform vec3 keyLightColor;
uniform float keyLightIntensity;
uniform vec3 fillLightDir;
uniform vec3 fillLightColor;
uniform float fillLightIntensity;
uniform vec3 rimLightColor;
uniform float rimLightIntensity;
uniform vec3 ambientColor;
uniform float ambientIntensity;
uniform vec3 statusLightColor;
uniform float statusLightIntensity;
uniform vec3 statusLightPos;
uniform vec3 scatterColor;     // SSS scatter color
uniform float scatterRadius;   // SSS radius in mm
uniform bool enableSSS;
uniform vec3 cameraPosition;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec2 vUv;
varying vec3 vViewDir;
varying mat3 vTBN;

// === PBR: Cook-Torrance BRDF ===
float distributionGGX(vec3 N, vec3 H, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float NdotH = max(dot(N, H), 0.0);
  float NdotH2 = NdotH * NdotH;
  float denom = NdotH2 * (a2 - 1.0) + 1.0;
  return a2 / (PI * denom * denom);
}

float geometrySchlickGGX(float NdotV, float roughness) {
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}

float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
  float NdotV = max(dot(N, V), 0.0);
  float NdotL = max(dot(N, L), 0.0);
  return geometrySchlickGGX(NdotV, roughness) * geometrySchlickGGX(NdotL, roughness);
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// === Toon: Ramp Shading ===
vec3 toonRampShading(vec3 N, vec3 L, vec3 albedo) {
  float NdotL = dot(N, L);
  // Map NdotL from [-1,1] to [0,1] for ramp texture lookup
  float rampU = clamp(NdotL * 0.5 + 0.5, 0.0, 1.0);
  // Sample 1D toon ramp texture (stored as 1×N gradient)
  vec3 rampColor = texture2D(toonRampMap, vec2(rampU, 0.5)).rgb;
  return albedo * rampColor;
}

// === SSS: Subsurface Scattering Approximation ===
vec3 sssApproximation(vec3 N, vec3 L, vec3 albedo, vec3 viewDir) {
  // Wrap lighting for SSS
  float sssWrap = 0.5; // wrap factor
  float NdotLWrap = (dot(N, L) + sssWrap) / (1.0 + sssWrap);
  NdotLWrap = clamp(NdotLWrap, 0.0, 1.0);

  // View-dependent scattering
  float VdotL = pow(clamp(dot(viewDir, L), 0.0, 1.0), 2.0);
  // Thickness approximation (backface lit = thin area)
  float thickness = clamp(1.0 - dot(N, L), 0.0, 1.0);
  vec3 scatter = scatterColor * thickness * VdotL * 0.5;

  return albedo * NdotLWrap + scatter;
}

void main() {
  // Sample textures
  vec3 albedo = texture2D(albedoMap, vUv).rgb;
  vec3 normalTS = texture2D(normalMap, vUv).rgb * 2.0 - 1.0;
  float roughness = texture2D(roughnessMap, vUv).r;
  float metallic = texture2D(metallicMap, vUv).r;
  float ao = texture2D(aoMap, vUv).r;
  vec3 emission = texture2D(emissionMap, vUv).rgb;

  // Transform normal to world space
  vec3 N = normalize(vTBN * normalTS);
  vec3 V = normalize(vViewDir);

  // === PBR Component ===
  vec3 Lo = vec3(0.0);

  // Key Light (main directional)
  vec3 L_key = normalize(keyLightDir);
  vec3 H_key = normalize(V + L_key);
  vec3 F0 = mix(vec3(0.04), albedo, metallic);
  float D_key = distributionGGX(N, H_key, roughness);
  float G_key = geometrySmith(N, V, L_key, roughness);
  vec3 F_key = fresnelSchlick(max(dot(H_key, V), 0.0), F0);
  vec3 kd_key = (1.0 - F_key) * (1.0 - metallic);
  float NdotL_key = max(dot(N, L_key), 0.0);
  vec3 diffuse_key = kd_key * albedo / PI;
  vec3 specular_key = (D_key * G_key * F_key) / (4.0 * max(dot(N, V), 0.0) * NdotL_key + 0.001);
  Lo += (diffuse_key + specular_key) * keyLightColor * keyLightIntensity * NdotL_key;

  // Fill Light
  vec3 L_fill = normalize(fillLightDir);
  float NdotL_fill = max(dot(N, L_fill), 0.0);
  vec3 kd_fill = (1.0 - F0) * (1.0 - metallic);
  Lo += kd_fill * albedo * fillLightColor * fillLightIntensity * NdotL_fill / PI;

  // Rim Light (specular rim)
  float rimFactor = 1.0 - max(dot(N, V), 0.0);
  rimFactor = pow(rimFactor, 3.0) * roughness; // rim sharper on smoother surfaces
  Lo += rimLightColor * rimLightIntensity * rimFactor;

  // Status Light (point light from below)
  vec3 L_status = normalize(statusLightPos - vWorldPosition);
  float dist_status = length(statusLightPos - vWorldPosition);
  float atten_status = 1.0 / (1.0 + 0.1 * dist_status + 0.01 * dist_status * dist_status);
  float NdotL_status = max(dot(N, L_status), 0.0);
  Lo += statusLightColor * statusLightIntensity * atten_status * NdotL_status * albedo;

  // Ambient
  vec3 ambient = albedo * ambientColor * ambientIntensity * ao;
  vec3 pbrResult = ambient + Lo + emission;

  // === SSS Component (override PBR diffuse if enabled) ===
  vec3 sssResult = vec3(0.0);
  if (enableSSS && metallic < 0.1) {
    sssResult = sssApproximation(N, normalize(keyLightDir), albedo, V);
    sssResult += albedo * ambientColor * ambientIntensity * ao;
    sssResult += emission;
    // Replace PBR diffuse with SSS, keep specular
    vec3 sssSpecular = (D_key * G_key * F_key) / (4.0 * max(dot(N, V), 0.0) * NdotL_key + 0.001);
    pbrResult = sssResult * (1.0 - F_key.x) + sssSpecular * keyLightColor * keyLightIntensity * NdotL_key;
    pbrResult += rimLightColor * rimLightIntensity * rimFactor;
    pbrResult += statusLightColor * statusLightIntensity * atten_status * NdotL_status;
  }

  // === Toon Component ===
  vec3 toonResult = toonRampShading(N, normalize(keyLightDir), albedo);
  // Add rim in toon mode too
  toonResult += rimLightColor * rimLightIntensity * pow(1.0 - max(dot(N, V), 0.0), 2.0) * 0.5;
  // Add ambient
  toonResult += albedo * ambientColor * ambientIntensity * ao * 0.5;
  // Add emission
  toonResult += emission;

  // === Final Blend: PBR × (1-toonWeight) + Toon × toonWeight ===
  vec3 finalColor = mix(pbrResult, toonResult, toonWeight);

  // Tone mapping (ACES)
  finalColor = ACESFilm(finalColor);

  // Gamma correction
  finalColor = pow(finalColor, vec3(1.0 / 2.2));

  gl_FragColor = vec4(finalColor, 1.0);
}

// ACES Filmic Tone Mapping
vec3 ACESFilm(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}
</pre>

### 6.4 Electron 透明窗口配置

<pre>
// === src/main/window-manager.ts ===

function createVirtualHumanWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: screen.width,
    height: screen.height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      offscreenRendering: true,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // CSS for transparent background:
  // body { background: transparent; }
  // canvas { background: transparent; }

  // Click-through regions:
  // Default: entire window click-through (setIgnoreMouseEvents true, forward: true)
  // When mouse is over virtual human region: setIgnoreMouseEvents false (interactive)
  // When mouse is over blocking overlay: setIgnoreMouseEvents false (blocking)
  // When in P0 deep focus: setIgnoreMouseEvents true entirely (no interaction)

  win.setIgnoreMouseEvents(true, { forward: true }); // default: click-through

  win.loadFile('renderer/virtual-human.html');
  return win;
}

// === Dynamic click-through management ===

class ClickThroughManager {
  private window: BrowserWindow;
  private virtualHumanBounds: THREE.Box2; // screen-space bounds of virtual human
  private blockingOverlayActive: boolean = false;

  update(mouseX: number, mouseY: number): void {
    if (this.blockingOverlayActive) {
      // Blocking overlay active: no click-through anywhere
      this.window.setIgnoreMouseEvents(false);
      return;
    }

    const isInVirtualHuman = this.virtualHumanBounds.containsPoint(
      new THREE.Vector2(mouseX, mouseY)
    );

    if (isInVirtualHuman) {
      // Mouse over virtual human: interactive
      this.window.setIgnoreMouseEvents(false);
    } else {
      // Mouse elsewhere: click-through (clicks go to apps underneath)
      this.window.setIgnoreMouseEvents(true, { forward: true });
    }
  }

  setBlockingOverlay(active: boolean): void {
    this.blockingOverlayActive = active;
  }
}
</pre>

### 6.5 完整文件结构

<pre>
workonKIMI/                           (项目根目录)
├── package.json
├── electron-builder.json             (Electron打包配置)
├── tsconfig.json
├── webpack.config.ts
│
├── assets/
│   ├── models/
│   │   ├── ARIA_LOD0.vrm            (45-60K tris, VRM 1.0)
│   │   ├── ARIA_LOD1.vrm            (25-35K tris)
│   │   ├── ARIA_LOD2.vrm            (12-18K tris)
│   │   ├── ARIA_LOD3.vrm            (5-8K tris)
│   │   ├── ARIA_sprites.png         (LOD4 sprite sheet)
│   │   ├── LUNA_LOD0.vrm ... LUNA_LOD3.vrm, LUNA_sprites.png
│   │   ├── KIRA_LOD0.vrm ... KIRA_LOD3.vrm, KIRA_sprites.png
│   │   ├── ZEN_LOD0.vrm ... ZEN_LOD3.vrm, ZEN_sprites.png
│   │   ├── SHIN_LOD0.vrm ... SHIN_LOD3.vrm, SHIN_sprites.png
│   │   └── morph_targets/           (方案B的Morph Target数据)
│   │       ├── base_model.vrm
│   │       ├── ARIA_morphs.json
│   │       ├── LUNA_morphs.json ... SHIN_morphs.json
│   │
│   ├── textures/
│   │   ├── ARIA/
│   │   │   ├── skin_albedo.ktx2     (BC7压缩)
│   │   │   ├── skin_normal.ktx2
│   │   │   ├── skin_roughness.ktx2
│   │   │   ├── skin_metallic.ktx2   (接近全0)
│   │   │   ├── skin_ao.ktx2
│   │   │   ├── skin_emission.ktx2   (暗→blush区域红)
│   │   │   ├── skin_pore_detail.ktx2
│   │   │   ├── hair_albedo.ktx2
│   │   │   ├── hair_normal.ktx2
│   │   │   ├── hair_roughness.ktx2
│   │   │   ├── eye_iris_albedo.ktx2
│   │   │   ├── eye_iris_normal.ktx2
│   │   │   ├── cloth_top_albedo.ktx2 ... cloth_pants_albedo.ktx2
│   │   │   ├── toon_ramp_skin.png   (1×256 gradient)
│   │   │   ├── toon_ramp_hair.png
│   │   │   └── toon_ramp_cloth.png
│   │   ├── LUNA/ ... (same structure)
│   │   ├── KIRA/ ... ZEN/ ... SHIN/ ...
│   │   └── shared/
│   │       ├── toon_ramp_default.png
│   │       ├── toon_ramp_emission.png
│   │       ├── teeth_albedo.ktx2
│   │       └── mouth_internal_albedo.ktx2
│   │
│   ├── audio/
│   │   ├── voice/                    (TTS输出缓存)
│   │   │   ├── aria_cache/           (ARIA语音缓存)
│   │   │   ├── luna_cache/ ... shin_cache/
│   │   ├── effects/
│   │   │   ├── typing_key.mp3        (打字音效)
│   │   │   ├── bubble_pop.mp3
│   │   │   ├── drag_grab.mp3
│   │   │   ├── drag_release.mp3
│   │   │   ├── switch_arria.mp3 ... (角色切换音效)
│   │
│   ├── shaders/
│   │   ├── workon_toon_pbr.vert.glsl
│   │   ├── workon_toon_pbr.frag.glsl
│   │   ├── workon_sss_skin.frag.glsl (SSS皮肤子shader)
│   │   ├── workon_eye_refraction.frag.glsl (眼球折射shader)
│   │   └── workon_hair_anisotropic.frag.glsl (头发各向异性shader)
│   │
│   └── particles/
│       ├── spark_sprite.png          (灵感火花)
│       ├── bubble_sprite.png         (懒散气泡)
│       ├── data_stream_sprite.png    (AI数据流)
│       └── zzz_sprite.png            (睡眠Z)
│
├── src/
│   ├── main/
│   │   ├── index.ts                  (Electron主进程入口)
│   │   ├── window-manager.ts         (透明窗口管理)
│   │   ├── ipc-bridge.ts             (主进程↔渲染进程通信)
│   │   ├── monitor-module.ts         (屏幕/活动监控)
│   │   ├── state-module.ts           (FSM状态机+行为树)
│   │   ├── ai-chat-module.ts         (问答/分析/提醒引擎)
│   │   ├── notification-module.ts    (统一通知系统)
│   │   └── settings-module.ts         (设置管理)
│   │
│   ├── renderer/
│   │   ├── index.ts                  (渲染进程入口)
│   │   ├── virtual-human.html        (透明窗口HTML)
│   │   ├── virtual-human/
│   │   │   ├── VirtualHumanApp.ts    (渲染进程总控)
│   │   │   ├── VRMModelManager.ts    (模型加载/切换)
│   │   │   ├── AnimationSystem.ts    (3层动画管理)
│   │   │   ├── StateAnimationLayer.ts
│   │   │   ├── ExpressionLayer.ts
│   │   │   ├── MicroBehaviorLayer.ts
│   │   │   ├── TransitionManager.ts
│   │   │   ├── BlendShapeInterpolator.ts
│   │   │   ├── EmotionEngine.ts      (PAD情感引擎)
│   │   │   ├── PhysicsSystem.ts
│   │   │   ├── SpringBoneManager.ts
│   │   │   ├── DragPhysicsController.ts
│   │   │   ├── InteractionSystem.ts
│   │   │   ├── CollisionDetector.ts
│   │   │   ├── ClickFeedbackManager.ts
│   │   │   ├── MouseLinkageController.ts
│   │   │   ├── ScreenBlockManager.ts
│   │   │   ├── ParticleSystem.ts
│   │   │   ├── ParticlePool.ts
│   │   │   ├── ParticleEmitter.ts
│   │   │   ├── LightManager.ts
│   │   │   ├── PostProcessingPipeline.ts
│   │   │   ├── LODManager.ts
│   │   │   ├── PerformanceMonitor.ts
│   │   │   ├── ClickThroughManager.ts
│   │   │   └── CharacterSwitchManager.ts
│   │   │
│   │   ├── main-app/
│   │   │   ├── MainApp.html          (主应用窗口)
│   │   │   ├── MainApp.ts
│   │   │   ├── views/                (日历/监控/规划/报表/桌搭/设置)
│   │   │   └── components/           (UI组件库)
│   │   │
│   │   └── shared/
│   │       ├── EventBus.ts           (跨进程事件总线)
│   │       ├── StateStore.ts         (状态数据仓库)
│   │       └── ConfigLoader.ts         (配置加载器)
│   │
│   └── shared/
│       ├── types/
│       │   ├── character.ts          (角色类型定义)
│       │   ├── emotion.ts            (情感类型定义)
│       │   ├── state.ts              (状态类型定义)
│       │   ├── physics.ts            (物理参数类型)
│       │   ├── animation.ts          (动画类型定义)
│       │   └─── interaction.ts          (交互类型定义)
│       │
│       ├── constants/
│       │   ├── blendshape-tables.ts   (ARKit 52 权重表——Part 5数据)
│       │   ├── state-params.ts        (状态参数表——Part 3数据)
│       │   ├── character-configs.ts   (角色配置——Part 2数据)
│       │   ├── emotion-tables.ts      (情感参数表——Part 5数据)
│       │   ├── light-profiles.ts      (光照参数——Part 3数据)
│       │   └── particle-configs.ts      (粒子配置——Part 3数据)
│       │
│       └─── utils/
│           ├── math-helpers.ts
│           └── animation-helpers.ts
│
├── docs/                              (设计文档——不打包到产品)
│   ├── workon-design-spec-v2.md
│   ├── workon-design-spec-v2.1-interaction-upgrade.md
│   ├── workon-design-spec-v2.2-report-plan-calendar.md
│   ├── workon-design-spec-v2.3-product-flow-restructure.md
│   ├── workon-design-spec-v2.4-emotion-system.md
│   ├── workon-design-spec-v2.5-virtual-human-complete.md
│   ├── workon-design-spec-v3.0-virtual-human-final.md  (★权威虚拟人规格)
│   └─── workon-dev-master-prd.md        (★主PRD入口文档)
│
└── tests/
    ├── renderer/
    │   ├── VRMModelManager.test.ts
    │   ├── BlendShapeInterpolator.test.ts
    │   ├── EmotionEngine.test.ts
    │   ├── CollisionDetector.test.ts
    │   ├── PerformanceMonitor.test.ts
    │   └── AnimationSystem.test.ts
    └── main/
        ├── MonitorModule.test.ts
        ├── StateModule.test.ts
        └─── AIChatModule.test.ts
</pre>

### 6.6 状态机（FSM）规格

<pre>
状态机架构：

FSM States（16个核心状态 + 3个系统状态）：
  Work States: coding | writing | thinking | meeting | presenting | AI_chat | AI_dev | designing
  Non-Work: slack | eating | drinking | sleeping
  Transition: idle | walking
  Special: drag_lift | forced_focus
  System: loading | error | hidden

FSM Transitions（触发条件 → 目标状态）：
  Monitor detects coding activity → coding
  Monitor detects slack activity → slack
  Monitor detects meeting app → meeting
  Monitor detects writing app → writing
  Monitor detects thinking (idle+no-mouse) → thinking
  Monitor detects AI chat window → AI_chat
  Monitor detects AI dev tool → AI_dev
  Monitor detects design tool → designing
  Monitor detects eating/drinking → eating/drinking
  Monitor detects inactivity >30min → sleeping
  Mouse grab on virtual human → drag_lift
  Mouse release → previous_state (via drag_lift exit)
  Slack >30min + progress insufficient → forced_focus
  Focus recovered (work window) → coding (from forced_focus)
  Any state + system error → error
  Performance critical → hidden (LOD4, no 3D render)

FSM Priority（同一时刻多个触发时，高优先级胜出）：
  P0: drag_lift | forced_focus | error | hidden
  P1: meeting | presenting | sleeping
  P2: coding | writing | AI_dev
  P3: thinking | designing | AI_chat
  P4: slack | eating | drinking
  P5: idle | walking

Behavior Tree Overlay（叠加在FSM之上的决策树）：
  Root: Sequence
  ├─ Check: Is user working?
  │   ├─ Yes → Sequence: WorkSupport
  │   │   ├─ Action: MatchWorkState (FSM state)
  │   │   ├─ Check: IsDeepFocus (P0)?
  │   │   │   ├─ Yes → Action: SilentMode (no micro-behaviors, no Q&A)
  │   │   │   └─ No → Action: ActiveCompanion (micro-behaviors, occasional prompts)
  │   │   ├─ Check: WorkDuration >2h?
  │   │   │   ├─ Yes → Action: SuggestBreak (trigger caring emotion)
  │   │   │   └─ No → Continue
  │   └─ No → Sequence: SlackIntervention
  │     ├─ Action: MatchSlackState (FSM state)
  │     ├─ Check: SlackDuration
  │     │   ├─ <5min → Action: Level1_RemindBubble
  │     │   ├─ 5-15min → Action: Level2_FogOverlay
  │     │   ├─ 15-30min → Action: Level3_WalkBlock
  │     │   └─ >30min → Action: Level4_ProgressLock
  │     ├─ Check: ProgressRisk
  │     │   ├─ Progress <50% at 14:00 → Action: UrgentWarning (anxiety emotion)
  │     │   └─ Progress OK → Action: GentleReminder (caring emotion)

  Emotion Decision Layer (parallel to behavior tree):
    Parallel: Selector
    ├─ Check: TaskCompleted → Emotion: joy/satisfaction
    ├─ Check: BugFound → Emotion: confusion
    ├─ Check: DeadlineApproaching → Emotion: anxiety
    ├─ Check: UserSick/Tired → Emotion: caring
    ├─ Check: SlackDetected → Emotion: displeasure
    ├─ Check: SurpriseEvent → Emotion: surprise
    ├─ Default → Emotion: focus (work) / neutral (idle)
</pre>


---

## Part 7: UI 设计意图与约束

> **目标**：明确 UI 各部分的**设计意图、交互逻辑、视觉约束**，但**不规定具体视觉细节**，
> 留有空间让模型/设计师发挥创造力。编码时需满足约束条件，视觉细节可在此范围内自由探索。

### 7.1 总体设计哲学

<pre>
WorkOn UI 设计哲学：

核心原则："工具感 > 装饰感"——用户在工作时，UI是辅助工具，不是干扰源。
视觉语言：极简 + 状态指示清晰 + 微交互精致
色彩体系：深色模式为主（用户多为程序员，暗色环境工作）
         浅色模式作为备选（会议/日间使用）
信息密度：高密度但不杂乱——信息分层，核心信息突出，次要信息隐藏
动画风格：功能型动画（状态切换/反馈/进度） > 装饰型动画（纯视觉美化）
           动画时长：快速反馈 <0.3s，状态过渡 0.5-1.0s，装饰动画 1-3s

参考设计语言：
  macOS System UI（简洁+功能优先）
  Figma UI（信息密度+工具感）
  Linear App（状态指示+微交互）
  Vercel Dashboard（深色+极简+状态色）
  Raycast（全局命令面板+快捷操作）

禁止的设计风格：
  禁止：过度装饰性动画（纯炫酷无功能）
  禁止：复杂多级菜单（用户偏好单页拖拽操作）
  禁止：大面积纯文字信息墙（必须用图表/卡片/状态指示替代）
  禁止：卡通/幼稚视觉元素（这是职场工具，不是儿童App）
</pre>

### 7.2 虚拟人面板（桌面宠物区域）

<pre>
设计意图：
  虚拟人占据屏幕右下角（或用户自定义位置），是持续存在的工作伴侣。
  面板不遮挡用户主要工作区域，但可通过交互（拖拽/点击/鼠标联动）主动接触用户。

视觉约束：
  1. 虚拟人周围不得有明显的UI边框/背景框——角色应像自然存在于桌面上
  2. 虚拟人下方可有一个极简的状态指示条（当前状态+进度+倒计时）：
     - 宽度：虚拟人宽度
     - 高度：16px
     - 背景：rgba(0,0,0,0.05)（几乎看不见）
     - 内容：状态图标 | 进度条 | 倒计时数字
     - 进度条颜色：与状态指示灯同色（见Part 3各状态光照的status_light color）
     - 进度条样式：极简线条，宽度 2px，圆角
  3. 虚拟人头部上方可有气泡文字区（提醒/问答）：
     - 最大尺寸：200×40px
     - 背景：半透明毛玻璃（backdrop-filter: blur(8px)）
     - 文字：角色差异化字体大小和颜色
     - 出现动画：scale 0→1 + opacity 0→1, 0.3s
     - 消失动画：opacity 1→0, 0.5s
  4. 拖拽时虚拟人周围不得有辅助线/边框——自然拖拽感
  5. 点击穿透区域：虚拟人以外的区域全部点击穿透（setIgnoreMouseEvents）
  6. 虚拟人与桌面其他App之间不得有视觉干扰——角色是"漂浮"在桌面上

交互逻辑约束：
  1. 虚拟人静止时：大多数鼠标事件穿透，仅虚拟人区域可交互
  2. 拖拽时：虚拟人跟随鼠标，松手后弹回原位
  3. 遮挡模式：虚拟人占据更大屏幕面积，背景半透明遮罩
  4. 状态切换：虚拟人姿态/表情/光效平滑过渡，不突变
  5. P0深度专注时：虚拟人所有交互暂停（click-through完全开启），仅保留视觉存在
</pre>

### 7.3 全局命令面板（Cmd+K / Ctrl+K）

<pre>
设计意图：
  全局命令面板是WorkOn的核心交互入口——类似Raycast/VSCode的Cmd+K。
  用户可在此进行：问答、任务查询、进度查看、设置调整、角色切换、日报生成等。
  命令面板不干扰工作流程——弹出→输入→结果→关闭，全过程 <5s。

视觉约束：
  1. 位置：屏幕正中央偏上（30%高度处）
  2. 尺寸：宽 480px，高度自适应（最小 60px，最大 400px）
  3. 背景：深色毛玻璃 rgba(10,14,20,0.85) + backdrop-filter: blur(20px)
  4. 边框：1px rgba(255,255,255,0.1)
  5. 边角：12px圆角
  6. 输入框：居中，宽度 420px，高度 40px
     - placeholder颜色：rgba(255,255,255,0.3)
     - 文字颜色：#F0F0F0
     - 焦点态：边框变为角色色（ARIA蓝/LUNA粉/KIRA橙/ZEN绿/SHIN灰）
  7. 结果列表：每个结果 36px行高，左图标+中文字+右辅助信息
     - 图标：16×16px, 与当前状态色一致
     - hover态：背景 rgba(255,255,255,0.08)
  8. 虚拟人在命令面板弹出时的行为：
     - 虚拟人转头看向面板方向（eyeLook + head rotation）
     - 表情切换为AI_chat（好奇+关注）
     - 回答时：虚拟人头部微点头（每个回答段落同步点头）
  9. P0深度专注时：命令面板禁用（不弹出）——避免打断

动画约束：
  出现：scaleY 0→1 (0.2s) + opacity 0→1 (0.15s) | ease-out
  消失：opacity 1→0 (0.1s) + scaleY 1→0 (0.15s) | ease-in
  列表项滚动：smooth scroll, 无跳跃

禁止：
  禁止：命令面板出现时背景全屏遮挡（仅面板本身覆盖）
  禁止：命令面板超过 480px宽（太宽会遮挡工作区）
</pre>

### 7.4 主应用窗口（非虚拟人）

<pre>
设计意图：
  主应用窗口承载：监控、日历、规划、报表、桌搭（角色选择），设置。
  是WorkOn的"数据中心"——虚拟人是"感性层"，主窗口是"理性层"。
  用户可在主窗口查看数据、配置系统、管理任务，然后最小化回到虚拟人陪伴模式。

视觉约束：
  1. 尺寸：最小 800×600px，推荐 1200×800px
  2. 导航结构：左侧极简图标栏（5核心图标 + 2全局 + 1设置）
     - 图标栏宽度：56px（紧凑）
     - 图标尺寸：24×24px
     - 图标间距：8px
     - 选中态：背景 rgba(角色色, 0.15) + 左侧2px角色色竖线
     - 未选中态：灰色 rgba(255,255,255,0.3)
  3. 内容区：剩余宽度，内部由各视图自行组织
  4. 顶部信息栏：当前日期+进度百分比+虚拟人状态指示
     - 高度：40px
     - 背景：rgba(10,14,20,0.5)
     - 进度条：宽 120px, 高 4px, 圆角 2px, 颜色=角色色

  5个核心导航图标（从上到下）：
    1. 监控(Monitor)：实时状态+轨迹+多屏 — icon: eye/radar
    2. 日历(Calendar)：今日安排+热度+时间线 — icon: calendar
    3. 规划(Plan)：待办+AI分析+Oner同步 — icon: checklist
    4. 报表(Report)：日报/周报/月报/自定义 — icon: chart
    5. 桌搭(Desk)：角色选择+场景+交互开关 — icon: avatar/character

  2个全局导航图标（底部固定）：
    6. 问答(Q&A)：全局命令面板快捷入口 — icon: sparkles/AI
    7. 通知(Notification)：提醒+消息中心 — icon: bell

  1个设置：
    8. 设置(Settings)：AI配置+性能+开关 — icon: gear

  各视图设计意图（细节留给设计师/模型）：
    监控视图：信息密度高，展示实时工作状态、轨迹、多屏状态
    日历视图：时间线可视化，今日安排直观，热度数据嵌入角落
    规划视图：待办列表+AI分析，可拖拽排序，Oner双向同步标记
    报表视图：4子视图切换（日/周/月/自定义），图表为主文字为辅
    桌搭视图：角色卡片选择+场景背景选择+交互开关列表

各视图视觉约束：
  每个视图必须有：
    - 核心信息区（占 70%宽度）——主要数据/图表/内容
    - 辅助信息区（占 30%宽度或侧边栏）——次要信息/详情
  每个视图不得有：
    - 大面积空白（信息密度不够）
    - 超过3层的嵌套菜单（用户偏好扁平结构）
    - 纯文字长段落（必须用图表/卡片/可视化替代）
</pre>

### 7.5 状态色彩体系

<pre>
状态色彩体系（贯穿全局——虚拟人+面板+进度条+图标+背景）：

核心状态色（与Part 3各状态光照status_light一致）：
  工作(coding/writing/AI_dev)：#00E676 绿色
  会议(meeting)：#2196F3 蓝色
  思考(thinking)：#7C4DFF 紫色
  设计(designing)：#E040FB 粉紫
  AI交互(AI_chat)：#00BCD4 青色
  演示(presenting)：#FFC107 金色
  摸鱼(slack)：#FF5252 红色（警示）
  用餐(eating)：#FF9800 橙色
  饮水(drinking)：#00E676 绿色（仍是工作态）
  休息(sleeping)：#9E9E9E 灰色（离线）
  强制专注(forced_focus)：#FF1744 深红（严重警示）
  空闲(idle)：#607D8B 聚灰

角色主题色（角色身份色——面板/进度条/图标选中态）：
  ARIA：#6CA6CD 冰蓝
  LUNA：#F8BBD0 柔粉
  KIRA：#E04040 火红
  ZEN：#4CAF50 翠绿
  SHIN：#708090 钢灰

色彩使用规则：
  1. 状态色用于：进度条、状态指示灯、图标选中态、面板焦点态、虚拟人光环
  2. 角色色用于：导航选中态、命令面板焦点态、气泡文字背景、报表标题色
  3. 信息色：成功=绿，警告=橙，错误=红，信息=蓝（通用UI语义色）
  4. 背景：主背景 #0a0e14（深黑偏蓝），卡片 rgba(255,255,255,0.05)
  5. 文字：主文字 #F0F0F0，次文字 rgba(255,255,255,0.5)，禁用 rgba(255,255,255,0.2)
  6. 深色模式为主，浅色模式为备选（色彩反转+调整亮度）
</pre>

### 7.6 交互动画约束

<pre>
交互动画统一规格：

类别1 — 快速反馈（<0.3s）：
  用途：按钮点击、开关切换、微状态变化
  时长：0.15-0.25s
  曲线：ease-out
  类型：scale(0.95→1)、opacity变化、颜色过渡
  示例：按钮hover→active、开关on→off、图标选中态

类别2 — 状态过渡（0.5-1.0s）：
  用途：视图切换、面板展开/折叠、数据加载
  时长：0.5-0.8s
  曲线：ease-in-out
  类型：slide、fade、scale、reorder
  示例：监控→日历视图切换、规划面板展开

类别3 — 装饰性动画（1-3s）：
  用途：进度达标庆祝、角色切换特效、开场仪式
  时长：1.0-3.0s
  曲线：ease-out / bounce
  类型：粒子、光效、morph、路径动画
  示例：角色切换消散特效、进度100%庆祝光效

禁止：
  禁止：超过3s的装饰动画（浪费时间）
  禁止：无功能目的的循环动画（浪费CPU/GPU）
  禁止：闪烁/震动类动画（视觉不适）
  禁止：弹窗动画超过0.5s（打断工作节奏）
</pre>

### 7.7 字体与排版约束

<pre>
字体体系：
  UI字体：系统字体栈（-apple-system, SF Pro, "Segoe UI", sans-serif）
  数据字体：等宽字体栈（SF Mono, "Cascadia Code", Menlo, monospace）
  虚拟人对话字体：视角色而定
    ARIA：SF Pro Text, weight 400, 12px（精确冷静）
    LUNA：SF Pro Rounded, weight 500, 13px（圆润温暖）
    KIRA：SF Pro Text, weight 700, 11px（紧凑有力）
    ZEN：SF Pro Text, weight 300, 14px（宽松禅意）
    SHIN：SF Pro Display, weight 600, 12px（精英精确）

排版约束：
  行间距：1.5（UI文字），1.8（报表/长文本）
  卡片内间距：12-16px
  模块间距：16-24px
  标题层级：H1 24px/700 | H2 18px/600 | H3 14px/500 | 正文 13px/400
  数据数字：monospace 14px/500, 颜色=角色色
  进度百分比：monospace 12px/600, 颜色=状态色
</pre>

### 7.8 多屏适配约束

<pre>
多屏适配规则：
  1. 虚拟人仅在主显示器显示（不跨屏）
  2. 主应用窗口可在任意显示器打开（多屏数据查看）
  3. 命令面板在鼠标所在显示器弹出
  4. 遮挡系统仅影响主显示器（用户工作屏）
  5. 多屏状态数据在监控视图聚合展示：
     - 主屏为核心（70%显示面积）
     - 辅屏为支线（30%或展开查看）

虚拟人跨屏规则（如果用户将虚拟人拖到副屏）：
  - 允许拖到副屏（setIgnoreMouseEvents允许跨窗口拖拽）
  - 虚拟人在副屏仍保持监控功能（数据源不变）
  - 遮挡系统仍仅在主屏触发（副屏不遮挡）
  - 命令面板仍随鼠标弹出（哪屏鼠标哪屏面板）
</pre>
