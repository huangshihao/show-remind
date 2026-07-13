# Contributing

## Architecture

Show-Remind is a single Cloudflare Worker: a Hono API (`src/index.ts`) that serves a Vite/React SPA (`web/`) as static assets, reads and writes D1 (`src/db/`, schema in `src/db/schema.sql`, migrations in `migrations/`), and runs a cron trigger twice a day (`src/pipeline/`) that crawls Showstart for new gigs, matches them against subscribed artists, and sends reminder emails via Resend (or a console provider in local dev).

## The fragile bits

`lib/sources/` (raw QQ Music / Showstart API clients) and `lib/adapters/` (playlist parsing, including `lib/adapters/netease/`) talk to reverse-engineered, undocumented third-party APIs. They **will** break when an upstream changes something — that's expected, not a sign something is wrong with the design. Two things guard them:

- Fixture-based unit tests (`lib/sources/*.test.ts`, `lib/adapters/**/*.test.ts`) pin the expected request/response shapes.
- `docs/scraper-smoke.md` documents live smoke checks against the real upstream APIs (run daily in CI — see the badge in `README.md`), which is how you find out fast when a fixture test still passes but the real API has moved.

If you're fixing a broken source, start by reading `docs/showstart-reverse-engineering.md` for how the Showstart signing scheme was worked out, then update the relevant fixture(s) alongside the fix.

## Adding a city

City codes live in `lib/cities.ts` as a flat `{ code, name }` list keyed by Showstart's city code. To add a city, add an entry there — no other code changes are needed; it's picked up by the resolve/subscribe/manage flows and the crawl fan-out automatically.

## Before opening a PR

```bash
pnpm test
```

This runs both the server-side suite (`@cloudflare/vitest-pool-workers`) and the web suite (`happy-dom`). Please make sure it's green before you open a PR.

## License

By contributing, you agree that your contributions will be licensed under this project's MIT license (see `LICENSE`).
