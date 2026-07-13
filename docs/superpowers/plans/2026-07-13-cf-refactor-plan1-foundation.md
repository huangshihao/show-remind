# CF Refactor Plan 1: Worker Foundation + D1 Data Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a deployable Cloudflare Worker (Hono) with a D1 schema and a tested hand-written repository layer that replaces Prisma, without yet touching the old Next.js stack.

**Architecture:** A single Worker serves an API via Hono and (later) static assets. Data lives in D1 (SQLite). The repository layer is plain functions that take a `D1Database` and run parameterized SQL — no ORM. This plan builds the skeleton + data layer only; APIs, pipeline, and frontend come in Plans 2 and 3. The old `app/`, `prisma/`, `worker.ts`, and Prisma-backed `lib/` modules stay in place and keep compiling until Plan 3 deletes them.

**Tech Stack:** Cloudflare Workers, Hono, D1, `@cloudflare/vitest-pool-workers`, TypeScript, Wrangler 4.x.

## Global Constraints

- Free tier only: Workers Free + D1 Free. No paid bindings.
- `compatibility_flags` MUST include `nodejs_compat` (the ported crypto in Plan 2 needs it).
- Pure `lib/` modules (`lib/matcher`, `lib/adapters/{qq,tally,parse-link,types}`, `lib/adapters/netease`, `lib/sources`, `lib/cities.ts`) are reused unchanged in later plans — do NOT modify them here.
- Keep the `@/*` → repo-root tsconfig path alias; new code lives under `src/`.
- IDs: `crypto.randomUUID()`. Tokens: 32 random bytes hex via `crypto.getRandomValues`.
- Every table name and column name matches the spec §3 exactly.
- Commit after every task. TDD: test first, watch it fail, implement, watch it pass.

---

## File Structure

```
wrangler.jsonc              # Worker config (D1 binding, nodejs_compat, cron placeholder)
vitest.config.ts            # REPLACED: vitest-pool-workers config
src/
  env.ts                    # Env type (bindings + vars)
  index.ts                  # Hono app entry (health route only in this plan)
  db/
    schema.sql              # D1 DDL (all 6 tables)
    ids.ts                  # id + token generators
    subscriptions.ts        # subscription CRUD
    artists.ts              # artist upsert-by-normalized-name
    subscription-artists.ts # follow links
    shows.ts                # show upsert + new-id filter
    show-artists.ts         # match persistence
    notifications.ts        # notify candidates + mark sent
migrations/
  0001_init.sql             # generated migration = schema.sql contents
test/
  db/*.test.ts              # one test file per repo module
```

---

### Task 1: Install Worker toolchain and write `wrangler.jsonc`

**Files:**
- Modify: `package.json` (add deps + scripts; do NOT remove old deps yet)
- Create: `wrangler.jsonc`
- Create: `src/env.ts`
- Create: `src/index.ts`

**Interfaces:**
- Produces: `Env` type (`{ DB: D1Database } & vars`) imported by every later module; `app` default export (Hono) that later plans mount routes on.

- [ ] **Step 1: Add dependencies**

Run:
```bash
cd /Users/horace/playground/show-remind
pnpm add hono
pnpm add -D wrangler@latest @cloudflare/vitest-pool-workers @cloudflare/workers-types
```

- [ ] **Step 2: Add scripts to `package.json`**

Add these keys to the existing `"scripts"` object (leave `dev`/`build`/`start` for now — Plan 3 replaces them):
```json
"cf:dev": "wrangler dev",
"cf:deploy": "wrangler deploy",
"db:migrate:local": "wrangler d1 migrations apply show-remind --local",
"db:migrate:remote": "wrangler d1 migrations apply show-remind --remote"
```

- [ ] **Step 3: Create the D1 database**

Run:
```bash
npx wrangler d1 create show-remind
```
Expected: prints a `database_id`. Copy it for the next step.

- [ ] **Step 4: Write `wrangler.jsonc`**

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "show-remind",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "show-remind",
      "database_id": "PASTE_DATABASE_ID_FROM_STEP_3",
      "migrations_dir": "migrations"
    }
  ],
  "triggers": { "crons": ["0 2,12 * * *"] }
}
```
Note: `0 2,12 * * *` UTC = 10:00 / 20:00 Beijing. Cron handler is added in Plan 3; declaring it now is harmless.

- [ ] **Step 5: Write `src/env.ts`**

```typescript
export interface Env {
  DB: D1Database;
  // vars / secrets (populated in later plans; declared now so the type is stable)
  APP_BASE_URL: string;
  INTERNAL_SECRET: string;
  RESEND_API_KEY: string;
  MAIL_FROM: string;
  ADMIN_EMAIL: string;
  TURNSTILE_SECRET: string;
  PUBLIC_MODE: string; // "1" enables Turnstile + limits; "0" for self-host
}
```

- [ ] **Step 6: Write `src/index.ts`**

```typescript
import { Hono } from "hono";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
```

- [ ] **Step 7: Typecheck**

Run: `npx wrangler types && npx tsc --noEmit`
Expected: no errors. (`wrangler types` generates `worker-configuration.d.ts` giving `D1Database` etc.)

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml wrangler.jsonc src/env.ts src/index.ts worker-configuration.d.ts
git commit -m "feat(cf): worker skeleton with hono + d1 binding + cron placeholder"
```

---

### Task 2: D1 schema + migration + vitest-pool-workers config

**Files:**
- Create: `src/db/schema.sql`
- Create: `migrations/0001_init.sql`
- Modify: `vitest.config.ts` (replace contents)
- Create: `test/db/schema.test.ts`

**Interfaces:**
- Produces: the D1 tables that every repo test in this plan relies on. Tests get an isolated D1 via `env.DB` from `cloudflare:test`.

- [ ] **Step 1: Write `src/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  cities TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  aliases TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscription_artists (
  subscription_id TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (subscription_id, artist_id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shows (
  id TEXT PRIMARY KEY,
  showstart_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  city_code TEXT NOT NULL,
  venue TEXT,
  show_time TEXT,
  price TEXT,
  url TEXT NOT NULL,
  performers TEXT NOT NULL DEFAULT '[]',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shows_city ON shows(city_code);

CREATE TABLE IF NOT EXISTS show_artists (
  show_id TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  matched_by TEXT NOT NULL,
  PRIMARY KEY (show_id, artist_id),
  FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  subscription_id TEXT NOT NULL,
  show_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (subscription_id, show_id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE
);
```

- [ ] **Step 2: Create the migration**

Run:
```bash
npx wrangler d1 migrations create show-remind init
```
Expected: creates `migrations/0001_init.sql`. Copy the full contents of `src/db/schema.sql` into it.

- [ ] **Step 3: Replace `vitest.config.ts`**

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // apply schema to the isolated test D1 before each file
          d1Databases: { DB: "show-remind" },
        },
      },
    },
  },
});
```

- [ ] **Step 4: Write a test helper that applies the schema, and the first test**

Create `test/db/apply-schema.ts`:
```typescript
import { env } from "cloudflare:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Split schema.sql into statements and execute against the isolated test D1.
export async function applySchema(): Promise<void> {
  const sql = readFileSync(join(__dirname, "../../src/db/schema.sql"), "utf8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
}
```

Create `test/db/schema.test.ts`:
```typescript
import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "./apply-schema";

beforeEach(applySchema);

it("creates all six tables", async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all<{ name: string }>();
  const names = results.map((r) => r.name);
  expect(names).toEqual(
    expect.arrayContaining([
      "subscriptions",
      "artists",
      "subscription_artists",
      "shows",
      "show_artists",
      "notifications",
    ]),
  );
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/db/schema.test.ts`
Expected: PASS (1 test). If `cloudflare:test` types error in the editor, add `"types": ["@cloudflare/vitest-pool-workers"]` to `tsconfig.json` compilerOptions.

- [ ] **Step 6: Apply migration locally to confirm it is valid**

Run: `pnpm db:migrate:local`
Expected: "Migrations applied successfully".

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.sql migrations/0001_init.sql vitest.config.ts test/db/apply-schema.ts test/db/schema.test.ts tsconfig.json
git commit -m "feat(cf): d1 schema, migration, and vitest-pool-workers harness"
```

---

### Task 3: ID/token generators

**Files:**
- Create: `src/db/ids.ts`
- Create: `test/db/ids.test.ts`

**Interfaces:**
- Produces: `newId(): string`, `newToken(): string` — used by every repo that inserts a row.

- [ ] **Step 1: Write the failing test** — `test/db/ids.test.ts`

```typescript
import { expect, it } from "vitest";
import { newId, newToken } from "../../src/db/ids";

it("newId returns a uuid", () => {
  expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(newId()).not.toBe(newId());
});

it("newToken returns 64 hex chars and is unique", () => {
  const t = newToken();
  expect(t).toMatch(/^[0-9a-f]{64}$/);
  expect(newToken()).not.toBe(t);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/db/ids.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/db/ids.ts`**

```typescript
export function newId(): string {
  return crypto.randomUUID();
}

export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/db/ids.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/ids.ts test/db/ids.test.ts
git commit -m "feat(cf): id and token generators"
```

---

### Task 4: Subscriptions repository

**Files:**
- Create: `src/db/subscriptions.ts`
- Create: `test/db/subscriptions.test.ts`

**Interfaces:**
- Consumes: `Env["DB"]` (`D1Database`), `newId`, `newToken`.
- Produces:
  - `interface SubscriptionRow { id: string; email: string; token: string; status: "pending" | "active"; cities: string[]; }`
  - `createPendingSubscription(db, email, cities): Promise<SubscriptionRow>` — upsert by email; a re-subscribe of an existing email regenerates nothing but returns the existing row with a fresh `status='pending'` and updated cities, keeping the same token.
  - `getByToken(db, token): Promise<SubscriptionRow | null>`
  - `getByEmail(db, email): Promise<SubscriptionRow | null>`
  - `activateByToken(db, token): Promise<boolean>` — sets status='active', confirmed_at=now; returns whether a row matched.
  - `setCities(db, subscriptionId, cities): Promise<void>`
  - `deleteByToken(db, token): Promise<boolean>` — cascades to links/notifications.

- [ ] **Step 1: Write the failing test** — `test/db/subscriptions.test.ts`

```typescript
import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "./apply-schema";
import {
  createPendingSubscription,
  getByToken,
  getByEmail,
  activateByToken,
  setCities,
  deleteByToken,
} from "../../src/db/subscriptions";

beforeEach(applySchema);
const db = () => env.DB;

it("creates a pending subscription and reads it back", async () => {
  const sub = await createPendingSubscription(db(), "a@b.com", ["110000"]);
  expect(sub.status).toBe("pending");
  expect(sub.cities).toEqual(["110000"]);
  expect(sub.token).toMatch(/^[0-9a-f]{64}$/);
  expect((await getByEmail(db(), "a@b.com"))?.id).toBe(sub.id);
  expect((await getByToken(db(), sub.token))?.id).toBe(sub.id);
});

it("re-subscribe with same email keeps token, updates cities, resets to pending", async () => {
  const first = await createPendingSubscription(db(), "a@b.com", ["110000"]);
  await activateByToken(db(), first.token);
  const again = await createPendingSubscription(db(), "a@b.com", ["310000"]);
  expect(again.id).toBe(first.id);
  expect(again.token).toBe(first.token);
  expect(again.cities).toEqual(["310000"]);
  expect(again.status).toBe("pending");
});

it("activateByToken flips status and reports match", async () => {
  const sub = await createPendingSubscription(db(), "a@b.com", ["110000"]);
  expect(await activateByToken(db(), sub.token)).toBe(true);
  expect((await getByToken(db(), sub.token))?.status).toBe("active");
  expect(await activateByToken(db(), "nope")).toBe(false);
});

it("setCities updates the json array", async () => {
  const sub = await createPendingSubscription(db(), "a@b.com", ["110000"]);
  await setCities(db(), sub.id, ["110000", "310000"]);
  expect((await getByToken(db(), sub.token))?.cities).toEqual(["110000", "310000"]);
});

it("deleteByToken removes the row", async () => {
  const sub = await createPendingSubscription(db(), "a@b.com", ["110000"]);
  expect(await deleteByToken(db(), sub.token)).toBe(true);
  expect(await getByToken(db(), sub.token)).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/db/subscriptions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/db/subscriptions.ts`**

```typescript
import { newId, newToken } from "./ids";

export interface SubscriptionRow {
  id: string;
  email: string;
  token: string;
  status: "pending" | "active";
  cities: string[];
}

interface RawRow {
  id: string;
  email: string;
  token: string;
  status: string;
  cities: string;
}

function toRow(r: RawRow): SubscriptionRow {
  return {
    id: r.id,
    email: r.email,
    token: r.token,
    status: r.status === "active" ? "active" : "pending",
    cities: JSON.parse(r.cities) as string[],
  };
}

export async function getByEmail(db: D1Database, email: string): Promise<SubscriptionRow | null> {
  const r = await db.prepare("SELECT * FROM subscriptions WHERE email = ?").bind(email).first<RawRow>();
  return r ? toRow(r) : null;
}

export async function getByToken(db: D1Database, token: string): Promise<SubscriptionRow | null> {
  const r = await db.prepare("SELECT * FROM subscriptions WHERE token = ?").bind(token).first<RawRow>();
  return r ? toRow(r) : null;
}

export async function createPendingSubscription(
  db: D1Database,
  email: string,
  cities: string[],
): Promise<SubscriptionRow> {
  const existing = await getByEmail(db, email);
  const citiesJson = JSON.stringify(cities);
  if (existing) {
    await db
      .prepare("UPDATE subscriptions SET status='pending', cities=? WHERE id=?")
      .bind(citiesJson, existing.id)
      .run();
    return { ...existing, status: "pending", cities };
  }
  const id = newId();
  const token = newToken();
  await db
    .prepare("INSERT INTO subscriptions (id, email, token, status, cities) VALUES (?, ?, ?, 'pending', ?)")
    .bind(id, email, token, citiesJson)
    .run();
  return { id, email, token, status: "pending", cities };
}

export async function activateByToken(db: D1Database, token: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE subscriptions SET status='active', confirmed_at=datetime('now') WHERE token=?")
    .bind(token)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function setCities(db: D1Database, subscriptionId: string, cities: string[]): Promise<void> {
  await db
    .prepare("UPDATE subscriptions SET cities=? WHERE id=?")
    .bind(JSON.stringify(cities), subscriptionId)
    .run();
}

export async function deleteByToken(db: D1Database, token: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM subscriptions WHERE token=?").bind(token).run();
  return (res.meta.changes ?? 0) > 0;
}
```

- [ ] **Step 4: Enable FK cascades in the test harness**

D1 needs `PRAGMA foreign_keys=ON` per connection. Add to `test/db/apply-schema.ts` at the end of `applySchema`:
```typescript
  await env.DB.prepare("PRAGMA foreign_keys = ON").run();
```
And in production, run the same pragma at the start of each pipeline/route DB use (noted in Plan 2). For this task the pragma in the harness is enough.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/db/subscriptions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/subscriptions.ts test/db/subscriptions.test.ts test/db/apply-schema.ts
git commit -m "feat(cf): subscriptions repository"
```

---

### Task 5: Artists repository (upsert by normalized name)

**Files:**
- Create: `src/db/artists.ts`
- Create: `test/db/artists.test.ts`

**Interfaces:**
- Consumes: `normalizeName` from `@/lib/matcher/normalize` (existing pure module), `newId`.
- Produces:
  - `interface ArtistRow { id: string; name: string; normalizedName: string; aliases: string[] }`
  - `upsertArtist(db, name): Promise<ArtistRow>` — normalizes name; inserts if new, else returns existing (idempotent by normalized_name).
  - `getAllArtists(db): Promise<ArtistRow[]>` — for the matcher in Plan 3.

- [ ] **Step 1: Write the failing test** — `test/db/artists.test.ts`

```typescript
import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "./apply-schema";
import { upsertArtist, getAllArtists } from "../../src/db/artists";

beforeEach(applySchema);
const db = () => env.DB;

it("inserts a new artist and is idempotent on normalized name", async () => {
  const a = await upsertArtist(db(), "海龟先生");
  const b = await upsertArtist(db(), "海龟先生");
  expect(b.id).toBe(a.id);
  expect((await getAllArtists(db())).length).toBe(1);
});

it("treats case/whitespace variants as the same artist", async () => {
  // normalizeName lowercases + collapses whitespace (it does NOT strip
  // hyphens), so these two spellings normalize to the same key.
  const a = await upsertArtist(db(), "Re TROS");
  const b = await upsertArtist(db(), "re   tros");
  expect(b.id).toBe(a.id);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/db/artists.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/db/artists.ts`**

```typescript
import { normalizeName } from "@/lib/matcher/normalize";
import { newId } from "./ids";

export interface ArtistRow {
  id: string;
  name: string;
  normalizedName: string;
  aliases: string[];
}

interface RawRow {
  id: string;
  name: string;
  normalized_name: string;
  aliases: string;
}

function toRow(r: RawRow): ArtistRow {
  return { id: r.id, name: r.name, normalizedName: r.normalized_name, aliases: JSON.parse(r.aliases) };
}

export async function upsertArtist(db: D1Database, name: string): Promise<ArtistRow> {
  const normalized = normalizeName(name);
  const existing = await db
    .prepare("SELECT * FROM artists WHERE normalized_name = ?")
    .bind(normalized)
    .first<RawRow>();
  if (existing) return toRow(existing);
  const id = newId();
  await db
    .prepare("INSERT INTO artists (id, name, normalized_name, aliases) VALUES (?, ?, ?, '[]')")
    .bind(id, name, normalized)
    .run();
  return { id, name, normalizedName: normalized, aliases: [] };
}

export async function getAllArtists(db: D1Database): Promise<ArtistRow[]> {
  const { results } = await db.prepare("SELECT * FROM artists").all<RawRow>();
  return results.map(toRow);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/db/artists.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/artists.ts test/db/artists.test.ts
git commit -m "feat(cf): artists repository with normalized-name upsert"
```

---

### Task 6: Subscription-artists link repository

**Files:**
- Create: `src/db/subscription-artists.ts`
- Create: `test/db/subscription-artists.test.ts`

**Interfaces:**
- Consumes: `D1Database`, `upsertArtist`, `createPendingSubscription`.
- Produces:
  - `addArtistToSubscription(db, subscriptionId, artistName): Promise<string>` — upserts artist, links, returns artistId; idempotent link.
  - `removeArtist(db, subscriptionId, artistId): Promise<void>`
  - `setArtists(db, subscriptionId, artistNames): Promise<void>` — replaces the whole set (used at subscribe time).
  - `listArtists(db, subscriptionId): Promise<ArtistRow[]>`
  - `countArtists(db, subscriptionId): Promise<number>` — for the 100-artist limit in Plan 2.

- [ ] **Step 1: Write the failing test** — `test/db/subscription-artists.test.ts`

```typescript
import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "./apply-schema";
import { createPendingSubscription } from "../../src/db/subscriptions";
import {
  setArtists,
  addArtistToSubscription,
  removeArtist,
  listArtists,
  countArtists,
} from "../../src/db/subscription-artists";

beforeEach(applySchema);
const db = () => env.DB;

async function sub() {
  return createPendingSubscription(db(), "a@b.com", ["110000"]);
}

it("setArtists replaces the follow set", async () => {
  const s = await sub();
  await setArtists(db(), s.id, ["海龟先生", "刺猬"]);
  expect((await listArtists(db(), s.id)).map((a) => a.name).sort()).toEqual(["刺猬", "海龟先生"]);
  await setArtists(db(), s.id, ["达达"]);
  expect((await listArtists(db(), s.id)).map((a) => a.name)).toEqual(["达达"]);
});

it("add is idempotent and remove works; count reflects state", async () => {
  const s = await sub();
  const id1 = await addArtistToSubscription(db(), s.id, "刺猬");
  const id2 = await addArtistToSubscription(db(), s.id, "刺猬");
  expect(id1).toBe(id2);
  expect(await countArtists(db(), s.id)).toBe(1);
  await removeArtist(db(), s.id, id1);
  expect(await countArtists(db(), s.id)).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/db/subscription-artists.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/db/subscription-artists.ts`**

```typescript
import { upsertArtist, type ArtistRow } from "./artists";

export async function addArtistToSubscription(
  db: D1Database,
  subscriptionId: string,
  artistName: string,
): Promise<string> {
  const artist = await upsertArtist(db, artistName);
  await db
    .prepare(
      "INSERT OR IGNORE INTO subscription_artists (subscription_id, artist_id) VALUES (?, ?)",
    )
    .bind(subscriptionId, artist.id)
    .run();
  return artist.id;
}

export async function removeArtist(
  db: D1Database,
  subscriptionId: string,
  artistId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM subscription_artists WHERE subscription_id=? AND artist_id=?")
    .bind(subscriptionId, artistId)
    .run();
}

export async function setArtists(
  db: D1Database,
  subscriptionId: string,
  artistNames: string[],
): Promise<void> {
  await db.prepare("DELETE FROM subscription_artists WHERE subscription_id=?").bind(subscriptionId).run();
  for (const name of artistNames) {
    await addArtistToSubscription(db, subscriptionId, name);
  }
}

export async function listArtists(db: D1Database, subscriptionId: string): Promise<ArtistRow[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.name, a.normalized_name, a.aliases
       FROM artists a JOIN subscription_artists sa ON sa.artist_id = a.id
       WHERE sa.subscription_id = ? ORDER BY a.name`,
    )
    .bind(subscriptionId)
    .all<{ id: string; name: string; normalized_name: string; aliases: string }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    normalizedName: r.normalized_name,
    aliases: JSON.parse(r.aliases),
  }));
}

export async function countArtists(db: D1Database, subscriptionId: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM subscription_artists WHERE subscription_id=?")
    .bind(subscriptionId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/db/subscription-artists.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/subscription-artists.ts test/db/subscription-artists.test.ts
git commit -m "feat(cf): subscription-artists link repository"
```

---

### Task 7: Shows + show-artists repositories

**Files:**
- Create: `src/db/shows.ts`
- Create: `src/db/show-artists.ts`
- Create: `test/db/shows.test.ts`

**Interfaces:**
- Consumes: `D1Database`; `ShowDetail` shape from `@/lib/sources/showstart` (fields: `showstartId, title, cityCode, venue, showTime, price, url, performers`). `showTime` is an ISO string or null.
- Produces:
  - `interface ShowRow { id: string; showstartId: string; title: string; cityCode: string; venue: string | null; showTime: string | null; price: string | null; url: string; performers: string[] }`
  - `filterNewShowstartIds(db, ids): Promise<string[]>` — returns the subset of `ids` NOT already in `shows`.
  - `upsertShow(db, detail): Promise<ShowRow>` — insert-or-replace by `showstart_id`, preserving `id` if it already exists.
  - `getShowsByIds(db, ids): Promise<ShowRow[]>`
  - `persistMatches(db, matches): Promise<number>` (in show-artists.ts) — `matches: { showId, artistId, matchedBy }[]`, INSERT OR IGNORE, returns rows inserted.

- [ ] **Step 1: Write the failing test** — `test/db/shows.test.ts`

```typescript
import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "./apply-schema";
import { filterNewShowstartIds, upsertShow, getShowsByIds } from "../../src/db/shows";
import { persistMatches } from "../../src/db/show-artists";
import { upsertArtist } from "../../src/db/artists";

beforeEach(applySchema);
const db = () => env.DB;

const detail = (showstartId: string) => ({
  showstartId,
  title: `Show ${showstartId}`,
  cityCode: "110000",
  venue: "MAO",
  showTime: "2026-08-01T20:00:00",
  price: "180",
  url: `https://wap.showstart.com/x/${showstartId}`,
  performers: ["刺猬"],
});

it("upsertShow inserts once and keeps id on re-upsert", async () => {
  const a = await upsertShow(db(), detail("100"));
  const b = await upsertShow(db(), { ...detail("100"), price: "200" });
  expect(b.id).toBe(a.id);
  expect(b.price).toBe("200");
});

it("filterNewShowstartIds returns only unseen ids", async () => {
  await upsertShow(db(), detail("100"));
  expect(await filterNewShowstartIds(db(), ["100", "101", "102"])).toEqual(["101", "102"]);
});

it("persistMatches links shows to artists idempotently", async () => {
  const show = await upsertShow(db(), detail("100"));
  const artist = await upsertArtist(db(), "刺猬");
  const n1 = await persistMatches(db(), [{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);
  const n2 = await persistMatches(db(), [{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);
  expect(n1).toBe(1);
  expect(n2).toBe(0);
});

it("getShowsByIds returns parsed rows", async () => {
  const s = await upsertShow(db(), detail("100"));
  const [row] = await getShowsByIds(db(), [s.id]);
  expect(row.performers).toEqual(["刺猬"]);
  expect(row.title).toBe("Show 100");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/db/shows.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/db/shows.ts`**

```typescript
import { newId } from "./ids";

export interface ShowInput {
  showstartId: string;
  title: string;
  cityCode: string;
  venue: string | null;
  showTime: string | null;
  price: string | null;
  url: string;
  performers: string[];
}

export interface ShowRow extends ShowInput {
  id: string;
}

interface RawRow {
  id: string;
  showstart_id: string;
  title: string;
  city_code: string;
  venue: string | null;
  show_time: string | null;
  price: string | null;
  url: string;
  performers: string;
}

function toRow(r: RawRow): ShowRow {
  return {
    id: r.id,
    showstartId: r.showstart_id,
    title: r.title,
    cityCode: r.city_code,
    venue: r.venue,
    showTime: r.show_time,
    price: r.price,
    url: r.url,
    performers: JSON.parse(r.performers),
  };
}

export async function filterNewShowstartIds(db: D1Database, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT showstart_id FROM shows WHERE showstart_id IN (${placeholders})`)
    .bind(...ids)
    .all<{ showstart_id: string }>();
  const seen = new Set(results.map((r) => r.showstart_id));
  return ids.filter((id) => !seen.has(id));
}

export async function upsertShow(db: D1Database, s: ShowInput): Promise<ShowRow> {
  const existing = await db
    .prepare("SELECT id FROM shows WHERE showstart_id = ?")
    .bind(s.showstartId)
    .first<{ id: string }>();
  const id = existing?.id ?? newId();
  await db
    .prepare(
      `INSERT INTO shows (id, showstart_id, title, city_code, venue, show_time, price, url, performers)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(showstart_id) DO UPDATE SET
         title=excluded.title, city_code=excluded.city_code, venue=excluded.venue,
         show_time=excluded.show_time, price=excluded.price, url=excluded.url,
         performers=excluded.performers`,
    )
    .bind(
      id,
      s.showstartId,
      s.title,
      s.cityCode,
      s.venue,
      s.showTime,
      s.price,
      s.url,
      JSON.stringify(s.performers),
    )
    .run();
  return { ...s, id };
}

export async function getShowsByIds(db: D1Database, ids: string[]): Promise<ShowRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM shows WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<RawRow>();
  return results.map(toRow);
}
```

- [ ] **Step 4: Implement `src/db/show-artists.ts`**

```typescript
export interface MatchInput {
  showId: string;
  artistId: string;
  matchedBy: "performer" | "title";
}

export async function persistMatches(db: D1Database, matches: MatchInput[]): Promise<number> {
  let inserted = 0;
  for (const m of matches) {
    const res = await db
      .prepare("INSERT OR IGNORE INTO show_artists (show_id, artist_id, matched_by) VALUES (?, ?, ?)")
      .bind(m.showId, m.artistId, m.matchedBy)
      .run();
    inserted += res.meta.changes ?? 0;
  }
  return inserted;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/db/shows.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/shows.ts src/db/show-artists.ts test/db/shows.test.ts
git commit -m "feat(cf): shows and show-artists repositories"
```

---

### Task 8: Notifications repository (candidates + mark sent)

**Files:**
- Create: `src/db/notifications.ts`
- Create: `test/db/notifications.test.ts`

**Interfaces:**
- Consumes: `D1Database`.
- Produces:
  - `interface NotifyShow { showId, title, cityCode, venue, showTime, price, url, artistNames: string[], hasTitleOnlyMatch: boolean }`
  - `interface Candidate { subscriptionId: string; email: string; token: string; shows: NotifyShow[] }`
  - `findNotifyCandidates(db): Promise<Candidate[]>` — active subs whose followed artists have shows in the sub's cities with NO existing notification row.
  - `markSent(db, subscriptionId, showIds): Promise<void>` — inserts sent notification rows (INSERT OR IGNORE).
  - `deleteStalePending(db, hours): Promise<number>` — deletes pending subs older than N hours (used by Plan 3 cron cleanup).

- [ ] **Step 1: Write the failing test** — `test/db/notifications.test.ts`

```typescript
import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "./apply-schema";
import { createPendingSubscription, activateByToken } from "../../src/db/subscriptions";
import { addArtistToSubscription } from "../../src/db/subscription-artists";
import { upsertShow } from "../../src/db/shows";
import { persistMatches } from "../../src/db/show-artists";
import { findNotifyCandidates, markSent } from "../../src/db/notifications";

beforeEach(applySchema);
const db = () => env.DB;

async function setup() {
  const sub = await createPendingSubscription(db(), "a@b.com", ["110000"]);
  await activateByToken(db(), sub.token);
  const artistId = await addArtistToSubscription(db(), sub.id, "刺猬");
  const show = await upsertShow(db(), {
    showstartId: "100", title: "刺猬专场", cityCode: "110000", venue: "MAO",
    showTime: "2026-08-01T20:00:00", price: "180", url: "https://x/100", performers: ["刺猬"],
  });
  await persistMatches(db(), [{ showId: show.id, artistId, matchedBy: "performer" }]);
  return { sub, show };
}

it("finds a candidate for an active sub with a matched show in its city", async () => {
  const { show } = await setup();
  const cands = await findNotifyCandidates(db());
  expect(cands.length).toBe(1);
  expect(cands[0].shows.map((s) => s.showId)).toEqual([show.id]);
  expect(cands[0].shows[0].artistNames).toEqual(["刺猬"]);
  expect(cands[0].shows[0].hasTitleOnlyMatch).toBe(false);
});

it("excludes shows outside the sub's cities", async () => {
  const { sub } = await setup();
  await env.DB.prepare("UPDATE subscriptions SET cities='[\"310000\"]' WHERE id=?").bind(sub.id).run();
  expect((await findNotifyCandidates(db())).length).toBe(0);
});

it("markSent prevents the same show from being a candidate again", async () => {
  const { sub, show } = await setup();
  await markSent(db(), sub.id, [show.id]);
  expect((await findNotifyCandidates(db())).length).toBe(0);
});

it("ignores pending (unconfirmed) subscriptions", async () => {
  const sub = await createPendingSubscription(db(), "p@b.com", ["110000"]);
  const artistId = await addArtistToSubscription(db(), sub.id, "刺猬");
  const show = await upsertShow(db(), {
    showstartId: "200", title: "x", cityCode: "110000", venue: null,
    showTime: null, price: null, url: "https://x/200", performers: ["刺猬"],
  });
  await persistMatches(db(), [{ showId: show.id, artistId, matchedBy: "performer" }]);
  expect((await findNotifyCandidates(db())).length).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/db/notifications.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/db/notifications.ts`**

```typescript
export interface NotifyShow {
  showId: string;
  title: string;
  cityCode: string;
  venue: string | null;
  showTime: string | null;
  price: string | null;
  url: string;
  artistNames: string[];
  hasTitleOnlyMatch: boolean;
}

export interface Candidate {
  subscriptionId: string;
  email: string;
  token: string;
  shows: NotifyShow[];
}

interface JoinRow {
  subscription_id: string;
  email: string;
  token: string;
  cities: string;
  show_id: string;
  title: string;
  city_code: string;
  venue: string | null;
  show_time: string | null;
  price: string | null;
  url: string;
  artist_name: string;
  matched_by: string;
}

export async function findNotifyCandidates(db: D1Database): Promise<Candidate[]> {
  // Join active subs → their followed artists → matching shows → not yet notified.
  // City filtering is done in JS because cities is a JSON array column.
  const { results } = await db
    .prepare(
      `SELECT s.id AS subscription_id, s.email, s.token, s.cities,
              sh.id AS show_id, sh.title, sh.city_code, sh.venue, sh.show_time, sh.price, sh.url,
              a.name AS artist_name, xsa.matched_by
       FROM subscriptions s
       JOIN subscription_artists sa ON sa.subscription_id = s.id
       JOIN show_artists xsa ON xsa.artist_id = sa.artist_id
       JOIN shows sh ON sh.id = xsa.show_id
       JOIN artists a ON a.id = sa.artist_id
       WHERE s.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.subscription_id = s.id AND n.show_id = sh.id
         )`,
    )
    .all<JoinRow>();

  // Group by subscription, then by show.
  const bySub = new Map<string, Candidate>();
  for (const r of results) {
    const cities = JSON.parse(r.cities) as string[];
    if (!cities.includes(r.city_code)) continue;
    let cand = bySub.get(r.subscription_id);
    if (!cand) {
      cand = { subscriptionId: r.subscription_id, email: r.email, token: r.token, shows: [] };
      bySub.set(r.subscription_id, cand);
    }
    let show = cand.shows.find((x) => x.showId === r.show_id);
    if (!show) {
      show = {
        showId: r.show_id,
        title: r.title,
        cityCode: r.city_code,
        venue: r.venue,
        showTime: r.show_time,
        price: r.price,
        url: r.url,
        artistNames: [],
        hasTitleOnlyMatch: true,
      };
      cand.shows.push(show);
    }
    if (!show.artistNames.includes(r.artist_name)) show.artistNames.push(r.artist_name);
    if (r.matched_by !== "title") show.hasTitleOnlyMatch = false;
  }
  return [...bySub.values()].filter((c) => c.shows.length > 0);
}

export async function markSent(db: D1Database, subscriptionId: string, showIds: string[]): Promise<void> {
  for (const showId of showIds) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO notifications (subscription_id, show_id, status, sent_at) VALUES (?, ?, 'sent', datetime('now'))",
      )
      .bind(subscriptionId, showId)
      .run();
  }
}

export async function deleteStalePending(db: D1Database, hours: number): Promise<number> {
  const res = await db
    .prepare(
      `DELETE FROM subscriptions WHERE status='pending' AND created_at < datetime('now', ?)`,
    )
    .bind(`-${hours} hours`)
    .run();
  return res.meta.changes ?? 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/db/notifications.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: all new `test/db/*` pass; the pre-existing `lib/**` Prisma tests may fail to run under the workers pool — that's acceptable at this stage and is resolved in Plan 2 (which removes Prisma). If they block the run, add `exclude` for `lib/**/*.test.ts` in `vitest.config.ts` temporarily and note it in the commit; Plan 2 re-includes the pure ones.

- [ ] **Step 6: Commit**

```bash
git add src/db/notifications.ts test/db/notifications.test.ts vitest.config.ts
git commit -m "feat(cf): notifications repository (candidates + mark sent + stale cleanup)"
```

---

### Task 9: Deploy the skeleton to confirm the pipeline end-to-end

**Files:** none (deployment verification)

- [ ] **Step 1: Apply the migration to remote D1**

Run: `pnpm db:migrate:remote`
Expected: "Migrations applied successfully" against the real D1.

- [ ] **Step 2: Deploy**

Run: `npx wrangler deploy`
Expected: prints `https://show-remind.<subdomain>.workers.dev`.

- [ ] **Step 3: Hit the health route**

Run: `curl -s https://show-remind.<subdomain>.workers.dev/api/health`
Expected: `{"ok":true}`.

- [ ] **Step 4: Verify tables exist remotely**

Run: `npx wrangler d1 execute show-remind --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`
Expected: lists the six tables.

- [ ] **Step 5: Commit any config touch-ups**

```bash
git add -A
git commit -m "chore(cf): confirm skeleton deploys and migrates on free tier" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage (this plan):** §2 Worker+D1 skeleton ✓ (Tasks 1-2, 9); §3 data model — all six tables + drop-list handled by building fresh ✓ (Task 2); repository layer replacing Prisma ✓ (Tasks 4-8); free-tier constraints (nodejs_compat, cron placeholder, D1) ✓ (Task 1). Deferred to later plans by design: resolve/subscribe/confirm/manage APIs (§4, Plan 2), mail provider (§2/§4, Plan 2), lib port + netease plaintext (§6, Plan 2), frontend (§4, Plan 3), cron pipeline + admin alert (§4.3/§6, Plan 3), old-stack deletion + open-source scaffolding (§9, Plan 3).
- **FK cascade:** relies on `PRAGMA foreign_keys=ON` per connection (Task 4 Step 4); production callers must issue it — carried into Plan 2/3 route + pipeline setup.
- **Type consistency:** `ShowInput` fields match `@/lib/sources/showstart` `ShowDetail` exactly (`showTime` is an ISO string here; Plan 3 pipeline maps the source's `showTime: string | null` straight through). `NotifyShow` mirrors the old `lib/notifier/candidates.ts` shape but keyed by `subscriptionId`/`token` instead of `userId`.
