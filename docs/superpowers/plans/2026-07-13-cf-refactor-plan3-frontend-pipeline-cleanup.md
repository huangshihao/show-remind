# CF Refactor Plan 3: Frontend SPA + Cron Pipeline + Cleanup + Open-Source Scaffolding

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-facing Vite/React SPA (subscribe wizard + manage page), the cron-driven crawl→match→notify pipeline with admin alerting, delete the old Next.js/Prisma/auth stack, and add the open-source scaffolding (README, LICENSE, GitHub Actions daily smoke).

**Architecture:** The Worker serves the SPA as static assets and runs the API (Plan 2) via `run_worker_first` on `/api/*` + `/internal/*`. A daily Cron Trigger's `scheduled()` handler fans out one self-`fetch` to `/internal/crawl?city=X` per active-subscription city (each a fresh invocation with its own 50-subrequest budget), then sends aggregated reminder emails, alerts the admin on total failure, and clears stale pending subs. The old stack is deleted last, once the new one is verified.

**Tech Stack:** Vite, React 19, Hono, D1, Cloudflare Cron Triggers + static assets, Cloudflare Turnstile (client widget), GitHub Actions.

## Global Constraints

- Depends on Plans 1 + 2 merged (repositories, API routes, mail, resolve all exist).
- Free tier: crawl fans out per city so no single invocation exceeds 50 subrequests. Reminder sends run in the `scheduled` invocation (small volume; documented).
- Cron schedule already declared in `wrangler.jsonc` (`0 2,12 * * *` UTC = 10:00/20:00 Beijing).
- Static assets: `not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*", "/internal/*"]`. Requires Wrangler ≥ 4.20.
- `/internal/*` is authenticated by the `x-internal-secret: <INTERNAL_SECRET>` header; reject otherwise with 403.
- Turnstile site key is public and exposed via `/api/config`; the secret stays server-side (Plan 2).
- Delete-list (spec §9) must all be gone by end of plan: `auth.ts`, `lib/auth/`, `app/**`, `prisma/`, `Dockerfile`, `docker-compose.yml`, `worker.ts`, and the Prisma-backed `lib/` modules; deps `next`, `next-auth`, `bcryptjs`, `prisma`, `@prisma/client`, `nodemailer`, `node-cron`.
- Commit after every task. TDD for server/pure logic; frontend logic is extracted to pure modules and unit-tested, with build + deploy as the integration check.

---

## File Structure

```
src/
  routes/
    config.ts        # GET /api/config (cities, publicMode, turnstileSiteKey)
    internal.ts      # GET /internal/crawl?city= (secret-gated)
  pipeline/
    crawl.ts         # crawlCity(db, city) -> new show ids
    match.ts         # matchNewShows(db, showIds) -> count
    notify.ts        # runNotifications(db, env) -> {sent, failed}
    admin-alert.ts   # maybeAlertAdmin(db, env, failedCities, cityCount)
    run.ts           # runScheduled(env) : fan-out + notify + alert + cleanup
  db/
    meta.ts          # get/set/bump consecutive-failure counter
  index.ts           # MODIFY: mount config+internal, export { fetch, scheduled }
migrations/
  0002_meta.sql      # meta(key,value) table
web/
  index.html
  src/
    main.tsx         # pathname router: '/' wizard, '/manage' manage
    api.ts           # typed fetch helpers
    wizard-state.ts  # PURE reducer (unit-tested)
    Wizard.tsx
    Manage.tsx
    Turnstile.tsx    # renders widget when publicMode
    styles.css
vite.config.ts
vitest.web.config.ts # happy-dom project for web unit tests
.github/workflows/
  smoke.yml          # daily live smoke -> opens issue on failure
scripts/
  smoke.ts           # live API smoke (derived from spike/)
README.md            # REWRITE
LICENSE              # MIT
CONTRIBUTING.md
```

---

### Task 1: `/api/config` + meta table + pipeline crawl/match

**Files:**
- Create: `src/routes/config.ts`
- Create: `migrations/0002_meta.sql`, `src/db/meta.ts`
- Create: `src/pipeline/crawl.ts`, `src/pipeline/match.ts`
- Modify: `src/index.ts` (mount config), `src/db/schema.sql` (append meta table so test harness creates it)
- Create: `test/pipeline/crawl-match.test.ts`, `test/routes/config.test.ts`

**Interfaces:**
- Consumes: `fetchCityShows`, `fetchShowDetail` (`@/lib/sources/showstart`); `filterNewShowstartIds`, `upsertShow`, `getShowsByIds` (Plan 1); `getAllArtists` (Plan 1); `matchShows` (`@/lib/matcher`); `persistMatches` (Plan 1); `CITIES` (`@/lib/cities`).
- Produces:
  - `crawlCity(db, cityCode): Promise<string[]>` — crawl page 1, fetch detail for unseen ids, upsert, return internal show ids. Throws on upstream failure.
  - `matchNewShows(db, showIds): Promise<number>` — match given shows against all artists, persist, return inserted count.
  - `getMeta/setMeta/bumpConsecutiveFailures/resetConsecutiveFailures` in `src/db/meta.ts`.
  - `GET /api/config` → `{ cities: [{code,name}], publicMode: boolean, turnstileSiteKey: string }`.

- [ ] **Step 1: Append the meta table to `src/db/schema.sql`**

```sql

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- [ ] **Step 2: Create migration `0002_meta.sql`**

Run: `npx wrangler d1 migrations create show-remind meta`
Put the same `CREATE TABLE ... meta ...` DDL into the new `migrations/0002_*.sql`.

- [ ] **Step 3: Write the failing tests**

`test/pipeline/crawl-match.test.ts`:
```typescript
import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import { crawlCity } from "../../src/pipeline/crawl";
import { matchNewShows } from "../../src/pipeline/match";
import { upsertArtist } from "../../src/db/artists";
import { getShowsByIds } from "../../src/db/shows";
import * as showstart from "@/lib/sources/showstart";

beforeEach(applySchema);

it("crawlCity upserts only unseen shows and returns their ids", async () => {
  vi.spyOn(showstart, "fetchCityShows").mockResolvedValue({
    shows: [
      { showstartId: "1", title: "刺猬专场", cityCode: "110000", showTime: null, url: "u1" },
      { showstartId: "2", title: "达达", cityCode: "110000", showTime: null, url: "u2" },
    ],
  });
  vi.spyOn(showstart, "fetchShowDetail").mockImplementation(async (id: string) => ({
    showstartId: id, title: `t${id}`, cityCode: "110000", venue: "MAO",
    showTime: "2026-08-01T20:00:00", price: "180", url: `u${id}`, performers: ["刺猬"],
  }));

  const ids = await crawlCity(env.DB, "110000");
  expect(ids.length).toBe(2);
  // second run sees them as known
  expect((await crawlCity(env.DB, "110000")).length).toBe(0);
  vi.restoreAllMocks();
});

it("matchNewShows links shows to followed artists by performer", async () => {
  vi.spyOn(showstart, "fetchCityShows").mockResolvedValue({
    shows: [{ showstartId: "1", title: "x", cityCode: "110000", showTime: null, url: "u1" }],
  });
  vi.spyOn(showstart, "fetchShowDetail").mockResolvedValue({
    showstartId: "1", title: "x", cityCode: "110000", venue: null,
    showTime: null, price: null, url: "u1", performers: ["刺猬"],
  });
  await upsertArtist(env.DB, "刺猬");
  const ids = await crawlCity(env.DB, "110000");
  const n = await matchNewShows(env.DB, ids);
  expect(n).toBe(1);
  expect((await getShowsByIds(env.DB, ids))[0].performers).toEqual(["刺猬"]);
  vi.restoreAllMocks();
});
```

`test/routes/config.test.ts`:
```typescript
import { expect, it } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";

it("returns cities and public flags", async () => {
  const res = await app.request("/api/config", {}, env);
  const body = (await res.json()) as any;
  expect(Array.isArray(body.cities)).toBe(true);
  expect(body.cities.find((c: any) => c.code === "110000").name).toBe("北京");
  expect(body.publicMode).toBe(false); // test env PUBLIC_MODE="0"
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `npx vitest run test/pipeline/crawl-match.test.ts test/routes/config.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 5: Implement `src/db/meta.ts`**

```typescript
export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM meta WHERE key=?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(key, value)
    .run();
}

const KEY = "consecutive_full_failures";

export async function bumpConsecutiveFailures(db: D1Database): Promise<number> {
  const n = Number((await getMeta(db, KEY)) ?? "0") + 1;
  await setMeta(db, KEY, String(n));
  return n;
}

export async function resetConsecutiveFailures(db: D1Database): Promise<void> {
  await setMeta(db, KEY, "0");
}
```

- [ ] **Step 6: Implement `src/pipeline/crawl.ts`**

```typescript
import { fetchCityShows, fetchShowDetail } from "@/lib/sources/showstart";
import { filterNewShowstartIds, upsertShow } from "../db/shows";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 800 + Math.floor(Math.random() * 800);

export async function crawlCity(db: D1Database, cityCode: string): Promise<string[]> {
  const { shows } = await fetchCityShows(cityCode, 1);
  const newIds = await filterNewShowstartIds(db, shows.map((s) => s.showstartId));
  const savedIds: string[] = [];
  for (const showstartId of newIds) {
    await sleep(jitter());
    const detail = await fetchShowDetail(showstartId);
    const saved = await upsertShow(db, detail);
    savedIds.push(saved.id);
  }
  return savedIds;
}
```

- [ ] **Step 7: Implement `src/pipeline/match.ts`**

```typescript
import { getAllArtists } from "../db/artists";
import { getShowsByIds } from "../db/shows";
import { persistMatches } from "../db/show-artists";
import { matchShows, type MatchShow } from "@/lib/matcher";

export async function matchNewShows(db: D1Database, showIds: string[]): Promise<number> {
  if (showIds.length === 0) return 0;
  const artists = await getAllArtists(db);
  if (artists.length === 0) return 0;
  const rows = await getShowsByIds(db, showIds);
  const shows: MatchShow[] = rows.map((s) => ({ id: s.id, title: s.title, performers: s.performers }));
  return persistMatches(db, matchShows(artists, shows));
}
```

- [ ] **Step 8: Implement `src/routes/config.ts`**

```typescript
import { Hono } from "hono";
import type { Env } from "../env";
import { CITIES } from "@/lib/cities";

export const configRouter = new Hono<{ Bindings: Env }>();

configRouter.get("/", (c) =>
  c.json({
    cities: CITIES,
    publicMode: c.env.PUBLIC_MODE === "1",
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? "",
  }),
);
```

Add `TURNSTILE_SITE_KEY: string` to `src/env.ts`, and to the test `bindings` in `vitest.config.ts` set `TURNSTILE_SITE_KEY: ""`.

- [ ] **Step 9: Mount config in `src/index.ts`**

```typescript
import { configRouter } from "./routes/config";
// ...
app.route("/api/config", configRouter);
```

- [ ] **Step 10: Run to verify they pass**

Run: `npx vitest run test/pipeline/crawl-match.test.ts test/routes/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 11: Commit**

```bash
git add src/routes/config.ts src/db/meta.ts src/pipeline/crawl.ts src/pipeline/match.ts src/db/schema.sql migrations/0002_meta.sql src/index.ts src/env.ts vitest.config.ts test/pipeline/crawl-match.test.ts test/routes/config.test.ts
git commit -m "feat(pipeline): crawl + match + meta counter + /api/config"
```

---

### Task 2: Notify + admin alert + scheduled fan-out + `/internal/crawl`

**Files:**
- Create: `src/pipeline/notify.ts`, `src/pipeline/admin-alert.ts`, `src/pipeline/run.ts`
- Create: `src/routes/internal.ts`
- Modify: `src/index.ts` (mount internal, export `{ fetch, scheduled }`)
- Create: `test/pipeline/notify.test.ts`, `test/routes/internal.test.ts`

**Interfaces:**
- Consumes: `findNotifyCandidates`, `markSent`, `deleteStalePending` (Plan 1); `getMailProvider` (Plan 2); `reminderEmail` (Plan 2); `crawlCity`, `matchNewShows` (Task 1); `bumpConsecutiveFailures`, `resetConsecutiveFailures` (Task 1); `CITIES`.
- Produces:
  - `runNotifications(db, env): Promise<{ sent: number; failed: number }>`
  - `maybeAlertAdmin(db, env, failedCities, cityCount): Promise<boolean>` (threshold: 3 consecutive full failures, matching old logic).
  - `activeCities(db): Promise<string[]>` — distinct cities across active subs.
  - `runScheduled(env): Promise<void>` — fan out to `/internal/crawl` per active city, aggregate failures, notify, alert, cleanup.
  - `GET /internal/crawl?city=` (secret-gated) → runs `crawlCity` + `matchNewShows`, returns `{ city, newShows }` or 500 on failure.

- [ ] **Step 1: Write the failing tests**

`test/pipeline/notify.test.ts`:
```typescript
import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import { createPendingSubscription, activateByToken } from "../../src/db/subscriptions";
import { addArtistToSubscription } from "../../src/db/subscription-artists";
import { upsertShow } from "../../src/db/shows";
import { persistMatches } from "../../src/db/show-artists";
import { runNotifications } from "../../src/pipeline/notify";

beforeEach(applySchema);

it("sends one reminder per candidate and marks shows sent", async () => {
  const sub = await createPendingSubscription(env.DB, "a@b.com", ["110000"]);
  await activateByToken(env.DB, sub.token);
  const artistId = await addArtistToSubscription(env.DB, sub.id, "刺猬");
  const show = await upsertShow(env.DB, {
    showstartId: "1", title: "刺猬专场", cityCode: "110000", venue: "MAO",
    showTime: "2026-08-01T20:00:00", price: "180", url: "https://x/1", performers: ["刺猬"],
  });
  await persistMatches(env.DB, [{ showId: show.id, artistId, matchedBy: "performer" }]);

  const sendMock = vi.fn(async () => new Response(JSON.stringify({ id: "1" }), { status: 200 }));
  vi.stubGlobal("fetch", sendMock); // no RESEND_API_KEY in test env -> console provider, fetch unused
  const res = await runNotifications(env.DB, env);
  expect(res.sent).toBe(1);
  // second run: already notified, nothing to send
  expect((await runNotifications(env.DB, env)).sent).toBe(0);
  vi.unstubAllGlobals();
});
```

`test/routes/internal.test.ts`:
```typescript
import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import app from "../../src/index";
import * as showstart from "@/lib/sources/showstart";

beforeEach(applySchema);

it("rejects without the internal secret", async () => {
  const res = await app.request("/internal/crawl?city=110000", {}, env);
  expect(res.status).toBe(403);
});

it("crawls a city when the secret matches", async () => {
  vi.spyOn(showstart, "fetchCityShows").mockResolvedValue({
    shows: [{ showstartId: "1", title: "x", cityCode: "110000", showTime: null, url: "u1" }],
  });
  vi.spyOn(showstart, "fetchShowDetail").mockResolvedValue({
    showstartId: "1", title: "x", cityCode: "110000", venue: null,
    showTime: null, price: null, url: "u1", performers: ["刺猬"],
  });
  const res = await app.request(
    "/internal/crawl?city=110000",
    { headers: { "x-internal-secret": "test-internal" } },
    env,
  );
  expect(res.status).toBe(200);
  expect((await res.json() as any).newShows).toBe(1);
  vi.restoreAllMocks();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/pipeline/notify.test.ts test/routes/internal.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `src/pipeline/notify.ts`**

```typescript
import type { Env } from "../env";
import { findNotifyCandidates, markSent } from "../db/notifications";
import { getMailProvider } from "../mail/provider";
import { reminderEmail } from "../mail/templates";

export async function runNotifications(
  db: D1Database,
  env: Env,
): Promise<{ sent: number; failed: number }> {
  const candidates = await findNotifyCandidates(db);
  const mail = getMailProvider(env);
  let sent = 0;
  let failed = 0;
  for (const cand of candidates) {
    const { subject, html } = reminderEmail(cand.shows, env.APP_BASE_URL, cand.token);
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        await mail.send({ to: cand.email, subject, html });
        ok = true;
      } catch {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    if (ok) {
      await markSent(db, cand.subscriptionId, cand.shows.map((s) => s.showId));
      sent++;
    } else {
      // leave no notification row so the next run retries (mirrors old behavior)
      failed++;
    }
  }
  return { sent, failed };
}
```

- [ ] **Step 4: Implement `src/pipeline/admin-alert.ts`**

```typescript
import type { Env } from "../env";
import { getMailProvider } from "../mail/provider";
import { bumpConsecutiveFailures, resetConsecutiveFailures } from "../db/meta";

export async function maybeAlertAdmin(
  db: D1Database,
  env: Env,
  failedCities: string[],
  cityCount: number,
): Promise<boolean> {
  const fullFailure = cityCount > 0 && failedCities.length === cityCount;
  if (!fullFailure) {
    await resetConsecutiveFailures(db);
    return false;
  }
  const streak = await bumpConsecutiveFailures(db);
  if (streak < 3 || !env.ADMIN_EMAIL) return false;
  await getMailProvider(env).send({
    to: env.ADMIN_EMAIL,
    subject: "[show-remind] 秀动爬取连续失败",
    html: `<p>已连续 ${streak} 轮全局爬取失败，失败城市：${failedCities.join(", ")}。大概率是签名算法变更，请检查 lib/sources/showstart。</p>`,
  });
  return true;
}
```

- [ ] **Step 5: Implement `src/pipeline/run.ts`**

```typescript
import type { Env } from "../env";
import { runNotifications } from "./notify";
import { maybeAlertAdmin } from "./admin-alert";
import { deleteStalePending } from "../db/notifications";

export async function activeCities(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT cities FROM subscriptions WHERE status='active'")
    .all<{ cities: string }>();
  const set = new Set<string>();
  for (const r of results) for (const c of JSON.parse(r.cities) as string[]) set.add(c);
  return [...set];
}

export async function runScheduled(env: Env): Promise<void> {
  const cities = await activeCities(env.DB);
  const failedCities: string[] = [];

  for (const city of cities) {
    try {
      const resp = await fetch(`${env.APP_BASE_URL}/internal/crawl?city=${city}`, {
        headers: { "x-internal-secret": env.INTERNAL_SECRET },
      });
      if (!resp.ok) failedCities.push(city);
    } catch {
      failedCities.push(city);
    }
  }

  await runNotifications(env.DB, env);
  await maybeAlertAdmin(env.DB, env, failedCities, cities.length);
  await deleteStalePending(env.DB, 48);
}
```

- [ ] **Step 6: Implement `src/routes/internal.ts`**

```typescript
import { Hono } from "hono";
import type { Env } from "../env";
import { crawlCity } from "../pipeline/crawl";
import { matchNewShows } from "../pipeline/match";

export const internalRouter = new Hono<{ Bindings: Env }>();

internalRouter.get("/crawl", async (c) => {
  if (c.req.header("x-internal-secret") !== c.env.INTERNAL_SECRET) {
    return c.text("forbidden", 403);
  }
  const city = c.req.query("city");
  if (!city) return c.json({ error: "missing city" }, 400);
  try {
    const showIds = await crawlCity(c.env.DB, city);
    const matched = await matchNewShows(c.env.DB, showIds);
    return c.json({ city, newShows: showIds.length, matched });
  } catch (err) {
    return c.json({ city, error: String(err) }, 500);
  }
});
```

- [ ] **Step 7: Modify `src/index.ts` — mount internal + export scheduled**

Add:
```typescript
import { internalRouter } from "./routes/internal";
import { runScheduled } from "./pipeline/run";
// ...after other routes:
app.route("/internal", internalRouter);

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // jitter 0-10 min so runs are not exactly on the minute
    const delay = Math.floor(Math.random() * 10 * 60 * 1000);
    ctx.waitUntil(new Promise<void>((r) => setTimeout(r, delay)).then(() => runScheduled(env)));
  },
};
```
Replace the old `export default app;` line. (Tests import `app` — keep the `const app = new Hono...` and add a named `export { app }`? No: tests do `import app from "../../src/index"`. Change tests? Simpler: keep default export as the handler object AND have Hono's `app.request` accessible. Since tests call `app.request`, export the Hono instance separately.)

Update the two lines:
```typescript
export { app }; // for app.request in tests
export default { fetch: app.fetch, async scheduled(...) { ... } };
```
And change every test import from `import app from "../../src/index"` to `import { app } from "../../src/index"`. Do this now across `test/routes/*.test.ts` and `test/routes/config.test.ts`, `test/routes/internal.test.ts`.

- [ ] **Step 8: Run to verify tests pass**

Run: `npx vitest run test/pipeline/notify.test.ts test/routes/internal.test.ts`
Expected: PASS (3 tests). Then run the whole server suite: `npx vitest run test/` — all pass.

- [ ] **Step 9: Commit**

```bash
git add src/pipeline/ src/routes/internal.ts src/index.ts test/pipeline/notify.test.ts test/routes/internal.test.ts test/routes/*.test.ts
git commit -m "feat(pipeline): notify + admin alert + scheduled fan-out + /internal/crawl"
```

---

### Task 3: Vite scaffold + wizard state (pure, tested)

**Files:**
- Modify: `package.json` (add vite/react-dom build deps + scripts)
- Create: `vite.config.ts`, `vitest.web.config.ts`, `web/index.html`, `web/src/styles.css`
- Create: `web/src/wizard-state.ts`, `web/src/api.ts`
- Create: `web/src/wizard-state.test.ts`

**Interfaces:**
- Produces:
  - `wizard-state.ts`: `interface WizardState { step, title, artists: Selectable[], selected: Set<string>, cities: string[], email }`; reducer `wizardReducer(state, action)` with actions `LOADED_PLAYLIST`, `TOGGLE_ARTIST`, `ADD_MANUAL`, `SET_CITIES`, `SET_EMAIL`, `GOTO`. `selectedArtistNames(state): string[]`.
  - `api.ts`: `getConfig()`, `resolveLink(link, turnstileToken?)`, `subscribe(payload)` typed fetch wrappers.

- [ ] **Step 1: Add deps + scripts**

Run:
```bash
pnpm add react react-dom
pnpm add -D vite @vitejs/plugin-react happy-dom @testing-library/react
```
Add to `package.json` scripts:
```json
"web:dev": "vite",
"web:build": "vite build",
"test:web": "vitest run --config vitest.web.config.ts"
```

- [ ] **Step 2: Write `vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
});
```

- [ ] **Step 3: Write `vitest.web.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["web/**/*.test.ts", "web/**/*.test.tsx"],
    environment: "happy-dom",
  },
});
```

- [ ] **Step 4: Write the failing test** — `web/src/wizard-state.test.ts`

```typescript
import { expect, it } from "vitest";
import { initialWizard, wizardReducer, selectedArtistNames } from "./wizard-state";

it("loads a playlist and pre-selects all artists", () => {
  const s = wizardReducer(initialWizard(), {
    type: "LOADED_PLAYLIST",
    title: "My List",
    artists: [{ name: "刺猬", songCount: 3 }, { name: "达达", songCount: 1 }],
  });
  expect(s.title).toBe("My List");
  expect(selectedArtistNames(s).sort()).toEqual(["刺猬", "达达"]);
});

it("toggles and adds manual artists without duplicates", () => {
  let s = wizardReducer(initialWizard(), {
    type: "LOADED_PLAYLIST", title: "x", artists: [{ name: "刺猬", songCount: 1 }],
  });
  s = wizardReducer(s, { type: "TOGGLE_ARTIST", name: "刺猬" });
  expect(selectedArtistNames(s)).toEqual([]);
  s = wizardReducer(s, { type: "ADD_MANUAL", name: "海龟先生" });
  s = wizardReducer(s, { type: "ADD_MANUAL", name: "海龟先生" });
  expect(selectedArtistNames(s)).toEqual(["海龟先生"]);
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm test:web`
Expected: FAIL (module not found).

- [ ] **Step 6: Implement `web/src/wizard-state.ts`**

```typescript
export interface Selectable {
  name: string;
  songCount: number;
}

export interface WizardState {
  step: number; // 0 paste, 1 pick artists, 2 cities, 3 email
  title: string;
  artists: Selectable[];
  selected: string[]; // artist names
  cities: string[];
  email: string;
}

export type WizardAction =
  | { type: "LOADED_PLAYLIST"; title: string; artists: Selectable[] }
  | { type: "TOGGLE_ARTIST"; name: string }
  | { type: "ADD_MANUAL"; name: string }
  | { type: "SET_CITIES"; cities: string[] }
  | { type: "SET_EMAIL"; email: string }
  | { type: "GOTO"; step: number };

export function initialWizard(): WizardState {
  return { step: 0, title: "", artists: [], selected: [], cities: [], email: "" };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "LOADED_PLAYLIST":
      return {
        ...state,
        step: 1,
        title: action.title,
        artists: action.artists,
        selected: action.artists.map((a) => a.name),
      };
    case "TOGGLE_ARTIST": {
      const on = state.selected.includes(action.name);
      return {
        ...state,
        selected: on
          ? state.selected.filter((n) => n !== action.name)
          : [...state.selected, action.name],
      };
    }
    case "ADD_MANUAL": {
      const name = action.name.trim();
      if (!name) return state;
      const known = state.artists.some((a) => a.name === name);
      return {
        ...state,
        artists: known ? state.artists : [...state.artists, { name, songCount: 0 }],
        selected: state.selected.includes(name) ? state.selected : [...state.selected, name],
      };
    }
    case "SET_CITIES":
      return { ...state, cities: action.cities };
    case "SET_EMAIL":
      return { ...state, email: action.email };
    case "GOTO":
      return { ...state, step: action.step };
  }
}

export function selectedArtistNames(state: WizardState): string[] {
  return state.selected;
}
```

- [ ] **Step 7: Implement `web/src/api.ts`**

```typescript
export interface Config {
  cities: { code: string; name: string }[];
  publicMode: boolean;
  turnstileSiteKey: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const getConfig = () => fetch("/api/config").then((r) => json<Config>(r));

export const resolveLink = (link: string, turnstileToken?: string) =>
  fetch("/api/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ link, turnstileToken }),
  }).then((r) => json<{ platform: string; title: string; artists: { name: string; songCount: number }[] }>(r));

export const subscribe = (payload: {
  email: string;
  cities: string[];
  artists: string[];
  turnstileToken?: string;
}) =>
  fetch("/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => json<{ ok: boolean }>(r));
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm test:web`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml vite.config.ts vitest.web.config.ts web/src/wizard-state.ts web/src/wizard-state.test.ts web/src/api.ts
git commit -m "feat(web): vite scaffold + tested wizard reducer + api client"
```

---

### Task 4: React shells (wizard + manage + Turnstile) and build wiring

**Files:**
- Create: `web/index.html`, `web/src/main.tsx`, `web/src/Wizard.tsx`, `web/src/Manage.tsx`, `web/src/Turnstile.tsx`, `web/src/styles.css`
- Modify: `wrangler.jsonc` (assets block)

**Interfaces:**
- Consumes: `wizard-state.ts`, `api.ts` (Task 3).
- Produces: static `dist/` build served by the Worker; `/` renders the wizard, `/manage` renders the manage page.

- [ ] **Step 1: Write `web/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Show-Remind · 演出提醒</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `web/src/Turnstile.tsx`**

```tsx
import { useEffect, useRef } from "react";

// Renders the Turnstile widget only when a site key is provided. The widget
// script is loaded on demand. onToken fires with the solved token.
export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey) return;
    const id = "cf-turnstile-script";
    function render() {
      const w = (window as any).turnstile;
      if (w && ref.current) w.render(ref.current, { sitekey: siteKey, callback: onToken });
    }
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    } else {
      render();
    }
  }, [siteKey, onToken]);
  if (!siteKey) return null;
  return <div ref={ref} />;
}
```

- [ ] **Step 3: Write `web/src/Wizard.tsx`**

```tsx
import { useEffect, useReducer, useState } from "react";
import { initialWizard, wizardReducer, selectedArtistNames } from "./wizard-state";
import { getConfig, resolveLink, subscribe, type Config } from "./api";
import { Turnstile } from "./Turnstile";

export function Wizard() {
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialWizard);
  const [config, setConfig] = useState<Config | null>(null);
  const [link, setLink] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    getConfig().then(setConfig).catch((e) => setError(String(e)));
  }, []);

  async function onResolve() {
    setBusy(true);
    setError("");
    try {
      const r = await resolveLink(link, token || undefined);
      dispatch({ type: "LOADED_PLAYLIST", title: r.title, artists: r.artists });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function onSubscribe() {
    setBusy(true);
    setError("");
    try {
      await subscribe({
        email: state.email,
        cities: state.cities,
        artists: selectedArtistNames(state),
        turnstileToken: token || undefined,
      });
      setDone(true);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <main className="card">
        <h1>就快好了 🎉</h1>
        <p>确认邮件已发到 <b>{state.email}</b>，点击里面的链接即可开始接收演出提醒。</p>
      </main>
    );

  return (
    <main className="card">
      <h1>Show-Remind</h1>
      <p className="sub">粘贴歌单，选关注的音乐人，留个邮箱，有新演出就发邮件。</p>
      {error && <p className="err">{error}</p>}

      {state.step === 0 && (
        <>
          <label>网易云 / QQ 音乐 公开歌单链接</label>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
          {config?.publicMode && (
            <Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} />
          )}
          <button disabled={busy || !link} onClick={onResolve}>解析歌单</button>
          <button className="link" onClick={() => dispatch({ type: "LOADED_PLAYLIST", title: "手动添加", artists: [] })}>
            跳过，手动输入音乐人
          </button>
        </>
      )}

      {state.step === 1 && (
        <>
          <label>选择要关注的音乐人（{selectedArtistNames(state).length}）</label>
          <ul className="artists">
            {state.artists.map((a) => (
              <li key={a.name}>
                <label>
                  <input
                    type="checkbox"
                    checked={state.selected.includes(a.name)}
                    onChange={() => dispatch({ type: "TOGGLE_ARTIST", name: a.name })}
                  />
                  {a.name} {a.songCount > 0 && <span className="count">· {a.songCount} 首</span>}
                </label>
              </li>
            ))}
          </ul>
          <ManualAdd onAdd={(name) => dispatch({ type: "ADD_MANUAL", name })} />
          <button disabled={!selectedArtistNames(state).length} onClick={() => dispatch({ type: "GOTO", step: 2 })}>
            下一步：选城市
          </button>
        </>
      )}

      {state.step === 2 && config && (
        <>
          <label>关注的城市（1-10）</label>
          <div className="cities">
            {config.cities.map((c) => (
              <label key={c.code}>
                <input
                  type="checkbox"
                  checked={state.cities.includes(c.code)}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_CITIES",
                      cities: e.target.checked
                        ? [...state.cities, c.code]
                        : state.cities.filter((x) => x !== c.code),
                    })
                  }
                />
                {c.name}
              </label>
            ))}
          </div>
          <button disabled={!state.cities.length} onClick={() => dispatch({ type: "GOTO", step: 3 })}>
            下一步：填邮箱
          </button>
        </>
      )}

      {state.step === 3 && (
        <>
          <label>接收提醒的邮箱</label>
          <input
            type="email"
            value={state.email}
            onChange={(e) => dispatch({ type: "SET_EMAIL", email: e.target.value })}
            placeholder="you@example.com"
          />
          {config?.publicMode && <Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} />}
          <button disabled={busy || !state.email} onClick={onSubscribe}>订阅</button>
        </>
      )}
    </main>
  );
}

function ManualAdd({ onAdd }: { onAdd: (name: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="manual">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="手动添加音乐人" />
      <button
        className="link"
        onClick={() => {
          onAdd(v);
          setV("");
        }}
      >
        添加
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write `web/src/Manage.tsx`**

```tsx
import { useEffect, useState } from "react";

interface View {
  email: string;
  cities: string[];
  artists: { id: string; name: string }[];
}

export function Manage({ token }: { token: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");

  async function reload() {
    const res = await fetch(`/api/manage?token=${token}`);
    if (!res.ok) return setError("链接无效或已退订");
    setView(await res.json());
  }
  useEffect(() => {
    reload();
  }, [token]);

  async function removeArtist(id: string) {
    await fetch(`/api/manage/artists/${id}?token=${token}`, { method: "DELETE" });
    reload();
  }
  async function addArtist(name: string) {
    await fetch(`/api/manage/artists?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    reload();
  }
  async function unsubscribe() {
    await fetch(`/api/manage/unsubscribe?token=${token}`, { method: "POST" });
    setView(null);
    setError("已退订。想重新订阅请回首页。");
  }

  if (error) return <main className="card"><p>{error}</p></main>;
  if (!view) return <main className="card"><p>加载中…</p></main>;

  return (
    <main className="card">
      <h1>我的关注</h1>
      <p className="sub">{view.email}</p>
      <h3>音乐人</h3>
      <ul className="artists">
        {view.artists.map((a) => (
          <li key={a.id}>
            {a.name} <button className="link" onClick={() => removeArtist(a.id)}>移除</button>
          </li>
        ))}
      </ul>
      <ManualAdd onAdd={addArtist} />
      <hr />
      <button className="danger" onClick={unsubscribe}>退订全部提醒</button>
    </main>
  );
}

function ManualAdd({ onAdd }: { onAdd: (name: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="manual">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="添加音乐人" />
      <button className="link" onClick={() => { onAdd(v); setV(""); }}>添加</button>
    </div>
  );
}
```

- [ ] **Step 5: Write `web/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Wizard } from "./Wizard";
import { Manage } from "./Manage";
import "./styles.css";

function Root() {
  const path = window.location.pathname;
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  if (path.startsWith("/manage") && token) return <Manage token={token} />;
  return <Wizard />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
```

- [ ] **Step 6: Write `web/src/styles.css`** (minimal, mobile-first)

```css
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; background: #f6f6f7; }
.card { max-width: 560px; margin: 5vh auto; padding: 24px; background: Canvas;
  border-radius: 16px; box-shadow: 0 2px 20px rgba(0,0,0,.08); }
h1 { margin: 0 0 4px; }
.sub { color: #888; margin-top: 0; }
label { display: block; margin: 16px 0 6px; font-weight: 600; }
input[type=text], input[type=email], input:not([type]) { width: 100%; padding: 10px;
  border: 1px solid #ccc; border-radius: 10px; box-sizing: border-box; }
button { margin-top: 16px; padding: 10px 18px; border: 0; border-radius: 10px;
  background: #3b5bdb; color: #fff; font-size: 15px; cursor: pointer; }
button:disabled { opacity: .5; cursor: not-allowed; }
button.link { background: none; color: #3b5bdb; padding: 6px; }
button.danger { background: #e03131; }
.artists, .cities { list-style: none; padding: 0; display: grid; gap: 8px; }
.cities { grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); }
.artists label, .cities label { font-weight: 400; margin: 0; }
.count { color: #aaa; }
.err { color: #e03131; }
.manual { display: flex; gap: 8px; align-items: center; }
.manual input { flex: 1; }
```

- [ ] **Step 7: Add the assets block to `wrangler.jsonc`**

Add alongside the existing keys:
```jsonc
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/internal/*"]
  },
```
And add `ASSETS: Fetcher;` to `src/env.ts`.

- [ ] **Step 8: Build the client and typecheck**

Run: `pnpm web:build && npx tsc --noEmit`
Expected: `dist/` produced with `index.html` + hashed assets; no type errors.

- [ ] **Step 9: Local end-to-end smoke with `wrangler dev`**

Run: `pnpm web:build && npx wrangler dev`
In another shell:
```bash
curl -s localhost:8787/api/config | head
curl -s localhost:8787/ | grep -o '<div id="root">'
```
Expected: config JSON; root div served. Manually open `http://localhost:8787/` and step through paste→pick→cities→email (console mail provider prints the confirm link in the `wrangler dev` output).

- [ ] **Step 10: Commit**

```bash
git add web/ wrangler.jsonc src/env.ts
git commit -m "feat(web): subscribe wizard + manage page + turnstile widget, served as static assets"
```

---

### Task 5: Delete the old Next.js / Prisma / auth stack

**Files:**
- Delete: `auth.ts`, `worker.ts`, `next.config.ts`, `next-env.d.ts`, `Dockerfile`, `docker-compose.yml`
- Delete dirs: `app/`, `prisma/`, `lib/auth/`, and Prisma-backed `lib/` modules: `lib/db.ts`, `lib/pipeline.ts`, `lib/pipeline.test.ts`, `lib/crawler/`, `lib/notifier/`, `lib/repositories/`, `lib/services/`
- Modify: `package.json` (drop deps + old scripts), `tsconfig.json` (drop Next settings)

**Interfaces:** none (removal). After this task the ONLY runtime code is the Worker (`src/`) + client (`web/`) + pure `lib/` (`matcher`, `adapters`, `sources`, `cities.ts`).

- [ ] **Step 1: Confirm nothing in `src/` or `web/` imports the doomed modules**

Run:
```bash
grep -rEn "@/lib/(db|pipeline|crawler|notifier|repositories|services|auth)" src web && echo "FOUND — fix before deleting" || echo "clean"
```
Expected: `clean`. (Plans 1-2 use `src/db/*` and pure `lib/` only.)

- [ ] **Step 2: Delete files and dirs**

```bash
git rm -r auth.ts worker.ts next.config.ts next-env.d.ts Dockerfile docker-compose.yml \
  app prisma lib/auth lib/db.ts lib/pipeline.ts lib/pipeline.test.ts \
  lib/crawler lib/notifier lib/repositories lib/services
```

- [ ] **Step 3: Drop dependencies and stale scripts from `package.json`**

Run:
```bash
pnpm remove next next-auth bcryptjs @prisma/client prisma nodemailer node-cron @types/bcryptjs @types/nodemailer @types/node-cron
```
Remove the `dev`, `build`, `start`, `worker`, `prisma:migrate`, `prisma:generate` script entries (keep `test`, `cf:*`, `db:migrate:*`, `web:*`, `test:web`). Set `"test": "vitest run --config vitest.config.ts && vitest run --config vitest.web.config.ts"`.

- [ ] **Step 4: Clean `tsconfig.json`**

Remove Next.js-specific bits (the `next` plugin under `compilerOptions.plugins`, `.next` includes, `next-env.d.ts` include). Ensure `compilerOptions` keeps `"jsx": "react-jsx"`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"types": ["@cloudflare/vitest-pool-workers"]`, and the `@/*` path alias. Include `src`, `web`, `lib`, `test`.

- [ ] **Step 5: Typecheck + full test suite**

Run: `npx tsc --noEmit && pnpm test`
Expected: no type errors; all server + web tests pass. Fix any dangling import surfaced by the compiler (there should be none if Step 1 was clean).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove Next.js/Prisma/auth stack, docker, and unused deps"
```

---

### Task 6: Open-source scaffolding (README, LICENSE, CONTRIBUTING)

**Files:**
- Rewrite: `README.md`
- Create: `LICENSE` (MIT), `CONTRIBUTING.md`
- Modify: `wrangler.jsonc` (ensure comments explain each secret/var)

**Interfaces:** none (docs).

- [ ] **Step 1: Write `LICENSE`** — standard MIT text, year 2026, copyright the maintainer's GitHub handle.

- [ ] **Step 2: Rewrite `README.md`**

Include, in this order:
- One-line description + the daily smoke status badge (added in Task 7): `![smoke](https://github.com/<owner>/show-remind/actions/workflows/smoke.yml/badge.svg)`.
- **What it does**: paste a QQ/NetEase playlist → pick artists → pick cities → enter email → confirm → get an email when a followed artist has a new Showstart gig. No account.
- **Deploy to Cloudflare (free tier)** — the self-host path:
  1. `pnpm install`
  2. `npx wrangler d1 create show-remind` → paste `database_id` into `wrangler.jsonc`
  3. `pnpm db:migrate:remote`
  4. Onboard a domain to Cloudflare Email Routing OR get a Resend API key; set secrets:
     ```bash
     npx wrangler secret put RESEND_API_KEY
     npx wrangler secret put INTERNAL_SECRET   # any long random string
     npx wrangler secret put ADMIN_EMAIL       # where failure alerts go
     npx wrangler secret put TURNSTILE_SECRET  # only if PUBLIC_MODE=1
     ```
     and vars in `wrangler.jsonc`: `APP_BASE_URL` (your deployed URL), `MAIL_FROM`, `PUBLIC_MODE` (`0` for personal, `1` for a public instance), `TURNSTILE_SITE_KEY` (public).
  5. `pnpm web:build && npx wrangler deploy`
- **Local dev**: `pnpm web:build && npx wrangler dev` (console mail provider prints confirm/reminder links to the terminal; `PUBLIC_MODE=0` skips Turnstile).
- **Cost note**: fits Workers Free + D1 Free; the binding ceiling is Resend's 3,000 emails/month (≈ hundreds of active subscribers). NetEase's encrypted API is IP-blocked from Cloudflare egress — this project uses the plaintext endpoints (see `docs/…design.md` §6).
- **Data sources & reliability**: link `docs/showstart-reverse-engineering.md`; explain the daily smoke + auto-issue; state plainly that reverse-engineered APIs can break and the smoke is the early-warning system.
- **Tests**: `pnpm test`.

- [ ] **Step 3: Write `CONTRIBUTING.md`**

Short: architecture one-paragraph (Worker + D1 + cron + Vite SPA); where the fragile bits live (`lib/sources/`, `lib/adapters/`) and that fixture tests + `docs/scraper-smoke.md` guard them; how to add a city (`lib/cities.ts`); "run `pnpm test` before a PR"; MIT contribution note.

- [ ] **Step 4: Verify wrangler config is self-documenting**

Ensure every non-secret var in `wrangler.jsonc` has a `//` comment. Run `npx wrangler deploy --dry-run` — expected: validates.

- [ ] **Step 5: Commit**

```bash
git add README.md LICENSE CONTRIBUTING.md wrangler.jsonc
git commit -m "docs: MIT license, self-host README, contributing guide"
```

---

### Task 7: GitHub Actions daily live smoke + auto-issue

**Files:**
- Create: `scripts/smoke.ts` (derived from `spike/probe-lib.ts`)
- Create: `.github/workflows/smoke.yml`
- Optional: delete `spike/` once `scripts/smoke.ts` supersedes it, or keep as scratch

**Interfaces:**
- Produces: `scripts/smoke.ts` exits non-zero if any of the three live sources fails; the workflow opens/updates a GitHub Issue on failure and drives the README badge.

- [ ] **Step 1: Write `scripts/smoke.ts`**

```typescript
// Live smoke: hits the three real upstreams from GitHub Actions' egress and
// exits non-zero if any core path fails. Fixtures cover parsing; this covers
// live availability. Mirrors docs/scraper-smoke.md.
import { resolveNeteasePlaylist } from "@/lib/adapters/netease";
import { fetchQqPlaylist } from "@/lib/sources/qq";
import { fetchCityShows, fetchShowDetail } from "@/lib/sources/showstart";

const NETEASE = "3778678"; // 热歌榜
const QQ = process.env.SMOKE_QQ_PLAYLIST ?? "7256912512";
const CITY = "310000"; // Shanghai

async function check(name: string, fn: () => Promise<string>): Promise<boolean> {
  try {
    console.log(`✓ ${name}: ${await fn()}`);
    return true;
  } catch (e) {
    console.error(`✗ ${name}: ${e}`);
    return false;
  }
}

const results = await Promise.all([
  check("netease", async () => {
    const p = await resolveNeteasePlaylist(NETEASE);
    if (p.songs.length === 0) throw new Error("no songs");
    return `${p.title} (${p.songs.length} songs)`;
  }),
  check("qq", async () => {
    const p = await fetchQqPlaylist(QQ);
    if (p.songs.length === 0) throw new Error("no songs");
    return `${p.title} (${p.songs.length} songs)`;
  }),
  check("showstart", async () => {
    const { shows } = await fetchCityShows(CITY, 1);
    if (shows.length === 0) throw new Error("no shows");
    const d = await fetchShowDetail(shows[0].showstartId);
    return `${shows.length} shows, detail performers=${d.performers.length}`;
  }),
]);

if (results.some((ok) => !ok)) process.exit(1);
```

Note: run with `tsx` and a `tsconfig-paths` loader OR add `"tsx": { "paths": ... }`; simplest is `npx tsx --tsconfig tsconfig.json scripts/smoke.ts` since the `@/*` alias resolves via tsconfig with tsx's TS path support. If tsx does not honor the alias, change the three imports to relative paths (`../lib/...`).

- [ ] **Step 2: Verify the smoke runs locally**

Run: `npx tsx scripts/smoke.ts`
Expected: three `✓` lines, exit 0. (This is the same behavior confirmed in the Phase 0 spike.)

- [ ] **Step 3: Write `.github/workflows/smoke.yml`**

```yaml
name: smoke
on:
  schedule:
    - cron: "0 1 * * *" # daily 09:00 Beijing
  workflow_dispatch: {}

jobs:
  smoke:
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Run live smoke
        id: smoke
        run: npx tsx scripts/smoke.ts
      - name: Open issue on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            const title = "Daily source smoke failing";
            const existing = await github.rest.issues.listForRepo({
              owner: context.repo.owner, repo: context.repo.repo,
              state: "open", labels: "smoke-failure",
            });
            const body = `The daily live smoke failed on ${new Date().toISOString()}.
            See the run: ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}
            One of netease/qq/showstart likely changed. Check lib/sources & lib/adapters.`;
            if (existing.data.length === 0) {
              await github.rest.issues.create({
                owner: context.repo.owner, repo: context.repo.repo,
                title, body, labels: ["smoke-failure"],
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner, repo: context.repo.repo,
                issue_number: existing.data[0].number, body,
              });
            }
```

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.ts .github/workflows/smoke.yml
git commit -m "ci: daily live source smoke with auto-issue on failure"
```

---

### Task 8: Final production deploy + verification

**Files:** none (verification)

- [ ] **Step 1: Set production secrets/vars**

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put INTERNAL_SECRET
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put TURNSTILE_SECRET   # only if PUBLIC_MODE=1
```
Set `APP_BASE_URL`, `MAIL_FROM`, `PUBLIC_MODE`, `TURNSTILE_SITE_KEY` as `vars` in `wrangler.jsonc`.

- [ ] **Step 2: Migrate + build + deploy**

```bash
pnpm db:migrate:remote
pnpm web:build
npx wrangler deploy
```
Expected: deploy succeeds; cron trigger `0 2,12 * * *` registered.

- [ ] **Step 3: End-to-end on the live URL**

- Open `https://<app>/`, subscribe with a real playlist + your email.
- Confirm the email arrives (Resend) and its link activates → lands on `/manage`.
- On `/manage`, add/remove an artist, change a city, then unsubscribe.
- Manually trigger the pipeline once:
  ```bash
  curl -s "https://<app>/internal/crawl?city=110000" -H "x-internal-secret: <INTERNAL_SECRET>"
  ```
  Expected: `{"city":"110000","newShows":N,"matched":M}`.

- [ ] **Step 4: Confirm cron ran (next day) or force via dashboard**

Check the Worker's Cron "Past events" in the dashboard for a success entry, or re-run `/internal/crawl` for each active city manually to seed the first batch.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: production deploy verified on Cloudflare free tier" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage (whole refactor, closing the loop):** §2 architecture (Worker + assets + Hono + D1 + cron + Resend) ✓; §4.1 wizard ✓ (Tasks 3-4); §4.2 manage ✓ (Task 4 + Plan 2); §4.3 cron pipeline fan-out ✓ (Tasks 1-2); §5 anti-abuse Turnstile client + PUBLIC_MODE ✓ (Task 4 + Plan 2); §6 admin alert + daily smoke + auto-issue + badge ✓ (Tasks 2,6,7); §7 error handling (per-city isolation, notify retry leaves pending, 404 on bad token, stale cleanup) ✓; §8 tests (workers pool + web pool + live smoke separated) ✓; §9 delete-list + open-source scaffolding ✓ (Tasks 5-7).
- **Placeholder scan:** none — every module has full code; docs tasks specify exact contents/sections.
- **Type consistency:** `crawlCity`→`matchNewShows` pass `string[]` show ids; `runNotifications` consumes `Candidate`/`NotifyShow` (Plan 1) and `reminderEmail` (Plan 2) with matching field names; `wizardReducer` action names match `Wizard.tsx` dispatch calls; `api.ts` return shapes match Plan 2 route responses (`resolve`→`{platform,title,artists}`, `subscribe`→`{ok}`, `config`→`{cities,publicMode,turnstileSiteKey}`).
- **Import-default change (Task 2 Step 7):** default export switches from the Hono app to `{ fetch, scheduled }`; every test's `import app` becomes `import { app }`. This is called out explicitly so a task reviewer applies it repo-wide in the same commit.
- **Free-tier watch:** the `scheduled` invocation sends all reminder emails itself (one Resend subrequest per candidate). At the documented scale (single-digit emails/run) this is well under 50 subrequests; if a public instance grows, fan out notify per subscription the same way crawl fans out per city.
