# 模型实验记录

## 实验 0：v2 线上模型为什么不可信（泄漏分析）

`action_model_v2.json`（2026-08-25）训练数据 = simulated_actions.jsonl(5,500) + scene_actions_v2.jsonl(9,844)，
全部为**规则合成数据**，且标签被反向编码进了特征：

- `data_generator.py` 的 TEMPLATES 把 label→(app_category, action_type, field) 固定成模板，
  例如 data_entry 的 field 100% 是 spreadsheet/cell
- `convert_scene_to_action.py` 的 pick_action_type/pick_field 按 label 白名单随机生成
- duration_ms / text_length / has_shortcut 也按 label 分支生成

模型只需背下 field×app_category 查表即可得高分，报告的 Accuracy 93% / Macro F1 0.93
反映的是"生成规则的可逆性"，不是真实泛化能力。

## 实验 1：去泄漏对照（2026-08-27）

命令：

```bash
python train.py \
  --data D:/workon/ml/data/simulated_actions.jsonl D:/workon/ml/data/scene_actions_v2.jsonl \
  --drop-cols field action_type \
  --output models_noleak/action_model_noleak.json
```

结果（同划分、同参数，仅剔除两个与标签函数性绑定的类别特征）：

| 模型 | 特征 | Accuracy | Macro P/R/F1 |
|---|---|---|---|
| 基准（训练时口径） | 全部 9 特征 | ~0.93 | ~0.93 |
| **本实验** | 去 field、action_type（剩 7 特征） | **0.7558** | 0.78 / 0.76 / 0.77 |

主要混淆（摘自 models_noleak/action_model_noleak_report.md）：
- search ↔ browse 双向大量互串（F1 0.62）
- manage 大量被判为 other/content 浏览（F1 0.62）
- code/write/communicate/data_entry 相对稳固（F1 0.80-0.96）

结论：
1. 剔除两个泄漏列后掉分 ~18pp，且仅剩的数值特征在合成数据里同样按 label 生成分支——
   **真实场景下的表现会进一步低于此对照值**
2. 二期用真实行为数据重训前，任何基于当前 v2 模型准确率的预期都视为无效

## 二期方向

1. 影子模式攒真实样本（recognition_log.jsonl → export_real_data.mjs）
2. 推荐目标体系改为 **13 态 WorkState 分类器**（--target state）而非旧 8 动作类，
   因为其可直接与规则引擎对表替换
3. uiohook 键鼠钩子接入后补齐 action_type/field 的真实事件源再重训

## 二期上线记录（2026-08-29）

- 行为探针（uiohook-napi）接入：recognition_log 的 featuresJson 自本日起为**真实特征**
  （action_type/has_shortcut 来自全局键鼠聚合；field/text_length 在 deepMode 下来自 UIAutomation 焦点元素）
- 此前所有样本的特征均为窗口采样占位值，重训时建议按 ts 过滤只取真实特征起点之后的数据
- 探针关闭（inputProbeEnabled=false）时回退占位特征，此类样本同样不宜入训

## 动作工坊运行时资产说明

- MediaPipe wasm：`npm i @mediapipe/tasks-vision` 后拷贝
  `node_modules/@mediapipe/tasks-vision/wasm/` → `src/renderer/public/mediapipe/wasm/`
- 姿态模型：pose_landmarker_lite.task（5.7MB）从 npm 镜像获取：
  `https://cdn.jsdelivr.net/npm/expo-pose-landmarker@0.1.1/android/src/main/assets/pose_landmarker_lite.task`
  放到 `src/renderer/public/mediapipe/`（两者均不入库，克隆后需手动补齐）
