# Show-Remind

Paste a music playlist, pick the artists you follow, get an email when they book a gig in your city — no account, no password.

<!-- Replace <your-github-username> below with the actual GitHub org/user once this repo has a remote, so the badge points at your fork's Actions run. -->
![smoke](https://github.com/<your-github-username>/show-remind/actions/workflows/smoke.yml/badge.svg)

## What it does

1. Paste a public QQ Music or NetEase Cloud Music playlist link.
2. Show-Remind resolves it and shows you the artists in that playlist (with song counts) — pick which ones to follow, or type in an artist name manually.
3. Pick the cities you care about.
4. Enter your email and confirm via a link sent to your inbox.
5. Whenever one of your followed artists announces a new Showstart (秀动) gig in one of your cities, you get a reminder email.

There's no login. Every email (confirmation, reminder) carries a per-subscription magic-link token used to open the "manage subscription" page — add/remove artists, change cities, re-import a playlist, or unsubscribe with one click.

## Deploy to Cloudflare (free tier)

This is a single Cloudflare Worker: a Hono API + a Vite/React SPA served as static assets, backed by D1, with a cron trigger that runs the crawl → match → notify pipeline twice a day.

**Prereqs:** Node 22+ (wrangler 4.x requires it) and [pnpm](https://pnpm.io).

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Create the D1 database and wire up its ID:
   ```bash
   npx wrangler d1 create show-remind
   ```
   Paste the `database_id` from the output into the `d1_databases[0].database_id` field in `wrangler.jsonc`.
3. Apply the schema to the remote database:
   ```bash
   pnpm db:migrate:remote
   ```
4. Set up outbound mail. The $0 path is a [Resend](https://resend.com) API key (free tier: 3,000 emails/month, requires verifying a sending domain). Cloudflare Email Routing can receive mail for your domain, but *sending* to arbitrary recipients from a Worker requires Cloudflare Email Sending, which needs a Workers Paid plan — so for a free-tier deploy, use Resend. Then set the secrets:
   ```bash
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put INTERNAL_SECRET   # any long random string — authenticates the cron's self-calls to /internal/crawl
   npx wrangler secret put ADMIN_EMAIL       # where pipeline-failure alerts go
   npx wrangler secret put TURNSTILE_SECRET  # only if PUBLIC_MODE=1
   ```
5. Set the non-secret vars in `wrangler.jsonc`'s `vars` block (each already has a `//` comment explaining it):
   - `APP_BASE_URL` — your deployed Worker's URL (used to build links in emails).
   - `MAIL_FROM` — your verified sender address.
   - `PUBLIC_MODE` — `"0"` for a personal instance (no Turnstile, no caps), `"1"` if you're running this as a public instance for others.
   - `TURNSTILE_SITE_KEY` — public Turnstile site key, only needed if `PUBLIC_MODE` is `"1"`.
6. Build the frontend and deploy:
   ```bash
   pnpm web:build && npx wrangler deploy
   ```

## Local dev

```bash
pnpm web:build && npx wrangler dev
```

With no `RESEND_API_KEY` configured, mail falls back to a console provider that prints confirm/reminder links straight to the terminal instead of sending real email. `PUBLIC_MODE=0` (the default) skips the Turnstile check, so you can run through the whole flow locally without a Turnstile key.

If your machine's default Node is older than 22, run wrangler through a Node 22+ runtime, e.g. with [mise](https://mise.jdx.dev): `mise exec node@24 -- npx wrangler dev`.

## Cost

Designed to fit entirely inside Cloudflare's free tiers:

- **Workers Free**: 100k requests/day, and the cron's per-city crawl fan-out stays well under the 50-subrequest-per-invocation cap.
- **D1 Free**: 5GB storage, 5M row reads/day, 100k row writes/day — this app's read/write volume is trivial in comparison.
- **Resend Free**: 3,000 emails/month is the binding constraint. That's roughly enough for a few hundred active subscribers before you'd need to upgrade or switch mail providers.

One reliability detail baked into the cost model: NetEase's *encrypted* `weapi` endpoint is IP-blocked from Cloudflare's egress (returns HTTP 200 with an empty body for overseas IPs), so this project talks to NetEase's *plaintext* `/api/` endpoints instead. See `docs/superpowers/specs/2026-07-13-cloudflare-open-source-refactor-design.md` §6 for the full spike writeup.

## Data sources & reliability

All three upstream integrations (QQ Music `musicu`, NetEase plaintext `/api/`, Showstart wap v3) are reverse-engineered, undocumented APIs — see `docs/showstart-reverse-engineering.md` for how the Showstart signing scheme was worked out. Reverse-engineered APIs *will* break eventually when the upstream changes something. This project doesn't promise they won't; instead it's built so breakage is loud and cheap to fix:

- A daily GitHub Actions job hits each of the three live APIs and opens a GitHub issue automatically if any of them fail — that's the badge at the top of this README.
- Each source lives in its own isolated module (`lib/sources/`, `lib/adapters/`) with fixture tests, so a break in one source doesn't take down the others, and fixing it means touching one file.
- If the crawl pipeline fails for every city several runs in a row, the deployed Worker emails `ADMIN_EMAIL` directly, independent of the daily smoke check.

## Tests

```bash
pnpm test
```

Runs both suites: the server-side test suite (`@cloudflare/vitest-pool-workers`, exercising Worker routes and D1) and the web test suite (`happy-dom`, exercising the React SPA).
