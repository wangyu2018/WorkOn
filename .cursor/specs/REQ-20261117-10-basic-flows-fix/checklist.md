# REQ-20261117-10 验收清单

- [x] macOS 屏幕录制权限可读：`ocrStats().permission = granted`
- [x] OCR 引擎不再误用 Windows `.exe`：macOS 回退 Tesseract，日志无 `RapidOCR 执行失败 EACCES`
- [x] 「开启屏幕记忆」按钮：`deepMode=true` 且 `running=true`
- [x] 首次采集成功：返回 `ok=true, lines=5`，识别到「今天 4 小时 18 分，主要在 trae cn」
- [x] `ocrStats` 非空：`lastTs` 有值、`shotCount` 由 0 增至 3
- [x] 内存 85%+ 时 OCR 不再被 loadGuard 停止（仅性能模式/CPU 高压停）
- [x] 自检条显示 采集中/未开启/已暂停、权限、最近识别时间与内容
- [x] 新会话对话：发送「用一句话说明你能做什么」收到真实回复，无「需要 AI 才能深入回答」
- [x] 超时提示：30s 无 chunk 才追加「没有收到回复」+「重试」，有 chunk 不误报
- [x] 计划：UI 新建 → 勾选完成（`status=done`）→ 删除
- [x] 项目：UI 新建 → 落库 → 删除
- [x] 计划页口径标注：「今日达成率（按耗时）」「今日计划（按数量）」
- [x] 回顾页数据质量提示：OCR 关闭且条目 < 10 时显示来源说明
- [x] 导出 PDF 成功：`2026-11-17-工作报告-report-2026-11-17-r1.pdf` 316956 bytes
- [x] `npm run typecheck` 通过
- [x] dev 日志无 IPC 重复注册 / 无 handler 缺失
