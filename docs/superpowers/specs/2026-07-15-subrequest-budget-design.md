# 外发子请求预算（SubrequestBudget）

日期：2026-07-15
状态：已批准（用户选择「预算器接入所有批量路径」）

## 问题

Workers 免费版每次调用限 **50 个外部 fetch**（Cloudflare 内部服务如 D1 是单独的
1000 额度；重定向链每跳计 1；超限抛 `Too many subrequests`）。现状是各批量点靠
静态上限 + 注释手算，单点都对，但「组合」和「一次动作两个请求」管不住：

- QQ 歌单分页 `MAX_PAGES=60`——单独就超；
- resolve 大网易歌单：21 页 + 30 头像查找 = 51，擦线超；
- manage 后台回填：30 个待补 × 最坏 2 请求（网易查无照片→秀动兜底）= 60；
- 邮件通知：每封最多 3 次尝试 × 无封数上限，订阅者多时理论可超。

爬虫路径不在此列：cron 扇出（32+1）与单城市抓取（20+25=45）已按预算设计且相互隔离。

## 方案

`lib/budget.ts` 提供 `SubrequestBudget`：每次调用在入口（路由 handler / cron run）
创建一份，上限 `EXTERNAL_SUBREQUEST_BUDGET = 45`（给重定向跳数、Turnstile 校验、
管理员告警等零散请求留 5 的余量）。批量点在**每次外部 fetch 前** `tryTake(1)`，
拿不到就按该路径既有的退化语义优雅收手，绝不抛错：

| 路径 | 耗尽时的行为 |
|---|---|
| QQ / 网易歌单分页 | 截断歌曲列表（与既有 MAX_PAGES 截断同语义） |
| resolve 网易头像查找 | 剩余艺人 avatar: null，留给 manage 后台回填 |
| manage 后台回填 | 剩余艺人保持原状态，下次加载继续 |
| 邮件通知 | 停止发送；未发候选没有 notification 行，下轮 cron 自然重试 |

静态上限保留：`MAX_PAGES` 表达「超大歌单截断」的产品语义，`AVATAR_LOOKUP_LIMIT`
表达单轮批量大小，预算器表达「这次调用还能不能发」。三者独立成立。

`backfillAvatars` 随手迁出 `routes/manage.ts` 到 `src/services/avatar-backfill.ts`
（路由文件不该长驻一段 60 行的管线逻辑，迁出后也便于直接注入 budget 做单元测试）。

## 不做

- 单城市抓取改预算器：现有静态上限已正确且该调用独占预算，改动纯属风格统一。
- 从 env 配置预算数值：付费版上限远高于 45，此常量在两种计划下都安全；真有需要再提。
