# Jev 处理方案：WorkOn 的决策模型路线

> 2026-10-09 · 承接账本 REQ-20260921-01 两轮调研 + 2026-10 开源生态梳理
> 结论一句话：**不引入 Jev 云服务；把 Jev 的「输出协议 + 校准方法论 + 小模型形态」变成我们自己的本地决策层，与 L5 的 LLM 形成 System 1 / System 2 分工。**

---

## 0. 原则（已拍板，不再讨论）

1. **不采云 API**：隐私（窗口标题/OCR 不出网）、中文、RTT 三条都过不了。
2. Jev 对我们的价值是**范式**不是产品：Choice/Noul/Score 三路输出、非自回归、概率校准（RLCD 思想）。
3. 与产品铁律的映射：本地优先（决策全在本地）· 注意力预算（门控 AI 调用）· 显示诚实度（UI 上显示的置信度必须与真实校准一致，不校准不显示）。
4. 域收窄：只做 **13 态 WorkState + 3 个 Noul + 1 个 Score**，不追求通用决策模型。小而校准。

## 1. 协议层：WorkOn 自己的决策契约（TypeScript 类型先行）

一次采样 → 一组并行判定（不是单一标签）：

```ts
interface WorkOnDecision {
  choice: { state: WorkState; topK: Array<{ state: WorkState; p: number }> }  // 13 态 + 分布
  noul: { isMeeting?: { p: number }; isSlacking?: { p: number }; isDeepFocus?: { p: number } }  // 二元，可弃权
  score?: { focusDepth: number /* 1-10 */; p?: number }
  meta: { engine: 'rules' | 'xgboost' | 'encoder' | 'jev-like'; margin: number /* top1−top2 */ }
}
```

**三级 fallback（替代现有 0.75 一刀切）**：margin ≥ m1 → 静默自动；m1 > margin ≥ m2 → 弹验证（低打扰样式）；margin < m2 → 问用户（进纠正账本）。m1/m2 由校准曲线定，不是拍的。

**引擎可插拔**：`DecisionEngine` 接口统一，规则 / XGBoost / 语义编码器 / 未来的 Jev 复刻都实现它——decision.ts 从「if-else 链」变成「协议 + 引擎 + 融合」。

## 2. 四阶段路线（每阶段有明确的数据门槛和退出条件）

### P0 修地基（纯代码，无数据依赖，先做）
1. **修 `decision.ts` 的 `MODEL_LABEL_TO_STATE` 8 动作类/13 态错位**——model_first 下模型永不生效 + other→focus 误映射（账本已发现）。修完影子模式才有意义。
2. predict_server.py → decision.ts 全链路回传 **top-K 分布**（不只 top1 prob）。
3. recognition_log 记录结构补 `top1/top2/margin` 字段，为校准攒证据。

### P1 校准与 fallback（real_actions.jsonl 4.2MB 已够，mac 本机可做）
- 13 态重训：`ml/train.py --target state`（按 ts 过滤 2026-08-29 后真实特征）。
- 新写 `ml/calibration.py`：可靠性图 + ECE，用「用户纠偏」当金标单独算一条曲线。
- 由曲线定 m1/m2 → 三级 fallback 上线（先 shadow，两周后转正）。
- **退出条件**：留出集 macro-F1 ≥ 规则引擎，且 ECE ≤ 0.05；达不到就停在 shadow，不硬上。

### P2 语义头（P1 达标后，2-4 周）
- 现状：标题语义靠关键词特征（XGBoost 的强项是数值特征，弱项是语义）。
- 方案：多语种小编码器（multilingual-MiniLM ~118M 起步 → Laya 类 mmBERT 322M）做标题/OCR 语义 embedding，与数值特征拼接。
- **必须多语种**：中文窗口标题是主场景。
- A/B 口径：同批留出集，13 态 macro-F1 + ECE 对比，语义头无增益就不上。

### P3 Jev 复刻（纠正账本攒够后，远期）
- 路线 A：**NanoJev 形态**——Qwen3-0.6B + 决策头，纠正账本 LoRA 微调（LLM2Jev 的树分解列表式损失 + KL 锚防灾难遗忘）。
- 路线 B：**LLM2Jev 免训练**——本地 4B 模型 + 方括号序号 next-token 概率，零训练成本（hardwareDetect L2 档用户可开）。
- 部署仍走 Python sidecar（predict_server.py 旁边加 decision_server.py），OMP 限制照旧。

## 3. 与 LLM 的融合（L5 层，System 1 / System 2 分工）

| 融合点 | 方向 | 现状钩子 |
|--------|------|---------|
| 问答路由/门控 | 决策前置：这个问题值不值得调 AI、带多少上下文 | 双管道问答 + 注意力预算 |
| 答后校验 | 决策后置：AI 回答相关性 Noul 判定再展示 | statusCard 反哺链路 |
| **隐私防火墙** | 云端 LLM 只见类型化决策流（WorkState+分数），不见原始标题/OCR | 脱敏已有 desensitize.ts，升级为决策级 |
| 决策解释 | LLM 拿决策+状态快照生成「为什么判你摸鱼」的可解释文案 | 反哺对话框 |

隐私防火墙是重点：它把「本地优先」从口号变成技术结构——敏感原始数据止步于本地决策层，LLM 只消费语义压缩后的决策流。

## 4. 产品侧的 Jev 形态（判断引擎之外）

- **attributions 漂移确认** = Choice + 弃权（日配额 2 的交互已是雏形，补分布显示）。
- **planAnalysis 粘贴分类** = 文本→Choice（~90 词库是 P2 语义头的第一个替代目标）。
- **打断时机** = Noul（care/chatter 恢复时的「现在适合说话吗」，注意力预算执行器）。

## 5. 不做清单

- 不上云 API（含离线批测以外的任何产品内调用；离线 oracle 实验可选，结论只进 EXPERIMENTS.md）。
- 不用 LLM 在线约束解码做实时判定（延迟/成本不如 XGBoost；LLM 只做异步和解释）。
- 不替换规则引擎为模型——规则是 fallback 底座和冷启动，模型是增强。

## 6. 立即下一步（对应任务板 §8）

- [ ] P0.1 修 decision.ts 标签错位 bug
- [ ] P0.2 top-K 分布全链路回传
- [ ] P1.1 mac 起 Python 环境（xgboost + scikit-learn），13 态重训跑通
- [ ] P1.2 calibration.py 出第一版可靠性图

## 附：调研材料索引

- 账本 REQ-20260921-01（两轮结论）· `ml/EXPERIMENTS.md`（泄漏分析 + 二期记录）
- TypeSafe AI 官方发布（2026-09-15）· LLM2Jev（arXiv 2610.02076）· JevBench
- 开源复刻谱系：NanoJev 0.6B / Kev 0.8-9B / Laya mmBERT 322-421M / Von ~395M / Rizzo Flow 1.7-4B / Nimble 9B
