# Show-Remind

歌单 → livehouse 演出邮件提醒。粘贴网易云/QQ 音乐公开歌单,关注其中的音乐人,
当他们在你关注的城市有新的秀动演出时收到邮件。

## 开发
    docker compose up -d postgres mailhog scraper
    cp .env.example .env   # 填 AUTH_SECRET 等
    pnpm install
    pnpm prisma migrate dev
    pnpm dev        # web on :3000
    pnpm worker     # 定时爬取→匹配→通知

MailHog UI: http://localhost:8025

## 测试
    pnpm test                    # Node 侧
    cd scraper && uv run pytest  # Python 侧

## 全栈容器
    docker compose up --build
