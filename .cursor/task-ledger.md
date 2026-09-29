# 个人需求台账（最近 10 条）

> Agent 自动维护。只保留最新 10 条。状态：`待开始` | `进行中` | `部分完成` | `已完成` | `已取消`

## REQ-20260922-03 · 2026-09-22

**原话**：整个浅色模式 跟深色模式

**状态**：`已完成`

**拆解**

- [x] globals.css 抽出浅色变量组（[data-theme=light] 覆盖 + 硬编码色改走变量）
- [x] 主题切换组件（cookie 持久化 + 跟随系统兜底）— 用 cookie+SSR 而非 localStorage+内联脚本，无闪烁且不破坏 CSP
- [x] nav 接入开关；typecheck+build+冒烟两态渲染

**结果摘要**：全站深浅色完成。机制：layout 读 `theme` cookie → `<html data-theme>` SSR 直出（无闪烁、零内联脚本、CSP 不破）；未选过时按 `prefers-color-scheme` 跟随系统（媒体查询 `:root:not([data-theme])` 兜底）。新增变量 --nav-bg/--hero-bg/--grid-line/--veil/--border-strong/--card-shadow，浅色下卡片带柔和投影、产品主题色整体加深一档保可读性；设备截图框保留深色边框（物理真实感）。切换组件 theme-toggle.tsx 写 cookie+即时翻转 data-theme，图标由 CSS 按主题显隐（日/月）。验证：无 cookie→无属性跟系统、light/dark cookie→SSR 直出正确属性、tsc/build 通过。

---

## REQ-20260922-02 · 2026-09-22

**原话**：另外一个模型做的主页很丑。功能介绍要带上产品的核心图（截图/mockup）和交互逻辑，类似截图里那种移动端展示风格或其他风格

**状态**：`已完成`

**拆解**

- [x] products 表 + shots（截图:src/caption/device）+ steps（交互流程）字段与迁移
- [x] Shot 组件：手机框/桌面窗框 + 无图时 CSS mock 屏幕；详情页「界面一览」「使用流程」两区
- [x] 首页产品卡加截图预览
- [x] 后台产品表单可编辑 shots/steps（JSON）
- [x] seed/存量数据补示例 steps+shots；typecheck+build+冒烟

**结果摘要**：产品展示升级完成。products 加 shots/steps 两 JSON 列（迁移 0002，已手工执行并补记 __drizzle_migrations 防启动重跑）。新组件 components/shot.tsx：手机框（圆角+胶囊刘海）/桌面窗框（三点栏）双形态，src 为空时渲染主题色 CSS mock 屏（图标+骨架条）。详情页新增「界面一览」shot-grid、「使用流程」flow-steps（自动编号）；首页 p-card 顶部加 168px 截图预览条（渐变遮罩）。后台产品表单加两个 JSON 编辑域（shots 校验媒体文件名白名单）。seed 4 产品全部补齐示例 steps+mock shots，存量库已回填。tsc✅ build✅ /p/oner 与首页渲染验证通过。换真截图：/admin/media 上传→产品 shots 的 src 填文件名。

---

## REQ-20260922-01 · 2026-09-22

**原话**：admin / OnAdmin2026test → /adm 用这个用户登录不进去呢

**状态**：`已完成`

**拆解**

- [x] 定位根因：`next start` 生产模式下会话 Cookie 恒带 `Secure`，本地 `http://localhost:3100` 浏览器拒存 → 登录成功但会话丢失
- [x] 修复：`src/lib/auth.ts` `secure` 改为按请求协议判定（x-forwarded-proto / origin 为 https 才 true），本地 http 放行、线上 nginx 反代 HTTPS 自动恢复 Secure
- [x] 重建 + 重启 :3100，验证：密码哈希校验 MATCH、手工造会话行带 cookie 访问 /admin /admin/products 均 200、无 cookie 307 回登录页
- [x] 清理测试会话行

**结果摘要**：登录失败根因=Secure Cookie 在 http 下被浏览器丢弃（非密码错误，密码校验通过）。已改协议自适应并重启生效。服务器端会话+中间件+权限链全通。浏览器实际点击登录待用户复测；注意如浏览器存了旧的坏 cookie 可先清 localhost 站点数据。

---

## REQ-20260921-02 · 2026-09-21

**原话**：做一个 blog 的地方——每天在社媒发的功能模块内容这里也一并发，用户能看到怎么用

**状态**：`已完成`

**拆解**

- [x] posts 表 + 迁移（slug/title/excerpt/content/关联产品/封面/发布时间）
- [x] 轻量 Markdown 渲染器（标题/列表/图片/链接/强调，无原生 HTML）
- [x] 公开页：`/blog` 列表 + `/blog/[slug]` 详情
- [x] 后台：`/admin/posts` 列表 + 新建/编辑/发布开关/删除
- [x] nav/footer 加博客入口；build + 冒烟

**结果摘要**：博客区上线。/blog 卡片列表（日期+关联产品徽标+标签+封面），/blog/slug 详情页（Markdown 渲染 + 底部挂关联产品卡）。后台 /admin/posts 可写文/编辑/发布开关/删除，正文支持 ## 标题、列表、代码块、图片(/media/)、链接、**粗体**、==高亮==。种子带示例文 hello-on。冒烟：/blog、详情、后台三页全 200。注意：重启服务时若旧进程占 3100 需先 `kill $(ss -tlnp | grep 3100)` 查 PID。

【追加·Oner 接入】按 Oner 侧方案落地：on-web `next.config.ts` 加 rewrites——`/oner/:path*`→`ONER_APP_URL`(默认:5173)、`/api/:path*`→`ONER_API_URL`(默认:3000)；修正其双 CSP 建议（同名头叠加取交集不生效，改为把 fonts.googleapis/gstatic、img https、blob、connect ws 并进唯一全局 CSP）；oner 产品 ctaHref→/oner 且详情页 wxEntry 与 CTA 可共存；.env.example + DEPLOY.md 同步。本机 Oner 未起，/oner 与 /api 返回 500 代理错=接线已通；联调需三进程（Oner 后端:3000、前端 `VITE_BASE=/oner/` :5173、on-web dev 换 3001 避 3000）。

---

## REQ-20260921-01 · 2026-09-21

**原话**：你帮我看下 jev 的决断模型 对我的 workon 有什么优化建议 跟采纳 → 澄清后：调研 TypeSafe Jev 决策模型本身

**状态**：`已完成`

**拆解**

- [x] 定位材料：`D:\AI\workon小模型训练\`（OPTIMIZATION_PLAN.md 场景三级识别方案 + REVIEW_WORKON.md 既有评审 + 11810 增强样本/9844 action_data/映射表等数据资产）
- [x] 对照 workon 现有识别链路（decision.ts 融合决策层 / featureBuilder 9 特征 / XGBoost sidecar / APP_RULES 兜底 / recognition_log 影子记账）
- [x] 输出评审结论 + 分级采纳清单（用户已确认范围：先不改代码，只要结论）
- [-] 落地实施：用户选择「先不改」，待后续指令（候选已列：APP_RULES 补 ~30 进程 / decision.ts state 直通 bug 修复 / action_data 词表归一）

**结果摘要**：【第一轮误读为本地方案，评审结论仍有效】可采纳=① APP_RULES 进程缺口 ~30 个（远程桌面/企业微信/邮箱/网盘/截图/虚拟机/阅读器等，jev 映射表可直接反哺规则层）② 顺带发现现存 bug——v3_real 模型输出已是 WorkState 标签，decision.ts 仍按 8 动作类查 MODEL_LABEL_TO_STATE，导致 model_first 下模型永不生效且 other 被误映射为 focus。不采纳=action_data 直接混训（词表 28/60/10 vs workon 9/11/3 不对齐）、MiniLM 场景模型（端侧偏重）、OCR/layout 进特征（隐私口径）、ActivityWatch 对接（产品偏离）。用户拍板「先不改」，代码未动。

【第二轮·调研 Jev 本体】Jev = TypeSafe AI 的 System 1 决策模型（2026-09 公开，闭源云 API）：非自回归并行采样，输入 state + 并行问题，输出 Choice（≤255 选项+分布+置信度）/ Score（2-10 级评分）/ Noul（二元 P(yes)）；RLCD 校准训练让概率可建 fallback；定位「带语义的 if-else」。对 workon 的启发在输出协议而非换引擎：① 单标签→多路判定（Choice 状态 + Noul 会议/摸鱼 + Score 专注度）② sidecar 回传分布/熵，按 top1−top2 边际做三级 fallback（现为 0.75 一刀切）③ recognition_log 已有 prob+纠偏金标，可离线算校准曲线。不采纳：云 API（隐私+中文+RTT）、LLM 约束解码（XGBoost 够用）。代码未动。

---

## REQ-20260920-01 · 2026-09-20

**原话**：ON 官网 V2（Demo.html + 升级提示词）从纯 HTML 改成可管理的系统——能管理、能浏览、不同地址访问不同产品、有登录认证、要安全

**状态**：`进行中`

**拆解**（已与用户确认：Next.js 全栈重写 / 管理员+访客注册 / 路径式 oner.uno/p/oner / 后台管产品信息+页面文案+图片+访问数据）

- [x] 新建 Next.js 项目 `workonv0.2-6/on-web`（TS + App Router + SQLite）
- [x] 移植 V2 Demo 视觉到首页（kernel/matrix/link/server/CTA/footer，保留 ICP 备案）
- [x] `/p/[slug]` 产品页（DB 驱动，oner/workon/peton/ondesign）
- [x] 认证：注册/登录/登出，scrypt 密码哈希 + httpOnly 会话 Cookie + 限流
- [x] `/admin` 后台：产品管理 / 文案管理 / 图片上传 / 访问统计
- [x] 安全头 + 输入校验 + 上传校验
- [x] typecheck + build + 冒烟验证；写部署说明（nginx 反代 + HTTPS）

**结果摘要**：`on-web/` Next.js 全栈站建成。前台=Demo V2 视觉全量移植且数据全部走 SQLite（blocks/products 表）；`/p/slug` 产品页 4 个已上线；注册/登录/改密 scrypt+DB 会话+IP 限流；`/admin` 仪表盘/产品/文案/媒体四个模块；安全头(CSP/HSTS/nosniff)+中间件路由守卫+requireAdmin 双保险；媒体按白名单路由回源。tsc ✅ build ✅；HTTP 冒烟：全路由状态码、未登录跳 /login、普通用户进 /admin 被弹回 /、action 管线 303+清 Cookie 均实测通过。部署文档 deploy/DEPLOY.md + oner.uno.conf（反代 127.0.0.1:3000 + 双层限流）。剩：真机走一遍注册→登录→后台改文案（预览已开 :3100）。

---

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
