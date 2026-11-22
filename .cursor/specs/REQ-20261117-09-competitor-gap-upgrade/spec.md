# REQ-20261117-09 竞品同名能力对标与架构升级 Spec

> 依据：`personal-agent-market-2026-11.md` 的 8 家竞品 + 本机真实探针（CDP / IPC / 代码核对）。
> 竞品口径 = 官方公开页 / 文档（未登录实测）；WorkOn 口径 = 当前 dev 实例实测 + 代码事实。

## 1. 目标

把 WorkOn 从「记录—回看」型助手（passive observer）升级为「记忆—规划—执行—交付」闭环（agentic executor），
补齐与 WorkBuddy / 小浣熊 / Marvis / Manus Studio / Screenpipe / Littlebird / Motion / Reclaim 同名能力的差距。

成功判据（可验收，不靠感觉）：

1. 任一竞品能交付的产物（文档/表格/PPT/PDF/网页），WorkOn 至少能产出 1 种并落到磁盘路径。
2. 屏幕记忆在开启后有可核对的数据量（`ocrShots > 0`），且可被问答检索。
3. 计划从「排序」变成「时间块」，并支持一天内重排。
4. 自动化不再只有 4 个动作，能触发导出/工作流/交付物渲染。
5. 远程/MCP 从「只看」变「可执行」，且每次有确认。

## 2. 实测基线（2026-11-17 本机）

| 能力 | 实测结果 | 判定 |
|---|---|---|
| 前台感知 presence | `state=other`，idle 78s，前台 `TRAE CN` | 可用 |
| 今日轨迹 trail | 10 段 | 可用 |
| 行为分析 analysis | `focusScore=0`，`efficiencyScore=0` | 数据不足/无产出 |
| 今日计划 plans | 0 条 | 空 |
| 知识库 knowledge | 0 条 | 空 |
| 定时任务 automation | 新建 `daily + addTodo` → `saved=true, fired=true`（21:18），已清理 | 引擎可用 |
| Agent 列表 | `[{protocol:'manual', endpoint:'builtin', capabilities:['收藏抓取','本地摘要','变更追踪','情报入库']}]` | 仅观察型 |
| 报告 generateReport | keys=`templateId,date,sections,entries,stats,achievements,patterns,aiStatus,coverage,pendingReview`，entries=3；**无 html/markdown/path** | 仅应用内结构化 |
| 屏幕记忆 ocrShots | `{shots:0, snaps:0}`（近 24h） | 未采集 |
| 项目排期 aiSchedule | 返回 `[]`，无异常（模型输出非法 JSON 时静默返回空） | 只排序、不排时间块 |
| Web 测试 web_test | 首次失败（`-3 loading https://chat.deepseek.com/sign_in`，steps=0）；先 `browserNavigate('https://example.com')` 后成功：0 issues、1 截图、1203ms | 可用但对上次页面状态敏感 |

代码事实（grep 核对）：

- 无音频采集（无 audio / whisper 相关模块）。
- 无 Google / Outlook / CalDAV 连接器。
- `knowledge:importFiles` 只读 utf8 文本（txt/md/markdown/json/csv/log）。
- 无 docx / xlsx / pptx / pdf 生成库。
- 远程节点 P0 只读（`sys.info` / `fs.list` / `fs.read`）。
- MCP 适配器只握手（`dispatch:false`）。
- workflow 仅手动运行，无定时。
- automation 动作仅 4 种：`genReport` / `petCelebrate` / `notify` / `addTodo`。

## 3. 竞品公开口径（同名能力）

| 产品 | 输入 | 记忆 | 规划 | 执行 | 输出 |
|---|---|---|---|---|---|
| WorkBuddy | 本地文件 + 云沙箱 | Skills 记忆 | 自主规划、多 Agent 并行 | 本地文件写、浏览器、定时任务、MCP | PPT/Excel/Word/PDF/图片/视频/代码/网页 |
| 小浣熊 | 桌面本地文件、Quick Bar | 本地记忆 | 任务编排 | 飞书/钉钉、Skills、定时任务 | 文档类交付 |
| Marvis | OS 层级、屏幕接管 | 本地隐私模式 | 跨端续做 | 手机远控多台电脑、文件管理、系统设置、MCP | 系统级操作结果 |
| Manus Studio | My Computer 本地文件 | 云端会话 | 任务拆解 | 本地读写/整理/重命名/创建、授权终端命令 | 文件与代码产物 |
| Screenpipe | 24/7 屏幕 + 音频、可访问性文本 + OCR | 本地 SQLite、REST API、MCP Server | Pipes | 定时任务 | 结构化事件流 |
| Littlebird | 屏幕 + 无机器人会议记录、邮件/日历/文档连接 | 记忆问答、Hover | Routines | 只写草稿不代发 | 纪要/草稿 |
| Motion | 任务与会议 | — | 自动优先级 + 时间块、一天多次重排、AI 项目拆解 | 会议排期 | 日历排期 |
| Reclaim | 任务/日历同步 | Insights | 预览/审批、Habits/Buffers/Focus/Smart Meetings Agents | Todoist/Asana/Jira/Linear 同步 | 日历时间块 |

## 3.5 视觉交付与排版设计对标

> 这一层比的是「产物长什么样、能不能拿出去」：卡片、报表版式、图表/流程图、主题与排版、独立文件、交互回写。

| 产品 | 卡片 / 对话内视觉 | 报表版式 | 图表 / 流程图 | 主题与排版 | 独立产物 | 交互回写 |
|---|---|---|---|---|---|---|
| WorkBuddy | 对话卡片 + Skills 产出 | 由 Skill 定义版式 | 图表由 Skill 生成 | 有主题/模板 | PPT/Excel/Word/PDF/图片/网页 | 有（按钮/表单） |
| 小浣熊 | 文档类卡片 | 文档/表格版式 | 基础图表 | 模板较少 | 文档/表格 | 部分 |
| Marvis | 系统状态卡 | 无 | 无 | 无 | 无（只做系统操作） | 有 |
| Manus Studio | 会话内卡片 | 网页/文档产物 | 网页内图表 | 有 | 网页/文档/代码 | 有 |
| Screenpipe | 无设计层 | 无 | 事件流 | 无 | JSON / API | 无 |
| Littlebird | 纪要卡、Hover | 会议纪要版式 | 时间线 | 克制、单一 | 草稿（邮件/文档） | 部分 |
| Motion | 时间块卡 | 日历视图 | 甘特 / 时间线 | 单一 | 日历 | 拖动重排 |
| Reclaim | 时间块卡 | 日历 + Insights | 环图 / 柱状 | 单一 | 日历 / ICS | 审批交互 |
| **WorkOn（实测）** | A2UI 5 类：`metric` `table` `timeline` `steps` `link`；6 种 action | SmartReportView 9 种 section | 手写 SVG：Donut / Sparkline / AttentionCard；v10 `FlowMap`、`mindmap`、Workflow 画布、GraphView | Tailwind token，暗色单主题；无文档排版规范 | **无**（仅应用内） | 6 种：`open_view` `open_app` `plan_status` `snooze_reminder` `run_workflow` `open_url` |

结论：WorkOn 的「卡片 + 流程图」底子不弱于多数竞品，真正短板是 **资产化**——
1. 图表全是各视图里的手写 SVG（`ReportHub.tsx` 的 `Donut`、`ui/Sparkline.tsx`、`AttentionCard.tsx`、`v10/FlowMap.tsx`、`v10/mindmap.tsx`），没有共享图表层，无法复用进报表/卡片。
2. A2UI 只有 5 类卡片，**没有 chart / compare / flow / image / progress / kanban**，问「各应用时长对比」只能出表格。
3. 报表只有一种应用内暗色版式，**不能导出 HTML/PDF/长图**，也没有封面、页边距、字号阶梯这些「文档级」排版规范。
4. 流程图只能在应用内看，**不能嵌进报表、不能导出**。

## 4. 差距根因

1. **架构定位偏了**：WorkOn 的数据是「给别人看」的（报告/分析/轨迹），不是「给自己用」的（执行/交付）。写路径少、读路径多。
2. **输入层窄且默认关**：只有窗口/可访问性 + OCR，OCR 在性能模式/未开启 deepMode 时直接不采集；无音频、无日历邮件、无富文档解析。
3. **记忆层不闭环**：OCR 快照只留 7 天且当前 0 条；没有对外检索接口（无 MCP Server、无 search API），记忆无法被自己和外部 Agent 使用。
4. **规划层是「排序器」不是「排期器」**：`aiSchedule` 只返回任务顺序，不写时间块；失败静默返回 `[]`；计划与日历无双向同步，无重排循环。
5. **执行层被安全策略卡死**：MCP 只握手、节点只读、automation 4 动作、workflow 手动。能力存在但不可达。
6. **输出层缺「落到磁盘」**：报告是应用内 JSON 渲染，无 html/md/pdf/office 导出，用户拿不走产物。
7. **视觉能力没有资产化**：图表/流程图散落在视图组件里，A2UI 仅 5 类卡片且不可导出，报表只有单一主题，没有「版式」这一层抽象（没有 DeliverableSpec、没有模板、没有 theme token）。

## 5. 目标架构（五层）

```
输入 Input Bus
  screen(ocr)  audio(p1)  app(ax)  file(rich)  calendar/mail(p1)  browser
        │  统一 NormalizedContext {ts, source, app, text, ref}
        ▼
记忆 Memory
  ocrShots/ocrSnapshots + transcripts + docChunks + graph
        │  search(query, window) → 本地倒排（P0）→ SQLite FTS（P2）
        ▼
规划 Planner
  planBlocks(plan) → {startMin, endMin}   replanTick(15min + 事件)
        │  预览/审批，不静默改
        ▼
执行 Executor
  ToolRuntime: file / browser / terminal(白名单) / mcp / nodes(读写)
        │  每个副作用前有 diff 或确认
        ▼
输出 Deliverables
  DeliverableSpec(AST: cover/heading/paragraph/metrics/table/chart/flow/timeline/callout/image)
        │  templates: brief | report | deck | poster
        │  viz: shared SVG kit (donut/bars/line/spark/heatmap/funnel/flow)
        ▼
  render(kind, spec) → html(单文件+print CSS) / pdf / png(长图) / md / docx / xlsx / pptx
        │  落盘 ~/WorkOn Deliverables/<date>/
        ▼
  应用内展示 + 可打开文件 + 可被 automation/workflow 调用
  A2UI 卡片与报表共用同一 viz kit（同一份图表代码，两种出口）
```

## 5.5 生成协议：风险分级 + 双闸门审计

**原则：文字先行、确认后转换、写作与审计分离、审计不过不落盘。**

### 角色与权限

| 角色 | 职责 | 权限边界 |
|---|---|---|
| Writer Agent | `DraftSpec` → （确认后）`DeliverableSpec` | 可写 spec，**不可落盘** |
| Audit Agent | 独立上下文、只读审查，输出 `issues` | **不可改 spec、不可渲染** |
| Orchestrator | 状态机、revision、风险分级、闸门、落盘 | 唯一可调 `render()` |
| 人类 | 草案确认 / 高风险 AST 确认 / 二次失败裁决 | — |

### 状态机

```
intent
 → draft        Writer 只出文字草案（章节/要点/图表清单/预计页数，无 HTML/CSS）
 → audit:draft  Audit 审内容/版式/合规 → issues
 → gate:draft   人类确认草案（必过，可改章节/换模板/删图表）
 → classify     风险分级 → needsAstConfirm
 → bind         图表清单绑定真实工具数据，写 provenance{source, queryId, ts}
 → spec         生成 DeliverableSpec + revision
 → audit:spec   Audit 再审（数据一致性/溢出/隐私）
 → fix          自动修一轮（可重取数、可脱敏，禁止伪造来源）→ 回到 audit:spec
 → gate:spec    needsAstConfirm ? 人类确认 AST 预览 : 自动放行
 → render       落盘（文件名带 revision，不覆盖旧文件）
 → record       写 audit log + provenance + specHash
```

任一 `high` 问题在自动修一轮后仍存在 → `escalate`：job 暂停，把 issues 清单交回人类。

### 风险分级

```
needsAstConfirm = pages > 5 || hasExternalData || hasPrivacySensitive
risk = { level: 'high' | 'normal', reasons: string[] }
```

- `normal`：只卡「草案确认」一道（简报、长图、≤5 页报告）。
- `high`：草案 + AST 预览两道（演示、长报告、含外部数据或隐私字段）。

### 审计项

| 类别 | 检查 | 级别 | 可否自动修 |
|---|---|---|---|
| fact | 每个数值 block 必须有 `source.tool + queryId + ts`；无源即失败 | high | 否（只能重取数或删块） |
| consistency | 图表数据与表格/正文同名字段必须一致 | high | 否（需重绑数据） |
| privacy | 路径/邮箱/手机号/人名/应用名命中脱敏表，必须 `redacted:true` | high | 是（脱敏） |
| compliance | 存在 `shareTo`（外发）时必须 `privacyReviewed:true` | high | 否（需人工） |
| layout | 单块超限（标题 60 / 段落 400）、页数超模板上限、分页冲突 | medium | 是（截断/拆页） |
| semantic | LLM 审：结论是否有数据支撑、标题与内容是否一致、受众语气 | medium | 是（改写） |

审计落地为 **规则引擎 + 审计 Agent 混合**：确定性规则查来源/一致性/溢出/隐私正则；LLM 只做语义判断，避免「模型自己审自己」。

### 审计输出契约

```ts
interface AuditIssue {
  id: string
  level: 'high' | 'medium' | 'low'
  category: 'fact' | 'consistency' | 'privacy' | 'compliance' | 'layout' | 'semantic'
  blockId?: string
  message: string
  evidence?: string
  fixHint?: string
  autoFixable: boolean
}
interface AuditResult {
  jobId: string
  revision: number
  gate: 'draft' | 'spec'
  pass: boolean
  issues: AuditIssue[]
}
```

### 幂等与留痕

- `specHash = sha256(canonical(spec) + dataSnapshotTs)`；同 hash 直接复用产物，不重复渲染。
- db 新增 `deliverableJobs` / `deliverableAudits`：job 状态、revision、issues、specHash、产物路径。
- 产物旁生成「数据来源附录」：每个数字 → 对应 `tool + queryId + ts`。
- `deliverable:revert(jobId, revision)` 可回滚；旧 revision 文件保留。

### 工具闸门（防绕过）

- `render_deliverable` 在 job 未 `confirmed` 时直接返回 `GATE_NOT_CONFIRMED`，模型无法跳过确认。
- automation 的 `renderDeliverable` 只能引用已审批的 `approvedSpecId`，不允许运行时新建草案。
- 审计 Agent 与 Writer Agent 使用不同系统提示词与不同上下文，审计只拿到「spec + provenance 清单」，拿不到 Writer 的推理过程。

## 6. 改造契约

### 6.1 输入层

- `src/main/ocrWorker.ts`
  - `startOcr()` 在 `deepMode=true` 且 `performanceMode=false` 时随应用启动自动调用（当前只在设置 patch 时触发）。
  - 新增 `getOcrQueueStats(): { pending: number; lastTs: number | null }`，供设置页自检。
- `src/main/ipc.ts`
  - `knowledge:importFiles` 改为走 `src/main/knowledge/parser.ts`：
    - 新增 `parseFile(filePath): Promise<{ text: string; kind: 'text'|'docx'|'pdf'|'xlsx'|'pptx'|'image'; meta?: Record<string, unknown> }>`
    - P1 支持 docx（`mammoth`）、pdf（`pdf-parse` 或 `pdfjs-dist`）、xlsx（`exceljs`）、pptx（`pptxgenjs` 仅读形状/文本需另选 `pptx2json` 或自研 XML 解析）。
- 新增 `src/main/connectors/calendar.ts`（P1）
  - `listEvents(start, end): Promise<CalendarEvent[]>`
  - `upsertEvent(e): Promise<CalendarEvent>`
  - P1 只做 ICS 订阅 + CalDAV；Google/Outlook OAuth 放 P2。

### 6.2 记忆层

- `src/main/report/ocrCollector.ts`
  - `RETAIN_DAYS` 从常量改为读设置 `ocrRetainDays`（默认 30）。
  - 新增 `searchMemory(q: string, opts?: { start?: number; end?: number; limit?: number }): MemoryHit[]`。
- 新增 `src/main/memory/index.ts`
  - `ingest(ctx: NormalizedContext): void`
  - `search(q, opts): MemoryHit[]`（P0 用内存倒排 + db.json；P2 评估 better-sqlite3/FTS5，避免过早引入原生依赖）。
- 新增 `src/main/mcp/server.ts`（P1）
  - 暴露 `memory.search`、`plan.list`、`report.export` 三个只读/半只读工具，供外部 Agent 调用。

### 6.3 规划层

- `src/main/projects.ts`
  - `aiSchedule(projectId)` 返回类型改为 `{ order: string[]; blocks: Array<{ taskId: string; startMin: number; endMin: number }>; error?: string }`。
  - 解析失败不再返回 `[]`，返回 `{ order: [], blocks: [], error: '模型输出非 JSON' }`。
- 新增 `src/main/planner/timeBlocks.ts`
  - `planBlocks(input: { date: string; tasks: ProjectTask[]; busy: Array<{startMin:number;endMin:number}> }): PlanBlock[]`
  - `replanTick()`：每 15 分钟对比当前时间与未完成块，产出「顺延/拆分/放弃」三种建议，写 `plans` 前必须 `plans:propose` 预览。
- `src/shared/types.ts`
  - `PlanItem` 增加 `endMin?: number`（已有 `startMin`）。
  - automation 的 `ActionKind` 增加 `'exportReport' | 'runWorkflow' | 'renderDeliverable'`。

### 6.4 执行层

- `src/main/agentAdapters/mcpAdapter.ts`
  - `dispatch` 默认仍 false；新增按 Agent 的 `allowTools: string[]` 白名单，命中白名单时 `dispatch:true`，每次调用前广播确认事件。
- `src/main/nodes.ts`
  - P1 增加 `fs.write`（限定 `~` 与项目目录），写入前返回 `{ preview: string; diff: string }`，需 renderer 确认。
- `src/main/automation.ts`
  - `automationMinuteTick` 支持新动作：
    - `exportReport` → 调 `report/engine.exportReport`
    - `runWorkflow` → 调 `workflowRunner.runWorkflowById`
    - `renderDeliverable` → 调 `deliverable/render`
- `src/main/workflow.ts` + `workflowRunner.ts`
  - P1 增加 `schedule?: { cron: string }` 字段，由 `automationMinuteTick` 统一驱动（不新增调度器）。
- `src/main/browser.ts` / `webTest.ts`
  - `runWebTest` 开始前强制执行一次 `browserNavigate(target)` 重置页面状态（修当前对上次页面敏感的问题）。
  - 失败时保留 `-3` 错误码但补一条「先导航」建议。

### 6.5 输出层与视觉交付（最高优先级）

核心思路：**一份 AST，多种出口；一套图表，两处复用（应用内卡片 + 导出文件）。**

#### 6.5.1 版式 AST

- 新增 `src/shared/deliverable/spec.ts`
  - `DeliverableSpec = { template: 'brief'|'report'|'deck'|'poster'; title; subtitle?; date?; theme?: 'dark'|'light'; blocks: Block[] }`
  - `Block`：
    - `cover`（标题/副标题/日期/作者）
    - `heading`（level 1-3）
    - `paragraph`（text，支持 `**强调**` 与行内代码）
    - `metrics`（一行 2-4 个 KPI：label/value/unit/delta）
    - `table`（columns/rows/align）
    - `chart`（kind: `donut|bars|line|spark|heatmap|funnel`，data + 可选 caption）
    - `flow`（nodes[{id,label,kind}] + edges[{from,to,label?}]，横向自动布局）
    - `timeline`（items[{time,title,detail,state}]）
    - `callout`（kind: `info|warn|success`）
    - `image`（本地路径或 dataUrl + caption）
    - `footer`（出处/生成时间/隐私标记）

#### 6.5.2 图表工具包（复用现有手写 SVG）

- 新增 `src/shared/viz/svg.ts`（纯字符串输出，主进程/渲染层/HTML 模板共用，零依赖）
  - `donut(data, opts)` ← 抽取 `ReportHub.tsx` 的 `Donut`
  - `sparkline(data, opts)` ← 抽取 `components/ui/Sparkline.tsx`
  - `bars(data, opts)`、`line(data, opts)`、`heatmap(matrix, opts)`、`funnel(steps, opts)`
  - `flow(nodes, edges, opts)` ← 抽取 `v10/FlowMap.tsx` 的布局算法
- 改造 `src/renderer/src/views/ReportHub.tsx`、`src/renderer/src/components/ui/Sparkline.tsx`、`src/renderer/src/v10/FlowMap.tsx`
  - 删除各自内联实现，改为调用 `@shared/viz/svg`，视觉参数保持不变（避免回归）。

#### 6.5.3 HTML / PDF / PNG 渲染

- 新增 `src/main/deliverable/theme.ts`
  - 排版 token：字号阶梯 14/16/20/28/40，间距 8pt 网格，页边距（brief 48px / report 64px / deck 0），
    中文字体栈 `"PingFang SC","Noto Sans SC",system-ui`，暗/亮两套色板（沿用现有霓虹暗色 + 一套打印友好亮色）。
- 新增 `src/main/deliverable/html.ts`
  - `renderHtml(spec): string` —— 单文件 HTML，CSS 全部内联，含 `@media print`（A4 / `@page` 边距 / 避免分页断裂 `break-inside: avoid`）。
  - `deck` 模板输出 16:9 分页（`section.slide`，每页 `page-break-after`）。
  - 所有图表用 `@shared/viz/svg` 内联 SVG，不引外部 JS。
- 新增 `src/main/deliverable/png.ts`
  - 隐藏 `BrowserWindow`（`show:false`, `deviceScaleFactor:2`）加载 HTML → `capturePage()` → PNG 长图（宽 1080，高自适应）。
- 新增 `src/main/deliverable/templates/`
  - `brief.ts`：一页纸（封面 + 3 KPI + 1 图表 + 3 条结论）
  - `report.ts`：日报/周报（复用 `generateReport` 的 sections/entries/stats → blocks）
  - `deck.ts`：演示（每 block 一页，标题 + 要点 + 图表）
  - `poster.ts`：长图（纵向信息流，适合分享）
- `src/main/deliverable/render.ts`
  - `render(kind: 'md'|'html'|'pdf'|'png'|'docx'|'xlsx'|'pptx', spec: DeliverableSpec): Promise<{ path: string; bytes: number }>`
  - 落盘：`app.getPath('documents')/WorkOn Deliverables/<YYYY-MM-DD>/`
  - P0：md/html/pdf/png；P2：docx/xlsx/pptx。
- `src/main/report/engine.ts`
  - 新增 `exportReport(date, format: 'md'|'html'|'pdf'|'png', template?: 'brief'|'report'|'deck'|'poster')`：
    先 `generateReport` → `toSpec()` → `render()`；不改现有返回结构（entries/coverage 等 keys 不变）。
- `src/renderer/src/views/ReportHub.tsx`
  - 顶部加「导出」popover：格式（HTML/PDF/PNG/MD）× 模板（简报/日报/演示/长图），成功后 toast 显示路径并提供「打开文件」。

#### 6.5.4 A2UI 卡片扩容（与应用内视觉对齐）

- `src/shared/a2ui.ts`
  - `A2uiCard` 增加：
    - `chart`（kind: `donut|bars|line|spark|heatmap|funnel`，data）
    - `compare`（左右两列，columns + rows，带高亮侧）
    - `flow`（nodes/edges）
    - `progress`（label/current/total/unit）
    - `image`（src 仅允许 https / 本地 `file://` 白名单）
    - `kanban`（columns[{title, items[{title, tag?}]}]）
  - `MAX_CHILDREN` 保持 8；`A2UI_PROMPT_HINT` 同步补 6 类卡片的 JSON 示例。
- `src/renderer/src/components/a2ui/A2uiSurfaceView.tsx`
  - 新卡片一律调用 `@shared/viz/svg`，与导出报表同源。
- 质量门槛：新增卡片必须通过 `parseA2uiSurface` 校验，坏卡丢弃并降级 markdown（沿用现有策略）。

#### 6.5.5 流程图 / 思维导图导出

- `src/renderer/src/v10/FlowMap.tsx`、`src/renderer/src/v10/mindmap.tsx`
  - 抽出纯数据函数 `toFlowBlock(nodes, edges): FlowBlock`，不含 React 依赖，放 `src/shared/viz/flow.ts`。
- `src/renderer/src/views/WorkflowView.tsx`
  - 加「导出为交付物」：把当前 scene 转 `FlowBlock` → 插入 `DeliverableSpec` → `render('html'|'png')`。
- `src/renderer/src/views/GraphView.tsx`（P2）
  - 同上，先支持导出当前视口快照为 `image` block。

#### 6.5.6 工具与提示词

- `src/main/tools.ts`
  - 新增工具：`search_memory`、`export_report`、`render_deliverable`（追加到 `WORKON_TOOLS` 末尾，保持 `PET_TOOLS` 索引不变）。
  - `render_deliverable` 的入参直接收 `DeliverableSpec`（模型只描述内容，不写 HTML/CSS）。
- `src/main/ai.ts`
  - `buildSystemPrompt` 增加「可交付产物」段：说明模板、图表类型、落盘路径；强调「不生成任意 HTML，只用 AST」。
  - P2：工具调用改为并行 + 产物校验循环（生成 → 自检 → 修正）。

#### 6.5.7 生成编排与审计（对应 5.5）

- 新增 `src/shared/deliverable/audit.ts`
  - `DraftSpec`、`AuditIssue`、`AuditResult`、`RiskAssessment`、`DeliverableJob` 类型。
- 新增 `src/main/deliverable/orchestrator.ts`
  - 状态机：`startDraft()` / `confirmDraft()` / `classifyRisk()` / `bindData()` / `audit()` / `autoFix()` / `render()` / `escalate()` / `revert()`。
  - 唯一持有 `render()` 调用权；任何未经 `gate:draft` 的请求直接拒绝。
- 新增 `src/main/deliverable/rules.ts`
  - 确定性检查：`checkProvenance` / `checkConsistency` / `checkLayout` / `checkPrivacy` / `checkCompliance`。
- 新增 `src/main/deliverable/auditAgent.ts`
  - 独立 system prompt（审计员，不是作者），入参只有 `{ spec, provenanceManifest, templateMeta }`，输出 `AuditResult` JSON。
- `src/main/ipc.ts` + `src/preload/index.ts`
  - 通道：`deliverable:draft` / `deliverable:confirm` / `deliverable:revise` / `deliverable:audit` / `deliverable:render` / `deliverable:job` / `deliverable:revert`。
  - 事件：`deliverable:progress`（阶段、revision、issues 数量）。
- 新增 `src/renderer/src/components/DeliverableDraftCard.tsx`
  - 草案卡：章节树 + 每章要点 + 图表清单（含数据来源）+ 预计页数 + 审计问题角标；
  - 操作：改章节 / 删图表 / 换模板 / 确认；高风险时追加 AST 预览确认页。
- `src/main/tools.ts`
  - `draft_deliverable`：只建 job 并返回草案，不落盘。
  - `render_deliverable`：job 未 confirmed → `GATE_NOT_CONFIRMED`。
  - `revise_deliverable`：带 issues 重写，revision+1。

### 6.6 新增依赖

| 依赖 | 用途 | 阶段 |
|---|---|---|
| `docx` | Word 生成 | P2 |
| `exceljs` | Excel 生成/读取 | P1 |
| `pptxgenjs` | PPT 生成 | P2 |
| `mammoth` | docx 解析 | P1 |
| `pdf-parse` 或 `pdfjs-dist` | pdf 解析 | P1 |

不引入 `better-sqlite3`（原生模块，Electron 重编译成本高），P0 用内存倒排 + db.json。

## 7. 验收标准

| 编号 | 验收项 | 方法 |
|---|---|---|
| A1 | 屏幕记忆可采集 | 开启 deepMode 后 30 分钟内 `window.api.ocrShots(now-3600000, now)` 返回 `shots>0` |
| A2 | 记忆可检索 | `window.api.searchMemory('关键词')` 返回命中且带 ts/app/file |
| A3 | 计划成时间块 | `aiSchedule` 返回 `blocks.length>0` 且每个 block 有 `startMin/endMin`；计划页显示时间块 |
| A4 | 计划可重排 | 手动触发 `replanTick()` 后产生预览卡，未确认不落库 |
| A5 | 报告可导出 | `exportReport(today,'pdf')` 返回真实文件路径，文件可打开且含当日 entries |
| A6 | 交付物可渲染 | `render('md'|'pdf', …)` 落盘 `WorkOn Deliverables/<date>/` |
| A7 | 自动化新动作 | 新建 `exportReport` 规则 → `fired=true` 且磁盘出现文件 |
| A8 | MCP 可执行 | 白名单 Agent 调用一次工具成功，且控制台出现确认事件 |
| A9 | web_test 稳定 | 连续 2 次 `runWebTest` 均 `steps>0`，首次不再出现 `-3` |
| A10 | 知识库富文本 | 导入 1 个 docx + 1 个 pdf，`listKnowledge()` 出现 2 条非空文本 |
| A11 | 单文件 HTML 交付 | `exportReport(today,'html','report')` 生成 `.html`，双击可在浏览器打开，图表为内联 SVG，含 print CSS 与封面 |
| A12 | 长图 PNG | `exportReport(today,'png','poster')` 生成宽 1080、2x 的 PNG，文字不糊、无截断 |
| A13 | 模板差异可见 | 同一份数据用 `brief` / `report` / `deck` / `poster` 导出，版式明显不同（页数/分页/字号） |
| A14 | A2UI 新卡片 | 问「本周各应用时长对比」→ 出 `chart` 卡；问「流程」→ 出 `flow` 卡；问「这几个方案对比」→ 出 `compare` 卡 |
| A15 | 图表同源 | 应用内 `chart` 卡与导出 HTML 的同一图表，像素级布局一致（同一 `viz/svg` 函数） |
| A16 | 流程图可导出 | WorkflowView「导出为交付物」→ HTML 中出现 `flow` block，节点/箭头与画布一致 |
| A17 | 草案闸门 | 说「做一份周报 PPT」→ 先出文字草案卡，未确认时磁盘无任何产物；确认后才渲染 |
| A18 | 双闸门审计 | 构造一条无来源数字 → `audit:draft` 报 high；修复后通过；`audit:spec` 发现图表与表格不一致 → 自动修一轮 |
| A19 | 风险分级 | 6 页 deck 自动要求 AST 预览确认；2 页 brief 只确认一次 |
| A20 | 审计留痕 | 产物旁生成 audit 记录，含 `specHash`、issues、每个数字的 tool trace |
| A21 | 绕过防护 | 直接调 `render_deliverable` 未经确认 → 返回 `GATE_NOT_CONFIRMED` |
| A22 | 自动化限制 | `automation.renderDeliverable` 只能引用 `approvedSpecId`；未审批规则创建失败 |

## 8. 非目标

- 不做无人值守的支付/下单/删除等不可逆操作。
- P0/P1 不做手机远控（Marvis）与系统解锁。
- 不做云端多租户；保持本地优先。
- 不改现有 `generateReport` 返回结构（只加 `exportReport`）。

## 9. 风险与隐私

- 屏幕/音频采集必须有显式开关 + 保留天数 + 一键清除（`clearOcrCache` 已有）。
- 远程节点写操作必须 diff 预览 + 二次确认。
- MCP dispatch 必须按 Agent 白名单，默认关闭。

## 10. 实施顺序

P0（先补「拿得走」和「记得住」）：A1/A2/A5/A6/A7/A9
P0.5（视觉交付 + 生成协议，独立验收）：A11–A22
  —— 顺序：`@shared/viz/svg` 抽库 → `DeliverableSpec` → 编排器双闸门 → 审计规则+审计 Agent → HTML 模板 → PNG 长图 → A2UI 扩容 → 流程图导出
  —— 硬约束：先有闸门与审计，再开渲染；否则一次性生成会绕过确认
P1（再补「读得进」和「排得开」）：A3/A4/A8/A10 + 日历连接器
P2（最后补「生成得了」和「跑得快」）：docx/pptx 生成、音频记忆、多 Agent 并行
