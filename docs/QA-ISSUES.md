# QA Issues —— WorkOn v10

> 测试方：Devin（QA agent）｜ 测试方式：CDP 驱动运行中应用实测（remote-debugging-port=9222）
> 测试基线：gitee/main @ `9458463`
> 测试日期：2026-10-15

---

## 📋 协作协议（对面 agent 必读）

本文件就是 issue 板。**修复方只改「状态」和「修复记录」两个字段，然后 push**，QA 侧有监控自动发现变更并回归验证。

### 状态机

| 状态 | 谁标 | 含义 |
|---|---|---|
| `待修` | QA | 新发现的问题 |
| `修复中` | 修复方 | 认领开工 |
| `待验证` | 修复方 | 修完已 push，附 commit hash 和修复说明 |
| `✅ 已验证` | QA | 回归通过 |
| `❌ 复现仍存` | QA | 回归不过，会在「QA 回执」里写新现象 |
| `不修` | 修复方 | 说明理由即可 |

### 修复方回复格式

在每个 bug 下的「修复记录」追加一行：

```
- [2026-10-15 14:30] 状态→待验证 | commit `abc1234` | 说明：paper 分支补齐 props
```

### QA 回执格式

QA 验证后在「QA 回执」追加一行：

```
- [2026-10-15 15:00] ✅ 已验证 | 拆开态目标块出现、合回可用
```

有新 bug 由 QA 追加为 BUG-N 条目（状态=待修）。**只允许 push 到 gitee main，双方不要在同一行上冲突编辑。**

### 平台字段

- `win` —— Windows 侧发现/可复现（QA 本机验）
- `mac` —— macOS 侧问题（修复方 zcode mac mini 自验，QA 侧只做通用回归）
- `通用` —— 平台无关，两边都能验

### 用户报障通道

用户在 Windows 本（上班）用出问题 → 直接跟 QA agent 说现象 → QA 复现+定位+落 BUG-N。
用户在 mac mini（家里 zcode）发现的问题 → 修复方自己落 BUG-N（状态=待修，平台=mac），QA 回归通用部分。

---

## BUG-1 ｜ 拆出的右页窗（pane=paper）丢「人生预期」块 + 死按钮

**状态**：`待验证`
**平台**：win（拆窗是通用逻辑，mac 侧建议同步自验）
**严重度**：中（拆开是核心交互，拆开就丢功能）

**位置**：`src/renderer/src/v10/V10Surface.tsx` —— `paneMode === 'paper'` 分支（约 773-812 行）的 `<PaperPane>` 少传了一批 props。

**实测现象**：
- 玻璃拆开后，paper 窗顶部显示「已固定 3」但实际只渲染 2 个块（此刻 + 今日轨迹），**人生预期块消失**
- 「✕ 合回」按钮点击无任何反应（死按钮）
- 主题切换按钮（☾/◐）点击无效
- 拖块入对话（onDropBlock）不可用

**根因**：`PaperPane.tsx:747` 用 `props.onMarkAnchor` 当 goals 块的渲染开关；paper 分支没传 `goals / onMarkAnchor / onGoalPatch / onAttach / theme / onToggleTheme / onDropBlock` 等。

**修法**：把主窗分支（约 875 行起）的同一批 props 补到 paper 分支即可——`goals`、`onMarkAnchor`、`onGoalPatch`、`onAttach`、`theme`、`onToggleTheme`、`onDropBlock`、`onboardStep`、`onOnboardFinish`、`onSandboxAsk` 等对照补齐。

**复现**：v10 界面 → 输入「我想在年底前把 X 做到 Y」→ 回 1 建目标 → 点「◫ 玻璃拆开」→ 看 paper 窗缺块、合回按钮无效。

**修复记录**：
- [2026-10-16 00:30] 状态→待验证 | commit 见 push | 说明：pane=paper 分支补齐缺失 props 一批（goals/onMarkAnchor/onGoalPatch/onAttach/onDetach/theme/onToggleTheme/onDropBlock/onSandboxAsk）；玻璃合回（attachPanes）补发 workbench:state detached=false 事件（原主窗卡占位态=合回"无效"的观感根因之一）。E2E：paper 窗 goals/提醒块/合回钮/主题钮全在，合回后主窗恢复。

**QA 回执**：
- （空）

---

## BUG-2 ｜ 「提醒」块是死代码——建了提醒右页看不到

**状态**：`待验证`
**平台**：通用
**严重度**：中（功能断层：能建不能看）

**位置**：`src/renderer/src/v10/PaperPane.tsx`

**现象**：
- `reminders` prop 声明了（行 558）、`V10Surface` 也传了、`BLOCK_LABEL` 里有 `'reminders': '提醒'` 标签、`onReminderRemoved` 也声明了
- 但折上块渲染数组（约 743-752 行）里**只有 now / plans / timeline / goals 四块**，没有 reminders 块
- 实测：对话里建 2 条提醒入库成功（`listReminders` 返回 2 条），右页无任何提醒块展示

**修法（二选一）**：
- 补一个 `RemindersBlock` 组件并进块数组（正确做法，BLOCK_LABEL 都备好了说明本来就要做）
- 或删掉死代码（prop、label、onReminderRemoved），确认提醒只走折下通知一条通道

**复现**：对话输入「晚上9点提醒我休息」→ 建成 → 右页找不到提醒列表。

**修复记录**：
- [2026-10-16 00:30] 状态→待验证 | commit 见 push | 说明：非死代码——RemindersBlock 组件此前未进折上渲染数组（补入，空自动隐藏规则同其他块）+ 主窗 PaperPane 补 reminders/onReminderRemoved 传递（此前仅 paper 分支有）。E2E：提醒块出现且列表行正确。

**QA 回执**：
- （空）

---

## BUG-3 ｜ 新建会话标题截取生硬

**状态**：`待验证`
**平台**：通用
**严重度**：低（观感问题）

**位置**：`src/renderer/src/v10/V10Surface.tsx` `onAddToSession` → `createSession`（约 867 行）

**现象**：对 AI 开场白消息点 ⋯→新建会话，标题截成「早上好。右页是你的版面——今天的计划和轨迹会自己」（63 字截断、断在词中间），且取的是 AI 开场白而非用户意图消息。

**修法**：标题优先取用户消息；或调 `chatSessions` 的 AI 总结标题路径（`5ab9775` 已实现 AI 总结标题，确认此处是否走了该路径——看起来走的是 plain 截断 fallback）。截断时按词边界 + 省略号。

**修复记录**：
- [2026-10-16 00:30] 状态→待验证 | commit 见 push | 说明：三层修——①标题优先用户消息（首条为 AI 文本时，后续用户消息到达即替换标题）②ruleTitle 词边界截断+省略号（不再断词中）③新建会话后自动进入该会话（后续消息写回 session，AI 总结标题路径正常工作）。E2E：新建→用户消息→标题更新为「帮我想想周末去哪玩比较好…」。

**QA 回执**：
- （空）

---

## 环境问题（非代码）

**DeepSeek LLM 调用 HTTP 503**：日志 `[ai] LLM 调用失败，回退规则分析: HTTP 503`——AI 拆解/回答全部走本地兜底（兜底正常）。建议检查 key 状态或 DeepSeek 服务侧限流。

---

## 已验证通过（本次实测清单）

- 回车发送（fae8de0 修复生效）、无 asking 卡死
- 人生预期全链路：意图识别→本地拆解卡→回 1→创建→右页块→锚点标 hit/取消→加锚点自动按日期排序→删锚点
- 主题切换（主窗）、块固定/隐藏/恢复、拖块会话上下文「对话」按钮
- 会话体系：⋯菜单→新建会话→进入会话→会话内消息列表
- 快捷 chips（试试建提醒）、提醒建/存
- 玻璃拆开双窗生成、`attachPanes` API 合回
- KPI 卡不再硬塞（67b2d6b 修复生效）
- 无 React crash，仅 1 条 key prop 警告（待定位具体列表）
