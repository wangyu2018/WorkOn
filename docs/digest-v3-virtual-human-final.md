全文已读完（3388 行）。以下是实现级技术摘要。

---

# WorkOn 虚拟人规格 v3.0 — 实现级技术摘要

> 源文件：`workon-design-spec-v3.0-virtual-human-final.md`（唯一权威虚拟人规格，取代 v2.0–v2.5 虚拟人部分；UI/报表/规划/日历规格仍以 v2.x 有效）。
> 注意：文档明确给出骨骼总数为 **约 80–90 根**（非 97 根），见 §1.3。文档中眼球追踪范围出现两处不一致（±30°/±15° vs ±30°/±20°），均原样保留并标注。

---

## 1. 3D 建模规格（Part 1.1）

### 1.1 LOD 分级面数表

| LOD | 总面数（Triangles) | 适用场景 | 说明 |
|---|---|---|---|
| LOD0 | 45,000–60,000 | 近景/桌搭预览/高质量渲染 | 全细节，含面部微表情网格 |
| LOD1 | 25,000–35,000 | 桌面常驻显示（默认） | 面部保留关键 blendshape |
| LOD2 | 12,000–18,000 | 远景/性能降级 medium | 简化面部，保留基础表情 |
| LOD3 | 5,000–8,000 | 性能降级 minimal | 极简，3 级表情（开心/中性/不开心） |
| LOD4 | 静态 PNG sprite | 性能降级 critical | 不渲染 3D，仅 sprite 切换 |

LOD0 面数分配：
```
面部（含眼球/口腔/牙齿/舌）：12,000–15,000 tris
头发（hair cards）：          10,000–15,000 tris
身体（躯干/四肢/手）：        12,000–18,000 tris
服装（外套/内衬/配饰）：       8,000–12,000 tris
小计：42,000–60,000 tris
```

### 1.2 拓扑规格
- 面部：沿肌肉走向布线；眼周环形 3 层；嘴周环形 3 层；眉脊独立拓扑区；鼻翼/面颊可变形区；下巴独立变形区（张嘴联动）；耳朵标准 6 边形拓扑（非关键变形区）。
- 身体：肩部 4 段布线；肘/膝 3 段；腰部 3 段；手部每指 3 段关节 + 拇指额外旋转段；颈部 3 段。
- UV：单张 UV Atlas — 2048×2048(LOD0) / 1024×1024(LOD1-2) / 512×512(LOD3)；面部独立岛（最大面积、无缝隙）/头发/身体/服装各独立岛；UV 利用率 > 75%。

### 1.3 VRM 合规
- 格式：VRM 1.0（首选）/ VRM 0.x（兼容）；遵循 VRM humanoid bone mapping、ARKit 52 BlendShape 命名、SpringBone 配置、Material slots 规范。
- 加载库：`@pixiv/three-vrm`；用户可导入任意 VRM 角色。

---

## 2. PBR 材质系统（Part 1.2）

### 2.1 材质通道

| 通道 | 分辨率 | 格式 | 用途 |
|---|---|---|---|
| BaseColor (Albedo) | 2048² | sRGB PNG | 基础色+手绘细节 |
| Normal | 2048² | Linear PNG | 毛孔/布料/发丝 |
| Roughness | 2048² | Linear PNG | 皮肤 0.4–0.6 / 金属 0.1 / 布料 0.7–0.9 |
| Metallic | 2048² | Linear PNG | 几乎全黑，仅配饰/眼镜框局部 |
| AO | 2048² | Linear PNG | 面部/衣物褶皱阴影 |
| Emission | 2048² | sRGB PNG | 眼镜反光/配饰 LED/状态光环粒子 |
| Toon Ramp | 256×1 | sRGB PNG | 卡通渐变（4 级色阶） |

### 2.2 Toon+PBR 混合着色
```
finalColor = mix(PBR_color, Toon_color, toonWeight)
PBR_color = Cook-Torrance BRDF
Toon_color = ToonShading(N·L, toonRamp)   // 4级色阶：亮/中亮/中暗/暗

toonWeight（每材质可配）：
  皮肤 0.7 | 头发 0.6 | 布料 0.5 | 金属/玻璃 0.1 | 眼睛 0.3

描边：法线外扩法，背面网格沿法线外扩 0.02–0.05 单位；
      描边颜色 = BaseColor × 0.3；宽度随距离调整；可在设置关闭。
阴影：实时 shadow mapping（自身）+ 预烘焙 AO + 实时 SSAO（环境）。
```

### 2.3 材质分组（14 slots）
```
0 面部皮肤(SSS) | 1 身体皮肤(SSS) | 2 眼球-巩膜 | 3 眼球-虹膜+瞳孔(折射)
4 眼球-角膜(透明折射) | 5 口腔(牙+龈+舌) | 6 头发-主层 | 7 头发-高光层
8 服装-主面料 | 9 服装-配饰 | 10 眼镜-镜片 | 11 眼镜-镜框 | 12 鞋子
13 状态光环粒子(自发光,独立材质)
```

---

## 3. 骨骼系统（Part 1.3）— 总计约 80–90 根

### 3.1 层级
```
Root
└── Hips
    ├── Spine → Chest → UpperChest
    │   ├── Neck → Head
    │   │   ├── LeftEye / RightEye（眼球控制）
    │   │   ├── Jaw（下颌——张嘴/说话）
    │   │   └── 面部扩展骨骼（12+ 表情驱动骨骼）
    │   ├── LeftShoulder → LeftUpperArm → LeftLowerArm → LeftHand
    │   │   └── 左手指骨（5指 × 3段 + 拇指旋转段 = 16骨骼）
    │   └── RightShoulder → RightUpperArm → RightLowerArm → RightHand
    │       └── 右手指骨（同上 16）
    │   └── Spine1-3（椎骨微调）
    ├── LeftUpperLeg → LeftLowerLeg → LeftFoot → LeftToe
    └── RightUpperLeg → RightLowerLeg → RightFoot → RightToe

扩展骨骼（WorkOn 自定义）：
  头发控制骨骼 8–12 根（前发/侧发/后发，SpringBone）
  服装控制骨骼 4–6 根（衣摆/袖口/领口）
  光环控制骨骼 1 根
```

### 3.2 权重绑定
- 面部：每顶点最多 4 骨骼影响，平滑过渡；关节区（肩/肘/膝/髋）：双骨骼 50/50；躯干：3 骨骼（Spine/Chest/UpperChest）渐进；手指/头发：单骨骼。
- 权重归一化：顶点权重和 = 1.0；最大骨骼影响数/顶点 = 4（GPU skinning 标准）。

---

## 4. ARKit 52 BlendShape（Part 1.4）

### 4.1 完整清单（52 个）
- 眉部 8（文档列 6 项名称）：`browInnerUp`, `browInnerDown`, `browOuterUpLeft/Right`, `browOuterDownLeft/Right`
- 眼部 12：`eyeLookInLeft/Right`, `eyeLookOutLeft/Right`, `eyeLookUpLeft/Right`, `eyeLookDownLeft/Right`, `eyeBlinkLeft/Right`, `eyeSquintLeft/Right`, `eyeWideLeft/Right`（注：此处为 18 个名称，文档标题写 12；实现以 ARKit 标准为准）
- 脸颊 4：`cheekSquintLeft/Right`, `cheekPuff`, `cheekSuck`
- 鼻部 2：`noseSneerLeft/Right`
- 嘴部 20：`mouthLeft/Right`, `mouthSmileLeft/Right`, `mouthFrownLeft/Right`, `mouthPressLeft/Right`, `mouthShrugLower/Upper`, `mouthClose`, `mouthFunnel`, `mouthPucker`, `mouthUpperUpLeft/Right`, `mouthLowerDownLeft/Right`, `mouthStretchLeft/Right`, `mouthRollLower/Upper`, `mouthDimpleLeft/Right`, `mouthApex`
- 下颌 2：`jawOpen`, `jawForward`
- 舌头 4：`tongueOut/Left/Right/Up/Down`（文档写 4 个但列 5 名，以 ARKit 标准 `tongueOut` 为主）

> 注：Part 3/5 代码中使用了 `browDown_L/R`、`eyeClose_L/R`、`chinRaiserLower` 等别名（对应 `browInnerDown`、`eyeBlinkLeft/Right` 等），实现时需做名称映射表。

### 4.2 30 个核心表情预设（权重原样保留）
```
// 5基础
neutral     全部=0
happy       mouthSmileL/R=0.7, cheekSquintL/R=0.4, eyeSquintL/R=0.3
angry       browInnerDown=0.8, noseSneerL/R=0.3, mouthPressL/R=0.5, eyeSquintL/R=0.2
sad         browOuterUpL/R=0.4, mouthFrownL/R=0.6, mouthShrugLower=0.3
surprised   eyeWideL/R=0.8, browInnerUp=0.6, jawOpen=0.3, mouthFunnel=0.2
// 工作状态
focus       browInnerDown=0.3, mouthPressL/R=0.3, eyeSquintL/R=0.15
coding      focus基础 + eyeSquintL/R=0.25
writing     browInnerUp=0.2, mouthPressLeft=0.4, mouthShrugLower=0.15
thinking    browInnerUp=0.3, mouthPressLeft=0.4, eyeSquintLeft=0.2, cheekSuck=0.15
slack       eyeBlinkL/R=0.4, mouthFrownL/R=0.3, jawForward=0.2
meeting     mouthSmileL/R=0.4, eyeSquintL/R=0.15
// 情感
proud       mouthSmileL/R=0.5, browInnerUp=0.2, Head微抬头
embarrassed eyeBlinkL/R=0.3, mouthSmileL/R=0.3, cheekPuff=0.2
mocking     noseSneerLeft=0.4, mouthSmileRight=0.3, browOuterUpLeft=0.3
worried     browInnerUp=0.5, browOuterDownL/R=0.3, mouthPressL/R=0.3
anxious     browInnerDown=0.4, browInnerUp=0.3, eyeWideL/R=0.2
content     mouthSmileL/R=0.4, eyeSquintL/R=0.3
sleepy      eyeBlinkL/R=0.6, mouthShrugLower=0.2, jawOpen=0.1
// 交互
dragged     eyeWideL/R=0.6, mouthFunnel=0.3, browInnerUp=0.5
clicked_face cheekPuff=0.3, mouthSmileL/R=0.2, eyeBlinkL/R=0.2
greeting    mouthSmileL/R=0.6, eyeSquintL/R=0.2, Head微点头
celebrating eyeWideL/R=0.5, mouthStretchL/R=0.7, browInnerUp=0.4
// viseme 视素（TTS同步）
viseme_rest jawOpen=0, mouth全0
viseme_AA   jawOpen=0.5, mouthFunnel=0.2
viseme_EE   mouthStretchL/R=0.4, jawOpen=0.1
viseme_OO   mouthPucker=0.6, mouthFunnel=0.3, jawOpen=0.1
viseme_OH   jawOpen=0.4, mouthFunnel=0.4
viseme_RR   mouthRollUpper/Lower=0.3, jawOpen=0.05
viseme_SS   mouthStretchL/R=0.2, jawOpen=0.05
viseme_TH   tongueOut=0.2, jawOpen=0.15
viseme_FF   mouthPressL/R=0.3
viseme_DD   tongueUp=0.3, jawOpen=0.1
```

### 4.3 表情过渡 / 眨眼 / 眼球追踪
- 过渡：ease-in-out；0.2s（快速变化）/ 0.5s（缓慢情感）；支持 2 预设按权重混合（如 focus(0.7)+worried(0.3)）。
- 自动眨眼：间隔 4–8s 随机（专注 8–12s，摸鱼 3–5s）；时长 0.15s（闭 0.075s + 睁 0.075s）；说话时不眨眼。
- 眼球追踪：跟随鼠标；延迟 0.3s；范围水平 ±30°、垂直 ±15°（§1.4.3）；深度专注锁定屏幕中心；摸鱼随机游移；说话看向用户。
- §1.6 另载：眼球骨骼旋转范围 水平 ±30°、垂直 ±20°；追踪模式 A.鼠标 B.屏幕中心 C.用户面部 D.随机游移；瞳孔缩放：专注 ×0.85 / 兴奋 ×1.15 / 惊吓 ×1.3。

---

## 5. 毛发 / 眼睛 / SSS / 布料（Part 1.5–1.8）+ GLSL Shader（Part 6.3）

### 5.1 头发（Hair Cards）
- 数量：LOD0 80–120 / LOD1 50–70 / LOD2 30–40 / LOD3 15–20 cards。
- 贴图：BaseColor（发根深→发梢浅渐变）/ Alpha（边缘渐变）/ Normal。
- 分层：L1 内层（贴头皮填充）/ L2 主层 / L3 外层（飘动）/ L4 高光层。
- SpringBone：stiffness 0.3–0.6（前硬后软），gravityPower 0.02–0.05，dragForce 0.4–0.6；头部球形碰撞体；风：环境微风 / 移动反向风 / 拖拽强风。

### 5.2 眼睛 6 层
- L1 巩膜：toonWeight=0.5，微黄白，微血管纹理。
- L2 虹膜：toonWeight=0.2；角色色（ARIA紫/LUNA粉/KIRA红/ZEN绿/SHIN银——注意与 Part 2 各角色实际虹膜色不同，以 Part 2 为准）；放射状 Normal；微弱 Emission；Roughness 0.15。
- L3 瞳孔：纯黑+微折射；可缩放（0.85×/1.15×/1.3×）。
- L4 角膜：透明折射，Roughness=0.05。
- L5 高光点：自发光白点，虹膜左上主光+右下辅光；惊讶变小/开心变大。
- L6 上眼睑阴影：半透明黑渐变。

### 5.3 皮肤 SSS
```
散射颜色 #ff8866 | 散射半径 0.012 | 散射强度 0.4
细节：毛孔 Normal(LOD0)、瑕疵贴图、T区高光强/U区弱
腮红（独立层，动态透明度）：害羞 0→0.6(0.3s) | 开心 0→0.3 | 摸鱼被抓 0→0.8 | 默认 0.1
```

### 5.4 布料
- SpringBone：stiffness 0.2，gravityPower 0.04，dragForce 0.5；褶皱预烘焙 Normal（不实时计算）。

### 5.5 GLSL Shader（Part 6.3，完整保留）

`workon_toon_pbr.vert`：
```glsl
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
```

`workon_toon_pbr.frag`：
```glsl
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
```

其他 shader 文件（未给代码，仅占位）：`workon_sss_skin.frag.glsl`、`workon_eye_refraction.frag.glsl`、`workon_hair_anisotropic.frag.glsl`。

---

## 6. 光照与后处理（Part 1.9–1.13）

### 6.1 5 光源系统
```
1. Key Light (Directional)：左上前→右下后 45° | #fff5e6 | 1.2 | shadow mapping 2048
2. Fill Light (Directional)：右上→左下 | #cce0ff | 0.4
3. Rim Light (Directional)：正后→正前(逆光) | 随状态变化 | 0.8
4. HemisphereLight：天顶 #1a2030 / 地面 #2a2520 | 0.3
5. 状态 PointLight（脚下）：同步轮廓光色 | 0.5 | 脉动 1.5s

状态光照色彩映射（§1.9）：
focus=#6bd8a8 / coding=#4a9eff / writing=#9b8cff / slack=#ffb86b
meeting=#ffd700 / idle=#6a5acd / break=#98d982 / aidev=#c44eff / debugging=#ff6b6b
celebrating=#ffd700+彩虹粒子；状态切换 0.5s 色彩 lerp。
```
> 注：§1.9 的状态色与 Part 3 各状态 status_light 色值不同（如 coding: #4a9eff vs #00E676）。Part 7.5 明确"以 Part 3 status_light 为准"。

### 6.2 后处理链（按顺序）
```
1. Bloom      阈值0.8 强度0.3 半径0.4
2. SSAO       半径0.1 强度0.5
3. Color Grading  暖色偏移, 对比度+5%, 饱和度-5%
4. Vignette   强度0.15 半径0.8
5. Film Grain 强度0.02
6. FXAA
降级：full=全部 / medium=去SSAO+FilmGrain / minimal=仅FXAA / critical=无
```

### 6.3 LOD 切换
- 屏幕占比：>200px→LOD0 / 100–200px→LOD1（默认） / 60–100px→LOD2 / <60px→LOD3；资源不足直接降级；切换 0.3s 交叉溶解；设置可手动覆盖。

### 6.4 动画 3 层混合
```
Layer0 Base Pose：全身基础姿态，权重100%，过渡0.4s
Layer1 State Action：状态上半身动作，权重70%，过渡0.3s
Layer2 Expression：面部52 BlendShape，权重100%，过渡0.2s
剪辑清单：
  基础：idle_stand/idle_sit/walk/sit_down/stand_up/drag_lift/drag_release/sleep/wake_up
  状态：coding/writing/slack/meeting/thinking/drinking/eating/presenting/sleeping/celebrating_action
  微行为(程序化)：blink/eye_track/head_micro_nod/hair_wind_sway/breathing/idle_glance/
    hair_tuck/glasses_adjust/deep_breath/stretch/distant_gaze/scratch_head/drink_water/yawn/
    mouse_follow/wind_response
```

### 6.5 性能预算（LOD1）
- CPU：虚拟人 <5%（日常）/<8%（活跃），总 WorkOn <10%；GPU：虚拟人 <15%、后处理 <5%、总 <20%；RAM：模型 ~50MB / 动画 ~20MB / 粒子 ~10MB / 总 <200MB；帧率：LOD0-1 目标 30fps/最低 24fps，LOD2 24fps，LOD3 15fps。
- 优化：Frustum Culling / Animation Culling / 粒子池化 / KTX2+BC7 压缩 / InstancedMesh / LOD2-3 去 SSS+折射+Bloom / 静止 15fps、移动 30fps 按需渲染。

---

## 7. 五角色完整设计（Part 2）

### 7.1 总览

| 角色 | 代号 | 性格 | 肤色 | 身高/头身 | 嗓音 |
|---|---|---|---|---|---|
| ARIA | ICE-01 | 冷静·理性·克制 | #E8E0F0 | 170cm/8头身 | 低频清冷不扬尾 |
| LUNA | WARM-02 | 温暖·共情·柔韧 | #F0E4D8 | 160cm/7头身 | 中频柔和鼻腔共鸣 |
| KIRA | FIRE-03 | 傲娇·敏锐·不服输 | #F5E0D0 | 165cm/7.5头身 | 高频干脆短句 |
| ZEN | EARTH-04 | 稳重·禅意·老灵魂 | #D8C8B8 | 175cm/8头身 | 低频缓慢句尾下沉 |
| SHIN | STEEL-05 | 严格·精英·不容失误 | #E0D8E8 | 172cm/8头身 | 中频精确字字清晰 |

### 7.2 ARIA（冰蓝理性者）
- 发色：冰蓝渐变 根 #B0C4DE → 梢 #E0F0FF，直发中长，90 hair cards；SpringBone stiffness 0.7, gravity 0.4。虹膜 #6CA6CD；睫毛 30 根微外翘。默认表情：嘴角下弯 2 度。
- 体型：肩 38 / 腰 24 / 臀 36 cm。服装：深海军蓝高领 #1A1A2E 银拉链 + 黑裤 #0D0D0D + 左腕银表 + 黑色牛津鞋。
- 面数：面 13K / 发 12K(90 cards) / 体 14K / 服 8K。
- 材质槽关键值：01_Skin scatterRadius=8mm, #E8E0F0→#C08090；02 pore 0.3x, roughness var 0.05；03_Hair toonWeight=0.6, anisotropic=0.8；04_Hair_Inner #D0E4FF, trans=0.3, rimBoost=1.5；05_Iris #6CA6CD, metal=0.2, clearcoat=0.8；06_Sclera #F0F0F5, rough=0.3；07_Cornea clearcoat=1.0, IOR=1.38；08_Top #1A1A2E rough=0.5 toon=0.4；09_Pants #0D0D0D rough=0.4；10_Shoes #0D0D0D rough=0.3 metal=0.1；11_Watch #C0C0C0 metal=0.9 rough=0.2；12_Zipper #E0E0E0 metal=0.95 rough=0.15；13_Teeth #F8F8F0 rough=0.3 SSS=2mm；14_Mouth #CC3030 rough=0.5。
- 骨骼默认：spine_01 (-2,0,0)；neck_01 (-3,0,0)；shoulder_L/R (0,-5,0)；全身关节接近 0 度。
- PAD：P=0.3/A=0.4/D=0.85。行为权重：摸鱼 direct=0.9 humor=0.1 guilt=0.7；进度 data_first=0.95；下班 precise_time=0.9；休息 medical_fact=0.8。
- 对话：陈述句 12–18 字，"。"结尾，禁"宝宝/亲爱的/乖"和感叹号；P>0.8 时允许一次"还不错。"
- 站坐：coding 站 0.85 | slack 坐 0.9 | meeting 站 0.7 | idle 站 0.8。
- 微行为/分钟：blink 18 | eye_track 0.4 | hair_tuck 0.1 | watch_check 0.3 | distant_gaze 0.2 | deep_breath 0.15。

### 7.3 LUNA（柔粉共情者）
- 发色 #F8BBD0→#F0D0E0，100 cards；SpringBone stiffness 0.4, gravity 0.6, bounce 0.3。虹膜 #C89050；睫毛 35 根微内翘。默认微笑 +4 度，眼睛多开 10%。体型 34/26/38。
- 服装：奶油针织衫 #F5F0E8 + 棕背带 + 海军蓝宽腿裤 #2A2A40 + 米色一脚蹬；花发簪 #F8BBD0 + 细金手链。
- 面数：面 12K / 发 14K / 体 12K / 服 10K。材质：01 scatterRadius=10mm #F0E4D8→#D06060；02 pore 0.6x；03 toonWeight=0.5；04 #FFF0F5 trans=0.4；05 #C89050 clearcoat=0.6；07 IOR=1.36；08 #F5F0E8 rough=0.7 toon=0.5；09 #2A2A40；12_Bracelet #D4AF37 metal=0.9。
- 骨骼：spine 前倾 3 度 | neck 微收 2 度 | shoulder 内收 8 度。
- PAD：P=0.7/A=0.5/D=0.35。行为：摸鱼 gentle 0.8 | 进度 emotion_first 0.6 | 下班 warm_suggestion 0.7 | 休息 caring 0.9。对话 8–14 字，"呢/呀/♥"，句尾"~"，禁"必须/命令/不准"。
- 站坐：coding 坐 0.7 | slack 坐 0.5 | meeting 坐 0.8 | idle 坐 0.6。
- 微行为：blink 22 | eye_track 0.8 | hair_tuck 0.5 | smile_micro 0.4 | deep_breath 0.25。

### 7.4 KIRA（火红傲娇者）
- 发色 #E04040→#F06060 波波短发，70 cards，内层 #F0A040；stiffness 0.8, gravity 0.3, bounce 0.5。虹膜 #C05030；睫毛 40 根夸张外翘。默认微撇嘴 +2 度不对称，眉挑 5 度。体型 36/25/35。
- 服装：黑皮夹克 #1A1A1A（橙内衬 #F0A040）+ 白T #F0F0F0 + 牛仔短裤 #404060 + 黑橙 chunky 运动鞋；橙耳钉+黑腕带L+橙挂绳R。
- 面数：面 12.5K / 发 9K / 体 13K / 服 12K。材质：01 scatterRadius=7mm #F5E0D0→#C07070；02 pore 0.7x；03 toonWeight=0.65；04 #F0A040 rimBoost=2.0；05 #C05030 clearcoat=0.7；07 IOR=1.40；08_Jacket #1A1A1A rough=0.3 toon=0.35；12_Earrings #F0A040 metal=0.7。
- 骨骼：spine 微侧倾 3 度 | neck 偏 2 度 | shoulder 展 -8 度 | hip 微侧 3 度。
- PAD：P=0.45/A=0.7/D=0.75。行为：摸鱼 mock 0.6 | 进度 blunt 0.7 | 下班 demand 0.5 | 休息 mock_care 0.7。对话 6–12 字短句+反问，"啧/哼/才不是"，句尾"！"，禁"♥/呢/呀"。
- 站坐：coding 站 0.6 | slack 站 0.8 | meeting 站 0.5 | idle 站 0.7。
- 微行为：blink 15 | hair_flip 0.4 | arm_cross 0.3 | foot_tap 0.2 | jacket_zip 0.2。

### 7.5 ZEN（银灰禅意者，男）
- 发色 #C0C0C0→#A0A0A0 短卷，60 cards，内层 #D0D0C0；stiffness 0.9, gravity 0.2, bounce 0.1。虹膜 #604020；睫毛 25 根短直。默认宁静 0 度，眼睛少开 5%。体型 44/32/38。
- 服装：改良汉服上衣 #404020 + 慢跑裤 #303030 + 运动鞋 #606060；木珠手串 #8B4513 + 细链项链 #A0A0A0。
- 面数：面 11K / 发 7.5K / 体 16K / 服 9K。材质：01 scatterRadius=12mm #D8C8B8→#B05040；02 pore 0.8x；03 toonWeight=0.4；05 #604020 clearcoat=0.5；08 #404020 toon=0.45；11_Beads #8B4513 rough=0.7。
- 骨骼：spine/neck/shoulder 全 0 度（中正无偏）。
- PAD：P=0.55/A=0.25/D=0.65。行为：摸鱼 wisdom_quote 0.6 | 进度 perspective 0.7 | 下班 philosophical 0.5 | 休息 body_wisdom 0.8。对话 10–16 字比喻+短哲言，偶用"……"，禁"必须/命令/快/赶紧"。
- 站坐：coding 坐 0.5 | slack 坐 0.7 | meeting 坐 0.6 | idle 站 0.5。
- 微行为：blink 20 | deep_breath 0.4 | bead_touch 0.2 | distant_gaze 0.5 | neck_stretch 0.15。

### 7.6 SHIN（银白精英者，男）
- 发色 #E8E8F0→#F0F0F8 低马尾束发，75 cards，内层 #F0F0F8；stiffness 0.85, gravity 0.3, bounce 0.15。虹膜 #708090；睫毛 20 根短无翘。默认精确 0 度。体型 40/28/34。
- 服装：深炭西装 #202020 + 袋巾 #C0C0C0 + 白衬衫 #F0F0F0 + 黑裤 #0A0A0A + 黑牛津鞋 #0A0A0A；银领带夹 #C0C0C0 + 银扣皮带。
- 面数：面 12.5K / 发 9K / 体 13K / 服 11K。材质：01 scatterRadius=5mm #E0D8E8→#A07080；02 pore 0.2x, roughness var 0.03；03 toonWeight=0.55 anisotropic=0.7；05 #708090 metal=0.25 clearcoat=0.75；07 IOR=1.42；08 #202020 rough=0.35；10 #0A0A0A metal=0.15；11/12 #C0C0C0 metal=0.95；13_Teeth #F8F8F8。
- 骨骼：spine/spine02 0 度 | neck 微抬 -2 度 | shoulder 展 -3 度 | 全身 ±1 度精确。
- PAD：P=0.35/A=0.45/D=0.9。行为：摸鱼 order 0.85 | 进度 KPI 0.9 | 下班 deadline 0.8 | 休息 efficiency 0.85。对话 8–14 字命令+数据，零语气词零感叹号，禁情感词和比喻。
- 站坐：coding 站 0.75 | slack 站 0.6 | meeting 站 0.65 | idle 站 0.8。
- 微行为：blink 16 | tie_adjust 0.25 | watch_check 0.4 | straighten_posture 0.3 | deep_breath 0.1。

### 7.7 角色切换系统
- 流程：淡出（1.0→0.0, 0.8s, ease-in) → 共享骨骼姿态保持/材质切换 → 淡入（0→1.0, 1.0s, ease-out) → 入场 signature pose 1.5s。
- 方案A（推荐）：5 套独立 VRM + 统一 humanoid 骨骼命名；RAM ~250MB 需懒加载。方案B（降级）：1 基础模型 + 50–80 Morph Target，切换 0.6s，RAM ~50MB。LOD2-3 用方案B。
- 懒加载：启动仅载上次角色；切换提前 2s 预载；打开角色面板预载全部；hover 1s 预载；定时切换提前 30s 预载；LOD4 仅 sprite。
- 切换三阶段：Phase1 (0–0.8s) exit pose + 消散特效（ARIA 冰蓝光点/LUNA 粉花瓣/KIRA 火焰/ZEN 烟雾/SHIN 线条）；Phase2 (0.8–1.8s) entrance pose；Phase3 (1.8–3.3s) signature pose→idle。

---

## 8. 状态动画骨骼级参数（Part 3）

### 8.1 状态分类（16 核心状态）
A 工作 8：coding/writing/thinking/meeting/presenting/AI_chat/AI_dev/designing；B 非工作 4：slack/eating/drinking/sleeping；C 过渡 2：idle/walking；D 特殊 2：drag_lift/forced_focus。

### 8.2 coding（完整示例，其余状态参照此结构）

**站立骨骼旋转（相对 idle_stand，度）**：
```
spine_01 (-5,0,0) | spine_02 (-3,0,0) | spine_03 (-2,0,0)
neck_01 (-8,0,0) | head (-5,2,0)
left_upper_arm (0,-30,-40) | left_lower_arm (-60,0,10) | left_hand (0,0,-15)
right_upper_arm (0,30,40)  | right_lower_arm (-60,0,-10) | right_hand (0,0,15)
left/right_upper_leg (0,0,0)
```
**坐下（相对 idle_sit）**：
```
spine_01 (-8,0,0) | spine_02 (-5,0,0) | spine_03 (-3,0,0) | neck_01 (-10,0,0) | head (-8,3,0)
left_upper_arm (0,-35,-45) | left_lower_arm (-70,0,15)
right_upper_arm (0,35,45)  | right_lower_arm (-70,0,-15)
```
**打字循环（3 帧，0.12s/frame，按实际打字速度 0.08–0.15s/frame 动态调整）**：
```
Frame A: left_hand (5,0,-20), right_hand (0,0,0)
Frame B: left_hand (0,0,0),   right_hand (5,0,20)
Frame C: left_hand (0,0,-10), right_hand (0,0,10)
```
**BlendShape**：
```
eyeSquint_L/R 0.15 | jawForward 0.05 | mouthFrown_L/R 0.1 | browInnerUp_L/R 0.08
browOuterDown_L/R 0.05 | eyeWide 0 | mouthSmile 0 | jawOpen 0.05 | tongueOut 0
频率性：每5s eyeSquint→0.25；每15s browInnerUp→0.15 + eyeLookDown→0.3；
       每30s mouthFrown→0 + mouthSmile→0.08（1.5s 回归）
```
**物理**：头发 stiffness +20%、damping +30%；衣服 stiffness +15%、damping +20%；呼吸 4.5s 周期（正常 3.8s）、幅度 0.5（正常 0.8）。
**光照**：key #F0F8FF/1.1/offset(0,+30,0)；fill #E0E0E8/0.4；rim #C0E0FF/0.7/offset(0,+20,+30)；ambient #E8F0F8/0.5；status #00E676/0.6。
**粒子**：①键盘微光：point_sprite，8–12 个，size 0.02–0.05，#C0E0FF，life 0.3–0.5s，随击键 1–2 粒/帧，手部上方 0.5–2cm，velocity (0,+0.1,0)，alpha 1→0 ease-out；②思考火花：browInnerUp>0.12 触发，3–5 个，size 0.03–0.06，#FFD700，life 0.8–1.2s，头顶 2–5cm，随机方向 speed 0.05–0.1。
**微行为/分钟**：head_micro_nod 0.3 | eye_track_mouse 0.15 | scratch_head 0.1 | stretch 0.05 | deep_breath 0.1 | yawn 0.02。
**角色差异**：
- ARIA：前倾 +3°，mouthFrown ×1.5，eyeSquint ×1.3，打字 fast(0.08s/f)，站 0.85
- LUNA：前倾 -2°，mouthSmile +0.05，eyeSquint ×0.8，medium(0.12s/f)，坐 0.7
- KIRA：前倾 +1°，smile/frown 每 10s 交替，fast，火花 #F0A040，站 0.6
- ZEN：前倾 -1°，jawForward=0，slow(0.15s/f)，火花 #90EE90，坐 0.5
- SHIN：前倾 +2°，mouthFrown ×2.0，eyeSquint ×1.5，very_fast(0.06s/f)，火花 #E0E0E0，站 0.75

### 8.3 slack
**站立骨骼**：
```
spine_01 (5,0,0) | spine_02 (3,0,0) | spine_03 (0,0,0) | neck_01 (3,0,0) | head (5,-5,0)
left_upper_arm (0,10,30) | left_lower_arm (-20,0,30) | left_hand (10,0,30)
right_upper_arm (0,20,10) | right_lower_arm (-30,0,0)
坐下：spine_01 (8,0,0) | spine_02 (5,0,0) | neck_01 (5,0,0) | head (8,-3,0)
手机翻转 2 帧循环 0.4s/frame（0.3–0.5s/frame）：
  A: left_hand (10,5,25) | B: left_hand (5,-5,35)
```
**BlendShape**：mouthSmile_L/R 0.25 | eyeSquint 0 | jawOpen 0.08 | browInnerUp 0 | cheekSquint_L/R 0.12 | eyeLookDown 0 | eyeLookUp_L/R 0.2；每 3s smile→0.35；每 8s smile→0.15 + frown→0.05（1s 回归）。
**物理**：头发 stiffness -30%、damping -20%；衣服 stiffness -25%、damping -15%；呼吸 3.3s、幅度 0.9（×1.15）。
**光照**：key #FFF0E0/0.85/offset(0,-20,0)；fill #F0E8D0/0.5；rim #FFE0C0/0.5；status #FF5252/0.7/pulse 0.5Hz。
**粒子**：①手机屏光 5–8 个，size 0.03–0.05，#F0F0F0，life 0.4–0.6s，0.8/s，左手上方 0.5–3cm，alpha 0.8→0；②懒散气泡 sphere_sprite 2–3 个，size 0.05–0.08，#FFE0C0 alpha 0.3，life 2–4s，0.3/s，头顶 3–8cm 慢漂移。
**角色差异**：ARIA smile×0.3、frown+0.1、站 0.9、无气泡；LUNA smile×1.5、cheekSquint×1.3、坐 0.5、气泡×2 色 #F8BBD0；KIRA smile×0.8、smile/frown 每 5s 交替、气泡×1.5 色 #F0A040、站 0.8；ZEN smile×0.7、deep_breath×2、气泡 #90EE90、坐 0.7；SHIN smile×0.2、frown×1.5、站 0.6、无气泡、status #FF1744。

### 8.4 其他状态速查（原样）
```
writing    spine前倾6° | neck低8° | 右手握笔微旋 | mouthFrown0.08 eyeSquint0.12 eyeLookDown0.3
           头发stiffness+10% 呼吸3.5s | key#F0F8FF rim#C0D8E0 status#00E676 | 墨粒 size0.02 #303030
thinking   spine0° head仰5° 左手托下巴 | browInnerUp0.2 eyeLookUp0.15 mouthFrown0.05 jawForward0.03
           stiffness+5% 呼吸4.0s | key#F8F0FF rim#E0C0FF status#7C4DFF | 思维火花5-8 #FFD700
meeting    spine直立 head正视 手臂微前 | mouthSmile0.15 eyeWide0.1 browInnerUp0.05
           呼吸3.8s | key#F0F0F0 rim#E0E0E0 status#2196F3 | 无粒子 | 点头0.5/min eye_track0.1 手势0.3/min
presenting spine直立+胸扩 手臂大展 | mouthSmile0.3 eyeWide0.15 jawOpen0.1 | 头发stiffness-20%
           key#FFF8E0 rim#FFC040 status#FFC107 | 展示光环10-15 #FFC107
AI_chat    spine中立 head微偏 手指向屏 | eyeWide0.15 mouthSmile0.12 browInnerUp0.1
           key#E0F0FF rim#80D0FF status#00BCD4 | 数据流粒子5 #00BCD4 线性运动
AI_dev     coding×0.8前倾+thinking×0.5抬头混合 | 表情/物理/光照按 0.9/0.1、0.7/0.3 混合
           coding键盘粒子+AI数据流同时存在
designing  spine前倾4° neck左右交替 右手拖拽手势 | eyeWide0.12 mouthSmile0.1 eyeLookDown0.2
           key#F0E8FF rim#D0A0FF status#E040FB | 画笔粒子 #E040FB
eating     坐姿 单手送嘴 head微低 | jawOpen 0.3→0→0.3循环 mouthSmile0.2 cheekSquint0.15
           头发stiffness-10% | key#FFF0D0 status#FF9800 | 食物碎片粒子
drinking   右手举杯 head微仰 颈后仰 | jawOpen0.05 mouthSmile0.08 | status#00E676 | 水珠 #80D0FF
sleeping   坐姿max后仰 head下垂 arms下垂 | eyeClose_L/R 1.0 jawOpen0.03 mouthSmile0.0
           头发stiffness-50% gravity-30% | key 0.4 status#9E9E9E | Z粒子2-3 #9E9E9E alpha0.3
```

### 8.5 idle
- 骨骼全 0（手臂自然下垂 upper_arm 0,0,20）；BlendShape 全 0，仅 auto_blink（4–6s）+ 低频 eye_track；呼吸 3.8s/0.8；status #607D8B。
- 微行为/分钟：blink 20 | eye_track 0.3 | idle_glance 0.2 | hair_wind_sway 0.1 | distant_gaze 0.3 | deep_breath 0.2 | stretch 0.03；签名行为：ARIA watch_check / LUNA hair_tuck / KIRA hair_flip / ZEN bead_touch / SHIN tie_adjust。

### 8.6 状态过渡
```
同大类：0.6s ease-in-out（BlendShape 0.4s）
跨大类：1.0s ease-in-out（BlendShape 0.5s）
紧急(any→forced_focus)：0.3s ease-out（BlendShape 0.2s）
回归(forced_focus→coding)：0.8s ease-in（BlendShape 0.6s）
拖拽(any→drag_lift)：0.15s linear（BlendShape 0.1s）
释放(drag_lift→idle)：0.5s ease-out-bounce（BlendShape 0.3s）
规则：BlendShape 线性 lerp；互斥组(smile/frown)先归0再升；
     eyeClose 固定 0.15s；jawOpen 0.2s；spine 链波浪式每节延迟 0.05s；
     手臂独立；腿部仅站↔坐 0.8s；新粒子过渡后 0.3s 开始，旧粒子立即停生自然消亡；
     status_light 0.2s 颜色过渡。
```

### 8.7 14 微行为参数表
```
1 blink        间隔4-6s随机 | eyeClose 0→1(0.05s)→0(0.1s) 总0.15s | ARIA18 LUNA22 KIRA15 ZEN20 SHIN16 /min
2 eye_track    鼠标移动>50px | 权重=clamp(offset/screen*0.3, -0.3, 0.3) | 0.2s ease-out
3 head_micro_nod  head (-3,0,0)→(0,0,0) 0.3s ease-in-out
4 hair_wind_sway  每10-20s | 风力向量(0.1,0,random) 施0.5-1.0s
5 breathing    spine_03 Y轴±1° | chest scaleY ±0.02 | 频率幅度随状态
6 idle_glance  每5-15s | eyeLook+head微偏 0.5s扫视→0.3s回归
7 hair_tuck    right_hand→头侧→下滑→归位 1.5s | mouthSmile 0.05
8 glasses_adjust hand→鼻梁→推→归位 0.8s
9 deep_breath  spine扩胸+chest scale+head微仰 | jawOpen0.05→eyeClose0.3 | 2.0s(0.5吸→1.0屏→0.5呼)
10 stretch     arms_up+spine_extend+head仰 | mouthOpen0.15 | 2.5s(1.0伸→0.5持→1.0回)
11 distant_gaze eyeLookUp0.2+eyeWide0.1+mouthFrown0.02 | head仰5° | 3-5s
12 scratch_head hand→头顶→抓循环→归位 | browInnerUp0.15+mouthFrown0.1 | 1.5-2.0s
13 drink_water 右手举杯→嘴→喝→放回 | jawOpen微循环+mouthSmile0.05 | 3.0s
14 yawn        jawOpen0.4+eyeClose0.8+mouthFrown0.05 | head微仰 | 2.0s(0.3张→1.0持→0.7闭)
```

---

## 9. 交互物理级参数（Part 4）

### 9.1 拖拽 3 阶段
**Grab（悬停 >0.3s + 左键）**：0.15s 抓取动画，被抓区域骨骼缩 0.5%；BlendShape eyeWide 0.3 + mouthOpen 0.15；全体 SpringBone stiffness×0.3 / damping×0.5 / gravity×0.0；被抓区域 stiffness×0.1 + locked=true；cursor=grabbing；脚下阴影 opacity 0→0.3。台词：ARIA"——不要碰。"/LUNA"呀~被抓住了！"/KIRA"啧！放手！"/ZEN"嗯？"/SHIN"停止。"

**Drag**：位置=鼠标实时跟随；SpringBone stiffness×0.2、gravity×0.0、externalForce=mouseVelocity×0.5、inertia_enabled=true；spine_01 朝拖向 5°、neck_01 反向 3°、head 反向 5° + mouthFrown 0.2 + eyeSquint 0.15。角色差异：ARIA frown×1.5+eyeWide0.1；LUNA smile0.1；KIRA frown×2.0+jawOpen0.1；ZEN frown×0.5；SHIN frown×1.8+browDown×1.5。惯性：头发延迟 0.3s 跟随、停止后续飘 0.5s、变向延迟 0.2s；衣摆同头发但延迟 0.15s。每 10s 台词（SHIN："即刻停止拖拽行为。效率损失 12%。"）。

**Release（0.5s ease-out-bounce）**：
- PhaseA (0–0.15s)：gravity×1.0 恢复，stiffness×0.8，下落加速度 9.8cm/s（视觉 3–5cm）。
- PhaseB (0.15–0.35s)：着地 scale_y 压至 0.92（0.05s 恢复），SpringBone 向上反弹，头发向上弹起 0.3s 归位。
- PhaseC (0.35–0.5s)：stiffness/damping×1.0，scale_y 1.0，BlendShape 0.4s 回归。
- 弹跳次数：<50px 1 次 / 50–200px 2 次 / >200px 3 次；每次高度 = 前次 × 0.4。

### 9.2 8 区域点击
区域：HEAD / FACE / CHEST / LEFT_ARM / RIGHT_ARM / LEFT_HAND / RIGHT_HAND / LOWER_BODY（基于 VRM 骨骼 Box3 映射）。
- HEAD：eyeClose 0.8(0.15s)→eyeWide 0.3；head 偏向点击 5°；头发受冲击偏移。
- FACE：cheekSquint 0.5 + mouthSmile 0.15；head 偏 8°；LUNA cheekSquint×1.5+blush；KIRA frown×2。
- CHEST：spine_03 偏 3°；mouthFrown 0.2；ARIA/SHIN frown×2。
- 左右臂：upper_arm 抬 10°；eyeLookLeft/Right 0.2。
- 左右手：手指拳→展 0.3s→收回；mouthSmile 0.1。
- LOWER_BODY：腿抬 15°；mouthSmile 0.05。
- 总时长 0.6s（0.2 反应+0.4 回归）；同区域 1s 内不重复触发；连续点 3 次触发特殊反应。

### 9.3 5 级鼠标联动
```
L0 无联动(P0深专注)：eye_track=0；条件 连续工作>20min+P0
L1 轻微(P1-P3)：0.2/min 仅眼球；coding中段/meeting/writing
L2 中等(P4-P6)：0.5/min head±3° 指向0.2/min；idle/designing/AI_chat
L3 活跃(P7-P8)：0.8/min head±8° spine±3° 指向0.4/min；slack/频繁切换
L4 主动拦截(P9)：走向鼠标 3cm/s；继续摸鱼>5min → 屏幕遮挡
回归：结束2s后走回原位 2cm/s
```

### 9.4 4 级屏幕遮挡
```
L1 提醒气泡(0-5min)：Electron overlay opacity0.05 | 80×80px圆泡 rgba(0,0,0,0.05)
   头上方20px | scale0→1 0.3s→3s显示→fade0.5s | 每2min一次
   气泡色：ARIA rgba(100,166,205,0.05) LUNA rgba(248,187,208,0.05) KIRA rgba(240,160,64,0.05)
          ZEN rgba(144,238,144,0.05) SHIN rgba(112,128,144,0.05)
L2 渐变雾气(5-15min)：radial-gradient(circle at [vh_pos], rgba(color,0.15) 0%, rgba(color,0.02) 60%, transparent 100%)
   覆盖40%屏 | 扩散2s→保持5s→回归后2s消退
L3 走动遮挡(15-30min)：右下→屏幕中央 1cm/s | browDown0.5+mouthFrown0.5 | 占屏15-25%
   回归：切工作窗口→走回右下角2s
L4 进度锁定屏(>30min)：rgba(0,0,0,0.6)+角色大图400×600px
   "今日进度45% | 预估完成时间22:30" | 按钮：继续工作/休息10min/关闭(二次确认,5min后回L1)
```

---

## 10. 情感 BlendShape 参数（Part 5）

### 10.1 10 情感 PAD 坐标与触发
```
E01 满足   P0.6 A0.2 D0.5   任务完成/进度达标     decay 0.05
E02 专注   P0.35 A0.6 D0.7  深度工作             decay 0.02
E03 疑惑   P0.2 A0.5 D0.3   代码报错/不懂需求     decay 0.1
E04 愉悦   P0.85 A0.7 D0.4  找到bug/上线/夸奖     decay 0.08
E05 焦虑   P0.15 A0.8 D0.2  进度落后/deadline    decay 0.03
E06 不满   P0.1 A0.3 D0.6   摸鱼检测/质量差       decay 0.06
E07 惊讶   P0.5 A0.9 D0.1   突然会议/崩溃         decay 0.3
E08 疲惫   P0.2 A0.1 D0.15  工作>3h/深夜          decay 0.01
E09 关心   P0.65 A0.4 D0.3  休息提醒/健康         decay 0.04
E10 坚定   P0.4 A0.5 D0.85  强制专注/加班决策     decay 0.02
```

### 10.2 基础权重全表（非零项）
```
E01: smileL/R0.25 cheekSquintL/R0.12 eyeSquintL/R0.08 browInnerUpL/R0.05 jawOpen0.02 dimpleL/R0.08
E02: frownL/R0.10 eyeSquintL/R0.18 browInnerUpL/R0.08 browOuterDownL/R0.06 jawForward0.05
     eyeLookDownL/R0.15 jawOpen0.02 mouthPressL/R0.05
E03: browInnerUpL0.20/R0.15 eyeWideL/R0.15 frownL/R0.05 jawOpen0.10 noseSneerL0.05/R0.03
     eyeLookUpL/R0.10
E04: smileL/R0.45 cheekSquintL/R0.30 eyeSquintL/R0.15 jawOpen0.15 browInnerUpL/R0.12
     dimpleL/R0.15 rollUpper0.10 chinRaiserLower0.08
E05: browDownL/R0.25 frownL/R0.20 eyeWideL/R0.20 jawForward0.08 pressL/R0.15
     eyeLookDownL/R0.10 noseSneerL/R0.08
E06: frownL/R0.30 browDownL/R0.20 noseSneerL/R0.15 jawForward0.05 eyeSquintL/R0.12
     pressL/R0.10 eyeLookDownL/R0.08
E07: eyeWideL/R0.40 browInnerUpL/R0.35 jawOpen0.30 mouthFunnel0.10
E08: eyeCloseL/R0.30 frownL/R0.15 browOuterDownL/R0.15 jawOpen0.08 eyeSquintL/R0.10
     eyeLookDownL/R0.20
E09: smileL/R0.20 browInnerUpL/R0.10 eyeSquintL/R0.05 cheekSquintL/R0.10 dimpleL/R0.08
     eyeLookDownL/R0.08 jawOpen0.02
E10: browDownL/R0.15 pressL/R0.20 jawForward0.08 eyeSquintL/R0.12 eyeWideL/R0.05 frownL/R0.08
```

### 10.3 5 角色差异化系数（×=乘原值，+=加）
- **ARIA**：E01 smile×0.4 frown+0.05 cheek×0.3 | E02 frown×1.3 squint×1.2 jawFwd×1.5 | E03 browUp×0.7 jawOpen×0.5 | E04 smile×0.5 cheek×0.3 | E05 browDown×1.5 press×1.3 | E06 frown×1.5 sneer×1.2 | E07 eyeWide×0.7 jawOpen×0.5 | E08 eyeClose×0.5 frown×0.8 | E09 smile×0.3 browUp×0.5 | E10 jawFwd×1.5 press×1.3 browDown×1.2
- **LUNA**：E01 smile×1.5 cheek×1.3 dimple×1.5 | E02 frown×0.6 smile+0.05 | E03 browUp×1.2 jawOpen×1.3 | E04 smile×1.5 cheek×1.5 jawOpen×1.2 | E05 eyeWide×0.8 smile+0.05 | E06 frown×0.7 smile×0.3 | E07 eyeWide×1.3 jawOpen×1.2 cheek×0.8 | E08 eyeClose×1.2 frown×0.5 smile×0.3 | E09 smile×1.5 cheek×1.3 browUp×1.2 | E10 press×0.7 smile+0.05
- **KIRA**：E01 smile×0.8 frown+0.03 | E02 frown×1.1 squint×1.3 browDown+0.05 | E03 sneer×1.3 browDown×0.8 | E04 smile×1.2 cheek×0.5 | E05 browDown×1.5 frown×1.3 sneer×1.0 | E06 frown×2.0 sneer×1.5 | E07 eyeWide×1.0 jawOpen×0.8 frown+0.05 | E08 frown×1.2 squint×1.0 smile×0.0 | E09 smile×0.5 frown+0.03 | E10 browDown×1.5 jawFwd×1.3 frown×1.2
- **ZEN**：E01 smile×0.7 dimple×0.5 browUp×0.5 | E02 frown×0.7 jawFwd×0.5 | E03 browUp×0.8 jawOpen×0.5 sneer×0.3 | E04 smile×0.7 cheek×0.5 | E05 browDown×0.8 frown×0.7 | E06 frown×0.5 sneer×0.3 | E07 eyeWide×0.6 jawOpen×0.3 | E08 eyeClose×0.8 smile×0.3 | E09 smile×0.8 browUp×0.8 lookDown×1.2 | E10 press×1.0 jawFwd×0.8
- **SHIN**：E01 smile×0.2 frown×0.0 press×0.15 | E02 frown×1.5 squint×1.5 jawFwd×1.5 | E03 browUp×0.5 squint×0.8 jawOpen×0.3 | E04 smile×0.1 dimple×0.0 | E05 browDown×1.8 press×1.5 squint×1.3 | E06 frown×2.0 browDown×1.5 sneer×1.0 | E07 eyeWide×0.5 jawOpen×0.3 | E08 eyeClose×0.3 frown×0.8 | E09 smile×0.1 press×0.3 | E10 jawFwd×2.0 press×1.8 browDown×1.5

### 10.4 过渡/叠加/衰减规则
- PAD 距离：`dist = sqrt((P1-P2)² + (A1-A2)² + (D1-D2)²)`；<0.3 同区（0.4s，全权重同时 lerp）/ 0.3–0.6 邻近（0.7s，0–0.3s 降至 50%→0.3–0.7s 升至 100%，互斥组先归 0）/ >0.6 跨区（1.0s 三段：降至 30%→中性中间态→升至 100%）/ 突发→E07（0.15s ease-out，当前×0.1+惊讶×0.9 直跳；突发系数 ARIA×0.7 LUNA×1.3 KIRA×1.0 ZEN×0.6 SHIN×0.5）。
- 叠加：加权平均 `最终 = E1权重×E1强度 + E2权重×E2强度`（示例：focus0.8+confusion0.3 → mouthFrown=0.095, browInnerUp=0.124, eyeLookDown=0.12）。
- 衰减：`intensity(t) = initial × e^(-decay_rate × t)`；阈值 <0.05 不表现；>0.95 cap ×1.0。

---

## 11. Three.js 技术实现（Part 6，代码完整保留）

### 11.1 架构
Electron 主进程（MonitorModule / AI/ChatModule / StateModule → EventBus ipcMain）↔ ipcBridge ↔ 渲染进程 `VirtualHumanRenderer`，含子系统：`VRMModelManager`（5 角色懒加载）、`AnimationSystem`（StateAnimationLayer / ExpressionLayer / MicroBehaviorLayer / TransitionManager / BlendShapeInterpolator）、`PhysicsSystem`（SpringBoneManager / DragPhysicsController / InertiaSimulator）、`InteractionSystem`（CollisionDetector / ClickFeedbackManager / MouseLinkageController / ScreenBlockManager）、`ParticleSystem`（Pool/Emitter/InstancedMesh Renderer）、`EmotionEngine`（PADSpace / EmotionDecayManager / EmotionTransitionCalculator / CharacterEmotionModifier）、`LightManager`、`PostProcessingPipeline`（6 Pass）、`LODManager`、`PerformanceMonitor`（每 5s 采样，full/medium/minimal/critical）。窗口：`BrowserWindow transparent=true, alwaysOnTop=true`，全屏覆盖 + 点击穿透。

### 11.2 TypeScript 代码骨架（原文）

```ts
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
```

```ts
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
    for (const transition of this.activeTransitions) {
      const elapsed = currentTime - transition.startTime;
      const progress = Math.min(elapsed / transition.duration, 1.0);
      const curveValue = this.applyCurve(progress, transition.curve);
      transition.targetWeights.forEach((target, name) => {
        const start = transition.startWeights.get(name) ?? 0;
        result.set(name, start + (target - start) * curveValue);
      });
    }
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
```

```ts
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
```

```ts
// === src/renderer/virtual-human/CollisionDetector.ts ===
class CollisionDetector {
  private regions: Map<string, THREE.Box3> = new Map();
  // HEAD: head bone bounding box | FACE: head-jaw | CHEST: spine_03
  // LEFT_ARM/RIGHT_ARM: upper+lower arm | LEFT_HAND/RIGHT_HAND: hand+fingers
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
      if (raycaster.ray.intersectsBox(box)) return name;
    }
    return null;
  }
}
```

```ts
// === src/renderer/virtual-human/SpringBoneManager.ts ===
class SpringBoneManager {
  private springBones: VRMSpringBone[] = [];
  private currentStiffnessMultiplier: number = 1.0;
  private currentGravityMultiplier: number = 1.0;
  private externalForce: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

  update(deltaTime: number): void {
    this.springBones.forEach(bone => {
      bone.settings.stiffness = bone.settings.stiffness * this.currentStiffnessMultiplier;
      bone.settings.gravityPower = bone.settings.gravityPower * this.currentGravityMultiplier;
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
```

### 11.3 Electron 透明窗口（原文）

```ts
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

  // CSS: body { background: transparent; } canvas { background: transparent; }
  // Click-through 策略：默认穿透(forward)；悬停虚拟人/遮挡激活时不穿透；P0 全穿透
  win.setIgnoreMouseEvents(true, { forward: true }); // default: click-through

  win.loadFile('renderer/virtual-human.html');
  return win;
}

class ClickThroughManager {
  private window: BrowserWindow;
  private virtualHumanBounds: THREE.Box2;
  private blockingOverlayActive: boolean = false;

  update(mouseX: number, mouseY: number): void {
    if (this.blockingOverlayActive) {
      this.window.setIgnoreMouseEvents(false);
      return;
    }
    const isInVirtualHuman = this.virtualHumanBounds.containsPoint(
      new THREE.Vector2(mouseX, mouseY)
    );
    if (isInVirtualHuman) {
      this.window.setIgnoreMouseEvents(false);
    } else {
      this.window.setIgnoreMouseEvents(true, { forward: true });
    }
  }

  setBlockingOverlay(active: boolean): void {
    this.blockingOverlayActive = active;
  }
}
```

### 11.4 文件结构（要点）
- `assets/models/{CHAR}_LOD{0-3}.vrm + {CHAR}_sprites.png`，`morph_targets/`（方案B）；`assets/textures/{CHAR}/*.ktx2`（BC7）+ `toon_ramp_*.png`（1×256）；`assets/shaders/*.glsl`；`assets/particles/{spark,bubble,data_stream,zzz}_sprite.png`；`assets/audio/{voice,effects}/`。
- `src/main/`：index / window-manager / ipc-bridge / monitor-module / state-module / ai-chat-module / notification-module / settings-module。
- `src/renderer/virtual-human/`：VirtualHumanApp、VRMModelManager、AnimationSystem、StateAnimationLayer、ExpressionLayer、MicroBehaviorLayer、TransitionManager、BlendShapeInterpolator、EmotionEngine、PhysicsSystem、SpringBoneManager、DragPhysicsController、InteractionSystem、CollisionDetector、ClickFeedbackManager、MouseLinkageController、ScreenBlockManager、ParticleSystem/Pool/Emitter、LightManager、PostProcessingPipeline、LODManager、PerformanceMonitor、ClickThroughManager、CharacterSwitchManager。
- `src/shared/types/`：character / emotion / state / physics / animation / interaction；`src/shared/constants/`：blendshape-tables、state-params、character-configs、emotion-tables、light-profiles、particle-configs（Part 2/3/5 数据落盘处）。
- `tests/`：VRMModelManager / BlendShapeInterpolator / EmotionEngine / CollisionDetector / PerformanceMonitor / AnimationSystem + 主进程 3 模块测试。

### 11.5 FSM + 行为树
- FSM：16 核心状态 + loading/error/hidden 3 系统状态。优先级 P0: drag_lift/forced_focus/error/hidden；P1: meeting/presenting/sleeping；P2: coding/writing/AI_dev；P3: thinking/designing/AI_chat；P4: slack/eating/drinking；P5: idle/walking。
- 触发示例：inactivity>30min→sleeping；鼠标抓取→drag_lift；slack>30min+进度不足→forced_focus；performance critical→hidden(LOD4)。
- 行为树：工作→MatchWorkState→深专注 P0 则 SilentMode（无微行为无问答）；工作>2h→SuggestBreak（caring）；摸鱼按时长分级 L1–L4；14:00 进度<50%→UrgentWarning（anxiety）。情感决策并行层：TaskCompleted→joy/satisfaction、BugFound→confusion、DeadlineApproaching→anxiety、UserSick/Tired→caring、SlackDetected→displeasure、SurpriseEvent→surprise、默认 focus/neutral。

---

## 12. UI 设计约束（Part 7）

- 哲学："工具感 > 装饰感"；深色模式为主；动画：快速反馈 <0.3s / 状态过渡 0.5–1.0s / 装饰 1–3s。禁止：纯装饰动画、多级菜单、文字墙、卡通幼稚元素。
- 虚拟人面板：右下角（可自定义）；无 UI 边框；状态指示条高 16px、背景 rgba(0,0,0,0.05)、进度条 2px 圆角色=status_light 色；气泡最大 200×40px、毛玻璃 blur(8px)、出现 scale 0→1+opacity 0.3s、消失 0.5s；拖拽无辅助线；P0 时全穿透。
- 命令面板（Cmd/Ctrl+K）：屏幕 30% 高度居中；宽 480px、高 60–400px；背景 rgba(10,14,20,0.85)+blur(20px)；1px rgba(255,255,255,0.1) 边框；12px 圆角；输入框 420×40px，文字 #F0F0F0，焦点边框=角色色；结果行 36px、图标 16×16px、hover rgba(255,255,255,0.08)；出现 scaleY 0.2s+opacity 0.15s ease-out，消失 opacity 0.1s+scaleY 0.15s ease-in；P0 禁用；禁超 480px 宽、禁全屏遮挡背景。面板弹出时虚拟人转头看面板、切 AI_chat 表情、回答时逐段点头。
- 主窗口：最小 800×600、推荐 1200×800；左图标栏 56px 宽、图标 24×24、间距 8px、选中 rgba（角色色，0.15)+左 2px 竖线、未选中 rgba(255,255,255,0.3)；顶部栏 40px、背景 rgba(10,14,20,0.5)、进度条 120×4px 圆角 2px 角色色。导航：监控/日历/规划/报表/桌搭 + 问答/通知 + 设置。每视图 70% 核心区 + 30% 辅助区，禁 >3 层嵌套。
- 状态色（=Part 3 status_light）：coding/writing/AI_dev #00E676 | meeting #2196F3 | thinking #7C4DFF | designing #E040FB | AI_chat #00BCD4 | presenting #FFC107 | slack #FF5252 | eating #FF9800 | drinking #00E676 | sleeping #9E9E9E | forced_focus #FF1744 | idle #607D8B。
- 角色主题色：ARIA #6CA6CD | LUNA #F8BBD0 | KIRA #E04040 | ZEN #4CAF50 | SHIN #708090。
- 背景 #0a0e14，卡片 rgba(255,255,255,0.05)；文字主 #F0F0F0 / 次 rgba(255,255,255,0.5) / 禁用 rgba(255,255,255,0.2)。
- 动画三档：快速反馈 0.15–0.25s ease-out（scale 0.95→1）；状态过渡 0.5–0.8s ease-in-out；装饰 1.0–3.0s ease-out/bounce。禁 >3s 装饰动画、无目的循环动画、闪烁震动、弹窗 >0.5s。
- 字体：UI 系统栈；数据 monospace（SF Mono/Cascadia Code/Menlo）；对话字体 ARIA SF Pro Text 400/12px、LUNA SF Pro Rounded 500/13px、KIRA SF Pro Text 700/11px、ZEN SF Pro Text 300/14px、SHIN SF Pro Display 600/12px。行距 1.5(UI)/1.8（长文）；卡片内距 12–16px；模块间距 16–24px；H1 24/700 H2 18/600 H3 14/500 正文 13/400；数据数字 mono 14/500 角色色；进度百分比 mono 12/600 状态色。
- 多屏：虚拟人仅主屏（允许拖到副屏，遮挡仍仅主屏）；命令面板随鼠标所在屏；监控视图主屏 70%/辅屏 30%。

---

## 已知文档内部不一致（实现前需裁决）

1. **骨骼总数**：任务描述提"97 根"，文档实际写"约 80–90 根"（§1.3.1）。
2. **BlendShape 计数**：标题 52，但分组列名相加不符（眼部标题 12 实列 18 名）；眉部标题 8 实列 6 名。建议以标准 ARKit 52 清单为准，并建立文档别名映射（`eyeClose_L`→`eyeBlinkLeft`、`browDown_L`→`browInnerDown` 等）。
3. **状态色两套**：§1.9 光照色（coding=#4a9eff）与 Part 3 status_light（coding=#00E676）不同；Part 7.5 指定以 Part 3 status_light 为准。
4. **虹膜色**：§1.6 写 ARIA紫/LUNA粉/KIRA红/ZEN绿/SHIN银，Part 2 实际为 ARIA #6CA6CD（冰蓝）/LUNA #C89050（琥珀）/KIRA #C05030（琥珀红）/ZEN #604020（深棕）/SHIN #708090（钢蓝）——以 Part 2 为准。
5. **眼球追踪范围**：§1.4.3 垂直 ±15° vs §1.6 垂直 ±20°。

以上所有数值、角度、颜色、时长、类名、接口、GLSL 均为文档原样内容，可直接作为编码依据。