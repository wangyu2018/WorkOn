# WorkOn 模块系统 v9.1 —— 常驻 + 自动刷新

> 配套原型：`workon-ainative-prototype.html`（点常驻区右上角「＋ 模块」打开模块抽屉）
> 现有底座：`renderer/src/lib/homeLayout.ts`（**已有 19 个模块 + 显隐/排序持久化**）

---

## 0. 先说结论：模块你已经有了，缺的是三层

我读了 `homeLayout.ts`，你现在的状况是：

| 现状 | 位置 | 问题 |
|---|---|---|
| 12 个首页块 + 7 个监控分区 = **19 个模块** | `HOME_CORE_META` + `MONITOR_SECTION_META` | 能力其实很够 |
| **默认全开**（`defaultHomeWidgets()` 全 true） | `homeLayout.ts:64` | 首屏 19 块 —— **这就是臃肿的真正来源** |
| 显隐 + 拖拽顺序（localStorage） | `loadHomeLayout` / `saveHomeLayout` | 已经有，但只有开/关，没有"常驻" |
| **至少 8 处 `setInterval` 各刷各的** | PerfPanel 2.5s / screens / WeatherCard 30min / HomeView 30s / MainlineView 60s… | 无统一调度、无防重入、无降级 |

**所以要做的不是"再造一套模块"，是给已有的 19 个模块加三层：**

1. **常驻区** —— 显式钉住的，小而持续
2. **模块抽屉** —— 全部可用模块 + 两条路（钉住 / 问一下）
3. **统一刷新调度** —— 替掉 8 处 setInterval

---

## 1. 常驻区：用户对「对话优先」的显式覆盖

### 1.1 为什么必须有

v9 说"面板是对话聊出来的"。但用户确实有些东西要**一直看着**（项目进度、现在在干什么）。
**常驻 = 用户对"对话优先"的显式覆盖。** 两者不冲突，分工清楚：

| | 常驻区 | 卡片区 |
|---|---|---|
| 谁决定 | **用户钉的** | **对话聊出来的** |
| 生命周期 | 永久 | 来了就在 |
| 形态 | 一行紧凑小卡 | 完整卡片 |
| 刷新 | 自动，定时 | 一次性 |

### 1.2 形态：小卡，不是大卡

```
常驻  点一下展开            ● 自动刷新中   [编辑] [＋ 模块]
┌────────────┐┌────────────┐
│ 现在        ││ 今日计划    │
│ DevTool·写接口││ 3/7 · 43% │
│ 已连续 34m  ││ 剩 4 件     │
└────────────┘└────────────┘
```

- 单卡 **132–190px 宽**，横向滚动，钉 8 个也不占地方
- 三行：标题(10px 灰) / 值(13px 600) / 副标(10px 灰)
- **点一下展开**：下面多出一行说明，不跳走
- 编辑态：出现 ✕，点掉即取消钉住

### 1.3 默认只钉 2 个

`['presence' 现在, 'dayplan' 今日计划]`。

**不给 5 个。** 新用户看到的应该是"你只常驻了两个，要加吗"，不是"我给你配好了六个"。
其余 21 个模块由用户自己从抽屉里挑 —— **这是千人千态的一部分**。

---

## 2. 模块抽屉：23 个模块，两条路

点「＋ 模块」打开，按 `group` 分组。每个模块展示：

```
📁 项目进度
  所有在推项目的平铺进度表，逾期排最前
  自动刷新 60s · listProjects          [钉住]  [问一下]
```

**关键：每行都写明「刷新频率 + 数据来源」。**
用户（和开发者）能一眼看出这个模块贵不贵、从哪拿数。

### 两条路径要分清

| 按钮 | 含义 | 落点 |
|---|---|---|
| **钉住** | 我要一直看着它 | 常驻区，自动刷新 |
| **问一下** | 我此刻想看它 | 走对话 → 卡片区 |

**这两个必须分开。** 混成一个"添加模块"就会回到"所有模块都堆在面板上"的老路。

### 完整模块目录（23 个，全部映射到你的现有 key）

| 组 | 模块 | 你的 key | 刷新 | 数据源 |
|---|---|---|---|---|
| **项目** | 项目进度 | *（新）* | 60s | `listProjects` |
| | 工作链路 | *（新）* | 30s | `getTrail` |
| | 目标进度 | `goal` | 60s | `getGoals` |
| | 计划倒数 | `planahead` | 120s | `listPlans` |
| **时间** | 今日计划 | `dayplan` | 30s | `listPlans` |
| | 工作时间轴 | `timeline` | 30s | `getTrail` |
| | 天气 | *（已有 weather.ts）* | 30min | `weather.get` |
| | 倒数日 | `countdown` | **0** | `localStorage` |
| **专注** | 现在 | `presence` | 2s | `presence` |
| | 注意力 | `attention` | 60s | `getAttention` |
| | 今日洞察 | `insight` | 120s | `report.stats` |
| | 状态分布 | `dist` | 30s | `getTrail` |
| | 应用星图 | `starmap` | 300s | `getTrail7d` |
| | 切换轨迹 | `trail` | 30s | `getTrail` |
| | 应用排行 | `topApps` | 300s | `getTrail7d` |
| | 多屏 | `screens` | 10s | `presence` |
| **生活** | 每日一句 | `quote` | **0** | 本地 |
| | 毒鸡汤 | `soup` | **0** | 本地 |
| | 今日黄历 | `almanac` | **0** | 本地 |
| | 节日倒数 | `festival` | **0** | 本地 |
| | 习惯打卡 | `habit` | **0** | `localStorage` |
| **系统** | 存储占用 | *（新）* | 300s | `db.size` |
| | 性能 | *（PerfPanel）* | 2.5s | `getStats` |

> 标注 *（新）* 的 3 个来自 signals 层（见 `SIGNALS-ARCHITECTURE.md`），其余**全部是现有模块**。

---

## 3. 注册表升级：只加字段，不重写

现有 `HOME_BLOCK_META` 加 4 个字段就够：

```ts
export interface ModuleMeta {
  key: string
  label: string
  desc: string
  size: '整行' | '半宽'
  group: '项目' | '时间' | '专注' | '生活' | 'AI' | '系统'   // 新：抽屉分组
  refreshMs: number                                        // 新：0 = 挂载时算一次
  dataSrc: string                                          // 新：数据来源，抽屉里展示
  f: () => string                                          // 新：常驻小卡的取值函数
  render: () => JSX.Element                                // 新：完整卡片
  pinnable: boolean
}
```

**唯一的行为改动**：`defaultHomeWidgets()` 从「全 true」改成「只开 2 个」。
这一行就是首屏从 19 块降到 2 块的全部。

---

## 4. 统一刷新调度：替掉 8 处 setInterval

```ts
// renderer/src/lib/moduleClock.ts
class ModuleClock {
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private inflight = new Set<string>()
  private stale = new Set<string>()

  on(key: string, load: () => Promise<string>, paint: (v: string) => void) {
    const m = META[key]
    if (!m.refreshMs) { void this.once(key, load, paint); return }   // 0 = 不起定时器
    if (this.timers.has(key)) return

    const tick = async () => {
      if (this.inflight.has(key)) return            // ① 防重入：慢请求不叠加
      if (document.hidden) return                   // ② 后台不刷
      this.inflight.add(key)
      try {
        const v = await load()
        this.stale.delete(key)
        paint(v)                                    // ③ paint 内部比值，变了才动 DOM
      } catch {
        this.stale.add(key)                        // ④ 失败不清空，标"数据过期"
      } finally { this.inflight.delete(key) }
    }
    this.timers.set(key, setInterval(tick, m.refreshMs))
    void tick()                                     // 立即拉一次
  }
}
```

### 四条规则，每条都对应一个真实的 bug

| 规则 | 不做会怎样 |
|---|---|
| **① 防重入** | 慢接口（比如 trail 聚合）会堆请求，越刷越卡 |
| **② 后台不刷** | 切走还刷，电费 + 回来一堆过期数据 |
| **③ 只在值变了才动 DOM** | **这是我做原型时实测到的真 bug**：整条常驻区每 2s 重建 innerHTML，正在 hover 的模块会消失、按钮点不中。必须定点改一个文本节点 |
| **④ 失败不清空** | 一拉取失败就白屏，用户以为数据没了 |

### 刷新间隔的定法

| 变量 | 间隔 | 理由 |
|---|---|---|
| 现在 `presence` | **2s** | 跟随已有 presence 心跳，这是唯一真正"实时"的 |
| 多屏 `screens` | 10s | 变化快但不需要秒级 |
| 项目进度 / 目标 / 计划倒数 | 60–120s | 慢变量（MainlineView 现在就是 60s） |
| 注意力节律 / 星图 / 排行 | 300s | 聚合类，查一次要扫 7 天数据 |
| 天气 | 30min | 已有 |
| 性能面板 | 2.5s | 只在展开时才注册，折叠即注销 |
| **每日一句 / 黄历 / 节日 / 习惯** | **0** | **一天一次，不该有定时器。挂载时算一次即可** |

> `refreshMs: 0` 这一档现在完全缺失 —— 每日一句、黄历这些每次渲染都在重算。
> 标成 0 就彻底没有定时器了。

---

## 5. 落地映射

| 现状 | 改成 | 文件 |
|---|---|---|
| `defaultHomeWidgets()` 全 true | 只开 2 个 | `lib/homeLayout.ts:64` |
| `HomeBlockMeta` 4 字段 | 加 `group / refreshMs / dataSrc / f` | `lib/homeLayout.ts` |
| 8 处 `setInterval` | 全部换成 `moduleClock.on()` | `PerfPanel` / `WeatherCard` / `HomeView` / `MainlineView` / `MonitorView` / `App.tsx` |
| 显隐开关 | 拆成**常驻区** + **对话卡片区**两套 | `Board/` |
| 无模块浏览入口 | 加模块抽屉 | `Board/ModuleDrawer.tsx` |
| 无 | 常驻区紧凑小卡 | `Board/PinRail.tsx` |
| localStorage key `homeWidgets` | 拆成 `pinnedModules` + `cardOrder` | `lib/homeLayout.ts` |

### 分阶段

| 阶段 | 内容 | 风险 |
|---|---|---|
| **P0（1 小时）** | `defaultHomeWidgets()` 改成只开 2 个 | 极低，**首屏立刻从 19 块变 2 块** |
| **P0（半天）** | 注册表加 4 字段 + 模块抽屉 | 低 |
| **P1（1 天）** | `moduleClock.ts` + 换掉 8 处 setInterval | 中，**同时解决 109KB HomeView 的卡顿** |
| **P1（半天）** | 常驻区小卡 + 钉住/取消 | 低 |
| **P2** | 接入 signals 的 3 个新模块（项目进度 / 链路 / 存储） | 依赖 signals 层 |

---

## 6. 怎么验

打开原型：

1. **常驻区只有 2 个**（现在 / 今日计划）—— 不是 19 个，这就是 P0 的效果
2. **等 10 秒**，"现在"的值会自己变（DevTool → Slack → 微信…），但**卡片不会消失、按钮不会失效** —— 验证规则③
3. 点「＋ 模块」→ 23 个模块，每个都写着刷新频率和数据来源
4. 钉住几个，看常驻区变宽 —— 横向滚动，不撑高面板
5. 点「问一下」→ 走对话，落到卡片区，不是常驻区

**判据：常驻区是"我配置的"，卡片区是"她聊出来的"。两者永远不混。**
