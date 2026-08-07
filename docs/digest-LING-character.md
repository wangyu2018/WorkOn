已通读全部 1313 行规格文档并查看 8 张概念图，以下为实现级技术摘要。

---

# WorkOn 角色 LING（灵·应愿）实现级技术摘要

> 来源：`workon-character-LING-design-spec.md`（1313 行）+ 8 张概念图
> 定位：王者荣耀传说级品质，妲己「愿照·众生和」特效皮肤视觉语言；代号 **SPIRIT-06**，为第 6 个角色加入现有 5 角色体系
> 核心意象：应愿之神 × 音律感通 × 五采神鸟 × 四合如意
> 设计原则："曲通万物之情，佑众生和乐"

## 1. 角色基础设定

- **姓名**：LING（灵·应愿），女性，外貌 20 出头，设定为超越年龄的应愿之神
- **背景一句话**：LING 是应愿之神——她聆听世间所有愿望，以音律感通万物；法器「通情曲」是一片叶笛，象征音律之始、自然之声
- **性格关键词**：神秘·温柔·知音·应愿·灵通（PAD 基准 **P=0.65 / A=0.5 / D=0.55**；映射：神秘 D+0.1、温柔 P+0.15、知音 P+0.05/A-0.05、应愿 D+0.05、灵通 A+0.1）
- **声线**：中频·空灵·带轻微回响（如空谷传音）
- **对话风格**：温柔陈述+偶用比喻，10–16 字；可用「~」「呢」，不用「呀/啊」过度；禁忌「必须/命令/不准」与嘲讽词；P<0.3 时语气沉静、减少比喻
- **身高/肤色/发色**：165cm；肤色暖白偏微光 `#F5E8D8`；发色黑青 `#1A1A2E` → 青绿 `#50C878` 渐变
- **主色系**：青绿 `#50C878` + 白 `#F0F5FF` + 紫粉 `#C77DBA` + 金 `#D4AF37`

## 2. 身体比例与体型参数

- **头身比 7.5 头身，身高 165cm**（文档未给出更细的肩宽/三围数值）
- 赤足，站立于半透浮云（`#F0F5FF`）上，云台上青绿粒子升腾
- 整体剪影：纵向流动线条+优雅曲线，斜帔不对称；三鸟+帔帛在身后形成宽于体宽的扇形展开，**体宽：展开宽 = 1:1.5**
- 发型尺寸：长度腰线以下 10cm（头顶起 ~55cm）；最宽处 ~30cm（肩高水平）；渐变起始于耳线、完成于锁骨线
- 手部需精细建模（叶笛持握姿态需手指精确变形）

## 3. 20 个材质槽位（3.3 节，14 基础 + 6 扩展）

文档标题称"14 材质槽位"，实际列出 20 个；合并建议：Cloth 组 9-13→9-11，Accessory 组 14-16→12-14，Effect 组 17-20→15-17，最终保持 17 槽位。

| Slot | 名称 | albedo | roughness | metallic | 其他 |
|---|---|---|---|---|---|
| 01 | Skin_Face | `#F5E8D8` | 0.35 基（鼻/额 0.40，颊 0.30） | 0.0 | normal: face_detail_normal_map（毛孔 0.4x）；AO: face_AO_map；emission `#F5E8D8`*0.05（RGB 实际值 `#0C0E0A`）；toonWeight 0.4；toonRamp skin_ramp_4step（`#F5E8D8→#E0D0C0→#C0B0A0→#A09080`）；SSS radius 10mm、scatter `#F5E8D8→#D06868`、weight 0.25 |
| 02 | Skin_Body | `#F5E8D8` | 0.35 | 0.0 | 毛孔 0.3x；emission*0.03；toonWeight 0.35；SSS radius 8mm、weight 0.2；无 blush |
| 03 | Hair_Main_BlackBlue | `#1A1A2E` | 0.45 | 0.0 | anisotropic 0.75；toonWeight 0.55；ramp `#1A1A2E→#2A2A3E→#0A0A1E`；rimBoost 1.2 |
| 04 | Hair_Gradient_CyanGreen | `#1A1A2E→#50C878` 渐变 | 0.40 | 0.0 | anisotropic 0.80；toonWeight 0.55；emission `#50C878`*0.08；rimBoost 1.5 |
| 05 | Hair_Inner_Translucent | `#D0F0E0` | 0.50 | — | transparency 0.35；emission `#50C878`*0.12；rimBoost 2.0 |
| 06 | Eye_Iris | custom_dual_color_map（内环 40% `#C89050`、外环 60% `#50C878`、过渡区 5% 平滑混合、12 条径向射线交替双色 intensity 0.15） | 0.25 | 0.15 | normal iris_fiber_normal；emission `#50C878`*0.10；clearcoat 0.7；toonWeight 0.2 |
| 07 | Eye_Sclera | `#F8F8FA` | 0.30 | 0.0 | — |
| 08 | Eye_Cornea | — | 0.05 | — | clearcoat 1.0；refractionIOR 1.38；无 emission |
| 09 | Cloth_Inner_PurplePink | `#C77DBA` | 0.60 | 0.0 | silk_weave_normal；toonWeight 0.45；ramp `#C77DBA→#B06DA8→#905D98→#704D88` |
| 10 | Cloth_Inner_TranslucentEdge | `#E8D0F0` | 0.50 | — | transparency 0.40；emission `#C77DBA`*0.05；toonWeight 0.3 |
| 11 | Cloth_Main_CyanGreen | `#50C878` | 0.50 | 0.0 | robe_detail_normal（如意纹刺绣凸起）；toonWeight 0.5；ramp `#50C878→#40B068→#309858→#208048`；detailMap ruyi_pattern_decal（`#D4AF37` 金线 on `#50C878`） |
| 12 | Cloth_Main_WhitePanel | `#F0F5FF` | 0.55 | 0.0 | silk_weave_normal；toonWeight 0.45；ramp `#F0F5FF→#E0E8F0→#C0D0E0→#A0B8C0` |
| 13 | Cloth_CapeSash_HarpShape | 正面 `#F0F5FF` / 背面 `#50C878` | 0.55 | 0.0 | flowing_silk_normal；transparency 0.0；toonWeight 0.45 |
| 14 | Accessory_Gold | `#D4AF37` | 0.20 | 0.95 | gold_engrave_normal（如意纹刻花+铃铛纹）；toonWeight 0.25；clearcoat 0.3；emission `#D4AF37`*0.02 |
| 15 | Accessory_Gem_Cyan | `#50C878` | 0.15 | 0.0 | transmission 0.6；emission `#50C878`*0.15；clearcoat 0.8 |
| 16 | Effect_FloatingString | `#D4AF37` | 0.1 | 0.3 | transparency 0.5；emission `#D4AF37`*0.20（最亮发光元素） |
| 17 | DivineBird_凰 | 渐变 `#D4AF37→#50C878` | — | 0.3 | emission `#D4AF37`*0.08；toonWeight 0.4 |
| 18 | DivineBird_凤 | 渐变 `#50C878→#C77DBA` | — | 0.2 | emission `#50C878`*0.06；toonWeight 0.4 |
| 19 | DivineBird_鸾 | 渐变 `#F0F5FF→#C77DBA` | — | 0.1 | emission `#F0E0D8`*0.05；toonWeight 0.35 |
| 20 | Cloud_Platform | `#F0F5FF` | 0.8 | — | transparency 0.6；emission `#50C878`*0.05 |

## 4. 97 骨骼结构（3.4 节）

**总数 = 基础 VRM humanoid 80 + LING 专属 17 = 97 bones**。文档未逐根列出 80 根基础骨骼（按标准 VRM humanoid：hips/spine_01/spine_02/neck_01/head/shoulder_L,R/upperArm/lowerArm/hand/五指/upperLeg/lowerLeg/foot/toe），只给了默认姿态偏移与专属骨骼。

默认姿态偏移（XYZ 欧拉角）：
- `spine_01`: (-1°, 0°, 2°) 微后仰+微侧倾；`spine_02`: (0,0,0)
- `neck_01`: (-2°, 0°, 0°) 下巴微抬；`head`: (0,0,0)
- `shoulder_L/R`: (0°, -4°, 0°) 肩微展
- `upperArm_L`: (0°, -5°, 0°)；`upperArm_R`: (0°, 5°, 0°) 右臂略前
- `lowerArm_R`: (0°, 15°, 0°) 右前臂弯曲（持笛就绪）
- `hand_R`: (0°, 10°, -5°) 右手握笛姿态
- `hip_L/R`、`upperLeg_L/R`: (0,0,0)；`lowerLeg_L/R`: (5°, 0°, 0°) 微前倾（浮云站立）

LING 专属 17 根（挂点层级）：
- `foxEar_L`: (0°, -10°, 15°)、`foxEar_R`: (0°, 10°, -15°) — **head 骨骼附加**（2 根）
- `bell_L`（foxEar_L 子级）、`bell_R`（foxEar_R 子级）— SpringBone stiffness 0.3, gravity 0.1（2 根）
- `divineBird_凰`、`divineBird_凤`、`divineBird_鸾` — **spine_02 附加**（3 根；SpringBone 见 §8）
- `capeSash_01~05` — 沿帔帛分布 5 根 SpringBone，stiffness 0.3~0.5（肩→端渐弱）、gravity 0.4~0.6（端部下垂更多）
- `floatingString_01~03` — 沿琴弦纹 3 根，stiffness 0.2、**gravity -0.1（负重力向上飘）**、drag 0.8
- `cloudPlatform` — 脚骨附加，stiffness 0.1、gravity 0.1

## 5. 面部系统

### 5.1 眼球（6 层结构，3.7 节）
- **L1 Sclera**：独立球体 radius **11.5mm**，albedo `#F8F8FA`，roughness 0.30，法线含微蓝血管纹
- **L2 Iris（最重要特征）**：disc mesh radius **7.5mm**、**4,000 tris**；**内环 40% 半径琥珀 `#C89050` → 外环 60% 半径青绿 `#50C878`，过渡区 5% 宽平滑混合；径向纹 12 条射线自瞳孔发出、琥珀/青绿交替、intensity 0.15**；roughness 0.25、metallic 0.15、emission `#50C878`*0.10、clearcoat 0.7
- **L3 Pupil**：disc radius **3mm**，albedo `#000000`；单个星光闪烁点 `#FFFFFF`*0.15（**2px 等效**，随鼠标/注意方向偏移，慢漂移 0.5Hz）
- **L4 Cornea**：球壳 radius **11.8mm**（略大于巩膜），clearcoat 1.0、refractionIOR 1.38、roughness 0.05
- **L5 Highlight**（shader 计算）：主高光右上象限 3mm `#FFFFFF`；次高光左下 1.5mm `#FFFFFF`*0.5；追踪主光方向+鼠标位置；iris_emission_boost 激活时叠加青绿 tint（`#50C878`*0.15）
- **L6 Eyelid Shadow**（shader 计算）：渐变 `#C0A0B0`→透明，自上眼睑覆盖虹膜 ~15%，opacity 0.15，带青绿残光 tint（`#50C878`*0.03）
- **Eye Tracking**：目标=鼠标（主）+用户面部（次，若有摄像头）；速度 0.3s ease-out；旋转范围水平 ±15°、垂直 ±10°
- **Auto-Blink**：间隔 3–5s 随机；0.15s 闭 + 0.1s 开；眨眼瞬间虹膜辉光 ×1.5

### 5.2 睫毛与眉
- **35 根睫毛**：上 18 根（较长、外翘 15°）、下 17 根（较短、微翘 5°）；上睫 3 密度区：内（密短）/中（疏最长）/外（中等）
- **眉毛**：薄弧，外 1/3 青绿 `#50C878` 染、内 2/3 自然发色 `#1A1A2E`；弧度在 1/3 处微上挑

### 5.3 皮肤/妆容
- albedo `#F5E8D8`；SSS：面 radius 10mm/weight 0.25，体 radius 8mm/weight 0.20，scatter `#F5E8D8→#D06868`
- Blush：脸颊 scatterWeight_boost ×1.5（局部 radius 12mm）；鼻尖 ×1.2（radius 8mm）；额头无泛红
- **Ethereal Glow（灵体自发光）**：skin emission `#F5E8D8`*0.05，随 PAD 变化：P>0.7 ×2.0；P<0.3 ×0.3；A>0.7 ×1.5 偏琥珀；A<0.3 ×0.7 偏青绿。GLSL：`vec3 etherealGlow = albedo * 0.05 * emotionGlowModifier;`（modifier 0.3~2.0）
- 毛孔：密度 0.4x、尺寸 0.3x、仅 <0.3m 可见；粗糙度变化：额 +0.05、鼻 +0.05、颊 -0.05、下巴 +0.03
- **唇**：自然粉 `#E0B0B0`，唇心含微青绿灵唇标记（`#50C878`*0.05）；默认微笑嘴角 +6° 露上排牙；牙齿 `#F8F8F0` 微发光；口腔内 `#CC3030`
- **Viseme 灵音特效**：发音时唇部泛青绿（`#50C878`*0.05），喉部 emission `#50C878`*0.03

### 5.4 表情 BlendShape（3.5 节）
- 基础：**ARKit 52 BlendShape 标准**；**30 个 LING 专属表情预设**（5 基础 + 7 工作状态 + 7 情感 + 4 交互 + 10 viseme 口型 AA/AE/EH/OH/OU/EE/AR/ER/IY/OO）
- 默认 Neutral（Preset 01）关键值：`mouthSmile_L/R 0.25`（+6°）、`eyeOpen_L/R 0.88`（12% 高于中性）、`browInnerUp_L/R 0.08`（眉内抬 2°）、`eyeLookDown_L/R 0.05`、`cheekPuff_L/R 0.05`、`jawOpen 0.0`
- 其余预设均给出完整权重（如 Happy：mouthSmile 0.70 + iris_emission_boost ×2.0 + 三鸟欢跃；Angry：browDown 0.50 + 内环琥珀增强 ×1.5 + floatingString ×2.0 等，详见文档 3.5 节 Preset 02–23，每个含 divineBird/floatingString/capeSash/body_pose 联动指令）

## 6. 狐耳与金铃

- **性质**：装饰性狐耳配件（不替换人耳），金色 `#D4AF37` 金属底座 + 内面青绿 `#50C878` 绒面
- **挂点**：`foxEar_L/R` 附加于 head 骨骼；默认偏移 L (0°,-10°,15°)、R (0°,10°,-15°)
- **物理**：耳 SpringBone stiffness 0.3、gravity 0.1；`bell_L/R` 为耳的子骨骼，stiffness 0.15、gravity 0.3、bounce 0.4，与肩/颈碰撞
- **金铃**：每耳尖 1 个铃坠，尺寸 ~0.8cm；角色移动时发 1–2 个星辉粒子（`#FFFFFF`/`#D4AF37`）

## 7. 尾巴

**规格文档中无尾巴设定**——97 骨骼清单不含尾骨，材质槽位也无尾巴材质。但 4 张状态空间概念图（Q 版形象）均画有青绿色狐尾。若 Three.js 实现需要尾巴，属规格外扩展，建议按 `capeSash` 的 SpringBone 参数族（stiffness 0.3~0.5、gravity 0.4~0.6）近似，并与文档作者确认。

## 8. 愿感系统·三灵鸟

三只神鸟是 LING 的独特交互语言（不用文字传达监控信息），共同在身后形成孔雀尾（凤尾）扇形展开，翅羽延伸成乐谱纹：

| 鸟 | 配色（材质） | 愿望/对应监控 | SpringBone | 轨道 |
|---|---|---|---|---|
| **凰** | 金青渐变 `#D4AF37→#50C878`，emission `#D4AF37`*0.08，metallic 0.3 | 智慧之愿 → 专注办公监控 | stiffness 0.6, gravity 0.2 | radius **15cm** |
| **凤** | 绿紫渐变 `#50C878→#C77DBA`，emission `#50C878`*0.06，metallic 0.2 | 勤勉之愿 → 进度追赶催促 | stiffness 0.5, gravity 0.25 | radius **12cm** |
| **鸾** | 白粉渐变 `#F0F5FF→#C77DBA`，emission `#F0E0D8`*0.05，metallic 0.1 | 和乐之愿 → 休息放松提醒 | stiffness 0.4, gravity 0.3 | radius **10cm** |

- 均挂 spine_02，绕 spine_02 缓慢旋转 **0.1~0.3Hz**，不与身体碰撞（悬浮身后）
- 面数：凰 1,500 / 凤 1,300 / 鸾 1,200 tris（共 4,000）
- 飞行时产生移动光斑：凰=金青 spot、凤=绿紫 spot、鸾=白粉 spot；后处理留渐消光带（0.3s、宽 2mm 等效）
- **愿望感应逻辑**：高专注+高进度→凰激活；低专注+低进度→凤催促；高专注+高疲劳→鸾提醒休息
- 行为映射：摸鱼时凤飞来提醒；专注时凰守护静默陪伴；休息时鸾奏和乐之音；下班前三鸟合奏询问「你的愿望完成了吗？」

## 9. 服装拆解（3 层 + 帔帛 + 悬浮琴弦，3.9 节）

- **Layer 1 内裙**：紫粉 `#C77DBA` 丝质紧身，袖口/裙摆半透边缘 `#E8D0F0`（transparency 0.40）；无 SpringBone，与身体网格碰撞；2,000 tris
- **Layer 2 外袍+斜帔（主）**：青绿 `#50C878` 外袍 + 白侧片 `#F0F5FF`，金线四合如意纹绣边（detailMap：`#D4AF37` on `#50C878`）；下摆 8 根 SpringBone（stiffness 0.4、gravity 0.5、drag 0.6、bounce 0.15），与腿部碰撞；3 个预烘焙褶皱区（waist fold 坐下激活 / hem ripple 走路激活 / shoulder drape 手臂移动激活）；5,500 tris
- **Layer 3 帔帛箜篌形**：外白 `#F0F5FF` / 内青绿 `#50C878` 双面，展开时呈箜篌（古竖琴）剪影，如意纹边飘带；5 根 SpringBone（stiffness 0.3~0.5、gravity 0.4~0.6、drag 0.7、bounce 0.2），与身体+手臂碰撞，wind sensitivity 0.3；预烘焙「箜篌形展开」（技能激活时）；3,000 tris
- **悬浮琴弦纹**：`#D4AF37` 半透（0.5）发光（×0.20）元素，悬浮于面料表面之上；3 根 SpringBone（stiffness 0.2、gravity **-0.1**、drag 0.8、bounce 0.05），无碰撞；固有振动 0.5Hz 正弦；可见度随情绪：idle 0-1 条 / active 1-2 条 / intense 3 条 / rest 0 条；1,000 tris
- **配饰**（共 2,000 tris）：金如意结腰带扣（嵌青宝石 `#50C878`，400 tris）；漂浮璎珞项链（青/金/紫珠，微悬浮，300）；叶笛「通情曲」（右手持握，500）；狐耳饰（400）；铃坠（200）；鞋带饰（200）。右鬓金如意结发饰 ~3cm（嵌小青绿宝石，SpringBone stiffness 0.9/gravity 0.0）；左侧鸾式小鸟发簪（白粉 `#F0E0D8`，stiffness 0.7/gravity 0.15）

## 10. 特效（妲己风格粒子/光效）

**Idle 粒子**：青绿 `#50C878` 慢漂粒子 2–3 点绕身；金光尘 `#D4AF37` 1–2 点近发/鸟；如意纹符（`#50C878` 描边、`#D4AF37` 填充）0–1 个浮于手边；脚下云台青绿粒子升腾。特效粒子面预留 1,000 tris。

**5 光源系统（3.10）**：
- Key：DirectionalLight `#FFF8F0`，intensity 1.0，方向 (-30°,45°,0°)，软阴影 1024px bias 0.001
- Fill：DirectionalLight `#F0F5FF`，0.4，(30°,-20°,0°)，无阴影
- Rim：SpotLight `#50C878`（LING 专属青绿轮廓光），0.8，正后方 (0°,0°,180°)，锥角 45°
- Ambient/Hemisphere：sky `#E0F0E8` / ground `#F0E8D8`，0.3
- Status（PointLight 挂角色根，半径 50cm，intensity 0.2~0.8）：idle `#50C878`*0.3 / focus `#D4AF37`*0.5 / slack_warning `#C77DBA`*0.6 / urgency `#E04040`*0.4 / rest `#F0F5FF`*0.3 / happy `#50C878`*0.8

**后处理（3.11）**：Bloom threshold 0.6 / strength 0.4 / radius 0.5 + 青绿 tint（`#50C878`*0.15）；SSAO radius 0.3/intensity 0.5/bias 0.01；Color grading 暗部偏 `#50C878`*0.05、高光偏 `#D4AF37`*0.03、contrast 1.05；Vignette 0.25/smooth 0.4/`#1A1A2E`；Film grain 0.02；FXAA medium。**专属**：Sparkle Pass（bloom 后，在虹膜/琴弦/铃发光区加 1-3px 随机闪点，0.5Hz，`#FFFFFF`/`#50C878`/`#D4AF37` 交替）；Divine Bird Trail（移动路径渐消光带 0.3s、2mm 宽）。

**头发特效**：青绿渐变区移动时 emission 临时 ×2.0（0.5s），停止回落 ×0.08（"发色随动生辉"）。

**入场/消散特效**：入场=青绿光点凝成形体+三鸟从光点飞出+帔帛展开；消散=身体化青绿光点上飘、三鸟化三色光弧（金青/绿紫/白粉）飞天、叶笛化金色叶形光点旋转消散、帔帛化白色飘带消散。

## 11. 签名动作/动画（3.12 节 + 第 4 节）

**3 层动画混合**：L1 Base Pose（weight 1.0，idle_stand 微前倾持笛浮云站 / idle_sit 盘跪坐笛放膝 / idle_float 全浮空双腿交叉帔帛展开）→ L2 State Action（weight 0.5~0.8，主循环 2-4s + 微行为插入 0.3-1s + 过渡 0.3s）→ L3 Expression（weight 0.3~0.5）。

**签名入场序列**：浮空下落 → 降落至站立位 → 右手举起叶笛 → 微笑 → signature idle（**凰鸟落肩 + 凤鸟绕背后 + 鸾鸟停在发簪**）。

**关键状态骨骼关键帧**：
- `coding_focus`（loop 3s）：spine (-3°,0°,0°)→(-1°,0°,0°) 振荡 4s；head (-5°,0°,0°) 低头；右臂持笛竖放胸前微指动 0.5Hz；凰栖右肩偶鸣
- `slack_detected`（loop 2s）：spine (-1°,0°,15°)→(-1°,0°,5°) 振荡 2s；head (0°,10°,0°)→(0°,-5°,0°) 转向用户；mouthSmile 0.30；凤飞向屏幕（轨道收紧）；浮现 1 条琴弦
- `pomodoro_rest`（loop 4s）：spine (5°,0°,0°) 后仰；腿交叉或伸展；右手笛放膝上偶拾放；鸾慢环绕；帔帛放松大展慢波

**14 个微行为**（时长, 频率）：hair_tuck_right 别发（1s, 0.2/min）；flute_lift 举笛（0.8s, 0.15/min）；bird_call 鸟飞近轻触（1.5s, 0.1/min）；string_pluck 拨弦（0.6s, 0.08/min）；bell_shake 摇铃发粒子（0.3s, 0.05/min）；cloud_shift 云移调脚（0.5s, 0.12/min）；distant_gaze 远望（1s, 0.15/min）；knowing_smile 笑加深 0.1 回落（0.6s, 0.2/min）；cape_flutter 帔帛风扰（0.8s, 0.1/min）；iris_sparkle 星光偏移（0.3s, 0.3/min）；wish_listen 眉抬眼微闭（0.8s, 0.08/min）；deep_breath 吸气帔帛展（1.5s, 0.15/min）；ground_touch 云降 2cm 回升（1s, 0.05/min）；bird_orbit_shift 轨道半径变化（2s, 0.06/min）。过渡：状态切换 0.3s crossfade，强度 0.5s ease，微行为 0.15s in/0.1s out，情感 0.5s。

## 12. 概念图逐张描述

**character-concept-art/（角色概念图，风格为写实比例正稿）**

1. **Game_quality_character_turnaro（三视图，1216×832）**：灰网格背景上的正/侧/背三视图。青绿长袍+白侧片+紫粉内裙层次分明，金线刺绣沿下摆；黑青长发及腰以下、中段起青绿渐变，背面可见金如意结发饰；狐耳竖立、右肩上方悬浮一只彩翼神鸟（蓝紫金渐变翼）；右手持绿叶笛；赤足，脚边有祥云。对建模最有用：三层服装的长度关系（外袍及踝、内裙露出紫粉下摆）、背部发量与扇形展开。

2. **Ultra_detailed_close_up_face（面部特写，1024×1024）**：正面大特写。双眼虹膜清晰可见**内环琥珀金→外环青绿**的双色结构，黑色睫毛浓密上翘，青绿染眉；头顶狐耳内面青绿绒毛、耳根毛簇为白绿色；两侧金色中国结（如意结）发饰下垂金铃，右上还有一只金色小鸟发簪；脸颊明显红晕、鼻尖微红、唇为自然粉；画面四周散布青绿/金色微粒。对建模最有用：双色虹膜的面积比与金铃体积感。

3. **Detailed_costume_and_material（服装拆解，1216×832）**：无头服装平铺/悬浮展示+配饰分解图。主体为青绿外袍（白翻领、金绣纹样）罩紫粉长裙，腰系金如意结宽腰带；左侧分列金青凤凰、金嵌青宝腰带扣、绿玉箜篌/叶笛状器物；右侧白粉色鸾鸟；帔帛为青绿→白渐变长飘带，周身环绕发光音符与琴弦光线。对建模最有用：腰带扣的如意结造型、箜篌形帔帛的弧度、三鸟与服装的相对大小。

4. **Dynamic_cinematic_action_pose（动态特效，1216×832）**：深色背景电影感全身动作图。角色浮空、右手高举金笛，左手展开；身后巨大金青孔雀尾状光翼展开，青绿与金色径向光束冲天；三鸟齐全（左下金青凤凰、右上绿紫凤、右下白粉鸾鹤）；紫金渐变长裙+白帔帛翻飞，周身金色音符、青绿螺旋光纹、如意云纹漂浮。对建模最有用：特效配色比例（青绿主光+金光束+紫点缀）与"凤尾展开"的最大宽度参考。

**character-state-spatial-art/（状态空间行为图，均为 Q 版 chibi 形象+桌面场景，注意与正稿比例不同，且均带狐尾）**

5. **A_concept_art_illustration_sho_…08-07-20（摸鱼/窥屏，1024×1024）**：Windows 桌面+代码编辑器窗口前，Q 版角色只露出头顶到鼻尖"趴屏"窥视：黑青发、狐耳带金铃、青色大眼、耳侧青绿挑染，表情略委屈/无辜。对应"摸鱼检测"状态的桌面摆放位置参考（窗口下缘探出）。

6. **A_concept_art_illustration_sho_…08-07-30（六格状态图，1216×832）**：标注 FOCUS MODE（趴窗沿窥视，琥珀色眼）、SLACK MODE（坐地 wink）、CODING MODE（站立抱臂于代码窗口旁）等六格：趴地睡觉（带 Zzz 与多条狐尾）、端坐椅上、行走姿态。Q 版服装为青白渐变汉服+大袖，青绿狐尾明确出现。对建模最有用：各监控状态对应的姿态/位置枚举。

7. **A_detailed_concept_art_showing_…08-07-30（五格桌面行为，1216×832）**：更多桌面交互姿态：趴屏上沿偷看（琥珀眼特写）、趴地沮丧+端坐、坐在播放器窗口上沿（裸足垂下，脚边有鼠标光标与光环）、抱膝坐姿、蜷缩睡眠（星星粒子）。对建模最有用：角色与窗口/光标的尺寸比与"坐窗沿"这一桌面锚点行为。

8. **A_cinematic_concept_art_of_a_f_…08-07-50（电影感桌面爬行，1216×832）**：暗色桌面壁纸上，Q 版角色全身趴伏在"桌面地面"向镜头爬行，全身青绿配色（此图发色偏亮青、瞳色偏粉紫，与正稿有出入），金边广袖、白袜、发髻金铃，背后 Edge 窗口与桌面图标，周身青绿光尘。对建模最有用：暗背景下 Ethereal Glow 自发光+青绿 rim 光的目标观感。

---

## 附：实现要点速查（Three.js 拼装近似）

- **LOD**：LOD0 48K tris（面 12.5K/发 14K/体 13K/服 11.5K/鸟 4K/饰 2K/特效 1K）；LOD1 28K（GPU<60fps）；LOD2 15K（<30fps）；LOD3 5K（<15fps，发变 sprite）；LOD4 全 sprite
- **头发**：100 hair cards（Zone A 黑青 40 / B 渐变 30 / C 青绿尖 30；4 层：内剪影 15/主体 50/细节 25/rim 辉光 10）；SpringBone 主发 stiffness 0.5/gravity 0.5/drag 0.5/bounce 0.25
- **映射路径**（文档第 5 节）：材质→ShaderMaterial uniforms；BlendShape→VRM BlendShapeProxy weights；SpringBone→VRM SpringBone settings；光照→Three.js Light objects；后处理→EffectComposer passes
- **LING 专属扩展（P1）**：Slot 15-20、Ethereal Glow SSS 扩展、双色虹膜 shader、SpringBone 负重力、愿望感应系统、17 根额外骨骼；Sparkle Pass/Divine Bird Trail 为 P2
- **规格缺口提示**：①无尾巴骨骼/材质（概念图 Q 版有尾巴，需决策）；②无详细身体围度尺寸；③80 根基础骨骼未逐根命名（按标准 VRM humanoid 处理）；④文档标题写"14 材质槽位"但实际定义 20 个