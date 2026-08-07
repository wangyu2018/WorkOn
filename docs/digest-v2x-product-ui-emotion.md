六份文档已全部通读完毕。以下为实现级摘要。

# WorkOn v2.x 系列规格提炼：产品 / 交互 / UI / 智能层实现级摘要

> 范围说明：本文仅提炼 v2.0–v2.5 中仍然有效的产品逻辑、交互规则、UI 参数与智能层规格。3D 建模、渲染管线、骨骼动画、SpringBone 等"虚拟人建模与空间行为"内容已由 v3.0/v4.0/v4.1 文档覆盖，此处仅在涉及交互参数时引用其数值，不展开。

---

## v2.0 — 基础规格（状态映射 / 鼠标联动 / 屏幕遮挡 / UI 体系）

### 1. 产品定位

- 原定位：极简时间记录 + 圆形脸桌宠 → 新定位：**桌面上的二次元工作伙伴**。
- 核心三轴：陪伴轴（同步用户状态）/ 干预轴（摸鱼→拖拽鼠标/遮挡屏幕）/ 融合轴（真实宠物摄像头接入）。
- 三种桌面角色模型：

| 角色 | 渲染风格 | 交互层级 |
|---|---|---|
| 虚拟人 Buddy | 二次元 2.5D（3D+漫画着色） | 高——可遮挡/拖拽/漫游 |
| 真实宠物 Pet | 卡通化 2D（摄像头风格化） | 中——漫游/跟随虚拟人 |
| 桌面精灵 Sprite | 低多边形 3D 小动物 | 低——纯漫游/装饰 |

- 产品名候选：WorkMate / DeskBuddy / FocusFriend / Companion。

### 2. WorkState → 虚拟人行为映射表（文档自称为"30 种状态"，附录 E 实际列出 23 行）

完整映射表（位置 / 姿态 / 表情 / 宠物联动 / 屏幕效果）：

| WorkState | 虚拟人位置 | 姿态 | 表情 | 宠物行为 | 屏幕效果 |
|---|---|---|---|---|---|
| focus | 右下桌前 | 前倾10°打字，打字0.8s周期，2s思考停顿；2°前后微摇2.4s周期；每30s眯眼加深0.5s；每60s肩降+摇头 | 眼眯聚焦、嘴薄线 | 安静坐旁 | 屏幕右侧5%绿渐变条；桌边蓝白微光描边；迷你进度条 |
| coding | 右下贴屏 | 前倾15°狂敲，打字0.5s周期；每8-10s右手移鼠标区2s；3°快摇1.2s周期；急停冻结1-2s | V眉圆眼紧嘴，眼镜反绿光；每20s眼左右扫射 | 坐旁看 | 绿终端粒子；淡语法高亮代码行背景；底部细绿"今日代码行数"进度条 |
| writing | 右下桌前 | 左手笔弧书写2s节奏，右手托腮；每10s抬头2s；每20s笔→键盘模拟打字→回笔 | 右眉抬、嘴微抿、视线左下 | 安静 | 薰衣草蓝光；悬浮半透明文档页+闪烁光标 |
| aiqa | 桌前侧看AI | 一手托腮一手"请求"手势；2s抬手→1s等待→2s点头→1s思考 | 圆眼好奇、嘴微张15%；每5s点头 | — | 紫数据流线；旋转AI神经网络球图标 |
| aidev | 桌前共创 | 左手"接收"右手"筛选"2s循环；前倾8°；每15s对AI图标点头 | 瞳放大、V眉、嘴紧 | — | 左紫右绿分屏全息；紫绿粒子阴阳漩涡；双色光环 |
| meeting | 桌前端正 | 一手讨论手势一手静放；每8s按"发言/聆听"切换 | 注视微笑 | — | 4-6悬浮参会头像圆；红色摄像头指示点；底部会议时间线进度条；金色稳光环 |
| slack(<15min) | 中央左坐地 | 抱手机瘫坐，右倾15°，一腿盘另一腿下；±5°摇2.8s；每15s咯咯笑震；头点1.2° | 眼半闭70%、微笑 | 走近蹭 | 橙粉暖光；社媒通知气泡（心/赞）；浮动时钟"slack time: XX min" |
| slack(15-30min) | 向中心走 | 放手机站起 | 愧疚抬头 | 站旁喵 | 屏障 Phase 1 |
| slack(30-60min) | 中心挡屏 | 双手叉腰站 | 愤怒V眉 | 加入阻挡 | 屏障 Phase 2 |
| slack(>60min) | 中心大面积 | 手展开怒站 | 极怒喊嘴 | 加入 | 屏障 Phase 3 |
| idle | 右下角蜷 | 趴地闭眼，3.6s呼吸循环；每20s眼微颤又睡 | 睡眼、嘴小圆点，Z字母上升 | 蜷旁睡 | 暗暮光、小月亮光源、暗星点 |
| break | 一角休息区 | 握杯后仰5°；每5s抿杯；每8s满足叹气（肩降+更大微笑） | 眯笑腮红 | 走近 | 暖金光；蒸汽粒子；小植物图标 |
| away | 右下角虚化 | 半透明0.7+边缘模糊，身体缩0.95倍 | 空洞半闭 | — | 极暗；WiFi关闭图标 |
| relax | 中央右游荡 | 一手近耳聆听一手摆动；头±5°振荡；每1.2s点头 | 大笑腮红 | 玩耍 | 音符粒子♪♫；耳机图标；极光波纹；暖粉闪粉光环 |
| lunch | 一角用餐 | 一手饭碗筷子，每4s入口；12s后仰伸展（饭困） | 满足笑腮红 | 等食 | 暖琥珀光；饭蒸汽粒子 |
| remote | 桌前双屏 | 左本地右远程双悬浮屏；每3s交替指/接；每5s左右转头 | 警觉嘴微抿 | — | 分屏悬浮+同步箭头；"已连接"绿色脉冲；双青白光环 |
| debug | 贴屏极端 | 一手握额一手急敲；每6s皱眉加深+叹气 | V皱圆眼咬唇 | — | 红脉冲0.8s；红色错误高亮行；虫子图标；告警三角 |
| celebrating | 中心站起 | 拳头高举+微弹跳（上升1px回落）；头发飞扬 | 大笑腮红 | 跳跃 | 金色星爆粒子；五彩纸屑；奖杯/旗帜图标 |
| stressed | 中心 | 双手抱头肩紧缩；身体微颤0.5s周期；每8s深呼吸2s | 内皱圆颤咬唇 | 避开 | 红紊乱脉冲；deadline倒计时；噪音波形粒子 |
| exhausted | 趴桌 | 额贴桌面双手摊开；极慢4s呼吸；挣扎抬头又趴下 | 半闭无力 | — | 极暗月光；深夜时钟23:XX；空咖啡杯；能量粒子下坠 |
| urgent | 贴屏极端 | 前倾20°双手键盘；极快0.5s指速 | 强V皱、瞳缩小、嘴紧 | — | 红0.6s急脉冲；红色警报横条；P0/P1标记 |
| health | 一侧伸展 | 举瓶喝水3s→伸展6s循环；每6s肩抬肩降 | 眯笑腮红 | 看着 | 蓝绿活力光；水波纹粒子；心率正常图标 |
| learning | 桌前看书 | 一手托腮一手翻页；后仰3°；每4s换手；领悟时眼亮+嘴开0.3s+灯泡闪 | 好奇思索 | 坐旁 | 蓝白求知光；书本/笔记图标；知识树粒子 |

默认"家"位置：右下角 widget 区域旁。位置百分比示例（`{x_pct, y_pct}`）：focus `{right:15%, bottom:25%}`；coding `{right:8%, bottom:20%}`；slack-early `{center:40%, left:30%}`；slack-late `{center:50%, center:50%}`；idle `{right:5%, bottom:5%}`；meeting `{right:20%, bottom:30%}`。位置切换 2s 过渡，缓动 `cubic-bezier(0.4, 0, 0.2, 1)`。

### 3. 摸鱼渐进行为（5 级，§3 slack 状态内置时间轴，为遮挡机制的前置）

- 0–5min：开心玩手机，气泡有趣活泼（"摸鱼时间~🐟"）。
- 5–15min：偶尔抬头带微愧疚。
- 15–30min：放下手机、站起来走向鼠标区域，做"该工作了吧"手势。
- 30–60min：走到屏幕中央开始遮挡，"进度赶不上了！！回去工作！"红色愤怒字体。
- >60min：全屏干预——角色占屏幕 30%，画"专注屏障"墙，阻挡鼠标移向摸鱼应用。

摸鱼气泡话术序列："摸鱼时间~ 🐟" →（5min）"这个视频太好笑了哈哈" →（15min）"再刷一会儿就回去..." →（30min）"已经摸了XX分钟了喂！"。时钟 widget >15min 忧虑红，>30min 闪烁红。

### 4. 桌面漫游机制

- 行走动画：2s 过渡、身体 3px 上下颠、腿交替、臂摆、头发物理响应；8 帧行走循环；到达后 0.5s 稳定动画。
- 漫游模式：
  1. **空闲漫游**（idle/away/break）：随机沿屏幕边缘走，每 8–15s 换方向，2px/帧；好奇时走到鼠标位置看 3s 再走开。
  2. **专注驻位**：工作态固定位置，仅状态微动画。
  3. **干涉行走**（摸鱼超阈值）：刻意走向中央/摸鱼区，4px/帧，步伐坚定眉皱，非随机。
  4. **回归行走**（干涉后回工作）：走回桌位，表情轻松/开心，偶见小胜利跳，3px/帧。
- 物理约束：不穿越 widget（绕行）、不覆盖重要 UI、限 5–95% 屏幕范围、Z 序在 widget 后桌面前。

### 5. 鼠标联动 4 级机制

| 级别 | 触发条件 | 反应 |
|---|---|---|
| L0 正常 | 所有工作态默认 | 忽略鼠标；点击角色旁→抬头"嗯？"0.5s 再回活动 |
| L1 好奇 | idle/break/relax 空闲态 | 每 30–60s 走到鼠标位置看 2–3s 再走开；鼠标近角色→头转向+眼跟随（像猫） |
| L2 顽皮 | 摸鱼 >10min | 手指戳光标（纯视觉）、画小圈、连戳 3 次；"还在摸鱼？看看我~" |
| L3 抓取 | 摸鱼 >20min | 手抓光标→光标变"被握住"变体→拖拽远离摸鱼应用，拖距 50–150px，1–2s 后释放；用户 5s 内反抗移回→皱眉摇头放手，60s 后再试；20min 触发一次，35min 再试 |
| L4 阻挡 | 摸鱼 >30min（见 §5 遮挡） | 角色站摸鱼窗口前，手拦截光标（隐形墙）；光标向摸鱼应用减速 0.5×；"不行！进度赶不上了！"红字 |

补充规则：
- 悬停 >5s（任何状态）→ 注视光标 1s 再反应；工作态悬停不反应。
- 点击角色本体：工作态"需要什么？"；空闲态"呀！你点了我~"（惊跳）；摸鱼 <10min"啊，被抓到了~"；>10min"我知道我在摸鱼...但你也一样啊！"；>30min"别点我了！去工作！"并推开光标。
- 技术实现：临时光标位置覆写，50–150px/s 方向力向量、1–2s 衰减；力是建议性非绝对锁定；L4 区间限制力 ~200–300px/s 仍可被坚定移动覆盖；释放后光标回用户意图位置；所有干预写入日志。

### 6. 屏幕遮挡渐进机制（Phase 0–3 + 道德安全）

| Phase | 触发（摸鱼时长 / 专注度） | 表现 | 解除方式 |
|---|---|---|---|
| 0 提醒 | 5–15min，focus>50 | 起身走向中央，"应该回去工作了~"温和字体，指向工作区手势，无遮挡；5s 动画+10s 驻留 | 回工作→开心走回；继续摸鱼→进 P1 |
| 1 软遮挡 | 15–30min，focus<50 | 半透明六角网格屏障覆盖 20–25% 屏幕（定位摸鱼应用窗口），橙黄色、透明度 0.3、0.2→0.4→0.2 每 2s 呼吸脉动；角色屏障后叉手摇头；"已经摸了XX分钟了！专心！"橙字；有 X 关闭按钮 | 点 X→角色皱眉"好吧...但我会再来的"，5min 冷却且下次直接 P2；dismiss 计入日报 |
| 2 硬遮挡 | 30–60min，focus<30 | 扩至 40–50%，透明度 0.5–0.6，六角实心、红光边更亮；角色站屏障前再遮 15–20%；"不行！进度赶不上了！！"红字震动；无 X 按钮；浮动倒计时数字+红色警告三角+敲屏障动画；屏障区内鼠标减速 0.5×；alt-tab 到新摸鱼应用→屏障移位覆盖 | ①切到工作态应用→2s 溶解+角色庆祝；②Ctrl+Shift+F→同溶解；③等 2min→降回 P1 |
| 3 全面封锁 | >60min，focus<15 | 扩至 65–80%，透明度 0.7–0.85，实心红橙块+WARNING 文字；角色危机模式中央展开手臂、跺脚挥手拉屏幕边缘；"❗️紧急专注模式！今日进度严重落后！"大红震动；鼠标锁定工作应用区，摸鱼应用获焦时光标强制移回 | Ctrl+Shift+F 可解；持续工作 5min 自动解除；日报记录 |

- 屏障视觉：六角网格 ~40px/格，从角色位置向外涟漪扩散 1s；色随阶段黄→橙→红；可选轻微"能量场"音效。
- 角色态度递进：P0–1 温和提醒（朋友）→ P2 坚定催促（队友）→ P3 危机警告（PM）。回归后：P0–1"太好了！加油~"；P2"终于回来了..."；P3 疲惫"谢谢...我真的担心进度..."。
- 道德安全：纯视觉不关闭应用/删文件/改系统；Ctrl+Shift+F 始终可逃生；逐 Phase 开关；冷却后下次升级；冷却时长 P0→5min、P1→10min、P2→15min（设置可选 5/10/15/20min）；P3 最长 5min 自动降 P2。
- CSS 参考：`.focus-barrier` 透明度 P1=0.3 / P2=0.55 / P3=0.8；border P1 `rgba(255,184,107,0.5)` / P2 `rgba(255,124,124,0.7)` / P3 `rgba(255,60,60,0.9)`；`backdrop-filter: blur(4px)`；`barrier-pulse 2s ease-in-out infinite`（0.25↔0.35）。

### 7. 多角色管理与宠物融合（交互层保留点）

- Z 序：Layer 3 干预屏障 > Layer 2 虚拟人 > Layer 1 宠物 > Layer 0 精灵 > Layer -1 桌面。单透明 overlay 窗口渲染全部角色，避免多窗 Z 序冲突。
- 状态切换过渡：虚拟人 0.3s morph + 需要时 2s 走位；宠物 1s 简化过渡；精灵不受影响。
- 宠物交互：距离 <100px 触发互动 3–5s（蹭人/摸头/同睡/看工作/联合阻挡）；健康告警 3 级（Low"毛孩子好像有点不安~" / Medium"宠物状态不太对，检查一下？" / High"宠物可能需要关注！请查看"）；摄像头 1 帧/5s，宠物离镜 30s 后头像淡出。
- 角色管理设置 UI：虚拟人（皮肤/干预等级/话语/漫游/鼠标交互开关）、宠物（摄像头/AI视觉/类型/桌面显示/健康告警）、精灵（类型 猫狗鸟龙狐狸/速度/显示）、全局（角色透明度 0.92、干涉冷却、Ctrl+Shift+F 开关）。

### 8. UI 体系（色板 / 磨砂卡片 / 布局 / 动效）

**窗口布局**
- 主窗口 1100×720：顶部 48px 状态栏（StateBadge 动画点脉冲 1.5s + 今日时长 H2 + 迷你 sparkline + 专注环 28px）；左侧 56px 图标导航（20px Lucide stroke，3 组分隔线，active=filled+状态色光晕，hover 放大 1.15×）；底部 32px 角色状态条。
- 内容区状态感知渐变网格：focus `#6bd8a8` 5%、coding `#7c9eff` 5%、slack `#ff7c7c` 8%，2–3 色标，30s 缓慢移位呼吸。
- 视图切换：crossfade 0.25s ease-out，旧视图左滑 20px、新视图右入 20px。
- 悬浮窗 320×420 右下：角色卡（64px 迷你虚拟人+StateBadge+时长+24px 微环）、上下文卡（工作→TipCard / 摸鱼→CheckCard / 会议→InfoCard / 空闲→RestCard / 宠物→PetCard）、操作栏（展开/透明度/打开主面板）。动态背景随状态变色；摸鱼 >180s 整窗透明度渐淡到 0.18。
- 命令面板 560×380，Ctrl+Space；键盘导航 ↑↓+Enter+Esc。

**CSS 变量（v2.0 版，v2.2 有完整升级版）**

```css
--bg-deep:#0a0d14; --bg-surface:#12161f; --bg-elevated:#1a2030; --bg-glass:rgba(18,22,31,0.75);
--border-subtle:rgba(255,255,255,0.06); --border-active:rgba(124,158,255,0.3);
--text-primary:#e8edf5; --text-secondary:#8a93a6; --text-muted:#5a6478;
--accent-focus:#6bd8a8; --accent-work:#7c9eff; --accent-ai:#9b8cff;
--accent-slack:#ff7c7c; --accent-warm:#ffb86b; --accent-meeting:#67e8f9;
--glow-focus:0 0 20px rgba(107,216,168,0.15); --glow-work:0 0 20px rgba(124,158,255,0.15);
--glow-slack:0 0 20px rgba(255,124,124,0.15);
--font-primary:'Inter','Segoe UI',system-ui,sans-serif; --font-mono:'JetBrains Mono','Consolas',monospace;
--radius-sm:8px; --radius-md:12px; --radius-lg:16px; --radius-xl:20px;
--transition-fast:0.15s cubic-bezier(0.4,0,0.2,1); --transition-normal:0.3s ...; --transition-slow:0.5s ...;
```

**glass-card / glass-btn 模板**：`backdrop-filter: blur(12px) saturate(1.2)`、`box-shadow: 0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)`、padding 16px；hover 边框变 active + glow + `translateY(-2px)`；`data-state="focus"/"slack"` 换状态色边框光晕。glass-btn：`blur(8px)`、padding 8px 16px、13px 字体；hover `rgba(124,158,255,0.1)` 背景；active `scale(0.97)`。

**图标体系（Lucide 迁移，24×24 stroke-width 2）**
- 导航：日历=calendar、监控=activity、热度=flame、计划=target、问答=message-circle、画像=brain、角色=cat/user 组合、设置=settings。
- WorkState 徽标：专注=crosshair、摸鱼=fish、写作=pencil-line、编码=code-2、AI问答=message-square、AI开发=robot、会议=video、空闲=moon、休息=coffee、离开=log-out、放松=music、午休=utensils、远程=monitor。
- 新功能：强制专注=shield-check、角色管理=users、干预=shield-alert、阻挡=ban、喝水=droplets。
- App 图标：深色底 `#0a0d14` + 蓝描边 `#7c9eff` + 绿高光 `#6bd8a8`，16/32/48/256 ICO/ICNS。

---

## v2.1 — 交互升级（5 性格 / 拖拽物理 / 点击反馈 / 监控驱动闭环）

### 1. 五种性格角色模板

| 性格 | 名称/外观 | 性格特征 | 话语风格示例 | 干预方式 |
|---|---|---|---|---|
| 专注型 | **ARIA**：银紫短发、细框眼镜、冷静表情 | 专业冷静高效，少情绪化 | 简洁事实，"专注度85%，继续保持""专注度降至40%，建议切换任务" | 数据驱动，最少打扰 |
| 温暖型 | **LUNA**：粉长发、猫耳发夹、圆眼微笑 | 关怀共情鼓励 | "一起/加油/没关系"，"要不要喝杯水？""你看起来有点累了，休息5分钟？" | 情感驱动，可能不够强硬 |
| 毒舌型 | **KIRA**：红橙短发刺、锐利眼、坏笑 | 嘲讽犀利嘴硬心软 | "就这？""你在摸鱼吧我看到了""已经摸了40分钟了，我截图发给老板了（开玩笑）" | 羞耻驱动，最有效但需可调"毒舌程度" |
| 佛系型 | **ZEN**：深绿长发、闭眼微笑、僧侣式平静 | 顺其自然、哲学 | "水到渠成""急什么""休息也是修行~" | 仅温和建议，无屏障，几乎不干预 |
| 严厉型 | **SHIN**：黑短发、方框眼镜、严肃 | 纪律严明结果导向，像严经理 | "现在工作""进度不够""5分钟后我检查进度" | 强力驱动：早期屏障、强阻挡、不可 dismiss；"摸鱼超过10分钟已经触发专注屏障" |

- 表达维度数值（v2.4 §2.2 补全，与性格绑定）：

| 维度 | ARIA | LUNA | KIRA | ZEN | SHIN |
|---|---|---|---|---|---|
| 话语复杂度 | 1行数据 | 2-3行鼓励 | 1行嘲讽+表情 | 1句哲理 | 1行命令 |
| **动画强度** | 微幅 10% | 大幅 80% | 中幅 50% | 微幅 5% | 中幅 30% |
| 粒子特效量 | 0-3 | 10-20 | 5-10 | 0-1 | 0-5 |
| 光环亮度 | 低 0.15 | 高 0.35 | 中 0.25 闪烁 | 极低 0.05 | 中 0.20 快脉冲 |
| UI 色调偏移 | 冷蓝 10% | 暖粉 15% | 活橙 8% 闪烁 | 暗绿 5% | 冷白+红 5% |

- 性格选择器 UI：5 卡片并排，48px 头像+类型标签+一句话 tagline+"试听"按钮（播 3 句样本台词）；选择后模型+话语库+干预配置全切换。
- 可调参数 `personalityTunable`：sharpness 0–100、warmth 0–100、interventionLevel 0–4、speechFrequency 0–100。
- 切换流程：旧角色"退出"动画→2s 淡出→新角色"登场"动画→问候语"你好，我是XX，接下来的工作一起加油吧！"。
- 3D 品质基准（供 v3.x 引用）：8000–15000 面、1024×1024 贴图、4 级 cel-shading、变宽描边（体 1.2px / 面部 2px / 细节 0.8px，描边色取相邻面深色而非纯黑）、眼睛 6 层渲染、头发 3 骨链弹簧；VRM 导入要求 <15000 面、贴图 <2048×2048（导入校验放宽到 <20000 面、<4096×4096 总贴图）。

### 2. 拖拽物理交互

- **检测**：mousedown 命中角色 200×200px 区域（overlay 非穿透时）；顶部 20px 交互条始终可点；或双击 widget 角色卡开 5s 拖拽模式。
- **提起（0.5s）**：表情转"惊讶"、身体浮起 30px、底部能量光环（悬浮托垫）+火花粒子、腿悬挂弹簧摆动。话语：ARIA"移位中。"/LUNA"哇！要带我去哪里？"/KIRA"放我下来！(╬▔皿▔)"/ZEN"随缘移动~"/SHIN"未经批准不得移动！"
- **拖拽中**：跟随鼠标 0.1s 延迟（重量感）、向移动方向倾斜 5–10°、头发拖后、快速移动时光环扩张；每 5s 性格话语（LUNA"好高啊~像飞一样！"/KIRA"你手不酸吗？放我下来！"/ZEN"高处亦是修行"/SHIN"浪费时间！"）；拖到屏幕边缘→"攀附"手抓动画；拖过窗口→落在窗口顶坐着。
- **释放 3 档**：
  - 短落 <50px：轻柔下降、光环淡出、"安全着陆 ✓"。
  - 中落 50–200px：落地反弹 5px 后稳定，涟漪效果。
  - 抛掷 >200px 或快释放：飞行动量、翻滚 1–2 圈、2 次弹跳、大涟漪+3 火花粒子；3s 恢复动画（抖落灰尘）。KIRA"你完了！等我起来你就完了！(╬▔皿▔)凸"/SHIN"无纪律行为已记录！"
- **特殊落点**：桌面区→坐桌工作姿态；角落→蜷缩空闲态；中央→干预待命姿态；widget 旁→靠 widget 边缘。

### 3. 身体部位点击反馈（200×200px 分区）

- **Zone A 头部（上 35%）**：A1 头发（上 10%）→ 整理头发 1.5s；ARIA"发型整理完毕。"/LUNA"啊~被摸头发了...害羞(*/ω＼*)"/KIRA"别碰！好不容易弄好的！"/ZEN"顺其自然~"/SHIN"发型不得随意触碰！"；A2 脸（中 25%）→ 脸红 2s+惊讶；LUNA"呜...脸被碰了...心跳加速(≧▽≦)"捂脸/KIRA"你干嘛！(ﾟДﾟ≡ﾟдﾟ)!?"挥赶/SHIN"面部接触已记录为违纪行为！"；A2a 眼睛→捂眼"你戳我眼睛了！"揉 2s（sleepy 态惊醒 3s 再睡）；A2b 鼻子→揉鼻"别碰鼻子..."；A2c 嘴→捂嘴"唔！"或笑更大。
- **Zone B 身体（中 45%）**：B1 肩→受拍肩动画+向点击侧微倾；LUNA"肩膀拍拍~加油哦！♡"/KIRA"拍肩？你在鼓励我还是在催我？"/SHIN"注意你的手的位置。"；B2 肚子→捂肚"别戳！"（摸鱼态肚子更明显）。
- **Zone C 手（下 20%）**：左手→握手动画，右手→击掌；ARIA"协作确认。"/LUNA"击掌！✧(≖ ◡ ≖✿) 约定一起加油！"/KIRA"啪！...别以为击掌就算和好了"/ZEN"合掌即是缘"/SHIN"非必要接触。"（拒绝）。
- **双击**：停当前活动立正面向用户，"有什么事？"进入 5s 聆听模式；5s 内再点触发 3 轮性格对话（ARIA"指令？"→"请说明需求。"→"收到。执行中。"；SHIN"报告！"→"陈述事项。"→"收到。5分钟内处理。"）。
- **右键菜单**（glass-card）：切换性格/切换皮肤/查看状态/暂停干预30min/安静模式30min/回到桌位/关闭角色。

### 4. 监控驱动智能闭环（InteractionEngine）

- 架构：`src/main/interactionEngine.ts` 主进程，每 5s 评估触发器（与监控同频），按 priority 降序、每周期只发最高优先级一个；IPC 通道 `interaction:trigger / interaction:response / interaction:estimateTask / interaction:updatePlan`。
- `InteractionState` 字段：currentWorkState、focusScore(0–100，presence.ts 每 5min 算）、stateDurationMin、totalWorkTodayMin、totalSlackTodayMin、dailyPlan、meetingSchedule、progressPercent、estimatedLeaveTime、isOnTrack、riskLevel、continuousWorkMin、lastHealthBreakTime、personality、history（30 天）。
- `InteractionTrigger` 结构：`{id, name, condition, action, cooldownMs, priority(0–10), lastFired}`；Action 类型：speech / dialog / barrier(1|2|3) / position / animation / composite。
- **9 大触发器**：

| # | 触发器 | 条件 | 动作要点 | 冷却 | 优先级 |
|---|---|---|---|---|---|
| 1 | 下班时间预测提醒 | now > estimatedLeaveTime−30min 且工作中 | "预计今天XX:XX可以下班，当前进度YY%，继续加油~" | 30min | 3 |
| 2 | 下班前加班确认 | now > estimatedLeaveTime 且进度<70% 且工作中 | glass 弹窗：预计下班已到/进度YY%/还差ZZ%/估计还需WW分钟；[继续加班][准备下班][调整计划]；忽略 5min→性格催促（SHIN"30秒内未决策将默认继续加班"） | 每日一次 | 8 |
| 3 | 摸鱼进度预警 | slack>10min 且 isOnTrack=false | "⚠️ 摸鱼已XX分钟 \| 今日进度YY% \| 计划进度ZZ% \| 落后了AA%"；5min 未回→二次警告（15min）+方案[加班XX分钟][削减非核心任务][明日补齐] | 10min | 7 |
| 4 | 任务时长预估问答 | 切换到新 WorkState 2min 后 | "这个任务大概还需要多久？"[30分钟▼][1小时][2小时][自定义]；跳过→用历史均值；预估时间到→"完成了吗？"[已完成✓][还需要一会儿][比预期复杂] | 15min | 5 |
| 5 | 定期进度汇报 | 连续工作每 60min | "📊 进度汇报 \| 已工作XXh YYm \| 专注度ZZ \| 进度AA%" | 60min | 4 |
| 6 | 连续低效告警 | focus<30 连续 3 个 5min 区间（15min） | "🔴 连续15分钟低效"＋[切换任务][休息5分钟][强制专注模式(=Phase1屏障)] | 15min | 9 |
| 7 | 会议前提醒 | 会议 15min 内且非会议态 | "📅 XX:XX有会议「标题」，还有YY分钟" | 每会议一次 | 8 |
| 8 | 健康提醒 | 连续工作 >60min 无休息 | "💧 已经连续工作XX分钟了！"[喝水3分钟][站立5分钟][眺望远方][继续工作(不建议)]；选继续→15min 后再提醒；SHIN 强制 3min 休息 | 15min | 6 |
| 9 | 鼓励与里程碑 | ①focus≥90 持续 30min；②总工时达 4h/6h/8h；③预估任务完成；④摸鱼回归前 10min | 性格化庆祝；"回来了！专注加分+10 🎯" | 每里程碑一次 | 2 |

- **下班时间算法**（`leaveTimeCalculator.ts`，每 5s 跑）：
  1. plannedTotal = Σ PlanItem.estimatedDuration；
  2. completedWork = totalWorkToday（仅工作态分钟）；
  3. remainingWork = plannedTotal − completedWork（负→可下班）；
  4. efficiencyFactor = avgFocus(today)/100；adjustedRemaining = remainingWork / efficiencyFactor；
  5. buffer = 15min；
  6. estimatedLeaveTime = now + adjustedRemaining + remainingMeetingTime + buffer；
  7. 与 normalLeave（默认 18:00，历史学习）比较→overtimeMinutes。
  进度可视化颜色：中午时进度 <50% 红 / 50–70% 黄 / >70% 绿 / >90% 亮绿（"可以提前下班~"）。
- **多轮确认流**：①加班确认 3 轮（到点→+1h→+30min）；②摸鱼回归 3 轮（5min 温和→15min 关切→20min 干预计[我自己回去][帮我专注模式][调整计划]）；③任务完成 3 轮（预估到→新预估→再确认）；④健康休息 3 轮（60min→75min→90min，90min SHIN 强制 3min）。所有弹窗忽略 5min 后按性格默认选择（ARIA/ZEN=继续，LUNA=温和休息，KIRA=再催，SHIN=强制执行"正确"选项），全部记入日志。

---

## v2.2 — 报表 / 规划 / 日历三视图 + 悬浮窗 + 设计系统

### 1. 报表 Hub（ReportView，4 子标签）

- 架构：MonitorView 只留实时脉搏（当前状态卡+专注环+轨迹条+迷你3行快讯）；HeatView/AIView 可并入报表子标签。
- **日报**：①顶栏 48px（glass 日期选择器+今天+导出/分享）；②总览英雄卡 120px 4 列：总工时 28px/700 accent-green（"计划8h·达成率84%"+微环28px）/ 专注环 80px 动画（绿>80→黄50-80→红<50）/ 摸鱼时长 28px accent-red+趋势箭头 / 效率评分 28px accent-blue；③状态分布卡：左 40% SVG 甜甜圈（0.5s 增长动画、hover tooltip）+右 60% 状态表格（徽标/时长/8px 百分比条/趋势，≤8 行滚动）；④24h 时间轴 64px 高（渐变段+内发光，hover tooltip，点击 zoom 到 5min 级）；⑤峰谷分析卡（高效/低效时段 chips+微折线，最佳绿边框）；⑥双屏洞察卡（主/副屏 top3 应用+4 并行模式指标：常态双屏%/主工作副摸鱼%/双屏工作%/双屏摸鱼%）；⑦AI 洞察卡（可折叠，3 条 emoji 发现 💡⚠️🎯）；⑧行动建议卡（3–5 条+"执行"按钮，摸鱼时首条紧急样式）；底栏：生成 PDF/分享/对比昨日 overlay。
- **周报**：周选择器+vs上周对比；3 列总览（总工作/平均专注/达成率）+7 天 sparkline 行（60×24px）；7 天堆叠柱状图（圆角渐变、今天发光边框、上周透明叠加）；7×24 热度矩阵（每 2 小时标签，自动检测专注区绿框/摸鱼区红框）；模式检测卡（AI 模式描述+[高/中/低置信] chip + vs上周变化）；周成就卡（🏆连胜/突破/提升徽章+未达成灰化+月度目标进度）；下周预测卡（"预计34h(±2h)"+建议+风险）。
- **月报**：4 列总览（总工时/平均专注/达成率/AI 用量）；30 天 calorie map（5×6 网格、GitHub 风格、绿4→灰、今日脉冲边框）；3 张趋势图（工作时长 area 渐变绿 / 专注度 line 绿黄红变色+虚线均值 / 摸鱼 bar 圆顶红），各 200px 高；目标追踪卡（ProgressRing 80px，绿达成/黄接近/红远）；月度 AI 总结；导出 PDF/CSV。
- **自定义**：范围选择（近7/30/90天/今年）+对比周期+粒度 5min/15min/1h/1day；动态图表区 400px（SVG，hover 十字线，Y 轴切换 工时/专注/摸鱼比）；指标多选 sidebar（工作时长/专注度/摸鱼占比/AI使用/达成率）；对比 overlay（虚线 muted vs 实线 + "+8%" badge）；导出 PNG/CSV/PDF/剪贴板。

### 2. 规划 3 模式驾驶舱（PlanView）

- **规划模式**（早晨）：日期栏+AI规划按钮+导入下拉；**日时间轴画布 180px**（核心创新）：24h 水平轴、计划块=可拖拽彩色矩形（宽=时长、色=类别 AI开发紫/客户蓝/领导橙/个人绿/其他灰）、拖动改时间/拖边改时长/点击内联编辑/双击标完成、重叠双层叠放、空位虚线框、"now"发光竖线、底部"已规划 Xh/24h·空闲 Yh"；详情面板（标题/起止/时长/类别 radio pills/优先级 3 点高中低/WorkState 映射/备注）；AI 规划助手（自然语言→解析建议[接受✓][修改✎][忽略✗]+"基于历史模式优化安排"开关）；快捷添加条（Ctrl+N）；导入模态（自然语言/oner 同步/日模板：标准工作日/会议密集日/冲刺日）。
- **执行模式**（实时）：实时状态条（当前 WorkState+匹配计划名）；**双层时间轴 240px**：上 40% 计划块、下 60% 实际轨迹、now 线贯穿；匹配指标 ✓ 绿=实际覆盖≥80%且状态匹配 / ⚠ 黄=50–80%或状态不符 / ✗ 红=<50% / ○ 灰=未开始；中间 alignment strip（每项 20px 色块）；hover"计划: 编码3h | 实际: 编码2h15m + 摸鱼45m | 达成率75%"；3 列实时指标（达成率环 80px/剩余计划/预计完成时间）；计划项卡（匹配指示+实际vs计划+摸鱼红脉冲边框+"摸鱼中，该任务进度落后⚠"）；浮动提醒（"摸鱼中但3项未完成"等，[确认][推迟][跳过]）。
- **复盘模式**（傍晚）：达成率英雄（120px 环，≥90% 🏆金/≥80% ✅绿/<50% ⚠️红）；顺利/未完成双列+AI 归因；时间审计饼图（计划/摸鱼/空闲/会议溢出）；明天预览建议+"采纳建议→规划明天"；今日感想 textarea。
- **PlanItem 数据模型新增字段**：priority、expectedState、actualStartMin/actualEndMin/actualDurationMin/actualState、matchScore(0–100)、notes、tags、breakMin、bufferMin、parentId、order；状态枚举扩展为 planned/in_progress/paused/done/cancelled/partial。
- **matchScore 公式**：`timeCoverage×0.5 + stateMatch×0.3 + durationMatch×0.2`；stateMatch：匹配=1.0、相关=0.5、无关=0.0；durationMatch = min/max(actual, planned)。`predictedEndTime = now + remainingPlannedMin / currentEfficiencyRate`；`dayAchievementRate = ΣmatchScore / 非取消项数`。

### 3. 日历 3 视图（CalendarView）

- **日视图**：导航条（[<][>]+日期下拉+日/周/月 pills+过滤）；统计条 chips（总工作/摸鱼/专注/双屏，点击滚动到对应段）；**增强时间轴 ≥200px**：双行（主屏+副屏）、段=渐变圆角矩形（宽按时长、min 12px、高 70px/行、含 emoji 16px+短标签+状态色发光边框）、hover 浮起 4px+tooltip（含编辑/删除）、点击内联详情面板、空位虚线"点击补录"、now 蓝发光竖线、当前段脉冲边框 1.5s；**5min 级 zoom**（点小时→12×5min 块、48px/块）；**AI 补录表单**（快速模式：智能时间填充+AI 建议"此时段你通常：编码65%/写作20%/会议15%"+状态 4×3 视觉网格+标题 AI 补全+Ctrl+S 保存；自然语言模式："上午9点到10点半写PRD"→全字段解析）；录入列表按状态分组可折叠、hover 同步高亮时间轴段；7 天迷你柱（渐变、今日蓝发光边框、微专注点）。
- **周视图**：7 列×24 行网格（40×30px 格，主导态着色、透明度=活跃度）；周概要条（每天 60px 迷你条+总时长+专注 chip）；"vs 上周"透明叠加。
- **月视图**：传统月历 7×5-6 格（80×60px/格：日期+迷你时间轴 60px+专注点+总时长）；月统计（工作/平均专注/达成率+30 点 sparkline+最佳周）。
- **全局**：过滤面板（状态/应用/时长滑块/来源）；Cmd/Ctrl+F 搜索；虚拟人同步（hover 段显示 40px 迷你角色）；**"重播今天"**：60s 动画回放、1 真实小时=2.5s、控制[播放][暂停][快进2x][跳到现在]；导出 CSV/JSON/PDF/截图 PNG/分享图。
- 数据结构：CalendarDaySummary（totalWorkMin/totalSlackMin/focusScore/dualScreenMin/dominantState/peakHour/dipHour/entryCount/achievementRate/stateDistribution）、CalendarWeekSummary、CalendarMonthSummary（含 trendDirection）、EnhancedTimeEntry（appId/confidence/virtualPersonState/planItemId/tags）。

### 4. 悬浮窗上下文卡（320×420 任务舱）

- 顶栏 40px：迷你虚拟人 48px（点击→BuddyView）+StateBadge sm+时长+应用名+迷你专注环 28px+展开按钮。
- 上下文卡 120–160px 按状态切换：
  - ON-PLAN：计划标题+类别 chip+"计划3h·已做1h45m·还需1h15m"+迷你进度条+"预计完成15:30"。
  - SLACKING：accent-red 警告边框+"⚠ 当前: 摸鱼中"+"计划还有3项未完成"+"进度落后15%—预计加班到19:00"+[回到工作][推迟计划][接受落后]+虚拟人愤怒脸。
  - IDLE：建议样式+"空闲中·建议开始一项任务"+未开始 top3+[开始任务N]+无聊脸。
  - BREAKING：放松样式+"休息中·已休息15m·建议休息30m后继续"+"距离下一个计划项还有20分钟"。
- 智能提醒 60px 浮动卡：仅关键时刻（"摸鱼超过15分钟—进度可能完不成"/"距离会议还有10分钟"/"今天的工作已完成! 🎉"），10s 自动消失，优先级队列最多 1 条。
- 快操条 40px：4 图标[计划][日报][补录][设置]。
- 虚拟人区 60px：40px 迷你角色在微型桌面行走，点击挥手、拖拽提起；摸鱼 >30min 红脉冲边框、专注 >1h 绿发光边框。

### 5. 图标体系映射表（v2.2 版）

- 导航分组：时间=日历 calendar-days/监控 activity；分析=热度 flame/报表 bar-chart-3/画像 brain；规划=计划 target/问答 message-circle；伙伴=桌宠 cat；系统=设置 settings。样式：默认 stroke `#5a6478`；hover filled `#8a93a6` 放大1.1×+光晕；active filled+状态 accent 色+8px 圆形光晕。
- 应用图标：VSCode=code-2、Chrome=globe、微信=message-circle、Word/Excel=file-text/table、Terminal=terminal、Slack/Discord=hash/gamepad-2、Figma=palette、默认=app-window；实现于 `src/renderer/src/lib/appIcons.ts`。
- 状态图标：focus=focus、coding=code-2、writing=pen-line、meeting=video、aiqa=sparkles、aidev=robot、slack=coffee、idle=moon、break=cup-soda、away=log-out、relax=music、lunch=utensils、remote=wifi。
- 动作图标：add=plus、edit=pencil、delete=trash-2、save=check、cancel=x、export=download、share=share-2、search=search、filter=filter、refresh=refresh-cw、expand=expand、collapse=minimize-2、alert=alert-triangle、info=info、success=check-circle、warning=alert-circle。

### 6. CSS 变量体系（v2.2 完整版，原样保留）

```css
/* 背景 */ --bg-deep:#0a0d14; --bg-surface:#12161f; --bg-elevated:#1a2030;
--bg-glass:rgba(18,22,31,0.75); --bg-glass-heavy:rgba(18,22,31,0.88); --bg-hover:rgba(26,32,48,0.6);
/* 边框 */ --border-subtle:rgba(255,255,255,0.06); --border-default:rgba(255,255,255,0.08);
--border-active:rgba(124,158,255,0.3); --border-danger:rgba(255,124,124,0.3); --border-success:rgba(107,216,168,0.3);
/* 文本 */ --text-primary:#e8edf5; --text-secondary:#8a93a6; --text-muted:#5a6478;
--text-accent:#7c9eff; --text-danger:#ff7c7c; --text-success:#6bd8a8;
/* 状态色 */ --accent-focus:#6bd8a8; --accent-work:#7c9eff; --accent-ai:#9b8cff; --accent-slack:#ff7c7c;
--accent-warm:#ffb86b; --accent-creative:#ff6b9d; --accent-urgent:#ff4444;
--accent-success:#6bd8a8; --accent-neutral:#8a93a6;
/* 光晕 */ --glow-focus:0 0 20px rgba(107,216,168,0.15); --glow-work:0 0 20px rgba(124,158,255,0.15);
--glow-ai:0 0 20px rgba(155,140,255,0.15); --glow-slack:0 0 20px rgba(255,124,124,0.15);
--glow-warm:0 0 20px rgba(255,184,107,0.15); --glow-danger:0 0 20px rgba(255,68,68,0.2);
--glow-success:0 0 20px rgba(107,216,168,0.2);
/* 字体 */ --font-primary:'Inter','Segoe UI','SF Pro Display',system-ui,sans-serif;
--font-mono:'JetBrains Mono','Fira Code','Consolas',monospace;
--font-size-h1:20px; --font-size-h2:16px; --font-size-body:13px; --font-size-caption:11px; --font-size-mini:9px;
--font-weight-normal:400; --font-weight-medium:500; --font-weight-bold:600; --font-weight-heavy:700;
/* 间距 */ --space-xs:4px; --space-sm:8px; --space-md:16px; --space-lg:24px; --space-xl:32px; --space-2xl:48px;
/* 圆角 */ --radius-sm:8px; --radius-md:12px; --radius-lg:16px; --radius-xl:20px; --radius-full:9999px;
/* 阴影 */ --shadow-card:0 4px 24px rgba(0,0,0,0.3); --shadow-card-hover:0 8px 32px rgba(0,0,0,0.4);
--shadow-elevated:0 12px 48px rgba(0,0,0,0.5); --shadow-inset:inset 0 1px 0 rgba(255,255,255,0.04);
/* 动效 */ --transition-fast:0.15s cubic-bezier(0.4,0,0.2,1); --transition-normal:0.3s cubic-bezier(0.4,0,0.2,1);
--transition-slow:0.5s cubic-bezier(0.4,0,0.2,1); --transition-bounce:0.4s cubic-bezier(0.34,1.56,0.64,1);
/* 层级 */ --z-base:0; --z-card:10; --z-hover:20; --z-dropdown:30; --z-tooltip:40;
--z-alert:50; --z-modal:60; --z-overlay:70; --z-virtual-person:80;
```

### 7. 3 级动效体系

- **Level 1 结构级（0.3–0.5s）**：视图切换 fade-out 0.15s→fade-in 0.15s+右滑 20px；tab 切换 0.2s 交叉淡入+内容交错；模态 0.95→1.0 scale 0.2s。
- **Level 2 组件级（0.2–0.3s）**：卡片 hover translateY(-2px)；卡片 mount fade+translateY(8px→0) 0.3s 交错；ProgressRing 0.5s 缓动；徽标切换 0.15s+0.15s；时间轴段 hover -4px；计划块拖拽 scale(1.05)+opacity 0.9。
- **Level 3 微动效（0.1–0.15s）**：按钮 hover scale(1.02)、press scale(0.97)；chip hover scale(1.05)；图标 hover scale(1.15)；tooltip fade+translateY(4px→0) 0.1s；提醒滑入/滑出 0.2s。
- 虚拟人动效：状态切换 0.3s morph；点击反应 0.5s；走到中央 1.0s+气泡 0.5s；庆祝 1.5s。
- 性能规则：L1–2 用 CSS（transform/opacity）；L3+虚拟人用 rAF 30fps，窗口最小化暂停；并发上限 3 结构+5 组件+微动效不限；遵守 `prefers-reduced-motion`（时长→0.01s）。
- 组件升级要点：ProgressRing 尺寸 28/60/80/120px、渐变弧（专注 `#6bd8a8→#4ade80`、摸鱼 `#ff7c7c→#ef4444`、工作 `#7c9eff→#3b82f6`）、虚线背景轨+50%/80% 刻度+值变脉冲 1.05×；StateBadge 尺寸 sm/md/lg、模式 dot/bg/glow、active 脉冲 1.5s；Card 变体 default/active/hero(padding 24px radius 20px)/mini(8px 12px radius 12px)；EmptyState 120×80px 线条插画（stroke `#5a6478` 1.5px）+16px/600 标题+13px 建议+微动画。

---

## v2.3 — 导航重组 / 启动仪式 / 头顶指示器 / 情景问答 / 性能降级 / Oner 同步 / 一天流程

### 1. 导航重组：5 核心 + 2 全局 + 1 设置

- **5 核心**（左侧 56px）：📅 日历（合并热度角落模块）、📊 监控（合并双屏分析主线）、🎯 规划（待办+计划+Oner 同步）、📈 报表（日报周报月报+合并 AI 画像）、🐱 桌搭（角色+场景+交互设置）；分隔线下 ⚙ 设置（AI 配置/资源监控/高级）。
- **2 全局**：Cmd+K / Ctrl+K 全局问答；虚拟助理常驻桌面。
- 旧→新映射：热度→日历角落（7×24 迷你热力图）；问答→Cmd+K；画像→报表 AI 洞察；桌宠→桌搭；设置→增强。

### 2. 启动仪式 4 阶段（8–15s）

- **Phase 1 系统唤醒（0–3s）**：全屏暗场 `#0a0d14`+网格线 `rgba(124,158,255,0.02)`→0.05；虚拟人休眠态淡入至透明 0.6（0.5s）、呼吸 3.6s 周期；环境光点 0.3 透明度；2.0s 底部"WorkOn 系统唤醒中..."（caption、accent-blue）；3.0s 网格脉冲一次（0.05→0.1→0.05，0.3s）。后台执行性能检测（CPU 当前+5min 均值/内存可用 GB/WebGL/显示器数/当日首次），写入 `animationLevel = 'full'|'medium'|'minimal'`。
- **Phase 2 虚拟人觉醒（3–6s）**：透明 0.6→1.0（0.5s）→眼闭合→半开（0.3s）→全睁看用户（0.3s）→微笑（0.2s）→伸展（0.5s）→性格问候（ARIA"系统就绪。专注度昨日均值82%..." / LUNA"早安~ 今天又是元气满满的一天哦！(≧▽≦)" / KIRA"醒了？别想摸鱼，我在看着你。(╬▔皿▔)←" / ZEN"嗯...新的一天，顺其自然吧~" / SHIN"07月21日。昨日达成率84%。今日目标：90%。开始工作。"）；背景转深空星点，色温暖橙→冷蓝白 1s。
- **Phase 3 初始化问答（6–12s，可跳过）**：280×200px glass 对话面板。问题1（必问）"今天有什么计划？"→自然语言→AI 实时解析预览（"检测到3项计划：✎完成PRD文档|预计2h|写作|建议09:00-11:00 ..."）[全部采纳][逐条调整][跳过]；快选[沿用昨日计划][从Oner同步][空白开始][AI推荐计划]。问题2（智能）：昨日摸鱼>30min→"要不要设置专注提醒？"；昨日加班→"今天确保按时下班？"；连续3天达成率<70%→"建议精简计划"。问题3：角色切换[ARIA/LUNA/KIRA/ZEN/SHIN][沿用默认]（0.3s morph）。右上[跳过启动仪式]；设置可配 每次/仅首次/关闭。
- **Phase 4 进入工作（12–15s）**：方式A 科幻进入（默认）——对话面板收起→虚拟人站中央→数据粒子环从中心扩散到边缘 1.0s→界面从边缘向中心"生长"（导航 0.3s stagger→日历 scale 0.8→1.0 0.5s→状态条滑入 0.2s）→虚拟人弧线走位到预设位 1.0s（身体前倾+头发后飘）→0.2s bounce-settle→恢复状态表情。方式B 直接进入：0.3s 总过渡。预设位置 localStorage 记忆，首次=右下距边 40px。初始视图=日历（含计划块标注）。
- **当日复启（3–5s）**：0.3s 暗场→虚拟人以当前状态淡入 0.5s→简短问候（KIRA"又回来了？废话少说干活。(눈_눈)" / SHIN"归位。剩余任务3项。继续执行。"）→0.3s 界面直入；无问答无科幻动画。若离开 >2h：先显示"你离开了2小时"，问"这段时间做了什么？需要补录吗？"[补录][不需要]。

### 3. 头顶状态指示器系统（6 种，位置=头顶正上方 20px）

| 指示器 | 适用状态 | 视觉参数 | 阈值行为 |
|---|---|---|---|
| ①番茄倒计时环 | 专注/编码/写作/AI开发 | mini ProgressRing 24px+"12:35"；accent-green；时长可选 15/25/30/45/60min | <5min 变黄+文字微放大；=0 环消失+"完成"表情 0.3s+微提醒[休息5分钟][继续下一个][跳过] |
| ②摸鱼计时器 | 摸鱼/放松 | 红色纯数字"摸鱼 15:42" accent-red | >15min 脉冲闪烁 1.5s；>30min 数字变大+愤怒脸；>60min 占满头顶+叉腰 |
| ③会议剩余 | 会议 | mini ProgressRing 24px+"会议 32:15" accent-warm；数据源=会议 PlanItem 时长 | <5min 变黄+"快结束了"微表情 |
| ④任务进度条 | AI开发/调试等长任务 | 40×6px 水平条+"编码 67%"；accent-blue→accent-green 渐变；数据=matchScore | 100%→闪烁 0.3s+庆祝 |
| ⑤空闲气泡 | 空闲/离开 | "💤 空闲" | >10min 气泡变大+显示时长 |
| ⑥通用徽标 | 默认 | StateBadge mini（色点+emoji+标签） | — |

- 切换动画：旧 0.15s 淡出→新 0.15s 淡入；番茄环 0→满弧 0.5s；摸鱼数字跳字 0.3s/字（机械翻牌）。
- 点击指示器→详情面板：番茄[暂停][重置][跳过][调整时长]；摸鱼[回到工作][记录摸鱼原因][设置提醒阈值]；会议[提前结束][延长15分钟][记录会议要点]。

### 4. 情景感知问答（4 级情景 + 触发器）

| 情景等级 | 识别条件 | 问答行为 |
|---|---|---|
| 深度专注 DND | focus/coding >15min 连续、专注度>85、无鼠标移动 | 完全静默；仅紧急打断（会议/P0）；指示器正常；问题暂存队列 |
| 一般工作 Low Freq | focus/writing/meeting、专注度 60–85 | 每 30min 最多 1 次；只问高价值 |
| 空闲/摸鱼 High Freq | slack/idle/break/away、专注度<60 | 每 5min 可触发；催促+建议 |
| 紧急打断 Override All | 任何时间：会议即将开始/P0-P1告警/加班确认/健康提醒 | 立即走到屏幕中央+半透明遮挡+必须确认才消除 |

- **6 个触发器**（注意：v2.3 正文列了 6 个，与 v2.1 的 9 个触发器并存互补）：
  1. 会议即将开始（前 10min）：走到中央 1.0s+200×100 面板"⚠ 团队会议将在10分钟后开始"[准备进入会议][推迟5分钟][跳过此次]；推迟→5min 后再提醒。
  2. 摸鱼回归（>15min）：原位气泡 8s 自动消失（性格话术，如 KIRA"15分钟了。你要笑死我吗？(╬▔皿▔)凸 进度还剩62%你忘了？"）；30min→走到中央+20% 六角屏障+强制确认[立即回到工作][再休息10分钟][今日放弃该任务]。
  3. 进度预加载（focus/coding>30min 且有未完成计划）：温和气泡"当前编码任务还需多久？"[大约30分钟][大约1小时][不确定]→记录→到点确认→学习预估偏差。
  4. 加班确认 3 轮：第1轮（到预测下班时间，走到屏幕右侧）"剩余任务2项...预计加班1小时可完成核心任务"[继续加班][今日结束][只完成PRD后下班]；第2轮（+1h）给建议；第3轮（+2h）"专注度下降至52%...⚠强烈建议结束今日工作"[结束工作][坚持完成(变灰需二次确认)]。
  5. 健康提醒（连续工作>1h）：喝水手势+"站起来活动一下？"[休息5分钟][稍后再说(50min后再提)][忽略此类提醒]。
  6. 不确定性问答（AI 检测异常：编码态但频繁切窗/会议态无视频应用）："检测到你频繁切换窗口，效率偏低。是遇到了什么问题吗？"[遇到了bug(自动延长预估)][在查资料][误检测(记录校准，下次不再触发)]。
- **问题暂存队列**：深度专注期间问题不丢弃，退出时一次性处理"之前攒了2个问题：..."；最多暂存 3 个，超出丢弃最旧。
- 问答记录用途：回答偏好分析（总选"稍后"→降频）、预估偏差校准、加班决策模式、月报"交互洞察"。

### 5. 各核心视图补充（v2.3 增量）

- 日历：增加计划块叠加（虚线框=计划、匹配→实线绿边、不匹配→实线红边+虚线）；热度角落 160×120px（7×24 格 6×4px，当前小时蓝框，点击跳天；展开→全宽 200×140px 显示 14×24+图例）；计划同步指示条。
- 监控：当前状态英雄卡 80px（48px 虚拟人+徽标+应用+专注环 60px+头顶指示器预览）；双屏主线（主屏条+副屏条各含 30min 轨迹 strip 6×5min 色块+28px 微环；并行模式标签"并行·双屏工作32%·主工作副摸鱼15%·双摸鱼3%"；单屏模式建议）；3 指标卡+vs昨日箭头；24h 轨迹 strip 40px；支线展开区（默认折叠"支线活动·摸鱼1次15m·休息1次10m"，主线=匹配 PlanItem 的工作态）；嵌入 32px 迷你虚拟人。
- 报表：日报 AI 洞察模块吸收原 AIView 全部能力；**导出摸鱼排除选项**（[✓]包含摸鱼数据/[✗]排除→显示"纯工作时长5h24m"）；周报加 AI 工作模式总结（"晨型人·编码型·双屏并行者"）。
- 桌搭视图：5 角色卡（120×80px，外观描述：KIRA 红黑短发+皮夹克、SHIN 银白短发+方框眼镜+西装外套等）；**20 项场景能力开关表**（桌面漫游/鼠标追逐/鼠标拖拽互动/遮挡屏幕/遮挡强度滑块/番茄倒计时/番茄时长15-60/情景问答/问答频率滑块/健康提醒/真实宠物/桌面精灵/启动仪式/头顶指示器/点击身体反馈/文字气泡/声音反馈/触发不准确动作(每10-15min一次0.5-1s)/紧急遮挡）；遮挡配置（模式 4 选：六角网格屏障/渐变雾罩/角色走挡/进度锁屏；时机：>15min 20%/>30min 40%/>60min 80% 可自定义；解除：点击确认/输入文字/倒计时30s）；鼠标互动级别 0–4 级选择；角色大小 64/96/128/自适应；角色预览区 240px（128px 角色+8 表情卡）；场景切换（标准办公桌/简洁木桌/赛博终端/日式和室/咖啡角，40px 高）。
- 设置视图：AI 配置（提供商[本地GGUF][DeepSeek][GLM-4][通义千问][Ollama][LM Studio][自定义API]+端点/密钥/模型/温度0.0-1.0/最大Token）+测试面板（连接状态/响应速度"平均2.3s"/4 项功能测试/费用估算"~50次·~0.15元/天"）+一键诊断；资源监控表（CPU/内存/GPU/WorkOn内存180MB/虚拟人15000面30fps/数据库45MB/磁盘）+动画级别单选+自动降级开关（CPU>60%）+清理数据库（>30天原始数据保留摘要）+重置虚拟人；CPU>60% 弹 toast[自动降级][保持当前][手动降级]；通用设置（启动设置/默认角色/默认视图/番茄时长/热度角落/Oner同步/数据保留30-90天-永久/主题/语言）。

### 6. 全局问答 Cmd+K

- 面板 560×380px 居中，blur(20px)+淡黑遮罩；顶栏 48px（24px 头像+角色名）；3 行 textarea auto-focus，placeholder 随情景（专注"专注模式中，仅紧急问题可打断..."/摸鱼"该回到工作了...不过你可以问我任何事"）。
- 快速建议 chips 随情景：专注["还需多久？""遇到问题了""紧急打断"]；一般["今日进度""下一个任务""效率分析"]；摸鱼["回到工作""摸鱼多久了""进度落后多少"]；空闲["今日计划""昨天总结""角色切换"]。
- 回答=角色头像+性格语气+数据；多轮 5 轮上下文，超出→"查看完整分析→报表"。
- 心情切换："换个角色/今天想被温柔对待"→角色面板→立即切换语气（KIRA→LUNA："你终于受不了我了？行。(눈_눈)"→"我来陪你啦~温柔模式启动！(≧▽≦)"）。
- 数据源声明："屏幕活动监控+应用使用记录+计划进度+历史模式""不会访问文件内容或私密信息"。
- 深度专注唤起：显示"⚠ 专注模式—仅紧急问题"，含"会议/紧急/bug/告警"关键词立即处理，其余暂存；摸鱼时第一 chip="回到工作"。Esc/点遮罩/✗ 退出。

### 7. 性能感知渲染降级 4 级

- 检测：启动 1 次+运行每 60s 1 次+手动。指标：cpuUsage、memoryAvailable、gpuAvailable、gpuPerformance、monitorCount、fps。
- **切换阈值**：full→medium：CPU>50% 持续5min 或 内存<3GB 或 fps<25；medium→minimal：CPU>70% 持续5min 或 内存<1.5GB 或 fps<15；minimal→medium：CPU<40% 持续5min 且 内存>3GB；medium→full：CPU<25% 持续5min 且 内存>5GB 且 fps>28。0.3s 平滑过渡+toast 通知；手动可覆盖。
- **各级规格**：
  - FULL：15000 面+4级 cel-shade+SSS+变宽描边+6层眼睛；30fps+头发物理；满粒子；六角屏障+光效；全 glass+blur+glow；科幻启动仪式。
  - MEDIUM：8000 面+3级着色+2级描边；24fps；粒子减半；渐变雾罩替代六角网格；减 blur 简化 glow；启动仪式去粒子环。
  - MINIMAL：3000 面+2级着色+无描边；15fps+3级表情（开心/中性/不开心）；无粒子；角色走挡（纯移动+半透明 overlay）；基本 card 无 blur/glow；直接进入 0.3s。
  - CRITICAL（CPU>85%）：静态 PNG sprite 3 帧表情+无 3D；仅 0.2s 状态切换；0.7 透明度灰遮罩；弹"系统资源极度紧张，WorkOn已切换到极简模式"[保持极简][关闭WorkOn释放资源]。

### 8. Oner 双向同步协议

- 三种方式：本地文件同步 / API（REST/WebSocket）/ 插件桥接。
- **WorkOn→Oner**：①任务完成推送（`{extId, status:'done', actualDuration, focusScore, workState, notes}`，文本格式"✅ [标题] 已完成 | 实际耗时2h15m | 专注度87%"）；②取消推送（"❌ ...已取消 | 原因：..."）；③每日小结（`{date, totalWorkMin, totalSlackMin, focusScoreAvg, achievementRate, completedTasks, cancelledTasks, unfinishedTasks, aiInsight}`，"📊 今日工作6h42m·达成率84%·专注度均值78"）；④状态实时推送（可选，`{currentState, currentApp, duration}`）。
- **Oner→WorkOn**：①待办同步（启动/手动/每30min定时）→生成 PlanItem(source='oner', extId)；②任务更新同步；③标签映射（可配置）：编码/开发/code→aidev、文档/writing/写→writing、会议/meeting/会→meeting、客户/client/客→client、个人/personal/个→personal、未匹配→other。
- 冲突处理：以最后修改时间为准；时间差<5min→提示[采纳WorkOn][采纳Oner][手动解决]。
- 状态指示：顶栏"Oner同步：●已连接·3项待办待导入·2项完成待推送"；每项[↗已推送][⏳待推送][✗推送失败]；独立任务（manual/import）不推送。

### 9. 一天完整流程时间线（KIRA 示例）

08:30 启动仪式+晨间问答（AI 解析 3 计划入日历）→08:35 编码+番茄环25:00+DND →09:00 番茄完成→休息5min →10:30 摸鱼（头顶红计时"摸鱼03:00"，KIRA"微信？你PRD还没写完呢。(눈_눈)"）→10:45 15min 提醒→回工作+番茄重启 →11:00 Cmd+K 问"PRD还要多久"→"预计11:30" →11:30 完成+推送 Oner"✅ PRD文档已完成|实际2h15m|专注度85%" →12:00 午休（抱饭碗动画）→13:00 下午番茄重启 →14:00 历史模式预警"14点是你容易摸鱼的时间段。小心哦。(¬_¬)"（15min 温和→30min 中央+20%遮挡，KIRA"第二次了？！进度62%落后15%！来，我帮你挡住手机。(╬▔皿▔)"）→14:45 回工作 →15:00 会议前10min 紧急打断（走中央+[准备进入会议]→会议态+头顶"会议60:00"；会议中不触发摸鱼提醒）→16:00 回编码+进度条"调试45%" →17:30 Cmd+K 问答 →18:00 第1轮加班确认（选"继续加班"）→19:00 第2轮（"调试进度82%，剩余预估20分钟"）→19:20 完成+庆祝"(≧▽≦)/┻━┻"+推送 Oner →19:30 复盘（达成率84%绿徽章+推送小结"📊 今日工作7h20m(含加班1h)·达成率84%·专注度均值78·摸鱼15m"）→20:00 关机（LUNA 语气"今天辛苦了。明天继续。(◕ᴗ◕✿)"；关机动画 1.0→0.6→0 透明 2s+界面淡出 1s；保存数据+记录当日启动时间）。

---

## v2.4 — 情感系统

### 1. PAD 三维情感模型

- 维度（各 0–100）：P(Pleasure) 消极→积极；A(Arousal) 低能→高能；D(Dominance) 顺从→主导。
- 坐标映射示例：(80,60,50)→自豪"做得不错！"；(70,80,40)→兴奋"快开始吧！"；(20,90,80)→愤怒命令"现在立刻工作！"；(30,40,60)→担忧；(50,20,30)→无聊；(10,70,40)→焦虑；(90,30,20)→惬意；(40,50,70)→专注推进；(60,60,50)→调皮。
- **10 种基础情感 PAD 坐标表**：

| # | 情感 | PAD | 表情 | 动画 | 触发 |
|---|---|---|---|---|---|
| 1 | 自豪 pride | (80,60,50) | 微笑+眉舒+腮红淡 | 挺胸微点头 | 完成重要任务 |
| 2 | 兴奋 excitement | (70,80,40) | 大笑+眼亮+嘴大开 | 手举高微跳跃 | 新项目/番茄开始 |
| 3 | 担忧 concern | (30,40,60) | 眉内皱+嘴微抿+眼偏大 | 微前倾手托腮 | 进度落后 |
| 4 | 愤怒 anger | (20,90,80) | 眉V皱+嘴紧+颌张力 | 叉腰前倾15° | 长摸鱼/忽略提醒 |
| 5 | 焦虑 anxiety | (10,70,40) | 眼圆睁微颤+手微握 | 微颤+踱步 | deadline 临近 |
| 6 | 愉悦 joy | (90,50,30) | 大弧眯眼+宽笑+腮红 | 节奏摆动+拍手 | 提前完成/周五 |
| 7 | 无聊 boredom | (40,20,30) | 半闭眼+嘴平+无张力 | 懒散倚靠+叹气 | 无任务/等编译 |
| 8 | 专注 focus | (50,70,70) | 凝视+眉平收+嘴一线 | 端正+轻微节奏 | 深度工作 |
| 9 | 调皮 playfulness | (60,60,50) | 眼半眯+歪笑+眉一高一低 | 摇摆+手指舞 | 摸鱼回归 |
| 10 | 共情 empathy | (60,50,50) | 眼柔和+微笑+温润 | 安慰姿态 | 用户低落/疲惫 |

- **混合规则**：权重 0–1，加权平均 `blended_P = Σ(P×w)/Σw`；**最多 3 种同时**（≥4 只用主导情感）；混合坐标→混合表情/动画/话语。示例：摸鱼+deadline=concern(0.6)+anxiety(0.4)+anger(0.2)→(20,57,57)"紧张催促"；完成任务=pride(0.7)+joy(0.3)→(83,57,44)"温暖骄傲"；专注被打扰=focus(0.8)+anger(0.2)→(44,74,72)"冷峻专注"。

### 2. 5 性格情感差异化表达（同事件对照）

事件"用户完成编码任务"：
- ARIA：pride(0.6)→"编码任务完成。耗时3.2h，专注度87%。效率评级A。"微点头+绿光环稳定脉动。
- LUNA：pride(0.8)+joy(0.3)→"太棒了！你真的好厉害！(≧▽≦)♡ 休息一下喝杯水吧~"大弧笑+拍掌+心形粒子+暖粉光环。
- KIRA：pride(0.3)+playfulness(0.6)→"还行吧(≡▽≡)...下次继续保持别让我失望。"歪嘴笑+手指用户+橙光环闪烁。
- ZEN：pride(0.4)+content(0.5)→"水到渠成。~ 继续顺流而行吧。"闭眼微笑+莲花粒子+极淡蓝绿光环。
- SHIN：pride(0.3)+focus(0.5)→"任务完成。下一个任务：[名]。预计耗时2h。立即开始。"立正+绿闪 0.3s→冷蓝白。

### 3. 双向情感共振机制

- 用户情感推断源：WorkState、活动强度（切窗频率/打字速度/鼠标速度）、时间压力、历史模式（30天）、连续时长、（可选）摄像头表情。
- **性格偏移系数**：P 镜像用户±偏移（ARIA +5 / LUNA +15 / KIRA −10 / ZEN +10 / SHIN −5）；A 放大系数（ARIA ×0.8 / LUNA ×1.2 / KIRA ×1.5 / ZEN ×0.3 / SHIN ×1.0）；D 由干预策略定（ARIA 60–70 / LUNA 30–40 / KIRA 50–60 / ZEN 20–30 / SHIN 80–95）。
- **衰减**：每秒 weight×decayFactor：ARIA 0.97 / LUNA 0.92 / KIRA 0.94 / ZEN 0.98 / SHIN 0.99。
- **突变检测**：ΔP>30 且 <10s→放大镜像（如用户突然摸鱼：ARIA"专注度下降。"/KIRA"终于暴露本性了？(╬▔皿▔)"/SHIN"立即恢复工作状态！"）。
- 共振场景矩阵（用户状态→推断 PAD→5 性格反应）：深度专注30min (60,80,70)、摸鱼5min (30,30,20)、摸鱼30min (10,20,10)、完成任务 (85,50,50)、deadline临近 (15,80,40)、连续疲惫3h (25,15,30)——各行含 5 性格对应情感与话术（如摸鱼30min→SHIN anger(0.9)"立刻工作！屏封锁"）。
- 情感过渡速度：ARIA 0.4s / LUNA 0.2s / KIRA 0.3s / ZEN 0.5s / SHIN 0.15s。

### 4. 5 级关系亲密度进化

| 等级 | 名称/时长 | 行为特征 | 干预 |
|---|---|---|---|
| L0 | 初次见面 0–7天 | 礼貌正式谨慎、等用户主动、无玩闹动画 | 标准阈值 |
| L1 | 逐渐熟悉 8–30天 | 识别模式（"检测到你每天9:15开始工作"）、偶尔主动 | 个性化阈值（学习习惯） |
| L2 | 默契伙伴 31–90天 | 预判需求（"周五下午专注度通常下降20%..."）、内部梗 | 高个性化，知何时推何时松 |
| L3 | 信任知己 91–365天 | 深层理解（"这个项目你通常需要额外30%时间，已自动调整预估"）、情感关怀 | 精细、知压力耐受 |
| L4 | 灵魂伙伴 365+天 | 无缝预判、深层信任、罕见脆弱时刻（"根据过去400天数据，你今天的表现是TOP 5%"） | 近乎隐形、自然引导 |

- 积分：每天使用 +1（登录+≥30min 追踪）/ 完成任务被确认 +2 / 有意义互动 +5 / 里程碑 +10 / 未使用 −1/天 / 拒绝干预 −3。
- 阈值：0–50→L0、51–200→L1、201–500→L2、501–1500→L3、1501+→L4。

### 5. 3 种情感记忆

1. **事件记忆 Episodic**：`{date, event, userEmotion(PAD), characterEmotion(PAD), characterResponse, userReaction, intimacyDelta, context}`；同类情境再现时引用（"上次这种任务你做得很好！这次也可以♡"）；保留最近 100 条，更早汇总为模式。
2. **行为模式记忆 Pattern**：`{pattern, frequency, userAverageP, bestIntervention, intimacyLevelWhenLearned, confidence}`；同一行为 3+ 次→建档；仅使用 confidence>0.6 的模式；漏出现时 ×0.95 衰减；永久保存。
3. **关系里程碑记忆**：7天/30天/100天/365天纪念（365 天特别仪式动画）+每 100 亲密点小庆祝；永久不衰减。

### 6. 情感触发事件（4 类）

- **A 工作状态事件**：focus_start、focus_deep_30min、focus_break、slack_start、slack_5min、slack_15min、slack_30min、slack_60min（除 ZEN 外全 anger(0.8)→最大干预）、task_complete、task_fail、deadline_approach——每个事件含 5 性格情感权重（如 slack_15min：ARIA concern(0.5)/LUNA concern(0.7)/KIRA anger(0.5)/ZEN concern(0.2)/SHIN anger(0.7)）。
- **B 交互事件**：user_drag_character→surprise(0.8)+性格反应；user_click_head（ARIA embarrassment(0.7)/LUNA joy(0.8)/KIRA anger(0.5)/ZEN content(0.4)/SHIN anger(0.6)）；user_click_face→embarrassment(0.8) 全体（时长因性格异）；user_click_hand；user_dismiss_reminder；user_acknowledge_tip；user_open_app_after_reminder（KIRA"总算听话了"）。
- **C 语境事件**：morning_login、late_login(>10am)、friday、monday、evening_6pm、late_night(>10pm)（LUNA empathy(0.9)、KIRA concern(0.3)"别猝死"）、weekend_work。
- **D 系统事件**：system_idle_detected、pomodoro_complete、pomodoro_start、report_generated、app_crash_detected。

### 7. 5 通道情感表达

1. **表情 BlendShape 权重**：pride `browInnerUp=0.3, mouthSmile=0.4, cheekPuff=0.2, eyeSquint=0.2`；anger `browInnerDown=0.8, mouthPress=0.7, jawClench=0.5, eyeWide=0.3`；concern `browInnerUp=0.5, mouthFrown=0.3, eyeWide=0.4, cheekPuff=0.1`；joy `mouthSmile=0.8, eyeSquint=0.7, cheekPuff=0.5, browOuterUp=0.3`；anxiety `browInnerUp=0.7, eyeWide=0.6, mouthOpen=0.2, jawClench=0.3`；focus `browInnerDown=0.3, mouthPress=0.4, eyeWide=0.2, jawClench=0.2`；boredom `eyeClose=0.5, mouthFrown=0.2, browOuterDown=0.3`；playfulness `mouthSmile=0.5 asymmetric(L>R), browOuterUp=0.3, eyeSquint=0.3`。混合情感→加权平均。
2. **体态动画层（加性）**：pride chest-expand(0.3)+head-nod-slow(0.2)；anger arm-cross(0.5)+lean-forward(0.4)+foot-tap(0.3)；concern lean-slight(0.2)+hand-to-face(0.3)；joy arm-spread(0.4)+bounce-micro(0.3)+head-tilt(0.2)；anxiety shake-micro(0.4)+pacing(0.3)+hand-wring(0.2)；focus posture-straight(0.5)+hand-on-desk(0.3)。
3. **光环/VFX**：地面环（pride 金 `#ffb86b` 0.25 稳脉冲3.6s / anger 红 `#ff7c7c` 0.35 快脉冲0.8s / concern 蓝 `#7c9eff` 0.20 / joy 粉 0.30 带闪 / anxiety 橙 `#ff7c7c↔#ffb86b` 0.25 不规则脉冲 / focus 绿 `#6bd8a8` 0.15 稳 / playfulness 橙 0.25 闪烁）；粒子（pride 3-5 金星慢升 / anger 5-8 红急速 / concern 2-3 蓝点 / joy 10-15 心星 / anxiety 4-6 橙乱 / focus 1-2 数据点 / playfulness 5-8 emoji 粒子）；轮廓光（pride 1px 金 / anger 2px 红 0.8s 脉冲 / joy 1.5px 粉 / focus 0.5px 绿 / anxiety 1.5px 橙不规则）。
4. **UI 色调偏移**：`--accent-current`（pride `#ffb86b` / anger `#ff7c7c` / concern `#7c9eff` / joy `#9b8cff` / anxiety `#ff964b` / focus `#6bd8a8` / playfulness `#ffb86b` 闪烁）；`--bg-tint`（pride +5%暖 / anger +8%红 / concern +5%蓝 / joy +10%紫带闪 / anxiety +8%橙 / focus +3%绿 / playfulness +5%暖闪烁）；0.3s CSS 过渡。
5. **话语**：生成优先级=性格话语库匹配→AI 按性格指南生成；频率门控（深度专注=全静默含 LUNA；中度=ARIA/ZEN/SHIN 静默、LUNA 仅微气泡；摸鱼=自由说；L0 少说、L4 频繁）。可选 TTS 声线描述见 v2.5。

### 8. 10 级情景策略矩阵（P0–P10）

| 级 | 条件 | 策略 |
|---|---|---|
| P0 深度专注 | focus>85，20min+ | 完全抑制：静默无话无粒子，仅微绿光环 0.10 |
| P1 中度专注 | focus 60–85 | 耳语模式：微气泡仅重要提醒 |
| P2 正常工作 | focus 40–60 | 标准模式：5 通道全开 |
| P3 轻摸鱼 | focus 20–40，<15min | 温和推动：concern+建议+20% 屏遮（若开启） |
| P4 深摸鱼 | focus<20，>15min | 主动干预：愤怒关切混合+40–50% 屏遮+站中央 |
| P5 危急摸鱼 | focus<10，>60min | 最大干预：65–80% 封锁+鼠标拖拽+紧急话语（SHIN"全屏封锁。回工作才能解除。"） |
| P6 会议中 | meeting 检测 | 沉默观察：无话无干预仅徽标更新 |
| P7 休息 | break 检测 | 放松陪伴：喜悦+玩闹动画+闲聊 |
| P8 下班 | 18点后任务完 | 庆祝模式：最大喜悦+烟花 |
| P9 加班 | 20点后仍工作 | 关怀模式：关切共情+温和建议，**绝不粗暴干预** |
| P10 首次登录 | 早晨启动 | 欢迎模式：兴奋+每日简报（L0 正式/L4"早呀♡"） |

- 抑制≠消失：内部 PAD 持续更新，抑制解除后 1s 短释放再平滑过渡（防"情感债"爆发）。
- 紧急覆盖：会议前5min提醒/系统崩溃/番茄完成/deadline<30min→任何策略下 2–3s 微气泡（仅文字+音效，不触发全动画）。

### 9. 摸鱼递进闭环（KIRA 示例）

| 时长 | 情感 | 话语 | 行为 | 干预 |
|---|---|---|---|---|
| 0–5min | playfulness(0.6) | "终于暴露本性了？(≡▽≡)" | 歪嘴笑+手指用户 | 无（观察期） |
| 5–15min | concern(0.5)+playfulness(0.3) | "已经15分钟了，我截图发给老板了（开玩笑）" | 微皱眉+走到屏幕边缘 | 温和气泡 |
| 15–30min | anger(0.6)+concern(0.4) | "30分钟了。进度落后15%预计加班到19:00" | 叉腰+走中央+半透明遮挡 | 20% 六角屏障 |
| 30–60min | anger(0.8)+anxiety(0.4) | "1小时了！你这是在写辞职信吧？(╬▔皿▔)" | 全身愤怒+封锁40%+鼠标追逐 | 40–50% 封锁 |
| >60min | anger(0.9)+dominance(0.9) | "超过1小时。我已经把你的摸鱼记录做成PPT了。凸" | 危机模式封锁65%+鼠标硬阻挡 | 65–80% 封锁 |

用户回应分支：[回到工作]→pride(0.3)+playfulness(0.5)"总算听话了。(≡▽≡)...下次别让我等这么久。"屏障 0.5s 消散；[推迟10分钟]→anger(0.5)+playfulness(0.3)"10分钟？好吧...但我会计时的。(╬▔皿▔)"遮挡降至10%+10min 计时；[忽略]→anger(0.7)+dominance(0.8)"你完了。(╬▔皿▔)凸"遮挡 40%→50%+追鼠标+5min 不可 dismiss；[拖走角色]→anger(0.8)+dominance(0.9)"3秒后我走回来。凸"3s 后自动走回+干预升级。

### 10. 加班关怀递减闭环（LUNA 示例，与摸鱼相反）

| 时间 | 情感 | 话语 | 行为 | 类型 |
|---|---|---|---|---|
| 18:00 | concern(0.3)+encourage(0.5) | "6点了！今天做了很多了~要不要收工？" | 温柔微笑+指向时钟 | 温和气泡 |
| 19:00(+1h) | concern(0.5)+empathy(0.4) | "已经加班1h了...进度62%还要继续吗？我帮你看看还要多久~" | 担忧+托腮+肩轻放 | 第2轮确认 |
| 20:00(+2h) | concern(0.7)+empathy(0.6) | "2小时了！你看起来很累了...明天继续好不好？今晚休息吧♡" | 明显担忧+轻拉用户指向门外 | 强烈建议结束 |
| 21:00+(+3h) | concern(0.9)+empathy(0.8) | "已经很晚了...我真的担心你的健康。请停下来♡" | 极度担忧+跪坐+双手合十"求你停下" | 紧急关怀，除非用户强制确认 |

用户回应："继续加班"→尊重但每30min提醒休息；"结束工作"→joy(0.8)"太好了！辛苦了今天！明天见♡(≧▽≦)"；"还需要30分钟"→concern(0.5)"好...30分钟后我再来确认♡"。**铁律：加班关怀永不使用屏幕遮挡或强硬干预**；SHIN 也仅"效率下降，建议结束"（事实非关怀）。

### 11. 进度问答闭环（预估→确认→学习）

- 回答示例：ARIA"基于过去5次同类任务数据：平均耗时2.8h，你的效率系数0.85。当前进度40%，预估剩余1.7h。置信度72%。"；KIRA 双预估对比（"继续摸鱼3小时 vs 专注1.5小时，选一个吧。(≡▽≡)"）；SHIN"预估1.5h。要求1.2h完成。倒计时开始。72:00。"；ZEN"水到渠成。~"
- 30min 后（或预估 50% 时）主动确认；回应→"完成了"pride/"还要一会儿"concern+再预估/"比预期难"empathy+调计划；每轮记录预估 vs 实际偏差（不确定性学习）。

### 12. 情感数据架构

- `EmotionState`：`{pleasure, arousal, dominance, activeEmotions[{type, weight, trigger, timestamp, decayFactor}]（≤3）, strategy(P0–P10), channels{face, body, aura, ui, speech}}`。
- `updateEmotionEngine(deltaMs)` 循环 8 步：①衰减（`weight *= pow(decayFactor, deltaMs/1000)`，<0.05 清除）②检测新触发→addOrBlend ③共振微调 PAD ④加权混合 ⑤定策略 ⑥算通道权重 ⑦输出 5 通道 ⑧记录情感记忆。
- `RelationshipState`：`{intimacyScore, intimacyLevel, daysTogether, totalInteractions, patternConfidence, lastMilestone, nextMilestone}`。
- 实施优先级：P0=PAD引擎+10情感映射+性格偏移+光环映射；P1=UI色偏+话语库+策略矩阵+摸鱼闭环；P2=亲密度+事件记忆+加班闭环+不确定性学习；P3=复合渲染+记忆影响行为+TTS+摄像头共振。

---

## v2.5 — 补全 10 维度

### 1. 番茄钟 6 阶段联动

- **A 启动（0–3s）**：0.0s 坐正 0.3s（ARIA 精准/LUNA 挺胸/KIRA 懒散→正经/ZEN 缓慢/SHIN 军人立正）→0.5s 环 0→满弧 0.5s→1.0s 进工作状态→1.5s 气泡 2s 自消（ARIA"番茄25min开始。计时。"/LUNA"加油哦！25分钟冲刺！(≧▽≦)"/KIRA"行，25分钟。别让我抓到你摸鱼(╬▔皿▔)"/SHIN"番茄启动。预计产出：1个任务单元。开始。"）→3.0s 进循环。
- **B 进行中**（剩余时间→微行为/环态）：>15min 正常+偶抬头看环（绿满弧）；10–15min 微加速（绿 60–40%）；5–10min 更专注眉微收（黄 40–20%）；3–5min 整理姿态（黄 20–12%）；1–3min 眉收紧冲刺（橙 12–4%）；<1min 极度专注（红闪 4–0%）。降级：medium 跳过 5/3/1min 微行为仅环色变；minimal 仅环色变。
- **C 完成（=0）**：0.0s 停动画后仰 0.3s→0.3s 环缩放淡出 0.2s→0.5s"完成"表情+伸展（ARIA 满意点头/LUNA 双手欢呼(≧▽≦)♡/KIRA 摊手"就这？"(≡▽≡)/ZEN 伸懒腰/SHIN 立正敬礼）→1.0s 休息面板 240×120（"✅ 番茄完成！工作了25:00 专注度92% [休息5分钟][继续下一个][跳过]"）。
- **D 休息期**：0.5s 过渡休息姿态（咖啡杯/伸懒腰/靠椅背）；头顶蓝色休息环（反向 0→满弧）；每 5s 深呼吸；环满绿闪+"休息结束，继续吗？"
- **E 中断**：主动停止（ARIA"番茄中断。已工作12:34。记录。"/KIRA"又放弃了？才12分钟啊(╬▔皿▔)"/SHIN"中断记录。效率损失评估中。"）；摸鱼超 2min 自动中断（震惊→生气；KIRA"哈！果然撑不住吧！(￣▽￣)凸"/SHIN"番茄失败。原因：自律不足。"）；会议打断（无责备平滑切会议态）。
- **F 连续累积**：2 个→微笑加深"连续2个番茄！保持节奏"；3 个→"建议休息长一点（10min）"；4 个→强制建议"第4个了！必须休息10分钟！"；5 个→LUNA/KIRA/SHIN"5个了！你再不休息我挡屏幕！"触发轻度遮挡；6+ 个→强制休息模式：遮挡 30% 屏幕直到休息完成。
- **情感联动 PAD**：完成（focus>80%）P+15,A+5,D+5 自豪；完成（50–80%）P+8,A+0,D+3；完成（<50%）P+2,A+5,D−5；主动中断 P−3,A−5,D−3；摸鱼中断 P−10,A+10,D−8；连续3个 P+20,A+10,D+10；连续5个无休息 P+5,A+15,D−5（担忧过劳）。
- `PomodoroSession`：`{id, startTime, plannedDuration(默认1500s), actualDuration, status:'active'|'completed'|'interrupted'|'auto_interrupted', workState, focusScore, interruptionReason:'manual'|'slack'|'meeting'|'system', consecutiveCount, emotionalImpact{pleasureDelta, arousalDelta, dominanceDelta}}`。

### 2. 全局问答虚拟人 5 阶段行为

1. **唤起**：0.0s 当前动画暂停帧（非停止）→0.2s 头转向面板 0.3s→0.5s"聆听"姿态（前倾+圆眼+嘴微张）+头顶指示器降透明至 0.3→0.8s 面板展开 560×380。
2. **输入中**：打字→微点头 0.5s 周期幅度 2°；停顿>2s→微歪头不催促；继续→恢复点头。
3. **AI 思考**：托腮+眼微眯+眉微收；头顶紫色思考粒子 3–5 个缓旋；>3s 偶点头；>8s 表情认真+粒子加速。
4. **回复中**：说话姿态（嘴型开合同步+手势；ARIA 精准简短/LUNA 丰富/KIRA 随意摊手/ZEN 缓慢/SHIN 军事利落）；结束回"等待"姿态微笑看用户。
5. **关闭**：面板收起→0.3s 头转回→0.5s 从暂停帧恢复动画+指示器恢复全透明→0.8s 完全恢复。
- 内容驱动情感：进度查询 P0 A+5 D+5；疲劳 P−5 A−5 D−3；成就 P+15 A+10 D+5；焦虑 P−10 A+15 D−5；闲聊 P+10 A+5 D0；技术问题 P0 A+10 D+5；摸鱼相关按性格。
- 语音输入：点麦克风/说"嘿 WorkOn"→聆听姿态→识别中点头跟节奏→"收到"点头→转思考。

### 3. 各视图虚拟人行为差异

| 视图 | 位置 | 行为/联动 |
|---|---|---|
| 日历 | 右下预设位/时间轴右侧 | 手指当前时间点；hover 段→指向+迷你 tooltip"编码 45min"；编辑→"记录"手势；拖拽→"搬运"手势；AI 补录→"魔法"手势（紫色粒子飘向时间轴）；无计划→坐时间轴底部"还没有今天的计划哦"；摸鱼段→站红段旁叉腰 |
| 监控 | 面板左下角 | 坐隐形椅看数据点头；状态同步切换；副屏摸鱼→头转副屏皱眉；focus<50% 担忧、>80% 自豪微笑；hover 轨迹→指向；双线并行→两面板间巡视 |
| 规划 | 列表右侧/画布右下 | 规划模式：持笔、添加"书写"、拖拽"搬动"、完成画✓点头、Oner 同步"接收"手势（紫数据流）；执行模式：站计划块与实际轨迹间，匹配✓/偏离⚠，摸鱼→愤怒；复盘模式：站达成率旁"展示"、指失败项"分析" |
| 报表 | 右上角 | 翻阅隐形报告；切周期→翻页动画；hover 图表→指数据+头顶浮数值；AI 洞察→"思考"+紫粒子；导出→"递交"手势；摸鱼占比>30% 尴尬看别处；专注>85% 竖大拇指 |
| 桌搭 | 屏幕中央展示位 | 呼吸循环+看用户；选角色→0.3s morph；选场景→"环顾"；开关交互→即时演示（开拖拽→被拽起放下；开遮挡→屏障手势+0.5s 演示遮挡；开鼠标联动→追光标 0.5s）；预览状态动画循环 |
| 设置 | 右下安静位 | 安静站立；改 AI 配置→"配置"手势；改渲染级别→即时切换质量；旁显 mini 资源仪表盘；恢复默认→"重置"手势（双手一挥） |

- 视图切换过渡 0.5s：旧视图"离开"手势→0.2s 淡出→0.3s 新位置淡入→0.5s"到达"手势。降级：medium 直接淡入淡出；minimal 瞬移。

### 4. 多显示器 7 种场景

`DisplayTopology`：`{displays:[{id, isPrimary, bounds, workArea}], virtualSpaceBounds{minX,maxX,minY,maxY}}`。

| 场景 | 触发 | 行为 |
|---|---|---|
| 单屏工作 | 仅 1 显示器 | 正常行为 |
| 主屏工作 | 活跃窗口在主屏 | 主屏预设位 |
| 切换到副屏 | 活跃窗口移到副屏 | 从主屏边缘"走"到副屏边缘 0.8s（走出→消失→走入） |
| 副屏摸鱼主屏工作 | 主屏工作态+副屏摸鱼应用 | 在主屏但头转向副屏、表情警惕 |
| 双屏同时活跃 | 两屏均有活跃窗口 | 主屏，每 30s 转头看副屏一次 |
| 副屏看视频 | 副屏视频全屏 | 走到副屏底部坐下"一起看"（放松态） |
| 三屏+ | ≥3 显示器 | 只在主屏+活跃副屏巡走 |

- 跨屏动画 1.2s：0.0s 出发（前倾+发后飘）→0.2s 走出消失→0.5s 穿越（A 直出直入/B 能量粒子飞渡）→0.6s 走入→1.0s 到达手势→1.2s 进循环。降级：medium 0.5s 淡入淡出；minimal 瞬移。
- **副屏摸鱼检测渐进**：主屏工作态+副屏社交/视频/游戏/购物活跃>60s → 60s 头转向+"副屏...在干嘛？"；3min 走到主屏边缘面向副屏"我看到副屏了"；5min 走到两屏交界表情愤怒；10min 走到副屏站在摸鱼应用旁触发遮挡机制。

### 5. 休息/睡眠周期（5 级离开检测）

| 状态 | 触发（无输入） | 行为 | 退出 |
|---|---|---|---|
| 注意力游离 | 30s | 停下手头工作看用户，头微歪"在吗？" | 恢复输入即退 |
| 短暂离开 | 2min | 放下工作+伸展+idle 态 | "欢迎回来" |
| 离开 | 5min | sleepy 态（打哈欠眼皮打架） | "惊醒" |
| 深度离开 | 15min | 趴桌睡着 Zzz 气泡，眼镜摘下浮旁 | "惊醒+欢迎" |
| 长时间离开 | 30min+ | 半透明 0.7 away 态+背景变暗+"离开 XX:XX" | "重新唤醒"仪式 |

- 回归欢迎：<2min 微抬头继续；2–5min"欢迎回来"手势+气泡（ARIA"离开3:22。期间无异常。"/KIRA"哟，回来了？去哪了？(╬▔皿▔)"/SHIN"归队。报告状态。"）；5–15min 惊醒→揉眼→欢迎（ARIA"离开12分钟。2条通知待处理。"/SHIN"离开12:34。效率影响：中等。建议延长今日工时。"）；15–30min 半透明→实体+通知汇总气泡；>30min 触发 0.8s"重新唤醒"迷你仪式+汇总+建议下一步。
- 深夜犯困：22:00 偶打哈欠"不早了哦"（每30min）；23:00 眼皮打架"该休息了吧？"（每15min）；00:00 强撑明显犯困"深夜了！明天再做吧！"（每10min，LUNA/SHIN 强烈建议关机）；01:00+ 趴桌半睡半醒"ZZzz...你还不睡？..."（每5min，KIRA/SHIN 遮挡屏幕 10% 强迫休息），仅最低限度监控。
- 周末/假日：周末休闲装+态度放松不催摸鱼；法定假日节日装+"节日快乐！"+完全关闭摸鱼干预；调休工作日正常模式+"调休辛苦了"。

### 6. TTS 系统

- **4 引擎**：Edge TTS（在线、免费高质量、默认推荐）/ Piper（本地离线、隐私好、质量一般）/ 系统 TTS Windows SAPI（零成本、质量差、保底）/ 在线 API Azure/Aliyun（顶级质量情感丰富、收费）。
- **5 声线（Edge TTS ID）**：ARIA=`zh-CN-XiaoyiNeural`（冷静女声、1.0x、平稳）；LUNA=`zh-CN-XiaoxiaoNeural`（温暖活泼、1.1x、偏高）；KIRA=`zh-CN-YunyangNeural`（傲娇男声、0.95x、起伏大）；ZEN=`zh-CN-YunxiNeural`（温和男声、0.85x、平缓低沉）；SHIN=`zh-CN-YunjianNeural`（严厉男声、1.05x、低沉有力）。
- **4 级触发**：🔇静默（日常状态变化/微气泡→仅文字）；🔉低频（番茄完成/任务完成/休息提醒→可关）；🔊重要（会议紧急提醒/加班确认/下班提醒→默认开）；🚨紧急（连续摸鱼>30min/深夜>01:00→强制，除非全局静音）。
- `VoiceConfig`：`{enabled, engine:'edge'|'piper'|'system'|'azure'|'aliyun', volume:0–100, triggerLevel:'silent'|'low'|'important'|'urgent', muteDuringFocus:true, muteDuringMeeting:true, customVoice?, speed:0.5–2.0}`。
- 动画同步（无 lip-sync 依赖）：语音开始→说话姿态；每 100ms 采样音量包络→映射嘴开合幅度；关键句配手势；结束回原状态。

### 7. 自主学习 4 类

1. **行为模式学习** `InterventionLearning`：`{interventionType:'gentle_remind'|'walk_over'|'block_screen'|'drag_mouse'|'force_lock', userResponse:'complied'|'ignored'|'dismissed'|'aggressive_dismiss', context:{timeOfDay, workState, consecutiveSlackCount}, effectivenessScore:−1~1, timestamp}` → 生成 `InterventionPolicy.weights[时段][状态][干预类型]=有效性均值`（例：下午摸鱼拖鼠标=0.8 有效→多用；早上 force_lock=−0.3→早上只温和提醒）。
2. **时间模式学习** `TimePatternLearning`：`hourlyEfficiency[24]`、`dailyEfficiency[7]`、`peakHours[]`、`slumpHours[]`、`weeklyPattern{bestDay, worstDay}`；应用：peak hours 少打扰、slump hours 提前提醒、报表"上午效率比下午高37%"。
3. **任务时长预估学习** `TaskEstimationLearning`：`{taskType, userEstimate, actualDuration, biasRatio, sampleCount, confidence}` + `EstimationBiasTable`（例：coding ratio=1.35, confidence=0.8, n=42→"编码任务通常比预估多35%，建议预留2.5-3小时"）。
4. **偏好学习** `PreferenceLearning`：5 性格正/负反馈计数（常 dismiss KIRA→建议换 LUNA）；`interactionPreference{dragEnabled, clickFrequency, voiceUsage}`；`notificationPreference{idealFrequency, dismissRate}`（dismiss 率高→自动降通知频率）。
- **月度成长报告**（每月1日，报表展示）：关系等级/本月互动次数/干预成功率 vs 上月/"我学到的"4条/"下月建议"3条/本月里程碑；5 性格报告语气（ARIA 数据分析式/LUNA 温暖鼓励/KIRA 傲娇"哼，还算凑合吧"/ZEN 禅意/SHIN 军事报告"本月作战效率评估：良好"）。

### 8. 通知系统统一规格

- **5 级**：P0 静默（无表现）/ P1 气泡（头顶 200×40 文字泡、微表情、无声音、5s 自消或点击）/ P2 对话卡（240×120 glass 面板、面对用户说话、低频语音、点按钮）/ P3 走过来（走到屏幕中央+对话卡+手势、重要语音、必须选按钮）/ P4 遮挡（半透明遮挡层+严肃表情、紧急语音、满足条件才解除）。
- **类型映射表**（正文列出 13 行；文档他处称"12 种类型"）：

| 类型 | 默认级别 | 触发 | 升级 |
|---|---|---|---|
| 状态变化 | P0→P1 | WorkState 切换 | — |
| 番茄完成 | P2 | 倒计时=0 | 连续5个→P3 强制休息 |
| 休息提醒 | P1→P2 | 连续工作 50min | 连续 90min→P3 |
| 摸鱼提醒 | P1→P2→P3→P4 | 摸鱼 5min | 15min→P2 / 30min→P3 / 60min→P4 |
| 会议即将开始 | P3 | 前 10min | 前 3min→P3 走过来 |
| 加班确认 | P2→P3 | 预测下班时间到 | 延后 30min→P3 再问 |
| 进度预警 | P2 | 落后>10% | 落后>25%→P3 |
| 任务完成 | P1 | 标记完成 | — |
| 深夜提醒 | P1→P2→P3 | 22:00/23:00/00:00 | 01:00→P3 |
| 健康提醒 | P2 | 喝水/久坐/眼休息 | 3次忽略→P3 |
| 系统通知 | P1 | 更新/错误/资源告警 | 严重错误→P2 |
| AI洞察 | P1 | 分析出模式/建议 | — |
| 关系里程碑 | P2 | 7/30/100/365天 | — |

- **去重队列** `NotificationQueue{pending, active(同时仅1个P2+), suppressed}`：`sameTypeCooldown:300000`(5min)、`sameContentCooldown:600000`(10min)、`maxQueueSize:5`（超出丢弃最低优先级）；专注中 P3+ 直显、P1–P2 暂存；专注解除后合并同类汇总气泡（"离开期间：2条休息提醒、1条进度提醒"）。
- **5 种免打扰**：深度专注（focus/coding>15min→仅 P3+，其余暂存）；会议（完全静默，P4 除外）；手动（仅 P4）；全屏应用（视频/游戏→仅 P4）；深夜 23:00–07:00 可配置（仅 P3+）。

### 9. 设置面板 7 分类 30+ 配置项

- **桌搭页（交互配置）**：①角色管理（5 角色卡+切换预览+关系等级+进度条）；②外观定制（皮肤 aria/luna/leo、服装 基础黑T/商务/休闲/节日、配饰 眼镜样式/耳饰/无、尺寸 0.5x–1.5x）；③场景设置（桌面场景 简约/赛博/自然/无、粒子 开/关/密度、光环 开/关/亮度）；④交互开关 15 项：拖拽交互/身体点击/鼠标联动（关/跟随/戳光标/拖拽/阻挡）/屏幕遮挡（关/轻度/标准/强制）/桌面漫游/真实宠物融合/番茄钟联动/语音播报/情感表达（开/关/仅表情）/关系进化/自主学习/深夜提醒/周末模式/多屏巡走/启动仪式（每次/首次/关闭）。
- **设置页（系统配置）**：⑤AI 配置（引擎 本地/在线API、API Key、模型选择、问答测试、屏幕分析间隔 1s/3s/5s/10s）；⑥语音配置（TTS 引擎、5 声线试听、语速、音量、触发级别、免打扰时段）；⑦通知配置（频率 低/中/高、免打扰模式、12 种类型逐一开关、去重规则）；⑧性能配置（渲染级别 自动/高/中/低/极低、CPU/RAM/GPU 上限、实时监控仪表盘、帧率 30/60/不限、降级阈值）；⑨数据配置（存储位置、导出 JSON/CSV、导入、学习数据清除、隐私模式不上传）；⑩Oner 同步（连接、频率、方向 双向/仅拉取/仅推送、标签映射）；⑪高级（开发者模式、调试日志、实验性功能、重置所有设置）。
- 即时预览理念："调一个看一个"——切角色 0.3s morph、切皮肤即时变、调尺寸即时缩放、开关交互即时演示、调渲染级别即时对比、切声线即时试听一句。

### 10. 技术架构（v2.5 版）

- **渲染选型**：A=Three.js+VRM ⭐⭐⭐⭐⭐（推荐）/ B=Babylon.js+GLB ⭐⭐⭐⭐ / C=PixiJS+Spine ⭐⭐⭐ / D=原生 Canvas/SVG ⭐⭐。
- **动画系统分层**：骨骼动画（基础 idle/sit/stand/walk；工作 coding/writing/meeting/slack；交互 drag/click/greet/sleep）；BlendShape（基础 neutral/happy/angry/sad/surprised/sleepy；工作 focus/thinking/coding_intensity；特殊 proud/embarrassed/mocking/zen）；SpringBone（头发/衣服/拖拽晃动）；FSM 过渡 0.3s blend。
- **FSM 状态清单**：`currentState = {workState(30+), emotionState(PAD), personality(5), interactionState:'idle'|'working'|'dragging'|'clicked'|'speaking'|'blocking'|'sleeping', animationLevel:'full'|'medium'|'minimal'|'critical'}`。过渡示例：focus+idle→coding+working（检测到编码应用）；any+any→dragging+idle（用户拖拽）；dragging+idle→previous+idle（释放）。
- **行为树决策序**：①查情景等级→可否通知；②查通知队列→选最高优先级；③查学习策略→选最有效干预；④查情感状态→调表达强度；⑤执行→动画+气泡+语音。
- **数据流 3 层**：数据源层（屏幕监控截图AI/窗口检测activeApp/输入检测mouse·kb/日历计划PlanItem/Oner同步/系统资源）→ 状态引擎层（WorkStateDetector→WorkState+置信度+时长；EmotionEngine(PAD)；ScenarioAssessor→情景等级 P0–P9+允许通知级别；LearningEngine→干预权重+预估偏差表；NotificationManager→通知队列；InteractionDecision→行为指令）→ 渲染层（AnimationController→Three.js Renderer→OverlayRenderer Electron 透明窗 always-on-top+click-through）。
- **性能预算**：CPU <5%（空闲）/<8%（活跃），每5s监控，>8% 降一级；RAM <200MB，每10s，>250MB 清粒子缓存；GPU <10%，每5s，>15% 降渲染级别；帧率目标 30fps/最低 15fps，每秒，<15fps 降级。
- **降级链**：full →(CPU>8% 或 GPU>15% 或 FPS<25)→ medium（跳微行为+粒子减半+光环降亮）→(CPU>12% 或 GPU>20% 或 FPS<15)→ minimal（基础动画+无粒子光环+低面数）→(CPU>15% 或 GPU>25% 或 FPS<10)→ critical（静态姿态+最低渲染+无动画）；恢复：每 30s 升一级至稳定。
- **Electron 透明窗**：`BrowserWindow{width:300, height:400, transparent:true, frame:false, alwaysOnTop:true, hasShadow:false, resizable:false, skipTaskbar:true, webPreferences:{contextIsolation:true, preload}}`；点击穿透 `setIgnoreMouseEvents(ignore, {forward:true})`，监听鼠标位置判断是否在虚拟人 hitbox 内动态切换。
- **文件结构**（`workon/`）：`src/main/`（index.ts、windows/{mainWindow,petWindow,widgetWindow}.ts、ipc/）；`src/renderer/main/`（views/{CalendarView,MonitorView,PlanView,ReportView,BuddyConfigView,SettingsView}.vue、components/、composables/）；`src/renderer/pet/`（three/{VRMLoader,AnimationController,CelShader,ParticleSystem,SceneManager}.ts、states/{FSM,WorkStates,Transitions}.ts、personality/{PersonalityDef,PersonalityBehavior}.ts、emotion/{PADEngine,EmotionMixer,EmotionMemory}.ts、interaction/{DragPhysics,ClickFeedback,MouseFollow,ScreenBlock}.ts、voice/{TTSManager,LipSync}.ts、App.vue）；`src/renderer/widget/WidgetApp.vue`；`src/core/`（monitor/{ScreenAnalyzer,WindowDetector,InputDetector,WorkStateDetector}.ts、engine/{EmotionEngine,LearningEngine,ScenarioAssessor,NotificationManager,PomodoroManager}.ts、sync/{OnerSync,DataExport}.ts、types/{WorkState,Emotion,Personality,Notification,Learning}.ts）；`src/assets/models/{aria,luna,kira,zen,shin}.vrm`、animations/、sounds/。注意：文件结构示例用 Vue 命名，而 v2.2 正文以 React（lucide-react、.tsx）描述，实现时需统一技术栈——此为文档内部不一致点。

---

## 跨文档一致性备注（供编码时裁决）

1. **状态数量**：v2.0 自称"30 种状态"，附录 E 映射表实为 23 行（含 4 个摸鱼阶段）；v2.5 亦称"30+"。以附录 E 表为准实现。
2. **鼠标联动**：v2.0 为 4 级（L0–L4 实为 5 档含 L0），v2.3 桌搭设置写作"0级-忽略…4级-硬阻挡"5 档——同一体系。
3. **遮挡渐进**：v2.0 Phase 0–3（4 阶段）+ 摸鱼状态内置 5 段时间轴；v2.3 桌搭简化为 3 档（>15min 20% / >30min 40% / >60min 80%）。建议以 v2.0 Phase 机制为准、v2.3 阈值作为可配置默认值。
4. **通知类型数**：v2.5 §8.2 表列 13 行，文档他处称"12 种类型"；设置面板称"12种类型各可开关"。
5. **情景等级编号**：v2.3 问答为 4 级（DND/Low/High/Override）；v2.4 情感策略为 P0–P10 共 11 行（标题称 10 级）；v2.5 数据流中 ScenarioAssessor 输出"P0–P9"。三者是不同子系统的分级，勿混用。
6. **虚拟人渲染参数演进**：v2.0 3000–5000 面/2–3 级着色/1.5px 描边 → v2.1 升级为 8000–15000 面/4 级着色/变宽描边 → v2.3 性能分级 full=15000、medium=8000、minimal=3000。以最新（v3.x/v4.x）文档为准，v2.x 数值仅作性能分档参考。
7. **技术栈**：v2.2 按 React+Tailwind 描述，v2.5 文件结构按 Vue 命名——实现前需确认实际栈。