# WorkOn 会话迁移文档（2026-09-19 生成）

> **用途**：迁移到另一台机器的 ZCode 继续工作。本文档包含完整会话上下文、项目状态、待办清单、已知坑位。
> **阅读方式**：新 ZCode 实例首次打开本项目时，将本文内容读入即可无缝续接。

---

## 一、项目基本信息

| 项 | 值 |
|----|-----|
| 项目路径 | `D:\AI\WorkOn\workonv0.2-6\workon`（工作区 `D:\AI\WorkOn\workon` 是过时副本勿改） |
| 技术栈 | Electron 33 + electron-vite + React 18 + TypeScript + three-vrm 桌宠 + Python XGBoost sidecar |
| 数据目录 | `%APPDATA%/workon/`（settings.json + db.json + activities.jsonl） |
| 最新提交 | `b722be8`（工作树干净） |
| 启动命令 | `npm run dev`（electron-vite dev，主进程改动需手动重启） |
| 双 tsconfig | `tsconfig.web.json`（渲染层）+ `tsconfig.node.json`（主进程）——每次改完双查 |

## 二、产品定位

本地优先的 AI 原生桌面工作陪伴器。三层工作循环（主线→计划→实时）+ 桌面陪伴层。当前版本 v7.5，视觉基调「墨与琥珀」（暖纸底 × 青瓷卡 × 琥珀注意色，全局直角卡片）。

**产品铁律**：本地优先 / 器物不是软件 / 注意力预算 / 视角升维 / 显示诚实度

## 三、五层能力架构

### L1 数据采集层
- `monitor.ts`：2s 智能变频窗口采样
- `winInfo.ts`：常驻 PowerShell 窗口信息
- `dirWatcher.ts`：项目目录 fs.watch
- `systemOcr.ts`：Windows.Media.Ocr → RapidOCR → Tesseract 回落链
- `inputProbe.ts`：键鼠聚合计数（不记内容）
- `aiAssistWatch.ts`：AI 编程工具进程监控 + agent-hook 端口 127.0.0.1:18790
- `hardwareDetect.ts`：GPU/显存/内存 → L0/L1/L2 分级

### L2 判断引擎层（可插拔四级）
- `recognition/decision.ts`：规则 → XGBoost v3(shadow) → 纠偏 → 用户
- `attributions.ts`：路径/关键词/软绑定 → 漂移确认（日配额 2）→ 存疑态
- `focusChain.ts`：IDE→AI→文档链路 v2
- `state.ts`：PAD 情绪基线（已卸载固定中性，排障模式）
- `planAnalysis.ts`：计划/粘贴语义自动分类（~90 词库）
- **待做**：判断资产化（确认→账本→蒸馏规则→重训模型）

### L3 数据组织层
- `trail.ts`：逐日聚合（段合并/IM 会话级切段）
- 主线 MainlineView / 计划 PlanView / 实时悬浮窗
- `attention.ts`：5 维注意力评分
- `starGraph.ts`：应用切换星图
- ProfileView：八层画像（隐私分层 L0-L4）

### L4 桌面陪伴层
- 悬浮窗 SuggestionWidget：三态（胶囊/compact/full）
- 待办树窗 todoWidget：三分区+穿透+钉桌面+位置/角度记忆
- 虚拟角色 pet/：VRM 立绘（**搁置中**，15 项功能开关全关骨架态）
- 控制栏：6 按钮悬停浮现
- 气泡 fx/bubble.ts：v6 真流式+优先级队列+悬停展开
- 关怀调度 care.ts：封存

### L5 智能应用层
- 状态卡反哺 / AI 问答（双管道）/ 报表 / 自动化 / 预测 / 词汇包 / 日视角

## 四、视角系统

晨架构师(5-10) / 昼工作者(10-18) / 晚管理者(18-24)，`shared/perspective.ts`
- 侧栏三 emoji 短签切换 + 自动/锁定
- 导航白名单 + 「更多」折叠
- 首页块编排（PERSPECTIVE_HOME）+ keep-alive
- 工作域词汇包 `shared/dictionary.ts`（10 预置域，行话随项目切换）

## 五、虚拟角色当前状态（搁置中）

**15 项功能开关全关（骨架态）**，`pet/flags.ts`：

```
autoSpatial: false    roam: false          particles: false
weather: false        dayNight: false       microLife: true ← 唯一开
microGaze: true ← 唯一开                chatter: false
care: false           intro: false          scruffLift: false（封存）
drag: true ← 唯一开   chat: false           clips: false
springBone: false     aiActionClips: false  intentClips: false
```

**已修复的关键 bug（不再复发）**：
- T-pose 闪现 → 场景挂载推迟到姿态收敛后
- 闭眼常驻 → happy 表情加 0.35 阈值门 + 最低睁眼保底 70%
- 拖拽不跟随 → spatial.update 是唯一 3D 写入通道不可关
- 缩放复利 → 拎起 1.05x 基准改用 stateScale
- 朝向反 → 控制权卡死 drag 档 -0.85；v4 策略=脸看向用户
- DPI 钉桌面瞬移 → Win32 物理像素/DIP 换算

**放回方法**：`pet/flags.ts` 对应项翻 `true` → 重启 → 按 19 条待办（WorkOn 项目下）验收

## 六、Oner 联动（已适配）

- `GET {onerEndpoint}/plans` 拉取（Bearer JWT，{plans:[...]}）
- `PATCH {onerEndpoint}/plans/{extId}` 回写 {status, done, completedAt}
- `POST {onerEndpoint}/auth/refresh` 自动续期（10s 冷却防乒乓）
- 401 连续 2 次 → 停轮询 + 通知换 Token
- 导入上限 50 条/次；状态完整映射（todo/in_progress/done）

## 七、关键坑位（已踩勿再踩）

1. **electron-vite dev 主进程不热重载**——改 attributions/statusCard/loadGuard 后必须 kill electron + 重启
2. **xgboost OpenMP 自旋**：predict_server.py 已设 `OMP_NUM_THREADS=2` + `KMP_BLOCKTIME=0`，改 ML sidecar 必须掐
3. **内联 style 压制主题 CSS**——主题化前先把内联样式搬进 CSS 类
4. **Win32 interop 坐标是物理像素，Electron bounds 是 DIP**——高 DPI 屏窗口位置异常先查换算
5. **用户会在会话间隙自己改代码**——打补丁前必须重读目标文件
6. **跨窗口状态同步收进主进程 setter 本体**——散在调用点必漏
7. **大 JSX 文件盲改 ≥2 次后停止补丁，整文件 Write**
8. **VRMA 半截动画会冻结全身**——registerClip 需检查轨道覆盖度（已有护栏）
9. **背景色 `backgroundMaterial:'acrylic'`**：OS 级画直角框无视 CSS 圆角——已移除
10. **用户机器内存常驻高**（CodeBuddy 等 AI 工具大户）——V8 堆偶发 134 崩溃属环境压力非代码 bug

## 八、待办清单状态（19 条，WorkOn 项目下）

### 已完成 ✅
- ⑧ 微行为（眨眼/耳抖/呼吸/挥手/铃铛/凝视）— microLife: true
- ⑭ 拖拽 — drag: true，普通跟手+长按转圈+松手定格卡哇伊
- ⑮ 右键聊天 — chat 曾关后开（当前 chat: false 但入口在）
- 桌宠交互精修全套（朝向v4/缩放复利/跟随修复/青瓷面板/最低睁眼）

### 待放回（翻 flags.ts 对应开关 → 重启 → 验收）
- ① 动作系统 — `clips: true`
- ③ 位置自动迁移 — `autoSpatial: true`
- ④ 自己散步 — `roam: true`
- ⑤ 小星星粒子 — `particles: true`
- ⑥ 下雨下雪 — `weather: true`
- ⑦ 昼夜光线 — `dayNight: true`
- ⑨ 主动唠嗑 — `chatter: true`
- ⑩ 关心提醒 — `care: true`
- ⑪ 开场动画 — `intro: true`
- ⑯ 换装入口 — 桌搭页解注释 VrmUploader

### 封存待优化
- 拽脖颈拎猫 — `scruffLift: true`（代码完整保留）

### 判断资产化（桌宠后做）
- 判断账本：纠正记录统一入库
- 规则自学习：确认 ≥3 次自动编译成绑定规则
- 模型重训：纠正账本接 XGBoost v3 训练脚本

## 九、近期提交历史

```
b722be8 fix: 桌宠交互精修+画像滚动修复+虚拟角色搁置
7d788ee feat: 拖拽体验重做+粘滞朝向v4+Oner契约适配+记忆持久化
397f013 feat: 桌宠排障开关体系+三批定向修复+生活组件第二批+启动时序优化
753aa36 feat: 视角系统+词典词汇包+统计加速+一批体验修复（联合批次）
831e558 daily: 2026-09-14
```

## 十、下一步建议

1. 骨架态验证稳定后，按待办①→⑯逐个放回（每翻一个 flag 重启验收）
2. 放回完毕后做「按需渲染」优化（静止时零渲染）
3. 判断资产化 P1-P3（纠正账本→规则蒸馏→模型重训）
4. 桌宠大计划（VRMA 动画层+DOM 气泡流式+截图问答 P0）等确认后启动
5. 照片→虚拟形象→朋友虚拟互动：远期愿景（推荐风格化贴图路线）
