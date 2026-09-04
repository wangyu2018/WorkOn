# v7.1 执行清单（用户已确认，按序执行）

## ① 属性袋引擎（进行中）
- Project.attrs?: Record<string, string|number>
- 引擎加载优先：ProjectBoard 项目卡展开区=**可拖动小卡**（HTML5 drag 排序、点值改、×删、＋加），有数据才渲染
- 保存走 saveProject({...p, attrs})；statusCard 增加 attrs 段
- AI 提取后置（本期不做）

## ② 确认归档页
- PlanView 第三分区「确认归档」：已确认项（confirmedFromQA / source=qa-confirm）按 每日计划/项目开发/问答确认 分类，可编辑、可归档（archived 字段或移入归档集合）

## ③ 报表改造
- ReportHub 默认 tab 改 'ai'（AI 洞察首屏）
- 智能日报低频：进页不自动刷新 + 头部曲线 5 分钟节流 + 日报生成一天限次（设置项 smartDailyMaxPerDay、curveRefreshMin）+ 手动刷新按钮
- 补齐 switches/longest 两卡的展开明细（focusKpi 机制已有）

## ④ 计划挂具体任务
- PlanItem.projectTaskId?: string；编辑器二级下拉（选项目→loadTasks→选任务）
- 行内 chip 显示任务名；ProjectBoard 反显待办**可点击跳编辑**（需跳到计划页+打开编辑器：dispatch 事件或提升 editor 状态）

## ⑤ 错误诊断码 + 时段修正可撤销
- errorBanner 消息统一格式 ERR_XXX|src|retry → 浮窗错误卡带「立即重试」
- 识别推翻（corrections）时 pushNotify('correction', …, [{label:'改回去',action:'undo-correction'}])，notify:action 落 undo

## ⑥ 三页焕新
- 画像：注意力节律热力（工作日/周末 × 8-22 时，getTrail 聚合）
- 隐私：绿盾卡 + 不采集名单网格（excludedApps 已有）+ 存储占用条（db 文件大小）
- 设置：外观三卡（浅/深/跟随）替换下拉 + 识别模式用 Seg

## ⑦ 其他
- MotionLab 拖拽画布完整版（积木拖拽排序组链）
- 待办小组件长按编辑模块显隐/排序
- 天气卡城市切换（设置里已有 city 则下拉）
- 首页小组件手动锁位置
- 星图拖拽：不做；桌宠穿透：不做
