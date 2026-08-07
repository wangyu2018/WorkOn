# WorkOn 项目进度 — 2026-07-24

## 本次会话完成的优化

### 一、检核对齐（参照全量优化方案）
基于 `WorkOn-v0.1-全量优化方案总览.md` 的37项优化，已实现28项。本次补充了剩余6项：

| 编号 | 内容 | 文件 |
|------|------|------|
| C7 | 右键对话开关 | `types.ts`, `BuddyStage.tsx`, `main.ts` |
| D1 | PlanStatus 增加 partial 状态 | `types.ts`, `PlanView.tsx` |
| D2 | 时间轴颜色+图例 | `MonitorView.tsx` MiniTrailBar |
| D3 | 计划任务显示在时间轴 | `MonitorView.tsx` 计划虚线叠加 |
| A8 | 粒子系统延迟初始化 | `particles.ts` |
| A9 | 闲置渲染优化（30s自动降eco） | `main.ts` |

### 二、图标合集
- 复制18个图标文件到 `assets/`
- `tray.ts` 改用 `tray-dark-16.png`
- `windows.ts` 主窗口设置 `icon` 属性

### 三、气泡系统重构（v3→v4）
- **`bubble.ts`** 重写：短文本单行 / 长文本多行正方形（280×8行）
- 尾巴+描边安全边距，不再裁切
- 每次 show 重建纹理，杜绝残影
- 思考→回答无缝覆盖同一气泡

### 四、虚拟人沉稳化
- **行走动画缓入**（`microBehaviors.ts`: locomotionRamp 0→1 渐变0.4s）
- **凝视幅度-40%**（头/脖子跟踪减半）+ 面向转速减半（0.4s→0.8s）
- **过渡静默位移**（`SpatialController.ts`: 删除过渡中的locomotion触发）
- **右键聊天noteInteraction+resetIdle**（防止对话中自动归位）
- **VRM贴图优化延迟到首帧后**（不阻塞首次渲染）

### 五、AI深度模式OCR
- 安装 `tesseract.js@5` + `sharp`
- **`ocrWorker.ts`**: 每30s截图→落盘→OCR→25类关键词匹配
- **`presence.ts`**: 注入 `ocrContext` 到快照
- **`monitor.ts`**: deepMode 开关联动OCR启停
- **`ocr.ts`**: 增加 `active` 字段
- **`SettingsView.tsx`**: deepMode 描述更新

### 六、AI未配置时的屏蔽
| 位置 | AI关闭时的行为 |
|------|---------------|
| ReportHub | AI洞察tab隐藏，默认tab改为日报 |
| AnalysisView | 今日AI用量卡片隐藏 |
| QAReview | 输入框换为"在设置中配置API Key"提示 |
| CommandPalette | 刷新AI画像+问AI两条命令隐藏 |
| SuggestionWidget | 折叠问答入口隐藏 |
| 轻问诊定时器 | 停止生成提问 |

### 七、监控粒度细化
- **MonitorView**: 状态分布改为可展开行，点击展开后显示该状态下各应用明细（应用名+进度条+分钟+占比%）
- **ReportHub DailyReport**: 同样支持展开

### 八、监控页布局融合
- 双屏并行仅在多屏时显示；单屏时状态分布独占全宽
- 状态分布标题行增加屏幕监控摘要（N屏监控·屏1 xx·屏2 xx·并行xx%）

### 九、防分心独立
- 从系统设置拆分到桌搭页独立Section：启用开关+阈值（30s-60min）
- `slackAutoHide` 设置字段 + main进程联动

### 十、命令面板合并到设置
- 侧边栏去除"命令面板"入口（Ctrl+K仍可用）
- SettingsView新增"命令面板"Section：功能说明+启用开关+命令一览
- Ctrl+K快捷键检查 `cmdPaletteEnabled` 设置

### 十一、虚拟人情境确认面板
- **`pet/main.ts`**: 新增 `#qconfirm` HTML面板（轻问诊/浏览器确认/会议检测）
- **`pet.css`**: 新增玻璃态确认面板样式
- 去重机制：已回答过的问题ID不重复弹出

### 十二、虚拟人资源占用展示
- **`Stage.ts`**: 新增 `getStats()` 方法（fps/tier/degraded/drawCalls/triangles/textures）
- **`main.ts`**: 每3s通过IPC推送stats
- **`BuddyStage.tsx`**: 新增"资源占用"卡片（6个指标）

### 十三、气泡修复
- tesseract.js CJS/ESM兼容：`ensureRecognize()` 显式提取函数

### 十四、基础配置
- **`settingsStore.ts`**: 改为 deepMerge 防止 petInteractions.chat 等嵌套字段丢失
- **`AGENTS.md`**: 启动命令规范

## 待办 / 已知问题
- [ ] OCR首次运行需下载中文语言包（tesseract.js ~12MB）
- [ ] 气泡和角色之间还可以加连线增强视觉连贯性
- [ ] 部分UI文案未全局统一（"桌宠"→"桌搭"）

## 启动方式
```powershell
Get-Process -Name "electron","node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2
Start-Process -FilePath "npx.cmd" -ArgumentList "electron-vite","dev" -WindowStyle Normal -WorkingDirectory "D:\00000-个人\0-AI\workonv0.1\workonv0.1-0.2\workon"
```
