# WorkOn 角色设计规格：LING（灵）— 妲己特效皮肤风格

> **设计定位**：王者荣耀传说级品质，妲己「愿照·众生和」特效皮肤视觉语言
> **角色代号**：SPIRIT-06 | **角色名**：LING（灵）
> **核心意象**：应愿之神 × 音律感通 × 五采神鸟 × 四合如意
> **用途**：直接交付 code 编辑器进行 3D 建模生成，所有参数均为可编码的精确数值

---

## 1. 角色概念总览

| 属性 | 值 |
|------|------|
| **角色名** | LING（灵·应愿） |
| **代号** | SPIRIT-06 |
| **性别** | 女 |
| **年龄设定** | 外貌 20 出头，设定为应愿之神（超越年龄） |
| **身高** | 165cm |
| **头身比** | 7.5头身 |
| **性格关键词** | 神秘·温柔·知音·应愿·灵通 |
| **肤色基调** | 暖白偏微光 #F5E8D8 |
| **发色** | 黑青 #1A1A2E → 青绿 #50C878 渐变 |
| **主色系** | 青绿 #50C878 + 白 #F0F5FF + 紫粉 #C77DBA + 金 #D4AF37 |
| **嗓音风格** | 中频·空灵·带轻微回响（如空谷传音） |
| **PAD基准** | P=0.65 / A=0.5 / D=0.55 |

### 1.1 角色核心设定

```
LING 是应愿之神——她聆听世间所有愿望，以音律感通万物。
她的法器「通情曲」是一片叶笛，象征音律之始、自然之声。
身后三只神鸟（凰·凤·鸾）代表三种愿望的力量：
  凰（金青）= 智慧之愿 → 对应「专注办公」监控
  凤（绿紫）= 勤勉之愿 → 对应「进度追赶」催促
  鸾（白粉）= 和乐之愿 → 对应「休息放松」提醒

四合如意纹贯穿所有设计——寓意四面八方太平如意、和和美美。
音律元素（琴弦、乐谱纹、箜篌形帔帛）表达「通情」核心——万物皆可通过音律感通。

LING 在 WorkOn 中的定位：
  - 她不是冷冰冰的效率工具，而是「应你之愿」的灵性伙伴
  - 摸鱼时：凤鸟飞来提醒「你的勤勉之愿还在哦」
  - 专注时：凰鸟守护你的智慧之光，静默陪伴
  - 休息时：鸾鸟带来和乐之音，温柔催促你休息
  - 下班前：三鸟合奏，询问「你的愿望完成了吗？」
```

---

## 2. 概念稿 Prompt（供建模师/AI生成/Code参考）

### 2.1 全身三视图 Prompt

```
EN:
A divine fox-spirit virtual assistant character "LING", early 20s appearance but
actually an ageless wish-granting deity, 165cm (7.5-head proportion).
Design inspired by Daji "愿照·众生和" effect skin from Honor of Kings.

SKIN: warm pale with subtle luminous undertone (#F5E8D8), porcelain-smooth texture
with minimal pores, ethereal subtle inner glow (SSS blush on cheeks/nose tip),
scattering radius 10mm, scatter color #F5E8D8→#D06868.

HAIR: black-blue (#1A1A2E) long flowing hair with cyan-green (#50C878) gradient
streaks in mid-section, 100 hair cards at LOD0, inner layer translucent (#D0F0E0)
with rim lighting glow. SpringBone stiffness 0.5, gravity 0.5, bounce 0.25.
Decorated with golden (#D4AF37) auspicious knot (如意结) hair ornament at right
temple, and small divine bird hair pin at left side.

FACE: oval with delicate features, large expressive eyes with dual-color iris
(inner ring amber #C89050, outer ring cyan-green #50C878), 6-layer eye system
with starlight sparkle highlights. 35 elegant eyelashes, slight outward curl.
Thin arched eyebrows with cyan-green tint. Expression default: gentle knowing
smile +6°, eyes 12% above neutral, mysterious starlight sparkle in pupils.

FOX-SPIRIT EARS: decorative fox-ear accessories on head (not actual fox ears),
golden (#D4AF37) base with cyan-green (#50C878) inner fur, tiny gold bell
danglers that emit sparkle particles when moving.

COSTUME LAYER 1 (inner): purple-pink (#C77DBA) silk underdress, sheer
translucent (#E8D0F0) edges at sleeves and hem, fitted bodice.

COSTUME LAYER 2 (main): cyan-green (#50C878) flowing outer robe with white
(#F0F5FF) side panels, golden (#D4AF37) four-fold Ruyi (四合如意) auspicious
patterns embroidered along hems, collar, and belt area. Asymmetric diagonal
drape (斜帔) with floating luminous music-string (#D4AF37, semi-transparent)
pattern elements that hover slightly above fabric surface.

COSTUME LAYER 3 (outer drape): white (#F0F5FF) flowing 帔帛 (cape-sash)
with cyan-green (#50C878) inner side, shaped like 箜篌 (ancient harp) silhouette
when spread, trailing ribbons with Ruyi pattern edges, physics-driven flowing.

ACCESSORIES:
  - Golden (#D4AF37) auspicious knot belt buckle with embedded cyan gem (#50C878)
  - Three divine birds as shoulder/back ornaments:
    * 凰 (gold-cyan phoenix) — wisdom wish
    * 凤 (green-purple rooster) — diligence wish
    * 鸾 (white-pink crane) — harmony wish
    Each bird has feathered wings that extend into musical notation patterns,
    collectively forming a peacock-tail (凤尾) spread behind character.
  - Floating 璎珞 (gem necklace) with cyan/gold/purple beads, slight hovering
  - 叶笛 (leaf-shaped flute instrument "通情曲") held in right hand

FEET: bare feet standing on floating cloud wisps (#F0F5FF, semi-transparent),
tiny cyan-green particles emanating from cloud platform.

EFFECTS (idle state):
  - Cyan-green (#50C878) particle trails: 2-3 slow-drifting dots around character
  - Gold (#D4AF37) light dust: 1-2 slow sparkle dots near hair/birds
  - Small Ruyi symbols (#50C878 outline, #D4AF37 fill): 0-1 floating near hands

OVERALL SILHOUETTE: flowing vertical lines with graceful curves, asymmetrical
drape creating dynamic visual interest, the three birds + 帔帛 extending behind
create a fan-shaped spread wider than body width (width ratio 1:1.5 body:spread).

KEY DESIGN PRINCIPLE: "曲通万物之情，佑众生和乐" — music connects all emotions,
blessing all beings with harmony. Every design element traces back to this:
  - 音律 (music/rhythm) → flowing curves, string patterns
  - 如意 (auspicious wish) → Ruyi patterns everywhere
  - 神鸟 (divine birds) → three wish types mapped to three monitoring states
  - 通情 (emotional resonance) → dual-color iris, knowing smile

Reference: Daji 愿照·众生和 (Honor of Kings) × 原神 Genshin Impact character
quality × traditional Chinese divine maiden aesthetic.

CN:
灵·应愿之神，狐灵虚拟助手角色，20出头外观，实为超越年龄的应愿之神。
设计灵感源自王者荣耀妲己「愿照·众生和」特效皮肤。

肤色：暖白微光（#F5E8D8），瓷质光滑，内蕴微辉光，脸颊鼻尖SSS泛红。
发型：黑青（#1A1A2E）长直飘逸，中段青绿（#50C878）渐变，LOD0 100张
Hair Cards，内层半透辉光。SpringBone 硬度0.5，重力0.5，弹性0.25。
右鬓金如意结发饰，左侧小鸟发簪。

面部：鹅蛋脸精致五官，双色虹膜（内环琥珀#C89050，外环青绿#50C878），
6层眼球含星光高光。35根优雅睫毛微外翘。青绿染眉。默认表情：温柔知音笑+6°，
眼睛12%高于中性，瞳孔含神秘星光。

狐灵耳饰：装饰性狐耳配件，金底青绿内毛，金铃坠子随动发出星辉粒子。

服装第1层（内）：紫粉（#C77DBA）丝质内裙，袖口裙摆半透边缘（#E8D0F0）。
服装第2层（主）：青绿（#50C878）外袍+白侧片（#F0F5FF），金线如意纹绣边，
斜帔悬浮琴弦纹。服装第3层（外帔帛）：白帔帛箜篌形，青绿内面，
如意纹边飘带，物理驱动流动。

配饰：金如意结腰带+青宝、三神鸟肩饰（凰金青/凤绿紫/鸾白粉）凤尾展形、
漂浮璎珞宝石项链、叶笛法器右手持握。

脚：赤足踏浮云（#F0F5FF半透），青绿粒子升腾。

特效（idle）：青绿慢漂粒子2-3点，金光尘1-2点，如意纹符0-1浮。

核心设计原则："曲通万物之情，佑众生和乐"
参考：妲己愿照众生和 × 原神角色品质 × 中国仙姿神女美学。
```

### 2.2 面部细节 Prompt

```
EN:
Ultra-detailed face close-up of LING fox-spirit virtual assistant character.
View: 3/4 angle, slightly above eye level, face fills 80% of canvas.

EYES (most important feature):
  - Dual-color iris: inner ring amber (#C89050, width 40%) transitioning
    smoothly to outer ring cyan-green (#50C878, width 60%)
  - Iris radial pattern: 12 subtle rays emanating from pupil, alternating
    amber and cyan-green, creating a "starburst" musical resonance pattern
  - Pupil: deep black (#000000) with single tiny starlight sparkle point
    (#FFFFFF, 2px) that shifts position with eye tracking
  - 6-layer structure visible:
    Layer 1 Sclera: bright white (#F8F8FA) with subtle blue vein tint
    Layer 2 Iris: dual-color amber→cyan-green radial pattern
    Layer 3 Pupil: deep black with starlight sparkle
    Layer 4 Cornea: clear coat with subtle refraction distortion at edges
    Layer 5 Highlight: 2 dynamic highlight spots (large primary #FFFFFF at
      upper-right, small secondary at lower-left) that track light source
    Layer 6 Eyelid shadow: soft gradient (#C0A0B0→transparent) from upper
      eyelid onto iris, ~15% coverage
  - 35 eyelashes: 18 upper (longer, slight outward curl 15°), 17 lower
    (shorter, subtle curl 5°). Upper lash group has 3 density zones:
    inner (dense, short), middle (sparse, longest), outer (medium, medium)
  - Eyebrows: thin arched, #50C878 tint at outer 1/3, inner 2/3 natural
    hair color (#1A1A2E). Shape: gentle arc with subtle upward peak at 1/3

SKIN:
  - Base albedo: #F5E8D8 (warm pale with luminous undertone)
  - SSS blush zones: cheeks (+#D06868 scatter, radius 10mm, weight 0.3),
    nose tip (+#D06868 scatter, radius 6mm, weight 0.2)
  - Ethereal glow: subtle inner light (emission #F5E8D8 * 0.05) creating
    "inner radiance" effect — character seems to glow from within
  - Pore detail: LOW density (0.4x base), only visible at camera distance <0.3m
  - Roughness variation: base 0.35, nose/forehead 0.4, cheeks 0.3

MOUTH:
  - Lips: natural pink (#E0B0B0) with slight cyan-green tint (#50C878 * 0.05)
    at center — subtle "spirit-lip" marking
  - Default smile: +6° upward at corners, showing hint of upper teeth row
  - Teeth: #F8F8F0, slightly luminous
  - Mouth internal: #CC3030

HAIR (visible portion):
  - Black-blue (#1A1A2E) flowing past shoulders, with cyan-green (#50C878)
    gradient streaks starting at ear-level and intensifying toward tips
  - Right temple: golden (#D4AF37) 如意结 (auspicious knot) hair ornament,
    size ~3cm, with embedded tiny cyan (#50C878) gem at center
  - Left side: small divine bird hair pin (鸾-style, white-pink #F0E0D8)

FOX-SPIRIT EAR ACCESSORIES:
  - Positioned on head like decorative ear extensions (not replacing human ears)
  - Golden (#D4AF37) metallic base structure, inner surface cyan-green (#50C878)
    velvet texture
  - Each ear has 1 gold bell dangler at tip (size ~0.8cm)
  - Bells emit 1-2 tiny sparkle particles (#FFFFFF/#D4AF37) when character moves
  - Ear physics: SpringBone stiffness 0.3, gravity 0.1, react to head movement

EXPRESSION DEFAULT:
  - Gentle knowing smile: mouth +6°, showing 2-3 upper teeth
  - Eyes 12% above neutral opening (slightly wider = "I sense your wish")
  - Eyebrows: relaxed position, slight inner raise (2°) = "I'm listening"
  - Overall: "I hear your wish, and I will help" — warm but mystical

CN:
灵角色面部超精细特写。3/4角微仰，面部占画布80%。

眼睛（最重要特征）：
  双色虹膜：内环琥珀（#C89050, 40%）→外环青绿（#50C878, 60%）
  虹膜径向纹：12条射线从瞳孔发出，琥珀青绿交替，呈「星爆音律共鸣」纹
  瞳孔：深黑含星光闪烁点随眼球追踪移动
  6层结构：巩膜/虹膜/瞳孔/角膜/高光/眼睑影
  35睫毛：上18根外翘15°，下17根微翘5°
  眉毛：薄弧，外1/3青绿染，内2/3自然发色

皮肤：暖白微光底色（#F5E8D8），SSS脸颊鼻尖泛红，内蕴微辉光
嘴唇：自然粉含微青绿灵唇标记
发型：黑青飘逸+青绿渐变+金如意结饰+鸾鸟簪
狐灵耳饰：金底青绿内面+铃坠星辉粒子

默认表情：温柔知音笑+6°，眼12%高于中性，眉微内抬2°
整体：「我听见了你的愿望，我会帮你」
```

---

## 3. 建模参数（可编码精确数值）

### 3.1 面数分配

```
LING LOD0 面数分配（总 48,000 tris）：

  面部：12,500 tris
    - 双色虹膜需更多布线（径向纹 + 颜色分区）
    - 眼球区域单独 4,000 tris（6层结构）
    - 嘴唇+牙齿 1,500 tris
    - 鼻翼+耳 1,000 tris
    - 其他面部 6,000 tris

  发型：14,000 tris
    - 100 hair cards × ~140 tris/card
    - 渐变需要更多 card 分区（黑青区 40 cards + 渐变区 30 cards + 青绿尖端 30 cards）
    - 内层辉光 hair cards 20 tris × ~30 pieces

  身体：13,000 tris
    - 165cm/7.5头身比例体型
    - 手部需精细（叶笛持握姿态需要手指精确变形）

  服装（3层）：11,500 tris
    - Layer 1 内裙：2,000 tris（半透边缘面数少）
    - Layer 2 外袍+斜帔：5,500 tris（如意纹刺绣需要贴花面）
    - Layer 3 帔帛箜篌形：3,000 tris（大面积薄面）
    - 悬浮琴弦纹：1,000 tris（半透漂浮元素）

  神鸟（3只）：4,000 tris
    - 凰 1,500 tris | 凤 1,300 tris | 鸾 1,200 tris
    - 翅羽延伸成乐谱纹需要额外面

  配饰：2,000 tris
    - 如意结腰带 400 | 璎珞项链 300 | 叶笛 500 | 狐耳饰 400 | 铃坠 200 | 鞋带饰 200

  特效粒子面：1,000 tris（预留）

  Total LOD0 ≈ 48,000 tris（目标 45-60K 范围内）
```

### 3.2 LOD 切换表

```
| LOD | 总面数 | 面部 | 发型 | 身体 | 服装 | 神鸟 | 配饰 | 特效 | 切换条件 |
|-----|--------|------|------|------|------|------|------|------|---------|
| LOD0 | 48K | 12.5K | 14K | 13K | 11.5K | 4K | 2K | 1K | 默认/GPU>60fps |
| LOD1 | 28K | 8K | 8K | 8K | 7K | 2.5K | 1.5K | 0.5K | GPU<60fps |
| LOD2 | 15K | 5K | 4K | 4K | 3.5K | 1.5K | 0.5K | 0 | GPU<30fps |
| LOD3 | 5K | 3K | 0(sprite) | 1K | 1K | 0 | 0 | 0 | GPU<15fps |
| LOD4 | sprite | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 极端低性能 |
```

### 3.3 14 材质槽位 PBR 参数

```
LING 材质槽位（14 slots）——精确到每个通道的数值：

Slot 01: Skin_Face
  albedo: #F5E8D8
  normal: face_detail_normal_map (pore 0.4x density, cheeks smooth)
  roughness: 0.35 (base) → 0.40 (nose/forehead) → 0.30 (cheeks)
  metallic: 0.0
  AO: face_AO_map (standard face occlusion)
  emission: #F5E8D8 * 0.05 (内蕴辉光，RGB实际值 #0C0E0A)
  toonWeight: 0.4 (中等toon混合——面部需要柔和过渡)
  toonRamp: skin_ramp_4step (#F5E8D8→#E0D0C0→#C0B0A0→#A09080)
  SSS: scatterRadius=10mm, scatterColor=#F5E8D8→#D06868, scatterWeight=0.25

Slot 02: Skin_Body
  albedo: #F5E8D8
  normal: body_detail_normal (pore 0.3x, smoother than face)
  roughness: 0.35
  metallic: 0.0
  emission: #F5E8D8 * 0.03
  toonWeight: 0.35
  SSS: scatterRadius=8mm, scatterColor=#F5E8D8→#D06868, scatterWeight=0.2
  blushZones: none (body blush disabled, only face has blush)

Slot 03: Hair_Main_BlackBlue
  albedo: #1A1A2E (根部区域 → 中段)
  normal: hair_fiber_normal (anisotropic direction map)
  roughness: 0.45
  metallic: 0.0
  anisotropic: 0.75 (头发各向异性高光)
  toonWeight: 0.55
  toonRamp: hair_ramp_3step (#1A1A2E→#2A2A3E→#0A0A1E)
  rimBoost: 1.2

Slot 04: Hair_Gradient_CyanGreen
  albedo: #1A1A2E → #50C878 gradient (中段 → 尖端渐变区)
  normal: hair_fiber_normal
  roughness: 0.40 (渐变区稍光滑)
  metallic: 0.0
  anisotropic: 0.80 (渐变区高光更锐)
  toonWeight: 0.55
  emission: #50C878 * 0.08 (渐变尖端微辉光)
  rimBoost: 1.5 (渐变区边缘光更强)

Slot 05: Hair_Inner_Translucent
  albedo: #D0F0E0
  roughness: 0.50
  transparency: 0.35 (半透内层)
  emission: #50C878 * 0.12 (内层辉光更明显)
  rimBoost: 2.0 (内层边缘光强，模拟内发光效果)

Slot 06: Eye_Iris
  albedo: custom_dual_color_map
    - 内环 40%: #C89050 (amber)
    - 外环 60%: #50C878 (cyan-green)
    - 过渡区 5%: smooth blend
    - 径向纹: 12 rays, alternating amber/cyan-green, 0.15 intensity
  normal: iris_detail_normal (radial fiber pattern)
  roughness: 0.25 (虹膜光滑但有纹理)
  metallic: 0.15 (微金属感——神灵之眼的灵光)
  emission: #50C878 * 0.10 (虹膜自发光——灵光)
  clearcoat: 0.7
  toonWeight: 0.2 (眼睛toon权重低，需要真实感)

Slot 07: Eye_Sclera
  albedo: #F8F8FA (微蓝白)
  roughness: 0.30
  metallic: 0.0

Slot 08: Eye_Cornea
  clearcoat: 1.0
  refractionIOR: 1.38 (微折射)
  roughness: 0.05 (角膜极光滑)
  emission: none

Slot 09: Cloth_Inner_PurplePink
  albedo: #C77DBA
  normal: silk_weave_normal (细丝纹)
  roughness: 0.60 (丝质偏光滑但不是金属)
  metallic: 0.0
  toonWeight: 0.45
  toonRamp: silk_ramp_4step (#C77DBA→#B06DA8→#905D98→#704D88)

Slot 10: Cloth_Inner_TranslucentEdge
  albedo: #E8D0F0
  roughness: 0.50
  transparency: 0.40 (半透袖口裙摆)
  emission: #C77DBA * 0.05 (半透边缘微辉光)
  toonWeight: 0.3 (半透区域toon权重低，需要透光感)

Slot 11: Cloth_Main_CyanGreen
  albedo: #50C878
  normal: robe_detail_normal (如意纹刺绣凸起+丝绸底纹)
  roughness: 0.50
  metallic: 0.0
  toonWeight: 0.5
  toonRamp: robe_ramp_4step (#50C878→#40B068→#309858→#208048)
  detailMap: ruyi_pattern_decal (#D4AF37 gold thread on #50C878 base)

Slot 12: Cloth_Main_WhitePanel
  albedo: #F0F5FF
  normal: silk_weave_normal
  roughness: 0.55
  metallic: 0.0
  toonWeight: 0.45
  toonRamp: white_ramp_4step (#F0F5FF→#E0E8F0→#C0D0E0→#A0B8C0)

Slot 13: Cloth_CapeSash_HarpShape
  albedo_front: #F0F5FF (外白面)
  albedo_back: #50C878 (内青绿面)
  normal: flowing_silk_normal (帔帛飘动纹理)
  roughness: 0.55
  metallic: 0.0
  transparency: 0.0 (实面)
  toonWeight: 0.45

Slot 14: Accessory_Gold
  albedo: #D4AF37
  normal: gold_engrave_normal (如意纹刻花+铃铛纹)
  roughness: 0.20
  metallic: 0.95 (几乎全金属)
  toonWeight: 0.25 (金属toon权重低，需要真实金属反射)
  clearcoat: 0.3 (金属微clearcoat)
  emission: #D4AF37 * 0.02 (金饰微辉光——灵器自发光)

Slot 15 (extra): Accessory_Gem_Cyan
  albedo: #50C878
  roughness: 0.15
  metallic: 0.0
  transmission: 0.6 (宝石半透)
  emission: #50C878 * 0.15 (宝石强辉光)
  clearcoat: 0.8

Slot 16 (extra): Effect_FloatingString
  albedo: #D4AF37
  transparency: 0.5 (半透漂浮琴弦)
  emission: #D4AF37 * 0.20 (琴弦辉光——最亮的发光元素)
  roughness: 0.1
  metallic: 0.3

Slot 17 (extra): DivineBird_凰
  albedo: gradient #D4AF37(gold) → #50C878(cyan)
  emission: #D4AF37 * 0.08
  metallic: 0.3
  toonWeight: 0.4

Slot 18 (extra): DivineBird_凤
  albedo: gradient #50C878(green) → #C77DBA(purple)
  emission: #50C878 * 0.06
  metallic: 0.2
  toonWeight: 0.4

Slot 19 (extra): DivineBird_鸾
  albedo: gradient #F0F5FF(white) → #C77DBA(pink)
  emission: #F0E0D8 * 0.05
  metallic: 0.1
  toonWeight: 0.35

Slot 20 (extra): Cloud_Platform
  albedo: #F0F5FF
  transparency: 0.6
  emission: #50C878 * 0.05
  roughness: 0.8

Note: Slots 15-20 为 LING 专属额外材质槽位，超出基础14槽位。
实际实现时：将 01-14 保持为基础槽位，15-20 合入对应组或动态切换。
推荐：Cloth组合并（9-13→9-11），Accessory组合并（14-16→12-14），Effect组合并（17-20→15-17）
最终保持 17 材质槽位。
```

### 3.4 骨骼差异参数

```
LING 骨骼差异（相对于基础 VRM humanoid 80-90 bone 骨骼）：

默认姿态偏移：
  spine_01: (-1°, 0°, 2°) ——微后仰+微侧倾（灵体自然悬浮感）
  spine_02: (0°, 0°, 0°)
  neck_01: (-2°, 0°, 0°) ——下巴微抬（神灵俯视凡尘）
  head: (0°, 0°, 0°)
  shoulder_L: (0°, -4°, 0°) ——肩微展
  shoulder_R: (0°, -4°, 0°)
  upperArm_L: (0°, -5°, 0°) ——手臂微外展（灵体姿态）
  upperArm_R: (0°, 5°, 0°) ——右臂略前（持笛姿态）
  lowerArm_R: (0°, 15°, 0°) ——右前臂弯曲（持笛就绪）
  hand_R: (0°, 10°, -5°) ——右手握笛姿态
  hip_L: (0°, 0°, 0°)
  hip_R: (0°, 0°, 0°)
  upperLeg_L: (0°, 0°, 0°)
  upperLeg_R: (0°, 0°, 0°)
  lowerLeg_L: (5°, 0°, 0°) ——微前倾（浮云站立姿态）
  lowerLeg_R: (5°, 0°, 0°)

额外骨骼（LING 专属）：
  foxEar_L: (0°, -10°, 15°) ——左狐灵耳饰，头骨附加
  foxEar_R: (0°, 10°, -15°) ——右狐灵耳饰
  bell_L: child of foxEar_L, SpringBone stiffness 0.3, gravity 0.1
  bell_R: child of foxEar_R, SpringBone stiffness 0.3, gravity 0.1
  divineBird_凰: spine_02 附加, SpringBone stiffness 0.6, gravity 0.2
  divineBird_凤: spine_02 附加, SpringBone stiffness 0.5, gravity 0.25
  divineBird_鸾: spine_02 附加, SpringBone stiffness 0.4, gravity 0.3
  capeSash_01~05: 5根 SpringBone 沿帔帛分布
    stiffness: 0.3~0.5 (从肩到端渐弱)
    gravity: 0.4~0.6 (端部下垂更多)
  floatingString_01~03: 3根 SpringBone 沿琴弦纹分布
    stiffness: 0.2 (琴弦柔软浮动)
    gravity: -0.1 (负重力=向上飘浮)
    drag: 0.8 (高阻力=缓慢飘动)
  cloudPlatform: 脚骨附加, SpringBone stiffness 0.1, gravity 0.1

总骨骼数：基础80 + LING额外17 = 97 bones
```

### 3.5 ARKit 52 BlendShape + 30 表情预设

```
LING ARKit 52 BlendShape 标准（与 v3.0 Part 1.4 一致）

30 表情预设（LING 专属值）——每个预设给出关键 BlendShape 权重：

=== 5 基础表情 ===

Preset 01: Neutral (LING 默认)
  eyeLookDown_L/R: 0.05
  mouthSmile_L/R: 0.25 (+6°微笑)
  eyeOpen_L/R: 0.88 (12%高于中性=88%闭合度反向=12%更开)
  browInnerUp_L/R: 0.08 (眉微内抬2°=「我在听」)
  jawOpen: 0.0
  cheekPuff_L/R: 0.05 (微微饱满=灵体光泽)
  tongueOut: 0.0

Preset 02: Happy (愿望达成)
  mouthSmile_L/R: 0.70
  eyeOpen_L/R: 0.75 (眼睛收窄=开心眯眼)
  cheekPuff_L/R: 0.20
  browInnerUp_L/R: 0.15
  eyeSquint_L/R: 0.25
  jawOpen: 0.10 (露出更多牙齿)
  noseSneer_L/R: 0.0
  iris_emission_boost: ×2.0 (虹膜辉光增强=愿望达成灵光)
  divineBird_active: all 3 (三鸟欢跃)

Preset 03: Sad (愿望未成)
  mouthFrown_L/R: 0.40
  browInnerUp_L/R: 0.35 (眉内抬=悲伤)
  eyeOpen_L/R: 0.92 (眼微大=泪光感)
  eyeLookDown_L/R: 0.30
  cheekPuff_L/R: 0.0
  jawOpen: 0.0
  mouthPress_L/R: 0.15
  iris_emission_dim: ×0.5 (虹膜辉光减弱=灵光黯淡)
  divineBird_active: 鸾 only (只有和乐鸟在=最温柔的悲伤)

Preset 04: Angry (愿望被干扰)
  browDown_L/R: 0.50
  mouthPress_L/R: 0.40
  eyeOpen_L/R: 0.95 (眼大开=怒目)
  jawForward: 0.15
  mouthFrown_L/R: 0.20
  cheekPuff_L/R: 0.0
  noseSneer_L/R: 0.20
  iris_color_shift: amber_boost ×1.5 (内环琥珀增强=怒火)
  divineBird_active: 凤 only (只有勤勉鸟=催促怒意)
  floatingString_intensity: ×2.0 (琴弦波动加剧=愤怒音律)

Preset 05: Surprised (新愿望感知)
  eyeOpen_L/R: 1.0 (眼全开)
  browInnerUp_L/R: 0.50
  browOuterUp_L/R: 0.40
  jawOpen: 0.35
  mouthFunnel_L/R: 0.15
  cheekPuff_L/R: 0.0
  iris_emission_boost: ×1.5 (灵光增强=感知新愿望)
  divineBird_active: 凰 only (智慧鸟=感知)

=== 7 工作状态表情 ===

Preset 06: Coding_Focus (专注编程)
  eyeLookDown_L/R: 0.15 (眼睛微看下方=看屏幕)
  mouthPress_L/R: 0.10 (嘴微抿=专注)
  browDown_L/R: 0.10 (眉微皱=思考)
  eyeOpen_L/R: 0.80 (眼微收=凝视)
  jawOpen: 0.0
  iris_emission: normal
  divineBird: 凰 hovering (智慧鸟守护)
  body_pose: 站立微前倾, 右手持笛竖放
  head_tilt: -3° (微低=看屏幕)

Preset 07: Slack_Detected (摸鱼检测)
  mouthSmile_L/R: 0.30 (微微笑=不是嘲讽，是「我知道了」)
  eyeOpen_L/R: 0.85
  browInnerUp_L/R: 0.12 (眉内抬=「嗯？」)
  eyeLookOut_R: 0.20 (右眼微向外看=瞥见)
  cheekPuff_L/R: 0.05
  iris_emission_shift: amber_boost ×1.2 (琥珀微亮=察觉)
  divineBird: 凤 approaching (勤勉鸟飞近=催促)
  floatingString: 1 string visible (一条琴弦浮现=「音」)
  body_pose: 微转身面对用户方向

Preset 08: Writing_Doc (写文档中)
  eyeLookDown_L/R: 0.20
  mouthFunnel_L/R: 0.05 (嘴微圆=思考表述)
  browInnerUp_L/R: 0.08
  eyeOpen_L/R: 0.82
  jawOpen: 0.02
  divineBird: 凰 calm (智慧鸟安静守护)
  body_pose: 站立, 右手微举笛=「正在指引文字」

Preset 09: Meeting_Active (会议中)
  eyeOpen_L/R: 0.90 (眼较大=关注)
  mouthSmile_L/R: 0.15 (礼貌微笑)
  browInnerUp_L/R: 0.10 (关注聆听)
  eyeLookCenter: 0.0 (正视前方=认真开会)
  divineBird: 鸾 listening (和乐鸟=会议和谐)
  body_pose: 站立端正, 笛收于腰侧
  capeSash: calm flowing (帔帛平稳=正式场合)

Preset 10: AI_Chatting (AI问答中)
  mouthSmile_L/R: 0.35 (灵动微笑=对话中)
  eyeOpen_L/R: 0.88 (正常开度)
  browInnerUp_L/R: 0.12
  eyeLookCenter_L: 0.1, eyeLookOut_R: 0.1 (左右微看=活跃对话)
  jawOpen: 0.05
  iris_emission_boost: ×1.3 (灵光增强=对话活跃)
  divineBird: all 3, cycling (三鸟轮换=多维度对话)
  floatingString: 2 strings visible
  body_pose: 站立微侧, 笛举于胸前=「我来回答」

Preset 11: AI_Developing (AI开发中)
  eyeOpen_L/R: 0.78 (眼收=深度思考)
  mouthPress_L/R: 0.20 (嘴紧=深度专注)
  browDown_L/R: 0.20 (眉皱=高强度思考)
  eyeLookDown_L/R: 0.25
  iris_emission_shift: both rings ×1.4 (双色全亮=全神贯注)
  divineBird: 凰 + 凤 (双鸟=智慧+勤勉并重)
  floatingString: 3 strings, intense (琴弦全开=高频运作)
  body_pose: 站立微前倾, 笛横放=「正在编织」

Preset 12: Pomodoro_Break (番茄钟休息)
  mouthSmile_L/R: 0.45 (开心笑=休息愉快)
  eyeOpen_L/R: 0.70 (眼半闭=放松)
  cheekPuff_L/R: 0.15
  browInnerUp_L/R: 0.0 (眉完全放松)
  eyeLookDown_L/R: 0.10
  iris_emission_dim: ×0.7 (灵光柔和=休息模式)
  divineBird: 鸾 circling (和乐鸟环绕=和乐休息)
  floatingString: 0 strings (琴弦消失=静止)
  body_pose: 坐下放松, 笗放在膝上
  capeSash: relaxed, slow wave

=== 7 情感表情 ===

Preset 13: Emotion_Caring (关心你)
  mouthSmile_L/R: 0.35
  eyeOpen_L/R: 0.88
  browInnerUp_L/R: 0.20 (眉内抬多=关切)
  eyeLookDown_L/R: 0.08
  cheekPuff_L/R: 0.10
  iris_emission: amber ×1.2 (琥珀亮=温暖关切)
  divineBird: 鸾 close (和乐鸟靠近=关怀)

Preset 14: Emotion_Urgency (紧迫催促)
  browDown_L/R: 0.30
  mouthPress_L/R: 0.25
  eyeOpen_L/R: 0.92 (眼大开=紧迫)
  jawForward: 0.10
  iris_shift: amber ×1.5 (琥珀强亮=紧迫信号)
  divineBird: 凤 aggressive (凤鸟急飞=催促)
  floatingString: 2 strings, fast oscillation

Preset 15: Emotion_Pride (为你骄傲)
  mouthSmile_L/R: 0.60
  eyeSquint_L/R: 0.20 (眯眼笑=骄傲)
  cheekPuff_L/R: 0.25
  browOuterUp_L/R: 0.15
  iris_emission_boost: ×2.0 (灵光强=愿望达成)
  divineBird: all 3, celebratory formation (三鸟庆祝队形)
  capeSash: wide spread (帔帛大展=庆祝)

Preset 16: Emotion_Disappointed (失望)
  mouthFrown_L/R: 0.25
  browInnerUp_L/R: 0.30
  eyeOpen_L/R: 0.85
  eyeLookDown_L/R: 0.20
  iris_emission_dim: ×0.5
  divineBird: 凤 retreating (凤鸟退后=失望)

Preset 17: Emotion_Playful (俏皮)
  mouthSmile_L/R: 0.50 (不对称: L=0.55, R=0.45)
  eyeOpen_L/R: 0.90
  eyeSquint_L/R: 0.10
  browOuterUp_L/R: 0.20
  jawOpen: 0.05
  tongueOut: 0.15 (俏皮小舌头)
  iris_shift: cyan ×1.2
  divineBird: 鸾 playful loop (鸾鸟嬉戏环绕)

Preset 18: Emotion_Wise (传递智慧)
  eyeOpen_L/R: 0.82 (眼微收=深思)
  mouthSmile_L/R: 0.20 (微笑=智慧从容)
  browInnerUp_L/R: 0.10
  eyeLookCenter: 0.0 (正视=坚定)
  iris_shift: dual ×1.1 (双色均衡=全知)
  divineBird: 凰 perched (凰鸟栖息=智慧沉稳)

Preset 19: Emotion_Mysterious (神秘)
  mouthSmile_L/R: 0.30 (微笑但嘴微闭合)
  eyeOpen_L/R: 0.85 (眼正常但高光偏移)
  eyeLookOut_L: 0.15 (左眼微向左看=侧目)
  browInnerUp_L/R: 0.05
  iris_emission_shift: highlight_offset (-2px, -1px)
  divineBird: 凰 only, distant (凰鸟远处=神秘)
  capeSash: slow mysterious wave

=== 4 交互表情 ===

Preset 20: Interaction_Greeting (问候入场)
  mouthSmile_L/R: 0.55
  eyeOpen_L/R: 0.88
  browInnerUp_L/R: 0.15
  jawOpen: 0.10
  iris_emission_boost: ×1.5
  divineBird: all 3, greeting formation
  capeSash: dramatic initial spread
  body: entrance pose (浮空下落→站立)

Preset 21: Interaction_Dragged (被拖拽)
  mouthOpen: 0.50 (惊讶)
  eyeOpen_L/R: 0.95 (眼大开)
  browInnerUp_L/R: 0.40
  cheekPuff_L/R: 0.0
  iris_shift: amber ×1.3
  divineBird: all 3, scatter (三鸟散开=被扰动)
  floatingString: disturbed, erratic

Preset 22: Interaction_Click_Head (点击头部)
  mouthSmile_L/R: 0.40
  eyeClose_L/R: 0.50 (半闭眼=享受)
  cheekPuff_L/R: 0.15
  browDown_L/R: 0.05
  iris_emission: warm amber pulse
  divineBird: 鸾 close chirp (鸾鸟近鸣=开心)

Preset 23: Interaction_Click_Body (点击身体)
  mouthSmile_L/R: 0.20
  eyeOpen_L/R: 0.90
  browInnerUp_L/R: 0.10
  body_reaction: slight flinch + return
  divineBird: nearest bird reacts

=== 10 Visemes（口型同步） ===

Preset 24-33: Standard 10 visemes (AA/AE/EH/OH/OU/EE/AR/ER/IY/OO)
  - LING 特殊处理：viseme 发音时唇部微显示 cyan-green tint (#50C878 * 0.05)
    = 「灵音」效果——说话时嘴唇微泛灵光
  - 喉部 emission: #50C878 * 0.03 (说话时内部微辉=灵音可视化)
```

### 3.6 头发系统参数

```
LING 头发系统：

Hair Cards 总数：100 (LOD0) → 50 (LOD1) → 20 (LOD2) → sprite (LOD3)

分区分配：
  Zone A (根部/黑青区): 40 cards, albedo #1A1A2E
  Zone B (渐变过渡区): 30 cards, albedo gradient #1A1A2E→#50C878
  Zone C (尖端/青绿区): 30 cards, albedo #50C878, emission ×0.08

4 层结构：
  Layer 1 (inner silhouette): 15 cards, #1A1A2E, opacity 0.8
  Layer 2 (main volume): 50 cards, zone A+B gradient
  Layer 3 (detail flow): 25 cards, zone B+C, thinner, alpha edge
  Layer 4 (rim glow): 10 cards, #D0F0E0, opacity 0.35, emission ×0.12, rimBoost 2.0

Alpha texture:
  - 每张 hair card 边缘有 alpha mask（头发丝边缘透明度渐变）
  - 尖端 alpha 更柔和（渐变区自然过渡）

SpringBone 物理参数：
  主发 SpringBone chain (5 bones per strand group):
    stiffness: 0.5 (中等弹性——比ARIA柔软但比LUNA硬)
    gravity: 0.5 (标准重力)
    drag: 0.5
    bounce: 0.25 (微弹性——灵体飘动感)

  如意结发饰 SpringBone:
    stiffness: 0.9 (几乎固定——发饰不晃)
    gravity: 0.0

  鸾鸟发簪 SpringBone:
    stiffness: 0.7
    gravity: 0.15 (微晃——鸟簪轻微动态)

发型形状参数：
  长度: 腰线以下 10cm (total ~55cm from crown)
  宽度: 最宽处 ~30cm (shoulder-level spread)
  层数弧度: 内层贴合头型, 外层自然弧度下垂
  渐变起始高度: 耳线 (zone B start)
  渐变完成高度: 锁骨线 (zone C start)

发色渲染特效：
  青绿渐变区在移动时有「音律闪烁」——
    移动时渐变区 emission 临时 ×2.0 (0.5s duration)
    停止后回落 ×0.08
    这是 LING 专属头发特效：发色随动生辉=音律感通
```

### 3.7 眼球系统参数

```
LING 6层眼球系统：

Layer 1: Sclera (巩膜)
  mesh: separate sphere, radius 11.5mm
  albedo: #F8F8FA (微蓝白)
  roughness: 0.30
  UV layout: full sphere, vein pattern in normal map

Layer 2: Iris (虹膜)——LING 最重要特征
  mesh: disc mesh, radius 7.5mm, 4,000 tris (高面数=径向纹精细)
  albedo: dual_color_map
    inner ring (40% radius): #C89050 (amber)
    outer ring (60% radius): #50C878 (cyan-green)
    transition zone (5% width): smooth blend interpolation
    radial pattern: 12 rays, 0.15 intensity, alternating colors
  normal: iris_fiber_normal (径向纤维纹)
  roughness: 0.25
  metallic: 0.15
  emission: #50C878 * 0.10 (灵光自发光)
  clearcoat: 0.7

Layer 3: Pupil (瞳孔)
  mesh: disc, radius 3mm
  albedo: #000000
  emission: single point starlight #FFFFFF * 0.15 (星光闪烁)
    - sparkle position: tracks mouse/attention direction
    - sparkle size: 2px equivalent
    - sparkle animation: slow drift (0.5Hz)

Layer 4: Cornea (角膜)
  mesh: sphere overlay, radius 11.8mm (slightly larger than sclera)
  clearcoat: 1.0
  refractionIOR: 1.38
  roughness: 0.05

Layer 5: Highlight (高光)
  mesh: none (computed in shader)
  2 dynamic highlights:
    Primary: upper-right quadrant, size 3mm equivalent, #FFFFFF
    Secondary: lower-left, size 1.5mm, #FFFFFF * 0.5
  Both track: key light direction + mouse position (attention tracking)
  Special: when iris_emission_boost active, highlights gain
    cyan-green tint (#50C878 * 0.15 overlay)

Layer 6: Eyelid Shadow (眼睑影)
  mesh: none (computed in shader)
  gradient: #C0A0B0→transparent
  coverage: ~15% of iris from upper edge
  opacity: 0.15
  Special: shadow has subtle cyan tint (#50C878 * 0.03)
    = 灵体眼睑影含灵光残留

Eye Tracking 参数：
  跟踪目标: 鼠标位置 (primary) + 用户面部 (secondary, if camera available)
  跟踪速度: 0.3s ease-out (灵体追踪比普通角色稍慢=从容)
  眼球旋转范围: ±15° horizontal, ±10° vertical
  瞳孔星光闪烁: 随眼球移动方向偏移

Auto-Blink 参数：
  间隔: 3-5s (random)
  持续: 0.15s close + 0.1s open
  方式: eyeClose_L/R BlendShape
  特殊: blink 时虹膜辉光瞬间 ×1.5 (灵光闪烁=眨眼时灵光一现)
```

### 3.8 SSS 皮肤渲染参数

```
LING SSS 皮肤渲染：

Scatter Parameters:
  scatterRadius: 10mm (面部) / 8mm (身体)
  scatterColor: #F5E8D8 (皮肤底色) → #D06868 (血色散射)
  scatterWeight: 0.25 (面部) / 0.20 (身体)

Blush Zones:
  Cheeks: scatterWeight_boost ×1.5, radius local 12mm
    → 实际效果: 更明显的红晕在笑/关心时
  Nose tip: scatterWeight_boost ×1.2, radius local 8mm
    → 自然鼻尖微红
  Forehead: none (灵体额头不泛红——清冷额头 vs 温暖脸颊)

Ethereal Glow (LING 专属 SSS 扩展):
  内蕴辉光模式: skin emission #F5E8D8 * 0.05
  这不是普通 SSS——是「灵体自发光」：
    - 皮肤表面有一层极微弱的全局辉光
    - 在暗处/侧光下更明显
    - 模拟：在 SSS shader 中添加 emission_term
    - 效果：LING 仿佛从内部发出微光，不是反射而是自发光
    - 强度可随情感变化：
      * P>0.7 (开心): ×2.0 = 明显辉光
      * P<0.3 (悲伤): ×0.3 = 辉光黯淡
      * A>0.7 (紧张): ×1.5 + 颜色偏琥珀
      * A<0.3 (放松): ×0.7 + 颜色偏青绿

Pore Detail:
  density: 0.4x base (LOW)
  roughness variation map:
    forehead: +0.05 (稍粗糙)
    nose: +0.05
    cheeks: -0.05 (更光滑)
    chin: +0.03
  pore size: 0.3x (更细小——灵体毛孔比凡人更细)
  visibility distance: <0.3m only

Skin SSS Shader Extension (GLSL snippet):
  // LING ethereal glow in SSS pass
  vec3 etherealGlow = albedo * 0.05 * emotionGlowModifier;
  // emotionGlowModifier: 0.3~2.0 based on PAD P-value
  vec3 sssResult = subsurfaceScatter(lightDir, viewDir, albedo, scatterRadius, scatterColor);
  vec3 finalSkin = mix(sssResult, sssResult + etherealGlow, 0.5);
  // 灵体皮肤 = 普通SSS + 自发光混合
```

### 3.9 服装布料物理参数

```
LING 服装布料系统：

3层服装 + 帔帛 + 悬浮琴弦：

Layer 1: 内裙 (紫粉半透)
  SpringBone: none (紧身内裙不需要物理)
  collision: body mesh (紧身贴合)

Layer 2: 外袍+斜帔 (青绿主袍)
  SpringBone: 8 bones along hem edge
    stiffness: 0.4
    gravity: 0.5
    drag: 0.6
    bounce: 0.15
  collision: leg mesh
  pre-baked wrinkles: 3 zones
    - waist fold (坐下时激活)
    - hem ripple (走路时激活)
    - shoulder drape (手臂移动时激活)

Layer 3: 帔帛箜篌形 (白面/青绿面)
  SpringBone: 5 bones along 帔帛 spine
    stiffness: 0.3~0.5 (肩→端渐弱)
    gravity: 0.4~0.6 (端部下垂)
    drag: 0.7 (高阻=飘逸但不疯狂飘)
    bounce: 0.2
  collision: body mesh + arm mesh
  wind sensitivity: 0.3 (微风中帔帛有反应)
  pre-baked: 箜篌形展开 (skill activation 时帔帛展开成竖琴形态)

Floating Strings (悬浮琴弦纹):
  SpringBone: 3 bones
    stiffness: 0.2 (柔软浮动)
    gravity: -0.1 (负重力=向上飘浮!!)
    drag: 0.8 (高阻=缓慢飘动)
    bounce: 0.05
  collision: none (悬浮元素不碰撞身体)
  oscillation: 0.5Hz sine wave (琴弦固有振动频率)
  visibility: emotion-dependent
    * idle: 0-1 strings visible
    * active: 1-2 strings
    * intense: 3 strings (全激活)
    * rest: 0 strings (消失)

神鸟物理:
  凰: SpringBone stiffness 0.6, gravity 0.2, orbit radius 15cm
  凤: SpringBone stiffness 0.5, gravity 0.25, orbit radius 12cm
  鸾: SpringBone stiffness 0.4, gravity 0.3, orbit radius 10cm
  碰撞: 不与身体碰撞（悬浮在身体后方）
  轨道: 绕 spine_02 缓慢旋转, 0.1~0.3Hz

狐灵耳饰+铃坠:
  foxEar_L/R: SpringBone stiffness 0.3, gravity 0.1
  bell_L/R: child bone, stiffness 0.15, gravity 0.3, bounce 0.4
  铃坠碰撞: 与 shoulder/neck 碰撞

云台:
  SpringBone stiffness 0.1, gravity 0.1
  不碰撞脚
  微浮动: ±2cm vertical oscillation, 0.2Hz
```

### 3.10 光照系统参数

```
LING 5光源系统：

Light 1: Key Light (主光源)
  type: DirectionalLight
  color: #FFF8F0 (暖白偏微金——灵体主光)
  intensity: 1.0
  direction: (-30°, 45°, 0°) (左上方)
  shadow: soft shadow map, 1024px, bias 0.001

Light 2: Fill Light (填充光)
  type: DirectionalLight
  color: #F0F5FF (微蓝白——灵体冷调填充)
  intensity: 0.4
  direction: (30°, -20°, 0°) (右下方)
  shadow: none

Light 3: Rim Light (轮廓光)
  type: SpotLight
  color: #50C878 (青绿——LING 专属轮廓色!!不同于其他角色的rim色)
  intensity: 0.8
  direction: (0°, 0°, 180°) (正后方)
  cone: 45°
  目的: 青绿轮廓光=灵体边缘辉光=音律光晕

Light 4: Ambient Light (环境光)
  type: AmbientLight/HemisphereLight
  sky color: #E0F0E8 (微青绿天空)
  ground color: #F0E8D8 (暖白地面)
  intensity: 0.3

Light 5: Status Light (状态指示光)
  type: PointLight (attached to character root)
  color: 状态映射表——
    idle: #50C878 * 0.3 (青绿微光=平静)
    focus: #D4AF37 * 0.5 (金光=专注智慧)
    slack_warning: #C77DBA * 0.6 (紫粉=温柔提醒)
    urgency: #E04040 * 0.4 (红=紧急)
    rest: #F0F5FF * 0.3 (白光=和乐休息)
    happy: #50C878 * 0.8 (青绿强光=愿望达成)
  intensity: 0.2~0.8 (随状态变化)
  radius: 50cm (光晕范围)

LING 专属光照特效：
  - 虹膜自发光会在面部产生微弱的青绿反射
    (计算: iris_emission → face nearby surface receives 0.02 intensity cyan-green light)
  - 神鸟翅膀在飞行时会产生移动光斑
    (凰: gold-cyan spot | 凤: green-purple spot | 鸾: white-pink spot)
  - 琴弦纹发光时在衣物表面产生线性光带
    (floatingString emission → cloth surface receives 0.05 intensity gold line)
```

### 3.11 后处理参数

```
LING 后处理（基于 v3.0 Part 1.10 标准，LING 专属调校）：

Bloom:
  threshold: 0.6 (灵体发光元素更容易触发 bloom)
  strength: 0.4
  radius: 0.5
  LING 专属: bloom 颜色偏青绿 (不是纯白 bloom)
    → bloom tint: #50C878 * 0.15 overlay on bloom pass

SSAO:
  radius: 0.3
  intensity: 0.5
  bias: 0.01

Color Grading:
  LING 专属色调映射——偏青绿灵体色调:
    shadows: shift toward #50C878 * 0.05 (暗部带灵光)
    midtones: neutral
    highlights: shift toward #D4AF37 * 0.03 (高光带金光)
    contrast: 1.05 (微高对比=灵体清晰度)

Vignette:
  intensity: 0.25
  smoothness: 0.4
  color: #1A1A2E (暗蓝 vignette=夜空感)

Film Grain:
  intensity: 0.02 (极低——灵体画面应干净)
  size: 0.5

FXAA:
  enabled: true
  quality: medium

LING 专属后处理扩展：
  Sparkle Pass (灵光闪烁):
    - 在 bloom pass 之后添加
    - 检测 iris_emission / floatingString_emission / bell_emission
    - 在这些区域添加微小随机闪亮点 (1-3px, 0.5Hz)
    - 颜色: #FFFFFF / #50C878 / #D4AF37 交替
    - 效果: 灵体元素有「星光闪烁」效果

  Divine Bird Trail (神鸟轨迹):
    - 神鸟移动路径上留下渐消光带
    - 颜色: 对应鸟色 → 渐消 0.3s
    - 宽度: 2mm equivalent
```

### 3.12 动画系统参数

```
LING 动画 3层混合系统：

Layer 1: Base Pose (基础姿态层)
  优先级: 最高 (weight=1.0)
  来源: LING 默认骨骼姿态 (见 3.4)
  BlendMode: additive to skeleton default pose
  内容: 站立/坐下/浮空 三种基础姿态
    - idle_stand: 微前倾+持笛姿态+浮云站
    - idle_sit: 盘坐/跪坐+笛放膝上
    - idle_float: 全浮空+双腿交叉+帔帛展开

Layer 2: State Action (状态动作层)
  优先级: 中 (weight=0.5~0.8, 随状态强度变化)
  来源: FSM 当前状态动画
  BlendMode: override Layer 1 的动态部分
  每个状态动画含:
    - 主循环 (2-4s)
    - 微行为插入点 (0.3-1s)
    - 状态过渡起止 (0.3s)

  状态动画参数（关键状态）:

  coding_focus:
    loop: 3s, standing微前倾
    spine: (-3°, 0°, 0°) → (-1°, 0°, 0°) oscillation 4s
    head: (-5°, 0°, 0°) (低头看屏幕)
    rightArm: 持笛竖放胸前, 微指动 (0.5Hz)
    divineBird: 凰 perched right shoulder, occasional chirp
    floatingString: 0-1 faint strings
    capeSash: minimal movement

  slack_detected:
    loop: 2s, turning toward user
    spine: (-1°, 0°, 15°) → (-1°, 0°, 5°) oscillation 2s
    head: (0°, 10°, 0°) → (0°, -5°, 0°) (看向用户)
    mouthSmile: 0.30 (微微笑)
    divineBird: 凤 flying toward screen (orbit tightens)
    floatingString: 1 string appears, oscillating

  pomodoro_rest:
    loop: 4s, sitting relaxed
    spine: (5°, 0°, 0°) (后仰放松)
    legs: crossed or extended
    rightArm: 笛放膝上, occasional pick up + put down
    divineBird: 鸾 circling slowly
    capeSask: relaxed wide spread, slow wave

Layer 3: Expression (表情层)
  优先级: 低 (weight=0.3~0.5)
  来源: 当前情感 BlendShape 组合
  BlendMode: additive to face bones + BlendShapes
  内容: 30 表情预设 (见 3.5)

微行为系统（LING 专属 14 个）:

  01. hair_tuck_right: 右手将发丝别到耳后 (1s, 0.2/min)
  02. flute_lift: 右手微举笛 → 放回 (0.8s, 0.15/min)
  03. bird_call: 某只神鸟飞近 → 轻触 → 鸟飞回 (1.5s, 0.1/min)
  04. string_pluck: 指拨琴弦 → 琴弦振动 → 渐消 (0.6s, 0.08/min)
  05. bell_shake: 头微摇 → 铃坠响 → 灵光粒子 (0.3s, 0.05/min)
  06. cloud_shift: 浮云微移 → 脚微调整 (0.5s, 0.12/min)
  07. distant_gaze: 眼向远处看 → 微收回 (1s, 0.15/min)
  08. knowing_smile: 笑加深0.1 → 回落 (0.6s, 0.2/min)
  09. cape_flutter: 帔帛被风微扰 → 恢复 (0.8s, 0.1/min)
  10. iris_sparkle: 虹膜星光位置偏移 (0.3s, 0.3/min)
  11. wish_listen: 眉内抬+眼微闭 → 「我在听」 (0.8s, 0.08/min)
  12. deep_breath: 吸气 → 帔帛展开 → 呼气收拢 (1.5s, 0.15/min)
  13. ground_touch: 云台下降2cm → 回升 (1s, 0.05/min)
  14. bird_orbit_shift: 神鸟轨道半径变化 → 恢复 (2s, 0.06/min)

状态过渡规则：
  - 状态切换: 0.3s crossfade
  - 状态强度变化: 0.5s ease
  - 微行为插入: 0.15s blend in, 0.1s blend out
  - 情感变化: 0.5s BlendShape transition
```

### 3.13 性格行为参数

```
LING 性格行为矩阵（PAD模型）：

PAD基准：P=0.65（较高愉悦）/ A=0.5（中等唤醒）/ D=0.55（中等支配）

性格关键词映射：
  神秘 → D+0.1 (有掌控感但不强势)
  温柔 → P+0.15 (高愉悦=温暖)
  知音 → P+0.05, A-0.05 (理解用户=平静关注)
  应愿 → D+0.05 (响应愿望=有目的感)
  灵通 → A+0.1 (感知敏锐=较快反应)

监控驱动行为权重：
  摸鱼提醒：gentle_insight 0.6 | direct_fact 0.3 | humor 0.1
    → LING 会先温柔地说「你的愿望还在呢~」然后给出事实
  进度预警：wish_status 0.7 | emotion 0.3
    → 「你的勤勉之愿进度 XX%，需要加速吗？」
  下班提醒：wish_complete 0.6 | warm_suggestion 0.4
    → 「今天的愿望完成了吗？凰鸟说专注时间够了~」
  休息催促：harmony_wish 0.7 | medical 0.3
    → 「鸾鸟唱和乐之音了，休息一下让愿望更美好~」

对话风格：
  句式：温柔陈述+偶用比喻，10-16字
  语调标记：可用「~」结尾，偶用「呢」，但不用「呀/啊」过度
  特色：常引用音律/愿望比喻
    例：「你的专注如琴弦绷紧，偶尔需要松一松~」
    例：「凰鸟感知到你在深度专注，它安静守护着~」
  禁忌词：不用「必须/命令/不准」（不是强制），不用嘲讽词
  例外：P<0.3 时语气会明显沉静，减少比喻

站坐倾向：
  coding：站0.6 | slack：坐0.4 | meeting：站0.5 | idle：浮空0.7 | rest：坐0.8

LING 专属能力——「愿望感应」：
  - LING 可以「感知」用户的工作意愿（基于监控数据推断）
  - 推断逻辑：
    * 高专注 + 高进度 → 「智慧之愿在进行」→ 凰鸟激活
    * 低专注 + 低进度 → 「勤勉之愿在等待」→ 凤鸟催促
    * 高专注 + 高疲劳 → 「和乐之愿在呼唤」→ 鸾鸟提醒休息
  - 三鸟是 LING 的独特交互语言——不用文字也能传达信息
```

---

## 4. 角色切换规格（LING 加入5角色体系）

```
LING 作为第6角色（SPIRIT-06）加入现有5角色体系：

切换流程：
  1. 用户选择 LING（桌搭/角色面板新增灵·应愿卡片）
  2. 当前角色 exit pose + 消散特效
  3. LING entrance: 青绿光点凝成形体 + 三鸟从光点中飞出 + 帔帛展开
  4. entrance pose: 浮空 → 降落至站立位置 → 右手举起叶笛 → 微笑
  5. signature idle: 凰鸟落肩 + 凤鸟绕背后 + 鸾鸟停在发簪

LING 切换消散特效：
  - 消散时：身体化为青绿光点向上飘散
  - 三鸟分别化为三种颜色光弧（金青/绿紫/白粉）飞向天空
  - 叶笛化为金色叶形光点旋转消散
  - 帔帛化为白色飘带消散

角色选择面板新增：
  卡片: 青绿底色(#50C878) + 金边(#D4AF37)
  标题: 灵·应愿
  描述: 曲通万物之情，佑众生和乐
  预览: LING 3/4角度微缩图 + 三鸟剪影
  标签: #神秘 #温柔 #音律 #应愿 #灵通
```

---

## 5. 概念图与参数对照索引

```
概念图 → 参数映射表：

| 概念图 | 对应参数章节 | 关键参数 |
|--------|-------------|---------|
| 01_三视图 | 3.1 面数分配, 3.4 骨骼, 3.3 材质槽位 | proportions, bone offsets, material zones |
| 02_面部特写 | 3.7 眼球系统, 3.5 BlendShape, 3.8 SSS | iris dual-color, expression presets, scatter |
| 03_服装材质 | 3.3 材质槽位(9-20), 3.9 布料物理 | PBR values, SpringBone params, layer breakdown |
| 04_动态特效 | 3.10 光照, 3.11 后处理, 3.12 动画 | light colors, bloom tint, state animation |

Code 编辑器使用指南：
  1. 先看概念图确认视觉方向
  2. 读对应参数章节获取精确数值
  3. 按 v3.0 Part 6 技术架构实现 Three.js + VRM 代码
  4. 材质参数直接映射到 ShaderMaterial uniforms
  5. BlendShape 值直接映射到 VRM BlendShapeProxy weights
  6. SpringBone 参数直接映射到 VRM SpringBone settings
  7. 光照参数直接映射到 Three.js Light objects
  8. 后处理参数直接映射到 EffectComposer passes
```

---

## 6. 与 v3.0 主规格的兼容声明

```
LING 角色设计完全兼容 v3.0 虚拟人终版规格框架：

兼容点：
  ✅ LOD 面数体系（3.1 LOD切换表符合 v3.0 Part 1.11 LOD系统）
  ✅ PBR+Toon 混合材质（3.3 14+6材质槽位符合 v3.0 Part 1.2 PBR材质系统）
  ✅ ARKit 52 BlendShape（3.5 30预设符合 v3.0 Part 1.4 表情系统）
  ✅ 6层眼球系统（3.7 符合 v3.0 Part 1.6 眼球系统）
  ✅ SSS皮肤渲染（3.8 符合 v3.0 Part 1.7 SSS系统，新增 ethereal glow 扩展）
  ✅ SpringBone 物理系统（3.9 符合 v3.0 Part 1.5/1.8 头发/布料系统）
  ✅ 5光源系统（3.10 符合 v3.0 Part 1.9 光照系统）
  ✅ 后处理管线（3.11 符合 v3.0 Part 1.10 后处理，新增 sparkle/divine bird trail）
  ✅ 3层动画混合（3.12 符合 v3.0 Part 1.12 动画系统）
  ✅ 性格PAD模型（3.13 符合 v3.0 Part 2/v2.4 情感系统）
  ✅ 交互物理系统（兼容 v3.0 Part 4 拖拽/点击/遮挡）

LING 专属扩展（需在基础架构上新增）：
  🆕 Slot 15-20: 额外材质槽位（神鸟/琴弦/云台/宝石）
  🆕 Ethereal Glow: SSS shader 扩展（灵体自发光）
  🆕 Sparkle Pass: 后处理扩展（灵光闪烁）
  🆕 Divine Bird Trail: 后处理扩展（神鸟轨迹）
  🆕 Dual-Color Iris: 虹膜 shader 扩展（双色径向纹）
  🆕 Negative Gravity: SpringBone 扩展（琴弦负重力=向上飘）
  🆕 Wish Perception: 监控-交互扩展（三鸟愿望感应系统）
  🆕 17 extra bones: 骨骼扩展（狐耳/铃/神鸟/琴弦/云台/帔帛）

实现优先级：
  P0: 基础兼容部分（可以直接用 v3.0 架构实现）
  P1: LING 专属扩展（需要在架构上增加模块）
  P2: 高级特效（sparkle/trail 可在性能足够时添加）
```

---

*文档结束。此规格可直接交付 code 编辑器进行 3D 建模与渲染实现。*
*概念图文件位于 `character-concept-art/` 目录，共4张：三视图/面部特写/服装材质/动态特效*
