# WorkOn 任务板（进度 + 待办 · 唯一正本）

> **维护规则**：每完成一项 → 状态改 `✅` 并记日期；新待办补到对应模块章节；大结论写入「更新日志」。
> 本文件随 git 提交维护；桌面上的「WorkOn任务板」是它的替身（软链接）。
> 图例：`✅ 已完成` `🔧 进行中` `⬜ 待办` `🧊 封存` `📌 已拍板的决策` `⚠️ 注意`

---

## 0. 当前快照（2026-10-09）

桌面版 `b722be8`（2026-09-30），main 领先远端 **77 提交未推送**。桌宠骨架态（3/15 开关开）。判断引擎影子记账中，真实样本 4.2MB 已攒。on-web 官网上线、待真机验收。环境已从 Windows 迁到 macOS（本机）。

---

## 1. L1 数据采集层

- ⚠️ 采集层为 Windows 专属实现（winInfo=PowerShell / systemOcr=Windows.Media.Ocr 链 / koffi=Win32 interop / uiohook）；mac 上跑需守卫降级，主进程采集逻辑的改动仍需回 Windows 真机验证
- 📌 **mac 试跑结论（2026-10-09 冒烟 70s）**：应用整体可跑——主窗口、桌宠渲染（2560x1440）、agent-hook :18790、integration WS :18765、负载管理全部正常。Windows 专属探针失败但被兜住：GPU 检测/窗口信息 `spawn powershell.exe ENOENT`（启动时一次 uncaughtException 被 [fatal] 兜底处理器接住，之后无复发）；OCR 深度模式自动停用
- ⬜ mac 守卫补丁（按需）：winInfo/hardwareDetect 在 `process.platform==='darwin'` 下直接跳过 PowerShell spawn，消掉启动期的 [fatal] 噪音
  - ✅ 2026-10-09 winInfo 已加 IS_WIN 平台门 + spawn error 兜底（startServer/getForegroundWindow/getDisplayTopWindows）；desktopPin 原本就有守卫；aiAssistWatch 的 execFile 回调式安全。复测 50s 零 fatal

## 2. L2 判断引擎

- 🔧 **P0 前置 bug**：`decision.ts` 的 `MODEL_LABEL_TO_STATE` 按 8 动作类查表，但 v3_real 输出已是 13 态 WorkState → model_first 路径模型永不生效 + `other` 误映射为 focus（账本 REQ-20260921-01 发现，用户暂缓）
- ⬜ 13 态 WorkState 重训（`ml/data/real_actions.jsonl` 4.2MB；按 ts 过滤只取 2026-08-29 之后真实特征样本；`--target state`）
- ⬜ 校准曲线（recognition_log 的 prob + 纠偏金标画可靠性图）+ top1−top2 边际三级 fallback（替代 0.75 一刀切）
- ⬜ 判断资产化 P1-P3：纠正账本统一入库 → 确认 ≥3 次蒸馏成绑定规则 → 纠正账本接 XGBoost v3 重训
- ⬜ APP_RULES 补 ~30 个进程缺口（远程桌面/企业微信/邮箱/网盘/截图/虚拟机/阅读器等；jev 映射表可反哺，材料在 Windows `D:\AI\workon小模型训练\`）

## 3. L3 数据组织

- 暂无大待办（逐日聚合/注意力评分/星图/画像八层均已落地）

## 4. L4 桌宠（19 条放回清单）

> 📌 **2026-10-09 桌宠升格**：从"搁置的装饰"升为核心交互面（悬浮窗退役后桌宠=唯一桌面状态提示器）。放回优先级因此重排：chatter（主动唠嗑=主动消息的桌面呈现）、care（关怀=主动消息源）、clips（动作=状态语言载体）提前；weather/particles/dayNight 仍靠后（氛围件）。

**已完成** ✅
- ✅ ⑧ 微行为整包（眨眼/耳抖/呼吸/挥手/铃铛/凝视）
- ✅ ⑭ 拖拽（跟手 + 长按转圈 + 松手定格）
- ✅ ⑮ 右键聊天入口（当前 chat:false，骨架态）
- ✅ 交互精修全套（朝向v4 / 缩放复利 / 跟随 / 青瓷面板 / 最低睁眼70% / DPI钉桌面换算）

**待放回** ⬜（`src/renderer/src/pet/flags.ts` 翻 true → 重启 → 验收）
- ⬜ ① 动作系统 `clips: true`
- ⬜ ③ 位置自动迁移 `autoSpatial: true`
- ⬜ ④ 自己散步 `roam: true`
- ⬜ ⑤ 小星星粒子 `particles: true`
- ⬜ ⑥ 下雨下雪 `weather: true`
- ⬜ ⑦ 昼夜光线 `dayNight: true`
- ⬜ ⑨ 主动唠嗑 `chatter: true`
- ⬜ ⑩ 关心提醒 `care: true`
- ⬜ ⑪ 开场动画 `intro: true`
- ⬜ ⑯ 换装入口（桌搭页解注释 VrmUploader）

**封存 / 后置** 🧊
- 🧊 拽脖颈拎猫 `scruffLift`（代码完整保留，暂缓优化）
- ⬜ 全部放回并稳定后：按需渲染（静止时零渲染）

## 5. L5 智能应用

- ⬜ AI 问答恢复指定时段截图（方案见 `docs/workon-backlog-audit.md`：阶段1 截图↔OCR 文本索引表 `ocrShots` 为 P0，之后 QA 注入 + 全文检索）
- 已落地：双管道问答 / 报表 / 状态卡反哺 / 预测 / 词汇包 / 日视角

## 6. 视角系统

- 已落地（晨架构师/昼工作者/晚管理者 + 词汇包 + 首页编排）；暂无待办

## 7. Oner 联动 / on-web 官网

- ✅ Oner 联动适配完成（拉取/回写/refresh 续期/401 停轮询/50 条上限/状态映射）
- ⚠️ on-web 仓库不在 mac（在 Windows `workonv0.2-6/on-web`），需要时带过来
- ⬜ on-web：真机走一遍 注册→登录→后台改文案（预览 :3100）
- ⬜ on-web：换真截图（/admin/media 上传 → products 的 shots.src 填文件名）

## 8. ML 训练线 / jev 调研

> 📌 **完整方案见 `docs/JEV-PLAN.md`**；**2026-10-09 重大更新：jev 模型已由 DeepSeek 侧训好并交付**（`~/Documents/DeepSeekHarness/workon-jev/`，适配器包 `workon-jev-model-adapter.zip`），本方案 P0-P3 大部分已被超越，以交付物为准。

- ✅ **模型已训好**：Qwen3-0.6B + LoRA(r16)，5 题（scene_l1/l2/l3 + action + work_state），真实测试集 0.953 / ECE 0.035，逐题温度校准，ONNX int8 756MB 单题 196ms，与 torch 决策 100% 一致
- ✅ 对照结论：XGBoost 准确率更高（0.990，33 组合查表到顶）但 Jev macro-F1 略高且**能吃标题/OCR 文本 + 答场景三级**——分工不是替换
- ✅ **shadow 接入已落地（2026-10-09，eb067a7）**：4 文件补丁覆盖（stateMeta 8/13 错位 bug 已修）+ ml/jev 交付物入库（model/ 756MB 已 gitignore）；shadow 默认，sidecar 起不来自动崩3停降级规则
- ⬜ 按 v0.9 节奏上线：shadow 只记账 → 修 MODEL_LABEL_TO_STATE 后 model_first → 场景题先只做展示（合成数据对措辞敏感，测试集 0.951 是分布内成绩）
- ⬜ 数据飞轮：recognition_log 补 7 列（jev_top3/llm_label/llm_conf/source/user_from/user_to/context_hash）；source 权重分层；Jev 高置信输出**不训自己**
- ⬜ 上线三道坎：模型随包分发（extraResources）/ 推理去 Python 化（onnxruntime-node + TS 移植 ~500 行）/ 诊断页+导出诊断包
- 🔧 **文件监控 jev 化**：✅ 合并器已落地（fileAggregator.ts，60s 窗口→file_windows.jsonl 攒训练对）；⬜ git 历史生成金标 → 训 file_class/work_activity → shadow → 接管；⬜ jev questions.json 扩题组

## 9. 工程与环境

- ✅ 2026-10-09 Windows→macOS 迁移：解压 + GBK 文件名修复 351 个 docs 文件 + 补漏 94 个（ml 模型/devOcr.ts/eng.traineddata 等）；git 历史完整
- ✅ 2026-10-09 mac 试跑通过：typecheck 双 tsconfig 全绿；dev 冒烟 70s（结论见 L1）
- ⚠️ **electron 二进制坑（mac 重装依赖时会再遇到）**：npm 装包时 extract-zip 会静默只解半截（Frameworks 缺失）；修法 = 清 `~/Library/Caches/electron` → `node node_modules/electron/install.js` 下载 → 若仍半截，直接 `unzip ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip -d node_modules/electron/dist` → `printf 'Electron' > node_modules/electron/path.txt`（**不能带换行**）→ `ln -sf Electron.app/Contents/MacOS/Electron node_modules/electron/dist/Electron`
- ✅ 2026-10-09 远端备份完成：**gitee.com/wang-yu1995/workon**（main，98 提交，SSH 推送，tracking 已设）；github origin 保留待网络好再推
- ⬜ 从 Windows 带资产：on-web 仓库、`D:\AI\workon小模型训练\`（OPTIMIZATION_PLAN / 11810 增强样本 / 映射表）
- ⬜ MediaPipe wasm + 姿态模型补齐（不入库：`@mediapipe/tasks-vision/wasm` → `src/renderer/public/mediapipe/wasm/`；pose_landmarker_lite.task）

## 10. 产品重做线（v10 落地中）

> **参考系新增（2026-10-12）：CopilotKit/OpenIntelligentUI**（生成式 UI 框架，MIT）——四个可吸收点已入下方待办：
> ①**渲染路由表**：按内容类型显式路由渲染器（它用 Jev 决策模型选路由——正好我们的 jev choice 题能当路由器："这个回答该用什么形式呈现"）
> ②**沙箱 HTML 拆件**：AI 生成轻量 HTML/CSS 可视化注入隔离 iframe（参数顺序 initialHeight→placeholder→css→html→js）+ 沙箱↔宿主验证桥（点击回传触发新一轮）——这是"AI 生成栏目/块进化"的实现路径
> ③**askQAStream 流式**+保阅读位置（通道已有未接 v10）
> ④错误透明（provider 错误明示不静默换模型——与我们诚实度价值观同款，已部分做）
> 已落地快赢：hover 复制 / KPI 卡点击追问（桥 v0：卡片交互→回填输入场 human-in-the-loop）

**已落地（2026-10-09，d650d25 + eb067a7，全链 E2E 验证）**：
- ✅ P2 骨架：左问右表新表面（?v10=1 / 旧版侧栏入口 / WORKON_V10=1），数据单一事实源
- ✅ P2 首启三步卡（职业/生活块/提醒意愿+协议启蒙）
- ✅ P3 提醒中心全链：对话「明天晚上8点提醒我X」→ nlu 解析（时段修饰已修）→ reminders.json → 到点对话流 amber 卡+桌宠气泡；不走 OS 通知；用户自设不扣预算
- ✅ P3 桌宠三级打扰载体放回：clips/chatter/care/roam
- ✅ P7 快捷回复协议：①② 选项按钮+回数字即答（确认/取消/延后 10 分钟三语义）
- ✅ P4 jev shadow（见 §8）
- ✅ P5 合并器攒训练对（jev 分类接管待数据）
- 截图存档：/tmp/v10shots/（s1 首启卡 / s2 建提醒 / s3 协议 / v10-main）
- ⬜ 待做：消息总线全量收口（三头蛇合流）· 拆件路由 UI · 记忆 moodboard · 例程清单 · 块进化拖入对话 · signals 层（Windows 依赖大半）· 悬浮窗正式退役切换

---

> 设计资产在 `~/AI/workon/`（v7 index.html 原型 + DESIGN.md + map* 能力图 + repo-docs/ v8/v9/MODULE-v9.1/SIGNALS）；jev 模型资产在 `~/Documents/DeepSeekHarness/workon-jev/`。

- 📌 目标四条（用户原话）：一人一面 · 简单入手 · 个性化 · 辅助 AI agent 能力
- 📌 竞品锚点：**Today.ai（todayai.cn，上海，「懂你所想为你先行」个人 AI 助理）= 直接对标**：五 tab（聊天/Today/记忆/任务/Spark）+ 鲜活记忆（人/偏好/目标）+ 主动帮助（睡眠→调日程）+ 条件例程 + 任务 agent + 云端电脑 + 连接器生态 + 社区 Skills；云服务、token 计费、移动优先。**WorkOn 差异化=本地行为采集（它只有连接器看不见实际行为）× 本地优先隐私 × 桌面陪伴层**；需吸收：主动文案结构（状态+洞察+具体提议+二选一）、记忆 moodboard 化、例程清单化、agent 完成度。（2026-10-09 修正：此前误比 todayai.com.cn 资讯站与 Dayflow）
- 📌 **首启设计已拍板（2026-10-09，用户修正）**：不是零卡片，是**指引式首启**——模块库全量存在、用户选择（勾选或对话式）；种子模块（如待办）可手动维护但**数据源同库共享**（单一事实源契约）；**提醒中心**=用户定时（"晚上提醒我"）走应用内提示框（amber 卡/悬浮窗），合并替代 OS 通知，用户自设提醒不受注意力预算扣减（自己授权的打扰优先级最高）
- 📌 「提醒」成为**拆解第六去向**（待办/工作项/备忘/存档/丢弃 + 提醒），"晚上9点提醒我看日报"= 对话输入 → 同一台拆解机器
- 📌 **桌面层简化已拍板（2026-10-09）**：悬浮窗（SuggestionWidget 三态）退役——主动询问并入主窗对话流（AI 可主动发起），**状态提示交给虚拟角色（桌宠）**；桌面常驻=桌宠唯一入口 + 可选待办树
- 📌 Today.ai 四点全采纳：主动文案四段式（状态+洞察+具体提议+二选一）/ 记忆 moodboard 化 / 例程清单化（与提醒中心合并设计）/ agent 完成度（任务卡步骤进度条）
- ✅ **v10 设计规格已定稿（2026-10-09）**：`docs/UI-DESIGN-SPEC-v10.md`（副本在 ~/AI/workon/repo-docs/）——统一 v7/v8/v9+SIGNALS+本周七项决策+文件监控 jev 化方案；取代三套分立表述
- ⬜ 主动消息总线：care/chatter/问卡/提醒/观察卡 统一出口 → 双呈现（主窗开着=左栏流；没开=桌宠气泡）；注意力预算只约束系统发起，用户自设提醒不扣
- 📌 **交互自进化已拍板（2026-10-09）**：主动消息系统整体可进化——①快捷回复协议（选项带编号①②，回数字即答；协议由元协商建立：用户表现出习惯→WorkOn 一次性确认→永久生效，存画像"交互习惯"层）②应答信号学习（立即回/看而不回/忽略/迟到续上/纠正，五类信号进账本）③五维进化（时机·频率·形式·通道·专注阈值，例程自动调优=超越 Today.ai 手设例程）④jev 新题型：应答预测 noul（P(用户会回应)）决定"现在发还是攒着"，先规则后模型 ⑤护栏：学到的习惯在镜里可见可改可删、降频可自动升频必须点头、每次进化可解释（"为什么20点才找我——你连5天18点没理我"）
- ⬜ 问答优化：jev 概率语言进对话（诚实不确定性）、回答嵌行动（"要我把这条加进待办吗"）、上下文自动附带桌宠状态
- 📌 **块进化交互已定（2026-10-09，v10 §4.C）**：拖组件入左栏输入框=挂对象芯片（或 [调] 按钮或自然语言指代）→ 一句话指令 → 意图解析（jev choice 小题）→ **参数 diff 就地重渲染**（旧版本进账本可召回）；万物皆可拖（待办行/来件卡/轨迹段/画像卡）
- ⬜ 新前端：从 index.html v7 原型 → React 单表面实现（16 视图坍缩为栏目类型）
- ⬜ 后端改造：L1-L3 引擎保留；L5 按新交互契约重写（视图路由→栏目数据契约）；Ollama/LM Studio 本地模型适配；待办/计划/提醒单一事实源契约
- ⬜ signals 层按文档顺序：音乐 → Everything → 文件夹 → 天气 → 消息 → 会议（+候选：AI 资讯日报源，契合用户 AI 开发者画像）

---

## 11. 产品递归审计（2026-10-09，报告：`docs/PRODUCT-AUDIT-2026-10.md`）

> 四路并行深读（桌面UX/信息架构/人性化/首启全局），全部带代码证据。总诊断：**内核优秀、外壳失控**（L2 人性化 6.5/10 vs 首启 2/10）。审计全面验证 v10 方向，另暴露 4 项 v10 未覆盖的新决策。

**P0 清单（信任/流失级，重做前就该修）**：
- ⬜ F1 首启同意门（现在默认静默记录+全局键鼠钩子默认开，types.ts:1127）
- ⬜ F2 **和风天气 API Key 打包出包**（types.ts:1137-1138，密钥泄漏，改用户自填）
- ⬜ F3 mac 平台能力告知（现在永远「等待采集…」静默空转）
- ⬜ F4 桌宠 20s 延迟创建提到首屏（index.ts:324-328）
- ⬜ C2 oner 通知 ttlSec=0 一行修（oner.ts:115）
- ⬜ D1/D2 死开关死按钮（托盘悬浮窗勾选无效/桌宠控制栏不可达）
- ⬜ A1 首页默认块 19 → 5-7
**P1/P2**：见审计报告 §5（预算三路收口/概念统一/设置归一/AI 配置链/假退出提示/时区/死码清理等 20 项）
**v10 需补充的新决策**：①同意门 ②平台能力告知 ③密钥出包 ④假退出提示
**用户实测**：报告 §6 有 mac 可测试用脚本 12 条

---

## 更新日志

- **2026-10-09（夜）** 产品递归审计完成（`docs/PRODUCT-AUDIT-2026-10.md`）：四路并行深读，总诊断「内核优秀、外壳失控」；P0 七项立此存照；v10 补四项新决策；块进化交互补进 v10 §4.C。
- **2026-10-09（晚）** 两条重大状态入账：① jev 模型已训好交付（DeepSeek 侧，Qwen3-0.6B+LoRA，真实集 0.953/ECE 0.035，含接入补丁）② 产品重做线立项（前端 v7/v9 统一 + 后端 L5 重写），设计资产在 ~/AI/workon/。竞品比较完成（Dayflow/Screenpipe/Reyn）。
- **2026-10-09** 环境迁移完成；任务板建立（合并交接文档 §8 + Cursor 账本 + jev 调研线 + 工程项）；mac 试跑通过（typecheck ✅ / dev 冒烟 ✅，Windows 探针报错被兜住）；electron mac 安装坑修法存档。
