# WorkOn-Jev 调研与上下文

> 调研时间：2026-10-08 ~ 10-09
> 目标：为 WorkOn（github.com/wangyu2018/WorkOn）引入一个 Jev 风格的小型校准决策模型
> 结论先行：**模型已训好并验证，交付在 `delivery/ml/jev/`；但它的定位是「本地、离线、要概率」的决策件，不是去替换已经更好的 XGBoost，更不是替代 LLM。**

---

## 1. 调研起点：三个输入

### 1.1 两个压缩包

| 包 | 内容 | 作用 |
|---|---|---|
| `workon.zip`（1.75GB） | WorkOn 仓库本体（含 `.git`、electron 打包产物），`github.com/wangyu2018/WorkOn` | 现状分析的对象 |
| `workon小模型训练.zip`（8MB） | 此前的场景识别数据工作：`scene_data.jsonl`(9844)、`scene_training_data_enhanced.jsonl`(11810)、`scene_training_data.jsonl`(624)、`action_data.jsonl`(9844)、`scene_taxonomy.json` | 训练数据来源之一 |

包内文件名是 GBK 编码，`unzip` 直接解会乱码/失败，用 Python `zipfile` + `orig_filename.encode('cp437').decode('gbk')` 处理。

### 1.2 「Jev」是什么

抓取 [jev-style](https://github.com/lawrence3699/jev-style) 与 [jev-smol](https://github.com/DanielMcSheehy/jev-smol) 的 README 确认：

- Jev = **「哑巴决策模型」**：不聊天。输入一段 `state`（文本/截图）+ 若干**带类型的提问**（`noul` 是否 / `choice` 多选 / `score` 有序打分），一次前向返回**每个选项的校准概率**。
- 走 `POST /v1/systemone` 协议（Cloudflare CLEF / TypeSafe Jev System One 同形）。
- 核心卖点：**输出概率而不是标签** → 代码可以「高置信自动执行、低置信交给人或规则」。
- 两条参考线：
  - `jev-style`：0.8B/2B 权重 + MLX/torch/GGUF 服务 + MCP + 评测，**不含训练**；
  - `jev-smol`：SmolVLM2-500M + LoRA SFT + 合成数据管线 + logit-per-option 打分，**是「自己训一个」的完整参考**。

### 1.3 WorkOn 现状（读源码得到）

- 识别管道已存在：`src/main/recognition/decision.ts`（规则+模型仲裁）→ `modelClient.ts`（Python 常驻子进程，stdio NDJSON）→ `ml/predict_server.py`（XGBoost）。
- 三种模式：`rules` / `shadow`（只记账不生效）/ `model_first`（高置信才覆盖规则）。
- 数据：`ml/data/real_actions.jsonl` **22,745 条真实样本**；`ml/models/action_model_v2/v3_real.json`。
- `ml/EXPERIMENTS.md` 已记录 v2 模型的**标签泄漏**问题（去掉 field/action_type 两列后 93% → 75.6%）。
- 所有 LLM 调用汇到 `src/main/ai.ts`（1125 行），9 个调用点。

**开发机**：Apple M4 / 16GB / macOS；`uv` 可用；HF 与 PyPI 直连可达。
**WorkOn 的部署目标**：Windows（`AGENTS.md`、NSIS 安装包）。

---

## 2. 五个关键设计决策（以及为什么）

### D1 · 任务口径：一次 state 回答 5 道题

| 题名 | 类型 | 候选数 |
|---|---|---|
| `scene_l1` | choice | 21（含「未知」） |
| `scene_l2` | choice（层级） | 1–13 |
| `scene_l3` | choice（层级） | 1–11 |
| `action` | choice | 16 |
| `work_state` | choice | 11 |

层级题按父节点给候选，内部 key 用路径 id（`l1//l2`）——因为 **L2 名称跨 L1 会重名**（「AI问答」同属「AI工具」和「浏览器」）。单题候选 ≤21，单字母就够表达。

### D2 · 单字母 logits 打分，而不是逐选项 teacher forcing

jev-smol 对每个选项各跑一遍前向取平均 logprob（21 个候选 = 21 遍）。这里把选项编成 `A./B./C.`，只读生成点**一个位置**的 logits，在该题实际用到的字母上做带温度 softmax。一次前向拿到整题分布，端侧时延降一个量级。

**代价**：候选上限 26（单字母）。WorkOn 最大题 21 个，安全。

### D3 · 逐题温度校准

WorkOn 决策层用 `prob >= 0.75` 才覆盖规则，**温度直接决定误覆盖率**。在验证集上按 NLL 网格搜索每题温度。
实测：`work_state T=1.455 (ECE 0.064→0.043)`、`scene_l1 T=1.65 (0.050→0.019)`、`action T=1.575 (0.062→0.027)`。

### D4 · 合成数据必须去泄漏

`ml/EXPERIMENTS.md` 记录了 v2 的教训：合成数据的 `(action_type, field, duration, text_length, has_shortcut)` 是按 label 分支生成的，模型背下查表就能拿 93%，去泄漏后掉到 75.6%。
本项目对合成行把这 5 列**整体替换成真实数据分布的重采样值**（按 app_category 匹配），并且合成行的 `work_state`/`action` 损失权重降到 **0.35**（因为它们的标签由 `scene_l3` 映射而来，与真实分布系统性冲突：真实数据里 `browser → other` 占 85%）。

### D5 · 真实数据有绝对话语权

`real_actions.jsonl` 按**均匀随机 25%** 抽样入训——保持 label 先验不变（`other` 占 73% 是真实分布，不能为了平衡而扭曲它，否则模型会失准）。场景行按 L3 封顶 8 条/类。

---

## 3. 踩过的坑（都修了，记下来避免重蹈）

| # | 坑 | 现象 | 解法 |
|---|---|---|---|
| 1 | **Qwen3 chat template 前缀不对齐** | `add_generation_prompt=True` 的渲染不是完整多轮渲染的前缀，答案位置错位 | Qwen3 只给**最后一轮** assistant 加 `〈think〉…〈/think〉`；统一给每个 assistant 头补上空 think 块（`jev/prompt.py::_normalize`） |
| 2 | **全序列 logits 撑爆显存** | `(B,T,151936)` fp32 = 4.3GB，MPS 直接 OOM | 只在**答案位**取 hidden_states 再过 `lm_head`，显存降两个数量级 |
| 3 | **MPS 内存不还给系统** | wired 涨到 13GB，机器进 swap，吞吐 360→160 tok/s | 开梯度检查点 + `--token-budget` 限定单批 padding 上限 + 定期 `torch.mps.empty_cache()` |
| 4 | **16G 机器并发跑重活** | 训练同时跑 ONNX 导出（fp32 权重 2.4GB）→ 严重换页 | 训练期间不要开别的重活；pipeline 拆阶段跑 |
| 5 | **KV 增量反而更慢** | 增量每次只前送 6 个 token，MPS 利用率极低 | 0.6B 上「每题全量重算」更快（688ms vs 1065ms），且结果逐位一致 → 默认关掉 KV 增量 |
| 6 | **`--limit` 取的是文件前 N 条** | 数据文件里真实行排前面，抽样不具代表性 | limit 前先 shuffle |
| 7 | **onnxsim 在大模型上崩** | protobuf 单条消息 2GB 上限，`EncodeError: Failed to serialize proto` | >2GB 跳过 onnxsim，改清 `graph.value_info` |
| 8 | **量化 strict shape inference 冲突** | `dimension 0: (1024) vs (151936)` | 根因是 `tie_word_embeddings=True`：lm_head 与 embed_tokens 共用权重，导出后同一 initializer 既当嵌入表又当 Gemm 权重。**解绑**（克隆一份）+ 删 `value_info` |
| 9 | **torch 与 xgboost 同进程段错误** | macOS 上各自链接一份 libomp，`xgb.load_model` 必崩（exit 139） | XGBoost 放**独立子进程**跑 |
| 10 | **`state_row` 里带着金标 `label`** | 差点把答案写进上下文（`render_state` 只读白名单键，训练没受影响，但属于「正确但危险」） | `build.py` 加 `STATE_KEYS` 白名单 `state_view()` |
| 11 | **交付侧车默认模型目录指向开发路径** | 交付包里起不来 | `factory.default_model_dir()`：`model/` → `out/lora` → `out/onnx`，`JEV_MODEL_DIR` 可覆盖 |
| 12 | **自检脚本 `check` 同名遮蔽** | `from prompt_min import check` 把自己的 `check(cond,msg)` 盖掉了，bool 被当模型路径 | 改用 `import ... as pm` |
| 13 | **适配器包缺 `chat_template.jinja`** | 新版 transformers 把 chat template 存成独立文件，不拷贝则 `apply_chat_template` 直接抛错 | 往返测试（解包→加载→推理）抓到并修复 |
| 14 | **torch 后端不自动加载 temperatures.json** | OnnxEngine 有这逻辑、JevEngine 漏了 ⇒ torch 后端线上一直跑未校准的 T=1.0。**只影响概率不影响 argmax**（softmax 带温度是单调变换），所以评估能过、上线才出事。校准前后 prob 0.9903→0.9357 | `JevEngine.__init__` 自动读模型目录下的 `temperatures.json` |

> **13、14 都是靠「从交付包解压 → 加载 → 推理」的往返测试抓到的**，光在开发目录里跑自检发现不了。
> 交付前请务必跑一次往返验证。

---

## 4. 结果（全部在未参与训练的测试划分上）

测试集 3,436 条（真实行为 1,896 + 合成场景 1,540）。

### 4.1 分题

| 题目 | n | 准确率 | macro-F1 | ECE | @0.75 覆盖率 | @0.75 精确率 |
|---|---|---|---|---|---|---|
| `work_state` | 2717 | 0.926 | 0.926 | **0.033** | 0.96 | 0.950 |
| `scene_l1` | 1540 | 0.951 | 0.951 | 0.011 | 0.99 | 0.954 |
| `scene_l2` | 1540 | 0.999 | 1.000 | 0.001 | 1.00 | 1.000 |
| `scene_l3` | 1540 | 0.947 | 0.956 | 0.014 | 0.93 | 0.991 |
| `action` | 821 | 0.924 | 0.923 | 0.033 | 0.97 | 0.931 |

- 只算真实行为数据（1896 条，唯一无合成成分的口径）：`work_state` **0.953** / ECE 0.035
- 端到端级联（父节点用模型自己的答案，250 条）：**0.984** —— 分层没放大上游错误

### 4.2 与 XGBoost 的公平对照（同一 train/test 划分，都只吃 9 个结构化特征）

| 模型 | 准确率 | macro-F1 | @0.75 覆盖 / 精确 |
|---|---|---|---|
| 多数类基线（一直答 other） | 0.727 | — | — |
| XGBoost（同划分重训） | **0.990** | 0.951 | 0.991 / 0.995 |
| WorkOn-Jev | 0.953 | **0.953** | 0.991 / 0.958 |

**怎么读**：准确率 XGBoost 更高是意料之中——真实数据只有 **33 个 `(app_category, field, label)` 组合**，9 个瘦特征信息已到顶，树模型等价于查表。Jev 的 macro-F1 略高（长尾类别抓得更好），但它真正的价值在别处：**XGBoost 结构上吃不了窗口标题 / OCR / 界面布局，也答不了场景三级**。
另：现网 `action_model_v3_real` 自报的 99.84% 是拿它训练过的行在测（真实数据极度冗余），是记忆不是泛化。

### 4.3 端侧时延（本机实测，中位数）

| 路径 | torch bf16 / M4 MPS | int8 onnxruntime / CPU 4 线程 |
|---|---|---|
| `work_state` 单题 | 196 ms | 196 ms |
| 全 5 题（瘦上下文） | 1662 ms | 2019 ms |
| 全 5 题（富上下文） | 1814 ms | 2279 ms |

→ **单题走每轮采样，全 5 题只在窗口切换时异步跑**。

### 4.4 部署一致性

int8 ONNX 与 torch 输出在真实样本上的**决策（argmax）100% 一致**（selftest 8/8 + 抽样 84/84），单选项概率最大差约 0.31 —— 概率有抖动但选择不翻转，`@0.75` 覆盖率不变。

---

## 5. 交付物

```
delivery/ml/jev/                    ← 直接解压并入 WorkOn 仓库根
├── README.md                       交付说明（口径/取舍/流程/限制）
├── REPORT.md                       实测报告
├── serve.py                        HTTP 服务入口（/v1/systemone）
├── sidecar.py                      stdio 侧车入口（与 ml/predict_server.py 协议兼容）
├── requirements-serve.txt          端侧依赖：onnxruntime + tokenizers（约 25MB，不含 torch）
├── requirements-train.txt          训练依赖
├── configs/questions.json          选项表（21/70/168 + 16 + 11）
├── model/                          model.int8.onnx(756MB) + tokenizer + temperatures.json
├── jev/                            python 包（catalog/state/prompt/infer/serve/data/train/eval/export）
├── tools/                          数据构建/训练/校准/评测/导出/自检
└── integration/                    WorkOn 侧 TS 补丁（含 base/ 原文、new/ 改后、合并 patch）
```

训练产物（LoRA 适配器本体）：
```
out/lora/
├── adapter_model.safetensors   40MB（r=16 alpha=32，7 个投影层）
├── adapter_config.json
├── tokenizer.json / tokenizer_config.json
├── temperatures.json           逐题温度 {work_state:1.455, scene_l1:1.65, ...}
├── train_config.json           完整超参 + val_loss
├── train_log.jsonl             逐步 loss/lr/tok_per_s
├── questions.json              选项表快照
└── step-{150..900}/            中途快照（评估用，可删）
```

自检：`tools/selftest.py --with-model` → **19/19 通过**，含
- `prompt_min` 渲染/分词与 transformers **逐字节一致**（120 条真实样本）
- 侧车 NDJSON 协议（ready → 请求 → label/prob）
- ONNX 与 torch 决策 **8/8 一致**

---

## 6. WorkOn 接入：4 个文件

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/shared/stateMeta.ts` | **必修**。`MODEL_LABEL_TO_STATE` 补上 WorkState key。**修的是一个静默失效**：现表是 v1 的 8 个动作标签（`code/write/…`），而 v2/v3 模型输出的是 8 个 WorkState（`coding/writing/…`），两边无交集 ⇒ `model_first` 模式从 v2 上线起就没生效过 |
| 2 | `src/main/recognition/modelClient.ts` | 换后端到 `ml/jev/jev/serve/sidecar.py`；模型目录判定改为 `model.int8.onnx` + `tokenizer.json`；超时 fast 500ms→3000ms、READY 15s→90s；新增 `predictFull()`（场景三级+动作，异步） |
| 3 | `src/main/recognition/types.ts` | 追加 `JevScenePrediction / JevAnswer / JevFullPrediction` |
| 4 | `src/main/recognition/decision.ts` | 场景旁路缓存：窗口上下文变化且距上次 ≥5s 才异步刷新，不阻塞采样主链路，暴露 `getLatestScene()` |

另外 `package.json` 的 `build.files` 要加 `ml/jev/**/*`。

---

## 7. 产品化讨论：LLM、分发、可观测性

### 7.1 「LLM 就是好用」——先算账

WorkOn 每 2 秒采样，活跃 8h/天 = 14,400 tick。低置信按 12% 算 → **1,728 次 LLM 调用/天/用户**，¥0.002/次也要 ¥100+/月/用户。**高频链路里不存在「LLM vs Jev」的选择题。**

另一面：现在所有 AI 功能 gated 在 `aiEnabled && aiApiKey`，没配 key 的用户什么都没有（`inferOtherCategories` 直接 return）。本地模型 = AI 能力开箱即用。

**分工表**：

| 链路 | 用什么 | 原因 |
|---|---|---|
| 9 个结构化特征 → work_state | 规则 + 现有 XGBoost | 已上线且更强（0.990 vs 0.953），别做退化 |
| 窗口标题/OCR/布局 → 场景三级 | **Jev** | 只有它能本地吃文本 |
| 微活动标签、AI 助手状态、计划匹配 | **Jev** | 高频 + 封闭集合 + 要概率 |
| 日报/状态卡/待办抽取/桌宠对话 | **LLM** | 生成，低频 |

### 7.2 9 个 LLM 调用点逐一判定

| 调用点 | 本质 | 判定 |
|---|---|---|
| `ai.ts:714 inferOtherCategories` | 9 选 1 分类 + 微活动 + conf | ✅ **首选**：与已训模型同任务，且 LLM 自报的 conf 不可信 |
| `aiAssistWatch.ts`（正则名单判忙/闲） | 二选一 | ✅ 换：纯正则脆，且高频 LLM 跑不动 |
| `ai.ts:1048 matchBrowserToPlan` + `report/planMatcher.ts` | N 选 1 | ✅ 换（>26 个计划需先规则粗筛） |
| `report/aiEnhancement.ts:177` | 离散字段 + 自由文本 | ⚠️ 拆开：离散给 Jev 兜，自由文本留 LLM |
| `statusCard.ts:563` | 生成 | ❌ 留 LLM，但用 Jev 守门（见 7.3） |
| `pasteTodos.ts:42` | 生成 | ❌ 留 LLM，同理 |
| `projects.ts:241 aiBreakdown` | 生成 | ❌ 留 LLM |
| `report/templateParser.ts:108` | 结构化抽取 | ❌ 留 LLM |
| `ai.ts:937 petAskShort` | 生成 + 工具 | ❌ 留 LLM |

**判断标准**：输出是封闭集合选择（≤26）→ Jev；需要校准概率决定自动化 → Jev；高频或必须离线 → 只能 Jev；要生成自由文本 → LLM；两者都要 → **LLM 提议 + Jev 守门**。

### 7.3 LLM 提议 + Jev 守门

`statusCard` 的 prompt 里写着「已有未完成待办不要乱填 completed」——这是在**求** LLM 别乱来。与其求，不如验：LLM 生成后，对每条 claimed completed 的待办问 Jev 一个 `noul`，`P<0.7` 就降回 deferred。`pasteTodos` 的「是不是真计划/是不是用户自己的承诺」同理。**生成归 LLM，把关归 Jev。**

### 7.4 数据飞轮（Jev 决策 → 低置信走 LLM → 记录 → 用户辅助判断）

```
每个 tick（2s，同步）                每个段 / 每小时（异步）
规则命中？ ──是──→ rule              low-conf 的 tick 聚成段
   ↓否                               ↓
Jev p≥T_high ──是→ jev      ───→   LLM 批量仲裁（一次 20 条）
   ↓否            写日志             ↓ 一致→确认 / 不一致→标记
先记 low_conf，用 Jev 答案顶上        不确定 ∧ LLM 不同意 → 问用户
```

**关键：LLM 兜底不能放进 2 秒采样环**（4% × 1-2s 会打穿 `REQUEST_TIMEOUT_MS`），必须拆到段级异步。
**降噪：别拿 tick 当训练样本，拿段（segment）当**——几十个 tick 投票出标签，且用户纠正本来就按段给。

`recognition_log` 需补 7 列：`jev_top3 / llm_label / llm_conf / source / user_from / user_to / context_hash`。
`source` 是承重墙：`rule | jev | llm | user`，训练前按它过滤和加权。

**标签权重分层**（用户辅助判断的接入点）：

| 来源 | 权重 |
|---|---|
| 用户确认/改判 | 1.0 |
| LLM 与 Jev 不一致（且用户后来确认） | 1.0 |
| 规则命中 | 0.8 |
| LLM 单独仲裁 | 0.3–0.5（弱标签） |
| Jev 高置信自答 | **0，不训** |

⚠️ **绝不能拿 Jev 自己的高置信输出训自己** —— 自蒸馏坍缩，错误被固化且指标虚高（与 v2 标签泄漏同类病，只是泄漏源是模型自己）。LLM 同意 Jev 的样本信息量≈0，**两者不一致的才值钱**。

**用户误操作六条过滤**：
1. 秒撤（N 秒内改回）→ 误触丢弃
2. 改回规则答案 → 保留，权重 0.8（模型错了、规则对了，有效信号）
3. `context_hash` 与决策时不一致 → 不收
4. 改判率长期 >30% 的用户整体降权（Dawid-Skene 标注者可靠度）
5. 跨天纠正绑定 `segId`，不绑实时状态
6. `idle > AWAY_AFTER_SEC`、锁屏、非激活屏不采集

**主动学习不另起炉灶**：WorkOn 已有 `qa/questionGenerator.ts` + `recordFeedback(qid, ctx, yes/no)` 闭环。只有「Jev 不确定 ∧ LLM 不同意」才问用户，走桌宠/状态卡，日限额 5 条。

**重训触发**：某类别强标签新增 ≥50 条，或整体 ≥500 条。新模型先 `shadow`，同一批段上分歧率 <2% 且在用户改判样本上更优才切。**每次重训必须重跑 `calibrate.py`**，`T_high` 用新 reliability 表重定（经验：精确率 ≥0.98）。

### 7.5 上线三道坎

**① 分发：不要让用户连 HuggingFace。**
| 方案 | 做法 |
|---|---|
| **随包分发（推荐）** | `electron-builder` `extraResources` 打进安装包，756MB 换「装完即用」 |
| 自家 OSS 懒下载 | 首启弹「下载智能包」，走阿里云 OSS/COS 带进度条 |
| ModelScope / hf-mirror | 只在你自己训练时需要 |

**② 去掉 Python 依赖（上线前置条件）。**
终端用户装 Python 不现实。推荐把 `state.py`/`prompt_min.py`/`catalog.py` 移植成 TypeScript（约 500 行，纯字符串拼接 + 一个 JSON 选项表），推理用 **`onnxruntime-node`**（微软官方绑定），分词用 `tokenizers` 的 npm 包 → 整个推理纯 Node，进 `utilityProcess`，不用再管 Python 版本/PATH/杀软拦截。

**③ 可观测性：shadow 模式本身就是无风险观测器。**
它把规则答案和模型答案**都**写进 `recognition_log`，产品行为不变。补齐 7 列后任何决策都能还原「当时看到了什么、给了什么概率、谁拍的板」。再加：
- 应用内诊断页（最近 N 条决策、source 分布、置信度直方图、规则与模型分歧列表）
- 「导出诊断包」按钮：按时间窗导 JSONL，默认抹掉标题/OCR 原文，只留类别、哈希、概率
- **每行记 `model_version` 和 temperatures 版本**，否则拿到日志也无法复现
- opt-in 聚合遥测：只报数字（自动化率、改判率趋势），绝不上报原文。改判率是最好的线上健康指标，应随版本迭代单调下降

### 7.6 上线节奏

```
v0.9  只发 shadow：XGBoost 照旧出结果，Jev 只记账
      → 两周后手里有：真实 T_high-精确率曲线、分歧样本池、场景题在真实标题上的掉点幅度
v1.0  场景三级先只做展示（报表/状态卡文案），不参与任何判定
      → work_state 维持 XGBoost，Jev 只在文本特征上补位
v1.1  攒够用户级强标签后重训，Jev 才在 work_state 上有投票权
```

每一步可回滚，且第一步就顺手解决「看不到流程」。

---

## 8. 已知限制（最重要的三条放最前）

1. **场景题只有合成训练数据，且对措辞敏感。** 实测对比：
   - 喂**分布内**原样样本（`scene_data.jsonl` DeepSeek 行，firefox / `ocr_keyword_category:action`）→ `浏览器 > AI问答 > DeepSeek对话`，scene_l3 置信度 **0.998** ✓
   - 喂**手写改写**的同类上下文（ui_layout 换说法、OCR 换关键词列表）→ 掉到 `浏览器 > 信息检索 > Google搜索`，scene_l2 只有 0.65 ✗

   同一类场景换个说法就可能判错，**测试集 0.951 是模板分布内的成绩**。场景题请先只做展示/报表，攒够真实数据再参与判定。

2. **`real_actions.jsonl` 有效信息很少。** `action_type` 97.5% 是 `TYPE`，`has_shortcut` 全是 `false`，`duration_ms`/`time_since_prev_ms` 中位数就是采样间隔 2013ms。真正有判别力的只有 `app_category + field + text_length`。这也是为什么必须上自由文本 STATE。

3. **`action` 题的标签是 `scene_l3` 映射出来的**（`catalog.py::_L3_ACTION_HINT`），只作为动作分类层的过渡口径，别当独立监督信号。

其余：
- `noul` / `score` 是通用回退能力（接口能收能答：`noul`=P(是)，`score`=期望档位），但训练数据里没有这两类样本，无专门精度保证。
- 新题型（微活动 `mic`、AI 助手忙/闲等）协议开箱即用，但精度无保证，需照 synthgen 路子补数据再训。
- 单字母方案候选上限 **26**；计划匹配若超，先规则粗筛再让 Jev 排。
- int8 概率有抖动（最大单选项差 ~0.31），argmax 稳定，但**贴近阈值的样本可能翻面**。

---

## 9. 复现

```bash
cd workon-jev
./run_all.sh                 # 全流程：选项表→数据→训练→校准→评测→对照→ONNX→报告→交付
./run_all.sh onnx            # 从某阶段往后
tools/selftest.py --with-model
tools/make_report.py
tools/make_delivery.py
```

训练单跑：
```bash
python jev/train/sft.py --out out/lora \
  --batch-size 8 --token-budget 1100 --grad-accum 4 --attn sdpa --grad-ckpt 1 \
  --epochs 1 --lr 2e-4 --max-len 896 --eval-every 400 --save-every 150 --empty-cache-every 25
```

**16G 机器务必注意**：MPS 分配器不主动还显存，必须开梯度检查点 + token 预算 + 定期 empty_cache，且训练时别开别的重活（实测进 swap 后 360→160 tok/s）。

---

## 10. 相关文件索引

| 路径 | 内容 |
|---|---|
| `README.md` | 交付说明（本文档的产品视角版） |
| `REPORT.md` | 实测报告（完整表格 + 可靠性分箱） |
| `delivery/ml/jev/` | 交付目录 |
| `workon-jev-ml-jev.zip` | 交付压缩包（513MB） |
| `workon-jev-model-adapter.zip` | LoRA 适配器本体（40MB 权重 + 温度 + tokenizer + 训练日志，已做往返验证） |
| `out/lora/` | 训练产物 |
| `out/merged/` | 合并 LoRA 后的完整模型（2.2GB，导出用） |
| `out/onnx/` | int8 ONNX + 温度 + 报告 |
| `out/eval_report.json` / `out/baseline.json` / `out/baseline_retrain.json` | 评测/对照原始数据 |
| `data/processed/` | train/val/test.jsonl + stats.json |
| `configs/questions.json` | 选项表（唯一口径） |
| `_extract/workon/` | WorkOn 仓库解包（分析用） |
| `_extract/small/workon小模型训练/` | 此前场景数据工作解包 |
