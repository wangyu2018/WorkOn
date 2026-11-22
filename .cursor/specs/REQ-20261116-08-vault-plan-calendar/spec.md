# REQ-20261116-08 收藏网址私密加密库 + 计划日历视图

## 目标

1. 收藏网址中的私密条目自动从普通列表隐藏，移入本机加密库；加密库默认收起，点开后可见。
2. 计划页新增「列表 / 日历」视图切换，日历按天展示计划并提供日期选择与快速新建。

## 现状

- 收藏网址入口为 `IntelView.tsx`；书签导入走 `main/intel.ts` 的 `importBookmarkSource`，导入后的「关注列表」即用户看到的收藏网址。
- 主进程已有 `safeStorage` 加解密 helper：`sealSecret/openSecret`（`enc:` 前缀），见 `main/intel.ts`。
- 计划页 `PlanView.tsx` 仅列表；`CalendarView.tsx` 已有计划标签月历实现可参考样式，但本次不复用其组件、不改动该文件。
- `plans:list` 不传日期时返回全部计划，可直接用于月历聚合。

## 决策（默认，无需再问）

- 私密判定：文件夹名 / 标题 / URL 命中内置隐私关键词即自动隐藏；同时支持对关注列表条目手动「隐藏」。
- 关键词分四组（大小写不敏感）：
  - 中文隐私：私密、隐私、加密、密码、密钥、密保、私藏
  - 财务/身份：银行、网银、支付、钱包、账单、工资、社保、公积金、身份证、护照、合同、发票
  - 健康：病历、体检、医院、健康档案、处方
  - 英文/情感：private、secret、vault、password、passwd、bank、wallet、payment、paypal、alipay、finance、invoice、medical、health、hospital、dating、adult、porn、xxx、onlyfans
- 加密方式：Electron `safeStorage`（绑定当前系统账户），磁盘只存密文；不引入独立密码。系统加密不可用时降级 `plain:` 并在 UI 标注「本机降级」。
- 加密库入口固定在收藏网址页左侧栏，显示「加密库 · N」，点击「查看」才解密加载到渲染层，收起即清空内存中的明文。
- 私密条目不会进入关注列表，因此不会被抓取/摘要/入库。

## 变更清单

### A. 类型与存储

1. `src/shared/intel.ts`
   - 新增 `VaultSite`：`id, title, url, source, folder?, addedAt, reason: 'auto' | 'manual'`
   - 新增 `VaultStatus`：`count, encryption: 'safeStorage' | 'plain', updatedAt?`
2. `src/main/intel.ts`
   - 新增隐私规则常量 + `privateHint(site)`（返回命中的关键词或 null）。
   - 新增加密库文件 `userData/vault.json`，结构 `{ version: 1, count, updatedAt, data: sealSecret(JSON.stringify(VaultSite[])) }`。
   - 新增：`getVaultStatus()`、`listVaultSites()`、`removeVaultSite(id)`、`hideWatchToVault(id)`。
   - `importBookmarkSource`：书签分区，命中规则的写入加密库，其余照旧进关注列表。
   - `addIntelWatch`：命中规则的只写加密库，不进关注列表。
   - 首次 `ensureState()` 迁移：把已有关注列表中命中规则的条目移入加密库，并删除对应 URL 的情报条目；仅执行一次（模块级 flag）。
   - `hideWatchToVault`：按 watch id 取出、写库、从 watch 移除、保存状态。

### B. IPC / Preload

3. `src/main/ipc.ts`
   - `intel:vaultStatus` → `getVaultStatus()`
   - `intel:vaultList` → `listVaultSites()`
   - `intel:vaultRemove` → `removeVaultSite(String(id))`
   - `intel:watchToVault` → `hideWatchToVault(String(id))`
   - 更新 import 引入。
4. `src/preload/index.ts`
   - 增加 `getVaultStatus/listVaultSites/removeVaultSite/hideWatchToVault` 四个桥接方法（类型自动推导到 `window.api`）。

### C. 收藏网址 UI

5. `src/renderer/src/views/IntelView.tsx`
   - `reload()` 并行拉取 `getVaultStatus()`，状态存 `vault`。
   - 顶部统计增加「加密库 N」胶囊。
   - 左栏新增加密库卡片：锁图标 + 数量 + 说明；「查看 / 收起」切换；展开后调用 `listVaultSites()` 列出标题/域名/来源，每行提供「删除」。
   - 关注列表每行新增「隐藏」，调用 `hideWatchToVault(id)` 并刷新。
   - 导入/手动添加后对比加密库数量变化，状态文案提示「N 个私密已进入加密库」。
   - 不做 URL 二次打码：加密库面板需要用户主动点击才展开。

### D. 计划日历

6. `src/renderer/src/views/PlanView.tsx`
   - 新增状态：`view: 'list' | 'calendar'`（localStorage `workon:plan-view`）、`calMonth: 'YYYY-MM'`、`allPlans: PlanItem[]`。
   - 新增 `loadMonthPlans()`：`window.api.listPlans()` 取全部，过滤 `archived`；`view === 'calendar'` 或 `onPlanUpdated` 时刷新。
   - 筛选控制条右侧增加「列表 / 日历」`ui-tabs` 切换。
   - 日历模式下渲染月历卡片：
     - 头部：‹ 月份 ›、回到今天；使用 `WEEK_LABELS`（从 `components/utils` 引入）。
     - 每格：日期、今天/选中高亮、`done/total` 进度、最多 3 条计划短标签（状态色 + 完成删除线）、`+N`。
     - 点击格：`setDate(day)` 且 `setCalMonth(对应月)`。
   - 日历下方渲染「选中日期的计划」紧凑列表：时间、标题、状态；点击打开 `PlanEditor`；空态显示「新建这天的安排」按钮（`setEditor({ plan: { date }, isNew: true })`）。
   - 快速添加、统计卡、确认归档区保持现有行为；列表模式原有 JSX 原样保留。
   - 不改 `CalendarView.tsx`。

### E. 收尾

7. `npm run typecheck` 必须通过。
8. `.cursor/task-ledger.md` 追加本轮条目（含验证结论）。

## 验证步骤（真实执行）

1. `npm run typecheck`。
2. CDP 打开「收藏网址」：
   - 确认左侧出现「加密库 · N」。
   - 在手动添加框输入 `https://private.example.com`，确认关注列表不出现，加密库计数 +1。
   - 点「查看」确认条目可见；点「收起」确认列表从 DOM 消失。
   - 对任一普通关注条目点「隐藏」，确认从关注列表消失且进入加密库。
3. 终端读取 `userData/vault.json`，确认 `data` 以 `enc:` 开头、文件内无明文 URL。
4. CDP 打开「计划」：
   - 切到「日历」，确认月格出现计划标签与完成进度。
   - 点击不同日期，确认下方选中日期计划随之变化。
   - 在选中日期新建一条计划，确认日历格与下方列表同步出现。
5. 记录结果到任务台账。

## 风险与边界

- 关键词规则可能误判（如 health 类文章）；提供手动「隐藏」作为补充，不提供自动恢复；删除加密库条目即彻底移除。
- safeStorage 在极少数环境不可用时降级为 `plain:`，UI 需标注，避免误以为已强加密。
- 日历仅聚合计划数据，不引入专注/热力数据，避免与 `CalendarView` 职责重叠。
