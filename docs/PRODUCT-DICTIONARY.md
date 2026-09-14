# WorkOn 产品词典（工作域词汇包）

> 原则：**数据库永远存标准概念，词典只决定界面说什么话。**
> 黑话禁入：任何包里的词必须是该角色日常真实在用的词；generic 包 = 人话打底。
> 代码唯一来源：`src/shared/dictionary.ts`。本文档是它的说明，不平行维护词条。

## 解析顺序

```
useTerm(key, domain?) / resolveTerm(domain, key)
  1. 项目的 domain 标签（ProjectModal 可选，可自定义）
  2. 主角色默认域 defaultDomainOfUserType(settings.userType)
  3. generic（人话打底，最终回落）
```

继承链：`ops/impl/ai_dev → dev → generic`；其余包直接 `→ generic`。每个包只写与父包的差异词。

## 预置域与默认映射

| 域 | 角色 | 关键词示例（project/step/statusCard） |
|----|------|--------------------------------------|
| generic 通用 | freelancer 等 | 项目 / 步骤 / 状态卡 |
| dev 开发 | developer 🧑‍💻 | 项目 / 任务 / 站会纪要 |
| ops 运维 | — | 项目 / 任务 / 站会纪要（「在线时段」） |
| impl 实施 | — | 项目 / 任务 / 交付清单 |
| ai_dev AI开发 | — | 项目 / 任务 / 实验记录 |
| exam 备考 | 考研党📖、学生党🎒 | 科目 / 章节 / 每日复盘 |
| finance 财务 | — | 账套 / 凭证 / 工作底稿 |
| startup 创业 | 创业者🚀 | 事项 / 节点 / 进展纪要 |
| office 办公 | 办公族💼 | 项目 / 事项 / 周报素材 |
| creative 创作 | 创作者✍️ | 作品 / 稿 / 进度小记 |

自定义域：直接回落 generic（界面上仍显示自定义名）。

## 词条规范

- `TermKey` 只收高频触点词（~20 个）；新词先问「用户一天会看到几次」。
- 带占位的词用 `{p}`/`{h}`，`formatTerm()` 替换（如 `askStillQ`：「刚才还是在复习『{p}』吗？」）。
- 接入点（已接线）：归属提问（attributions.ts）、状态卡（statusCard.ts）、悬浮窗（SuggestionWidget）、待办组件分区、计划页分组标签、ProjectModal 域选择器。
- 猜域：`guessDomain({dirs|keywords|text})` 按行话关键词推荐，一次性建议、不自动写入。

## 新增角色/域的清单

1. `types.ts`：`UserType` 加值 → 同步 `attention.ts`（USER_TYPE_META / TYPE_APP_RULES / TYPE_PLAN_KEYWORDS / scheduleMatch）、`industryVocab.ts`、`chain/templates.ts`（模板 + USER_CHAIN_CONFIGS）
2. `dictionary.ts`：`DOMAIN_META` + 词汇包（先只写差异词）+ `defaultDomainOfUserType` 映射
3. `ProfileView` 用户类型选择器自动出现新角色（迭代 USER_TYPE_META，无需改 UI）
