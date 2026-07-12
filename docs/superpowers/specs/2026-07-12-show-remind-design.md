# Show-Remind 设计文档

日期:2026-07-12
状态:已确认

## 1. 产品概述

用户粘贴网易云音乐 / QQ 音乐的**公开歌单链接**,服务端解析出歌单中的歌手/乐队;当这些音乐人在用户**关注的城市**有新的 livehouse 演出(数据源:秀动 Showstart)上架时,通过**邮件**提醒用户。

**定位:** 面向多用户的 Web 产品。首版通知渠道为邮件,验证通过后迁移到微信公众号推送(本版不实现)。

**核心价值链路:** 粘歌单 → 勾选关注艺人 → 选关注城市 → 新演出上架即收到邮件。

## 2. 已确认的关键决策

| 决策点 | 结论 |
|---|---|
| 定位 | 直接做多用户产品 |
| 产品形态 | Web 应用 + 邮件提醒;公众号推送为后续迁移方向 |
| 城市过滤 | 用户选 1-N 个关注城市,只推这些城市的演出 |
| 艺人关注方式 | 歌单解析后用户勾选确认(默认全选、按歌数降序);另支持手动输入艺人名添加 |
| 提醒时机 | 仅"发现新演出立即提醒",不做开票/开演提醒 |
| 技术栈 | Python 单体(FastAPI + SQLAlchemy + PostgreSQL + APScheduler) |
| 前端 | Jinja2 服务端渲染 + htmx,无独立前端构建 |
| 部署 | 国内 VPS(阿里云/腾讯云等) |
| 秀动数据策略 | **按城市全量抓取演出列表,本地匹配**(方案 B) |

## 3. 架构

```
                    ┌─────────────────────────────────────────┐
                    │        FastAPI 单体应用 (国内 VPS)         │
                    │                                         │
 用户浏览器 ◄───────►│  Web 层(注册登录/粘歌单/勾艺人/看演出)      │
                    │                                         │
                    │  歌单解析器 PlaylistAdapter              │
                    │   ├─ NeteaseAdapter(weapi 加密,自实现)   │──► music.163.com
                    │   └─ QQMusicAdapter(qqmusic-api-python) │──► y.qq.com
                    │                                         │
                    │  秀动爬虫 ShowstartCrawler(APScheduler   │──► wap.showstart.com
                    │   定时,按城市列表增量抓取+详情补齐)         │
                    │                                         │
                    │  匹配引擎 Matcher(纯本地,无外部请求)       │
                    │  通知服务 Notifier(SMTP 邮件)            │──► 邮件服务商
                    └──────────────┬──────────────────────────┘
                                   │
                              PostgreSQL
```

### 3.1 选型理由

- **PostgreSQL 而非 SQLite:** 多用户 + 后台爬虫并发写,直接用 Postgres,不做过渡。
- **APScheduler 进程内调度,不用 Celery/Redis:** 当前规模(每天几百个爬虫请求、小邮件量)足够,减少两个部署组件。
- **网易云自实现 weapi,不部署 Node 服务:** 匿名场景只需 `playlist/detail` + `song/detail` 两个接口;weapi 加密(AES+RSA)在 Python 有成熟参考(pyncm),约百余行。避免依赖已归档的 NeteaseCloudMusicApi 及其 fork 作为运行时组件。
- **QQ 音乐用 qqmusic-api-python:** 公开歌单匿名可取。
- **秀动客户端抽象为可替换接口:** 首选 wap/小程序 JSON 接口(签名实现参考开源抢票项目);签名失效时降级为 web 站 HTML 解析。这是全项目最脆弱的一环,单独隔离。
- **邮件:** 开发期普通 SMTP(本地 MailHog);上线用国内邮件推送服务(阿里云 DirectMail / 腾讯云 SES),避免自建 SMTP 进垃圾箱。
- **登录:** 邮箱 + 密码 + 注册验证邮件(邮箱即通知渠道,注册时顺带完成验证)。

### 3.2 模块边界

| 模块 | 职责 | 依赖 |
|---|---|---|
| `web` | 路由、页面渲染、会话 | 所有下层模块 |
| `adapters/netease`, `adapters/qq` | 输入歌单 ID → 输出 `[(song, [artist_names])]` | 外部音乐平台接口 |
| `crawler/showstart` | 输入城市集合 → 演出数据入库 | 秀动接口;`shows` 表 |
| `matcher` | 纯函数:艺人集合 × 演出集合 → 匹配对 | 无外部依赖 |
| `notifier` | 待通知记录 → 发邮件 → 回写状态 | SMTP |
| `scheduler` | 定时触发 crawler → matcher → notifier 流水线 | APScheduler |

每个 adapter 和 crawler 对上层只暴露纯数据结构,便于单测和替换。

## 4. 数据模型

| 表 | 关键字段 | 说明 |
|---|---|---|
| `users` | email, password_hash, email_verified | |
| `user_cities` | user_id, city_code | 用户关注城市,多选 |
| `playlists` | user_id, platform(`netease`/`qq`), external_id, title, last_synced_at | 记录来源歌单,支持手动重新同步 |
| `artists` | id, name, normalized_name(唯一索引), aliases(JSON) | **全局表**,跨用户去重;aliases 存平台译名/别名 |
| `user_artists` | user_id, artist_id, source_playlist_id, status | status: `followed` / `ignored`。勾选时取消的记为 ignored,重新同步歌单不再重复询问 |
| `shows` | showstart_id(唯一), title, city_code, venue, show_time, price, url, performers(JSON), first_seen_at | 演出库,爬取积累的自有资产 |
| `show_artists` | show_id, artist_id, matched_by(`performer`/`title`) | 匹配结果物化 |
| `notifications` | user_id, show_id, sent_at, status | **(user_id, show_id) 唯一**,天然防重复通知 |

## 5. 核心流程

### 流程 ①:粘歌单 → 关注艺人

1. 从分享链接提取 platform + 歌单 ID(支持网易云/QQ 常见分享链接格式,含短链跳转)。
2. 后台任务拉取歌单:
   - 网易云:`playlist/detail` 拿全量 trackIds(匿名下完整歌曲数据只有 10 首,trackIds 是全的),按 **500 首/批** 调 `song/detail` 补齐,批间限速。
   - QQ:qqmusic-api-python 直接取歌单全量。
3. 按艺人聚合、统计歌曲数;页面展示勾选列表(默认全选、按歌数降序)。
4. 确认后写入 `artists`(按 normalized_name 去重)+ `user_artists`;取消勾选的写 `ignored`。
5. **立即对存量演出库跑一次匹配**,当场展示"你关注的艺人已有这些即将到来的演出"——新用户第一屏就有结果,不用等下一轮爬取。

### 流程 ②:定时爬秀动

1. 每天 2 次,触发时间加随机抖动。
2. 城市集合 = 所有用户关注城市的并集。
3. 逐城市翻演出列表页,请求间隔 1-2 秒 + 随机 UA。
4. showstart_id 不在库中的新演出,抓详情补 performers 后入库(每场演出详情只抓一次)。
5. 完成后触发流程 ③。

### 流程 ③:匹配 → 通知

1. 新入库演出 × 全量 `followed` 艺人跑匹配,写 `show_artists`。
2. 找出满足「关注该艺人 ∧ 关注该演出城市 ∧ (user, show) 未通知过」的用户。
3. **每用户聚合成一封邮件**(一轮爬取发现多场只发一封,列出全部场次:艺人、演出名、城市、场馆、时间、票价、秀动链接)。
4. 写 `notifications`。

## 6. 匹配规则

匹配是纯函数,重点测试对象:

1. **归一化:** 小写、去首尾空格、全角转半角、连续空白折叠。
2. **主匹配:** 归一化后的艺人名(含 aliases)与演出 performers 逐项精确相等 → `matched_by=performer`。
3. **兜底匹配:** 演出标题包含艺人名,仅当艺人名长度 ≥ 2(防单字艺人名误报)→ `matched_by=title`,邮件中注明"可能相关"。
4. 多艺人歌曲(feat./合唱):平台返回本身是数组,逐个入库,不做字符串拆分。

## 7. 错误处理

- **歌单解析失败**(私密歌单/链接无效/平台风控):任务状态落库,页面展示明确原因,可重试。网易云批量 `song/detail` 中途失败则整单标失败,不写半截数据。
- **秀动爬虫失败:** 单城市失败不影响其他城市;**连续 3 轮全局失败 → 发管理员告警邮件**(大概率是签名算法变更,需要人工介入)。
- **邮件发送失败:** 指数退避重试 3 次,`notifications` 记状态;单用户失败不阻塞其他用户。
- **演出变更(改期/取消):** 首版不追踪,只按 showstart_id 去重。列入 roadmap。

## 8. 风险

1. **秀动签名变更是最大单点。** 缓解:client 抽象可替换(JSON 接口 ↔ HTML 解析)、连续失败告警、克制的爬取频率。
2. **三个数据源全部是无官方支持的逆向接口**,无 SLA,且商用存在 ToS/合规风险。多用户产品规模化后是真实的法律暴露面;首版控制在小范围。
3. **网易云匿名接口偶发风控:** song/detail 分批限速 + 失败重试。

## 9. 测试策略

- **Matcher 纯函数单测(最重):** 归一化、别名、feat 多艺人、单字误报防护、全角/半角。
- **Adapter/Crawler 单测用录制 fixture:** 真实响应 JSON 存入 repo,不打真实接口;解析逻辑回归有保障。
- **通知去重单测:** (user, show) 唯一约束下重复触发不重发。
- **本地集成冒烟:** MailHog 收邮件,真实歌单链接手动跑通全链路。

## 10. MVP 范围

**做:**

- 注册/登录/邮箱验证
- 粘歌单(网易云/QQ)→ 勾选艺人 → 关注
- 手动输入艺人名添加关注
- 关注城市管理
- 秀动按城市定时爬取 + 本地匹配 + 邮件通知
- "我的演出"页面(已匹配的即将到来的演出)

**不做(roadmap):**

- 微信公众号推送
- 开票时间提醒、开演前提醒
- 演出变更(改期/取消)追踪
- 按艺人搜索秀动兜底(方案 C 的二期)
- 大麦、票星球等其他票务源
- 歌单定期自动重同步(首版手动点"重新同步")
