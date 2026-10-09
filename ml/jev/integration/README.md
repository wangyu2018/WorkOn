# WorkOn-Jev 接入补丁说明

三个文件、四处改动。`base/` 是你仓库里的原文（2026-09-30 那版），`new/` 是改后版本，
`patches/*.patch` 是 `diff -u` 结果，`workon-jev-integration.patch` 是合并后的总补丁。

```bash
# 在 WorkOn 仓库根执行（先备份）
cd /path/to/WorkOn
patch -p0 --dry-run < ml/jev/integration/workon-jev-integration.patch   # 试跑
patch -p0 < ml/jev/integration/workon-jev-integration.patch
```

> 注意补丁里的路径是 `base/...` 与 `new/...` 前缀，直接 `patch` 需要按你本地路径调整
> （或用 `new/` 下的整份文件直接覆盖）。更稳妥的做法是拿 `new/*.ts` 覆盖对应文件后
> `npm run typecheck`。

---

## 1. `src/shared/stateMeta.ts` —— 必修，修的是一个静默失效

现状：

```ts
export const MODEL_LABEL_TO_STATE: Record<string, WorkState> = {
  code: 'coding', write: 'writing', data_entry: 'writing', search: 'focus',
  browse: 'focus', manage: 'focus', communicate: 'remote', other: 'focus'
}
```

而 `ml/models/label_classes.json`（v2/v3 模型实际输出）是：

```json
["aidev","aiqa","coding","idle","other","relax","slack","writing"]
```

两套 key 没有交集 ⇒ `MODEL_LABEL_TO_STATE[pred.label]` 恒为 `undefined` ⇒
`decision.ts` 里

```ts
if (pred && pred.prob >= MODEL_PROB_THRESHOLD) {
  const mapped = MODEL_LABEL_TO_STATE[pred.label]
  if (mapped) { state = mapped; ... }      // ← 永远进不来
}
```

**结论：`model_first` 模式从 v2 模型上线起就没生效过**，模型只在 `shadow` 里被记进
`recognition_log`。补丁把 WorkState key 补上（`coding → coding` 等），这一步做完
`model_first` 才会真正开始工作 —— 也正因如此，**上线前务必先看 `REPORT.md` 里的
「0.75 阈值处精确率」**，否则会从"模型完全没用"直接跳到"模型乱覆盖"。

---

## 2. `src/main/recognition/modelClient.ts` —— 换后端

| 项 | 旧 | 新 |
|---|---|---|
| 脚本 | `ml/predict_server.py` | `ml/jev/jev/serve/sidecar.py` |
| 模型目录判定 | 存在 `action_model_v2.json` | 存在 `model.int8.onnx`（或 `model.onnx`）且存在 `tokenizer.json` |
| 启动参数 | `--model-dir <dir>` | `--model-dir <dir> --mode fast --quiet` |
| 单条超时 | 500 ms | 3000 ms（`WORKON_JEV_TIMEOUT_MS`） |
| READY 超时 | 15 s | 90 s（`WORKON_JEV_READY_MS`） |
| 环境变量 | `WORKON_PREDICT_SERVER` / `WORKON_MODEL_DIR` | `WORKON_JEV_SERVER` / `WORKON_JEV_MODEL_DIR` |

新增 `predictFull(context, questions?)`，走同一个常驻进程，超时 8s（`WORKON_JEV_TIMEOUT_FULL_MS`）。
原有降级语义完全保留：任何失败 `resolve(null)`、崩溃冷却 5s 重启、连续 3 次失败停用。

---

## 3. `src/main/recognition/types.ts` —— 追加类型

`JevScenePrediction` / `JevAnswer` / `JevFullPrediction`，纯追加，不改动既有类型。

---

## 4. `src/main/recognition/decision.ts` —— 场景旁路缓存

```ts
refreshScene(input, features)      // 在激活屏路径上调用
export function getLatestScene()   // UI / 报表读取
```

刷新条件：`screen|app|title(前80字)` 变化 **且** 距上次刷新 ≥5s。
`void client.predictFull(...)` 异步执行，**不 await**，所以不会给采样主链路加延迟。
读不到就保持 `null`，调用方必须处理 `null`。

---

## 5. `package.json` 别忘了打包

```diff
     "files": [
       "out/**/*",
       "assets/**/*",
       "package.json",
+      "ml/jev/**/*",
       "node_modules/ws/**/*",
```

另外端侧需要 Python 环境：

```bash
pip install -r ml/jev/requirements-serve.txt    # onnxruntime + tokenizers + fastapi（约 25MB）
```

`ml/jev/model/model.int8.onnx` 约 0.6GB，如需再瘦可以只保留 int8 版本并删除 fp32 中间产物。

---

## 6. 回滚

三个文件都只改了逻辑不涉及数据迁移，`git checkout -- src/shared/stateMeta.ts
src/main/recognition/modelClient.ts src/main/recognition/decision.ts` 即可回到原状；
运行时会话里把 `recognitionMode` 设回 `shadow` 或 `rules` 也能立即止血。
