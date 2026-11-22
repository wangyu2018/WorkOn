# REQ-20261117-10 基础功能可用性修复

**原话**：我们甚至基础功能还不能用呢

**确认范围**：屏幕记忆 / OCR、对话 / 问答、计划 / 项目、日报 / 导出。
**现象**：结果不对、点了没反应、报错弹窗或红字、数据是空的。

## 目标

让四类基础链路在 UI 上**可用、可验证、状态可解释**；不新增功能、不改生成架构、不用假数据。

## 已复现的根因

### 1. 屏幕记忆 / OCR（数据为空）

- `src/shared/types.ts:1072`：`deepMode: false` 默认关闭，且界面只有隐私页一个开关，没有显式「开启/立即采集」入口。
- `src/main/loadGuard.ts:82-89`：内存 ≥85% 即进入降档并 `stopOcr()`。本机内存长期 85–97%，日志反复出现 `[ocr] 深度模式已停止`，即使手动打开深度模式也会被停。
- `src/main/ocrWorker.ts:82-89`：`desktopCapturer` 无 macOS 屏幕录制权限时返回空白缩略图，OCR 结果为 0 行，但界面没有任何权限提示。
- `src/main/ocrWorker.ts:359-366`：自检只有 `running/lastTs`，不返回暂停原因和权限状态，用户只能看到「未运行」。

### 2. 对话 / 问答（误导文案）

- `src/renderer/src/v10/V10Surface.tsx:1194-1198`：未接入 AI 时兜底文案为「需要 AI 才能深入回答」，历史消息永久保留，造成「功能不可用」的错觉。
- `src/renderer/src/v10/V10Surface.tsx:1200-1203`：15 秒 `askingGuard` 静默 `setAsking(false)`，超时无可见提示、无重试入口。

### 3. 计划 / 项目（口径不一致）

- `src/renderer/src/views/PlanView.tsx:912`：`achievement` 来自 `planVsActual`（按耗时口径）；`PlanView.tsx:1118` 同时展示「1/2」完成数，两个口径并列导致「结果不对」的感受。
- 新建计划 UI 已实测成功（落库 `基础验收测试`）；勾选完成、项目新建仍需 UI 级验证。

### 4. 日报 / 导出（数据空而非导出失败）

- 导出链路已实测成功（HTML / PDF 文件存在）。
- `src/renderer/src/views/ReportHub.tsx`：回顾页展示「有效工作 0m · 数据覆盖 25%」，根因是当天仅 4 段活动且 OCR 未采集，缺少「为什么是空的」来源说明。

## 方案（决策）

### A. 屏幕记忆 / OCR

1. `src/main/ocrWorker.ts`
   - 导出 `captureOnce(): Promise<{ ok: boolean; lines: number; text: string; permission: string }>`，复用现有 `runOcr()`。
   - `getOcrQueueStats()` 增加 `permission: 'granted' | 'denied' | 'unknown'`（`systemPreferences.getMediaAccessStatus('screen')`，仅 macOS；其他平台返回 `granted`）。
2. `src/main/loadGuard.ts`
   - 仅 `performanceMode` 或 **CPU 持续高压** 时 `stopOcr()`；**内存高压不再停止 OCR**，只降频（沿用 `OCR_BUSY_FULL_INTERVAL` 45s）。
3. `src/main/ipc.ts`
   - 新增 `ocr:captureOnce` → 返回 `captureOnce()` 结果。
   - 新增 `ocr:openPermission` → `shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')`（仅 darwin）。
   - `ocr:stats` 继续返回合并后的存储 + 队列 + permission。
4. `src/preload/index.ts`
   - 新增 `captureOcrOnce()`、`openOcrPermission()`。
5. `src/renderer/src/views/PrivacyView.tsx`（`OcrSelfCheck`）
   - 显示：「采集中 / 未开启 / 已暂停（性能模式）」+ 权限状态 + 最近识别时间。
   - 未开启时显示「开启屏幕记忆」按钮：`setSettings({ deepMode: true })` 后立即 `captureOcrOnce()`。
   - 采集中显示「立即采集一次」。
   - 权限非 `granted` 时显示「去授权」，调用 `openOcrPermission()`。

### B. 对话 / 问答

1. `src/renderer/src/v10/V10Surface.tsx`
   - 未接入 AI 的兜底文案改为：「AI 未接通（设置 → AI 可配置）。当前能给的本地数据：…」，不再断言「需要 AI 才能深入回答」。
   - 15 秒超时：追加一条可见消息「这次没有收到回复（可能模型超时）」+ 快捷选项「重试」，保留 `asking` 解锁。
   - 不改流式架构，不改历史库。

### C. 计划 / 项目

1. `src/renderer/src/views/PlanView.tsx`
   - 「今日达成率」卡片副标题明确为「按耗时达成」，并在完成数旁标注「完成 1/2（按数量）」；数值口径不变。
2. UI 级验证新建计划 → 勾选完成 → 删除；项目页新建项目 → 删除。若无响应，修对应命中区域。

### D. 日报 / 导出

1. `src/renderer/src/views/ReportHub.tsx`
   - 数据质量区增加来源提示：当 OCR 未运行且活动段 < 10 时，显示「屏幕记忆未采集，数据来自应用切换记录；开启屏幕记忆可获得更完整数据」并提供跳转隐私页的说明文案。
   - 导出逻辑与格式不变。

## 非目标

- 不做音频记忆、不做新报表模板、不做架构级重构、不写演示假数据。
- 不修改历史会话消息内容。

## 验收标准

1. `ocrStatus()`：`permission=granted`、开启后 `running=true`、`lastTs` 非空、`shotCount` 增长；关闭后 `running=false` 且原因可见。
2. 新会话发送「用一句话说明你能做什么」：有真实回复；模型不可用时显示明确失败文案与「重试」。
3. 计划：UI 新建 → 列表出现 → 勾选 → `status=done` → 删除；项目：UI 新建 → 列表出现 → 删除。
4. 导出：回顾页导出 HTML 与 PDF 文件存在；起草卡未确认前不生成文件。
5. `npm run typecheck` 通过。

## 风险

- 内存高压下 OCR 继续运行可能增加占用：保留 45 秒低频，并在自检显示「内存高压，已降频」。
- 屏幕录制权限需用户手动授予，代码只能提示与跳转，不能代替授权。
