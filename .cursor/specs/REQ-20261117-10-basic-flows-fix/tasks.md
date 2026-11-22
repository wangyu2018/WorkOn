# REQ-20261117-10 任务清单

## T1 屏幕记忆 / OCR 主进程

- [x] `src/main/ocrWorker.ts`：新增并导出 `captureOnce()`；`getOcrQueueStats()` 增加 `permission` 字段（macOS 用 `systemPreferences.getMediaAccessStatus('screen')`，其他平台 `granted`）。
- [x] `src/main/loadGuard.ts`：`apply()` 中 OCR 停止条件改为 `performanceMode || (pressure==='high' && cpuPercent>=CPU_HIGH)`；内存高压只降频不停止。
- [x] `src/main/ipc.ts`：新增 `ocr:captureOnce` 与 `ocr:openPermission`（darwin 打开系统设置）；`ocr:stats` 返回 permission + load。
- [x] `src/preload/index.ts`：新增 `captureOcrOnce()`、`openOcrPermission()`。
- [x] 追加根因修复 `src/main/ocrEngine.ts`：RapidOCR-json 仅 Windows 可用；macOS/Linux 不再误判可用，回退 Tesseract（此前 spawn `.exe` EACCES 导致 OCR 永远 0 行）。

## T2 屏幕记忆 / OCR 界面

- [x] `src/renderer/src/views/PrivacyView.tsx`：`OcrSelfCheck` 显示 采集中/未开启/已暂停 + 权限状态 + 最近识别时间。
- [x] 未开启时「开启屏幕记忆」按钮：写 `deepMode=true` 后立即采集一次。
- [x] 已开启时「立即采集一次」按钮；权限非 granted 时「去授权」按钮。
- [x] 采集中每 10s 刷新 `ocrStats`，采集按钮后立即刷新。

## T3 对话 / 问答

- [x] `src/renderer/src/v10/V10Surface.tsx`：兜底文案改为「AI 还没接通（设置 → AI 可配置）」+ 本地数据摘要，去掉「需要 AI 才能深入回答」。
- [x] 超时兜底改为 30s，追加可见提示 + 「重试」选项，保留解锁。
- [x] 新会话发送「用一句话说明你能做什么」→ 收到真实回复「我能帮你管理工作计划、追踪专注力、生成日报…」，无兜底文案、无失败提示。

## T4 计划 / 项目

- [x] `src/renderer/src/views/PlanView.tsx`：达成率标注「按耗时」，完成数标注「按数量」。
- [x] UI 实测：新建计划「基础验收测试」→ 列表出现 → 勾选 → `status=done` → 删除成功。
- [x] UI 实测：项目标签「新建项目」→「基础验收项目」落库 → 删除成功（表单本身有「创建」按钮）。

## T5 日报 / 导出

- [x] `src/renderer/src/views/SmartReportView.tsx`：数据质量区增加「屏幕记忆未采集」来源提示（OCR 未运行且条目 < 10 时）。
- [x] 回顾页导出 PDF 实测：`2026-11-17-工作报告-report-2026-11-17-r1.pdf`（316956 bytes）生成，无「导出失败」。

## T6 回归

- [x] `npm run typecheck` 通过。
- [x] 重启 dev 实例，日志无 `ipc 注册失败`、无 `No handler registered`。
- [x] 更新 `.cursor/task-ledger.md`。
