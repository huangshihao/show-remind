# Show-Remind

**Paste a music playlist, pick the artists you follow, get an email when they book a gig in your city.** No account, no password, no app to install.

![smoke](https://github.com/huangshihao/show-remind/actions/workflows/smoke.yml/badge.svg)
[![license](https://img.shields.io/badge/license-MIT-black.svg)](./LICENSE)

Live-music listings are scattered across ticketing platforms, and by the time a show reaches your feed the tickets are often gone. Show-Remind watches [Showstart (秀动)](https://www.showstart.com) for you: tell it which artists you care about — by importing a playlist you already have — and it emails you the moment one of them announces a gig in a city you follow.

<!-- Add a screenshot or GIF here before you share the repo — the subscribe wizard
     and the manage dashboard both make good hero images.
     e.g. ![Show-Remind](docs/screenshot.png) -->

## How it works

1. **Paste a public playlist** — a QQ Music or NetEase Cloud Music link.
2. Show-Remind resolves it and shows the artists in that playlist (with song counts). **Pick who to follow**, or add names by hand.
3. **Pick your cities.**
4. **Enter your email** and confirm via a one-click link.
5. Whenever a followed artist announces a new Showstart gig in one of your cities, **you get a reminder email.**

There's no login. Every email carries a per-subscription magic-link token that opens your **manage page** — add/remove artists, edit cities, re-import a playlist, or unsubscribe in one click. The token *is* the credential: same trust model as a "remember me" link, no passwords to leak.

## Why you might like it

- **Zero friction** — no sign-up, no password, no app. Paste, pick, done.
- **You already have the input** — it reads the playlists you've already built on NetEase / QQ Music instead of making you retype a wishlist.
- **Runs on free tiers** — the whole thing is one Cloudflare Worker + D1 + a cron trigger. Self-hosting your own instance costs $0 for personal use (see [Cost](#cost)).
- **Privacy-preserving by design** — accountless, magic-link only; login mail is sent fire-and-forget so the response can't be used to probe whether an email is registered.
- **Breakage is loud and cheap to fix** — a daily smoke test pings every upstream and opens an issue if one breaks; each data source is an isolated, fixture-tested module.

## Architecture at a glance

A single Cloudflare Worker: a [Hono](https://hono.dev) API plus a Vite/React SPA served as static assets, backed by [D1](https://developers.cloudflare.com/d1/), with a cron trigger that runs the **crawl → match → notify** pipeline twice a day.

```
playlist link ──► resolve (NetEase / QQ)  ──► pick artists ──► confirm email
                                                                     │
   cron (2×/day)                                                     ▼
   per city: Showstart crawl ──► match followed artists ──► reminder email
```

- `src/` — the Worker: Hono routes, the pipeline, D1 access, mail.
- `lib/` — framework-free core: reverse-engineered source clients (`lib/sources/`, `lib/adapters/`) and the artist matcher, all fixture-tested.
- `web/` — the React SPA (subscribe wizard + manage dashboard).

## Deploy your own (Cloudflare free tier)

**Prereqs:** Node 22+ (wrangler 4.x requires it) and [pnpm](https://pnpm.io).

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Create the D1 database and wire up its ID:
   ```bash
   npx wrangler d1 create show-remind
   ```
   Paste the `database_id` from the output into `d1_databases[0].database_id` in `wrangler.jsonc`.
3. Apply the schema to the remote database:
   ```bash
   pnpm db:migrate:remote
   ```
4. **Set up outbound mail.** The $0 path is a [Resend](https://resend.com) API key (free tier: 3,000 emails/month, requires verifying a sending domain). Cloudflare Email Routing can *receive* mail, but *sending* to arbitrary recipients from a Worker needs Cloudflare Email Sending on a Workers Paid plan — so for a free-tier deploy, use Resend. Then set the secrets:
   ```bash
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put INTERNAL_SECRET   # any long random string — authenticates the cron's self-calls to /internal/crawl
   npx wrangler secret put ADMIN_EMAIL       # where pipeline-failure alerts go
   npx wrangler secret put TURNSTILE_SECRET  # only if PUBLIC_MODE=1
   ```
5. Set the non-secret vars in `wrangler.jsonc`'s `vars` block (each has a `//` comment explaining it):
   - `APP_BASE_URL` — your deployed Worker's URL (used to build links in emails).
   - `MAIL_FROM` — your verified sender address.
   - `PUBLIC_MODE` — `"0"` for a personal instance (no Turnstile, no caps), `"1"` if you're opening it up to other people (see the note below).
   - `TURNSTILE_SITE_KEY` — public Turnstile site key, only needed if `PUBLIC_MODE` is `"1"`.
6. Build the frontend and deploy:
   ```bash
   pnpm web:build && npx wrangler deploy
   ```

> **Opening your instance to the public?** Flip `PUBLIC_MODE` to `"1"` **before** you share the URL. That turns on [Turnstile](https://developers.cloudflare.com/turnstile/) on the resolve/subscribe/login endpoints and enforces per-subscription artist/city caps — without it, an unprotected instance can burn through your mail quota. Also remember the 3,000-emails/month free ceiling is roughly a few hundred active subscribers.

## Local dev

```bash
pnpm web:build && npx wrangler dev
```

With no `RESEND_API_KEY` configured, mail falls back to a console provider that prints confirm/reminder links to the terminal instead of sending real email. `PUBLIC_MODE=0` (the default) skips Turnstile, so you can run the whole flow locally without a key.

If your machine's default Node is older than 22, run wrangler through a Node 22+ runtime, e.g. with [mise](https://mise.jdx.dev): `mise exec node@22 -- npx wrangler dev`.

## Tests

```bash
pnpm test
```

Runs both suites: the server-side suite (`@cloudflare/vitest-pool-workers`, exercising Worker routes and D1) and the web suite (`happy-dom`, exercising the React SPA).

## Cost

Designed to fit entirely inside Cloudflare's free tiers:

- **Workers Free**: 100k requests/day; the cron's per-city crawl fan-out stays well under the 50-subrequest-per-invocation cap.
- **D1 Free**: 5GB storage, 5M row reads/day, 100k row writes/day — this app's volume is trivial in comparison.
- **Resend Free**: 3,000 emails/month is the binding constraint — roughly a few hundred active subscribers before you'd upgrade or switch providers.

One reliability detail baked into the cost model: NetEase's *encrypted* `weapi` endpoint is IP-blocked from Cloudflare's egress (returns HTTP 200 with an empty body for overseas IPs), so this project talks to NetEase's *plaintext* `/api/` endpoints instead. See `docs/superpowers/specs/2026-07-13-cloudflare-open-source-refactor-design.md` §6 for the full writeup.

## Data sources & reliability

All three upstream integrations (QQ Music `musicu`, NetEase plaintext `/api/`, Showstart wap v3) are **reverse-engineered, undocumented APIs** — see `docs/showstart-reverse-engineering.md` for how the Showstart request-signing scheme was worked out. Reverse-engineered APIs *will* break eventually when the upstream changes something. This project doesn't pretend otherwise; it's built so breakage is loud and cheap to fix:

- A daily GitHub Actions job hits each live API and **auto-opens an issue** if any fail — that's the badge at the top.
- Each source is an **isolated module** with fixture tests, so a break in one doesn't take down the others, and the fix touches one file.
- If the crawl pipeline fails for every city several runs in a row, the deployed Worker emails `ADMIN_EMAIL` directly.

Please use it respectfully — keep request volume modest and don't hammer the upstreams.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
