# 个人需求台账（最近 10 条）

> Agent 自动维护。只保留最新 10 条。状态：`待开始` | `进行中` | `部分完成` | `已完成` | `已取消`

## REQ-20261122-10 · 2026-11-22

**原话**：我明天要把这个产品当做一个完整产品提交比赛了 你得帮我完整的梳理一遍，验证一遍啊，还有没有开源的 agent 验证工具，帮我验证一下，感觉差太多了

**状态**：`部分完成（主进程假死已修复；21 条自动化通过；165 场景已建跟踪清单）`

**处理**

- [x] 修复只读复合问题的 Super Agent 路由：禁止写入的约束分句不再误判为写请求；目标/计划/项目/轨迹等复合数据问题可进入数据子 Agent
- [x] 增加真实工作流成功/失败/刷新持久化、盯守基线/增量/去重/失败隔离、外部 Agent HTTP 500 留痕回归；确定性工作流测试改名 `WF-01`，不冒称 C8-14 外部 Agent A→B 已验证
- [x] 使用开源 Promptfoo v0.126.0 通过 CDP 调用真实 `window.api.askQA`，检查路由、工具、子 Agent、错误和数据计数
- [x] 修复 macOS 硬件探测：GPU 改用 `system_profiler SPDisplaysDataType -json`；UIA PowerShell 调用在非 Windows 直接返回，消除 `powershell.exe ENOENT`
- [x] 加强网页只读事实约束：`browser_navigate` 成功后自带正文快照；纯网址问题路由到 web 子 Agent，且不混入本地 data/knowledge；工具结果与汇总提示词要求只能引用返回字段
- [x] 工作流手动运行时外部 Agent 节点按已确认处理；新增 C11-02 未登录不写落点、C8-14 本地 HTTP Agent A→B 串联两条自动化用例
- [x] 修复 macOS 打包图标尺寸问题；更新 `docs/SCENARIO-TESTS-v2.md`，明确 21 条自动化与 165 条场景清单的边界
- [x] 修复启动假死：把 uiohook 原生输入钩子移入独立 Worker（`inputProbeWorker.ts`），主进程只做剪贴板哈希与快照拼装；3 秒未 ready 即终止 worker 并降级，界面/IPC 不再被原生阻塞
- [x] 打包适配：`asarUnpack` 解包 worker 与 `node-gyp-build`，Electron Builder 的 `files` 补充运行时依赖，打包产物验证 `[probe] 行为探针已启动`
- [x] jev 侧车改用 `ml/jev/.venv`（Python 3.12 + onnxruntime/numpy/tokenizers，已 gitignore），READY + 推理约 216ms；无依赖环境仍按原逻辑降级
- [x] 修复跨闭环一致性：删除计划时级联清理知识 `links` 中的 plan 关联，不再出现「已关联计划」死链且可重新转计划
- [x] 修复顺延可追溯性：延期副本保留情报/知识来源，并把原备注（含情报 URL、知识正文）追加在延期标记之后，不再丢失出处
- [x] 修复转计划幂等：知识与情报的「转今日计划」增加同步防重入，同一帧连点 10 次只创建 1 条；情报按钮态在刷新后按今日 `source=intel` 计划回填，不再因重启允许重复转计划
- [x] 新增 `e2e/consistency-boundary.spec.ts` 6 条用例：C4-14/C6-05、C6-01/C6-02/C5-11、C4-17/C7-05、C1-09/C1-18、C7-07
- [x] 补充 C8-06/07 派发守卫、C8-12 删除 Agent 级联记录、C10-07 暂停/恢复、C10-12 盯点上限自动化，e2e 总数 19 → 21
- [x] 生成 `docs/VERIFICATION-CHECKLIST.md`：165 条场景逐项勾选，标注 36 条自动化、23 条手工记录、4 条部分验证、102 条待验证

**验证**

- [x] `npm run typecheck`、`npm run typecheck:e2e` 通过；`npm run build` 通过（仅有既存 chunk 警告）
- [x] `npx playwright test`：21/21 通过（37.3s），含核心闭环、工作流失败、盯守、外部 Agent IO/守卫/删除级联/A→B 串联、C11-02 未登录保护，以及 C6/C7 一致性与边界 6 条
- [x] Promptfoo：4/4 通过（结果文件 `/tmp/workon-promptfoo-results-10.json`）；数据汇总实际调用 `data` 子 Agent，知识空态、网页只读、越权诱导均通过，计划/知识/工作流计数未变
- [x] `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir` 通过；打包产物用隔离档案（已授权隐私）冒烟通过：`[startup] ipc ok`、`[startup] 采集已启动`、`[probe] 行为探针已启动`，`window.api` 可用，临时目录已删除
- [x] 测试应用已停止；启动日志显示 `GPU: Apple M4 (0GB VRAM)`，不再出现硬件探测或 UIA 的 `powershell.exe ENOENT`
- [x] 真实数据回到计划 12、知识 0、问答 200、会话 9、项目 1、目标 5；已清理图谱中 1 条残留测试节点；9333/9445/18765/18790/18792/18794 端口均已关闭
- [ ] 未做：165 场景全量验收（C6/C7 仅新增所述条目）、外部 Agent A→B→C 全链、性能与权限边界全量测试（真实抖音读档链路已于 2026-11-22 验证）
- [ ] 已知非阻断项：网页总结事实稳定性仍受模型影响，需更多样本；`jev` 侧车仅本地开发可用（安装包不含 `ml/`），打包后走规则识别；Windows 构建/签名未做

---

## REQ-20261120-09 · 2026-11-20

**原话**：比如我提出一个盯的任务 ，比如我给你创建一个抖音账号，你能接受到我发给你的然后你去解决读取存档，跟我的喜好分析 然后到个人知识库，到知识清单 到各种地方

**口径**

- 用户只给三件事：盯谁（账号）/ 要什么数据 / 存到哪儿；读取、分析、分发由 agent 自己完成
- 抖音不碰账号密码、不绕风控；用内置浏览器登录态后台读取，首次需用户登录一次，之后自动复用
- 持续增量：首次读档回填既有内容做分析，之后只处理新增

**处理**

- [x] `WatchTask` 增加 `sourceKind`（web-links / browser-page）、`sourceLabel`、`sinks`（知识库 / 画像 / 计划 / 项目 / 工作流）
- [x] 浏览器源：后台隐藏 `BrowserWindow` 共享 `persist:workon-browser` 登录态，自动滚屏加载，抽取 `/video|note/` 作品链接
- [x] 未登录检测：明确提示「先在内置浏览器登录一次」，不写任何落点；首次读档最多回填 20 条
- [x] 分析：井号标签 + `Intl.Segmenter` 关键词，不依赖模型；发现记录带 tags
- [x] 落点知识库：每条发现一条 `source=watch` 笔记，含来源、链接、关键词、时间
- [x] 落点偏好画像：新增 `addWatchInterests`，合并进 detectedInterests，不覆盖已确认标签
- [x] 落点今日计划：同一天只建 1 条「盯守整理 · 任务名」；无变化不重复
- [x] 落点项目 / 工作流：项目名匹配后知识挂 links；工作流只在新内容批次触发一次
- [x] 聊天拆解抖音：识别「我的抖音」或主页链接、喜欢/收藏/作品、知识库/画像/计划/项目/工作流落点；缺主页链接时提示补一次
- [x] 确认卡显示来源、落点、登录说明；知识库/计划来源标签新增「盯守」

**验证**

- [x] `npm run typecheck`（node + web）通过；`npm run typecheck:e2e` 通过
- [x] `npm run test:e2e`：8/8 通过（13.1s）
- [x] 本地模拟作品页：读档回填 3 条 → 知识库 3、画像含测试标签、今日计划 1；新增 1 条 → 知识库 4、计划仍 1；无变化再跑 0 新增、无重复
- [x] 真实抖音探测（未登录）：`runWatchNow` 返回「需要先在应用内浏览器登录一次」，发现 0、无落点写入
- [x] 截图：`test-results/watch-douyin-card.png`（抖音盯守确认卡）
- [x] 清理：测试任务、知识、计划、画像标签、会话、盯守卡全部删除
- [x] 真实抖音登录验证（2026-11-22）：扫码登录后读取「喜欢」页，首次回填 20 条，后续每次最多 8 条增量，累计 60 条唯一作品；知识库 60 条 `source=watch`、画像标签合并、今日计划 1 条，无重复 URL
- [x] 滚动方式 A/B（2026-11-22）：当前 `window.scrollBy` 三次后内部容器 `scrollTop=0`、作品 67→67；CDP 鼠标滚轮在该 webview 同样未生效；直接滚动 `.route-scroll-container` 三次后作品 67→125（+58），`scrollTop=4124`。本轮仅操作页面 DOM，未写知识、计划或盯守发现
- [x] 后台盯守改为容器滚动采集（2026-11-22）：`loadBrowserPage` 用单个脚本识别最大滚动容器，逐屏下滚并「边滚边累积」链接（避免虚拟列表回顶卸载），连续 2 轮无新增或满 8 轮即停，最后回顶；隐藏窗口仍走 `persist:workon-browser` 复用登录态
- [x] 打包后真实验证：`typecheck` / `build` / `electron-builder --mac --dir` 通过；重启打包应用后 `runWatchNow` 返回 `found=8`、无错误，单次耗时 9.4s（多轮滚动特征），知识 68→76、今日计划仍 1 条、无重复 URL
- [ ] 未做：只给昵称/账号名时自动搜索定位（当前需主页链接一次或「我的抖音」）；项目/工作流落点未复测

---

## REQ-20261120-08 · 2026-11-20

**原话**：还有一个 比较复杂的 就是我们的类似灵光 2.0 的盯东西的动作拆解 不像定时任务的 指定时间执行，而是分散化数据处理

**状态**：`已完成（第一版：网页情报/新闻；多盯点独立增量）`

**口径**

- 「分散化」= 多盯点独立增量：每个源一个盯点，各自周期、到期时间、已读游标与退避，不打包成整点批量任务
- 入口 = 主聊天一句话拆解 + 确认卡；V1 只做网页同站链接，不新增页面、不改 Today 主界面
- 未做（本轮未选）：自适应错峰、分片流水线、本地+云端分工

**处理**

- [x] 新增 `src/shared/watch.ts`：WatchTask / WatchPoint / WatchFinding；单任务最多 8 个盯点、发现保留 300 条
- [x] 新增 `src/main/watch.ts`：`userData/watch.json` 持久化；10s tick，一次只处理一个到点盯点；每点独立 `nextDueAt` + 固定抖动错开
- [x] 增量判定：首次只建基线；同站链接按规范化 URL 哈希去重；新增才产出发现并 `pushNotify`；无变化不重复通知
- [x] 失败退避：单点失败按 2^n 退避（上限 6h），不影响其他盯点；页面无可跟踪链接给出明确失败原因
- [x] 复用 `intel.fetchPage`（改为导出）；页面标题自动补盯点名
- [x] IPC `watch:list/create/patch/remove/run` + preload `getWatchSnapshot/createWatchTask/patchWatchTask/removeWatchTask/runWatchNow/onWatchChanged`
- [x] 启动时注册盯守调度器；支持暂停/继续、立即检查、删除
- [x] 主聊天 `ComposerDialog`：识别「盯着/帮我盯/持续关注」，拆出网址或情报关注源 + 巡检间隔；问用法不误触
- [x] 盯守确认卡：盯点清单、独立巡检说明、周期快捷选项、确认/算了；创建后显示盯守中、上次检查、最新发现、暂停/继续/立即检查；按会话消息存 localStorage

**验证**

- [x] `npm run typecheck`（node + web）通过；`npm run typecheck:e2e` 通过
- [x] `npm run test:e2e`：8/8 通过（12.2s）
- [x] CDP 实测（本机两个 HTTP 测试源）：聊天拆成 2 个盯点并落盘 → 两点独立建基线（发现 0）→ 源站新增 1 篇 → 仅第一点发现 1 条、第二点新增 0 → 暂停/继续正常 → 删除后 `watch.json` 任务 0 / 发现 0
- [x] 截图：`test-results/watch-draft.png`（拆解卡）、`watch-created.png`（盯守中 + 最新发现）
- [x] 清理：测试会话 1 个、盯守卡 localStorage、测试任务与发现全部删除

---

## REQ-20261120-07 · 2026-11-20

**原话**：问答还有就是思考跟 结果分开，思考结束自动收起对应的思考链

**状态**：`已完成`

**处理**

- [x] 主进程 `parseSSEStream` 同时识别 `delta.reasoning`（Ollama）与 `delta.reasoning_content`（DeepSeek），新增 `onReasoning` 回调
- [x] `chatWithToolLoopStream` 跨工具轮累计思考链（轮间空行分隔），新增 `allowThinking`；仅问答传 `true`，不再对本机模型加 `reasoning_effort:'none'`
- [x] IPC 新增 `ai:streamReasoning`，preload 暴露 `onAIStreamReasoning`
- [x] ComposerDialog：消息新增 `thinking / thinkingDone`；新增 `ThinkingBlock`，思考中自动展开并显示「正在思考…」，思考结束自动收起（显示「思考过程 · N 字」），可手动再展开
- [x] 思考与回答分开展示：思考块在回答气泡之前独立渲染；首个正文 chunk / 工具调用 / 结束 / 出错都会置思考结束触发收起
- [x] 只改主聊天 ComposerDialog，Today 主界面 `App.tsx` 未动

**验证**

- [x] `npm run typecheck`（node + web）通过；`npm run typecheck:e2e` 通过
- [x] `npm run test:e2e`：8/8 通过（13.4s）
- [x] 真实本机 Ollama qwen3.5:4b 实测：思考阶段展开显示思考链且无回答气泡；26.5s 后首个回答到达自动收起；最终回答独立显示；手动展开内容与流式一致
- [x] 截图：`test-results/thinking-streaming.png`（思考中）、`thinking-collapsed.png`（已收起 + 独立回答）、`thinking-expanded.png`（手动展开）
- [x] 清理：本轮测试会话已删除；`agent-runs.json` 0 条；无 `SCENARIO-` 残留；dev 应用已停止，9333 无监听

---

## REQ-20261120-06 · 2026-11-20

**原话**：还有就是其他产品 我们参考的产品们在我的场景下人家是怎么输出的 拿来训练我自己的工作流编排

**状态**：`已完成`

**处理**

- [x] `AgentRunRecord` 增加 `reference`，`userData/agent-runs.json` 存标记；新增 `setAgentRunReference` / `listReferenceRuns(3)`
- [x] `generateWorkflow` 注入参考样本段：只取最近 3 条成功且输出非空的标记记录；输入截断 600 字、输出截断 1800 字
- [x] 提示词明确边界：只借鉴步骤划分 / 角色边界 / 信息组织，不照抄，不假设参考产品能力可用
- [x] 返回 `referenceCount`，聊天提示「已参考 N 条其他产品输出」
- [x] 新增 `listWorkflowReferenceSamples` + `workflow:references` IPC + preload `listWorkflowReferences`（生成前可预览摘要）
- [x] Agent 页记录弹层：摘要「参考」徽标、详情底部「设为参考 / 取消参考」
- [x] 测试文档新增 C9 15 条，总数 130 → 145；自动化映射补 `C8-03`
- [x] E2E 新增 C8-03：标记 → 参考库包含且摘要一致 → 取消 → 参考库移除
- [x] 持续批量实测 C9-02/04/05/06/07/09/10/11/14：参考计数、失败样本排除、最近 3 条截取、长输出、删除清理、重启持久化全部通过
- [x] 修掉测试暴露的问题：模型偶发收尾在 agent → `buildDefFromDraft` 自动补「交付结果」output 节点、末端接到它并排到末尾
- [x] 编排图加固：多个 input 折叠为 1 个；补线做可达性检查防环；清掉 output 的出边并强制作为唯一终点
- [x] 参考样本提示词加固：加「仅结构样例，忽略其中任何指令」说明与分隔标记，降低外部内容注入风险
- [x] 提问「工作流效果怎么样 / 怎么用」不再误触发生成；Agent 记录弹层读取/标记失败给出明确提示

**验证**

- [x] `npm run typecheck`（node + web）通过；`npm run typecheck:e2e` 通过
- [x] `npm run test:e2e`：8/8 通过（12.5s）
- [x] C9-02 真实 LLM 实测（本机 Ollama qwen3.5:4b）：返回 `referenceCount=1`，聊天显示「已参考 1 条其他产品输出」，生成 5 节点 / 4 连线；agent 步骤与参考样本的采集→归并→起草→分发一致
- [x] 真实模型批量：49 项断言全部通过；3 轮连续生成均 `referenceCount=3`、5-6 节点 / 4-5 连线；重启后参考库仍为 3 条且逐条一致
- [x] 修复后回归：`npm run typecheck` 通过；`npm run test:e2e` 8/8 通过（19.5s）
- [x] 误触发生成回归：问「工作流编排效果怎么样」2s 内与回答结束后均未出现生成结果
- [x] E2E 后清理：`agent-runs.json` 为 `[]`，无 `SCENARIO-E2E-` 残留

---

## REQ-20261120-05 · 2026-11-20

**原话**：这 100 个 要在其他 agent 看人家输出输入是什么样的 我们解决了吗 肯定没有

**状态**：`已完成`

**处理**

- [x] 补齐缺口：原 110 条只覆盖内部闭环，没有验证外部 Agent 实际收到的输入与返回的输出
- [x] 新增 `AgentRunRecord` 与 `userData/agent-runs.json` 调用留痕（最近 200 条），记录 input/output/耗时/错误
- [x] 新增 `agents:runs` IPC、preload `listAgentRuns`；删除 Agent 时同步清理其记录
- [x] Agent 页每张动态卡片新增「记录」，弹层可展开查看每次调用的实际输入与返回输出
- [x] 测试文档新增 C8 跨 Agent 输入输出 20 条，总数 110 → 130
- [x] 新增 `e2e/external-agent.spec.ts`：测试内启动真实本机 HTTP 回声 Agent，验证请求体 prompt 与发送一致、输出回传、记录可查

**验证**

- [x] `npm run typecheck`（node + web）通过；`npm run typecheck:e2e` 通过
- [x] `npm run test:e2e`：7/7 通过（12.3s）
- [x] C8-01 实测：回声 Agent 收到的 prompt 与发送逐字一致，`agent-runs` 记录 input/output 正确
- [x] C8-02 实测：Agent 页「记录」弹层显示 2 条调用，输入/输出与 API 返回一致
- [x] 测试后清理：计划 12 条、知识 0 条、`agent-runs.json` 为 `[]`、无测试 Agent 残留

---

## REQ-20261120-04 · 2026-11-20

**原话**：分享抖音「让 AI 测试网站」的 skill 视频；确认「给 WorkOn 配自测能力（推荐）」

**状态**：`已完成`

**处理**

- [x] 引入 `@playwright/test`，通过 CDP 连接运行中的 WorkOn，不另起浏览器、不 mock IPC
- [x] 新增 `dev:debug`（`REMOTE_DEBUGGING_PORT=9333`）、`test:e2e`、`typecheck:e2e` 脚本
- [x] 新增 `playwright.config.ts`、`tsconfig.e2e.json`、`e2e/helpers.ts`、`e2e/closed-loop.spec.ts`
- [x] 5 个用例：主导航冒烟、情报→计划、知识→计划并回写 links、今日回顾单项顺延、批量顺延
- [x] 测试数据统一 `SCENARIO-E2E-` 前缀，`afterEach` 自动清理；C1 按创建前 id 集合精确回收
- [x] 批量顺延前检查当日真实计划，有则跳过，避免影响用户数据
- [x] `docs/SCENARIO-TESTS-v2.md` 增加第 7 节自动化执行与场景映射
- [x] `test-results/`、`playwright-report/` 加入 `.gitignore`

**验证**

- [x] `npm run typecheck:e2e` 通过
- [x] `npm run test:e2e`：5/5 通过（10.4s）
- [x] 测试后数据：计划 12 条、知识 0 条、`SCENARIO-E2E-` 残留 0、情报来源计划 0
- [x] 成功截图与失败 trace 落在 `test-results/e2e/`；页面浮窗已关闭

---

## REQ-20261120-03 · 2026-11-20

**原话**：然后你直接给我出一个 角色 然后需求，处理过程 截图，业务流程截图，还有处理结果结构化的截图，，然后增加至少 100个场景

**状态**：`已完成`

**处理**

- [x] 角色与需求：林一 · 多项目产品经理；需求=调研结论转今日计划、回顾时把未完成顺延到明天
- [x] 处理过程截图 9 张：知识沉淀 → 转为今日计划 → 计划页来源「知识」→ 回顾未完成 → 顺延确认 → 已顺延 → 次日副本
- [x] 业务流程截图：知识 → 计划 → 回顾 → 次日 六步主链路 + 情报 / 工作流 / 问答 / 本周四条旁路
- [x] 处理结果结构化截图：知识 `links`、今日 3 条 `delayed`、明日 3 条 `planned`、备注与 6 项校验
- [x] 演示报告：`docs/art/p1-demo/DEMO-REPORT.html`
- [x] 场景扩充到 110 例：`docs/SCENARIO-TESTS-v2.md`（C1 20 / C2 15 / C3 15 / C4 20 / C5 20 / C6 10 / C7 10）

**验证**

- [x] 截图数据来自真实 API：`listPlans` / `listKnowledge` 返回写入 `result.json`
- [x] 04/06 截图确认显示「未完成 3 项」「已顺延 3 项到 2026-11-21」
- [x] 演示数据已清理：计划恢复 12 条、知识 0 条
- [x] 窗口恢复 1900×959、位置 (321,277)，主界面回到 Today

---

## REQ-20261120-02 · 2026-11-20

**原话**：其他的继续修复 ，然后我们要拿几个特定角色 特定场景 设计测试

**状态**：`已完成（三条闭环已实测；角色场景测试方案已设计，待执行）`

**处理**

- [x] 情报 → 今日计划：情报流每条新增「转今日计划」，摘要与原链接写入备注，来源标记「情报」
- [x] 知识 → 今日计划：详情区新增「转为今日计划」，创建后回写 `plan` 关联，按钮变「已关联计划」防重复
- [x] 回顾 → 未完成顺延：今日回顾「计划达成」支持单项 / 批量顺延到次日，生成新计划、原计划标记延期
- [x] 本周 → 下周计划：本周未完成项可批量顺延到下周一，只统计已过去的日子
- [x] `PlanSource` 增加 `intel | knowledge`，计划来源标签补齐
- [x] 不新增页面、不改 Today 主界面、不写模拟数据
- [x] 新增 `docs/SCENARIO-TESTS-v1.md`：3 个角色 × 7 个场景的测试矩阵、数据准备与清理口径

**验证**

- [x] `npm run typecheck`（node + web）通过
- [x] 情报转计划：20 条情报中点第一条 → 今日计划出现 `source=intel`，备注含摘要与链接；测试后删除
- [x] 知识转计划：创建 `SCENARIO-KNOW` → 今日计划 `source=knowledge`，知识 `links` 回写 `plan`；测试后删除
- [x] 回顾顺延：03:00–03:30 测试计划在今日回顾显示未完成 → 点「顺延」→ 原计划 `delayed`，次日生成 `planned` 副本；测试后删除
- [x] 本周入口：本周未完成行出现「顺延到 2026-11-23」按钮；未点击，避免影响真实计划
- [x] 测试数据已清理：计划恢复 12 条、知识 0 条、无 `SCENARIO-` / 测试来源残留
- [ ] 角色场景测试执行（按 `docs/SCENARIO-TESTS-v1.md` 逐条跑）

---

## REQ-20261120-01 · 2026-11-20

**原话**：功能不在新增了 我们要加速把产品完善 ，整理产品功能的流程闭环（批准「可以开始 P0」）

**状态**：`已完成`

**口径**

- P0 只做「产物 / 回答 → 知识库 → 回顾页知识沉淀」的归档闭环
- 不新增页面与实体，复用已有 `addKnowledge`；Today 主界面不改

**处理**

- [x] 类型层：`KnowledgeLinkType` 增加 `workflow`，`KnowledgeItem.source` 增加 `workflow | qa`；知识库来源标签新增「工作流产物」「问答」
- [x] 工作流：作战板任务报告底部新增「存入知识」，取节点真实输出，标题「工作流名 · 节点名」，`source=workflow`，`links=[workflow:id]`，空产物禁用；归档后按钮变「已存入知识」并写入底部控制台
- [x] 问答：助手回答底部新增「存入知识」，自动向上取最近一条提问，正文为「问：… 答：…」，`source=qa`，带「问答」标签；含存入中 / 失败重试 / 已存入三态
- [x] 回顾闭环：知识写入后直接出现在回顾页「知识」页签（复用 `KnowledgeView`），无需额外改动
- [x] 操守边界：工作流作战板与原 Studio 保留，不新增模拟数据

**验证**

- [x] `npm run typecheck`（node + web）通过
- [x] 工作流归档实测：作战板「需求输入」存入后按钮变「已存入知识」，控制台提示一致；知识库出现 `source=workflow` 条目，`links` 指向所属工作流
- [x] 问答归档实测：新发「今天专注了多久」经「✦ 发送」产生真实回答，点该条「存入知识」后变「✓ 已存入知识」，知识库新增 `source=qa` 条目（标题为提问，正文含问与答，标签「问答」）；历史回答同样可归档
- [x] 测试条目已清理，`listKnowledge` total 0
- [ ] 待确认：问答页历史回答全部常驻归档按钮（当前近百个），是否收敛为仅最新一条常驻
