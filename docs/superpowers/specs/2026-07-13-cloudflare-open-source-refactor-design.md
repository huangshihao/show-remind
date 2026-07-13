# Show-Remind 开源化 + Cloudflare 免费套餐重构 设计文档

日期：2026-07-13
状态：已与维护者逐节确认

## 1. 目标与定位

把 show-remind 从"带账号体系的自托管产品"改造成"低成本开源项目"：

- **去掉用户系统**：无注册/登录/密码。新流程：粘贴歌单 → 勾选要关注的艺人 → 选城市 → 填邮箱 → 邮箱确认 → 有新演出自动发邮件。
- **双重定位**：自部署优先（任何人 fork 后 `wrangler deploy` 起自己的实例），同时维护者跑一个公开实例。防滥用措施写进代码、用环境变量开关。
- **成本目标**：Cloudflare 免费套餐 + Resend 免费层，月成本 $0（域名除外）。维护者已有托管在 Cloudflare 的域名。
- **爬虫可用性**：不承诺"永远可用"（逆向 API 无此可能），改为"失败可见、修复廉价、单点失败不拖垮整体"。

## 2. 架构总览

单仓库、单 Worker：

```
Cloudflare Worker
├── 静态资产：Vite + React SPA（订阅向导、管理页）
├── Hono API：/api/resolve /api/subscribe /api/confirm /api/manage/*
├── /internal/crawl?city=X （cron 自调用扇出，内部密钥头鉴权）
├── Cron Triggers：每日 2 次（北京时间 10:00 / 20:00）
├── D1：订阅、艺人、演出、通知
└── Resend HTTP API：确认邮件 + 演出提醒（provider 可插拔）
```

### 技术栈替换

| 现在 | 之后 | 原因 |
|---|---|---|
| Next.js 15 + React | Hono + Vite React SPA（Worker 静态资产） | 只有向导+管理两个页面；免费版 Worker 体积上限 3MB |
| Prisma + Postgres | D1 + 手写 SQL 薄 repository 层 | D1 免费 5GB / 500 万读/天 / 10 万写/天 |
| next-auth + bcryptjs | 删除 | 无账号体系 |
| nodemailer + MailHog | Resend HTTP API；本地 dev provider 打印控制台 | Workers 无法直连 SMTP |
| node-cron 常驻进程 | Cron Triggers | 免费版每账号 5 个 cron，用 1 个 |
| Docker / compose | 删除；`wrangler dev` 本地开发 | 无常驻进程 |

`lib/sources`（qq musicu / showstart wap v3）、`lib/adapters`、`lib/matcher` 为纯 TS + 注入 fetch，原样迁移；netease 适配器改走明文 `/api/` 接口（见第 6 节 spike 结论）。node:crypto（秀动 MD5、QQ SHA1、randomBytes）依赖 `nodejs_compat`，已在 Phase 0 spike 中验证可用。

### 免费额度关键约束（已核实）

- Workers 免费：10 万请求/天；每次调用 10ms CPU（网络等待不计）；**50 子请求/次调用** → 爬取按城市扇出为对自身的独立 HTTP 调用，每个城市一份 50 子请求额度。
- D1 免费：5GB、500 万行读/天、10 万行写/天。
- Cloudflare Email Sending 需 Workers Paid 才能发任意收件人 → 免费方案用 **Resend 免费层（3000 封/月、100 封/天，需用自有域名验证 DKIM）**。邮件 provider 做成接口，未来可换 CF Email Service（$5/月含 3000 封）或其他。
- 验算（公开实例 50 订阅、8 城）：cron 每天 16 次内部调用、每次 10-30 子请求；D1 写入数百行/天；邮件正常个位数/天。全部余量充足，最先触顶的是 Resend 月 3000 封（对应几百活跃订阅，届时再议）。

## 3. 数据模型（D1）

```
subscriptions         id TEXT PK, email TEXT UNIQUE, token TEXT UNIQUE(随机32字节),
                      status TEXT(pending|active), cities TEXT(JSON数组),
                      created_at, confirmed_at
artists               id TEXT PK, name TEXT, normalized_name TEXT UNIQUE, aliases TEXT(JSON)
subscription_artists  subscription_id + artist_id, UNIQUE 复合
shows                 id TEXT PK, showstart_id TEXT UNIQUE, title, city_code, venue,
                      show_time, price, url, performers TEXT(JSON), first_seen_at
show_artists          show_id + artist_id UNIQUE, matched_by TEXT(performer|title)
notifications         subscription_id + show_id UNIQUE, status TEXT(pending|sent|failed), sent_at
```

相比现状删除的表：`users`、`user_cities`、`user_artists`、`playlists`、`playlist_tallies`、`verification_tokens`。

关键简化：歌单解析是订阅时的一次性交互，解析结果直接返回前端供勾选，**不落库**；只有勾选的艺人写入。同一邮箱再次订阅 = 更新既有记录。`token` 同时用于确认激活（首封邮件的确认链接）和后续管理页/退订。

## 4. 核心流程

### 4.1 订阅向导（首页单页完成）

1. 粘贴网易云/QQ 公开歌单链接 → `POST /api/resolve` → 服务端解析返回艺人清单（名字 + 歌数，沿用现有 tally 逻辑）。网易适配器从 weapi 加密网关改走明文 `/api/v6/playlist/detail` + `/api/v3/song/detail`（spike 实测：weapi 对海外 IP 软封，明文接口不受限，见第 6 节；顺带删掉整套 AES/RSA 加密代码）。
2. 勾选艺人；**始终提供手动添加艺人输入框**（既是补充，也是歌单解析被封时的完整兜底路径——用户可跳过粘贴歌单）。
3. 选城市（1-N，沿用现有城市码表）。
4. 填邮箱 + Turnstile → `POST /api/subscribe` → 建 pending 订阅 → 发确认邮件。
5. 点确认链接（`/api/confirm?token=…`）→ active，跳转管理页。

### 4.2 管理页 `/manage?token=…`

增删艺人、改城市、重新导入歌单（追加艺人）、退订（物理删除整条订阅及关联数据）。所有提醒邮件页脚带管理链接 + 一键退订链接。

### 4.3 定时管道（cron 每日 2 次）

```
cron 触发
→ 查 active 订阅的 distinct 城市
→ 逐城市 fetch 自身 /internal/crawl?city=X（内部密钥头鉴权）
→ 秀动列表翻页 + 仅对新演出拉详情 → upsert shows
→ matcher 将新演出与全部订阅艺人匹配（沿用 normalize/别名逻辑）
→ 写 notifications（UNIQUE 去重，天然防重复发信）
→ 每订阅聚合一封邮件发送；失败保持 pending 下轮重试
```

## 5. 防滥用（公开实例开启，自部署可环境变量全关）

- Turnstile 保护 `/api/resolve` 与 `/api/subscribe`（仅有的两个会触发对外请求/发信的端点）。
- 邮箱双重确认；pending 超 48 小时未确认由 cron 顺带清理。
- 每邮箱一条订阅；艺人上限 100、城市上限 10。

## 6. 爬虫可用性策略

1. **Phase 0 spike —— 已完成（2026-07-13，探针代码在 `spike/`）**。从 Cloudflare 出口（新加坡，AS13335）实测，本机国内 IP 作对照基线（基线全通）：
   - **秀动 wap v3：✅ 通**（列表 + 详情 + guest token 全链路正常）→ 爬取层按本设计留在 Worker cron。
   - **QQ musicu：✅ 通**（签名被接受，歌单解析正常）。
   - **网易 weapi：❌ 软封；明文 `/api/`：✅ 通**——weapi 加密网关对海外 IP 返回 HTTP 200 + 空 body，伪造 `X-Real-IP` 头也无效；但明文 `/api/v6/playlist/detail` 与 `/api/v3/song/detail` 从 CF 出口无需任何伪装头即返回完整数据（含每首歌的艺人）。结论：网易适配器改走明文接口，weapi 加密实现（`lib/adapters/netease/weapi.ts`）删除。若网易未来把封锁扩展到明文接口，兜底是 QQ + 手动输入（向导常驻这两条路径），每日冒烟会第一时间暴露。
   - **node:crypto：✅**（md5/sha1/aes-128-cbc/randomBytes 在 `nodejs_compat` 下全部可用）。
   - 附带观察：偶发 Cloudflare 边缘瞬时错误（如 1042），重试即恢复 → resolve 接口对上游空响应/瞬时错误返回可重试的错误码，前端提供"重试"。
2. **每日活体冒烟**：GHA 每日跑三个 source 的真实 API 冒烟（自动化 `docs/scraper-smoke.md`），失败自动开 GitHub Issue；README 挂状态 badge，作为公开健康看板。
3. **运行时告警**：移植现有 `admin-alert`——管道连续全城市失败时邮件通知部署者，阈值沿用现有 `lib/notifier/admin-alert.ts` 的逻辑。
4. **隔离与文档**：每源独立模块 + fixture 测试 + 逆向文档（`docs/showstart-reverse-engineering.md`），坏了只修一个文件。

## 7. 错误处理

- 单城市爬取失败不影响其他城市（沿用 `failedCities` 聚合模式）。
- 发信失败的 notification 保持 pending，下轮 cron 重试。
- 无效 token 的管理页/确认请求返回 404，不泄露存在性。
- resolve 失败返回可读文案（如"歌单可能未公开"）。

## 8. 测试

- `lib/` 纯逻辑单测原样保留（vitest）。
- Worker 路由 + D1 集成测试：`@cloudflare/vitest-pool-workers`。
- 活体冒烟独立于单测，跑在 GHA 每日任务。

## 9. 删除清单与开源配套

删除：`auth.ts`、`lib/auth/`、`app/` 全部页面（login/register/verify/settings/playlists/shows）、`prisma/`、`Dockerfile`、`docker-compose.yml`、`worker.ts`；依赖 next、next-auth、bcryptjs、prisma、@prisma/client、nodemailer、node-cron。

新增开源配套：重写 README（Deploy to Cloudflare 按钮；自部署步骤：建 D1 → 配 4 个 secret（RESEND_API_KEY、INTERNAL_SECRET、ADMIN_EMAIL、TURNSTILE_SECRET 可选）→ `wrangler deploy`）、LICENSE（MIT）、`wrangler.jsonc` 注释齐全、贡献指南简版（重点指向 sources 模块与冒烟测试）。

## 10. 实施顺序（供 writing-plans 参考）

1. ~~Phase 0 spike~~ **已完成**，结果见第 6 节：秀动/QQ/网易（明文 `/api/`）三源全通，无需任何国内中继。
2. Worker 骨架：Hono + D1 schema + wrangler 配置 + vitest-pool-workers。
3. lib 迁移：sources/adapters/matcher + 新 repository 层。
4. 订阅 API + 邮件 provider + 确认/管理流。
5. 前端 SPA：向导 + 管理页。
6. cron 管道 + 扇出 + 告警。
7. 删除旧栈 + README/开源配套 + GHA 冒烟。
