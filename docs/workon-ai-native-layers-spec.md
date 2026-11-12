# WorkOn · AI 原生分层界面与隧道 trace 设计

> 回答两个问题：多个 AI 原生形态如何共存（不靠页面切换）；L2 隧道如何接入现有能力插件（不靠插件改造）。
> **结论：切换靠纵深展开，接入靠执行层单点埋点。**

---

## 0. 先看结论

| 问题 | 结论 | 关键理由 |
|---|---|---|
| 四种形态都做，怎么切换 | 不做页面切换，做 L0/L1/L2 纵深展开 | 并列页签会退化回报表思维 |
| 数据怎么共享 | 单一事实源 + 新增一条 PipelineTrace 事件流 | 各层只读，不存副本，不各自算口径 |
| 隧道怎么接入能力插件 | 反向接入：插件执行时留痕，渲染器只读痕 | 唯一出口 `executeTool` 埋一层即全覆盖 |
| 插件会不会和形态绑定 | 不会。能力插件与渲染插件正交 | 层管呈现深度，插件管能力来源 |

---

## 1. 目标与非目标

### 目标

- 「今天」「计划」不再是固定仪表盘，而是 AI 按上下文生成内容的对话流。
- AI 的每一次处理（输入 → 路由 → 工具 → 模型 → 输出）可下钻查看，自动展示用到了哪些能力插件。
- 新增卡片类型、新增能力插件都不需要改动分层结构。

### 非目标

- 不做首屏全生成式布局（L1 之后才可能考虑）。
- 不做跨设备、跨用户的 trace 同步。
- 不把 trace 做成审计日志（不做全量原值留存）。

---

## 2. 分层模型

| 层 | 名称 | 职责 | 与用户的关系 |
|---|---|---|---|
| L0 | 一瞥层 | 一句话结论 + 状态呼吸，不占页面 | 永远在场，不打断 |
| L1 | 对话层（中枢） | AI 生成卡片流；今天 / 计划 / 回顾 = 三个开场上下文 | 主动使用 |
| L2 | 透视层 | 节点隧道：本次处理的完整过程 + 用到的插件 | 下钻查验 |
| — | 数据底座 | trail / 计划 / 归因 / 校对 + PipelineTrace | 只读，单一事实源 |

### 切换模型：纵深展开，不是路由

- 原则：**向下只有展开，向上只有收起，永远没有"跳到另一个页面"。**
- 「今天 / 计划 / 回顾」不是三个视图，是对话的三个**开场上下文**（预置数据快照 + 开场 prompt）。切页签 = 换话题，对话流本身连续。
- L2 不占导航位，只能从某张卡片的「查看过程」进入，并在同一窗口内展开。

```
L0 一句话结论
  ↕ 展开 / 收起
L1 对话流（生成卡：叙事卡 / 计划卡 / 风险卡 / 图表卡）
  ↓ 下钻（按 traceId）
L2 节点隧道（输入 → 路由 → 工具 → 模型 → 输出）
  ↑ 由 PipelineTrace 支撑
数据底座（trail · 计划 · 归因 · 校对 · trace）
```

---

## 3. 两类插件，正交

必须区分，否则会出现"做了什么形态就要配什么插件"的错误绑定。

| 类型 | 是什么 | 现有/新增 | 谁在用 |
|---|---|---|---|
| 能力插件 | Function Calling 工具（查轨迹、读写计划、天气等） | **现有**，`src/main/tools.ts` 的 `WORKON_TOOLS` | 所有层共用，与形态无关 |
| 渲染插件 | 卡片 renderer（叙事卡、计划卡、风险卡、图表卡） | 新增，统一注册表 | L1 按上下文选用，不按层绑定 |

- 一次回答调用哪些能力插件，由 LLM 决定，不由所在层决定。
- L2 只新增一个专用渲染器（隧道），它消费的是 trace，不是插件本身。

---

## 4. 数据设计

### 4.1 PipelineTrace schema

```ts
interface PipelineTrace {
  id: string                    // traceId：卡片与隧道共用的关联键
  parentId?: string             // 预留：多轮追问时挂到上一条
  ts: number
  source: 'qa' | 'today' | 'plan' | 'pet'

  input: {
    text: string                // 用户输入原文（截断 500 字符）
    keywords: string[]          // 隧道中流动的高亮词
  }

  route: {
    decided: 'llm' | 'local'    // 初始判定；失败回退时改写为 local
    reason?: string             // 回退原因，如 'no_api_key' / 'http_500' / 'round_limit'
    domain?: string             // 预留：域路由接入后填写，当前恒为空
  }

  rounds: Array<{
    round: number
    model: string
    toolCalls: Array<{
      name: string              // 能力插件 id，即渲染侧的关联键
      args: Record<string, unknown>   // 敏感插件经脱敏后写入
      ok: boolean
      ms: number
      resultPreview: string     // 截断 200 字符
      error?: string
    }>
  }>

  output: {
    text: string
    tokens?: number
    fallback?: boolean          // 走了 localAnswer 兜底
  }
}
```

### 4.2 三个挂载点

| 挂载点 | 现状 | 需要补什么 |
|---|---|---|
| `executeTool`（`src/main/tools.ts:215`） | 无埋点，是所有工具执行的唯一出口 | 外层包一个记录器：name / args / 结果摘要 / 耗时 / 成败，写入当前 trace 节点 |
| `chatWithToolLoopStream`（`src/main/ai.ts:459`） | 已有半成品钩子 `onToolCall?.(name)`（`ai.ts:538`），只传名字 | 扩为传完整事件：轮次、模型、本轮 tool_calls、是否最后一轮 |
| IPC（`src/main/ipc.ts:661`） | 只有 `ai:streamTool`，发 `{ tool }` | 新增 `ai:trace`（实时推送）与 `ai:getTrace`（按 id 拉取）；`ai:streamTool` 保留不动 |

非流式路径 `chatWithToolLoop`（`ai.ts:281`）同样经过 `executeTool`，因此**无需单独埋点**即可被覆盖。

### 4.3 通道

| 通道 | 方向 | 载荷 | 用途 |
|---|---|---|---|
| `ai:streamTool` | main → renderer | `{ tool: string }` | 现有"正在查询…"提示，保持不变 |
| `ai:trace` | main → renderer | 增量事件 `{ traceId, phase, payload }` | 隧道边跑边长 |
| `ai:getTrace` | renderer → main | `traceId` | 下钻时拉完整 trace |

增量事件 phase 取值：`input` / `route` / `round` / `tool` / `output` / `end`。

### 4.4 存储与生命周期

- P0：**内存 ring buffer，最近 50 条**，随应用退出清空。不落库。
- 隧道是"信任层"而非审计日志，只服务当前会话的下钻需求。
- 跨会话追溯（P2）作为可选项，需重新评估隐私成本后再定。

### 4.5 隐私边界

| 规则 | 说明 |
|---|---|
| `resultPreview` 截断 200 字符 | 全量结果只用于当轮 LLM，不进入 trace |
| 敏感插件脱敏 | 元数据表标记 `sensitive: true` 的插件，`args` 只保留字段名与值长度，不保留原值 |
| 原文截断 | `input.text` 截断 500 字符 |
| 不落盘 | P0 内存态，退出即清 |

### 4.6 降级

| 场景 | 隧道表现 |
|---|---|
| 本地直答（`localAnswer`，`ai.ts:778`） | 显示「本地直答，未调用外部插件」，并给出回退原因 |
| trace 缺失（旧数据 / 异常中断） | 显示「本次未记录处理过程」，不阻塞卡片本身 |
| 工具失败 | 该节点标为失败态并展示 `error`，其余节点照常渲染 |

降级路径本身是有价值的信息：它解释了"为什么这次答得这么快/这么慢"。

---

## 5. 隧道渲染器

### 5.1 插件识别方式

渲染器**不查询插件清单**，只做一次 `toolName → UI 元数据` 的查表：

```ts
// src/renderer/src/lib/toolUi.ts（拟新增）
const TOOL_UI: Record<string, { label: string; group: 'read' | 'write' | 'net'; sensitive?: boolean }> = {
  get_today_summary: { label: '今日轨迹', group: 'read' },
  create_plan:       { label: '写入计划', group: 'write' },
  get_weather:       { label: '天气',     group: 'net' },
  // ...
}
```

- 未登记的 `toolName` 降级显示原始 name，不报错。
- 在 `WORKON_TOOLS` 新增插件后，隧道下次自动就能显示，**因为 name 已经随 trace 落下来了**。这是"注册即被看见"，隧道侧不需要任何插件专用代码。

### 5.2 节点布局

一屏一条主线，最多 5 个阶段节点：

```
[输入] → [路由] → [工具 × n] → [模型] → [输出]
```

- 工具阶段在有多轮时按轮次分组，每个工具节点显示：显示名、耗时、成功/失败。
- 最多展示 8 个工具节点，超出折叠为「+n 个」。
- 失败节点使用状态色（语义色在此处合法，因为状态就是被编码的变量），其余节点保持中性 + 单一强调色。

### 5.3 关键词流动

- 来源：`input.keywords`，在路由阶段抽取一次（可复用 `extractPlanKeywords` 的既有逻辑）。
- 表现：词条沿主线移动；命中某次 `toolCall.args` 时该工具节点短暂高亮。
- P0 不做动画，仅以标签形式标注"该节点使用到的关键词"。

### 5.4 与卡片的关联

- 每张生成卡携带 `traceId`；「查看过程」按该 id 下钻。
- 一个 trace 可以对应多张卡（例如一次回答同时产出结论卡与图表卡），反向定位从隧道节点跳回卡片。

---

## 6. 生成卡协议

```ts
interface GenCard<P = unknown> {
  id: string
  kind: string                    // 注册表键
  props: P
  traceId?: string                // 来源可追溯
  evidence?: Array<{ type: 'trail' | 'plan' | 'fact'; ref: string }>
  ts: number
}
```

- 注册表：`registerCard(kind, renderer)`，静态映射为主，后续可扩展为开放注册以接入开源渲染件。
- 卡片必须满足其一：带 `traceId`，或显式声明"无工具来源"（本地计算/静态内容）。

---

## 7. 架构不变量

违反以下任一条即为设计退化：

1. 渲染层只读 trace，永不调用能力插件。
2. 能力插件不感知隧道的存在，不为其增加任何参数或返回值。
3. 生成卡必须可溯源：带 `traceId` 或显式声明无工具来源。
4. trail / 计划 / 归因 / 校对不复制，卡片只持有引用。
5. 层间只有展开与收起，没有页面路由跳转。
6. trace 只服务当下下钻，不做长期全量留存。

---

## 8. 分期落地

| 阶段 | 内容 | 验证什么 |
|---|---|---|
| P0 | `executeTool` 包装 + 内存 ring buffer + `ai:trace` 推送 + 纯文本隧道面板（无动画）+ 卡片 `traceId` 关联 | "展开卡片能看到过程"这件事成立 |
| P1 | `TOOL_UI` 元数据表、关键词高亮、耗时条、失败节点状态色 | 过程信息是否真的有用 |
| P2 | 落库与跨会话追溯、隧道 ↔ 卡片双向定位、流动动画 | 长期价值与视觉表达 |

P0 明确不做动画：先把数据链路和阅读价值验证掉，视觉是第二步的装饰。

---

## 9. 待拍板

| # | 问题 | 建议 |
|---|---|---|
| 1 | trace 是否跨会话保留 | P0 否，内存 ring buffer 即可 |
| 2 | `args` 落盘粒度：全量 / 截断 / 仅字段名 | 默认截断 120 字符，敏感插件仅字段名 |
| 3 | qa / pet / plan 三条入口是否共用同一 traceId 空间 | 是，便于统一隧道视图 |
| 4 | 隧道默认折叠还是默认展开一条摘要 | 默认折叠，仅显示一行「本次调用了 n 个插件」 |

---

## 10. 涉及文件

| 文件 | 变更性质 |
|---|---|
| `src/main/tools.ts` | 在 `executeTool` 外层加记录器，不改任何插件实现 |
| `src/main/ai.ts` | 扩展 `onToolCall` 回调载荷；`localAnswer` 回退处记录 `route.reason` |
| `src/main/ipc.ts` | 新增 `ai:trace`、`ai:getTrace`；保留 `ai:streamTool` |
| `src/preload/index.ts` | 暴露新通道 |
| `src/renderer/src/lib/toolUi.ts` | 新增：插件 UI 元数据表 |
| `src/renderer/src/stores/traceStore.ts` | 新增：trace 订阅与缓存 |
| `src/renderer/src/components/TraceTunnel.tsx` | 新增：隧道渲染器 |
| `src/renderer/src/lib/cardRegistry.ts` | 新增：生成卡注册表 |
