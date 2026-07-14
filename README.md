# Show-Remind · 演出提醒

**粘贴一份歌单，选好你关注的音乐人，他们在你的城市订了演出时给你发邮件。** 不用注册、不用密码、不用装 App。

![smoke](https://github.com/huangshihao/show-remind/actions/workflows/smoke.yml/badge.svg)
[![license](https://img.shields.io/badge/license-MIT-black.svg)](./LICENSE)

Live House 的演出信息散落在各个票务平台，等你在信息流里刷到，票往往已经没了。Show-Remind 替你盯着 [秀动（Showstart）](https://www.showstart.com)：告诉它你关注哪些音乐人——直接导入一份你已有的歌单就行——只要其中有人在你关注的城市官宣了新演出，它就第一时间发邮件提醒你。

<!-- 分享仓库前，在这里放一张截图或 GIF——订阅向导和管理页都很适合当首图。
     例如：![Show-Remind](docs/screenshot.png) -->

## 它怎么用

1. **粘贴一个公开歌单** —— QQ 音乐或网易云音乐的链接。
2. Show-Remind 解析歌单，列出里面的音乐人（含歌曲数）。**勾选你要关注的**，也可以手动输入名字。
3. **选你关注的城市。**
4. **填邮箱**，点击邮件里的确认链接。
5. 之后只要有你关注的音乐人在你的城市官宣了新的秀动演出，**你就会收到提醒邮件。**

全程没有登录。每封邮件都带一个该订阅专属的 magic-link token，用它打开你的**管理页**——增删音乐人、改城市、重新导入歌单、或一键退订。这个 token 本身就是凭证：和"记住登录"链接一个信任模型，没有密码可泄露。

## 你可能会喜欢它的地方

- **零门槛** —— 不注册、不设密码、不装 App。粘贴、勾选、完成。
- **输入你早就有了** —— 直接读你在网易云 / QQ 音乐里已经建好的歌单，不用重新手打一遍心愿单。
- **跑在免费额度里** —— 整个应用就是一个 Cloudflare Worker + D1 + 定时触发器。个人自部署一份 $0 成本（见 [成本](#成本)）。
- **隐私优先** —— 无账号、只用 magic-link；登录邮件是"发完即忘"式发送，所以响应本身没法被用来探测某个邮箱是否已注册。
- **故障可见、修起来便宜** —— 每天有烟雾测试探活所有上游，一旦某个挂了就自动开 issue；每个数据源都是独立、带 fixture 测试的模块。

## 架构速览

一个 Cloudflare Worker：[Hono](https://hono.dev) 写的 API，加上一个作为静态资源托管的 Vite/React SPA，后面接 [D1](https://developers.cloudflare.com/d1/)，再用定时触发器每天跑两次 **抓取 → 匹配 → 通知** 流水线。

```
歌单链接 ──► 解析（网易云 / QQ）──► 选音乐人 ──► 确认邮件
                                                   │
   定时任务（每天 2 次）                            ▼
   逐城市：抓秀动演出 ──► 匹配关注的音乐人 ──► 提醒邮件
```

- `src/` —— Worker：Hono 路由、流水线、D1 读写、邮件。
- `lib/` —— 与框架无关的核心：逆向出来的数据源客户端（`lib/sources/`、`lib/adapters/`）和艺人匹配器，都有 fixture 测试。
- `web/` —— React SPA（订阅向导 + 管理页）。

## 自己部署一份（Cloudflare 免费额度）

**前置要求：** Node 22+（wrangler 4.x 需要）和 [pnpm](https://pnpm.io)。

1. 安装依赖：
   ```bash
   pnpm install
   ```
2. 创建 D1 数据库并填入它的 ID：
   ```bash
   npx wrangler d1 create show-remind
   ```
   把输出里的 `database_id` 粘到 `wrangler.jsonc` 的 `d1_databases[0].database_id`。
3. 把表结构应用到远端数据库：
   ```bash
   pnpm db:migrate:remote
   ```
4. **配置发信。** $0 方案是一个 [Resend](https://resend.com) API key（免费额度：3000 封/月，需要验证发信域名）。Cloudflare Email Routing 只能*收*信，从 Worker *往任意收件人发*信需要 Workers 付费版的 Cloudflare Email Sending——所以免费部署就用 Resend。然后设置这些 secret：
   ```bash
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put INTERNAL_SECRET   # 任意长随机串——给定时任务自调 /internal/crawl 做鉴权
   npx wrangler secret put ADMIN_EMAIL       # 流水线失败告警发到哪
   npx wrangler secret put TURNSTILE_SECRET  # 仅当 PUBLIC_MODE=1 时需要
   ```
5. 在 `wrangler.jsonc` 的 `vars` 块里设好这些非机密变量（每个都有 `//` 注释说明）：
   - `APP_BASE_URL` —— 你部署后的 Worker 地址（用来拼邮件里的链接）。
   - `MAIL_FROM` —— 你验证过的发信地址。
   - `PUBLIC_MODE` —— `"0"` 是个人实例（无 Turnstile、无限额），`"1"` 是对外开放给别人用（见下方提示）。
   - `TURNSTILE_SITE_KEY` —— 公开的 Turnstile site key，仅当 `PUBLIC_MODE` 为 `"1"` 时需要。
6. 构建前端并部署：
   ```bash
   pnpm web:build && npx wrangler deploy
   ```

> **要把你的实例对外公开？** 在分享地址**之前**先把 `PUBLIC_MODE` 改成 `"1"`。这会在 解析/订阅/登录 接口上开启 [Turnstile](https://developers.cloudflare.com/turnstile/) 并对每个订阅施加音乐人/城市数量上限——不开的话，一个没防护的实例会很快把你的邮件额度刷爆。另外记住免费的 3000 封/月上限大约对应几百个活跃订阅者。

## 本地开发

```bash
pnpm web:build && npx wrangler dev
```

没配 `RESEND_API_KEY` 时，发信会退化成一个 console provider，把确认/提醒链接直接打印到终端，而不是真的发邮件。`PUBLIC_MODE=0`（默认）会跳过 Turnstile，所以不用 Turnstile key 也能在本地跑完整个流程。

如果你机器默认的 Node 低于 22，就用一个 Node 22+ 的运行时来跑 wrangler，比如用 [mise](https://mise.jdx.dev)：`mise exec node@22 -- npx wrangler dev`。

## 测试

```bash
pnpm test
```

会跑两套：服务端套件（`@cloudflare/vitest-pool-workers`，覆盖 Worker 路由和 D1）和前端套件（`happy-dom`，覆盖 React SPA）。

## 成本

整体设计就是为了塞进 Cloudflare 的免费额度：

- **Workers Free**：每天 10 万请求；定时任务逐城市抓取的扇出远低于单次调用 50 个子请求的上限。
- **D1 Free**：5GB 存储、每天 500 万行读 / 10 万行写——本应用的读写量相比之下微不足道。
- **Resend Free**：3000 封/月是真正的瓶颈——大约几百个活跃订阅者，之后就得升级或换发信服务商。

一个和成本相关的可靠性细节：网易云*加密*的 `weapi` 接口对 Cloudflare 的出口 IP 是封的（海外 IP 会拿到 HTTP 200 但空 body），所以本项目改用网易云*明文*的 `/api/` 接口。完整踩坑记录见 `docs/superpowers/specs/2026-07-13-cloudflare-open-source-refactor-design.md` §6。

## 数据源与可靠性

三个上游（QQ 音乐 `musicu`、网易云明文 `/api/`、秀动 wap v3）全是**逆向出来的、无文档的接口**——秀动请求签名是怎么逆出来的见 `docs/showstart-reverse-engineering.md`。逆向接口早晚会因为上游改动而失效。本项目不假装它不会坏，而是让"坏"变得**显眼且修起来便宜**：

- 每天一个 GitHub Actions 任务打一遍所有上游，任何一个挂了就**自动开 issue**——就是顶上那个徽章。
- 每个数据源都是**独立模块**、带 fixture 测试，所以一个坏了不会拖垮其它，修复只需动一个文件。
- 如果抓取流水线连续几次对所有城市都失败，部署的 Worker 会直接给 `ADMIN_EMAIL` 发邮件。

请克制使用——保持请求量适度，别去猛打上游。

## 参与贡献

欢迎提 issue 和 PR —— 见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

[MIT](./LICENSE)
