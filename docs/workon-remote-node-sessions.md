# WorkOn · 外部电脑接入（节点模式）与会话设计

> 需求：AI 能接入外部电脑 / 其他电脑上的能力，并把这些操作组织进会话。
> **结论：新增「节点模式」——外部电脑作为执行端出站连接主端，能力包装成普通能力插件，会话带 target。**

---

## 0. 先看结论

| 问题 | 结论 |
|---|---|
| 外部电脑怎么接 | 装 WorkOn 节点，出站 WebSocket 连回主端，配对码换 token |
| AI 怎么用远端能力 | 包装成普通 Function Calling 插件（`remote_*`），LLM 无感 |
| 会话怎么组织 | `chatSessions` 增加 `target`，按机器分组，换机器 = 换会话 |
| 怎么防误操作 | 节点侧三级授权（只读 / 写入 / 执行）+ 危险动作二次确认 + 全量 trace |

---

## 1. 目标与非目标

### 目标

- 主端 AI 能查询、操作另一台电脑：系统信息、文件、终端、进程/窗口、截屏，以及那台机器上的 WorkOn 轨迹。
- 远端操作与本地操作在会话、隧道里的体验一致：能看到用了哪台机器的哪个插件、耗时多少。
- 会话与目标机器绑定，切机器不串上下文。

### 非目标

- 不做完整的远程桌面串流（不替代 RDP / 向日葵）。
- 不做无人值守的公网暴露（节点永远出站，不监听公网端口）。
- P0 不做 UI 点击/输入类控制。

---

## 2. 现有底座

| 能力 | 现状 | 位置 |
|---|---|---|
| Agent Hook | 只监听 `127.0.0.1:18790`，只接收状态上报，无鉴权、不下发指令 | `src/main/agentHook.ts` |
| 本机采集 | 窗口 / UIA / OCR / 轨迹，全部本地 | `src/main/winInfo.ts` 等 |
| 能力插件 | `WORKON_TOOLS` + `executeTool` 单一出口，已带 trace 埋点 | `src/main/tools.ts` |
| 会话 | `chatSessions` 集合，已有 topic / projectId | `src/main/chatSessions.ts` |
| 处理轨迹 | PipelineTrace 内存 ring buffer，含工具名/耗时/成败 | `src/main/trace.ts` |

结论：插件层、会话层、trace 层都已就绪，**只缺一个远端执行端和一条 target 维度**。

---

## 3. 架构

```
主端 WorkOn（macOS / Windows）
  ├─ 会话（target = local | nodeId）
  ├─ AI 工具循环（WORKON_TOOLS）
  ├─ 能力插件：remote_exec / remote_files / remote_screen ...
  ├─ PipelineTrace（含 target）
  └─ 节点管理器（配对、心跳、重连）

        ▲ 出站 WSS（节点主动连接，NAT 友好）
        │
  ┌─────┴──────────────┬──────────────────┐
节点 A（另一台电脑）      节点 B
  ├─ 能力：终端 / 文件      ├─ 能力：终端 / 文件
  ├─ 能力：进程 / 窗口      ├─ 能力：截屏
  └─ 本机 WorkOn 轨迹       └─ 本机 WorkOn 轨迹
```

- 节点**只出站**，主端不监听公网端口。
- 局域网可直连；跨网走中继（可选，P2）。
- 节点可以是完整 WorkOn 的 headless 模式，也可以是独立 CLI 安装包。

---

## 4. 节点协议

### 4.1 配对

1. 主端生成一次性配对码（6 位，5 分钟有效）。
2. 节点输入配对码 + 主端地址，建立连接。
3. 主端下发长期 token（节点本地加密保存），记录节点指纹（机器名 / OS / 公钥）。
4. 之后节点凭 token 自动重连。

### 4.2 消息格式

```ts
// 主端 → 节点
interface RemoteRequest {
  id: string
  action: 'sys.info' | 'fs.list' | 'fs.read' | 'exec.run' | 'proc.list' | 'win.list' | 'screen.capture'
  args: Record<string, unknown>
  timeoutMs?: number
}

// 节点 → 主端
interface RemoteResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: string
  ms: number
}
```

- 请求带超时；节点侧对同一 action 限流。
- 节点主动上报心跳（10s）与能力变更事件。

### 4.3 能力清单

| action | 说明 | 授权级别 |
|---|---|---|
| `sys.info` | 机器名 / OS / 路径分隔符 / 已装工具 | 只读 |
| `fs.list` | 列目录（限白名单根目录） | 只读 |
| `fs.read` | 读文本文件（限大小、限白名单） | 只读 |
| `proc.list` / `win.list` | 进程与窗口列表 | 只读 |
| `screen.capture` | 截屏（可缩略） | 只读 |
| `fs.write` | 写文件（显式确认） | 写入 |
| `exec.run` | 执行命令（白名单前缀 + 工作目录限定） | 执行 |

P0 只开放「只读」一档。

---

## 5. 能力插件映射

远端能力不新建调度体系，直接注册成普通工具：

```ts
// 示例（P0）
{
  type: 'function',
  function: {
    name: 'remote_sys_info',
    description: '查看指定节点的系统信息（OS、路径、已装工具）',
    parameters: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }
  }
}
```

`executeTool` 内部分支到 `nodeManager.call(nodeId, action, args)`，返回值仍是 JSON 字符串。
**LLM 不需要知道“远端”这回事；隧道照常显示工具名、耗时、成败。** trace 增加 `target` 字段：

```ts
interface TraceToolCall {
  name: string
  target?: { kind: 'local' } | { kind: 'node'; nodeId: string; label: string }
  // ...其余不变
}
```

---

## 6. 会话模型

```ts
interface ChatSession {
  // ...现有字段
  target: { kind: 'local' } | { kind: 'node'; nodeId: string }
}
```

- 新建会话时确定 target，之后不可静默切换（切换需显式确认）。
- 会话列表按 target 分组：本机 / 节点 A / 节点 B。
- 注入上下文时附带目标环境摘要：OS、工作目录、可用能力，避免 AI 用错路径分隔符或命令。
- 历史会话在节点离线时仍可读，但发送前提示「目标节点离线」。

---

## 7. 权限与审计

| 层 | 规则 |
|---|---|
| 配对 | 一次性配对码 + token；节点指纹可撤销 |
| 授权 | 三档（只读 / 写入 / 执行），按节点单独设置，默认只读 |
| 确认 | 写入与执行类动作弹二次确认，展示完整命令与目标节点 |
| 范围 | 文件操作限白名单根目录；命令限白名单前缀 + 工作目录 |
| 审计 | 每次远端调用写入 trace（target / action / 参数摘要 / 耗时 / 成败），只保留最近 50 条 |

---

## 8. 分期

| 阶段 | 内容 | 验证什么 |
|---|---|---|
| P0 | 节点注册 + 出站连接 + `remote_sys_info` / `remote_fs_list` + 会话 target + 隧道显示 target | 链路通、权限模型站得住 |
| P1 | 终端执行（白名单）+ 二次确认 + 节点离线提示 | 实际能不能干日常活 |
| P2 | 截屏 / 窗口 / UI 点击输入 + 中继 + 多节点并行 | 产品后台控制类场景 |

---

## 9. 待拍板

| # | 问题 | 建议 |
|---|---|---|
| 1 | 节点形态：完整 WorkOn headless / 独立 CLI | 独立 CLI，体积小、好部署 |
| 2 | 跨网是否需要中继 | P2 再做，P0 只支持局域网直连 |
| 3 | 命令白名单默认值 | 按 OS 给一组保守默认（如 `git`、`npm`、`ls`/`dir`） |
| 4 | 会话 target 是否允许中途切换 | 允许，但必须显式确认并新开会话 |
| 5 | 是否复用 agentHook 端口 | 不复用；新端口 + 鉴权，agentHook 保持只收状态 |
