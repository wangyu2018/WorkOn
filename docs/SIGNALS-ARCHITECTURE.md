# WorkOn · 后台信号接入方案（signals）

> 回答：能不能查到后台的音乐 / 消息 / 会议 / 天气 / 文件，并集成到平台里。
> **结论：能，而且你已经有约 60% 的底座。** 缺的不是能力，是把它们收进一个统一的信号层。

---

## 0. 先看结论

| 能力 | 可行性 | 你已有的底座 | 增量 |
|---|---|---|---|
| 音乐（歌名/歌手/上一首下一首） | ✅ 高 | 窗口标题已在采（`winInfo.ts`） | 极小 |
| 项目文件夹更新 | ✅ 高 | **已实现**（`folderWatcher.ts` + chokidar） | 极小 |
| Everything 文件搜索 | ✅ 高 | koffi FFI 已在用 | 小 |
| 消息弹窗摘要 | ✅ 中 | `systemOcr.ts` + `desensitize.ts` | 中 |
| 天气 | ✅ 已有 | `weather.ts` | 极小（改定位） |
| 会议转写 | ⚠️ 中 | —（需新增本地 ASR） | 大 |
| 歌词 | ⚠️ 低价值 | UIA / OCR 可做 | 不建议 |
| 地图导航 / 公交查询 | ❌ 不建议 | — | 会破坏本地优先定位 |

**最要紧的一条：这些都不应该变成「集成功能」。**

每多一个「音乐插件」「地图插件」，就又回到 SaaS 臃肿。正确做法见 §4 —— 全部是**信号源**，只汇入一个建议引擎，**不新增任何 UI 类型**。

---

## 1. 你已经有的底座（实测盘点）

| 能力 | 现有实现 | 位置 |
|---|---|---|
| 窗口枚举 + **窗口标题** | `ForegroundWindowInfo.title` 已在采 | `main/winInfo.ts` |
| **UI Automation** | `getFocusedElement()` / `getForegroundUITree()` | `main/uia.ts` |
| 原生 FFI | koffi 已能 load `user32.dll` | `main/desktopPin.ts` |
| 屏幕 OCR | RapidOCR + Tesseract 双引擎 | `main/ocrEngine.ts` / `ocrWorker.ts` |
| 系统通知 OCR | 只读通知区 | `main/systemOcr.ts` |
| **隐私脱敏** | 12KB 的脱敏规则 | `main/desensitize.ts` |
| 文件夹监听 | chokidar | `main/folderWatcher.ts` / `dirWatcher.ts` |
| 天气 | 已接 | `main/weather.ts` |
| 全局键鼠钩子 | uiohook-napi | 依赖已装 |
| 视觉 | MediaPipe | 依赖已装 |

> **窗口标题这一条直接决定了音乐功能是「零成本」。**
> QQ音乐桌面版标题就是 `歌曲名 - 歌手名`，网易云同理。这个字段你已经在采了。

---

## 2. 逐项怎么做

### 2.1 音乐 —— 最容易，零新增采集

**三级递进，按需选：**

| 级别 | 做法 | 能拿到 | 成本 |
|---|---|---|---|
| L1 | `winInfo` 窗口标题 | 歌名 + 歌手 | **≈0**（数据已在） |
| L2 | `uia.getForegroundUITree()` | 歌名 + 歌手 + 播放进度 + 上一首/下一首按钮 | 1–2s/次（PowerShell 子进程） |
| L3 | 歌词面板 OCR | 歌词文本 | 慢、易错、**不建议** |

```ts
// main/signals/music.ts
const MUSIC_APPS = new Set(['QQMusic.exe', 'cloudmusic.exe', 'Spotify.exe', 'wmplayer.exe'])
const ARTIST_SEP = ' - '

export async function poll(): Promise<Signal | null> {
  const win = await getForegroundWindow()
  if (!win) return null
  const exe = basename(win.exePath ?? '')
  if (!MUSIC_APPS.has(exe)) return null            // 必须是前台，避免"开着没在听"
  const raw = win.title.replace(/\s*[-–]\s*$/, '')
  const [title, artist] = raw.split(ARTIST_SEP)
  if (!title || !/\S/.test(title)) return null      // 标题是空的/是菜单文案 → 不认
  return { id: 'music', kind: 'music', at: Date.now(),
           summary: `在听 ${title}${artist ? ' · ' + artist : ''}`, suggestable: false }
}
```

**注意 L1 的两个坑：**
- 必须判**前台**。音乐挂在后台时标题还在，但人不在听。
- 必须校验标题**不是菜单文案**（QQ音乐空播放时标题会变成界面文字）。用 `title.length` 和是否含分隔符双重判断。

**上一首 / 下一首**：发媒体键即可，零依赖。
`VK_MEDIA_NEXT_TRACK = 0xB0` / `VK_MEDIA_PREV_TRACK = 0xB1`（koffi 调 `keybd_event`）。

**产品定位：音乐不做成卡片，做成两件事**
1. **上下文抑制**：15:00–18:00 在听歌 → 建议引擎把打断阈值调高（"它知道你不想被打扰"）
2. **留痕**：「今天听了 3h12m，深夜 1:12 还在听」

> 歌词我建议**不做**。技术上能做（UIA 读文本节点），但它只能变成一个花哨的展示，偏离"看得见的专注"。

---

### 2.2 消息弹窗 —— 技术可行，隐私是红线

**能做，但只能读通知，不能读聊天。**

- 企业微信桌面版是 Electron/NW，**消息列表通常不在 UIA 树里** → 只能靠 `systemOcr.ts` 截通知区
- 个人微信（PC）同理，没有 UIA

**红线（必须写进产品约束）：**

| 允许 | 禁止 |
|---|---|
| 读系统 toast 的**标题 + 发送人 + 前 20 字** | 读聊天窗口正文 |
| 记录"有 3 条未读没回" | 记录消息全文并长期留存 |
| 把"未回"变成一条待办 | 把聊天内容写进知识库 |

**产品价值恰恰在"不打扰"这侧：**

> 下午 14:20 你在深度块，企业微信弹了 3 条你没回。
> 深度块结束后弹一次：「刚才 3 条消息没回，其中 1 条带 DWS 联调地址」→ `[加进今天]` `[标为已读]`

**你已经有 `desensitize.ts`（12KB）**，把它接到消息信号的出口，是现成的安全阀。

---

### 2.3 项目文件夹更新 —— 你已经做完了

`folderWatcher.ts` + `dirWatcher.ts` + chokidar 已经在跑。**缺的只是"把变更翻译成一句话"。**

```ts
// main/signals/files.ts —— 复用现有 watcher，只加一个出口
import { emit } from './index'

// 在现有 chokidar 回调里加：
if (isProjectBound(dir)) {
  const stat = { added, changed, removed }
  if (stat.added + stat.changed + stat.removed >= 3) {
    emit({ id:'file', kind:'file', at:Date.now(), suggestable:true,
           summary:`${project.name} 今天改了 ${n} 个文件`,
           data:{ ...stat, keyFiles: classify(changed) } })
  }
}
```

`classify()` 用项目关键词表（他们已有 `shared/industryVocab.ts`）标出「3 个是接口定义」。

**产出的建议最有价值的一条：**

> DWS 接口目录今天改了 7 个文件，其中 3 个是接口定义 ——
> 但项目进度还是 10%，待办没动。要把这次变更挂成一个待办吗？

**这是「代码在动但计划没动」** —— 纯看窗口标题永远发现不了，只有文件监听能发现。

---

### 2.4 Everything 文件搜索 —— 性价比最高

**两条接入路径：**

| 路径 | 做法 | 建议 |
|---|---|---|
| **HTTP Server API** | Everything 里开 HTTP Server（默认 8080），`GET /?search=xxx&json=1&count=10` | **先用这个**，零 native、零新依赖 |
| SDK DLL | koffi load `Everything64.dll`，调 `Everything_SetSearchW` / `Everything_Query` / `Everything_GetResultFullFileNameW` | HTTP 不够用时再上，koffi 已有 |

**它的价值是让建议从「说」变成「做」：**

> 你：「DWS 联调环境怎么配」
> 姵儿：搜 Everything → 找到 3 个文件
> 建议卡：「`D:\work\DWS\联调环境配置.md` 里有 2024-03 的步骤，要我打开吗」
> 采纳 → `shell.openPath()` + 在面板里开一个「文件」卡

**这正好补上 v9「建议可执行」的最后一环** —— 前面所有建议都要靠用户自己去找文件。

> ⚠️ 隐私提醒：Everything 会记录搜索历史，而你的搜索词往往等于工作内容。
> 建议：要么关掉 `Everything_Query` 的历史写入，要么在隐私页里说明"文件搜索会经过 Everything 索引"。

---

### 2.5 天气 —— 已有，改定位就行

`weather.ts` 已经有了。**它不该是一张卡片，应该只当建议的触发条件：**

| 条件 | 触发的建议 |
|---|---|
| 下雨 + 你 18:30 才下班 | 「下雨了，今天别下楼买饭」 |
| 降温 8℃ | 「外面 6 度，穿外套」 |
| 高温 + 高强度工作 | 「你今天坐了 4h，起来走两步」 |

天气是**背景条件**，不是**信息卡片**。这正是 v9 说的"不新增 UI 类型"。

---

### 2.6 会议记录 —— 值得做，但最重

**需要新增两块：**

1. **系统音频采集** —— Windows **WASAPI loopback**（录整个系统的声音，不开麦克风）
   Electron 主进程需要 native 模块：`node-native-recordloop`，或自己写 C++ addon
2. **本地转写** —— **Whisper**（`faster-whisper` / `whisper.cpp`），全本地

**为什么值得**：完全符合"本地优先"——录音和转写都不出本机。

**第一版不要做的**：说话人分离（diarization）。你已经有 MediaPipe 但那是体态不是人脸，diarization 是另一个量级的工作量。

**产出的卡片**（直接进 v9 面板）：

```
会议 · 2h14m            [置为焦点]
─────────────────────────────
你今天 4 场会，有效发言 38 分钟。
有 3 个决定只说了没记录：联调环境、证书续期、Oner 需求边界。
[把这 3 条立成待办]
```

**大坑**：会议录音是隐私敏感度最高的一项。必须：
- 录制前有明确系统托盘指示（红点常驻）
- 明确排除词（客户名/薪资/法务）走脱敏
- 一键删除录音原文

---

### 2.7 地图导航 / 公交 —— 我建议不做

**诚实结论：这是清单里唯一我建议砍掉的。**

- Windows 桌面端**没有**可用的导航 API。手机上的高德/百度导航在手机上，桌面拿不到
- 要做只能接高德/百度开放平台 Web API → 需要 key、需要联网、有配额
- 公交数据更是基本不开放

**这些会直接破坏"本地优先"的定位** —— 而这恰恰是你产品最值钱的地方。

**替代做法（用你已有的数据，反而更准）：**

> 你过去 14 个工作日都是 18:20 前后离开公司，通勤 40 分钟。
> 今天周五 + 外面下雨 → 「今天人多，要不要 18:00 走？」

这只需要 presence 的历史数据 + 天气 + 日历，**零外部依赖，零联网**。

---

## 4. 架构：signals 层（本方案的核心）

### 4.1 原则

> **信号源不产生 UI。它们只产出统一的 `Signal`，交给一个引擎决定要不要变成卡片或建议。**

这样做的三个好处：
1. **加一个信号源不用改任何 UI**（符合 v9「对话即界面」）
2. **UI 类型恒定为 7 种**，不会随集成数量膨胀
3. **引擎集中管隐私**：一个地方做脱敏、预算、冷却

### 4.2 目录

```
src/main/signals/
  index.ts      # 统一 Signal 流 + 注册表
  types.ts      # Signal / Action 定义
  engine.ts     # 判定：留痕 / 建议 / 上下文抑制
  music.ts      # winInfo 窗口标题（已有能力延伸）
  files.ts      # folderWatcher 出口（已有）
  search.ts     # Everything（HTTP / koffi）
  message.ts    # systemOcr + desensitize（只读 toast）
  weather.ts    # 已有
  meeting.ts    # 后期：WASAPI + Whisper
```

### 4.3 接口

```ts
// types.ts
export type SignalKind =
  | 'music' | 'message' | 'file' | 'search' | 'weather' | 'meeting' | 'app'

export interface Action {
  label: string
  run: () => Promise<void> | void     // 建议必须可一键执行
}

export interface Signal {
  id: string
  kind: SignalKind
  at: number
  summary: string                     // 一句话，用于留痕
  data?: unknown
  suggestable: boolean                // false = 只做上下文/留痕，不弹窗
  actions?: Action[]
}

export interface Source {
  kind: SignalKind
  start(): Promise<void> | void       // 注册监听
  stop(): Promise<void> | void
  poll?(): Promise<Signal | null>     // 事件源用
}
```

### 4.4 引擎（对应 v9 的弹窗三条硬规则）

```ts
// engine.ts
const IDLE_MS = 25 * 60_000
const DAILY_BUDGET = 4
const COOLDOWN_MS = 45 * 60_000

export async function ingest(sig: Signal) {
  pushCard(toCard(sig))                 // ① 留痕：永远进面板

  if (!sig.suggestable) {               // ② 音乐/天气只做上下文
    context.set(sig.kind, sig)
    applySuppression(sig)               //    例：听歌 → 抬高打断阈值
    return
  }
  if (!passes(sig)) return              // ③ 建议：四道闸门
  showPopup(toSuggestion(sig))
}

function passes(sig: Signal): boolean {
  if (idleFor() < IDLE_MS) return false                 // 你没停手
  if (!hasConsequence(sig)) return false                // 没有明确后果
  if (!acceptedBefore(sig.kind)) return false           // 你以前接受过同类
  if (budget.today() >= DAILY_BUDGET) return false      // 今日预算用完
  if (inCooldown(sig.kind)) return false                // 你刚关过
  return true
}
```

**这四道闸门 = v9 弹窗的"三条件 + 预算"。** 信号层和 UI 层各自只做自己的一半。

---

## 5. 性能约束（重要）

`uia.ts` 是 **PowerShell 子进程**，单次 500ms–2s。**绝对不能轮询它。**

| 信号 | 采集方式 | 频率 |
|---|---|---|
| 音乐（L1 窗口标题） | 进程内，常驻数据 | 随便用（跟随 presence 的 2s） |
| 音乐（L2 UIA） | 子进程 | **仅在 L1 拿不到时兜底，30s+** |
| 文件 | 事件 | 事件驱动 |
| 消息 | 事件（窗口切换 / 通知出现） | 事件驱动 |
| Everything | HTTP，本地 | 需求触发 |
| 天气 | HTTP | 30 分钟 |

**总原则：热路径只用进程内 API，UIA 只做低频兜底。**

---

## 6. 隐私红线（必须先定，否则后面会被追问）

1. **只读通知，不读聊天正文** —— 消息信号只取 toast
2. **原文明明是本地且可删** —— 所有 Signal 原文进本地 JSONL，隐私页可一键清除（你已有 `PrivacyView.tsx`）
3. **排除应用清单沿用现有机制**（`excludedApps` 已有）
4. **会议录音最高敏感** —— 托盘常驻红点指示录制中
5. **搜索词会进 Everything 历史** —— 隐私页必须说明
6. **每条 Signal 都要能回答**：「这条数据会变成什么 UI？变不成就别采」

> 判据很简单：**采了但不用 = 纯风险。** 不确定要不要采的信号，先别做。

---

## 7. 建议的落地顺序

| 阶段 | 做什么 | 为什么排这个位置 |
|---|---|---|
| **P0（1 天）** | 建 `signals/` 骨架 + 只接 **files** | 底座已有，验证整个架构，当天可见效果 |
| **P0（半天）** | 接 **music**（仅 L1 窗口标题） | 零新增采集，验证"信号→上下文抑制"链路 |
| **P1（1–2 天）** | 接 **search**（Everything HTTP） | 让所有建议能"直达文件"，v9 最后一环 |
| **P1（1 天）** | **weather** 改成建议触发条件 | 已有，纯粹改定位 |
| **P2（2–3 天）** | **message**（严格只读 toast） | 隐私风险最高，需要先定红线 |
| **P3（1 周+）** | **meeting**（WASAPI + Whisper） | 依赖最重，收益也最大，放最后 |
| **不做** | 地图 / 公交 / 歌词 | 破坏定位或无价值 |

---

## 8. 一句话总结

**你缺的不是采集能力，是把它们收成一个信号层。**

- 音乐、文件、天气：**数据已经在你手里了**，只是没接到建议引擎上
- 消息、会议：**能做，但要先把隐私红线写死**
- 文件搜索：**性价比最高的一个**，它让建议从"说"变成"做"
- 地图公交：**别做**，它会用联网和外部 API 换掉你最值钱的"本地优先"

做完 P0 之后，正确的验证方式：
**看一眼 `signals/index.ts`，应该只有几十行，加一个信号源就是加一个文件。**
如果变成了一个大而全的集成中心，方向就错了。

---

## 9. 前端呈现（已在原型里做出来）

信号跑起来之后，**前端只有两种去处**，不新增第三种：

### 9.1 弹窗：4 种语气，同一套交互

四种信号共用一套弹窗机制（5 秒收胶囊 / 不叠加 / 关掉 45 分钟冷却），
**只靠顶部一条色带区分语气**，一眼分清是什么事：

| 语气 | 色带 | 场景 | 特征 |
|---|---|---|---|
| 工作建议 | 橙 `--warn` | 该你做决定 | 有依据、有两个决策按钮 |
| 音乐 | 蓝 `--focus` | 我注意到你在听 | **不打断**，是陈述不是要求 |
| 快捷操作 | aura 紫 | 你重复做的事 | 帮你省事 |
| 会议 | 绿 `--ok` | 会后有产出 | 有决定可一键落地 |

**关键：听歌时工作建议会被延后**，但**仍然送到**。弹窗里挂一条：

> 🎵 听歌中 · 已延后，深度块结束后一起给你

这是"它知道你在，只是不打断"和"它没看见你"的分界线。

### 9.2 卡片：3 种新增类型

沿用 v9 的卡片结构（类型标签 → 一句判断 → 解释 → 结构化字段 → 行动）：

| 卡片 | 核心结构 | 关键设计 |
|---|---|---|
| **音乐** | 唱片 + 均衡器动效 + 今天累计/同类上周 | 结论不是"你在听歌"，而是「这 34 分钟里 DevTool 一次都没拿到焦点」 |
| **快捷操作** | 3 步 × `×3` 徽标 + 「下次只说这句话」 | **给出那句话本身**，而不只是记录 |
| **会议** | 发言占比 + 3 个决定（每个带动作）+ 逐字稿片段 | 逐字稿里把关键句 `<em>` 高亮，**让人看到证据而不是结论** |

### 9.3 弹窗动作会直接长出卡片

点弹窗上的「记进今天」/「立成待办」→ 对应卡片**当场进面板并高亮 1.4 秒**。
这闭环了"建议可执行"：建议不只是执行了一个动作，还**留下了一个可回看的记录**。

### 9.4 信号源状态可见

模块抽屉顶部有「信号源 · 采集层」区块，6 个源各自显示 运行中/已关闭、采集方式、当前值。

**这条对应隐私原则**：「采了但不用 = 纯风险」——用户能一眼看到**哪些东西在被采集**，
而不是只能去设置里猜。

---

## 10. AI 会话完成信号（本机实测，2026-09-29）

需求：各个 AI coding 工具写完了，实时反馈 + 弹窗。

**我扫了你这台机器的实测结果**（`C:\Users\72830`）：

| 工具 | 会话文件 | 完成信号 | 实测 |
|---|---|---|---|
| **Claude Code** | `~/.claude/projects/<路径编码>/<uuid>.jsonl` | 最后一条 `type:"assistant"` 且 `message.stop_reason === "end_turn"` | ✅ 已验证 |
| **Codex** | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` | `{"type":"event_msg","payload":{"type":"task_complete"}}` | ✅ 已验证 |
| **Cursor** | `%APPDATA%/Cursor/User/workspaceStorage/<hash>/state.vscdb` | SQLite 里的 `composer` 状态 | ⚠️ 需要 SQLite reader |

机器上还装着：Trae CN、TRAE SOLO CN、CodeBuddy CN、VS Code、ZCode、opencode、kilo、mimocode。

### 10.1 Claude Code —— 零成本，最干净

实测你最新的一个会话（106 行）：

```
type 分布：assistant ×33  user ×19  attachment ×17
           queue-operation ×6  ai-title ×5  atis-latch ×5  last-prompt ×5
```

**33 条 assistant 消息全部带 `stop_reason`**，末尾一条长这样：

```json
{"type":"assistant","message":{
  "stop_reason":"end_turn",
  "usage":{"input_tokens":4568,"cache_read_input_tokens":35456,
           "output_tokens":357,"output_tokens_details":{"thinking_tokens":0}}}}
```

所以判定是**完全确定的**，不需要任何猜测：

```ts
// main/signals/ai-claude.ts
import { watch } from 'chokidar'
import { homedir } from 'os'
import { join } from 'path'

const ROOT = join(homedir(), '.claude', 'projects')
let lastTurn: string | null = null

watch(ROOT, { depth: 4 })
  .on('change', async (file) => {
    if (!file.endsWith('.jsonl')) return
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    const last = lines[lines.length - 1]
    if (!last) return
    const e = safeParse(last)
    if (e?.type !== 'assistant') return
    if (e.message?.stop_reason !== 'end_turn') return   // tool_use 说明还在干

    if (lastTurn === e.message.id) return               // ② 防重复弹
    lastTurn = e.message.id

    emit({
      id: 'ai', kind: 'ai', at: Date.now(), suggestable: true,
      summary: 'Claude Code 写完了',
      data: {
        tool: 'Claude Code',
        sessionId: e.sessionId,
        cost: `${Math.round((e.message.usage.output_tokens ?? 0) / 100) / 10}k out`,
        // ① 改哪些文件 = 这段时间内 cwd 下 .git 变更
        files: await diffSince(turnStart),
        // AI 的最后一句话，作为卡片标题
        headline: e.message.content?.at(-1)?.text ?? ''
      }
    })
  })
```

**关键点**：`stop_reason` 会区分 `end_turn`（说完了）和 `tool_use`（还在调工具）。
**只在 `end_turn` 弹** —— 不会在它干活的时候骚扰你。

### 10.2 Codex —— 更明确，有专门的完成事件

```
type 分布：event_msg ×3  response_item ×3  session_meta ×1  turn_context ×1
```

```json
{"timestamp":"2026-07-09T02:45:13Z","type":"event_msg",
 "payload":{"type":"task_complete","turn_id":"019f44c2-…",
            "last_agent_message":"…"}}
```

**直接就是 `task_complete` 事件**，比 Claude Code 还干净。另有
`~/.codex/session_index.jsonl` 可以直接读会话列表（工具名、时间、id）。

### 10.3 Cursor —— 唯一的麻烦：需要 SQLite reader

实测：`state.vscdb` 492KB，二进制里能命中 `composer`(65) / `status`(121) / `workbench`(193) / `aichat`(3)。

**但值是序列化的，grep 只能拿到 key 名，拿不到可用内容。** 而且你机器上**没装 sqlite3 CLI**。

三个选项：

| 方案 | 代价 | 评价 |
|---|---|---|
| **`sql.js`（wasm，只读）** | ~1MB，零 native 编译 | **推荐**。你已经打包了 draco / mediapipe / tesseract 的 wasm，wasm 加载是现成问题 |
| `better-sqlite3` | 需要为 Electron 33 重编译 | 重，且每次升级 Electron 都要重编 |
| koffi 加载 `sqlite3.dll` | Windows 默认没有这个 dll | 不可行 |

```ts
import initSqlJs from 'sql.js'
const SQL = await initSqlJs({ locateFile: (f) => join(__dirname, f) })
const db = new SQL.Database(readFileSync(dbPath))
const st = db.prepare(
  "SELECT value FROM ItemTable WHERE key LIKE 'composer%' ORDER BY rowid DESC LIMIT 1")
// value 是 JSON，里面有 bubble / status 字段 —— 具体结构要实测后确认
```

> ⚠️ Cursor 的 `composer` 内部结构**会随版本变**，解析前必须拿真实 vscdb 试。
> 建议：先只做 Claude Code + Codex（零风险），Cursor 放到后面并做**降级**——
> 读不出来就静默跳过，绝不猜。

### 10.4 实时反馈长什么样

**不只在弹窗，运行中就要看得见。** 面板顶部一条常驻状态条：

```
┌──────────────────────────────────────────────────────────┐
│ ⟳ Claude Code  38s  ▓▓▓▓▓▓░░░░░░░░  正在改 winInfo.ts · 你可以先去做别的 │
└──────────────────────────────────────────────────────────┘
```

- **秒级计时** + 跑马灯进度（不做假百分比，只是"还在动"）
- 右端那句话是**明确许可**：「你可以先去做别的」
- 跑完自动消失，同时弹窗

这条解决了 AI 工具最大的问题：**你不知道它还在跑还是卡了。**

### 10.5 完成的卡片：改了什么最重要

```
┌ AI 会话 · 它写完了 ─────────────────────────────────────┐
│ winInfo 加节流，改完了                                     │
│ 你在 14:32 把它交给 Claude Code，2 分 14 秒写完。            │
│ 期间你切去了 Slack 和微信，没盯着屏幕。                      │
│                                                            │
│ src/main/winInfo.ts        +48   -12                       │
│ src/main/uia.ts            +23   -0                        │
│ docs/UI-DESIGN-SPEC.md     +310  -180                      │
│                                                            │
│ 改完了。winInfo 那里我加了 setInterval 来节流，2 秒一次     │
│ 够用了 —— 不用动 presence 的心跳。uia.ts 是 PowerShell      │
│ 子进程，我没碰。                                            │
│                                                            │
│ 2m14s · 你离开屏幕 1m48s │ 4.2k out · 读 35.5k 缓存命中高  │
│                                                            │
│ [接下一句] [看 diff] [不看这个]                              │
└────────────────────────────────────────────────────────────┘
```

**三个设计决定：**

1. **diff stat 放最上面** —— 用户要判断的第一件事是"它动了什么"
2. **AI 的最后一句话原样引用**，不摘要 —— 摘要会丢掉它没说清楚的地方
3. **「你离开屏幕 1m48s」** —— 这是 WorkOn 独有的数据，别人给不了。
   它把"派活给 AI"变成了**真的异步**，而不是你守着屏幕等

### 10.6 落地顺序

| 阶段 | 做什么 | 风险 |
|---|---|---|
| **P0（半天）** | Claude Code —— chokidar + 解析 `stop_reason` | 极低，格式稳定 |
| **P0（半天）** | Codex —— `task_complete` | 极低 |
| **P1（1 天）** | 实时状态条 + 完成弹窗 + 结果卡 | 中，涉及渲染层 |
| **P2** | Cursor + sql.js 读 vscdb | 中，**结构会变，必须降级** |
| **P3** | Trae / CodeBuddy / opencode 逐个试 | 每个都要单独确认路径 |

**建议：先只做 Claude Code + Codex 这两个。** 它们是纯文本追加，
chokidar 一挂就完事，零依赖，零风险。先把"写完了弹窗"这件事跑通，
再一个一个加别的工具 —— 宁可少支持两个，也不要用一个不稳的解析去打扰用户。

---

## 11. 调度台：WorkOn 给 AI 编程工具派活（本机实测）

这是从「记录工具」变成「调度台」的一步。**它不是新功能，是同一个能力的下半段。**

### 11.1 两种模式，缺一不可

| | 看模式（已做） | 派模式（本节） |
|---|---|---|
| 你在干什么 | 在终端里手打 | **在 WorkOn 里下指令** |
| WorkOn 干什么 | 监听 jsonl，写完弹窗 | **spawn 子进程，喂 prompt，等结果** |
| 前提 | 你得自己开终端 | **你什么都不用开** |
| 适用 | 探索、交互式调试 | **重复性任务、异步、并行** |

### 11.2 两个 CLI 都实测支持无头 + 流式

**在你这台机器上实测的**：

```powershell
# Claude Code —— C:\Users\72830\.local\bin\claude（246MB 单文件）
claude -p "<prompt>" --output-format stream-json --add-dir D:\AI\WorkOn\workon
# 另有：--input-format（管道输入）/ -c --continue（续接）/ --resume / --append-system-prompt

# Codex —— C:\Users\72830\AppData\Roaming\npm\codex.ps1
codex exec "<prompt>" --json -C D:\AI\WorkOn\workon -s workspace-write
# 另有：-m --model / -C --cd / -s --sandbox（read-only / workspace-write / danger-full-access）
```

`--output-format stream-json` 意味着**它做了什么是流式吐出来的**，
不用等结束才知道进度 —— 这正是实时条能画出来的原因。

### 11.3 派活的实现

```ts
// main/dispatch/runner.ts
import { spawn } from 'child_process'

export interface Job {
  id: string
  tool: 'claude' | 'codex'
  cwd: string
  prompt: string
  startedAt: number
  steps: { text: string; state: 'run' | 'ok' | 'err' }[]
  result?: { headline: string; files: FileDiff[]; cost: string }
}

export function run(job: Job, onEvent: (e: JobEvent) => void): ChildProcess {
  const cmd = job.tool === 'claude'
    ? ['claude', '-p', job.prompt, '--output-format', 'stream-json', '--add-dir', job.cwd]
    : ['codex', 'exec', job.prompt, '--json', '-C', job.cwd, '-s', 'workspace-write']

  const p = spawn(cmd[0], cmd.slice(1), {
    cwd: job.cwd,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' }     // 去掉 ANSI，颜色由前端决定
  })

  let buf = ''
  p.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {        // 逐行 JSONL
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      try { onEvent(mapEvent(job, JSON.parse(line))) } catch { /* 忽略无法解析的行 */ }
    }
  })
  p.on('close', (code) => onEvent({ type: 'close', code, files: diffSince(job.startedAt) }))
  return p
}
```

`diffSince(startedAt)` 建议直接用 git：

```ts
import { execFile } from 'child_process'
const diffSince = (since: number) => new Promise<FileDiff[]>((res) => {
  execFile('git', ['diff', '--numstat', 'HEAD', '--', '.'], { cwd, maxBuffer: 1 << 20 },
    (e, out) => res(parseNumstat(out)))          // → [{file, +n, -n}]
})
```

**这比解析 AI 的自述可靠得多** —— 它改了什么，文件系统知道，不用猜。

### 11.4 实时条要显示真实命令

原型里那行不是装饰：

```
⟳ Claude Code  38s  ▓▓▓▓▓▓░░░░░░░░
  claude -p … --output-format stream-json --add-dir D:\AI\WorkOn\workon · 正在读 winInfo.ts
```

**为什么显示命令行**：因为"派活"意味着 WorkOn 在你不知情的时候执行代码。
让用户随时能看见**到底跑了哪条命令**，是这条功能唯一能成立的前提。

### 11.5 危险边界（这条功能的前提）

> **派活 = 自动执行代码。** 这不是 UI 问题，是安全问题。做之前必须先定死：

| 规则 | 说明 |
|---|---|
| **默认受限** | claude 用受限 permission mode，codex 用 `-s workspace-write`。**绝不开 `--dangerously-skip-permissions` 或 `danger-full-access`** |
| **每个任务可审** | 结果卡必须展示 diff，没看过 diff 不算完成 |
| **失败必须响** | 非 0 退出码 / 解析失败 → 红色弹窗，不能静默 |
| **有队列和并发上限** | 同时最多 2 个 worker，避免把机器打满 |
| **可中止** | 每个进行中的活都必须能一键 kill（`child.kill()`） |
| **能撤回** | 3 秒内可一键 `git checkout --` 回滚这次改动 |
| **白名单 cwd** | 只允许在已绑定项目的目录里派活，不接受任意路径 |

**UI 上必须有的三样**：真实命令行、一键中止、diff + 一键回滚。
少一样，这个功能就不该上线。

### 11.6 桌面监控 + 控制

一个卡片装下所有"在跑的 + 能控的"：

```
┌ 桌面 · 正在发生什么 ─────────────────────────────────┐
│ 🤖 Claude Code   D:\AI\WorkOn\workon · 刚接活  📌 [看进度] │
│ 🎵 QQ音乐  雨天·南拳妈妈 00:41/04:12   [◀◀][▶❚❚][▶▶] 🔊62% │
│ 📹 腾讯会议  00:24:11 · 正在录音（托盘红点）   [会后转录]  │
│ 💬 企业微信  3 条未读 · 只读通知摘要        [立成待办]  │
│ ─────────────────────────────────────────────────────│
│ [派给 Claude Code] [派给 Codex] [开新 worker]              │
└──────────────────────────────────────────────────────────┘
```

| 能力 | 实现 | 成本 |
|---|---|---|
| 进程列表 | `EnumWindows` + `IsWindowVisible`（`desktopPin.ts` 已有 koffi 样板） | 极小 |
| CPU / 内存 | koffi `OpenProcess` + `GetProcessTimes`，或 `tasklist /FI` | 小 |
| **音乐控制** | koffi `keybd_event`：播放/暂停 `0xB3`、下一首 `0xB0`、上一首 `0xB1` | **≈0** |
| 音量 | `uia.ts` 已有音量元素，直接 `InvokePattern` | 极小 |
| **固定会话** | 会话 id 存本地，钉住的会话**写完必弹**，不受冷却影响 | 小 |

> 📌 图钉是"固定会话"：**钉住的会话不遵守 45 分钟冷却**。这是用户显式声明的
> 「这个我一定要知道」，比默认策略优先级高。

### 11.7 落地顺序

| 阶段 | 做什么 | 风险 |
|---|---|---|
| **P0（半天）** | 进程列表 + 音乐媒体键控制 | 极低，纯读 + 发键 |
| **P1（1 天）** | 派活骨架：spawn + stream-json 解析 + 实时条 | 中，**但必须同时做完 §11.5 的安全项** |
| **P1（1 天）** | diff stat + 一键回滚 + 一键中止 | 中，安全底线 |
| **P2** | 固定会话、并发队列、中止策略 | 低 |
| **P3** | 同一句派给两个工具比对结果 | 低，**这是 WorkOn 独有的价值** |

**最后一条值得单独说**：同一句需求派给 Claude Code 和 Codex 各做一版，
并排 diff 让用户选 —— 这件事只有 WorkOn 能做，因为它同时握着两边的结果、
你的 diff、和你过去对两者的历史评价。

**没有任何一个 AI 编程工具能提供这个。** 这就是调度台形态的意义。

---

## 12. 接管：问一次，然后记住

### 12.1 正确的形态是"请求"，不是"注入"

「接管」这个词听起来危险，但**危险的不是能力，是未经同意**。

所以这个功能的核心不是技术，是**许可模型**：

```
检测到应用在前台
   ↓
弹一次（而不是偷偷拿）
┌──────────────────────────────────────┐
│ 🤖 姵儿 · 接管请求            ✕     │
│ 我看到你开着 QQ音乐                    │
│ 依据 · 前台 12m · 今天第 3 段 · 你还没给过我控制权 │
│ [接管音乐控制]  [不管]        别再问我 │
└──────────────────────────────────────┘
   ↓ 是                              ↓ 否
写进偏好，永不再问              写进偏好，永不再问
```

**两个分支都写进偏好。** 这是关键：
- 答"是" → 一次性授权，不再问
- 答"否" → **永久不再问这个应用**

**只有问过一次的应用才允许采集。** 没问过的应用，我只知道"它开着"（进程存在），
不读它的窗口内容、不读它的通知。这条规则写死在代码里，不是设置项。

### 12.2 逐应用开关

```
┌ 应用控制中心 ─────────────────────────────────────┐
│ QQ音乐      已接管  雨天·南拳妈妈  [◀◀][▶❚❚][▶▶] 🔊 │
│ 企业微信    已接管  3 条未读 · 只读通知摘要  [转待办] │
│ Claude Code 已接管 空闲                [派活] [中止] │
│ 飞书        未接管  开着，但我完全不碰它   [接管]   │
│ 浏览器·抖音  不接管  只记「你在刷」       [为什么]  │
│ ──────────────────────────────────────────────────│
│ ✓ 接管状态只存本地，一键可收回；收回后立刻停止读取    │
└─────────────────────────────────────────────────────┘
```

| 应用 | 接管后我能做什么 | 实现 | 成本 |
|---|---|---|---|
| QQ音乐 / 网易云 | 读歌名歌手、播放状态；发媒体键控制 | 窗口标题 + koffi `keybd_event`（`0xB3/0xB0/0xB1`） | **≈0** |
| 企业微信 / 微信 / 飞书 | **只读系统通知摘要** → 转待办 / 延后送达 | `systemOcr.ts` + `desensitize.ts`（已有） | 小 |
| AI coding 工具 | 派活、实时进度、中止、回滚 | §11 | 中 |
| 会议软件 | 录制指示、会后转录 | §2.6 | 大 |
| 浏览器 | **只认得它开着，不读页面** | 进程枚举 | ≈0 |

**「只读通知摘要」这条不能松。** 企业微信是 Electron 应用，聊天列表通常不在 UIA 树里，
理论上也只能靠 OCR 通知区 —— 但产品上必须写死"不碰聊天正文"，并在隐私页逐项可见。

### 12.3 我不建议做的三件事

> 这三条不是技术做不到，是**做���会把产品送走**。

**① 视频去广告（"接管无广"）**

去广告是绕过平台的营收机制。这不是隐私问题，是**商业和法律问题**。
而且对一个 AI 大赛作品来说，**带去广告能力是明确的减分项** —— 评委看到的第一反应
不是"技术真好"，是"这人在想什么"。

> 痛点是真实存在的（广告打断专注），但你的解法应该是：
> 检测到全屏自动播放 → 提示进入深度块 → 深度块期间屏蔽一切非白名单通知。
> **你已经有 `slackAutoHide` 和防分心模块，这个需求本来就不需要注入任何东西。**

**② 抖音 / 微博 页面注入 + 记录**

这是在采集**第三方用户的公开内容**，不是你自己在看的页面。

| 风险 | 说明 |
|---|---|
| 个人信息合规 | 爬到的是别人的账号、评论、位置，主体不是你 |
| 平台 ToS | 明确禁止自动化采集 |
| 工程脆 | 网页改版一次就坏，抖音的接口风控也很严 |
| **和你的产品定位冲突** | 「看得见的专注」不是「看得见别人的微博」 |

> **但你的真实需求已经被满足了**：你打开抖音 → `winInfo` 已经在采窗口标题和进程
> （`presence.ts` 就在做这件事）→ 连续 40 分钟 → 弹一次
> 「你已经刷了 40 分钟抖音，要停一下吗」。
>
> **这 90% 的价值，0 风险，0 额外工程量**，因为你早就有了底层能力。
> 而"记录你在看的每条内容"对"看见自己的专注"没有任何增量。

**③ 往别的进程注入代码（DLL injection）**

这是安全软件直接拦截的行为，可能导致你的应用被 Defender 拦、被杀软报毒。
在企业环境里这甚至违反 IT 政策。

**你已经有 koffi，能做很多事，但注入是那条线。** 所有上面的能力
（窗口标题、UIA、媒体键、进程枚举、文件监听）**全部不需要注入**。

### 12.4 判据

> **如果你需要向别人解释"我为什么要读这个"，那多半就不该读。**

三条判断：
1. **数据主体是谁？** 是你自己在看的东西 → 可以。**是别人的内容 → 不行。**
2. **有没有更轻的办法拿到同样的信息？** 窗口标题能解决就不要 OCR，
   OCR 能解决就不要读 UIA 树。
3. **不读会不会导致这个功能做不成？** 如果不会，那就不读 —— 最小权限原则。

### 12.5 落地

| 阶段 | 做什么 | 风险 |
|---|---|---|
| **P0（半天）** | 接管许可模型 + 逐应用开关 + 隐私页可见 | 极低 |
| **P0（半天）** | 音乐媒体键（koffi `keybd_event`） | 极低 |
| **P1（1 天）** | 通知摘要 → 待办（只读 toast） | 中，**红线要写死** |
| **P2** | AI coding 派活（见 §11） | 中，安全项同 §11.5 |

**先把许可模型做出来，再接任何一个能力。** 顺序反了就会变成"先偷偷读，再补一个开关"。

---

## 13. 消息：通知摘要 + 双击跳转

这是**所有"接管"里最站得住脚的一个**。理由：

- 读的是 **Windows 通知区已经显示给用户的那段摘要** —— 用户自己也能看到
- 跳转只是**激活一个窗口** —— 不注入、不读内存、不改任何东西
- 用户本来就要去回消息 —— WorkOn 只是省了他切换的那一下

### 13.1 界面

```
┌ 消息 · 你不用过去看 ────────────────────────────────┐
│ 读的是 Windows 通知区已经显示的那段摘要，不是读你的聊天记录。│
│ ⚡双击 = 切到对应 App · 单击 = 展开全文                 │
│ ┌───────────────────────────────────────────────┐ │
│ │ 李明  [微信]                          14:22     │ │
│ │ DWS 那个联调环境你配好了吗？我这边等着联调，       │ │
│ │ 老李说他今天能搞定。                              │ │
│ │ [回消息] [复制原文] [立待办]                       │ │
│ └───────────────────────────────────────────────┘ │
│ ┌───────────────────────────────────────────────┐ │
│ │ DWS 项目群(3) [微信] @我                 14:19     │ │
│ │ @周工 证书的事老李说他今天搞定，你那边记得 周五前 │ │
│ │ 把环境推上去。                    [回消息] [复制原文] │ │
│ └───────────────────────────────────────────────┘ │
│ ✓ 来源是 Windows 通知区，不是读聊天窗口。              │
│   收回「消息」接管后，这里立刻停止更新。                 │
│ [全部延后] [屏蔽这个群]                                │
└───────────────────────────────────────────────────┘
```

四个设计决定：

1. **标题是「你不用过去看」** —— 说清了这个功能省的是什么
2. **@我的那条要能一眼挑出来** —— 不是所有消息都同等重要
3. **摘要天然被通知截断** —— 正好符合"只看摘要"，不需要自己再截
4. **底部明写来源** —— 「不是读聊天窗口」这句话必须一直挂在卡片上

### 13.2 采集：UIA 优先，OCR 兜底

**你已经有的**：`systemOcr.ts` 用 `Windows.Media.Ocr`（系统自带）+ RapidOCR/Tesseract 兜底。
**你缺的**是"去哪儿看、什么时候看"，不是 OCR 本身。

两条路，**优先级不能反**：

| | UIA 读 toast（首选） | OCR 截通知区（兜底） |
|---|---|---|
| 拿到什么 | **结构化**：`ControlType.Text` 的"发送人"和"正文"是**两个独立节点** | 一坨混在一起的文本 |
| 能不能分清谁发的 | 能 | **不能**，要靠正则猜 |
| 耗时 | 300–800ms（PowerShell 子进程） | 800ms+ 截图 + 识别 |
| 你的底座 | `uia.ts` 已有 PS 脚本框架 | `systemOcr.ts` 已有 |
| 代码量 | 加一个 `FromHandle` + 走子节点 | 加一个区域坐标 |

```ts
// main/signals/notify.ts —— UIA 路线
const PS = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
# toast 由 ShellExperienceHost / Windows.UI.Core.CoreWindow 承载
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Windows.UI.Core.CoreWindow')
$toast = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if (-not $toast) { 'null'; exit }
$texts = $toast.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition) |
  Where-Object { $_.Current.ControlType -eq
    [System.Windows.Automation.ControlType]::Text }
# 第一个 Text = 发送人，其后 = 正文（按顺序即通知的排版顺序）
$out = @(); foreach ($t in $texts) { $out += $t.Current.Name }
@{ sender = $out[0]; body = ($out[1..($out.Count-1)] -join ' '); hwnd = $toast.Current.NativeWindowHandle } | ConvertTo-Json -Compress
`

export async function pollToast(): Promise<{ sender: string; body: string; hwnd: number } | null> {
  // 调 PS 拿 JSON —— 走的是 uia.ts 已有的 EncodedCommand 套路
}
```

> ⚠️ toast 的 UIA 结构和显示时长会随 Windows 版本、聚焦助手设置变化。
> **必须做降级**：UIA 拿不到就退回 OCR，都拿不到就**不显示任何东西**（宁可不提醒，不能瞎猜）。

### 13.3 跳转：koffi，三行

```ts
// main/signals/jump.ts —— desktopPin.ts 已有同样的 koffi 样板
import koffi from 'koffi'
const u32 = koffi.load('user32.dll')
const FindWindowW   = u32.func('FindWindowW',    'void *', ['string', 'string'])
const ShowWindow    = u32.func('ShowWindow',     'bool',   ['void *', 'int32'])
const SetForeground = u32.func('SetForegroundWindow', 'bool', ['void *'])

const WECHAT_CLASS = 'WeChatMainWndForPC'      // 老版
const WECHAT_CLASS4 = 'Chrome_WidgetWin_1'     // 新版（Electron），需再按标题过滤

export function jumpTo(app: 'wechat' | 'wecom' | 'feishu') {
  const hwnd = findWindowFor(app)             // 先 EnumWindows 找，找不到再 FindWindowW
  if (!hwnd) return { ok: false, reason: '没找到窗口，可能没运行' }
  ShowWindow(hwnd, 9)                          // SW_RESTORE，最小化了先还原
  const ok = SetForeground(hwnd)
  return { ok, reason: ok ? '' : '系统没给前台权限' }
}
```

**一个好消息**：Windows 的「前台锁」只限制**后台进程**抢焦点。
**这里是用户双击触发的，WorkOn 本来就是前台进程，`SetForegroundWindow` 基本不会失败。**
不需要 `AttachThreadInput` 那些脏活。

窗口找不到时的降级路径要说清楚：

| 情况 | 表现 | 降级 |
|---|---|---|
| 窗口存在、前台 | 正常切过去 | — |
| 窗口最小化 | `SW_RESTORE` 后正常 | — |
| App 没运行 | 提示"微信没开" | **不自动启动**（启动应用要用户同意） |
| 新版微信类名变了 | 找不到 | 试标题模糊匹配，失败就明说 |

### 13.4 一条绝对红线：可以复制，不能代发

> **WorkOn 永远不会替你发出消息。**

理由不是技术，是身份：

- 自动代发 = **以你的身份对外沟通**。发错了、改不了、对方以为是你说的
- 这条线一旦越了，产品就从「你的助手」变成「能替你说话的机器人」
- 而且技术上极脆：各家客户端的输入路径、发送按钮位置、发前确认逻辑都不一样，做出来也不可靠

**能做到的底线是「帮你把话准备好」：**

| 动作 | 可以？ | 说明 |
|---|---|---|
| 跳到微信，光标在输入框 | ✅ | 只是切窗口 |
| 复制原文到剪贴板 | ✅ | 你自己判断、粘贴、发送 |
| 给你一个「建议回复」让你复制 | ✅ | **必须是你点复制，不是自动填** |
| 自动填进输入框 | ⚠️ 边界 | 我建议不做：会误发，且各客户端行为不一致 |
| 自动点发送 | ❌ **绝对不做** | 没有任何产品该做这件事 |

「建议回复」如果要做，形态是**在剪贴板里放一段文本**，并且**明确告诉你是建议**。

### 13.5 落地顺序

| 阶段 | 做什么 | 风险 |
|---|---|---|
| **P0（1 天）** | 跳转（koffi）+ 手动加消息的预览卡 | 极低 |
| **P1（1–2 天）** | UIA 读 toast（复用 `uia.ts` 的 PS 框架） | 中，**必须带 OCR 兜底** |
| **P1** | 跳转改成"点哪条切到哪个会话"（需按窗口标题定位会话） | 中 |
| **P2** | 深度块期间**不弹**、结束统一给 | 低 |

> 「点某条直接切到那个具体会话」比"切到微信主窗口"更进一步 ——
> 需要用消息里的发送人/群名去匹配窗口标题或会话列表。
> **但这条要实测确认各家客户端的窗口结构，别在没验证前承诺。**

---

## 14. Computer Use：通用操作电脑

> 你要的"接管"如果是指**像 computer use 一样直接看屏幕、动鼠标键盘**，
> 而不是给每个 App 写一套专用解析 —— 那这是对的，而且**你的技术栈已经全齐了**。

### 14.1 你已经有的（实测确认）

| 环节 | 你现有的 | 够不够 |
|---|---|---|
| 看屏幕 | Electron `desktopCapturer` + `sharp`（已在用） | ✅ |
| 读文字 | RapidOCR + Tesseract + `Windows.Media.Ocr`（`systemOcr.ts`） | ✅ |
| 找元素 | RapidOCR 的**文字框坐标**就是可点的目标 | ✅ |
| 动鼠标键盘 | **koffi** → `SendInput`（你已经在用它 load user32） | ✅ |
| 备用输入 | **uiohook-napi** 本身就带 `uInput` 合成输入 | ✅ |
| 知道当前状态 | `EnumWindows` / `GetForegroundWindow`（`winInfo.ts`） | ✅ |

**这四块拼起来就是一个完整的 computer use 循环。** 不需要引入任何新框架。

### 14.2 但代价必须先说清楚

这是整个方案里**最容易被低估的部分**，所以放在最前面。

**慢。** 每一步都要：截图(100–200ms) → OCR(300–800ms) → 模型决策(1–3s) → 执行。
**单步 1.5–4 秒，6 步任务 10–25 秒。** 而同一个操作有 API 时是**毫秒级**。

**不可靠，而且失败率是乘出来的。** 假设单步成功率 95%（OCR 认对文字 + 坐标点中）：

| 步数 | 整体成功率 |
|---|---|
| 6 步 | **74%** |
| 12 步 | **54%** |
| 20 步 | **36%** |

> **这是为什么必须有"验证"步骤和重试机制** —— 界面上那个第 ④ 步不是装饰，
> 它是把 95% 拉到 99% 的唯一手段。

**所以 computer use 的正确定位是：**

| | 用什么 |
|---|---|
| 音乐控制 | 媒体键（**不要**去截屏点播放按钮） |
| 消息预览 | UIA（**不要**去截屏读通知） |
| 项目进度 | 读 db / git（**不要**去点开 IDE 看） |
| **没见过的界面 / 没有 API 的老系统 / 跨应用拖拽 / 视觉验收** | **computer use** |

**一句话：能用便宜的绝不用贵的。** computer use 是兜底，不是主力。

### 14.3 循环长什么样

```
① 观察  截图 → OCR 出可点的文字框（带坐标）
② 计划  模型看着截图和目标，决定下一步：点哪里 / 输入什么 / 等多久
③ 执行  koffi SendInput
④ 验证  重截一小块，对比是否达到预期   ← 没有这步，前面三步都不可信
⑤ 记忆  这次「目标 → 动作 → 验证」成功了就存成一条宏
```

界面上必须**逐步可见**，因为它动的是你的键鼠：

```
┌ DWS 联调环境 · 起来了 ─────────────────────────────┐
│ 我按你上次教我的那套点的：不认识这个界面就直接看屏幕。 │
│ ① 观察  截图 → 找到「启动联调」按钮 @1180,742   1.2s │
│ ② 计划  点它，然后等 3 秒看有没有起来            0.4s │
│ ③ 执行  SendInput 左键点击                      0.1s │
│ ④ 验证  重截 → 按钮消失、端口 8080 变绿 = 成功  1.1s │
│ ⑤ 补一步 OCR 看见「权限不足」→ 改用管理员重启      2.0s │
│ ⑥ 收尾  关掉多余的 PowerShell 窗口              0.8s │
└─────────────────────────────────────────────────┘
```

### 14.4 核心机制：它是老师，不是拐杖

这是让 computer use 从"演示"变成"产品"的关键。

> **第一次用 computer use 是贵的。第二次就该几乎不花时间。**

每次成功都要沉淀一条**宏**：

```ts
// main/cua/memory.ts
export interface Macro {
  id: string
  /** 目标怎么描述（给未来的自己看的） */
  intent: string
  /** 触发条件：哪个窗口、什么状态 */
  when: { exe: string; title?: string; anchor?: string }
  /** 固定动作序列 */
  steps: Action[]
  /** 怎么确认做成了 —— 没有 verify 的宏不许存 */
  verify: { crop?: [number, number, number, number]; expect: string }
  uses: number
  savedMs: number        // 累计省下的时间
  lastFailure?: string   // 失败了就标记，需要重新学
}
```

```
┌ 这一步我记住了 ─────────────────────────────────┐
│ 「启动联调」按钮 = 主窗口 (1180,742)，点后等 3000ms，  │
│ 验证「端口 8080 变绿」                             │
│ 第一次 computer use 22 秒  →  以后走快路径 0.3 秒   │
│ 已复用 7 次 · 省了 2 分 40 秒                        │
└──────────────────────────────────────────────────┘
```

**收益 70 倍。** 这才是 computer use 真正的价值 ——
不是"我什么都能点"，而是**"我只学一次，之后再不点"**。

失败的处理同样重要：**宏一旦 verify 不过，立刻作废并退回 computer use 重新学。**
宁可慢，不能用一条过期的宏瞎点。

### 14.5 安全闸（这条能力的地板）

> computer use 意味着**一个模型在动你的键鼠**。它能点到的，你也能点到。

| 闸 | 规则 |
|---|---|
| **高危动作必确认** | 删除 / 覆盖 / 发送 / 提交 / 支付 / 关闭未保存的东西 → **弹窗，不自动过** |
| **三选一，不是两个** | `[执行] [跳过这步] [整个任务停下]` —— 必须能整体中止，不能只能跳过 |
| **常驻可见** | 接管期间屏幕上有持续指示（你已有托盘 + 3D 姵儿） |
| **Esc 立即停** | 键鼠被接管时，Esc 永远是急停键，不被任何任务占用 |
| **步数上限** | 单任务 > 30 步自动收手并报告，防止死循环 |
| **只看不点** | 提供"只报告不操作"的模式，用于让它先告诉你屏幕上有什么 |
| **区域限制** | 可选：只允许在指定窗口的坐标范围内活动 |

界面上必须是**真按钮**，不能是"你确定吗"的假提示：

```
⚠ 这一步会覆盖 DWS 的 .env
  我识别出要写 D:\AI\DWS\.env，里面现在有 3 个配置项。覆盖之后原值就没了。
  [执行]  [跳过这步]  [整个任务停下]
```

### 14.6 落地顺序

| 阶段 | 做什么 | 风险 |
|---|---|---|
| **P0（1 天）** | 截图 + OCR + **只看不点**（只报告屏幕上有什么） | 极低，**完全不动键鼠** |
| **P1（2–3 天）** | `SendInput` 闭环 + 验证步骤 + Esc 急停 + 步数上限 | 中，安全项必须一起做完 |
| **P1** | 高危动作闸（三选一） | 中 |
| **P2（3–5 天）** | 宏的记忆 / 复用 / 自动作废 | 中，**这是最值钱的一块** |
| **P3** | 多窗口 / 多屏坐标映射 | 中 |

> **P0 的"只看不点"必须先做。** 它零风险、立刻有用
>（「我现在屏幕上是什么」「这个报错什么意思」），
> 而且能让你在**不动键鼠**的前提下验证 OCR 准不准 —— 准了再往下走。
