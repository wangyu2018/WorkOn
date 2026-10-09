# WorkOn-Jev · 为 WorkOn 训一个 Jev 风格的小型校准决策模型

> 目标：把「哑巴决策模型」Jev 的思路落到 WorkOn 上 —— 一次读入桌面上下文 STATE，
> 同时回答**场景三级 / 动作 / 工作状态**，并且**输出的是校准概率而不是标签**，
> 让规则引擎只在高置信时让位，低置信一律降级回规则。


---

## 0. 结果速览（全部在**未参与训练**的测试划分上；详见 [REPORT.md](REPORT.md)）

测试集 3,436 条（真实行为 1,896 条 + 合成场景 1,540 条），训练只用了 1 epoch / 3.18M token / 976 步（M4 上 149 分钟）。

| 题目 | n | 准确率 | macro-F1 | ECE | @0.75 覆盖率 | @0.75 精确率 |
|---|---|---|---|---|---|---|
| 工作状态 `work_state` | 2717 | 0.926 | 0.926 | **0.033** | 0.96 | 0.950 |
| 场景一级 `scene_l1` | 1540 | 0.951 | 0.951 | 0.011 | 0.99 | 0.954 |
| 场景二级 `scene_l2` | 1540 | 0.999 | 1.000 | 0.001 | 1.00 | 1.000 |
| 场景三级 `scene_l3` | 1540 | 0.947 | 0.956 | 0.014 | 0.93 | 0.991 |
| 动作类别 `action` | 821 | 0.924 | 0.923 | 0.033 | 0.97 | 0.931 |

- **只算真实行为数据**（1896 条，唯一没有合成成分的口径）：`work_state` 准确率 **0.953**、ECE 0.035。
- **端到端级联**（层级题的父节点用模型自己的答案，250 条）：**0.984** —— 分层没有放大上游错误。
- `@0.75` 就是 `decision.ts` 里 `MODEL_PROB_THRESHOLD` 那一列：**96% 的样本会被模型接管，这批里 95% 判对**。

### 和 XGBoost 的公平对照（同一份 train/test 划分，都只吃 9 个结构化特征）

| 模型 | 准确率 | macro-F1 | @0.75 覆盖率 / 精确率 |
|---|---|---|---|
| 多数类基线（一直答 `other`） | 0.727 | — | — |
| XGBoost（同划分重训） | **0.990** | 0.951 | 0.991 / 0.995 |
| WorkOn-Jev | 0.953 | **0.953** | 0.991 / 0.958 |

准确率上 XGBoost 更高，这在意料之中：真实数据只有 **33 个 `(app_category, field, label)` 组合**，
9 个瘦特征能榨出的信息已经到顶，树模型等价于一张查表。Jev 的 macro-F1 略高（长尾类别抓得更好），
但它真正的价值在别处 —— **XGBoost 结构上吃不了窗口标题 / OCR / 界面布局，也答不了场景三级**。

### 端侧时延（本机实测，中位数）

| 路径 | torch bf16 / M4 MPS | int8 onnxruntime / CPU 4 线程 |
|---|---|---|
| `work_state` 单题（每个采样点走这条） | 196 ms | 196 ms |
| 全 5 题（瘦上下文） | 1662 ms | 2019 ms |
| 全 5 题（富上下文） | 1814 ms | 2279 ms |

结论直接决定接入方式：**单题走每轮采样，全 5 题只在窗口切换时异步跑**（`predictFull`，不 await）。

### 部署一致性

int8 ONNX 与 torch 输出在真实样本上的**决策（argmax）100% 一致**（selftest 8/8 + 抽样 84/84），
单选项概率最大差约 0.31 —— 概率有抖动但选择不翻转，`@0.75` 覆盖率不变。

---

## 1. 先把话说清楚：Jev 是什么，不是什么

| | 普通小模型（WorkOn 现状） | Jev 风格 |
|---|---|---|
| 输入 | 9 个结构化特征列 | 一段自由文本 `STATE` + 若干**带类型的提问** |
| 输出 | 单个 label + 最大类概率 | 每题的**完整概率分布**（noul / choice / score） |
| 用途 | 分类 | **决策**：高置信自动执行、低置信交给人或规则 |
| 接口 | 自定义 stdio | `POST /v1/systemone`（与 [jev-style](https://github.com/lawrence3699/jev-style) / [jev-smol](https://github.com/DanielMcSheehy/jev-smol) 同形） |

参考实现：
- [jev-style](https://github.com/lawrence3699/jev-style)：0.8B/2B 权重 + MLX/torch/GGUF 服务 + MCP + 评测，**不做训练**；
- [jev-smol](https://github.com/DanielMcSheehy/jev-smol)：SmolVLM2-500M + LoRA SFT + 合成数据管线 + logit-per-option 打分，**是"自己训一个"的完整参考**。

本项目按后者那条路线走，但做了三处针对 WorkOn 的工程取舍（见 §4）。

---

## 2. 交付物

```
ml/jev/                                 ← 直接并进 WorkOn 仓库
├── README.md                           本文档
├── REPORT.md                           精度 / 校准 / 时延 实测报告
├── serve.py                            HTTP 服务入口（/v1/systemone）
├── sidecar.py                          stdio 侧车入口（替换 ml/predict_server.py）
├── requirements-serve.txt              端侧依赖：onnxruntime + tokenizers（约 25MB，不含 torch）
├── requirements-train.txt              训练依赖
├── configs/questions.json              选项表（21/70/168 + 16 + 11，固定口径）
├── model/                              model.int8.onnx + tokenizer + temperatures.json
├── jev/                                运行时代码（catalog/state/prompt/infer/serve）
├── tools/                              数据构建 / 训练 / 校准 / 评测 / ONNX 导出
└── integration/                        WorkOn 侧 TypeScript 接入补丁（含 base 原文，可自行 diff）
```

训练工程本体（含原始数据、逐次实验记录）不在 `ml/jev/` 里，见本目录上一级。

---

## 3. 任务口径：5 个问题、一次前向

| 题名 | 类型 | 候选数 | 说明 |
|---|---|---|---|
| `scene_l1` | choice | 21 | 一级场景（含「未知」） |
| `scene_l2` | choice（层级） | 1–13 | 只给**上一题选中 L1** 下的 L2 |
| `scene_l3` | choice（层级） | 1–11 | 只给**上一题选中 L2** 下的 L3 |
| `action` | choice | 16 | 动作类别（communicate/code/search/…） |
| `work_state` | choice | 11 | WorkOn 真正消费的工作状态 |

层级题按父节点给候选（`l1//l2`、`l1//l2//l3` 做内部 id，因为 L2 名称跨 L1 会重名），
所以单题候选数永远 ≤ 21，**单字母就能表达**，一次前向即可拿到整题分布。

---

## 4. 三处关键工程取舍（和 jev-smol 的差异）

1. **单字母 logits 打分，而不是逐选项 teacher forcing。**
   jev-smol 对每个选项各跑一遍前向取平均 logprob；候选 21 个就是 21 遍。
   这里把选项编成 `A./B./C.`，只读生成点**一个位置**的 logits，
   在该题实际用到的字母上做带温度 softmax —— 一次前向拿到整题分布，端侧时延降一个量级。
   （`prompt_min.py --check` 会逐字节比对 transformers 渲染，防止两条路径分叉。）

2. **逐题温度校准（calibrate.py），而不是照搬权重自带的温度。**
   WorkOn 决策层是 `prob >= 0.75` 才覆盖规则，温度直接决定误覆盖率。
   因此在真实验证集上按 NLL 网格搜索每题温度，并同时报告 ECE 与
   「1%/5%/10% 错误预算下能自动执行多少比例」。

3. **合成数据必须去泄漏，真实数据必须有绝对话语权。**
   `ml/EXPERIMENTS.md` 已经记录了 v2 的问题：合成数据的
   `(action_type, field, duration, text_length, has_shortcut)` 是按 label 分支生成的，
   模型背下查表就能拿 93%，去掉泄漏列立刻掉到 75.6%。
   本项目对合成行**把这些列整体替换成真实数据分布的重采样值**；
   并且合成行的 `work_state`/`action` 损失权重降到 0.35（因为它们的标签由 `scene_l3` 映射而来，
   与真实分布系统性冲突：真实数据里 `browser → other` 占 85%）。

---

## 5. 数据

| 来源 | 条数 | STATE | 可问题目 | 用法 |
|---|---|---|---|---|
| `real_actions.jsonl` | 22,745 | 瘦（类别/行为/时间） | work_state | 均匀随机 25% 入训，**保持 label 先验不变** |
| `scene_data.jsonl` | 9,844 | 富（进程/标题哈希/OCR/布局+行为） | 全部 5 题 | 按 L3 封顶 8 条/类 |
| `scene_training_data_enhanced.jsonl` | 11,810 | 富 | 场景 3 题 | 按 L3 封顶 8 条/类 |
| `action_data.jsonl` | 9,844 | 瘦 | action/work_state | **丢弃**（与 scene_data 同源重复，且是泄漏重灾区） |

其它处理：
- **封顶的理由**：真实数据只有 33 个 `(app_category, field, label)` 组合，极度冗余；
  场景行（5 题串问、每题带选项表，约 830 token/条）是训练耗时主因。
  最终配置：train **7,648 条 / 约 3.2M token**，1 epoch。
  （先试过 cap=12、real 30% ⇒ 4.37M token/epoch，在 M4 上要 8 小时以上，砍到 cap=8 才落到 2.5 小时量级。）
- **划集用等距抽样**（每 12 条取 1 条做 test）而不是随机划，因为原始文件按时间排列，
  随机划会让相邻几乎相同的样本跨集泄漏。
- **子集与顺序增强**：每题的保留概率不同（`action` 0.55、`work_state` 0.80…），
  且 `action`/`work_state` 会随机插到 `l1→l2→l3` 链条的任意位置，
  这样端侧才敢「只问 work_state」走快通道。
- **选项顺序每样本打乱**，防止模型记住字母位置而不是读选项。

---

## 6. 训练

```bash
source env.sh                       # 把 uv/HF/torch 缓存指到工作区内
python tools/prepare_labels.py      # 生成 configs/questions.json
python jev/data/build.py --real-frac 0.25 --scene-cap 8   # 构建 data/processed/{train,val,test}.jsonl
python jev/train/sft.py \
  --batch-size 8 --token-budget 1100 --grad-accum 4 --attn sdpa \
  --epochs 1 --max-len 896 --lr 2e-4 --save-every 200
python jev/train/calibrate.py       # 逐题温度 -> out/lora/temperatures.json
python jev/eval/evaluate.py --cascade 1
python tools/baseline_compare.py    # 同一批真实测试行上对比现网 XGBoost
python jev/export/export_onnx.py --model out/lora --out out/onnx --opset 20
tools/make_report.py && tools/make_delivery.py
```

或者直接 `./run_all.sh`（分阶段可恢复，例如 `./run_all.sh onnx`）。

要点：
- **只在答案位算 lm_head。** 全序列 logits 是 `(B,T,151936)`，B=8/T=896/fp32 就是 4.3GB，
  MPS 直接 OOM。改为取 hidden_states 的答案位再做 lm_head，显存降两个数量级。
- **长度分桶批采样。** 真实行 ~150 token、场景行 ~830 token，混在一起 padding 会吃掉一半算力。
- **MPS 上「每题全量重算」比 KV 增量更快**（增量每次只前送 6 个 token，GPU 利用率极低），
  两者结果逐位一致，已实测，所以默认关掉 KV 增量。
- 实测吞吐：M4/16G，bf16 + SDPA，约 450–500 tok/s（纯前向 ~2,300 tok/s）。

> **16G 机器上的一个坑（踩过）**：训练峰值约 8GB。如果同时开 ONNX 导出（fp32 权重 2.4GB）
> 之类的重活，系统会进 swap，吞吐从 360 tok/s 掉到 160 tok/s、`vm_stat` 里
> compressor 涨到 5GB。加上 `--token-budget`（单批 padding 后 token 有上界）+
> 必要时开梯度检查点之后，空闲内存从 161MB 回到 3.6GB，稳定在 450 tok/s 以上。

---

## 7. 接入 WorkOn（三个文件）

补丁在 `integration/`，同时给了 `base/`（你仓库原文）和 `new/`（改后），可自行 diff。

### 7.1 必修：`src/shared/stateMeta.ts`

**现网存在一个静默失效**：`MODEL_LABEL_TO_STATE` 里是 v1 的 8 个动作标签
（`code/write/data_entry/search/browse/manage/communicate/other`），
而 `ml/models/label_classes.json`（v2/v3 模型实际输出）是 8 个 **WorkState**
（`coding/writing/aidev/aiqa/slack/relax/idle/other`）。
两边没有交集 ⇒ `MODEL_LABEL_TO_STATE[pred.label]` 恒为 `undefined` ⇒
**`model_first` 模式下模型结果永远不会覆盖规则**，只在 `shadow` 里被记了账。

补丁把 v2/v3 与 Jev 的 WorkState key 补齐（`coding → coding` 等）。

### 7.2 替换：`src/main/recognition/modelClient.ts`

- 后端从 `ml/predict_server.py` 换成 `ml/jev/jev/serve/sidecar.py`；
- 模型目录判定改为含 `model.int8.onnx` + `tokenizer.json` 的 `ml/jev/model`；
- 超时：fast 通道 500ms → 3000ms，READY 15s → 90s（0.6B 载入比 XGBoost 慢得多）；
- 新增 `predictFull(context)`：窗口切换时异步取场景三级 + 动作（**不要放进每个采样点**）；
- 保留原有降级口径：任何失败 `resolve(null)`、崩溃冷却重启、连续 3 次失败停用。

### 7.3 追加：`src/main/recognition/types.ts` + `decision.ts`

- `types.ts` 追加 `JevScenePrediction / JevAnswer / JevFullPrediction`；
- `decision.ts` 增加场景旁路缓存（窗口上下文变化且距上次 ≥5s 才刷新，不阻塞采样主链路），
  对外暴露 `getLatestScene()` 供 UI / 报表读取。

### 7.4 打包配置

`package.json` 的 `build.files` 需要加上 `ml/jev/**/*`（现在只打了 `out/**/*` 和几个 node_modules）。
端侧 Python 环境只需 `pip install -r ml/jev/requirements-serve.txt`。

---

## 7.5 部署后端是自动选的

`ml/jev/model/` 里只有 `model.int8.onnx` + tokenizer，开发目录 `out/lora/` 里只有 LoRA adapter。
`jev/infer/factory.py` 会按目录内容自动选后端：

| 目录里有 | 后端 | 依赖 |
|---|---|---|
| LoRA adapter / 完整 HF 权重 | `JevEngine`（torch） | torch + transformers |
| `model.int8.onnx` / `model.onnx` | `OnnxEngine`（onnxruntime） | **只需 onnxruntime + tokenizers（约 25MB）** |

默认模型目录同样自动解析（`model/` → `out/lora` → `out/onnx`），可用 `JEV_MODEL_DIR` 覆盖。
写死任何一种都会让另一边在"上线当天"才发现起不来。

## 8. 直接跑起来看看

```bash
# 1) stdio 侧车（和 WorkOn 的调用方式一致）
echo '{"id":1,"features":{"app_category":"browser","action_type":"TYPE","field":"web_page",
  "duration_ms":5000,"hour":10,"day_of_week":3,"time_since_prev_ms":3000,
  "text_length":18,"has_shortcut":false}}' | python ml/jev/sidecar.py --mode fast

# 2) HTTP 服务
python ml/jev/serve.py --port 8765
curl -s localhost:8765/v1/workon/decide -H 'content-type: application/json' -d '{
  "context": {"process_name":"chrome.exe","app_category":"browser",
              "window_title":"DeepSeek - 对话","ui_layout":"左侧会话列表，右侧对话区，底部输入框",
              "action_type":"TYPE","field":"search_box","text_length":18,
              "duration_ms":5000,"hour":10,"day_of_week":3,"has_shortcut":false},
  "questions": ["work_state","scene_l1","scene_l2","scene_l3"]}'

# 3) 标准 SystemOne
curl -s localhost:8765/v1/systemone -H 'content-type: application/json' -d '{
  "state": "用户正在 VS Code 里改一个 TypeScript 文件，刚跑了 npm run typecheck",
  "questions": {
    "coding":   {"type":"noul","instructions":"是否在写代码？"},
    "urgency":  {"type":"score","instructions":"紧急程度？","criteria":["不急","一般","很急"]}}}'
```

---

## 9. 已知限制（别当成没看见）

1. **场景题只有合成训练数据，而且对措辞敏感。** 真实采集里没有场景标签，所以 `scene_l1/l2/l3`
   的精度数字含合成模板成分。实测过一个很说明问题的对比：
   - 喂**分布内**原样样本（`scene_data.jsonl` 里 DeepSeek 那一行，进程 firefox / 有
     `ocr_keyword_category`）：`浏览器 > AI问答 > DeepSeek对话`，scene_l3 置信度 **0.998** ✓
   - 喂**我手写改写**的同类上下文（把 ui_layout 换个说法、OCR 换成关键词列表）：
     掉到 `浏览器 > 信息检索 > Google搜索`，scene_l2 只有 0.65 ✗

   也就是说：**同一类场景换个说法就可能判错，测试集上那个 0.951 是模板分布内的成绩**。
   这是整个交付里最需要警惕的一点 —— 场景题请先只做展示/报表，攒够真实数据再参与判定。
2. **`real_actions.jsonl` 的有效信息其实很少。** `action_type` 97.5% 是 `TYPE`，
   `has_shortcut` 全是 `false`，`duration_ms`/`time_since_prev_ms` 中位数就是采样间隔 2013ms。
   真正有判别力的只有 `app_category` + `field` + `text_length`。这也是为什么必须上自由文本 STATE。
3. **`action` 题的标签是 `scene_l3` 映射出来的**（见 `_L3_ACTION_HINT`），
   只作为动作分类层的过渡口径，别拿它当独立监督信号。
4. **端侧时延**：M4 上 fast ~0.2s、full ~0.7s；Windows CPU（int8 onnxruntime）会明显更慢，
   所以设计上就是 fast 走每轮采样、full 走窗口切换。
5. **`noul` / `score` 是通用回退能力**，训练数据里没有这两类样本，
   接口能收能答（`noul` = P(是)，`score` = 期望档位），但没有专门的精度保证。
