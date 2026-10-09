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

## 2. L2 判断引擎

- 🔧 **P0 前置 bug**：`decision.ts` 的 `MODEL_LABEL_TO_STATE` 按 8 动作类查表，但 v3_real 输出已是 13 态 WorkState → model_first 路径模型永不生效 + `other` 误映射为 focus（账本 REQ-20260921-01 发现，用户暂缓）
- ⬜ 13 态 WorkState 重训（`ml/data/real_actions.jsonl` 4.2MB；按 ts 过滤只取 2026-08-29 之后真实特征样本；`--target state`）
- ⬜ 校准曲线（recognition_log 的 prob + 纠偏金标画可靠性图）+ top1−top2 边际三级 fallback（替代 0.75 一刀切）
- ⬜ 判断资产化 P1-P3：纠正账本统一入库 → 确认 ≥3 次蒸馏成绑定规则 → 纠正账本接 XGBoost v3 重训
- ⬜ APP_RULES 补 ~30 个进程缺口（远程桌面/企业微信/邮箱/网盘/截图/虚拟机/阅读器等；jev 映射表可反哺，材料在 Windows `D:\AI\workon小模型训练\`）

## 3. L3 数据组织

- 暂无大待办（逐日聚合/注意力评分/星图/画像八层均已落地）

## 4. L4 桌宠（19 条放回清单）

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

- 📌 **已拍板**：TypeSafe 云 API 不进产品（隐私/中文/RTT）；采纳的是「输出协议」不是引擎
- ✅ 两轮调研完成（2026-09-21，账本 REQ-20260921-01）：Choice/Noul/Score 三路判定 + 分布回传 + 校准
- ✅ 开源 Jev 复刻谱系梳理（2026-10-09）：NanoJev 0.6B / Kev 0.8-9B / Laya 322-421M 多语种 / Von ~395M / Rizzo Flow / Nimble；基准 JevBench；LLM2Jev 论文（arXiv 2610.02076）免训练配方 + 树分解列表式微调
- ⬜ mac 上起 13 态重训 + 校准曲线（与 L2 重训为同一项，实验记录继续写 `ml/EXPERIMENTS.md`）
- ⬜ 标题语义头 A/B：关键词特征 vs 多语种小编码器（Laya 类 mmBERT，中文标题必需多语种）
- ⬜ 数据量够后：NanoJev(Qwen3 0.6B) + 纠正账本 LoRA 微调（= 判断资产化 P3 的升级形态）
- ⬜ （可选·离线）TypeSafe 云 API 当标注 oracle 批测中文样本，验证语义头价值（成本极低）

## 9. 工程与环境

- ✅ 2026-10-09 Windows→macOS 迁移：解压 + GBK 文件名修复 351 个 docs 文件 + 补漏 94 个（ml 模型/devOcr.ts/eng.traineddata 等）；git 历史完整
- ✅ 2026-10-09 mac 试跑通过：typecheck 双 tsconfig 全绿；dev 冒烟 70s（结论见 L1）
- ⚠️ **electron 二进制坑（mac 重装依赖时会再遇到）**：npm 装包时 extract-zip 会静默只解半截（Frameworks 缺失）；修法 = 清 `~/Library/Caches/electron` → `node node_modules/electron/install.js` 下载 → 若仍半截，直接 `unzip ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip -d node_modules/electron/dist` → `printf 'Electron' > node_modules/electron/path.txt`（**不能带换行**）→ `ln -sf Electron.app/Contents/MacOS/Electron node_modules/electron/dist/Electron`
- ⬜ 77 个未推送提交推远端备份（daily 提交习惯保持）
- ⬜ 从 Windows 带资产：on-web 仓库、`D:\AI\workon小模型训练\`（OPTIMIZATION_PLAN / 11810 增强样本 / 映射表）
- ⬜ MediaPipe wasm + 姿态模型补齐（不入库：`@mediapipe/tasks-vision/wasm` → `src/renderer/public/mediapipe/wasm/`；pose_landmarker_lite.task）

---

## 更新日志

- **2026-10-09** 环境迁移完成；任务板建立（合并交接文档 §8 + Cursor 账本 + jev 调研线 + 工程项）；mac 试跑通过（typecheck ✅ / dev 冒烟 ✅，Windows 探针报错被兜住）；electron mac 安装坑修法存档。
