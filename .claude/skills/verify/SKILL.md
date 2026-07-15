---
name: verify
description: Build, launch, and drive show-remind locally to verify changes end-to-end (Workers + D1 + SPA).
---

# Verifying show-remind locally

## Build & launch

```bash
mise x node@22 -- pnpm web:build            # SPA → dist/ (wrangler serves it as assets)
mise x node@22 -- npx wrangler d1 migrations apply show-remind --local
# start dev server via .claude/launch.json config "wrangler-dev" (preview_start),
# which runs: mise x node@22 -- npx wrangler dev --port 8787
```

Gotchas:
- `.nvmrc` pins Node 20 but wrangler needs 22 → always `mise x node@22 --`.
- `pnpm db:migrate:local` re-resolves Node 20 inside the script; call
  `npx wrangler` directly under mise instead.
- workerd refuses to start if `src/index.ts` gains a non-handler named export
  ("Incorrect type for map entry ...: not of type 'function or ExportedHandler'").
- Local `PUBLIC_MODE=0` → no Turnstile needed on resolve/subscribe/import.

## Seed a subscription (no email roundtrip needed)

```bash
mise x node@22 -- npx wrangler d1 execute show-remind --local --command "
INSERT OR REPLACE INTO subscriptions (id, email, token, status, cities) VALUES ('sub_verify','verify@local.test','verifytoken123','active','[\"110000\"]');
INSERT OR REPLACE INTO artists (id, name, normalized_name, aliases, avatar) VALUES ('art_v1','刺猬','刺猬','[]',NULL);
INSERT OR REPLACE INTO subscription_artists (subscription_id, artist_id) VALUES ('sub_verify','art_v1');"
```

## Flows worth driving

- `GET /api/manage?token=verifytoken123` — subscription view; avatar backfill
  runs in the background (waitUntil), so time-to-first-byte should be tens of ms.
- `POST /api/manage/import` `{link}` — real QQ playlist that works:
  `https://y.qq.com/n/ryqq/playlist/7256912512`; artists persist with
  `https://y.qq.com/music/photo_new/...` avatars immediately.
- `POST /api/resolve` `{link}` — real netease playlist:
  `https://music.163.com/#/playlist?id=3778678`; top-30 artists get https
  `p*.music.126.net` avatars.
- SPA: `http://localhost:8787/manage?token=verifytoken123`.

## Known environment artifact

The sandboxed Browser pane never finishes loading cross-origin `<img>`s
(y.qq.com / music.126.net / showstart all stay `pending`) — NOT an app bug.
Cross-check hotlinking with curl + Referer instead:
`curl -e "https://show.build4funhsh.cc/" -o /dev/null -w "%{http_code}" <img-url>`
