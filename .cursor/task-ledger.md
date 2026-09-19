# 个人需求台账（最近 10 条）

> Agent 自动维护。只保留最新 10 条。状态：`待开始` | `进行中` | `部分完成` | `已完成` | `已取消`

## REQ-20260915-13 · 2026-09-15

**原话**：找不到完成计划的入口，只能绕到主线-查看-对接里点

**状态**：`已完成`

**拆解**

- [x] 盘点完成入口：计划页每行有小勾选框、待办悬浮窗 ○/◐/☑、监控悬浮窗归属待办 ○——都存在但分散
- [x] 定位缺口：首页「今日计划」清单行是纯展示（时间+状态点+标题），没有完成入口——用户最顺手的位置缺操作
- [x] 修法：HomeView 今日计划行的状态点改为可点勾选钮（点击切 done/planned，依赖 plan-updated 广播自动刷新）

**结果摘要**：首页今日计划现在可直接勾完成，不用再绕道主线弹窗。typecheck ✅ HMR 生效。

---

## REQ-20260915-12 · 2026-09-15

**原话**：各模块待办/完成信息一致吗？悬浮窗待办明明在主程序已完成

**状态**：`已完成`

**拆解**

- [x] 定位①：plan-updated 广播只 sendTo('main')——widget/todoWidget 永远收不到计划变更；todoWidget 有监听但广播到不了
- [x] 定位②：SuggestionWidget 的 attrPlans 连监听都没有，只在归属项目变化时拉一次
- [x] 修法：9 处 sendTo('main','plan-updated') 全改 broadcast('plan-updated')（ipc.ts×6 / index.ts×1 / tools.ts×2）；SuggestionWidget 加 onPlanUpdated → planTick 触发 attrPlans 重拉

**结果摘要**：计划变更现在广播到全部窗口（主界面/监控悬浮窗/待办悬浮窗/桌宠），主程序勾选完成后悬浮窗即刻同步。typecheck ✅ 已重启。

---

## REQ-20260915-11 · 2026-09-15

**原话**：①悬浮窗宽度每次还是恢复默认 ②吸附态绿点亮了但点进去没有待确认

**状态**：`已完成`

**拆解**

- [x] 绿点误报：fireflyActive 混入 aiAssist busy/done（AI 跑长任务恒亮）→ 中点改接 hasPopup+notifies+askAnswer，只认「点进去真有东西」的信号
- [x] 宽度被竞态砸回：从吸附展开 full 时，动态高度 effect 在主进程 resize 落地前量到胶囊尺寸（outerWidth=120）回传 transient → 窗宽被砸成 120 → 后续位移保存把 120 写进 widgetSizes 污染记忆
- [x] 修法①主进程：resizeWidgetTransient 忽略入参宽度、恒用当前窗宽（transient 本就只为撑高）
- [x] 修法②渲染层：full 分支检测到窗高 <120（仍是胶囊尺寸）时延迟 150ms 等模式尺寸落地再实测
- [x] 绿点超时熄灭：bpConfirm/meetingDetected/showUnattrAsk/askState='answer' 只有点了才清，被忽略就恒亮 → 统一 pendingAlive，挂起 8min 自动结案（对齐主进程 question TTL）

**结果摘要**：宽度记忆根治——transient 通道物理上无法改宽；展开瞬间的脏测量被延迟规避。typecheck ✅ 已重启。

---

## REQ-20260915-10 · 2026-09-15

**原话**：吸附态中间的点——有待确认项绿色、没有就主题色；外围呼吸圈持续再长一些

**状态**：`已完成`

**拆解**

- [x] DockCapsuleRings 中点原是静态白点 rgba(255,255,255,0.28) → 接 pending（fireflyActive）：有待确认项绿色 #34d399 带微光，否则主题色 accent
- [x] Firefly 呼吸 3s→6s 周期，峰值 42%~58% 驻留，呼吸更沉

**结果摘要**：吸附胶囊中点变成待确认信号灯；呼吸周期翻倍放缓。typecheck ✅ HMR 生效。

---

## REQ-20260915-09 · 2026-09-15

**原话**：拖动的悬浮窗宽度能不能记忆，每次打开宽度都忘了；高度自动就行但宽度要记

**状态**：`已完成`

**拆解**

- [x] 定位①：scheduleWidgetBoundsSave 存的是定时器触发时的实时 getSize()——拖宽后 400ms 内收起成 mini，timer 触发时 mode=mini 直接 return，刚拖的宽度没写库
- [x] 定位②：同一路径会把确认卡自动撑高的「临时高度」写死进 widgetSizes
- [x] 定位③：onResizePointerUp 丢弃 pending 的最后一帧 rAF（resizeRef 已清 → 尾段增量丢失）
- [x] 修：resizeWidget 捕获 {mode,w,h} 进 pendingSizeSave，落库按发起时的模式写（收起也丢不掉）；位移保存时高度保留已存值不采样实时值；pointerup 冲刷 pending
- [x] typecheck ✅，重启 dev 生效

**结果摘要**：手动拖的尺寸按发起模式可靠落库；自动撑高（确认卡）不再污染记忆尺寸；拖宽→收起→再展开宽度保持。

---

## REQ-20260915-08 · 2026-09-15

**原话**：隐私管理里的微信记录，开了之后颗粒度给我细一点

**状态**：`已完成`

**拆解**

- [x] 定位：原始 ActivityRecord 每条都带标题，但 buildMergedTrail 只在「应用切换」切段——微信换聊天对象（标题变）被并成一个大段，颗粒度丢失在合成层
- [x] trail.ts：IM 类应用（categoryOf==='im'：微信/QQ/钉钉/飞书等）同应用换标题也切段 → 时间轴按联系人/群分时段
- [x] aggregator.ts mergeSameAppSegs：IM 段标题不同不合并，报表保留联系人级行
- [x] PrivacyView 不采集名单下补说明文案
- [x] typecheck ✅，重启 dev 生效（shared/trail 主进程引用）

**结果摘要**：微信取消隐私标记后，时间轴/报表按「跟谁聊」切独立时段；<30s 瞄一眼仍记为 glance 不计入统计。

---

## REQ-20260915-07 · 2026-09-15

**原话**：优先级在很多地方的显示规则都根据它调整——待办顺序、计划优先级等

**状态**：`已完成`

**拆解**

- [x] 新建 @shared/priority.ts 统一口径：prioW 权重（高0/中1/低2）+ PRIO_META（▲红/●黄/▽灰）
- [x] 主线列表：先按项目优先级再按今日投入排序
- [x] HomeView 今日计划：定时项按时刻、无时刻项按所属项目优先级排（top3/三件事随之浮动）
- [x] PlanView：项目分组按优先级排序 + 组头显示优先级标记；计划列表次级排序挂项目优先级；编辑器项目下拉按优先级排且带标记
- [x] 待办悬浮窗/粘贴分拣/反哺对话框：项目列表统一按优先级排，名前显示 ▲●▽
- [x] typecheck ✅，渲染层 HMR 生效

**结果摘要**：项目优先级成为全局排序因子——凡出现项目列表/计划列表的地方，高优先级项目及其任务一律浮前并带颜色标记。

---

## REQ-20260915-06 · 2026-09-15

**原话**：主线的项目优先级也可以增加一个；拆解任务后点「排入今日」没有效果

**状态**：`已完成`

**拆解**

- [x] 排入今日诊断：链路本身正常（savePlan→plan-updated 广播→首页/计划页刷新），但反馈只有 3s flash 且任务行无已排标记 → 观感"没效果"
- [x] ProjectModal 加载今日计划构建 pushedIds；已排任务行常驻「✓ 已排今日」徽标替代按钮；成功后 flash 提示「去计划页可见」
- [x] 主线行头加优先级 chip（▲高/●中/▽低），点击循环切换并 saveProject 落库——不用进弹窗
- [x] typecheck ✅，渲染层 HMR 生效

**结果摘要**：排入今日后任务行留常驻标记不再"点了像没点"；主线列表可直接看/改优先级。

---

## REQ-20260915-05 · 2026-09-15

**原话**：悬浮窗 full 态确认卡不能自动扩充高度，按钮拖不出来

**状态**：`已完成`

**拆解**

- [x] 定位：动态高度 effect 里 `mode==='full'` 直接 return（原作者怕抽动刻意跳过）→ 确认卡被 overflow-hidden 裁掉
- [x] full 态改实测溢出撑高：fullRootRef + scrollHeight-clientHeight 差值 → widgetResizeTransient，只增不减尊重手拖尺寸，上限 900
- [x] windows.ts resizeWidgetWindow 高度夹到工作区（防向上撑到顶后底边溢出屏幕）
- [x] typecheck ✅，重启 dev 生效

**结果摘要**：full 态确认/通知出现时按实测内容自动撑高，确认按钮不再被裁；永不自动缩小。

---

## REQ-20260915-04 · 2026-09-15

**原话**：反复确认一定不要重复，尤其程序名变了但还是一个程序的情况

**状态**：`已完成`

**拆解**

- [x] 新增 canonAppKey 程序归一键（appDisplayName.ts）：别名表折叠 weixin≡wechat≡微信、idea64≡ideaIU、code≡vscode（补 code→VS Code 映射）
- [x] 确认指纹换归一键：unattr 指纹 pathKey→`unattr:日:程序键`（同程序换窗口标题不再换新题）；drift 指纹→`drift:项目:日`（同项目一天最多确认一次）
- [x] unattrAppSet 按归一键去重（列表不再出现 weixin+wechat 两条）
- [x] appNameMatch 先归一键精确命中再 fuzzyMatch 兜底（绑了 weixin.exe 跑 WeChat.exe 也命中）
- [x] 作业链路 trackAppSwitch/isKnownChain/matchKnownChain/saveWorkChain 全按归一键比较
- [x] 入队即写 confirmMemory 'asked'：忽略的问题跨重启也不重弹
- [x] typecheck ✅，重启 dev 生效

**结果摘要**：「同程序不同名」全链路归一——绑定匹配、确认指纹、作业链路都按 canonAppKey 判定；问过的题（答过/忽略）当天不重复弹。

---
