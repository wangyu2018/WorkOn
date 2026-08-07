两份文档已通读完毕（v4.0 共 986 行、v4.1 共 924 行，全文无跳读）。以下为实现级技术摘要。

---

# WorkOn v4.0 / v4.1 实现级技术摘要 — 独立全屏漫游虚拟人

> 源文档：
> - `workon-v4-supplement-roaming-and-commerce.md`（v4.0-supplement, 2026-07-21）
> - `workon-v4.1-state-spatial-behavior.md`（v4.1-supplement, 2026-07-21）

---

## 第一部分：v4.0 — 独立桌面游荡角色架构

### 1. Electron 透明全屏 Overlay 窗口架构

#### 1.1 新旧架构对比

| 维度 | 旧架构（右下角框内） | 新架构（独立游荡） |
|------|---------------------|-------------------|
| 容器 | Electron BrowserWindow 400×600 固定右下角 | Electron 透明全屏覆盖窗口，虚拟人仅占其中一小片区域 |
| Z序 | 常驻最顶层或嵌入 App | 与桌面图标同层，可被其他窗口遮挡 |
| 移动范围 | 不可移动 | 全桌面自由移动，跨显示器 |
| 点击穿透 | 窗口整体可点击 | 仅人物轮廓区域可交互，其余完全透明穿透 |
| 遮挡关系 | 永远挡在内容上方 | 走到窗口后面会自然被遮挡 |

#### 1.2 BrowserWindow 完整配置（原样保留）

```ts
// main/character-window.ts
const characterWindow = new BrowserWindow({
  width: screen.getPrimaryDisplay().bounds.width,
  height: screen.getPrimaryDisplay().bounds.height,
  x: 0,
  y: 0,
  frame: false,
  transparent: true,
  alwaysOnTop: false,          // 关键：不要永远置顶
  skipTaskbar: true,
  resizable: false,
  movable: false,
  hasShadow: false,
  backgroundColor: '#00000000', // 完全透明
  webPreferences: {
    nodeIntegration: true,
    contextIsolation: false,
    offscreen: false,
    webgl: true,
  },
});

// 关键：设为桌面层级（Windows）
characterWindow.setFullScreenable(false);

// Windows: 使用 SetWindowPos 将窗口置于桌面图标层与窗口层之间
// 需要调用 native addon 实现
const setDesktopLayer = () => {
  const hwnd = characterWindow.getNativeWindowHandle();
  // 1 = HWND_BOTTOM 不对，需要特殊处理
  // 实际方案：找到 Progman 窗口，将本窗口作为其子窗口
  setWindowAsDesktopChild(hwnd);
};
```

#### 1.3 桌面层级方案（方案A/B/C 与切换逻辑）

- **方案A（Windows 推荐）：注入桌面窗口**
  - 找到 `WorkerW` / `Progman` 窗口
  - 将 characterWindow 的 HWND 设为 WorkerW 的子窗口
  - 效果：虚拟人在壁纸层和图标层之间
  - 优点：最自然，其他窗口会遮挡她
  - 缺点：需要管理员权限一次（首次启动时），或用 `SPI_SETDESKWALLPAPER` 绕过
- **方案B（降级回退）：alwaysOnTop + 点击穿透**
  - characterWindow 永远置顶
  - 人物区域外 `setIgnoreMouseEvents(true, {forward: true})`
  - 人物区域 `setIgnoreMouseEvents(false)`
  - 优点：实现简单，无需管理员
  - 缺点：永远遮挡其他窗口，体验像挂件
- **方案C（Mac/Linux）**
  - macOS: `NSWindowLevel` 设为 desktop 层级
  - Linux: 依赖 WM，使用 `_NET_WM_WINDOW_TYPE_DESKTOP`
- **平台路由推荐**：Windows 用方案A，Mac 用方案C，Linux 用方案B降级。

#### 1.4 坐标系与定位系统

- 原点 `(0,0)`：主显示器左上角；X 向右为正，Y 向下为正；单位 = CSS 逻辑像素（DPI 缩放由 Three.js 自动处理）
- Z 轴：深度，`0 = 屏幕平面`，`+Z` 向用户凸出
- 虚拟人锚点：**脚底中心点** `(x, y, 0)`
- 角色高度 200–400px（可缩放 0.5x–2.0x）；头顶坐标 = `锚点y - height × scale`
- 缩放规则：默认 `scale = 1.0`（约 300px 高）；最小 `0.5`（专注模式）；最大 `2.0`（交互/提醒）；缩放动画 `0.3s ease-out`

#### 1.5 安全区域与边界

- 全桌面可用区域 = 所有显示器并集 bounds
- 任务栏排除：Windows 任务栏 `48px` / macOS Dock 按设置
- 应用窗口占据区域：动态检测，**每 500ms 扫描一次**
- 硬边界：角色锚点不可超出桌面 bounds
- 软边界：角色中心距边缘 ≥ `100px`
- 多显示器边界：鼠标/角色接近屏幕边缘 `50px` 时触发跨屏转移
- 避障：默认可走到窗口下方（被遮挡）；可选"避开窗口"模式（绕窗口边缘）；可选"不遮挡图标"模式

#### 1.6 位置状态机 `CharacterPositionState`

```
enum CharacterPositionState {
  ROAMING,       // 自由游荡
  PINNED,        // 用户固定位置
  FOLLOW_MOUSE,  // 跟随鼠标（轻跟随，不贴太近）
  SITTING_LEDGE, // 坐在窗口边缘/任务栏
  SLEEPING,      // 缩在角落睡觉
  BLOCKING,      // 遮挡屏幕提醒模式
  PRESENTING,    // 居中展示/全局问答
}
```

切换条件：
- `ROAMING → FOLLOW_MOUSE`：用户开启鼠标联动
- `FOLLOW_MOUSE → ROAMING`：用户关闭或 5min 无操作
- `ROAMING → SITTING_LEDGE`：检测到窗口边缘且 idle > 30s
- `ROAMING → SLEEPING`：系统 idle > 10min 且不在番茄钟
- `ROAMING → BLOCKING`：检测到严重摸鱼且达到遮挡阈值
- `ROAMING → PRESENTING`：用户按 Cmd+K / 重要通知 / 启动仪式
- `ANY → PINNED`：用户右键"固定在此"

### 2. 像素级命中检测 / 点击穿透（代码原样保留）

```ts
// renderer/character-canvas.ts
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const isPointerOverCharacter = (clientX: number, clientY: number): boolean => {
  // 将屏幕坐标归一化到 NDC
  mouse.x = (clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(clientY / window.innerHeight) * 2 + 1;
  
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(characterMeshGroup, true);
  
  // 只检测 opacity > 0.1 的三角面
  const validHit = intersects.find(hit => {
    const mat = hit.object.material as THREE.MeshStandardMaterial;
    return mat && mat.opacity > 0.1;
  });
  
  return !!validHit;
};

// 每帧根据鼠标位置更新窗口点击穿透
const updateClickThrough = throttle((e: MouseEvent) => {
  const overCharacter = isPointerOverCharacter(e.clientX, e.clientY);
  if (overCharacter) {
    // 取消点击穿透，允许交互
    ipcRenderer.send('set-ignore-mouse-events', false);
    document.body.style.cursor = 'pointer';
  } else {
    // 开启点击穿透，鼠标事件透传给下层桌面/窗口
    ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
    document.body.style.cursor = 'none';
  }
}, 16);
```

说明：文档给出的是 **Raycaster + material.opacity > 0.1** 方案（非 readPixels），throttle 16ms；命中时 IPC `set-ignore-mouse-events: false`，未命中时 `true, {forward:true}`。

**透明区域性能优化**：仅人物周围 bounding box 渲染；静止时渲染区 = 人物 bbox + 50px 边距；移动/特效时动态扩展；使用 scissor test：

```
gl.enable(gl.SCISSOR_TEST);
gl.scissor(bbox.x, bbox.y, bbox.w, bbox.h);
```

### 3. 与主 App 窗口协作

- 主 App 是普通独立窗口；虚拟人窗口是桌面覆盖层；两者通过 IPC / 共享状态机通信
- 主 App 打开：虚拟人可走到 App 窗口后方，或自动让开坐到窗口边缘；用户可设置"App打开时虚拟人行为"：避让 / 无视 / 最小化
- Cmd+K 全局问答：走到屏幕中央偏下，或放大到 1.5x 进入 PRESENTING
- 番茄钟：头顶显示倒计时粒子环，可坐任务栏边缘或屏幕角落
- 屏幕遮挡提醒：放大到 2.0x，走到屏幕中央，配合遮罩层（另一窗口）

### 4. 自由游荡 AI

#### 4.1 目标点生成

- 每 **10–60s** 随机选择一个新目标点
- 约束：在桌面 bounds 内；不在当前鼠标位置 **200px** 内；不在全屏窗口覆盖区域（除非开启"走到后面"）
- 加权随机：阳光区域（壁纸明亮处）+20%；靠近用户当前工作窗口 +30%；角落区域 +10%；图标空白区 +15%
- 路径规划：简单版 = 直线插值 + 边界反弹（默认）；进阶版 = A* 避障（"避开窗口"模式）

#### 4.2 游荡动画状态 `RoamingAction` 与切换规则

```
enum RoamingAction {
  IDLE_STAND, IDLE_SIT, WALK_SLOW, WALK_FAST, RUN,
  TELEPORT_IN, TELEPORT_OUT, PEEK_FROM_EDGE, JUMP, CLIMB_WINDOW,
}
```

- 短距离（<200px）：`WALK_SLOW`
- 中距离（200–600px）：`WALK_FAST`
- 长距离（>600px）：`RUN` 或 `TELEPORT_OUT + TELEPORT_IN`
- 到达目标后 70% `IDLE_STAND`，30% `IDLE_SIT`
- 每次移动 10% 概率触发 `PEEK_FROM_EDGE`

### 5. 多显示器处理（v4.0）

- `screen.getAllDisplays()` 记录每个 display 的 bounds 和 workArea；主显示器 = 用户当前焦点所在显示器
- 跨屏触发：鼠标到屏幕边缘+跟随模式 / 用户工作窗口移屏 / 随机目标在另一屏
- 跨屏动画：方案A 直接瞬移（低性能）；**方案B（推荐）：从屏幕边缘走出，延迟 0.5s 后从目标屏幕边缘走入**
- 每屏独立配置：scale 可不同（笔记本 0.8，外接 1.2）；是否允许进入可配置；任务栏位置不同边界独立计算

### 6. 桌面互动元素

- 可"使用"桌面元素：坐任务栏、靠窗口标题栏、绕图标、站壁纸物体上、与鼠标互动（拽鼠标、骑鼠标、被拖着走）
- "拽鼠标"：通过 robotjs / @nut-tree/nut.js 移动系统鼠标，拖到屏幕角落/休息区；触发条件：连续工作 50min 且未休息；挣脱：快速移动鼠标 3 次

### 7. 桌面专属行为状态表（v4.0 补充）

| 行为 | 触发条件 | 骨骼动画 | 特效 | 声音 |
|------|---------|---------|------|------|
| 屏幕边缘探头 | 随机/用户离开 5min | 身体在屏外，头探出 ±15° | 小星星闪烁 | 无 |
| 坐任务栏 | idle 30s 靠近任务栏 | 双腿悬空摇摆 | 小云朵坐垫 | 无 |
| 爬窗口 | 走到窗口边缘 | 双手撑窗框，腿抬起 | 抓痕粒子 | 轻微摩擦声 |
| 钻到窗口后面 | 工作专注中 | 蹲下走，仅头顶露出 | 透明感 | 无 |
| 拖拽鼠标 | 休息提醒 | 双手拉鼠标，身体后仰 | 阻力线 | "休息一下嘛" |
| 跨屏行走 | 跨显示器移动 | 走到边缘消失，另一边出现 | 屏幕边缘光 | 无 |
| 躺平在角落 | 深夜/过度劳累 | 侧卧，闭眼 | Zzz 粒子 | 轻微呼吸 |
| 站立在图标上 | 避障失败/调皮 | 单脚站图标，保持平衡 | 图标微光 | "这里风景不错" |

### 8. 15 个内置角色清单（稀有度 / 原型 / 性格模板 / 价格）

| # | 名称 | 稀有度 | 原型 | 性格模板 | 价格 | 卖点 |
|---|------|--------|------|---------|------|------|
| 01 | LING（灵·应愿） | SSR（首发传说） | 东方神女/狐灵/音律神使（青绿白金如意纹、神鸟、箜篌） | LUNA | ¥128 首发 / 后续 ¥168 | 中国文化符号+好运祈愿+音律特效 |
| 02 | NEO（赛博执行者） | SR | 赛博朋克黑客少女 | ARIA | ¥68 | 程序员最爱 |
| 03 | MOMO（咖啡馆店员） | R | 日常系治愈少女 | LUNA | ¥28 | 亲和力高 |
| 04 | REX（龙血骑士） | SSR | 西方奇幻龙骑士少年 | KIRA | ¥168 | 男性用户，中二燃感 |
| 05 | SAKURA（樱之巫女） | SR | 日式和风巫女 | LUNA | ¥78 | 二次元核心用户 |
| 06 | CIPHER（量子学者） | SR | 未来科学家/教授 | SHIN | ¥68 | 职场精英/数据分析师 |
| 07 | BAMBOO（竹林居士） | R | 国风隐者 | ZEN | ¥28 | 国风男性角色 |
| 08 | STELLA（星使少女） | SSR | 宇宙星灵/魔法少女 | KIRA | ¥198 | 梦幻特效 |
| 09 | KENJI（运动少年） | N | 校园运动系男孩 | KIRA | 免费默认 / ¥12 换色包 | 健康提醒场景 |
| 10 | LUNETTE（月兔药剂师） | SR | 奇幻炼金术师/月兔少女 | LUNA | ¥58 | 萌系 |
| 11 | VULCAN（机甲驾驶员） | SSR | 机甲驾驶员/未来战士 | ARIA | ¥188 | 机甲题材，高 ARPU |
| 12 | YUKI（雪国旅人） | R | 北欧/雪国少女 | ARIA | ¥38 | 冬季季节限定 |
| 13 | APOLLO（太阳神官） | SR | 古希腊/罗马太阳神官 | LUNA | ¥88 | 仪式感 |
| 14 | PIXEL（像素小精灵） | N | 8-bit 像素风桌面宠物 | KIRA | 免费默认 / ¥6 皮肤包 | 复古情怀，低成本 DLC |
| 15 | ORION（幽灵执事） | SR | 哥特风幽灵执事 | ZEN | ¥78 | 暗黑美学小众高付费 |

稀有度体系：N（白，免费/¥6-12，25K 面）→ R（蓝，¥18-38，35K 面，专属动作1-2个）→ SR（紫，¥48-98，45K 面，专属特效+语音）→ SSR（金，¥128-328，60K 面，完整技能系统）→ UR（彩虹，¥648+/活动限定，60K+ 面，全特效+独占互动）。

获取渠道：商城直购（R/SR 常驻）、限定卡池（SSR/UR 周期复刻）、任务解锁（连续专注 7 天解锁碎片）、成就奖励（连续 30 天）、联动限定、创作者分成（平台抽 30%，作者 70%）。运营节奏：每月 1 个新 SR、每季度 1 个 SSR、每半年 1 个 UR 联动。

### 9. AI 拍照建模 → VRM 商业管线

- 定位："数字分身定制服务"。定价：基础版（1 张）¥29；标准版（3–5 张多角度）¥69；专业版（8–12 张+手工精修）¥199；Pro 会员每月 1 次免费基础版 + 8 折
- 等级表：Lv.0 试玩版（1 张，2D 纸片人，500 tris，无骨，免费）；Lv.1 基础版（1 张正面，头像+默认身体，8K tris，55 骨，¥29）；Lv.2 标准版（3–5 张，半身像，25K，55 骨，¥69）；Lv.3 专业版（8–12 张，全身+服装，60K，80 骨，¥199）；Lv.4 大师版（照片+人工精修，60K+，97 骨，¥599+）
- 单照片 Pipeline：人脸关键点检测（MediaPipe/dlib 468点）→ 3DMM 重建（FLAME/DECA/EMOCA，~50K tris 中性脸 + 表情 BlendShape 基）→ 风格迁移（StyleGAN/diffusion）→ 重拓扑 ~15K tris → PBR 贴图（Albedo/Normal/Roughness/Metalness/AO）→ VRM Humanoid 55 骨绑定 → ARKit 52 BlendShape（从 3DMM 基映射）→ 导出 .vrm。耗时 30s–2min
- 多照片 Pipeline：多视角重建（MVS+NeRF；InstantAvatar/AvatarMe/GaussianAvatar）→ 身体重建（SMPL-X 参数估计或 PIFuHD/PaMIR/ECON）→ 服装解析（ClothCap/DeepWrinkles）→ 头发（Neural Haircut Hair Cards）→ 风格化 → 重拓扑（标准 30K / 专业 60K tris）→ 材质（SD/MaterialGAN 补全）→ 骨骼（标准 55 骨 / 专业 80–97 骨含 SpringBone）→ ARKit 52 + 自定义 BlendShape → VRM + WorkOn 元数据。耗时：标准 2–5min，专业 10–15min（云端 GPU）
- 云端架构：Redis + Celery 任务队列；Face/Body/Retopology&Rigging Pod（RTX A6000 × 2）；原图加密存储 24h 后删除；单次专业版 GPU 成本 $0.15–0.30
- 上传质量门槛：人脸检测置信度 < 0.85 → 提示重拍；分辨率 < 512×512 拒绝；进度条阶段：人脸解析 → 身体重建 → 拓扑优化 → 材质生成 → 骨骼绑定 → VRM 导出
- 集成：生成角色自动获得 WorkOn 标准 97 骨映射、30 种工作状态动画、ARKit 52 BlendShape、5 种性格模板（ARIA/LUNA/KIRA/ZEN/SHIN）、游荡 AI、PAD 情感系统
- 合规红线：仅本人或授权照片；禁止 <14 岁；禁止真实公众人物 likeness；必须着装；24h 删原图；可导出水印"这不是真实人物"

---

## 第二部分：v4.1 — 16 状态 × 空间行为映射（核心）

### 10. 核心状态矩阵（总表，原样保留）

| 工作状态 | 空间策略 | 默认位置 | 缩放 | Z层 | 身体姿态关键词 |
|---------|---------|---------|------|-----|---------------|
| 深度专注 | 最小打扰 | 屏幕底边探头 | 0.35x–0.5x | 可被窗口遮挡 | 只露小头，耳朵警觉 |
| 一般办公 | 边缘待命 | 右下角/左下角站立 | 0.8x–1.0x | 中间层 | 自然站立，微动 |
| 编程中 | 协助姿态 | 代码窗口右侧/上方 | 0.9x–1.1x | 前景（半透明） | 单手托腮看屏幕，偶尔指 |
| 写文档 | 安静陪伴 | 屏幕侧边坐着 | 0.8x–1.0x | 中后层 | 盘腿坐，手持羽毛笔 |
| AI问答中 | 交流姿态 | 屏幕中央偏下 | 1.2x–1.5x | 前景 | 正对用户，手势讲解 |
| AI开发中 | 围观姿态 | 代码窗口左上角 | 0.7x–0.9x | 后层 | 趴桌探头看代码 |
| 摸鱼/娱乐 | 一起摸鱼 | 屏幕侧边或窗口旁 | 1.0x–1.3x | 前景 | 坐着晃腿、趴地、歪头看 |
| 会议中 | 正式待命 | 屏幕底边正中 | 0.7x–0.9x | 后层 | 端坐，双手放膝 |
| 番茄钟-专注 | 倒计时中心 | 屏幕角落/任务栏 | 0.5x–0.7x | 顶层 | 头顶粒子倒计时 |
| 番茄钟-休息 | 拉人休息 | 屏幕中央/鼠标旁 | 1.3x–1.6x | 顶层 | 拖拽鼠标或张开双臂挡 |
| 过度劳累 | 关心姿态 | 屏幕角落 | 0.6x–0.8x | 中后层 | 趴地、蜷缩、叹气 |
| 睡眠/离开 | 休眠 | 任意角落 | 0.5x–0.7x | 最底层 | 蜷缩成球 |
| 全局问答 | 交流中心 | 屏幕中央 | 1.3x–1.8x | 前景 | 站立演讲姿态 |
| 屏幕遮挡 | 强制干预 | 屏幕中央 | 2.0x–2.5x | 最顶层 | 张开双臂，直视用户 |
| 下班提醒 | 温馨提醒 | 屏幕中央偏下 | 1.1x–1.4x | 前景 | 挥手、指时钟 |
| 加班确认 | 认真确认 | 屏幕中央 | 1.2x–1.5x | 前景 | 双手抱胸，严肃脸 |

设计原则：专注→最小存在感；摸鱼→变大变近变互动；办公→视野边缘待命；疲惫→关心姿态缩角落；休息→主动拉人；**每次状态切换必须有 0.5–2s 过渡动画，不能瞬切**。

### 11. 逐状态详细参数

#### 11.1 深度专注 DeepFocus — "只冒个小头"

空间参数：
- 位置：主屏底部中央偏右；`x = screenWidth × 0.70`（可配置 L/C/R）；`y = screenHeight - taskbarHeight - 20px`；身体 80% 在屏幕下方，只有头部探出
- 缩放：**0.40x 默认**；自适应（27寸以上 0.35x，笔记本 0.45x）；用户"极简模式" 0.30x
- Z层：默认窗口后层；提醒时短暂走到前景
- 碰撞：点击头部区域→快捷菜单（静音/问候/查看状态）；点击身体区域（屏幕外）→无效
- 锚点：脚底在 `y = screenHeight + height×0.8`

骨骼姿态（精确角度，原样）：

```
spine_01:  x=0°  y=0°  z=0°（脊柱中立）
spine_02:  x=5°  y=0°  z=0°（上半身微微前倾探头）
spine_03:  x=8°  y=0°  z=0°
neck_01:   x=-15° y=0°  z=0°（脖子前伸抬头看屏幕）
head:      x=-20° y=0°  z=0°（脸正对上方屏幕）
shoulders: x=0°  y=0°  z=0°
upperarm_L/R: x=0°  y=0°  z=0°
forearm_L/R:  x=0°  y=0°  z=0°
hand_L/R:     x=0°  y=0°  z=0°
thigh_L/R: x=0°   y=0° z=0°
calf_L/R:  x=10°  y=0° z=0°
```

BlendShape：`eyeBlinkLeft/Right: 0.0`；`browInnerUp: 0.1`；`browOuterUpLeft/Right: 0.15`；`mouthSmile: 0.05`；`mouthPucker: 0.0`；`eyeWideLeft/Right: 0.1`

入场动画（3 相，总 1.5s）：
- Phase 1 (0.0–0.3s)：蹲下准备，scale 1.0x→0.6x，向屏幕底边移动
- Phase 2 (0.3–1.0s)：钻到屏幕下方，y 超过 screenHeight，scale 0.6x→0.4x，身体边缘淡出（opacity 1.0→0.0，从脚到头）
- Phase 3 (1.0–1.5s)：探头定位，头部 small wobble（左右各 3°）settling，眨眼一次+耳朵抖动一次
- Easing：`ease-in-out-back`（探头轻微回弹）

持续微行为（每分钟）：eye_blink 12–15 次；ear_twitch 2–3 次；head_bob 1–2 次；gaze_track 持续追踪鼠标（滞后 0.3s）；peek_more 5% 概率多冒肩膀（0.5s 后收回）。触发提醒：头部 0.4x→0.6x，身体多冒 20%，头顶青色感叹号粒子，3s 无交互恢复最小状态。

#### 11.2 摸鱼/娱乐 Slacking — "在旁边一起看"

空间参数（三场景）：
- 场景A（浏览器/视频窗口居中）：`x = videoWindow.right + 20px`，`y = videoWindow.bottom - 180px`，面朝窗口
- 场景B（全屏游戏/视频）：`x = screenWidth × 0.88`，`y = screenHeight × 0.75`，scale 0.7x
- 场景C（桌面无焦点窗口）：`x = screenWidth × 0.5`，`y = screenHeight × 0.6`，scale 1.1x
- 缩放 0.9x–1.3x 自适应；Z层：默认前景半透明 0.85–0.95，全屏娱乐时中景
- 检测视频播放 5min+ → 打哈欠提示"还看？"

坐姿骨骼（最常见）：

```
hip:      x=90°  y=0°  z=0°
thigh_L:  x=90°  y=-15° z=10°
thigh_R:  x=90°  y=15°  z=-10°
calf_L:   x=90°  y=0°  z=0°
calf_R:   x=85°  y=0°  z=0°
foot_L/R: x=15°  y=0°  z=0°
spine_01: x=-5° y=0° z=0°
spine_02: x=-8° y=0° z=0°
spine_03: x=-5° y=0° z=5°
neck_01:  x=-10° y=0° z=-5°
head:     x=-5°  y=10° z=-5°
upperarm_L: x=-20° y=20° z=-10°
forearm_L:  x=-40° y=0°  z=0°
upperarm_R: x=-30° y=-30° z=20°
forearm_R:  x=-60° y=0°  z=0°
```

趴地变体（摸鱼超 10min，30% 概率切换）：`hip: 0°`；`spine_01/02/03: x=-85°~-90°`；`upperarm_L/R: x=-90° y=±30° z=0°`；`head: x=30°`；calf 向上微弯。

BlendShape：eyeBlink 正常 18/min；`browInnerUp: 0.0`；`cheekPuff: 0.1`；`mouthSmile: 0.25-0.45`；`mouthOpen: 0.05-0.15`；`noseWrinkle: 0.05`

入场动画（总 2.0s）：
- Phase 1 (0.0–0.5s)：从屏幕底边/角落升起，y 从 `screenHeight+100` 到目标 y，scale 0.4x→1.0x
- Phase 2 (0.5–1.2s)：WALK_FAST 或 RUN 走到目标，路径略带弧线，到达后 small spin 转一圈坐下
- Phase 3 (1.2–2.0s)：hip 旋转到 90° 坐下 settling，腿摆动，头歪向屏幕眨眼微笑
- 特效：小云朵坐垫 0.5s 淡入；心情粒子按内容类型（视频→音符，游戏→像素块，社交→爱心/气泡）

"一起看"互动：每 30–60s 一次反应（微笑加深 cheekPuff +0.1 / 轻笑点头 / 指屏幕 / 歪头换边）；内容静止 >10s → 转头看用户；摸鱼 >20min → 表情变担忧，走到屏幕中央提示"今天的进度没问题吗？"；鼠标悬停 → 抬头看鼠标，语音"一起看吗？"/"这个有意思~"。

#### 11.3 编程中 Coding — "在代码旁待命"

- 位置：`x = codeEditor.right + 30px`，`y = codeEditor.top + 100px`；右侧不足移左侧
- 缩放 1.0x；Z层中景半透明 0.9（被代码窗口遮挡）
- 触发：连续编码 25min → 指屏幕做"休息"手势；debug 停滞 5min → 托腮思考；编译成功 → 跳起小庆祝

站立骨骼：`spine_02: x=2°`；`spine_03: x=3° z=-5°`；`neck_01: x=-5° z=5°`；`head: y=5°`；`upperarm_L: y=10°`，`forearm_L: x=-90°`（左手叉腰）；`upperarm_R: x=-40° y=-20° z=10°`，`forearm_R: x=-90°`（右手指代码，食指伸直）

托腮思考（debug）：`spine_01: x=5°`；`upperarm_R: x=-30° y=-40° z=20°`；`forearm_R: x=-90°`；`head: x=10° y=15° z=5°`

BlendShape：`browInnerUp: 0.2`；`mouthFrown: 0.05-0.15`（按 bug 严重度）；`eyeSquintLeft/Right: 0.1`

#### 11.4 写文档 Writing — "安静陪伴"

- 位置：`x = documentWindow.left - 80px` 或 `right + 80px`；`y = documentWindow.bottom - 120px`；缩放 0.85x
- 盘腿坐：`thigh_L: x=45° y=-45°`；`thigh_R: x=45° y=45°`；`calf_L/R: x=-90°`；spine 直立轻前倾；右手持笔空中写画
- 羽毛笔动画：每 3–5s 写一个字，金色墨迹粒子，1s 后消散

#### 11.5 AI 问答 AI Chat — "交流中心"

- 位置：`x = screenWidth × 0.5`，`y = screenHeight × 0.55`；缩放 1.4x；Z层前景
- 讲解姿态：`spine_02: x=-3°`；`spine_03: x=-5°`（微后仰）；`neck_01: x=-5°`；`upperarm_L: x=-30° y=40°`，`forearm_L: x=-60°`；`upperarm_R: x=-40° y=-50°`，`forearm_R: x=-70°`
- BlendShape：`mouthSmile: 0.3`；`browInnerUp: 0.1`；`eyeWide: 0.1`
- 回答结束恢复较小 size 退到边缘

#### 11.6 AI 开发中 AI Coding — "围观代码"

- 位置：`x = codeEditor.left - 40px`，`y = codeEditor.top + 60px`；缩放 0.75x；趴窗口边框只露头
- 骨骼：`spine_01: x=45°`；`spine_02: x=30°`；`spine_03: x=15°`；`neck_01: x=-30°`；`head: x=-15°`；`upperarm_L/R: x=-70° y=±20°`；`forearm_L/R: x=-60°`；腿悬空下垂
- BlendShape：`eyeSquint: 0.15`；`browInnerUp: 0.25`；`mouthSmile: 0.1`

#### 11.7 会议中 Meeting — "正式待命"

- 位置：`x = screenWidth × 0.5`，`y = screenHeight - taskbarHeight - 50px`；缩放 0.75x；Z层后层
- 端坐：`hip: x=90°`；`thigh: x=90°`；`calf: x=90°`；spine 挺直；arms 自然下垂；双手放膝
- BlendShape：`mouthSmile: 0.1`；eyeBlink 15/min；`browInnerUp: 0.0`

#### 11.8 番茄钟专注 Pomodoro Focus — "倒计时光环"

- 位置：`x = screenWidth × 0.92`，`y = screenHeight × 0.08`；缩放 0.55x
- 倒计时环颜色：`>60%: 青色 #50C878`；`30-60%: 黄色 #FFD700`；`<30%: 红色 #FF4444`；环上显示 MM:SS
- 蹲坐/盘腿漂浮：`thigh: x=60° y=±30°`；`calf: x=-90°`；结印或手放膝；闭眼冥想
- BlendShape：eyeBlink 8/min；`mouthSmile: 0.15`；`jawOpen: 0.0`

#### 11.9 番茄钟休息 Pomodoro Break — "拉人去休息"

- 位置：`x = mouseX + 100px`，`y = mouseY - 150px`；缩放 1.5x
- 拦路姿态：`upperarm_L: y=90°`；`upperarm_R: y=-90°`；双臂张开，表情认真
- 躺平挡屏幕：`spine: x=-90°` 平躺；arms 两侧张开；legs 伸直；head 抬起看用户；"不让你工作"的坏笑

#### 11.10 过度劳累 Overworked — "关心姿态"

- 位置：`x = screenWidth × 0.10`，`y = screenHeight × 0.75`；缩放 0.7x
- 特效：暗淡灰色粒子；角色发光减弱 30%
- 趴地：`spine_01/02/03: x=-85°~-90°`；arms 前伸掌朝下；head 侧脸贴地一只眼看用户
- 蜷缩：`thigh: x=90° y=±30°`；`calf: x=-90°`；spine 弯成 C 形；arms 抱膝；head 埋膝上
- BlendShape：`mouthFrown: 0.2`；`browInnerUp: 0.3`；`eyeSquint: 0.1`；`cheekPuff: 0.0`

#### 11.11 睡眠/离开 Sleeping/AFK — "休眠"

- 位置：最后所在位置或预设"床位"：`x = screenWidth × 0.90`，`y = screenHeight × 0.80`；缩放 0.6x
- 特效：呼吸光效（opacity 0.3–0.5 脉动）；Zzz 粒子；可选梦境气泡

#### 11.12 全局问答 Global Chat (Cmd+K) — "居中展示"

- 位置：`x = screenWidth × 0.5`，`y = screenHeight × 0.50`；缩放 1.5x–1.8x；Z层前景
- 入场：从当前位置快速滑到中央，或从屏幕底部升起 + scale 放大

#### 11.13 屏幕遮挡 Screen Block — "强制干预"

- 位置：`x = screenWidth × 0.5`，`y = screenHeight × 0.45`；缩放 2.0x–2.5x；Z层最顶层（配合半透明遮罩层）
- 姿态：双臂张开 / 双手叉腰严肃脸 / 走过来挡屏幕

注：下班提醒（1.1x–1.4x）与加班确认（1.2x–1.5x）仅在总表中出现，无独立章节详参。

### 12. 过渡动画类型与切换规则

5 种过渡（所有切换 0.5–2.0s，不能瞬切）：
- **A. 行走过渡（Walk Transition）**：走路 + 姿态 blend；用于 Working↔Coding, Slacking↔Writing
- **B. 缩放进出过渡（Scale Transition）**：位置移动 + scale；用于 DeepFocus（缩到屏幕下）、Global Chat（放大）
- **C. 钻入/钻出过渡（Peel Transition）**：身体从屏幕边缘滑入/滑出；用于 DeepFocus（底边探头）、Screen Block（屏外走入）
- **D. 漂浮过渡（Float Transition）**：用于 Pomodoro、冥想状态
- **E. 奔跑冲刺过渡（Run Transition）**：紧急情况；用于 Overworked 提醒、下班提醒

打断/优先级规则：新状态优先级高于旧状态；正在做微行为时先完成当前动作再切换；**紧急状态（Screen Block / 番茄钟休息）可立即打断**。

### 13. 移动路径与缩放规则

移动路径：
- 目标点权重：工作窗口附近 +40%；鼠标附近（不挡鼠标）+20%；图标空白区 +15%；桌面边缘/角落 +10%；上次位置附近（惯性）+15%
- 速度：正常漫步 **80–120 px/s**；快步 **150–250 px/s**；奔跑 **300–500 px/s**；漂浮 **50–100 px/s**
- 路径曲线：默认二次贝塞尔带轻微弧线；紧急情况直线；与鼠标保持 ≥150px

缩放公式：

```
baseScale = 用户设置（默认 1.0）
stateScale = 状态缩放系数（见各状态）
distanceScale = 远近感系数（可选 0.8-1.2）
finalScale = baseScale × stateScale × distanceScale
```

- 缩放动画 duration 0.3–0.8s，easing `ease-out-back`
- 限制：最小 0.25x（DeepFocus 极小探头）；最大 2.5x（Screen Block）

### 14. Z 层级枚举与策略

```
DESKTOP_BG = 0      // 壁纸层，被所有窗口遮挡
WINDOW_BACK = 1     // 普通窗口后
WINDOW_MID = 2      // 与普通窗口同层
WINDOW_FRONT = 3    // 普通窗口前（半透明）
TOPMOST = 4         // 永远最顶层（提醒/遮挡）
```

默认层级：DeepFocus → DESKTOP_BG/WINDOW_BACK；Coding → WINDOW_BACK；Slacking → WINDOW_FRONT（半透明）；AI Chat → WINDOW_FRONT；Pomodoro Focus → TOPMOST；Screen Block → TOPMOST；Global Chat → WINDOW_FRONT。

层级切换动画：opacity 先降到 0.3 再升到目标值，duration 0.4s。

### 15. 多显示器与 DPI 适配（v4.1）

- 主显示器 = 鼠标当前所在显示器；角色默认跟随
- 工作窗口移屏 → 角色延迟 1s 后走过去；角色走到屏幕边缘 → 0.3s 后从另一屏幕边缘出现；跨屏移动速度加快 50%
- DPI：4K 屏 scale 自动 -0.15x；笔记本小屏 +0.1x；多屏独立 scale
- 任务栏：Windows 底部 y 减 48–64px；左/右侧任务栏 x 偏移；macOS Dock 自动检测避让；Linux 按 WM 配置

### 16. CharacterSpatialController 代码骨架（原样保留）

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

### 17. 文档衔接与实现优先级

- 分层关系：v3.0 提供建模/材质/骨骼/BlendShape 基础；v4.0 Part1 提供窗口架构/点击穿透/游荡 AI；v4.1 在其上把每种 WorkState 映射到空间位置+姿态+动画；所有骨骼角度叠加到 v3.0 基础绑定，所有空间参数叠加到 v4.0 坐标系
- 实现步骤：①看概念图 → ②按 WorkState 查 `spatialStateTable` → ③按 `poseName` 加载动画 clip → ④用 v3.0 BlendShape 预设做表情 → ⑤用 v4.0 窗口架构实现穿透和层级
- 重点实现：DeepFocus 探头、Slacking 陪伴、Screen Block 遮挡、Pomodoro 倒计时
- 性能底线：优先保证 60fps，不足时先降粒子/阴影

---

**补充说明（给主代理）**：① v4.1 中"一般办公、下班提醒、加班确认"三态只有总表参数、无独立详参章节；② 命中检测文档采用 Raycaster 方案而非 readPixels（用户提到的 readPixels 在文档中未出现）；③ `spatialStateTable` 在文档中只给出 DeepFocus 与 Slacking 两个完整条目，其余状态需按第 10/11 节参数自行补全。