# WorkOn 视图优化提示词 v2.2 — 报表 / 规划 / 日历

> 基于 WorkOn 项目现有代码（Electron + React + Tailwind）的三核心视图深度优化方案
> 适用于 AI 代码编辑器直接参考实现

---

## 一、报表体系优化（Report System）

### 1.1 现状诊断

| 问题 | 当前状态 | 影响 |
|------|---------|------|
| 无独立报表视图 | 统计散在 MonitorView(实时仪表) + HeatView(14天热度) + AIView(AI画像) | 用户找不到"看报告"的入口 |
| 无图表库 | 所有可视化都是手写 CSS/Tailwind（色带、进度条、chips） | 视觉单调，无法做复杂图表 |
| 统计维度碎片 | 专注度在Monitor、热度在Heat、效率在AI、达成率在Plan | 同一天的数据要4个页面拼凑 |
| 缺少趋势对比 | 只有"今日"和"近14天"两个时间窗口 | 无法看周/月趋势、同比环比 |
| 无导出能力 | 没有任何导出/分享机制 | 数据困在应用里 |
| 时间颗粒度粗 | 热度图最小粒度=1小时 | 无法看5分钟级别的微观模式 |

### 1.2 整体架构重组提示词

```
Reorganize the WorkOn analytics/report system into a unified Report Hub.

CURRENT PROBLEM: Analytics are scattered across 3 views:
  - MonitorView: real-time dashboard (current state + focus ring + work/slack/dual metrics + trail strip)
  - HeatView: 14-day × 24-hour heatmap matrix
  - AIView: AI-powered efficiency portrait (scores + category bars + peak hours + suggestions)

NEW ARCHITECTURE: Create a dedicated "报表" (Report) view as the analytics center,
  and restructure the existing views:

  MonitorView → stays as "real-time pulse" (keep current state card + focus ring),
    but REMOVE detailed statistics cards (move to Report).
    Keep only: current state card, focus ring, trail strip.
    Add: mini report summary card (today's 3-line quick stats).

  HeatView → becomes a sub-tab inside Report view (or stays as standalone with enhanced features).

  AIView → becomes a sub-tab inside Report view (or stays as standalone with enhanced features).

  NEW ReportView → the central analytics hub with 4 sub-tabs:

    Tab 1: "日报" (Daily Report) — today's comprehensive summary
    Tab 2: "周报" (Weekly Report) — 7-day trends + patterns
    Tab 3: "月报" (Monthly Report) — 30-day macro trends + achievements
    Tab 4: "自定义" (Custom) — pick any date range, compare periods

NAVIGATION UPDATE:
  Add "报表" icon to the left nav (use Lucide "bar-chart-3" icon)
  Group: [Monitor Group: 日历|监控] [Report Group: 热度|报表|画像] [Plan Group: 计划|问答] [AI Group: 桌宠] [设置]

  Or simpler: replace current 8-icon nav with a cleaner 7-icon layout:
  [日历|监控|报表|计划|画像|桌宠|设置]
  (merge Heat into Report, keep QA inside Report as a sub-feature)
```

### 1.3 日报视图（Daily Report）提示词

```
Design the "日报" (Daily Report) sub-view with a premium dashboard aesthetic.

LAYOUT (scrollable, top-to-bottom):

1. HEADER STRIP (48px, glass-card style):
   Left: Date picker (styled glass-dropdown, not native input) + "今天" quick button
   Right: Export button (glass-button, icon: download) + Share button (icon: share-2)
   Center: Date display in H2 format "2026年7月21日 周一"

2. OVERVIEW HERO CARD (glass-card, full-width, 120px height):
   A 4-column grid inside a single glass-card:

   Col 1: Total Work Time
     - Large number: "6h 42m" in 28px/700 accent-green
     - Sub-label: "计划 8h · 达成率 84%" in caption size
     - Micro ProgressRing 28px next to the number

   Col 2: Focus Score
     - Large ProgressRing 80px with animated value fill
     - Color gradient: green (>80) → yellow (50-80) → red (<50)
     - Center text: "87" in 24px/700
     - Sub-label: "专注度评分" caption

   Col 3: Slack Time
     - Large number: "1h 18m" in 28px/700 accent-red
     - Sub-label: "摸鱼占比 16%" in caption
     - Small trend arrow: ↓ (less than yesterday) in green / ↑ in red

   Col 4: Efficiency Score
     - Large number: "78" in 28px/700 accent-blue
     - ProgressRing 28px
     - Sub-label: "AI效率评分" caption

   Each column has a subtle vertical divider (1px, border-subtle).
   The entire card has a state-aware background gradient:
     high focus → green-tinted, high slack → red-tinted.

3. STATE DISTRIBUTION CARD (glass-card, two-part layout):

   Part A: Donut Chart (left, 40% width)
     - Use a clean SVG donut chart (not a library — keep it lightweight)
     - Each slice = one WorkState, colored by stateMeta.color
     - Center text: total time "6h 42m"
     - Hover on slice: highlights it + shows tooltip glass-card with state+duration+percentage
     - Animation: slices grow from 0 on mount (0.5s staggered)

   Part B: State Breakdown Table (right, 60% width)
     - Clean table with rows for each state that appeared today:
       [ StateBadge ] [ Duration ] [ Percentage bar ] [ Trend vs yesterday ]
     - Percentage bar: thin rounded bar (8px height), filled with state color
     - Trend: small arrow + number ("↑12%" or "↓5%") in appropriate color
     - Sorted by duration (longest first)
     - Max 8 rows visible, scrollable for more

4. TIMELINE OVERVIEW CARD (glass-card):
   - 24h color timeline bar (enhanced version of current DayTimeline):
     Height: 64px (not 44px — bigger for better readability)
     Each segment: rounded ends, gradient fill (not flat color),
       inner glow matching state color
     Hover on segment: tooltip glass-card showing:
       [ StateBadge ] Start-End time · Duration · App name
     Click on segment: zoom into that time period (show details panel below)
   - Below the bar: hour markers (0-24) with highlighted current-hour marker
   - "Zoom" mode: clicking a segment expands a detail panel below showing
     every 5-minute sub-segment within that hour

5. PEAK & DIP ANALYSIS CARD (glass-card, two-column):

   Left: "高效时段" (Peak Hours)
     - Timeline-style chips showing peak periods:
       "09:30-11:15 专注编码" with green glow
     - Each chip has a small sparkline (tiny SVG line chart) showing
       focus score within that period
     - "最佳时段: 09:30-11:15" highlighted with accent-green border

   Right: "低效时段" (Dip Hours)
     - Same chip format but with red/warm glow
     - "最差时段: 14:00-14:45 摸鱼刷手机"
     - Each chip has a trend indicator (improving/worsening vs last week)

6. DUAL-SCREEN INSIGHT CARD (glass-card):
   - Only shown if dual-screen data exists today
   - Left: "主屏画像" — vertical list of top-3 apps with duration bars
   - Right: "副屏画像" — same format
   - Center: "并行模式" — 4 mini-metrics:
     [ 常态双屏 % ] [ 主工作副摸鱼 % ] [ 双屏工作 % ] [ 双屏摸鱼 % ]
   - Each metric has a tiny donut or horizontal bar

7. AI INSIGHT CARD (glass-card, collapsible):
   - Header: "AI 今日洞察" with brain icon + expand/collapse toggle
   - Content (when expanded):
     - Natural language summary (same as current AIView 当日小结)
     - But enhanced: 3 key findings with emoji icons:
       💡 "你的编码效率在上午最高，建议重要编码任务安排在10点前"
       ⚠️ "下午14:00-14:45出现45分钟摸鱼窗口，与昨日模式一致"
       🎯 "按当前节奏，今日计划可达92%达成率"
     - "查看完整AI画像" link button → navigates to AIView

8. ACTIONABLE SUGGESTIONS CARD (glass-card):
   - 3-5 numbered suggestions (from AIView)
   - Each suggestion has a glass-button "执行" next to it:
     e.g. "将会议安排在下午低效时段" → "执行" → opens PlanView
   - Suggestions are state-aware: if currently slacking,
     first suggestion becomes "回到工作状态" with urgency styling

FOOTER:
   - "生成完整日报PDF" button (glass-button primary)
   - "分享到团队" button (glass-button secondary)
   - "对比昨日" toggle button (activates comparison mode —
     adds a translucent "yesterday" overlay on all charts)

TRANSITIONS & ANIMATIONS:
   - Page mount: cards stagger-fade-in from top (0.1s delay per card, 0.3s duration)
   - Data refresh: ProgressRing values animate from old→new with 0.5s easing
   - Donut chart: slices grow animation on mount
   - Hover states: all cards use glass-card hover (border brightens + translateY(-2px))
   - Comparison mode: yesterday overlay uses opacity animation (0.5s fade-in)
```

**中文精简版：**

```
重新设计日报视图为高级仪表盘风格。

顶栏：磨砂日期选择器+导出/分享按钮+日期大字

总览英雄卡（4列磨砂卡）：
  工作时长6h42m+微进度环 | 专注评分87+80px动画环(绿黄红渐变) | 摸鱼1h18m+趋势箭头 | 效率评分78+微环
  背景随状态渐变：高专注→绿调，高摸鱼→红调

状态分布卡（双布局）：
  左40%：SVG甜甜圈图，每片=工作态颜色，hover高亮+tooltip，0.5秒增长动画
  右60%：状态表格[徽标|时长|百分比条|趋势箭头]，按时长排序

时间轴总览卡：
  24h色带64px高（不是44px），圆角渐变段+内发光，hover tooltip，点击zoom到5分钟级

峰谷分析卡：
  左：高效时段chips+微折线+最佳时段绿边框高亮
  右：低效时段chips+趋势标记(改善/恶化)

双屏洞察卡：主/副屏top3应用+4并行模式迷你指标

AI洞察卡（可折叠）：
  3个emoji标记关键发现💡⚠️🎯，自然语言+链接到AI画像

行动建议卡：编号建议+每个带"执行"glass-button，摸鱼时首条变紧急样式

底栏：生成PDF/分享/对比昨日切换(叠加昨日透明overlay)

动效：卡片交错淡入(0.1s延迟/卡)、进度环旧→新动画、甜甜圈增长、悬停浮起2px
```

### 1.4 周报视图（Weekly Report）提示词

```
Design the "周报" (Weekly Report) sub-view — 7-day trend analysis dashboard.

LAYOUT:

1. WEEK SELECTOR STRIP:
   - Glass-dropdown: "本周 (7/15-7/21)" / "上周" / "自定义范围"
   - Right: Export button + trend comparison toggle ("vs 上周")

2. WEEKLY OVERVIEW HERO (glass-card, 3-column):
   Col 1: "本周总工作" — "33h 12m" + trend arrow vs last week
   Col 2: "平均专注度" — number + ProgressRing 60px + trend
   Col 3: "本周达成率" — number + ProgressRing 60px + trend

   Below: a 7-day sparkline row — tiny SVG line charts (60×24px each)
     showing focus score per day, connected as a continuous line.
     Each day point: colored dot (green/yellow/red by score).
     Hover: tooltip with day's summary.

3. 7-DAY STACKED BAR CHART (glass-card, full-width):
   - Horizontal bars for each day (Mon→Sun)
   - Each bar stacked by WorkState colors (same as donut chart colors)
   - Bar height proportional to total work time that day
   - Bars have rounded ends and subtle inner gradient
   - Hover on bar segment: tooltip with state+duration
   - Today's bar has a glowing border highlight
   - Below bars: day labels + total time labels
   - Comparison mode: translucent last-week bars overlaid behind current bars

4. WEEKLY HEATMAP (glass-card, enhanced HeatView):
   - 7 × 24 matrix (not 14×24 — focus on current week)
   - Each cell: rounded, with gradient fill (not flat color)
   - Row headers: day names + date
   - Column headers: hours (every 2 hours for readability)
   - Hover: tooltip glass-card with full details
   - "Focus zones" overlay: semi-transparent green rectangles
     highlighting periods where focus > 70% (auto-detected)
   - "Slack zones" overlay: semi-transparent red rectangles

5. PATTERN DETECTION CARD (glass-card, two-column):

   Left: "你的工作模式" (Your Patterns)
     - AI-generated pattern descriptions:
       "你是晨型人：70%的高效工作发生在9:00-12:00"
       "周二和周四是你效率最高的两天"
       "下午14:00-15:00是你的固定摸鱼窗口"
     - Each pattern has a confidence indicator:
       [高置信] [中置信] [低置信] chip

   Right: "模式变化" (Pattern Changes)
     - Comparison with previous weeks:
       "本周上午专注度提升了12% ✓"
       "下午摸鱼窗口从60分钟缩短到45分钟 ✓"
       "周五效率下降10% — 需要关注 ⚠️"

6. WEEKLY ACHIEVEMENT CARD (glass-card):
   - Achievement badges (geometric icon + title + description):
     🏆 "连续5天专注度>80%" (streak badge)
     🔥 "本周编码时间突破20小时"
     💡 "AI开发占比提升15%"
   - Failed achievements (grayed out):
     "计划达成率>90%" — 78% (未达成)
   - Progress toward monthly goals:
     "月度目标: 编码120h — 已完成 78h (65%)"

7. NEXT WEEK FORECAST CARD (glass-card):
   - Based on patterns, predict:
     "预计下周工作时长: 34h (±2h)"
     "建议: 将重要会议移至周二/周四高效时段"
     "风险: 周五可能出现效率低谷"
   - Glass-button: "生成下周计划建议" → navigates to PlanView with AI suggestions

FOOTER:
   - "生成周报PDF" / "发送周报邮件" / "vs上周对比"
```

**中文精简版：**

```
周报视图：7天趋势分析仪表盘。

周选择器+导出+对比上周切换

总览英雄3列：总工作+平均专注+达成率+趋势箭头
下方：7天微折线行(每天一个彩色点，hover看概要)

7天堆叠柱状图：每天一根，按工作态颜色堆叠，圆角渐变，
hover看细节，今天发光边框，对比模式叠加上周透明柱

7×24热度矩阵(不是14×24)：圆角渐变格子，每2小时标签，
hover tooltip，自动检测专注区(绿半透明框)和摸鱼区(红框)

模式检测卡：
  左：AI工作模式描述+"晨型人""周二周四最高效"+置信度chips
  右：vs上周变化"↑12%专注""↓摸鱼15分钟""⚠周五效率降10%"

周成就卡：成就徽章(连胜/突破/提升)+未达成灰化+月度目标进度65%

下周预测卡：预计34h±2h+建议+风险+生成计划按钮

底栏：PDF/邮件/对比上周
```

### 1.5 月报视图（Monthly Report）提示词

```
Design the "月报" (Monthly Report) sub-view — macro trends + goal tracking.

LAYOUT:

1. MONTH SELECTOR: "本月" / "上月" / "近3月" / "自定义范围"

2. MONTHLY OVERVIEW HERO (glass-card, 4-column):
   Col 1: Total work hours — "142h" + vs last month trend
   Col 2: Avg daily focus — number + ring + trend
   Col 3: Plan achievement rate — number + ring + trend
   Col 4: AI usage — calls/tokens/cost summary + trend

3. 30-DAY CALORIE MAP (glass-card):
   - GitHub-contribution-graph style: 30 squares in a 5×6 grid
   - Each square: one day, colored by focus score (green4→green3→green2→green1→gray)
   - Hover: tooltip with that day's key stats
   - Current day: pulsing border
   - Below: "最 productive 日: 7月15日 (专注95)" "最 slack 日: 7月8日 (专注42)"

4. MONTHLY TREND CHARTS (glass-card, 3 stacked charts):
   - Chart 1: "工作时长趋势" — 30-day area chart (SVG)
     Area fill: gradient from accent-green to transparent
     Line: solid accent-green, 2px
     X-axis: days, Y-axis: hours
   - Chart 2: "专注度趋势" — 30-day line chart
     Line color: shifts from green→yellow→red based on value
     Average line: dashed white
   - Chart 3: "摸鱼时长趋势" — 30-day bar chart
     Bars: accent-red with rounded tops
     Average line: dashed

   Each chart: glass-card container, 200px height, clean axes,
   interactive hover (crosshair + value tooltip)

5. GOAL TRACKING CARD (glass-card):
   - Monthly goals (set at start of month or auto-derived from plans):
     Goal 1: "编码120小时" — ProgressRing 80px "78h / 120h (65%)"
     Goal 2: "专注度均分>80" — ProgressRing "78 (未达标)"
     Goal 3: "摸鱼占比<15%" — ProgressRing "16% (接近)"
   - Each goal: green (achieved) / yellow (near) / red (far) ring color
   - "调整目标" glass-button → inline editor

6. MONTHLY AI SUMMARY CARD (glass-card, collapsible):
   - AI-generated monthly insights:
     "本月你的工作效率整体提升了8%，主要得益于上午编码时间的增加"
     "摸鱼模式趋于稳定化，建议在14:00-15:00安排低优先级任务"
   - Key metrics comparison: table with [本月|上月|变化%] columns

7. EXPORT & SHARE FOOTER:
   - "生成月报PDF" / "导出CSV数据" / "团队报表" (if team features exist)
```

### 1.6 自定义报表视图（Custom Report）提示词

```
Design the "自定义" (Custom Report) sub-view — flexible date range analytics.

LAYOUT:

1. RANGE PICKER (glass-card strip):
   - Start date glass-dropdown + End date glass-dropdown
   - Quick range buttons: "近7天" / "近30天" / "近90天" / "今年"
   - Comparison picker: "对比 [上一个周期 / 自定义范围]"
   - Data granularity selector: "5分钟 / 15分钟 / 1小时 / 1天"

2. DYNAMIC CHART AREA (glass-card, full-width, 400px):
   - Based on selected granularity:
     5min → detailed timeline view
     15min → bar/area hybrid
     1hour → area charts
     1day → bar charts + trend lines
   - All charts use SVG (not Chart.js — keep lightweight)
   - Interactive: hover crosshair, click to drill down
   - Y-axis toggle: work hours / focus score / slack ratio

3. METRIC SELECTOR (glass-card sidebar, collapsible):
   - Checkboxes for which metrics to display:
     [✓] 工作时长 [✓] 专注度 [✓] 摸鱼占比 [✓] AI使用 [✓] 达成率
   - Each selected metric gets its own chart layer (stacked or side-by-side)
   - Color coding matches system accent colors

4. COMPARISON OVERLAY (when comparison mode active):
   - Second set of charts in translucent overlay
   - Delta indicators: "+8% vs comparison period" badges
   - Color: comparison period uses muted/dashed lines vs current solid

5. EXPORT BAR:
   - "导出PNG图表" / "导出CSV" / "生成PDF报告" / "复制数据到剪贴板"
```

---

## 二、规划页面优化（PlanView）

### 2.1 现状诊断

| 问题 | 当前状态 | 影响 |
|------|---------|------|
| UI纯功能性 | 简单date input + 统计数字 + checkbox列表 + textarea | 像管理后台，不是效率工具 |
| 缺少时间轴可视化 | 计划只有文字列表，没有可视化时间布局 | 無法直观看到计划如何分布在一天中 |
| 达成率展示简陋 | 数字+纯色进度条 | 没有"计划vs实际"对比视觉 |
| 缺少拖拽排序 | 无法拖拽调整计划优先级和时间 | 手工管理效率低 |
| 自然语言导入粗糙 | 简单textarea + 按钮 | 没有AI辅助解析和预览 |
| 缺少AI计划建议 | 手动规划一切 | AI不参与规划过程 |
| 无进度追踪 | 只有done/cancelled二元状态 | 没有"进行中"和"部分完成" |
| 无关联工作态 | 计划类别5种但不关联WorkState | 无法自动检测"现在在做什么计划" |

### 2.2 PlanView 全面改造提示词

```
Redesign PlanView as a premium "planning cockpit" — not a task list, but a strategic planning + achievement tracking experience.

CORE CONCEPT: "Plan your day, track your execution, learn your patterns"
The view has 3 modes/tabs: "规划" (Plan) / "执行" (Execute) / "复盘" (Review)

=== TAB 1: "规划" (Plan Mode) — Morning planning session ===

LAYOUT:

1. DATE HEADER (glass-card strip, 48px):
   Left: Glass-dropdown date picker (not native input) + "今天" button
   Right: "AI帮我规划" glass-button (brain icon) + "导入" dropdown (手动/oner/日历模板)
   Center: Date in H2 "2026年7月21日 周一"

2. DAY TIMELINE CANVAS (glass-card, full-width, 180px):
   This is the CENTERPIECE of the plan view — a visual timeline, NOT a list.

   - 24-hour horizontal timeline with hour markers (every 2 hours)
   - Time blocks are DRAGGABLE colored rectangles placed on the timeline
   - Each block represents a PlanItem:
     Width = duration (scaled to timeline)
     Color = category color (AI开发紫/客户蓝/领导橙/个人绿/其他灰)
     Label: title text (truncated if too long) inside the block
   - Blocks can be:
     DRAGGED horizontally to change start time
     DRAGGED edges to resize (change duration)
     CLICKED to open inline detail editor
     DOUBLE-CLICKED to mark as "done" (green check overlay)
   - Overlapping blocks stack vertically (max 2 levels — dual-screen metaphor)
   - Empty slots show dashed-border placeholder zones
   - "Now" marker: a vertical glowing line at current time position
   - Below timeline: "已规划 Xh / 24h · 空闲 Yh" summary

3. PLAN DETAIL PANEL (glass-card, appears when a block is clicked):
   Inline editor inside the timeline card, positioned below the clicked block:
   - Title: glass-input (auto-focus on open)
   - Time range: two glass-dropdowns (start/end HH:MM)
   - Duration: auto-calculated, editable glass-input
   - Category: radio pills (5 categories with colored borders)
   - Priority: 3-dot indicator (高/中/低) — new field
   - WorkState mapping: glass-dropdown linking category to expected WorkState
   - Notes: small glass-textarea for context
   - Actions: [保存] [取消] [删除] glass-buttons
   - Keyboard: Enter=save, Esc=cancel

4. AI PLANNING ASSISTANT (glass-card, collapsible sidebar-right or bottom):

   "AI帮我规划" expanded state:
   - Input: glass-textarea "描述你今天要做的事..."
   - AI parses and generates PlanItem suggestions:
     "检测到3个任务：1.完成PRD文档(2h·写作) 2.调试数据质量(3h·编码) 3.团队周会(1h·会议)"
   - Each suggestion: glass-card mini with:
     [Title] [Duration] [Category auto-mapped] [Suggested time slot]
     [接受 ✓] [修改 ✎] [忽略 ✗] buttons
   - Accepted items automatically placed on the timeline at suggested slots
   - "基于历史模式优化安排" toggle:
     AI shifts suggestions to match your peak hours

5. QUICK-ADD BAR (glass-card strip, always visible at bottom):
   - Glass-input + category pills (inline) + duration input + "添加" button
   - Keyboard shortcut: Ctrl+N opens this with auto-focus
   - Or: click empty slot on timeline → opens quick-add at that time position

6. IMPORT PANEL (glass-card, modal overlay):
   - "从自然语言导入": textarea → AI parse → preview suggestions → accept all/selectively
   - "从oner同步": list of oner tasks with checkboxes → import selected
   - "从模板导入": predefined day templates:
     "标准工作日" (8h编码+1h会议+1h写作)
     "会议密集日" (4h会议+3h编码+1h文档)
     "冲刺日" (6h编码+2hAI开发)

=== TAB 2: "执行" (Execute Mode) — Live day tracking ===

This replaces the old "计划vs实际" section with a dynamic, live view.

LAYOUT:

1. LIVE STATUS STRIP (glass-card, 48px):
   Left: Current WorkState StateBadge (live from MonitorView)
   Right: "当前匹配计划: [计划标题]" or "未在执行任何计划 · 空闲中"

2. PLAN-VS-ACTUAL TIMELINE (glass-card, full-width, 240px):
   The KEY visual innovation — dual-layer timeline:

   Top layer (40% height): "计划" — same as Plan Mode timeline blocks
   Bottom layer (60% height): "实际" — real MergedTrail segments
   A vertical "now" line spans both layers

   Each planned block has a MATCH indicator:
   ✓ Green check: actual trail covers ≥80% of planned duration with matching state
   ⚠ Yellow warning: actual covers 50-80% or state mismatch
   ✗ Red cross: actual covers <50% or entirely different state
   ○ Gray circle: not yet started (future plan)

   Between the two layers: a thin "alignment" strip showing
   color-coded match indicators (one per planned item, 20px each)

   Hover on match indicator: tooltip showing
   "计划: 编码3h | 实际: 编码2h15m + 摸鱼45m | 达成率75%"

3. LIVE METRICS CARD (glass-card, 3-column):
   Col 1: "今日达成率" — animated ProgressRing 80px + percentage
   Col 2: "剩余计划" — number of unfinished items + estimated remaining hours
   Col 3: "预计完成时间" — "18:30" calculated from current pace

4. PLAN ITEM CARDS (scrollable list):
   Each PlanItem rendered as a glass-card mini:
   Left: match indicator (✓⚠✗○) + checkbox
   Center: title + time range + category chip
   Right: [实际时长] vs [计划时长] with color-coded comparison
   If currently matching: green glow border
   If slacking instead: red pulsing border + "摸鱼中，该任务进度落后⚠"
   Actions: [完成 ✓] [暂停 ⏸] [取消 ✗]

5. INTERACTIVE ALERTS (floating glass-cards):
   Context-aware alerts that appear during execution:
   - "你正在摸鱼，但计划还有3项未完成" (摸鱼时)
   - "当前任务预计还需30分钟" (进行中时)
   - "下一个计划项'团队周会'将在15分钟后开始" (即将切换时)
   - Each alert: glass-card with [确认] [推迟] [跳过] action buttons
   - Alerts are generated by the monitoring-prediction engine

=== TAB 3: "复盘" (Review Mode) — Evening reflection ===

1. ACHIEVEMENT SUMMARY CARD (glass-card):
   - Large hero: "今日达成率 84%" with ProgressRing 120px
   - "计划6项 · 完成5项 · 取消1项 · 超额完成0项"
   - Achievement badge: if rate ≥90% → 🏆 gold badge, ≥80% → ✅ green, <50% → ⚠️ red

2. WHAT WORKED / WHAT DIDN'T (glass-card, two-column):
   Left: "顺利完成的" — green-listed items with actual>planned insights
   Right: "未能完成的" — red-listed items with root cause suggestions
   AI analysis: "编码任务提前完成，因为上午专注度高于预期"
   "文档写作延迟，因为下午被2个紧急会议打断"

3. TIME AUDIT CARD (glass-card):
   - Pie chart: "计划时间 vs 摸鱼时间 vs 空闲时间 vs 会议溢出"
   - "计划外的摸鱼: 45分钟 — 占用了编码时间"
   - "会议超时: 30分钟 — 推迟了后续计划"

4. TOMORROW PREVIEW (glass-card):
   - "基于今日复盘，明天建议:"
   - AI suggestions for tomorrow's plan
   - "将文档写作安排在上午高效时段"
   - "为会议预留30分钟缓冲"
   - Glass-button: "采纳建议 → 规划明天"

5. REFLECTION INPUT (glass-card):
   - Optional: "今日感想..." textarea for personal notes
   - Save to daily notes (linked to CalendarView entries)
```

**中文精简版：**

```
PlanView全面改造为"规划驾驶舱"——3模式：规划/执行/复盘

规划模式（早晨）：
  日期磨砂选择器+AI规划按钮+导入下拉
  核心创新——日时间轴画布(180px)：
    24h水平轴，计划块=可拖拽彩色矩形，拖改时间/拖边改时长/点击编辑
    双层叠放(双屏隐喻)，空位虚线框，now发光竖线
  点击块→内联编辑器(标题/时间/类别/优先级/工作态映射)
  AI规划助手：textarea输入→AI解析3任务建议→每条接受/修改/忽略→基于历史优化
  快捷添加条+Ctrl+N+点击空位直接添加
  导入模态：自然语言/oner同步/日模板(标准日/会议密集/冲刺日)

执行模式（实时）：
  实时状态条=当前WorkState徽标+匹配计划名
  核心——双层时间轴(240px)：
    上40%=计划块，下60%=实际轨迹，now线贯穿
    每个计划块匹配指标：✓≥80%绿/⚠50-80%黄/✗<50%红/○未来灰
    中间alignment strip=彩色匹配指示
    hover tooltip："计划编码3h|实际2h15m+摸鱼45m|达成75%"
  实时指标卡：达成率环+剩余计划+预计完成时间18:30
  计划项卡片：匹配指示+checkbox+实际vs计划对比+摸鱼红脉冲边框
  浮动交互提醒："摸鱼中但3项未完成"/"还需30分钟"/"15分钟后周会"

复盘模式（傍晚）：
  大达成率英雄84%+120px环+成就徽章
  顺利/未完成双列+AI归因分析
  时间审计饼图+计划外摸鱼/会议超时
  明天建议+采纳→规划明天
  今日感想textarea
```

### 2.3 PlanItem 数据模型升级提示词

```
Upgrade the PlanItem data model to support the new PlanView features.

CURRENT MODEL (from src/shared/types.ts):
  PlanItem {
    id, extId?, date, startMin?, endMin?, durationMin?,
    title, category (5 enum), source (3 enum),
    status (planned/done/cancelled)
  }

NEW MODEL — add these fields:
  PlanItem {
    ...existing fields,
    priority: 'high' | 'medium' | 'low',           // 优先级
    expectedState: WorkStateKey?,                    // 期望工作态映射
    actualStartMin?: number,                         // 实际开始时间
    actualEndMin?: number,                           // 实际结束时间
    actualDurationMin?: number,                      // 实际时长
    actualState?: WorkStateKey,                      // 实际工作态
    matchScore?: number,                             // 匹配度 0-100
    notes?: string,                                  // 备注
    tags?: string[],                                 // 自定义标签
    breakMin?: number,                               // 计划内休息时间
    bufferMin?: number,                              // 前后缓冲时间
    parentId?: string,                               // 父任务ID(子任务支持)
    order: number,                                   // 显示排序
  }

NEW ENUMS:
  Priority: 'high' | 'medium' | 'low'
  PlanStatus: 'planned' | 'in_progress' | 'paused' | 'done' | 'cancelled' | 'partial'

NEW CALCULATED FIELDS (in planAnalysis.ts):
  - matchScore: how well actual execution matched the plan
    Formula: weighted( timeCoverage × 0.5 + stateMatch × 0.3 + durationMatch × 0.2 )
    timeCoverage: actual minutes within plan time range / planned minutes
    stateMatch: 1.0 if actualState === expectedState, 0.5 if related, 0.0 if unrelated
    durationMatch: min(actualDuration, plannedDuration) / max(actualDuration, plannedDuration)

  - predictedEndTime: based on current pace and remaining items
    Formula: now + (remainingPlannedMin / currentEfficiencyRate)

  - dayAchievementRate: sum(matchScore for all non-cancelled items) / count(non-cancelled items)

STORE UPDATES (planStore.ts):
  Add computed getters:
  - todayItems: filtered by current date
  - activeItem: the plan item currently being executed (matched to current WorkState)
  - completionRate: done items / total non-cancelled items
  - matchRate: average matchScore for done items
  - remainingWork: sum of durationMin for planned/in_progress items not yet done
  - predictedEndTime: calculation as above
```

---

## 三、日历页面优化（CalendarView）

### 3.1 现状诊断

| 问题 | 当前状态 | 影响 |
|------|---------|------|
| 只有日视图 | 24h色带 + 7天柱状图 | 无周/月视图切换 |
| 色带太窄 | 44px高度 | 细节难以辨认 |
| 色带交互弱 | 只能点击空白补录 | 无法点击已有段查看详情、拖拽调整 |
| 补录表单简陋 | 原生input + 状态下拉 | 没有时间智能、没有AI辅助 |
| 7天柱状图粗糙 | 纯CSS柱子 | 无hover详情、无趋势线 |
| 无日历网格 | 没有传统月历网格 | 很多用户习惯月历视图 |
| 无搜索/过滤 | 不能按状态/应用筛选 | 找特定记录困难 |
| 录入条目展示平 | 简单列表行 | 无分组、无时间轴对应 |

### 3.2 CalendarView 全面改造提示词

```
Redesign CalendarView as a rich, multi-view calendar experience —
not just a 24h strip, but a full calendar application.

CORE CONCEPT: 3 view modes + rich interactions + AI-assisted entry

VIEW MODES (tab switcher at top):
  "日视图" (Day) / "周视图" (Week) / "月视图" (Month)

=== DAY VIEW (enhanced current view) ===

1. DATE NAVIGATION (glass-card strip, 48px):
   Left: [<] [>] navigation arrows (glass-buttons) + date glass-dropdown
   Center: "2026年7月21日 周一" H2
   Right: [今天] [日|周|月] view toggle pills + [过滤] filter button

2. DAY STATS STRIP (glass-card, 48px):
   Inline stats: "总工作6h42m · 摸鱼1h18m · 专注87 · 双屏3h12m"
   Each metric: colored chip with icon + value
   Click on chip → scrolls to relevant section in the timeline

3. ENHANCED TIMELINE (glass-card, full-width, 200px minimum):
   The UPGRADED 24h timeline — much richer than current 44px strip:

   - Height: 200px (not 44px!) — allows detailed rendering
   - Y-axis: 2 rows — "主屏" (top) + "副屏" (bottom) if dual data exists
   - Each segment rendered as a gradient-filled rounded rectangle:
     Width: proportional to duration (min 12px for visibility)
     Height: 70px per row
     Fill: gradient from state color (top) to darker shade (bottom)
     Inner: state emoji (16px) + short label (truncated)
     Border: subtle glow matching state color
   - Hover on segment:
     Segment lifts up 4px + border brightens
     Tooltip glass-card appears showing:
     [StateBadge] · [Start-End时间] · [时长] · [应用名] · [窗口标题]
     [编辑 ✎] [删除 ✗] quick-action buttons inside tooltip
   - Click on segment:
     Opens INLINE detail panel below the timeline (not modal)
     Shows: full state info + app details + duration breakdown + notes field
     Editable: can change state, adjust time, add notes
   - Empty gaps: show dashed-border zones with hint "点击补录"
   - "Now" marker: vertical glowing accent-blue line + small "现在" label
   - Current segment: pulsing border animation (1.5s cycle)

4. 5-MINUTE DETAIL ZOOM (glass-card, expandable):
   Click any hour on the timeline → expand a 5-minute resolution view below:
   - Shows the selected hour as 12 × 5min blocks (48px each)
   - Each block: mini colored rectangle with state indicator
   - Allows precise time editing at 5-minute granularity
   - Collapse button to return to normal view

5. AI-ASSISTED ENTRY FORM (glass-card, modal/inline):
   Replace the current bare-bones form with a smart glass-card form:

   - "快速补录" mode (default):
     Start time glass-dropdown (HH:MM, auto-filled to last empty slot)
     End time glass-dropdown (auto-calculated from start + estimated duration)
     Duration auto-display: "1h 30m" (editable)
     AI Suggestion strip:
       "根据历史模式，这个时间段你通常在做: [编码 65%] [写作 20%] [会议 15%]"
       Click suggestion → auto-fill state field
     State selector: visual grid (not dropdown) — 4×3 grid of state cards:
       Each card: colored mini-block + emoji + label
       Click → selects, highlighted with border glow
     Title: glass-input with AI autocomplete:
       "你在9:00-10:30通常在做什么？" → suggests based on patterns
     Notes: small glass-textarea
     [保存] [取消] glass-buttons
     Keyboard: Ctrl+S = save

   - "自然语言录入" mode (toggle):
     Single glass-textarea: "上午9点到10点半写PRD文档"
     AI parses → fills all fields automatically → preview → confirm
     Handles: time ranges, durations, states, titles from one sentence

6. ENTRY LIST (glass-card, grouped):
   Replace flat list with grouped display:
   - Group by state (not flat chronological):
     "专注工作 3项" → "编程 2项 · 写文档 1项"
     "摸鱼 2项" → "刷手机 1项 · 社交聊天 1项"
   - Each group: collapsible section with state-colored header
   - Each entry: glass-card mini with:
     [Time range] [StateBadge] [Title] [Source chip] [Delete button]
     Hover: highlights corresponding segment on timeline (synced scroll)
   - Total summary at bottom: "今日共8条 · 手动3条 · 监控5条"

7. WEEK MINI-BAR (glass-card, same as current but enhanced):
   - 7-day bars: gradient-filled (not flat color) with rounded tops
   - Hover on bar: tooltip with day's quick stats
   - Click: navigates to that day's view
   - Today: glowing accent-blue border
   - Below bars: micro focus-score dots per day (colored circles)

=== WEEK VIEW (NEW) ===

1. WEEK GRID (glass-card, full-width):
   - 7 columns (Mon→Sun) × 24 rows (hours)
   - Each cell: 40×30px, colored by dominant WorkState
   - Cell opacity: proportional to activity duration within that hour
   - Hover: tooltip with hour summary
   - "Now" marker: row highlight at current hour + column highlight at current day

2. WEEK OVERVIEW STRIP (glass-card):
   - 7-day summary: for each day show:
     Mini timeline bar (60px wide) + total time + focus score chip
   - "最 productive 日" and "最 slack 日" highlights

3. WEEK COMPARISON:
   "vs 上周" toggle: overlays last week's data as translucent pattern

=== MONTH VIEW (NEW) ===

1. MONTH CALENDAR GRID (glass-card):
   - Traditional month grid: 7 columns × 5-6 rows
   - Each day cell (80×60px):
     Top: date number + day name
     Middle: mini timeline bar (horizontal, 60px, same as 24h strip but tiny)
     Bottom: focus score dot (green/yellow/red) + total time label
   - Today cell: accent-blue glowing border + "今天" label
   - Hover: tooltip glass-card with day summary
   - Click: switches to Day View for that date

2. MONTH STATS SUMMARY (glass-card):
   - "本月工作: 142h · 平均专注: 78 · 达成率: 84%"
   - Mini sparkline of daily focus scores (30 dots)
   - "最 productive 周: 第3周" highlight

=== GLOBAL FEATURES (all views) ===

1. FILTER PANEL (glass-card, toggle-able sidebar):
   - Filter by: WorkState (multi-select checkboxes with colored dots)
   - Filter by: App name (search input + common apps chips)
   - Filter by: Duration range (slider: min-max)
   - Filter by: Source (监控/手动/导入)
   - Active filter count badge on the filter button
   - Filters affect both timeline and entry list

2. SEARCH (glass-card, Cmd/Ctrl+F):
   - Search across all entries: title, app, state, notes
   - Results shown as highlighted segments on timeline + filtered entry list
   - "找到3条匹配 '编码' 的记录"

3. VIRTUAL PERSON SYNC (new feature):
   - Timeline segments linked to virtual person state changes
   - Hover on timeline segment: virtual person preview (mini avatar 40px)
     showing what the character was doing at that time
   - "重播今天" button: plays back the day as a 60-second animation
     showing virtual person cycling through all states in sequence
     with timeline cursor moving along

4. EXPORT & SHARE:
   - "导出日历数据" glass-dropdown: CSV / JSON / PDF
   - "截图时间轴" button: captures current view as PNG
   - "分享今日报告" → generates a shareable summary card (image)
```

**中文精简版：**

```
CalendarView全面改造为3模式日历：日/周/月

日视图（升级版）：
  磨砂导航条+日期大字+日/周/月切换pills+过滤按钮
  统计条：总工作·摸鱼·专注·双屏 colored chips

  核心——增强时间轴(200px不是44px！)：
    双行(主屏+副屏)，段=渐变圆角矩形+emoji+短标签+发光边框
    hover浮起4px+tooltip(徽标/时间/时长/应用/标题/编辑删除按钮)
    点击→内联详情面板(非模态)
    空位虚线框"点击补录"，now发光蓝竖线，当前段脉冲边框

  5分钟级zoom：点击小时→展开12×5min块，精确编辑
  AI智能补录表单(非裸input)：
    快速模式：智能时间填充+AI建议"这个时段你通常做什么"+状态选择4×3视觉网格+标题AI自动补全
    自然语言模式："上午9点到10点半写PRD"→AI解析填所有字段
  录入列表分组(按状态分组，非平面列表)：每组可折叠，hover高亮时间轴对应段

  7天迷你柱(增强)：渐变填充+hover概要+微专注度点

周视图(新增)：7×24网格+周概要条+vs上周对比
月视图(新增)：月历网格+每天迷你时间轴+专注点+月统计

全局：过滤面板(状态/应用/时长/来源)、Cmd+F搜索、虚拟人同步(段hover显示迷你角色)、
重播今天60秒动画、导出CSV/JSON/PDF/截图PNG/分享图片
```

### 3.3 CalendarView 数据模型升级提示词

```
Upgrade CalendarView data structures for the new features.

CURRENT DATA:
  - MergedTrail { segments: TrailSegment[], totalMin, dualMin }
  - TrailSegment { startMin, endMin, state, app?, title?, screen? }
  - TimeEntry { id, date, startMin, endMin, state, title?, source, notes? }

NEW DATA STRUCTURES:

  CalendarDaySummary {
    date: string,                  // YYYY-MM-DD
    totalWorkMin: number,
    totalSlackMin: number,
    focusScore: number,            // 0-100
    dualScreenMin: number,
    dominantState: WorkStateKey,
    peakHour: number,              // most productive hour (0-23)
    dipHour: number,               // least productive hour
    entryCount: number,
    achievementRate: number,       // from PlanView
    stateDistribution: Map<WorkStateKey, number>,  // minutes per state
  }

  CalendarWeekSummary {
    weekStart: string,             // Monday date
    days: CalendarDaySummary[],    // 7 items
    totalWorkMin: number,
    avgFocusScore: number,
    bestDay: string,               // date of highest focus
    worstDay: string,
    weekAchievementRate: number,
  }

  CalendarMonthSummary {
    month: string,                 // YYYY-MM
    days: CalendarDaySummary[],    // 28-31 items
    weeks: CalendarWeekSummary[],  // 4-5 items
    totalWorkMin: number,
    avgFocusScore: number,
    bestWeek: number,              // week number
    trendDirection: 'up' | 'down' | 'stable',
  }

  EnhancedTimeEntry extends TimeEntry {
    appId?: string,                // matched app identifier
    confidence: 'high' | 'medium' | 'low',  // state detection confidence
    virtualPersonState?: string,   // linked virtual person animation state
    planItemId?: string,           // linked to PlanItem if matched
    tags?: string[],               // user tags
  }

STORE UPDATES:
  Add calendarStore (Zustand):
  - currentView: 'day' | 'week' | 'month'
  - currentDate: Date
  - filters: CalendarFilters
  - searchQuery: string
  - getDaySummary(date): CalendarDaySummary
  - getWeekSummary(weekStart): CalendarWeekSummary
  - getMonthSummary(month): CalendarMonthSummary
  - getFilteredEntries(date, filters): EnhancedTimeEntry[]
  - replayDay(date): ReplaySession  // for virtual person playback
```

---

## 四、三视图联动交互提示词

### 4.1 视图间数据联动

```
Design cross-view data synchronization and navigation for the 3 enhanced views.

CORE PRINCIPLE: "Click anywhere, navigate everywhere"
All 3 views share the same date context and data layer.

LINKED NAVIGATION:
  - CalendarView → click on a day → switches to that day + scrolls to clicked time
  - CalendarView → click "查看计划" chip → navigates to PlanView Execute mode for that day
  - CalendarView → click "查看报表" chip → navigates to ReportView Daily for that day
  - PlanView → click timeline block → CalendarView highlights that time range
  - PlanView → click achievement rate → ReportView shows detailed breakdown
  - ReportView → click any metric → CalendarView highlights relevant segments
  - ReportView → click "查看计划" → PlanView for that day

SHARED DATE CONTEXT:
  - Global date state in a shared Zustand store
  - Changing date in any view updates all views
  - "今天" button in any view resets all views to today

DATA SYNC:
  - PlanItem.matchScore updates in real-time as MonitorView detects state changes
  - CalendarView segments get match indicators (✓⚠✗) from PlanView
  - ReportView metrics pull from both CalendarView (raw data) and PlanView (achievement)

VIRTUAL PERSON INTEGRATION:
  - All 3 views have a "虚拟人" mini-preview (40px) synced with current WorkState
  - CalendarView "重播" feature plays back virtual person states
  - PlanView execute mode shows virtual person matching current plan item
  - ReportView shows virtual person state distribution as animated gallery
```

### 4.2 虚拟人与三视图联动

```
Design the virtual person's interaction with all 3 enhanced views.

CALENDAR VIEW联动:
  - Timeline hover: show mini virtual person (40px) at that time's state
  - "重播今天" button: 60-second animation playback
    Virtual person walks through all state transitions chronologically
    Timeline cursor moves in sync
    Speed: 1 real hour = 2.5 playback seconds (8h day = 20s)
    Controls: [播放] [暂停] [快进2x] [跳到现在]
  - Empty slots: virtual person appears as idle/sleeping mini version
  - Slack segments: virtual person appears with "操心" expression overlay

PLAN VIEW联动:
  - Plan mode: virtual person "helps" plan —
    appears next to AI planning assistant, nodding/pointing at suggestions
  - Execute mode: virtual person mirrors current matched plan item
    If on-plan: happy expression + "干得漂亮！" occasional text bubble
    If off-plan (slacking): angry expression + "你不是应该在做XX吗？"
    If behind schedule: worried expression + "进度落后了..."
  - Review mode: virtual person "reflects" —
    thumbs-up for achievements, head-shake for failures

REPORT VIEW联动:
  - Daily report: virtual person "presents" the report —
    stands next to overview hero card like a news anchor
    Changes expression as you scroll through sections (happy→serious→concerned)
  - Achievement badges: virtual person "wears" the badge (small icon on chest)
  - Pattern detection: virtual person "acts out" the pattern
    "你是晨型人" → virtual person yawns at afternoon slot
  - Forecast: virtual person "predicts" — crystal ball gesture for next week

INTERACTIVE MOMENTS:
  - Report achievement ≥90%: virtual person celebration animation (fireworks + dance)
  - Plan achievement <50%: virtual person sits down disappointed + motivational text
  - Calendar "重播" ending: virtual person waves goodbye + "明天继续加油！"
```

---

## 五、组件升级提示词（共享基础设施）

### 5.1 ProgressRing 升级

```
Upgrade the ProgressRing component (src/renderer/src/components/ProgressRing.tsx)

CURRENT: Basic SVG circle with stroke-dasharray animation.

NEW FEATURES:
  - Size variants: 28px (mini) / 60px (medium) / 80px (large) / 120px (hero)
  - Animated value transition: when value changes, arc smoothly grows/shrinks
    Use requestAnimationFrame with easing (cubic-bezier 0.4, 0, 0.2, 1)
  - Color gradient along the arc: start-color → end-color
    Focus: #6bd8a8 → #4ade80 (green gradient)
    Slack: #ff7c7c → #ef4444 (red gradient)
    Work: #7c9eff → #3b82f6 (blue gradient)
  - Glow effect: matching-color outer glow on the arc (filter: drop-shadow)
  - Center content: customizable — number, emoji, or mini icon
  - Background track: subtle dashed circle (not solid) for "target" feel
  - Threshold indicators: at 50% and 80%, small tick marks on the track
  - Pulse animation on value change: ring briefly scales 1.05x then returns
  - Interaction: hover shows tooltip with exact value + label

IMPLEMENTATION:
  Use SVG with:
  - <defs> for linearGradient (arc color) and filter (glow)
  - Two <circle>: background track (dashed, muted) + value arc (gradient, animated)
  - CSS transition on stroke-dashoffset for smooth value change
  - Center <text> for value display
```

### 5.2 StateBadge 升级

```
Upgrade StateBadge component.

CURRENT: Simple flex row: colored dot + emoji + label text.

NEW FEATURES:
  - Size variants: 'sm' (18px dot, inline) / 'md' (24px, card) / 'lg' (32px, hero)
  - Pulse animation: dot pulses gently (1.5s cycle) when state is ACTIVE
  - Color modes:
    'dot' — current colored circle (default)
    'bg' — full background tint (for cards/headers)
    'glow' — dot + outer glow ring (for hero displays)
  - Interactive: click on badge → opens state detail popover
  - Hover: badge lifts 2px + shadow deepens
  - Transition: when state changes, old badge fades out (0.15s) → new fades in (0.15s)
    Emoji cross-fades, dot color shifts, label text slides
```

### 5.3 Card 组件升级

```
Upgrade Card component (src/renderer/src/components/Card.tsx)

CURRENT: bg-ink-900 border border-ink-700 rounded-xl — flat dark card.

NEW: Glass-morphism card system.

.glass-card:
  background: rgba(18,22,31,0.75);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 16px;
  backdrop-filter: blur(12px) saturate(1.2);
  box-shadow: 0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04);
  padding: 16px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

.glass-card:hover:
  border-color: rgba(255,255,255,0.12);
  box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06);
  transform: translateY(-2px);

.glass-card.active (state-aware):
  border-color: var(--border-active);  // accent color border
  box-shadow: var(--glow-[state]), 0 4px 24px rgba(0,0,0,0.3);

.glass-card.hero (large overview cards):
  padding: 24px;
  border-radius: 20px;

.glass-card.mini (small inline cards):
  padding: 8px 12px;
  border-radius: 12px;

Card component props:
  variant: 'default' | 'active' | 'hero' | 'mini'
  stateColor?: string  // for active variant glow
  collapsible?: boolean  // adds expand/collapse toggle
  onCollapseToggle?: (expanded: boolean) => void
```

### 5.4 EmptyState 升级

```
Upgrade EmptyState component.

CURRENT: Simple title + hint text.

NEW: Geometric line-art illustration + headline + action suggestion.

Each empty state has a themed illustration (SVG, inline):
  - CalendarView empty: A clock face with no hour marks, just the frame
  - PlanView empty: An empty desk with a notepad waiting
  - ReportView empty: A blank chart frame with a cursor blinking
  - MonitorView empty: A dormant robot face with closed eyes

Each illustration: 120×80px, stroke-only style (no fill),
  stroke color: var(--text-muted) #5a6478,
  stroke width: 1.5px, line-join: round.

Text hierarchy:
  Headline: 16px/600, var(--text-secondary) "还没有今日记录"
  Suggestion: 13px/400, var(--text-muted) "开始专注，让时间留下痕迹"
  Action button: glass-button "开始记录" (if applicable)

Animation: illustration has a gentle idle animation —
  Clock: pendulum swing ±5° every 2s
  Desk: subtle shadow shift
  Chart: cursor blink every 1s
```

---

## 六、右下角悬浮窗优化提示词

### 6.1 现状诊断

当前悬浮窗（320×420）：PetAvatar + 状态信息 + 上下文卡片 + 底部按钮行

### 6.2 悬浮窗全面改造提示词

```
Redesign the WorkOn widget window (320×420) as a compact but rich "mission pod".

LAYOUT (top-to-bottom):

1. HEADER BAR (40px, glass-strip):
   Left: Virtual Person mini-avatar (48px) — animated, shows current state
     Click avatar: opens full BuddyView in main window
   Center: StateBadge 'sm' + duration "2h 15m" + app name (truncated)
   Right: Mini ProgressRing 28px (focus score) + expand button [↗]

2. CONTEXT CARD (dynamic, 120-160px):
   Changes based on current WorkState and plan matching:

   When ON-PLAN (matching a PlanItem):
     Glass-card showing:
     - Plan title + category chip
     - "计划 3h · 已做 1h 45m · 还需 1h 15m"
     - Mini progress bar (plan progress)
     - "预计完成 15:30"

   When SLACKING (off-plan):
     Glass-card with WARNING styling (accent-red border):
     - "⚠ 当前: 摸鱼中" in red
     - "计划还有3项未完成"
     - "进度落后 15% — 预计加班到19:00"
     - [回到工作] [推迟计划] [接受落后] quick-action glass-buttons
     - Virtual person: angry expression overlay on avatar

   When IDLE (no active plan):
     Glass-card with SUGGESTION styling:
     - "空闲中 · 建议开始一项任务"
     - Top 3 suggested tasks from today's plan (if any unstarted)
     - [开始任务1] [开始任务2] quick-action buttons
     - Virtual person: sleepy/bored expression

   When BREAKING:
     Glass-card with RELAX styling:
     - "休息中 · 已休息15m · 建议休息30m后继续"
     - "距离下一个计划项还有20分钟"
     - Virtual person: happy/sipping-coffee expression

3. SMART ALERTS (floating glass-card, 60px, appears contextually):
   - Only shown during critical moments:
     "摸鱼超过15分钟 — 进度可能完不成" (urgent)
     "距离会议还有10分钟" (reminder)
     "今天的工作已完成! 🎉" (achievement)
   - Auto-dismiss after 10s, or click to act
   - Maximum 1 alert at a time (priority queue)

4. QUICK ACTIONS BAR (glass-card strip, 40px):
   - 4 icon glass-buttons:
     [📋 计划] → opens PlanView execute mode
     [📊 日报] → opens ReportView daily
     [⏰ 补录] → opens CalendarView entry form
     [⚙ 设置] → opens settings
   - Button hover: tooltip with label + icon scales 1.15x
   - Active button: glow matching current state accent

5. VIRTUAL PERSON ZONE (60px, bottom):
   - Mini virtual person (40px) walking/idling on a tiny "desk" surface
   - Interactive: click → wave animation, drag → lift animation
   - Synced with main BuddyView: same state, same personality
   - Occasionally shows text bubbles:
     ARIA: "专注度85%"
     LUNA: "加油哦♡"
     KIRA: "你还在摸鱼？！"
     ZEN: "随缘~"
     SHIN: "deadline倒计时: 2h"

WIDGET STATE TRANSITIONS:
   - On-plan → Off-plan: avatar expression morphs (0.3s), card slides out/in (0.3s)
   - Idle → Working: avatar wakes up animation, card fades in
   - Alert appears: slides in from top (0.2s), auto-dismiss fades out (0.2s)
   - Focus score change: mini ring animates value

WIDGET OPACITY/POSITION:
   - Keep current opacity slider and position drag
   - When slacking >30min: widget border pulses red (gentle reminder)
   - When focused >1h: widget gets a subtle green glow border (positive feedback)
```

**中文精简版：**

```
悬浮窗改造为"任务舱"(320×420)：

顶栏40px：虚拟人迷你头像48px(点击→全屏桌宠)+StateBadge+时长+应用+迷你专注环+展开按钮

上下文卡(动态120-160px)：
  匹配计划→计划标题+进度条+"预计15:30完成"
  摸鱼→红色警告边框+"进度落后15%预计加班到19:00"+[回到工作/推迟/接受]按钮+虚拟人愤怒脸
  空闲→建议卡+3个未开始任务快选+虚拟人无聊脸
  休息→放松卡+"建议30分钟后继续"+虚拟人喝咖啡脸

智能提醒(浮动60px)：
  "摸鱼超15分钟进度完不成"/"会议10分钟后"/"今天完成!🎉"
  10秒自动消失，优先级队列，最多1条

快操条40px：4图标按钮[计划/日报/补录/设置]

虚拟人区60px底部：迷你角色40px在微型桌面行走，点击→挥手，拖拽→提起
  常显文字泡：ARIA"85%" / LUNA"加油♡" / KIRA"还摸？！" / ZEN"随缘" / SHIN"deadline2h"

状态过渡0.3s，摸鱼>30min红脉冲边框，专注>1h绿发光边框
```

---

## 七、图标体系优化提示词

### 7.1 导航图标升级

```
Replace all navigation icons with a consistent Lucide icon set + state-aware styling.

CURRENT: 8 icons in a flat row, no grouping, no active highlighting.

NEW NAVIGATION (left sidebar, 56px width):

GROUP 1 — 时间 (Time):
  日历: Lucide "calendar-days" (outline → filled on active)
  监控: Lucide "activity" (outline → filled)

GROUP 2 — 分析 (Analysis):
  热度: Lucide "flame" (outline → filled)
  报表: Lucide "bar-chart-3" (outline → filled) — NEW
  画像: Lucide "brain" (outline → filled)

GROUP 3 — 规划 (Planning):
  计划: Lucide "target" (outline → filled)
  问答: Lucide "message-circle" (outline → filled) — moves inside Report as sub-feature

GROUP 4 — 伙伴 (Companion):
  桌宠: Lucide "cat" (outline → filled) — or custom pet icon

GROUP 5 — 系统:
  设置: Lucide "settings" (outline → filled)

STYLING:
  Default: stroke icon, color: var(--text-muted) #5a6478
  Hover: filled variant, color: var(--text-secondary) #8a93a6, scale 1.1x, glow
  Active: filled variant, color: STATE-AWARE accent color (focus→green, coding→blue, slack→red)
    Background: subtle accent-colored glow behind the icon (8px circle)
  Group dividers: 1px horizontal line, color: var(--border-subtle)

TRANSITION:
  Icon change: stroke→filled morphs in 0.2s (if possible with SVG path animation)
  Color shift: 0.3s transition
  Glow: fades in/out 0.3s
```

### 7.2 应用内图标统一

```
Create a consistent icon system for all in-app UI elements.

ICON SOURCE: Lucide Icons (React package: lucide-react)
  Already a standard, clean, consistent set.

APPLICATION ICON MAPPING (for app detection display):
  Instead of generic emoji, use branded/app-specific mini-icons:
  - VS Code → custom mini-code editor icon (or lucide "code-2")
  - Chrome → custom mini-browser icon (or lucide "globe")
  - WeChat → custom mini-chat icon (or lucide "message-circle")
  - Word/Excel → lucide "file-text" / "table"
  - Terminal → lucide "terminal"
  - Slack/Discord → lucide "hash" / "gamepad-2"
  - Figma → lucide "palette"
  - Default → lucide "app-window"

  Implementation: create an appIconMap (Map<string, LucideIconName>)
  in src/renderer/src/lib/appIcons.ts

STATE ICON MAPPING:
  focus → lucide "focus"
  coding → lucide "code-2"
  writing → lucide "pen-line"
  meeting → lucide "video"
  aiqa → lucide "sparkles"
  aidev → lucide "robot"
  slack → lucide "coffee" (not emoji — more subtle)
  idle → lucide "moon"
  break → lucide "cup-soda"
  away → lucide "log-out"
  relax → lucide "music"
  lunch → lucide "utensils"
  remote → lucide "wifi"

ACTION ICONS:
  add → lucide "plus"
  edit → lucide "pencil"
  delete → lucide "trash-2"
  save → lucide "check"
  cancel → lucide "x"
  export → lucide "download"
  share → lucide "share-2"
  search → lucide "search"
  filter → lucide "filter"
  refresh → lucide "refresh-cw"
  expand → lucide "expand"
  collapse → lucide "minimize-2"
  settings → lucide "settings"
  help → lucide "help-circle"
  alert → lucide "alert-triangle"
  info → lucide "info"
  success → lucide "check-circle"
  warning → lucide "alert-circle"
```

---

## 八、动效体系提示词

```
Design a comprehensive animation/transition system for WorkOn.

ANIMATION HIERARCHY (3 levels):

Level 1 — STRUCTURAL (page-level, 0.3-0.5s):
  - View switch: fade-out current (0.15s) → fade-in new (0.15s) + slide-right 20px
  - Tab switch within view: fade cross-fade (0.2s) + content stagger-in
  - Modal open: scale from 0.95 → 1.0 (0.2s) + fade-in
  - Modal close: reverse

Level 2 — COMPONENT (card-level, 0.2-0.3s):
  - Card hover: translateY(-2px) + border brighten + shadow deepen (0.2s)
  - Card mount: fade-in + translateY(8px→0) (0.3s, staggered per card)
  - Card data update: content cross-fade (0.2s)
  - ProgressRing value change: arc stroke-dashoffset animation (0.5s, eased)
  - Badge state change: old fades out → new fades in (0.15s each)
  - Timeline segment hover: translateY(-4px) + glow (0.2s)
  - Plan block drag: scale(1.05) + shadow increase + opacity 0.9

Level 3 — MICRO (detail-level, 0.1-0.15s):
  - Button hover: scale(1.02) + border-flash
  - Button press: scale(0.97) + brief border-color change
  - Input focus: border-color transition + subtle glow
  - Chip hover: background shift + scale(1.05)
  - Icon hover: scale(1.15) + color shift
  - Tooltip appear: fade-in + translateY(4px→0) (0.1s)
  - Alert appear: slide-in from top (0.2s)
  - Alert dismiss: slide-out + fade (0.2s)

VIRTUAL PERSON ANIMATIONS:
  - State transition: expression morph (0.3s, mesh morph target interpolation)
  - Idle animation: breathing cycle + micro-movements (continuous, varies by state)
  - Drag interaction: lift → float → bounce-settle (physics simulation)
  - Click reaction: blink → expression change → return (0.5s total)
  - Alert overlay: walk to screen center (1.0s) + gesture + text bubble (0.5s)
  - Celebration: jump + spin + particle burst (1.5s)

PERFORMANCE GUIDELINES:
  - Use CSS transitions for Level 1-2 (GPU-accelerated: transform, opacity)
  - Use requestAnimationFrame for Level 3 + virtual person (JS-driven)
  - Virtual person animations: run at 30fps, pause when window minimized
  - Timeline animations: use CSS only (no JS animation loops for timeline segments)
  - Maximum concurrent animations: 3 structural + 5 component + unlimited micro
  - Animation disable: respect prefers-reduced-motion media query
    If reduced-motion: all durations become 0.01s (near-instant, not zero)
```

---

## 九、完整CSS变量体系（升级版）

```css
/* WorkOn v2.2 Design System — Complete CSS Custom Properties */

:root {
  /* === DEEP SPACE BACKGROUND === */
  --bg-deep: #0a0d14;
  --bg-surface: #12161f;
  --bg-elevated: #1a2030;
  --bg-glass: rgba(18, 22, 31, 0.75);
  --bg-glass-heavy: rgba(18, 22, 31, 0.88);
  --bg-hover: rgba(26, 32, 48, 0.6);

  /* === BORDERS === */
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.08);
  --border-active: rgba(124, 158, 255, 0.3);
  --border-danger: rgba(255, 124, 124, 0.3);
  --border-success: rgba(107, 216, 168, 0.3);

  /* === TEXT === */
  --text-primary: #e8edf5;
  --text-secondary: #8a93a6;
  --text-muted: #5a6478;
  --text-accent: #7c9eff;
  --text-danger: #ff7c7c;
  --text-success: #6bd8a8;

  /* === ACCENT COLORS (STATE-AWARE) === */
  --accent-focus: #6bd8a8;      /* 专注绿 */
  --accent-work: #7c9eff;       /* 工作蓝 */
  --accent-ai: #9b8cff;         /* AI紫 */
  --accent-slack: #ff7c7c;      /* 摸鱼红 */
  --accent-warm: #ffb86b;       /* 暖色橙 */
  --accent-creative: #ff6b9d;   /* 创意粉 */
  --accent-urgent: #ff4444;     /* 紧急红 */
  --accent-success: #6bd8a8;    /* 成功绿 (same as focus) */
  --accent-neutral: #8a93a6;    /* 中性灰 */

  /* === GLOW EFFECTS === */
  --glow-focus: 0 0 20px rgba(107, 216, 168, 0.15);
  --glow-work: 0 0 20px rgba(124, 158, 255, 0.15);
  --glow-ai: 0 0 20px rgba(155, 140, 255, 0.15);
  --glow-slack: 0 0 20px rgba(255, 124, 124, 0.15);
  --glow-warm: 0 0 20px rgba(255, 184, 107, 0.15);
  --glow-danger: 0 0 20px rgba(255, 68, 68, 0.2);
  --glow-success: 0 0 20px rgba(107, 216, 168, 0.2);

  /* === TYPOGRAPHY === */
  --font-primary: 'Inter', 'Segoe UI', 'SF Pro Display', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  --font-size-h1: 20px;
  --font-size-h2: 16px;
  --font-size-body: 13px;
  --font-size-caption: 11px;
  --font-size-mini: 9px;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-bold: 600;
  --font-weight-heavy: 700;

  /* === SPACING === */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;

  /* === RADIUS === */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-full: 9999px;

  /* === SHADOWS === */
  --shadow-card: 0 4px 24px rgba(0, 0, 0, 0.3);
  --shadow-card-hover: 0 8px 32px rgba(0, 0, 0, 0.4);
  --shadow-elevated: 0 12px 48px rgba(0, 0, 0, 0.5);
  --shadow-inset: inset 0 1px 0 rgba(255, 255, 255, 0.04);

  /* === ANIMATION === */
  --transition-fast: 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  --transition-bounce: 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);

  /* === Z-INDEX === */
  --z-base: 0;
  --z-card: 10;
  --z-hover: 20;
  --z-dropdown: 30;
  --z-tooltip: 40;
  --z-alert: 50;
  --z-modal: 60;
  --z-overlay: 70;
  --z-virtual-person: 80;
}
```

---

## 十、实施优先级建议

| 优先级 | 视图/组件 | 原因 |
|--------|----------|------|
| P0 | Card组件→glass-card升级 | 所有视图的基础，改了全局生效 |
| P0 | CSS变量体系 | 设计系统的根基 |
| P0 | 导航图标→Lucide+分组 | 用户第一眼看到的 |
| P1 | CalendarView日视图增强 | 使用频率最高，44px→200px体验跃升 |
| P1 | PlanView执行模式 | 核心差异化功能——计划vs实际双层时间轴 |
| P1 | 悬浮窗上下文卡改造 | 常驻右下角，摸鱼预警直接影响用户行为 |
| P2 | ReportView日报 | 新增视图，整合散落统计 |
| P2 | ProgressRing/StateBadge升级 | 高频组件，提升整体质感 |
| P2 | EmptyState升级 | 零数据时的品牌印象 |
| P3 | CalendarView周/月视图 | 扩展功能，锦上添花 |
| P3 | ReportView周报/月报 | 长周期分析，高级用户才用 |
| P3 | 动效体系 | 完善体验的最后一层 |
| P3 | 虚拟人与三视图联动 | 跨视图协同，开发量最大 |

**建议开发顺序**：
1. CSS变量 + glass-card + Lucide图标（1-2天，全局生效）
2. CalendarView日视图增强（2-3天，体验核心）
3. PlanView三模式改造（3-4天，差异化功能）
4. 悬浮窗改造（1-2天，日常高频）
5. ReportView日报（2-3天，新增视图）
6. 其余P2/P3按需推进
