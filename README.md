# Show-Remind

歌单 → livehouse 演出邮件提醒。粘贴网易云/QQ 音乐公开歌单,关注其中的音乐人,
当他们在你关注的城市有新的秀动演出时收到邮件。

纯 Node/TS 单栈:三个数据源(网易云 weapi、QQ musicu、秀动 wap v3)都在 `lib/sources/` + `lib/adapters/` 里,不再依赖外部服务。

## 开发
    docker compose up -d postgres mailhog
    cp .env.example .env   # 填 AUTH_SECRET 等
    pnpm install
    pnpm prisma migrate dev
    pnpm dev        # web on :3000
    pnpm worker     # 定时爬取→匹配→通知

MailHog UI: http://localhost:8025

## 测试
    pnpm test

## 全栈容器
    docker compose up --build
