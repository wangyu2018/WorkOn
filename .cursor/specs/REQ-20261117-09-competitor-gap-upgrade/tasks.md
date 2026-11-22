# REQ-20261117-09 Tasks

> 约定：每完成一项立即在 `workon/.cursor/task-ledger.md` 置顶该任务 ID 与验证证据（命令 + 返回片段）。
> 不新增调度器；定时统一走 `automationMinuteTick`。所有副作用先预览后落库。

## P0 —— 先补「拿得走」和「记得住」

### [x] T1 屏幕记忆开机自启 + 自检
- 文件：`src/main/ocrWorker.ts`、`src/main/ipc.ts`、`src/renderer/src/views/SettingsView.tsx`
- 改动：
  - `ocrWorker.ts` 新增 `getOcrQueueStats()`；主进程启动时若 `deepMode && !performanceMode` 调 `startOcr()`。
  - `ipc.ts` 新增 `ocr:stats` → `getOcrQueueStats()`。
  - `SettingsView.tsx` 在「深度模式」旁显示「最近采集 / 队列 / 快照数」，按钮「立即采集一次」（调 `ocrShotImage` 或现有 runOcr）。
- 依赖：无
- 验证：`window.api.ocrStats()` 返回 `lastTs` 非空；30 分钟后 `ocrShots(now-3600000, now).shots > 0`。

### [x] T2 记忆检索 searchMemory
- 文件：新增 `src/main/memory/index.ts`；`src/main/ipc.ts`；`src/preload/index.ts`
- 改动：
  - `index.ts`：`ingest(ctx)` + `search(q, opts)`，P0 用内存倒排索引，数据源 `ocrSnapshots` / `ocrShots` / `knowledge` / `activities`。
  - IPC `memory:search`；preload `searchMemory(q, opts)`。
- 依赖：无（T1 提供数据）
- 验证：`window.api.searchMemory('workon')` 返回数组，元素含 `{ts, source, text, ref}`。

### [x] T3 报告导出 exportReport（md/html/pdf）
- 文件：`src/main/report/engine.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/renderer/src/views/ReportHub.tsx`
- 改动：
  - `engine.ts` 新增 `exportReport(date, format)`：复用 `generateReport`，md 直接模板拼接，html 走现有 section 结构，pdf 用隐藏 `BrowserWindow` + `webContents.printToPDF`。
  - 落盘 `app.getPath('documents')/WorkOn Deliverables/<YYYY-MM-DD>/report-<date>.<ext>`。
  - IPC `report:export`；preload `exportReport`；`ReportHub.tsx` 加「导出 MD / HTML / PDF」三个按钮，成功 toast 展示路径。
- 依赖：无
- 验证：`window.api.exportReport(today,'pdf')` 返回 `{path}` 且文件存在、可打开、含当日 entries 文案。

### [x] T4 版式 AST + HTML 单文件渲染
- 文件：新增 `src/shared/deliverable/spec.ts`、`src/main/deliverable/theme.ts`、`src/main/deliverable/html.ts`、`src/main/deliverable/render.ts`；`src/main/ipc.ts`；`src/preload/index.ts`
- 改动：
  - `DeliverableSpec` 支持 `cover/heading/paragraph/metrics/table/chart/flow/timeline/callout/image/footer`。
  - `theme.ts`：字号阶梯 14/16/20/28/40、8pt 间距、A4 页边距、中文字体栈、暗/亮两套色板。
  - `renderHtml()`：单文件、CSS 内联、`@media print` + `break-inside: avoid`；`deck` 输出 16:9 分页。
  - `render(kind, spec)` 先支持 `md/html/pdf`；落盘 `~/Documents/WorkOn Deliverables/<date>/`。
  - IPC `deliverable:render`；preload `renderDeliverable`。
- 依赖：T3（pdf 复用 `printToPDF`）
- 验证：`renderDeliverable('html',{template:'brief',...})` 生成单文件，浏览器可开，含封面与 print CSS。

### [ ] T4b 图表 SVG 工具包（抽库，防回归）
- 文件：新增 `src/shared/viz/svg.ts`、`src/shared/viz/flow.ts`；改造 `src/renderer/src/views/ReportHub.tsx`、`src/renderer/src/components/ui/Sparkline.tsx`、`src/renderer/src/v10/FlowMap.tsx`
- 改动：
  - 提供 `donut / bars / line / sparkline / heatmap / funnel / flow`，纯字符串 SVG，零依赖。
  - `ReportHub` 的 `Donut`、`Sparkline`、`FlowMap` 改为调用共享函数，**视觉参数不变**。
- 依赖：无
- 验证：改造后 ReportHub 与原先截图对比无差异；`donut()` 单测输出含 `<svg` 且比例正确。
- 现状：`@shared/viz` 已落地并被 A2UI 与导出链路使用；旧组件（ReportHub/Sparkline/FlowMap）改造延后，避免视觉回归。

### [x] T4c 模板 + PNG 长图
- 文件：新增 `src/main/deliverable/templates/{brief,report,deck,poster}.ts`、`src/main/deliverable/png.ts`
- 改动：
  - 四个模板把 `generateReport` 的 sections/entries/stats 转 `DeliverableSpec`。
  - `png.ts`：隐藏 `BrowserWindow`（`show:false`, `deviceScaleFactor:2`）加载 HTML → `capturePage()` → 宽 1080 长图。
  - `exportReport(date, format, template)` 串起 generate → toSpec → render。
- 依赖：T4/T4b
- 验证：同一份数据导出 4 个模板，页数/分页/字号明显不同；PNG 宽 1080、2x、无截断。

### [x] T4d A2UI 卡片扩容
- 文件：`src/shared/a2ui.ts`、`src/renderer/src/components/a2ui/A2uiSurfaceView.tsx`
- 改动：
  - 新增 `chart`（donut/bars/line/spark/funnel/heatmap）、`compare`、`flow`、`progress`、`image`、`kanban`。
  - 渲染统一走 `@shared/viz/svg`；`image.src` 只允许 https 或白名单本地路径。
  - `A2UI_PROMPT_HINT` 补 6 类 JSON 示例；坏卡仍丢弃并降级 markdown。
- 依赖：T4b
- 验证：问「本周各应用时长对比」出 `chart` 卡；问「流程」出 `flow` 卡；应用内图表与导出 HTML 布局一致。

### [x] T4e 流程图/思维导图导出
- 文件：`src/shared/viz/flow.ts`、`src/renderer/src/v10/FlowMap.tsx`、`src/renderer/src/v10/mindmap.tsx`、`src/renderer/src/views/WorkflowView.tsx`
- 改动：`toFlowBlock(nodes, edges)` 抽为纯数据函数；WorkflowView 加「导出为交付物」（HTML/PNG）。
- 依赖：T4/T4b
- 验证：WorkflowView 导出 HTML 中 `flow` block 的节点/箭头与画布一致。

### [x] T4f 生成编排器 + 双闸门（先于渲染）
- 文件：新增 `src/shared/deliverable/audit.ts`、`src/main/deliverable/orchestrator.ts`；`src/main/ipc.ts`；`src/preload/index.ts`
- 改动：
  - 状态机严格按 spec 5.5：`draft → audit:draft → gate:draft → classify → bind → spec → audit:spec → fix → gate:spec → render → record`。
  - `classifyRisk()`：`pages>5 || hasExternalData || hasPrivacySensitive` → `needsAstConfirm=true`。
  - `render()` 仅 Orchestrator 可调；`render_deliverable` 未 confirmed 返回 `GATE_NOT_CONFIRMED`。
  - db 新增 `deliverableJobs` / `deliverableAudits`；`deliverable:revert` 支持回滚 revision。
- 依赖：T4
- 验证：说「做一份周报 PPT」→ 只出草案、磁盘无文件；确认后才有文件；直接调 `render_deliverable` → `GATE_NOT_CONFIRMED`。

### [x] T4g 审计规则引擎 + 审计 Agent
- 文件：新增 `src/main/deliverable/rules.ts`、`src/main/deliverable/auditAgent.ts`
- 改动：
  - 规则：`checkProvenance`（无源数字 high）、`checkConsistency`（图表/表格/正文不一致 high）、`checkLayout`（标题 60/段落 400/页数上限）、`checkPrivacy`（路径/邮箱/手机号/人名/应用名脱敏）、`checkCompliance`（外发需 `privacyReviewed`）。
  - 审计 Agent：独立 system prompt，只收 `{spec, provenanceManifest, templateMeta}`，输出 `AuditResult`；不拿 Writer 推理过程。
  - `autoFix()` 只处理 `autoFixable`，可重取数、可脱敏，**禁止伪造 `source`**；一轮后仍有 high → `escalate`。
- 依赖：T4f
- 验证：构造无来源数字 → `audit:draft` 返回 high；脱敏后可过；二次失败 job 变 `escalated`。

### [x] T4h 草案卡 / AST 预览 / 审计留痕
- 文件：新增 `src/renderer/src/components/DeliverableDraftCard.tsx`；`src/main/deliverable/render.ts`
- 改动：
  - 草案卡展示章节树、要点、图表清单（含来源）、预计页数、审计角标；操作：改章节/删图表/换模板/确认。
  - 高风险时追加 AST 预览确认（版式缩略图 + 页数 + 图表清单）。
  - 产物旁生成 `audit-<revision>.json` 与「数据来源附录」。
- 依赖：T4f/T4g
- 验证：6 页 deck 出现两次确认；2 页 brief 一次；产物目录含 `audit-1.json` 且每个数字有 tool trace。

### [x] T5 工具注册：search_memory / draft_deliverable / revise_deliverable / render_deliverable
- 文件：`src/main/tools.ts`、`src/main/ai.ts`
- 改动：
  - 工具**追加到 `WORKON_TOOLS` 末尾**，严禁插到 `PET_TOOLS` 之前（保持索引稳定）。
  - `draft_deliverable` 只建 job 返回草案；`revise_deliverable` 带 issues 重写；`render_deliverable` 受闸门约束。
  - `buildSystemPrompt` 增加「记忆与交付」段：先草案后渲染、不得绕过确认。
- 依赖：T2/T3/T4/T4b/T4d/T4f
- 验证：问助手「导出今天的报告」→ 调用 `export_report` 并返回路径；问「上周我在哪看过 xxx」→ 调 `search_memory`。

### [x] T6 自动化新增动作
- 文件：`src/shared/types.ts`、`src/main/automation.ts`、`src/renderer/src/views/PlanView.tsx`（或自动化设置所在组件）
- 改动：
  - `ActionKind` 增加 `exportReport | runWorkflow | renderDeliverable`。
  - `automationMinuteTick` 分发到 T3 / `runWorkflowById` / T4。
- 依赖：T3/T4
- 验证：新建 `exportReport` 规则 → `fired=true` 且磁盘出现文件；删除规则与产物。

### [x] T7 web_test 预导航修复
- 文件：`src/main/webTest.ts`
- 改动：`runWebTest` 开始处强制 `await browserNavigate(url)`，失败直接返回带建议的 report；保留原 `-3` 错误文案。
- 依赖：无
- 验证：连续 2 次 `runWebTest({url:'https://example.com'})` 均 `steps>0`、无 `-3`。

## P1 —— 再补「读得进」和「排得开」

### [x] T8 富文档解析
- 文件：新增 `src/main/knowledge/parser.ts`；`src/main/ipc.ts`
- 改动：`parseFile()` 支持 txt/md/json/csv/log + docx(`mammoth`) + pdf(`pdf-parse`) + xlsx(`exceljs`)；`knowledge:importFiles` 改为调用它，失败逐文件回报不整体失败。
- 依赖：新增依赖 `mammoth` `pdf-parse` `exceljs`
- 验证：导入 1 docx + 1 pdf + 1 xlsx，`listKnowledge()` 出现 3 条非空文本且 `kind` 正确。

### [x] T9 计划时间块
- 文件：`src/main/projects.ts`、`src/main/ipc.ts`、`src/renderer/src/views/PlanView.tsx`、`src/shared/types.ts`
- 改动：
  - `aiSchedule` 返回 `{order, blocks, error?}`；非法 JSON 返回 `error` 而非空数组。
  - `PlanItem` 增加 `endMin?`；`PlanView` 渲染时间块（复用 CalendarView 的刻度样式）。
- 依赖：无
- 验证：对「Trae 大赛」调 `aiSchedule` → `blocks.length>0`；计划页出现带起止时间的块。

### [x] T10 replanTick 重排
- 文件：新增 `src/main/planner/timeBlocks.ts`；`src/main/automation.ts`
- 改动：`replanTick()` 每 15 分钟对比未完成块，产出「顺延/拆分/放弃」建议，必须经 `plans:propose` 预览，未确认不写库。
- 依赖：T9
- 验证：手动触发后出现预览卡；取消后 `listPlans()` 数量不变。

### [x] T11 MCP Server + 白名单 dispatch
- 文件：新增 `src/main/mcp/server.ts`；`src/main/agentAdapters/mcpAdapter.ts`
- 改动：
  - Server 暴露 `memory.search` / `plan.list` / `report.export`（只读 + 导出）。
  - Adapter 增加 `allowTools: string[]`；命中白名单才 `dispatch:true`，每次调用广播确认事件。
- 依赖：T2/T3
- 验证：白名单 Agent 调一次 `memory.search` 成功，renderer 出现确认；非白名单仍 `dispatch:false`。

### [x] T12 节点 fs.write（带 diff）
- 文件：`src/main/nodes.ts`、`src/preload/index.ts`
- 改动：新增 `fs.write`，限制 `~` 与项目目录；返回 `{preview, diff}`，需 renderer 确认后写。
- 依赖：无
- 验证：对临时文件写一次 → 出现 diff；拒绝则不落盘。

### [x] T13 日历 ICS / CalDAV
- 文件：新增 `src/main/connectors/calendar.ts`；`src/main/ipc.ts`
- 改动：`listEvents` / `upsertEvent`；P1 只做 ICS 订阅 + CalDAV；接入 `planBlocks` 的 busy 区间。
- 依赖：T9
- 验证：订阅一个 ICS → `listEvents(今天)` 返回事件；计划块避开 busy 区间。

## P2 —— 最后补「生成得了」和「跑得快」

### [x] T14 docx / pptx 生成
- 文件：`src/main/deliverable/render.ts`
- 改动：增加 `docx`(`docx`) 与 `pptx`(`pptxgenjs`) 两个 kind。
- 依赖：T4
- 验证：各生成 1 个文件，能打开且标题/正文正确。

### [ ] T15 音频记忆
- 文件：新增 `src/main/audio/capture.ts`、`src/main/memory/index.ts`
- 改动：麦克风/系统音频 → 本地转写 → `ingest({source:'audio'})`；默认关，显式开启 + 保留天数。
- 依赖：T2
- 验证：开启后录 1 分钟 → `searchMemory` 能检索到关键词。
- 现状：需要本机录音权限 + 本地 ASR 模型，本轮未接入；不做假实现（避免“看起来能录音”实际无转写）。

### [x] T16 多 Agent 并行 + 校验循环
- 文件：`src/main/ai.ts`、`src/main/agents.ts`
- 改动：工具调用并行；生成类任务加「生成 → 自检 → 修正」一轮。
- 依赖：T5
- 验证：一次请求触发 ≥2 个工具并行；交付物自检失败时自动重试 1 次并记录。

## 执行门禁

1. 每次改主进程/preload 后必须手动重启 dev（watcher 不一定生效）。
2. 每个任务完成后跑对应验证命令，把返回片段写进 `task-ledger.md`。
3. P0 全部通过后再进 P1；不得并行改 `src/main/ipc.ts` 的 `plans:remove` / `projects:*` 段（历史误删点）。
