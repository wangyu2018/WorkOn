# WorkOn 产品需求文档（PRD）

> 版本：v1.0（截至 2026-07-20 现状）
> 定位：Windows 桌面端极简时间与工作记录工具 + 虚拟人桌搭（桌面搭子）
> 核心理念：**本地优先、隐私合规、双屏并行精准归因、越用越聪明**

---

## 1. 产品概述

WorkOn 是一款常驻系统托盘（Tray）的 Windows 桌面应用，自动、无感地记录用户每天在电脑上的真实工作状态与时长，并结合 AI 画像给出可执行的效率建议。区别于传统时间记录工具，WorkOn 重点解决两类痛点：

1. **双屏并行无法准确归因**——主屏干活、副屏听歌/刷视频时，传统工具会把双屏时长算成两倍或误判为摸鱼。
2. **不够"懂你"——缺乏长期沉淀与轻量反馈闭环**——记录只是数据，无法随用户习惯自我校准。

WorkOn 在本期已落地**真实前台窗口采集（不依赖第三方原生模块）**、**双屏合并轨迹**、**轻问诊确认/否定回流闭环**、**计划 vs 实际达成率**，形成"采集 → 分析 → 建议 → 反馈 → 更准"的完整回路。

---

## 2. 背景与痛点

| 痛点 | 现状 | WorkOn 的解法 |
| --- | --- | --- |
| 手动记时间太累 | 番茄钟/手填易中断、易忘 | 前台窗口自动采样，免手动 |
| 双屏被算成双倍时长 | 多屏同时在线被重复计时 | 墙钟合并轨迹，并行屏只计一次；保留各屏独立占用 |
| 摸鱼 vs 放松分不清 | 听歌、看文档常被误判为分心 | 媒体类"粘性"记录 + 轻问诊确认/否定回流 |
| 分析是死的 | 规则固定、无法个性化 | 用户反馈沉淀为长期偏好，越用越聪明 |
| 原生模块装不上 | active-win 在 Node25/Electron33 编译失败 | 改用 Windows 原生 Win32 P/Invoke（PowerShell 内联） |
| 数据出本机有隐私风险 | 云同步默认开启 | 全部本地存储，WS 仅监听 127.0.0.1，深度 OCR 默认关闭 |

---

## 3. 目标用户与场景

- **深度工作者 / 程序员**：双屏写码+副屏听歌，需要准确的工作时长与专注度。
- **被管理待办的知识工作者**：通过 oner 对接把外部任务拉进来，并回写完成状态。
- **想了解自己节奏的人**：通过热度图、计划 vs 实际、画像看到"我到底把时间花在哪"。

典型场景：
- 早上打开电脑，WorkOn 自动开始记录；右下角悬浮窗显示"正在写代码 · 已专注 47 分钟"。
- 副屏刷短视频时，悬浮窗偶尔问一句"这是在忙里偷闲还是走神了？"，点"确认"后该类时段被标注为轻松办公，不再计入摸鱼。
- 下班前看 PlanningPanel 的"计划 vs 实际"，发现计划 6h 实际只干了 3.5h，达成率 58%，及时调整次日安排。

---

## 4. 核心功能清单（F1–F18）

### F1 前台窗口监控（真实采集，P0）
- 通过 `winInfo.ts` 调用 **Windows Win32 API（PowerShell 内联 C# P/Invoke）** 获取前台窗口的 exe / 标题 / 坐标，反查所在屏幕索引，并映射为友好名（VSCode / WeChat / Chrome…）。
- **不依赖 `active-win` 原生模块**，规避本机编译失败；测试已返回真实窗口 JSON（双屏坐标 `-2887` 证明双屏识别有效）。
- `monitor.ts` 按 `monitorInterval`（默认 5s）轮询，段变化才刷新 `startTs`，支持双屏并行追踪；空闲时间用 `powerMonitor.getSystemIdleTime` 推断。
- `deepMode` 深度模式：定时无感截图 → 本地 OCR（`tesseract.js`）→ 入库（默认关闭，避免隐私与性能开销）。

### F2 双屏并行识别与合并轨迹
- `trail.ts → buildMergedTrail()`：把多屏并行活动按墙钟时间轴切成统一片段序列。
- 关键算法：并行屏只按墙钟计一次总时长（不重复累加），但保留各屏独立占用分钟（`screenMinutes` 可 > totalMin）。
- 区分"激活屏（主工作）"与"背景副屏"，算出：双屏并行占比 `dualRatio`、"主工作+副摸鱼"并行分钟 `dualWorkSlackMin`、主屏主导态 `mainState`、副屏主导态 `auxTopState`。

### F3 实时工作状态推断引擎
- `presence.ts`：每轮由 `monitor` 推入前台信息，推断各屏 `WorkState`（coding/aiqa/slack/relax…）。
- **媒体类"粘性"记录**：副屏听歌/视频一旦出现即钉住为 `relax`，后续该屏远程控制/文档不再覆盖，保证持续记录。
- **主屏选择**：激活屏优先（但排除纯放松/摸鱼/空闲，避免听歌前台带偏整体状态），否则选首个工作屏。
- 输出 `focusLevel`（0–100）与 `context`（如 `dual-aidev-relax` 主屏AI开发·副屏轻松），驱动悬浮窗与轻问诊。

### F4 轻问诊闭环（确认/否定回流，P1）
- `ai.ts → genQuestion(ctx)` 由双屏情境生成一条确认型问题（如"主屏写代码、副屏听歌——这是你常态的轻松办公方式吗？"）。
- `SuggestionWidget` 弹出"确认/否定"：`recordFeedback()` 把反馈落库 `feedbacks` 集合（`UserFeedback`），同时沉淀为画像备忘。
- **闭环**：`genQuestion` 对已确认（`answer='yes'`）的情境不再追问——偏好跨会话沉淀，越用越聪明。

### F5 计划 vs 实际达成率（P1）
- `planAnalysis.ts → planVsActual(plans, trail)`：把结构化计划与当日合并轨迹比对。
- 输出：计划总时长、实际工作分钟（墙钟、不重复计并行屏）、达成率（封顶 100%）、逐条计划覆盖情况。
- `PlanningPanel` 顶部展示"计划 vs 实际"卡片（计划时长 / 实际工作 / 达成率 / 匹配数 / 偏差）。

### F6 AI 画像分析（LLM / 规则回退）
- `ai.ts`：聚合当日事实（`aggregate`）→ 调用 OpenAI 兼容接口 或 **纯本地规则回退** `ruleAnalyze`。
- 产出 `UserAnalysis` 画像：专注力/效率评分、高频类别、高效时段、易分心应用、优势/风险、**双屏画像**（是否常态双屏、主屏工作、副屏活动、主工作+副摸鱼占比、摸鱼时做 AI 开发特征）。
- 画像沉淀本地并注入系统提示词（`buildSystemPrompt`），驱动问答与建议。
- `generateTodos` / `generateTips` 由画像派生可执行待办与提示卡片。
- `askWithContext` 带画像上下文的问答，规则回退时给本地小结。

### F7 日历与时间轴
- `DayTimeline` / `WeekGrid`：按日/周展示活动轨迹、状态色块、计划条目；支持日历拖拽录入（`TimeEntry`）。

### F8 计划/待办管理
- `PlanningPanel` + `planStore`：结构化 `PlanItem`（日期、起止/时长、类别、状态）。
- 类别：`ai-dev` / `work-customer` / `leader` / `personal` / `other`；状态：`planned` / `done` / `cancelled`。
- `planImport.ts`：计划导入解析（自然语言/文本 → 结构化）。

### F9 问答回顾（QAReview）
- `qaStore` + `QAReview`：历史问答消息流（`QAMessage`），回顾 AI 交互。

### F10 工作热度图（Heatmap）
- `analytics/Heatmap`：按状态/时段聚合的热度可视化，发现节奏规律。

### F11 虚拟人桌搭（桌面搭子）
- `BuddyStage` / `MiniAvatar` / `PetAvatar`：卡通虚拟人皮肤（aria / luna / leo），由后台 `WorkState` 驱动微动与表情。
- 与桌宠**并排合并展示**，经本地 WebSocket + JSON 快照对外暴露、支持双向回写。
- 当前素材为 DiceBear 本地 SVG（结构就绪，可换 Lottie JSON）。

### F12 右下角悬浮窗（SuggestionWidget）
- 透明无边框常驻窗：状态 + 桌宠 + 实时建议。
- 状态驱动：持续摸鱼 > 180s 自动隐身；回到工作弹"欢迎回到正事"提醒。
- 轻问诊提问、透明度调节、展开/收起。

### F13 命令面板（CommandPalette）
- `Ctrl+Space` 唤起：快速动作、计划录入、设置跳转等。

### F14 oner 待办双向同步
- `oner.ts`：主动 `GET {endpoint}/plans` 拉取 + `PATCH {endpoint}/plans/{id}` 回写完成/取消状态。
- 字段兼容识别（id/extId/uid、title/name/task 等）、类别关键词猜测、按 `extId` 增量去重（保留本地状态）。
- Bearer Token 鉴权，可配自动同步间隔。

### F15 本地集成（WebSocket + 快照）
- `integration.ts`：监听 `127.0.0.1:18765`，实时广播 `DesktopState`。
- 双向回写：`pet`（桌宠状态）、`memo`（外部导入备忘）。
- 可写 `state.json` 快照，供外部程序（如桌宠）读取。

### F16 活动纠错与常驻纠偏规则
- `ActivityCorrection`：按时间段 + 屏幕覆盖被误记的活动（app/title/state），落库后反映到轨迹/日历/分析。
- `CorrectionRule`：从纠错中沉淀"识别规律"，命中即自动改写（宁漏勿误：screen + matchApp + matchTitleContains 全满足才命中）。

### F17 使用成本模块
- `UsageStat`：按模型聚合当日 token / 问答次数，`ai.ts → chat()` 调用时累计。
- 估算 USD 花费，展示于 AI 分析页；`aiAutoRefresh` 固定刷新当日画像以省 token。

### F18 全局快捷键与系统托盘
- `globalShortcut.ts` + `tray.ts`：命令面板、悬浮窗显隐、退出等；托盘常驻、阻止误关。

---

## 5. 数据模型（核心实体）

> 定义于 `src/shared/types.ts`，主进程 / 渲染进程 / 预加载桥 / 外部集成协议共用。

| 实体 | 说明 |
| --- | --- |
| `WorkState` | 13 种工作态：focus/slack/writing/coding/aiqa/aidev/meeting/idle/break/away/relax/lunch/remote（含标签/颜色/emoji 元信息 `WORK_STATES`） |
| `ActivityRecord` | 每条前台采样：ts/app/title/state/screen/startTs/active，落库为原始轨迹 |
| `TimeEntry` | 日历手动/监控录入的时段（起止分钟 + 日期 + 标题 + 来源） |
| `PlanItem` | 结构化计划/待办：日期、起止或时长、类别、来源（manual/oner/import）、状态 |
| `MergedTrail` | 双屏合并轨迹：totalMin/dualMin/dualRatio/screenMinutes/mainState/auxTopState/dualWorkSlackMin/segments |
| `UserAnalysis` | AI 画像：profile（评分/类别/时段/分心应用/双屏画像）+ daily 小结 + patterns + questions + suggestions |
| `UserFeedback` | 轻问诊回流：ctx/answer('yes'\|'no')/question，驱动越用越聪明（**本期新增**） |
| `ActivityCorrection` / `CorrectionRule` | 活动纠错 / 常驻纠偏规则 |
| `MemoRecord` | 备忘（import/manual） |
| `ScreenshotRecord` | 深度模式 OCR 截图 |
| `UsageStat` / `UsageToday` | AI 调用用量与花费 |
| `DesktopState` / `PetState` | 实时桌面状态 / 桌宠状态（WS 协议） |

存储：主进程 `db.ts` 用 better-sqlite3，集合含 `activities/entries/screenshots/memos/plans/analyses/usages/corrections/rules/feedbacks`，全部位于本机用户目录。

---

## 6. 系统架构

```
┌─ 渲染进程 (React 18 + Zustand + Tailwind) ─┐      ┌─ 预加载 (contextBridge) ─┐
│ views: cal/mon/plan/heat/qa/ai/buddy/set   │ <=> │  window.api.*            │
│ stores: presence/plan/memo/qa/avatar/...   │      └──────────┬──────────────┘
└────────────────────────────────────────────┘                 │ IPC / invoke
                                                              ▼
┌─ 主进程 (Electron Main) ────────────────────────────────────────────────┐
│ monitor → winInfo(P/Invoke) │ presence(推断引擎) │ ai(分析引擎)            │
│ db(better-sqlite3) │ ipc │ integration(WS 127.0.0.1) │ screenshot+OCR     │
│ oner(双向同步) │ tray │ globalShortcut │ windows(主/悬浮/命令面板)         │
└──────────────────────────────────────────────────────────────────────────┘
        ▲                                          │
        └──── 外部桌宠 / oner 服务 / 本地 WS 客户端 ─┘
```

**分层契约（shared）**：`stateMeta.ts`（STATE_LABEL / WORK_STATES / SLACK_STATES / IDLE_STATES 唯一口径）、`trail.ts`（合并轨迹）、`planAnalysis.ts`（计划vs实际）、`types.ts`（全量类型）。

**降级策略**：
- `active-win` 缺失 → 已由 `winInfo` 原生 P/Invoke 彻底替代，本机监控始终可用。
- `tesseract.js` 缺失 → 深度 OCR 跳过，返回空结果。
- `aiApiKey` 缺失 / `aiEnabled=false` → 纯本地规则回退分析。
- 云端识别 / oner / WS 未配置 → 相应功能静默禁用，不影响核心记录。

---

## 7. 本期已交付（截至 2026-07-20）

| 优先级 | 改造项 | 状态 |
| --- | --- | --- |
| **P0** | 用 PowerShell P/Invoke（`winInfo.ts`）实现不依赖 active-win 的前台窗口采集，`monitor.ts` 移除"跳过、不写数据"逻辑，改为实时采集真实窗口 | ✅ 已构建通过，实测返回真实前台窗口 JSON（双屏坐标有效） |
| **P1** | 轻问诊"确认/否定"回写 `feedbacks`，`genQuestion` 跳过已确认情境，形成跨会话闭环 | ✅ 已构建通过 |
| **P1** | 新增 `planAnalysis.planVsActual`，`PlanningPanel` 接入"计划 vs 实际"达成率卡片 | ✅ 已构建通过 |
| **P2** | 统一 main/renderer 规则口径到 `shared/stateMeta.ts`，消除重复 label/集合 | ✅ 已构建通过 |
| **P2** | 清理死接口 `ai:systemPrompt` IPC handler（`buildSystemPrompt` 函数仍被内部使用，保留） | ✅ 已构建通过 |

> 注：以上均通过 `electron-vite build` 全量编译。主进程改动需**重启 Electron** 后生效（关闭 Electron 后再 `npm run dev`）。

---

## 8. 路线图 / 待办（Backlog）

**近期可激活能力（代码已就绪，待配置）**
- [ ] 填 `aiApiKey` + 开启 `aiEnabled`，激活真实 LLM 画像分析（OpenAI 兼容，支持中转/本地）。
- [ ] 安装 `tesseract.js` 并开启 `deepMode`，打开本地 OCR 深度识别。
- [ ] 配置 oner 接口地址/Token，打通外部待办双向同步。
- [ ] 开启 WebSocket 推送，对接外部桌宠做双向回写。

**体验完善**
- [ ] 虚拟人素材从 DiceBear SVG 升级为真实 Lottie JSON 动画（`AvatarSkin.assets` 已就绪）。
- [ ] 云端 OCR（`CloudRecognizer`）从占位实现为可配置服务。
- [ ] 计划 vs 实际：支持周/月维度聚合与趋势曲线。
- [ ] 轻问诊问题库扩展（午休、深夜摸鱼、远程协作等情境）。
- [ ] 纠错规则的可视化编辑 UI（当前由代码/数据层支持）。

**工程化**
- [ ] 自动化测试（主进程逻辑 + 渲染组件）。
- [ ] 打包发布流水线（electron-builder 已配置，验证签名/开机自启）。
- [ ] 多显示器（`screen` API）边界场景回归。

---

## 9. 非功能需求

- **隐私合规**：所有数据本地存储，不上传云端；WS 仅监听 127.0.0.1；深度 OCR 默认关闭。
- **性能**：默认采样间隔 5–15s 可调；单段时长封顶 1h 避免休眠跳变虚高；墙钟合并避免双屏双倍计时。
- **健壮性**：第三方依赖（active-win / tesseract.js）缺失时自动降级；`genQuestion`/纠错规则设计"宁漏勿误"。
- **可观测**：关键路径（监控跳过、OCR 失败、AI 调用失败）均有 console 告警且不刷屏。

---

## 10. 关键指标（建议跟踪）

- 真实前台窗口采集成功率（P0 已实测可用）。
- 双屏并行识别准确率（主屏工作 vs 副屏轻松）。
- 轻问诊确认率 / 反馈沉淀数（衡量"越用越聪明"闭环健康度）。
- 计划达成率分布（计划 vs 实际）。
- AI 使用成本（token / 问答次数 / USD）。
- 本地资源占用（DB + 截图缓存）。
