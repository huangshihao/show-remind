# Show-Remind Plan 3: Persistence, Worker Pipeline & Web App

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Plan 2 engine into the full product — persist artists/shows/matches, run the crawl→match→notify pipeline on a schedule, send aggregated emails, and ship the web flow (register → paste playlist → pick artists → pick cities → see upcoming shows).

**Architecture:** Repositories wrap Prisma. `lib/pipeline.ts` orchestrates crawl→match→notify and is called both by the `worker.ts` cron process and inline after a user confirms follows (immediate match). Auth.js (credentials + email verification) guards the web pages. nodemailer sends via MailHog in dev.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Prisma, Auth.js v5, bcryptjs, nodemailer, node-cron, Vitest.

**Prerequisite:** Plans 1 and 2 complete (schema + scraper + lib engine, all tests green).

## Global Constraints

- Repositories are the only modules that import `@/lib/db`. Pages/actions call repositories, never Prisma directly.
- `normalizeName` from `@/lib/matcher/normalize` is the sole normalizer for artist persistence.
- Notification dedup relies on the `(userId, showId)` unique constraint — never bypass it.
- Email is sent per-user aggregated (one email lists all newly-matched shows in that pipeline run).
- Env additions: `APP_URL` (e.g. `http://localhost:3000`), plus `SMTP_*`, `ADMIN_ALERT_EMAIL`, `AUTH_SECRET`.
- Conventional Commits. Node 20+.

---

## Task 1: Env, auth schema addition, and repositories (artists, shows, matches)

**Files:**
- Modify: `prisma/schema.prisma` (add `VerificationToken`)
- Modify: `.env.example`
- Create: `lib/repositories/artists.ts`, `lib/repositories/shows.ts`, `lib/repositories/matches.ts`
- Test: `lib/repositories/repositories.test.ts`

**Interfaces:**
- Produces:
  - `upsertArtist(name: string): Promise<{ id: string; name: string; normalizedName: string; aliases: string[] }>`
  - `filterNewShowstartIds(ids: string[]): Promise<string[]>`
  - `upsertShow(d: ShowDetail): Promise<{ id: string; showstartId: string }>` (ShowDetail from `@/lib/scraper-client`)
  - `persistMatches(matches: Match[]): Promise<number>` (Match from `@/lib/matcher`; returns count of newly-created rows)

- [ ] **Step 1: Add `VerificationToken` to `prisma/schema.prisma` and migrate**

Append model:
```prisma
model VerificationToken {
  token   String   @id
  userId  String   @map("user_id")
  expires DateTime
  @@map("verification_tokens")
}
```
Run: `pnpm prisma migrate dev --name add_verification_token`
Expected: migration applied, client regenerated.

- [ ] **Step 2: Add env vars to `.env.example`**

Append:
```
APP_URL="http://localhost:3000"
AUTH_SECRET="dev-only-change-me"
```
(Then run `cp -n .env.example .env` or manually add these to `.env`.)

- [ ] **Step 3: Write failing tests**

`lib/repositories/repositories.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { upsertArtist } from "./artists";
import { filterNewShowstartIds, upsertShow } from "./shows";
import { persistMatches } from "./matches";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe("artists repo", () => {
  it("dedupes by normalized name", async () => {
    const n = `万能青年旅店_${uid()}`;
    const a = await upsertArtist(`  ${n}  `);
    const b = await upsertArtist(n);
    expect(b.id).toBe(a.id);
    expect(a.normalizedName).toBe(n.toLowerCase());
  });
});

describe("shows repo", () => {
  it("filters out showstartIds already stored", async () => {
    const sid = `S_${uid()}`;
    await upsertShow({
      showstartId: sid, title: "T", cityCode: "310000", venue: null,
      showTime: "2026-08-01T20:00:00", price: "100", url: "http://x", performers: ["万能青年旅店"],
    });
    const missing = `S_${uid()}`;
    const result = await filterNewShowstartIds([sid, missing]);
    expect(result).toEqual([missing]);
  });

  it("upsert is idempotent on showstartId", async () => {
    const sid = `S_${uid()}`;
    const base = { showstartId: sid, title: "T", cityCode: "310000", venue: null,
      showTime: null, price: null, url: "http://x", performers: [] };
    const a = await upsertShow(base);
    const b = await upsertShow({ ...base, title: "T2" });
    expect(b.id).toBe(a.id);
  });
});

describe("matches repo", () => {
  it("persists show_artists and is dedup-safe", async () => {
    const artist = await upsertArtist(`A_${uid()}`);
    const show = await upsertShow({
      showstartId: `S_${uid()}`, title: "T", cityCode: "310000", venue: null,
      showTime: null, price: null, url: "http://x", performers: [],
    });
    const m = [{ showId: show.id, artistId: artist.id, matchedBy: "performer" as const }];
    const created = await persistMatches(m);
    expect(created).toBe(1);
    const again = await persistMatches(m);
    expect(again).toBe(0);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm test lib/repositories/repositories.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 5: Write the repositories**

`lib/repositories/artists.ts`:
```ts
import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/matcher/normalize";

export async function upsertArtist(name: string) {
  const normalizedName = normalizeName(name);
  const artist = await prisma.artist.upsert({
    where: { normalizedName },
    create: { name: name.trim(), normalizedName, aliases: [] },
    update: {},
  });
  return {
    id: artist.id,
    name: artist.name,
    normalizedName: artist.normalizedName,
    aliases: (artist.aliases as string[]) ?? [],
  };
}
```

`lib/repositories/shows.ts`:
```ts
import { prisma } from "@/lib/db";
import type { ShowDetail } from "@/lib/scraper-client";

export async function filterNewShowstartIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const existing = await prisma.show.findMany({
    where: { showstartId: { in: ids } },
    select: { showstartId: true },
  });
  const have = new Set(existing.map((s) => s.showstartId));
  return ids.filter((id) => !have.has(id));
}

export async function upsertShow(d: ShowDetail): Promise<{ id: string; showstartId: string }> {
  const show = await prisma.show.upsert({
    where: { showstartId: d.showstartId },
    create: {
      showstartId: d.showstartId,
      title: d.title,
      cityCode: d.cityCode,
      venue: d.venue,
      showTime: d.showTime ? new Date(d.showTime) : null,
      price: d.price,
      url: d.url,
      performers: d.performers,
    },
    update: {},
    select: { id: true, showstartId: true },
  });
  return show;
}
```

`lib/repositories/matches.ts`:
```ts
import { prisma } from "@/lib/db";
import type { Match } from "@/lib/matcher";

export async function persistMatches(matches: Match[]): Promise<number> {
  if (matches.length === 0) return 0;
  const result = await prisma.showArtist.createMany({
    data: matches.map((m) => ({ showId: m.showId, artistId: m.artistId, matchedBy: m.matchedBy })),
    skipDuplicates: true,
  });
  return result.count;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test lib/repositories/repositories.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(repo): artists, shows, matches repositories + verification token"
```

---

## Task 2: User-artists & follow confirmation repository

**Files:**
- Create: `lib/repositories/user-artists.ts`
- Test: `lib/repositories/user-artists.test.ts`

**Interfaces:**
- Produces:
  - `confirmFollows(userId, sourcePlaylistId, params: { follow: string[]; ignore: string[] }): Promise<void>` — upserts artists by name, writes `user_artists` with status `followed`/`ignored`.
  - `addManualArtist(userId, name): Promise<void>` — followed, no source playlist.
  - `getFollowedArtists(userId): Promise<MatchArtist[]>`
  - `getAllFollowedArtists(): Promise<MatchArtist[]>` — distinct artists followed by ≥1 user (for global matching).

- [ ] **Step 1: Write failing tests**

`lib/repositories/user-artists.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { confirmFollows, addManualArtist, getFollowedArtists } from "./user-artists";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
async function makeUser() {
  return prisma.user.create({ data: { email: `u_${uid()}@e.com`, passwordHash: "x" } });
}

describe("user-artists repo", () => {
  it("records followed and ignored", async () => {
    const user = await makeUser();
    const n1 = `Band_${uid()}`;
    const n2 = `Skip_${uid()}`;
    await confirmFollows(user.id, null, { follow: [n1], ignore: [n2] });
    const followed = await getFollowedArtists(user.id);
    expect(followed.map((a) => a.name)).toContain(n1);
    expect(followed.map((a) => a.name)).not.toContain(n2);
  });

  it("addManualArtist adds a followed artist", async () => {
    const user = await makeUser();
    const n = `Manual_${uid()}`;
    await addManualArtist(user.id, n);
    const followed = await getFollowedArtists(user.id);
    expect(followed.map((a) => a.name)).toContain(n);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test lib/repositories/user-artists.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/repositories/user-artists.ts`**

```ts
import { prisma } from "@/lib/db";
import { upsertArtist } from "./artists";
import type { MatchArtist } from "@/lib/matcher";

async function setStatus(
  userId: string,
  sourcePlaylistId: string | null,
  name: string,
  status: "followed" | "ignored",
) {
  const artist = await upsertArtist(name);
  await prisma.userArtist.upsert({
    where: { userId_artistId: { userId, artistId: artist.id } },
    create: { userId, artistId: artist.id, sourcePlaylistId, status },
    update: { status, sourcePlaylistId },
  });
}

export async function confirmFollows(
  userId: string,
  sourcePlaylistId: string | null,
  params: { follow: string[]; ignore: string[] },
): Promise<void> {
  for (const name of params.follow) await setStatus(userId, sourcePlaylistId, name, "followed");
  for (const name of params.ignore) await setStatus(userId, sourcePlaylistId, name, "ignored");
}

export async function addManualArtist(userId: string, name: string): Promise<void> {
  await setStatus(userId, null, name, "followed");
}

function toMatchArtist(a: {
  id: string; name: string; normalizedName: string; aliases: unknown;
}): MatchArtist {
  return { id: a.id, name: a.name, normalizedName: a.normalizedName, aliases: (a.aliases as string[]) ?? [] };
}

export async function getFollowedArtists(userId: string): Promise<MatchArtist[]> {
  const rows = await prisma.userArtist.findMany({
    where: { userId, status: "followed" },
    include: { artist: true },
  });
  return rows.map((r) => toMatchArtist(r.artist));
}

export async function getAllFollowedArtists(): Promise<MatchArtist[]> {
  const artists = await prisma.artist.findMany({
    where: { userArtists: { some: { status: "followed" } } },
  });
  return artists.map(toMatchArtist);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test lib/repositories/user-artists.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(repo): user-artists follow/ignore repository"
```

---

## Task 3: Showstart crawler

**Files:**
- Create: `lib/crawler/showstart.ts`
- Test: `lib/crawler/showstart.test.ts`

**Interfaces:**
- Consumes: `scraperClient` (Plan 2), `filterNewShowstartIds`, `upsertShow` (Task 1).
- Produces: `crawlCities(cityCodes: string[]): Promise<{ newShowIds: string[]; failedCities: string[] }>`. For each city: list shows → keep new showstartIds → fetch detail → upsert. Per-request delay via injectable `sleep`. A single city's failure is caught and reported, not fatal.

- [ ] **Step 1: Write failing tests**

`lib/crawler/showstart.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import * as client from "@/lib/scraper-client";
import * as showsRepo from "@/lib/repositories/shows";
import { crawlCities } from "./showstart";

afterEach(() => vi.restoreAllMocks());

describe("crawlCities", () => {
  it("fetches details only for new shows and upserts them", async () => {
    vi.spyOn(client.scraperClient, "cityShows").mockResolvedValue({
      shows: [
        { showstartId: "1", title: "A", cityCode: "310000", showTime: null, url: "u1" },
        { showstartId: "2", title: "B", cityCode: "310000", showTime: null, url: "u2" },
      ],
    });
    vi.spyOn(showsRepo, "filterNewShowstartIds").mockResolvedValue(["2"]);
    const detailSpy = vi.spyOn(client.scraperClient, "showDetail").mockResolvedValue({
      showstartId: "2", title: "B", cityCode: "310000", venue: "V", showTime: null,
      price: null, url: "u2", performers: ["万能青年旅店"],
    });
    const upsertSpy = vi.spyOn(showsRepo, "upsertShow").mockResolvedValue({ id: "db2", showstartId: "2" });

    const result = await crawlCities(["310000"]);
    expect(detailSpy).toHaveBeenCalledOnce();
    expect(detailSpy).toHaveBeenCalledWith("2");
    expect(upsertSpy).toHaveBeenCalledOnce();
    expect(result.newShowIds).toEqual(["db2"]);
    expect(result.failedCities).toEqual([]);
  });

  it("isolates a failing city", async () => {
    vi.spyOn(client.scraperClient, "cityShows").mockRejectedValue(new Error("sign fail"));
    const result = await crawlCities(["310000"]);
    expect(result.failedCities).toEqual(["310000"]);
    expect(result.newShowIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test lib/crawler/showstart.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/crawler/showstart.ts`**

```ts
import { scraperClient } from "@/lib/scraper-client";
import { filterNewShowstartIds, upsertShow } from "@/lib/repositories/shows";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 1000 + Math.floor(Math.random() * 1000); // 1-2s

export async function crawlCities(
  cityCodes: string[],
): Promise<{ newShowIds: string[]; failedCities: string[] }> {
  const newShowIds: string[] = [];
  const failedCities: string[] = [];

  for (const cityCode of cityCodes) {
    try {
      const { shows } = await scraperClient.cityShows(cityCode, 1);
      const newIds = await filterNewShowstartIds(shows.map((s) => s.showstartId));
      for (const showstartId of newIds) {
        await sleep(jitter());
        const detail = await scraperClient.showDetail(showstartId);
        const saved = await upsertShow(detail);
        newShowIds.push(saved.id);
      }
    } catch {
      failedCities.push(cityCode);
    }
  }
  return { newShowIds, failedCities };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test lib/crawler/showstart.test.ts`
Expected: PASS (2 tests). (The delay is skipped because the first test yields only after mocked calls; keep the suite fast by noting jitter uses fake timers only if needed — with a single new show the ~1-2s sleep runs once. If the test is slow, wrap with `vi.useFakeTimers()`; not required for correctness.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(crawler): showstart city crawler with per-city isolation"
```

---

## Task 4: Notifier (candidate query + aggregated email + dedup)

**Files:**
- Create: `lib/notifier/candidates.ts`
- Create: `lib/notifier/mailer.ts`
- Create: `lib/notifier/index.ts`
- Test: `lib/notifier/candidates.test.ts`, `lib/notifier/index.test.ts`

**Interfaces:**
- Produces:
  - `findNotifyCandidates(): Promise<Array<{ userId: string; email: string; shows: NotifyShow[] }>>` where a candidate is (user, show) with show.cityCode ∈ user cities ∧ a followed-artist match ∧ no prior notification.
  - `sendMail(to, subject, html): Promise<void>` (nodemailer transporter from SMTP env).
  - `runNotifications(): Promise<{ usersNotified: number; emailsFailed: number }>` — sends one aggregated email per user, records `notifications` rows (status sent/failed), retries send up to 3× with backoff.

- [ ] **Step 1: Write failing test for candidates**

`lib/notifier/candidates.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { upsertArtist } from "@/lib/repositories/artists";
import { upsertShow } from "@/lib/repositories/shows";
import { persistMatches } from "@/lib/repositories/matches";
import { findNotifyCandidates } from "./candidates";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe("findNotifyCandidates", () => {
  it("includes a matched show in a followed city, excludes already-notified", async () => {
    const email = `c_${uid()}@e.com`;
    const user = await prisma.user.create({
      data: { email, passwordHash: "x", emailVerified: new Date(), cities: { create: { cityCode: "310000" } } },
    });
    const artist = await upsertArtist(`Band_${uid()}`);
    await prisma.userArtist.create({ data: { userId: user.id, artistId: artist.id, status: "followed" } });
    const show = await upsertShow({
      showstartId: `S_${uid()}`, title: "T", cityCode: "310000", venue: "V",
      showTime: "2027-01-01T20:00:00", price: "100", url: "http://x", performers: [artist.name],
    });
    await persistMatches([{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);

    let cands = await findNotifyCandidates();
    const mine = cands.find((c) => c.userId === user.id);
    expect(mine?.shows.map((s) => s.showId)).toContain(show.id);

    // after notifying, it is excluded
    await prisma.notification.create({ data: { userId: user.id, showId: show.id, status: "sent" } });
    cands = await findNotifyCandidates();
    expect(cands.find((c) => c.userId === user.id)).toBeUndefined();
  });

  it("excludes shows outside the user's cities", async () => {
    const user = await prisma.user.create({
      data: { email: `c_${uid()}@e.com`, passwordHash: "x", emailVerified: new Date(),
        cities: { create: { cityCode: "440300" } } },
    });
    const artist = await upsertArtist(`Band_${uid()}`);
    await prisma.userArtist.create({ data: { userId: user.id, artistId: artist.id, status: "followed" } });
    const show = await upsertShow({
      showstartId: `S_${uid()}`, title: "T", cityCode: "310000", venue: "V",
      showTime: null, price: null, url: "http://x", performers: [artist.name],
    });
    await persistMatches([{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);
    const cands = await findNotifyCandidates();
    expect(cands.find((c) => c.userId === user.id)).toBeUndefined();
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test lib/notifier/candidates.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/notifier/candidates.ts`**

```ts
import { prisma } from "@/lib/db";

export interface NotifyShow {
  showId: string;
  title: string;
  cityCode: string;
  venue: string | null;
  showTime: Date | null;
  price: string | null;
  url: string;
  artistNames: string[];
  hasTitleOnlyMatch: boolean;
}

export async function findNotifyCandidates(): Promise<
  Array<{ userId: string; email: string; shows: NotifyShow[] }>
> {
  const users = await prisma.user.findMany({
    where: { emailVerified: { not: null } },
    include: { cities: true, artists: { where: { status: "followed" }, select: { artistId: true } } },
  });

  const out: Array<{ userId: string; email: string; shows: NotifyShow[] }> = [];

  for (const user of users) {
    const cityCodes = user.cities.map((c) => c.cityCode);
    const followedArtistIds = new Set(user.artists.map((a) => a.artistId));
    if (cityCodes.length === 0 || followedArtistIds.size === 0) continue;

    const shows = await prisma.show.findMany({
      where: {
        cityCode: { in: cityCodes },
        showArtists: { some: { artistId: { in: [...followedArtistIds] } } },
        notifications: { none: { userId: user.id } },
      },
      include: { showArtists: { include: { artist: true } } },
    });

    const notifyShows: NotifyShow[] = shows.map((s) => {
      const mine = s.showArtists.filter((sa) => followedArtistIds.has(sa.artistId));
      return {
        showId: s.id,
        title: s.title,
        cityCode: s.cityCode,
        venue: s.venue,
        showTime: s.showTime,
        price: s.price,
        url: s.url,
        artistNames: mine.map((sa) => sa.artist.name),
        hasTitleOnlyMatch: mine.every((sa) => sa.matchedBy === "title"),
      };
    });

    if (notifyShows.length > 0) out.push({ userId: user.id, email: user.email, shows: notifyShows });
  }
  return out;
}
```

- [ ] **Step 4: Run candidates test to verify it passes**

Run: `pnpm test lib/notifier/candidates.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `lib/notifier/mailer.ts`**

```ts
import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "localhost",
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: false,
    });
  }
  return transporter;
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? "Show-Remind <no-reply@show-remind.local>",
    to,
    subject,
    html,
  });
}
```

- [ ] **Step 6: Write failing test for runNotifications**

`lib/notifier/index.test.ts`:
```ts
import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { upsertArtist } from "@/lib/repositories/artists";
import { upsertShow } from "@/lib/repositories/shows";
import { persistMatches } from "@/lib/repositories/matches";
import * as mailer from "./mailer";
import { runNotifications } from "./index";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
afterEach(() => vi.restoreAllMocks());

describe("runNotifications", () => {
  it("sends one aggregated email and records notifications", async () => {
    const sendSpy = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    const user = await prisma.user.create({
      data: { email: `r_${uid()}@e.com`, passwordHash: "x", emailVerified: new Date(),
        cities: { create: { cityCode: "310000" } } },
    });
    const artist = await upsertArtist(`Band_${uid()}`);
    await prisma.userArtist.create({ data: { userId: user.id, artistId: artist.id, status: "followed" } });
    for (let i = 0; i < 2; i++) {
      const show = await upsertShow({
        showstartId: `S_${uid()}_${i}`, title: `T${i}`, cityCode: "310000", venue: "V",
        showTime: null, price: null, url: "http://x", performers: [artist.name],
      });
      await persistMatches([{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);
    }
    const result = await runNotifications();
    expect(sendSpy).toHaveBeenCalledOnce(); // aggregated: one email despite two shows
    expect(result.usersNotified).toBeGreaterThanOrEqual(1);
    const notifs = await prisma.notification.count({ where: { userId: user.id, status: "sent" } });
    expect(notifs).toBe(2);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 7: Write `lib/notifier/index.ts`**

```ts
import { prisma } from "@/lib/db";
import { findNotifyCandidates, type NotifyShow } from "./candidates";
import { sendMail } from "./mailer";

function renderEmail(shows: NotifyShow[]): string {
  const rows = shows
    .map((s) => {
      const when = s.showTime ? s.showTime.toISOString().slice(0, 16).replace("T", " ") : "待定";
      const maybe = s.hasTitleOnlyMatch ? "(可能相关) " : "";
      return `<li><b>${maybe}${s.artistNames.join(" / ")}</b> — ${s.title}<br/>
        场馆:${s.venue ?? "待定"} · 时间:${when} · 票价:${s.price ?? "待定"}<br/>
        <a href="${s.url}">${s.url}</a></li>`;
    })
    .join("");
  return `<p>你关注的音乐人有新的演出:</p><ul>${rows}</ul>`;
}

async function sendWithRetry(email: string, html: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await sendMail(email, "你关注的音乐人有新演出", html);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  return false;
}

export async function runNotifications(): Promise<{ usersNotified: number; emailsFailed: number }> {
  const candidates = await findNotifyCandidates();
  let usersNotified = 0;
  let emailsFailed = 0;

  for (const { userId, email, shows } of candidates) {
    const ok = await sendWithRetry(email, renderEmail(shows));
    const status = ok ? "sent" : "failed";
    await prisma.notification.createMany({
      data: shows.map((s) => ({ userId, showId: s.showId, status, sentAt: ok ? new Date() : null })),
      skipDuplicates: true,
    });
    if (ok) usersNotified++;
    else emailsFailed++;
  }
  return { usersNotified, emailsFailed };
}
```

- [ ] **Step 8: Run notifier tests to verify they pass**

Run: `pnpm test lib/notifier/index.test.ts`
Expected: PASS. Requires `nodemailer` installed: `pnpm add nodemailer && pnpm add -D @types/nodemailer`.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(notifier): candidate query, aggregated email, retry + dedup"
```

---

## Task 5: Pipeline orchestration + immediate match

**Files:**
- Create: `lib/pipeline.ts`
- Test: `lib/pipeline.test.ts`

**Interfaces:**
- Consumes: `crawlCities`, `getAllFollowedArtists`, `persistMatches`, `matchShows`, `runNotifications`.
- Produces:
  - `matchNewShows(showIds: string[]): Promise<number>` — loads shows, runs matcher vs all followed artists, persists.
  - `runPipeline(): Promise<{ crawled: number; matched: number; usersNotified: number; failedCities: string[] }>` — city union → crawl → match → notify.
  - `matchAllForUser(userId): Promise<number>` — immediate match after a user follows (matches existing shows against that user's artists).

- [ ] **Step 1: Write failing test**

`lib/pipeline.test.ts`:
```ts
import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { upsertArtist } from "@/lib/repositories/artists";
import { upsertShow } from "@/lib/repositories/shows";
import { matchNewShows } from "./pipeline";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
afterEach(() => vi.restoreAllMocks());

describe("matchNewShows", () => {
  it("creates show_artists for followed artists appearing in performers", async () => {
    const user = await prisma.user.create({ data: { email: `p_${uid()}@e.com`, passwordHash: "x" } });
    const artist = await upsertArtist(`万能青年旅店_${uid()}`);
    await prisma.userArtist.create({ data: { userId: user.id, artistId: artist.id, status: "followed" } });
    const show = await upsertShow({
      showstartId: `S_${uid()}`, title: "巡演", cityCode: "310000", venue: "V",
      showTime: null, price: null, url: "http://x", performers: [artist.name],
    });
    const created = await matchNewShows([show.id]);
    expect(created).toBeGreaterThanOrEqual(1);
    const sa = await prisma.showArtist.findFirst({ where: { showId: show.id, artistId: artist.id } });
    expect(sa?.matchedBy).toBe("performer");
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test lib/pipeline.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/pipeline.ts`**

```ts
import { prisma } from "@/lib/db";
import { crawlCities } from "@/lib/crawler/showstart";
import { getAllFollowedArtists, getFollowedArtists } from "@/lib/repositories/user-artists";
import { persistMatches } from "@/lib/repositories/matches";
import { matchShows, type MatchArtist, type MatchShow } from "@/lib/matcher";
import { runNotifications } from "@/lib/notifier";

async function loadShowsForMatching(showIds: string[]): Promise<MatchShow[]> {
  if (showIds.length === 0) return [];
  const shows = await prisma.show.findMany({ where: { id: { in: showIds } } });
  return shows.map((s) => ({
    id: s.id,
    title: s.title,
    performers: (s.performers as string[]) ?? [],
  }));
}

export async function matchNewShows(showIds: string[]): Promise<number> {
  const artists = await getAllFollowedArtists();
  const shows = await loadShowsForMatching(showIds);
  return persistMatches(matchShows(artists, shows));
}

export async function matchAllForUser(userId: string): Promise<number> {
  const artists: MatchArtist[] = await getFollowedArtists(userId);
  if (artists.length === 0) return 0;
  const dbShows = await prisma.show.findMany({ where: { showTime: { gte: new Date() } } });
  const shows: MatchShow[] = dbShows.map((s) => ({
    id: s.id,
    title: s.title,
    performers: (s.performers as string[]) ?? [],
  }));
  return persistMatches(matchShows(artists, shows));
}

async function unionCities(): Promise<string[]> {
  const rows = await prisma.userCity.findMany({ distinct: ["cityCode"], select: { cityCode: true } });
  return rows.map((r) => r.cityCode);
}

export async function runPipeline(): Promise<{
  crawled: number;
  matched: number;
  usersNotified: number;
  failedCities: string[];
}> {
  const cities = await unionCities();
  const { newShowIds, failedCities } = await crawlCities(cities);
  const matched = await matchNewShows(newShowIds);
  const { usersNotified } = await runNotifications();
  return { crawled: newShowIds.length, matched, usersNotified, failedCities };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test lib/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pipeline): crawl-match-notify orchestration + immediate match"
```

---

## Task 6: Worker process (node-cron)

**Files:**
- Create: `worker.ts`
- Create: `lib/notifier/admin-alert.ts`
- Modify: `package.json` (add `worker` script + deps)
- Test: `lib/notifier/admin-alert.test.ts`

**Interfaces:**
- Consumes: `runPipeline`, `sendMail`.
- Produces: `maybeAlertAdmin(failedCities, cityCount, consecutiveFailures): Promise<boolean>` — returns true (and emails admin) when 3+ consecutive fully-failed runs. `worker.ts` schedules `runPipeline` twice daily with jitter and tracks consecutive full failures in-process.

- [ ] **Step 1: Write failing test for admin alert**

`lib/notifier/admin-alert.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import * as mailer from "./mailer";
import { maybeAlertAdmin } from "./admin-alert";

afterEach(() => vi.restoreAllMocks());

describe("maybeAlertAdmin", () => {
  it("alerts on the 3rd consecutive full failure", async () => {
    const spy = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    expect(await maybeAlertAdmin(["310000"], 1, 3)).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });
  it("does not alert before 3 or on partial failure", async () => {
    const spy = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    expect(await maybeAlertAdmin(["310000"], 1, 2)).toBe(false);
    expect(await maybeAlertAdmin([], 2, 5)).toBe(false); // no failed cities -> not a full failure
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test lib/notifier/admin-alert.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/notifier/admin-alert.ts`**

```ts
import { sendMail } from "./mailer";

export async function maybeAlertAdmin(
  failedCities: string[],
  cityCount: number,
  consecutiveFailures: number,
): Promise<boolean> {
  const fullFailure = cityCount > 0 && failedCities.length === cityCount;
  if (!fullFailure || consecutiveFailures < 3) return false;
  const admin = process.env.ADMIN_ALERT_EMAIL;
  if (!admin) return false;
  await sendMail(
    admin,
    "[show-remind] 秀动爬取连续失败",
    `<p>已连续 ${consecutiveFailures} 轮全局爬取失败,失败城市:${failedCities.join(", ")}。大概率是签名算法变更,请检查 scraper。</p>`,
  );
  return true;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test lib/notifier/admin-alert.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `worker.ts`**

```ts
import cron from "node-cron";
import { runPipeline } from "@/lib/pipeline";
import { maybeAlertAdmin } from "@/lib/notifier/admin-alert";

let consecutiveFailures = 0;

async function tick(): Promise<void> {
  // jitter 0-15 min so runs are not on the exact minute
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 15 * 60 * 1000)));
  try {
    const cities = await import("@/lib/db").then(({ prisma }) =>
      prisma.userCity.findMany({ distinct: ["cityCode"] }),
    );
    const result = await runPipeline();
    const fullFailure = cities.length > 0 && result.failedCities.length === cities.length;
    consecutiveFailures = fullFailure ? consecutiveFailures + 1 : 0;
    await maybeAlertAdmin(result.failedCities, cities.length, consecutiveFailures);
    console.log(`[worker] pipeline done`, result);
  } catch (err) {
    consecutiveFailures += 1;
    console.error(`[worker] pipeline crashed`, err);
  }
}

// 10:00 and 20:00 daily (server local time)
cron.schedule("0 10,20 * * *", () => void tick());
console.log("[worker] scheduled: 0 10,20 * * *");
```

- [ ] **Step 6: Add deps and worker script to `package.json`**

Run:
```bash
pnpm add node-cron nodemailer bcryptjs next-auth@beta
pnpm add -D @types/node-cron @types/nodemailer @types/bcryptjs tsx
```
Add to `"scripts"`:
```json
"worker": "tsx worker.ts"
```

- [ ] **Step 7: Manually verify the worker boots**

Run: `pnpm worker`
Expected: prints `[worker] scheduled: 0 10,20 * * *` and stays running. Ctrl-C to stop.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(worker): node-cron pipeline runner with admin alert"
```

---

## Task 7: Auth.js (register, verify, login)

**Files:**
- Create: `auth.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`
- Create: `lib/auth/passwords.ts`, `lib/auth/register.ts`
- Create: `app/register/page.tsx`, `app/login/page.tsx`, `app/verify/route.ts`
- Test: `lib/auth/passwords.test.ts`, `lib/auth/register.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(pw): Promise<string>`, `verifyPassword(pw, hash): Promise<boolean>`
  - `registerUser({ email, password }): Promise<{ userId: string }>` — creates user (unverified), a `VerificationToken`, sends a verify email with `${APP_URL}/verify?token=...`.
  - `auth`, `signIn`, `signOut`, `handlers` from Auth.js; credentials login requires `emailVerified`.

- [ ] **Step 1: Write failing tests**

`lib/auth/passwords.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./passwords";

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("s3cret!");
    expect(hash).not.toBe("s3cret!");
    expect(await verifyPassword("s3cret!", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
```

`lib/auth/register.test.ts`:
```ts
import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import * as mailer from "@/lib/notifier/mailer";
import { registerUser, RegistrationError } from "./register";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
afterEach(() => vi.restoreAllMocks());

describe("registerUser", () => {
  it("creates an unverified user, a token, and sends a verify email", async () => {
    const sendSpy = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    const email = `reg_${uid()}@e.com`;
    const { userId } = await registerUser({ email, password: "password123" });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.emailVerified).toBeNull();
    const token = await prisma.verificationToken.findFirst({ where: { userId } });
    expect(token).not.toBeNull();
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0][2]).toContain("/verify?token=");
  });

  it("rejects duplicate email", async () => {
    vi.spyOn(mailer, "sendMail").mockResolvedValue();
    const email = `dup_${uid()}@e.com`;
    await registerUser({ email, password: "password123" });
    await expect(registerUser({ email, password: "password123" })).rejects.toBeInstanceOf(
      RegistrationError,
    );
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test lib/auth/passwords.test.ts lib/auth/register.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write auth libs**

`lib/auth/passwords.ts`:
```ts
import bcrypt from "bcryptjs";

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}
```

`lib/auth/register.ts`:
```ts
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "./passwords";
import { sendMail } from "@/lib/notifier/mailer";

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationError";
  }
}

export async function registerUser(input: {
  email: string;
  password: string;
}): Promise<{ userId: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new RegistrationError("邮箱格式无效");
  if (input.password.length < 8) throw new RegistrationError("密码至少 8 位");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new RegistrationError("该邮箱已注册");

  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(input.password) },
  });
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: { token, userId: user.id, expires: new Date(Date.now() + 24 * 3600 * 1000) },
  });
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/verify?token=${token}`;
  await sendMail(email, "验证你的 Show-Remind 邮箱", `<p>点击验证:<a href="${url}">${url}</a></p>`);
  return { userId: user.id };
}
```

- [ ] **Step 4: Run auth lib tests to verify they pass**

Run: `pnpm test lib/auth/passwords.test.ts lib/auth/register.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `auth.ts` (Auth.js v5 config)**

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/passwords";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (creds) => {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        const password = String(creds?.password ?? "");
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.emailVerified) return null;
        if (!(await verifyPassword(password, user.passwordHash))) return null;
        return { id: user.id, email: user.email };
      },
    }),
  ],
});
```

`app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 6: Write `verify` route and auth pages**

`app/verify/route.ts`:
```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/login?error=missing_token", req.url));
  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (!record || record.expires < new Date()) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", req.url));
  }
  await prisma.user.update({ where: { id: record.userId }, data: { emailVerified: new Date() } });
  await prisma.verificationToken.delete({ where: { token } });
  return NextResponse.redirect(new URL("/login?verified=1", req.url));
}
```

`app/register/page.tsx`:
```tsx
import { registerUser, RegistrationError } from "@/lib/auth/register";
import { redirect } from "next/navigation";

async function action(formData: FormData) {
  "use server";
  try {
    await registerUser({
      email: String(formData.get("email")),
      password: String(formData.get("password")),
    });
  } catch (e) {
    if (e instanceof RegistrationError) redirect(`/register?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/register?sent=1");
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1>注册</h1>
      {sp.sent && <p>验证邮件已发送,请查收(开发环境见 MailHog http://localhost:8025)。</p>}
      {sp.error && <p style={{ color: "crimson" }}>{sp.error}</p>}
      <form action={action}>
        <input name="email" type="email" placeholder="邮箱" required /><br />
        <input name="password" type="password" placeholder="密码(≥8位)" required /><br />
        <button type="submit">注册</button>
      </form>
      <p><a href="/login">已有账号,登录</a></p>
    </main>
  );
}
```

`app/login/page.tsx`:
```tsx
import { signIn } from "@/auth";
import { redirect } from "next/navigation";

async function action(formData: FormData) {
  "use server";
  try {
    await signIn("credentials", {
      email: String(formData.get("email")),
      password: String(formData.get("password")),
      redirectTo: "/playlists",
    });
  } catch (e) {
    // next-auth throws a redirect on success; rethrow those
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    redirect("/login?error=1");
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; verified?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1>登录</h1>
      {sp.verified && <p style={{ color: "green" }}>邮箱已验证,请登录。</p>}
      {sp.error && <p style={{ color: "crimson" }}>邮箱或密码错误,或邮箱未验证。</p>}
      <form action={action}>
        <input name="email" type="email" placeholder="邮箱" required /><br />
        <input name="password" type="password" placeholder="密码" required /><br />
        <button type="submit">登录</button>
      </form>
      <p><a href="/register">没有账号,注册</a></p>
    </main>
  );
}
```

- [ ] **Step 7: Set `AUTH_SECRET` and smoke-test the auth flow**

Run:
```bash
# generate a secret and put AUTH_SECRET into .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
pnpm dev
```
Then in a browser: register at `/register` → open MailHog (`http://localhost:8025`) → click the verify link → log in at `/login`. Expected: redirected to `/playlists` (page built in Task 8; a 404 there is fine at this step — auth itself succeeded when you're redirected there).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(auth): register, email verification, and credentials login"
```

---

## Task 8: Paste playlist → resolve → pick artists

**Files:**
- Create: `lib/repositories/playlists.ts`
- Create: `lib/services/resolve-playlist.ts`
- Create: `app/playlists/page.tsx`, `app/playlists/actions.ts`
- Create: `app/playlists/[id]/page.tsx`
- Test: `lib/services/resolve-playlist.test.ts`

**Interfaces:**
- Consumes: `parsePlaylistLink`, `resolveNeteasePlaylist`, `resolveQqPlaylist`, `tallyArtists`, `confirmFollows`, `matchAllForUser`, `auth`.
- Produces:
  - `createPlaylistFromLink(userId, link): Promise<{ playlistId: string }>` — parse, create `playlists` row (`status: "pending"`).
  - `resolvePlaylist(playlistId): Promise<void>` — fetch via the right adapter, store title + tally as pending selection (status `ready`/`failed` + `failureReason`).
  - `getPlaylistTally(playlistId): Promise<{ title: string; status: string; failureReason: string | null; artists: ArtistTally[] }>`

- [ ] **Step 1: Write failing test**

`lib/services/resolve-playlist.test.ts`:
```ts
import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import * as netease from "@/lib/adapters/netease";
import { createPlaylistFromLink, resolvePlaylist, getPlaylistTally } from "./resolve-playlist";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
afterEach(() => vi.restoreAllMocks());

describe("resolve-playlist", () => {
  it("stores a tally on success", async () => {
    const user = await prisma.user.create({ data: { email: `rp_${uid()}@e.com`, passwordHash: "x" } });
    vi.spyOn(netease, "resolveNeteasePlaylist").mockResolvedValue({
      platform: "netease", externalId: "123", title: "摇滚",
      songs: [
        { name: "a", artists: ["万能青年旅店"] },
        { name: "b", artists: ["万能青年旅店"] },
        { name: "c", artists: ["重塑雕像的权利"] },
      ],
    });
    const { playlistId } = await createPlaylistFromLink(user.id, "https://music.163.com/playlist?id=123");
    await resolvePlaylist(playlistId);
    const t = await getPlaylistTally(playlistId);
    expect(t.status).toBe("ready");
    expect(t.artists[0]).toEqual({ name: "万能青年旅店", songCount: 2 });
  });

  it("marks failed with a reason on adapter error", async () => {
    const user = await prisma.user.create({ data: { email: `rp_${uid()}@e.com`, passwordHash: "x" } });
    vi.spyOn(netease, "resolveNeteasePlaylist").mockRejectedValue(new Error("私密歌单"));
    const { playlistId } = await createPlaylistFromLink(user.id, "https://music.163.com/playlist?id=999");
    await resolvePlaylist(playlistId);
    const t = await getPlaylistTally(playlistId);
    expect(t.status).toBe("failed");
    expect(t.failureReason).toContain("私密歌单");
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test lib/services/resolve-playlist.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `lib/repositories/playlists.ts`**

```ts
import { prisma } from "@/lib/db";
import type { ArtistTally } from "@/lib/adapters/types";
import type { PlatformId } from "@/lib/adapters/types";

export async function createPlaylist(userId: string, platform: PlatformId, externalId: string) {
  return prisma.playlist.upsert({
    where: { userId_platform_externalId: { userId, platform, externalId } },
    create: { userId, platform, externalId, status: "pending" },
    update: { status: "pending", failureReason: null },
    select: { id: true },
  });
}

export async function setPlaylistReady(id: string, title: string, tally: ArtistTally[]) {
  await prisma.playlist.update({
    where: { id },
    data: { title, status: "ready", lastSyncedAt: new Date(), failureReason: null },
  });
  // The transient artist list for the selection screen lives in playlist_tallies.
  await prisma.playlistTally.deleteMany({ where: { playlistId: id } });
  await prisma.playlistTally.createMany({
    data: tally.map((t) => ({ playlistId: id, name: t.name, songCount: t.songCount })),
  });
}

export async function setPlaylistFailed(id: string, reason: string) {
  await prisma.playlist.update({ where: { id }, data: { status: "failed", failureReason: reason } });
}

export async function getPlaylist(id: string) {
  return prisma.playlist.findUnique({ where: { id }, include: { tally: { orderBy: { songCount: "desc" } } } });
}
```

Note: this introduces a small `PlaylistTally` table to hold the transient artist list for the selection screen. Add to `prisma/schema.prisma`:
```prisma
model PlaylistTally {
  id         String  @id @default(cuid())
  playlistId String  @map("playlist_id")
  name       String
  songCount  Int     @map("song_count")
  playlist   Playlist @relation(fields: [playlistId], references: [id], onDelete: Cascade)
  @@map("playlist_tallies")
}
```
And add the back-relation on `Playlist`:
```prisma
  tally         PlaylistTally[]
```
Then run: `pnpm prisma migrate dev --name add_playlist_tally`. (Remove the stray `$executeRaw` line above — the `update` already sets the title; final `setPlaylistReady` should only do the `update` + rewrite `playlistTally` rows.)

- [ ] **Step 4: Write `lib/services/resolve-playlist.ts`**

```ts
import { parsePlaylistLink } from "@/lib/adapters/parse-link";
import { resolveNeteasePlaylist } from "@/lib/adapters/netease";
import { resolveQqPlaylist } from "@/lib/adapters/qq";
import { tallyArtists } from "@/lib/adapters/tally";
import type { ArtistTally } from "@/lib/adapters/types";
import {
  createPlaylist,
  getPlaylist,
  setPlaylistFailed,
  setPlaylistReady,
} from "@/lib/repositories/playlists";

export async function createPlaylistFromLink(
  userId: string,
  link: string,
): Promise<{ playlistId: string }> {
  const { platform, externalId } = await parsePlaylistLink(link);
  const pl = await createPlaylist(userId, platform, externalId);
  return { playlistId: pl.id };
}

export async function resolvePlaylist(playlistId: string): Promise<void> {
  const pl = await getPlaylist(playlistId);
  if (!pl) throw new Error("playlist not found");
  try {
    const resolved =
      pl.platform === "netease"
        ? await resolveNeteasePlaylist(pl.externalId)
        : await resolveQqPlaylist(pl.externalId);
    await setPlaylistReady(playlistId, resolved.title, tallyArtists(resolved));
  } catch (err) {
    await setPlaylistFailed(playlistId, (err as Error).message);
  }
}

export async function getPlaylistTally(playlistId: string): Promise<{
  title: string;
  status: string;
  failureReason: string | null;
  artists: ArtistTally[];
}> {
  const pl = await getPlaylist(playlistId);
  if (!pl) throw new Error("playlist not found");
  return {
    title: pl.title ?? "",
    status: pl.status,
    failureReason: pl.failureReason,
    artists: pl.tally.map((t) => ({ name: t.name, songCount: t.songCount })),
  };
}
```

- [ ] **Step 5: Run the resolve-playlist test**

Run: `pnpm test lib/services/resolve-playlist.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the pages/actions**

`app/playlists/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createPlaylistFromLink, resolvePlaylist } from "@/lib/services/resolve-playlist";
import { confirmFollows } from "@/lib/repositories/user-artists";
import { matchAllForUser } from "@/lib/pipeline";

export async function submitLink(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const link = String(formData.get("link") ?? "");
  let playlistId: string;
  try {
    ({ playlistId } = await createPlaylistFromLink(session.user.id, link));
  } catch {
    redirect("/playlists?error=bad_link");
  }
  await resolvePlaylist(playlistId); // synchronous for MVP; small playlists resolve quickly
  redirect(`/playlists/${playlistId}`);
}

export async function confirmSelection(playlistId: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const all = formData.getAll("all_artists").map(String);
  const followed = new Set(formData.getAll("follow").map(String));
  await confirmFollows(session.user.id, playlistId, {
    follow: [...followed],
    ignore: all.filter((n) => !followed.has(n)),
  });
  await matchAllForUser(session.user.id);
  redirect("/shows");
}
```

`app/playlists/page.tsx`:
```tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { submitLink } from "./actions";

export default async function PlaylistsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const sp = await searchParams;
  return (
    <main style={{ maxWidth: 560, margin: "40px auto" }}>
      <h1>粘贴歌单链接</h1>
      {sp.error === "bad_link" && <p style={{ color: "crimson" }}>无法识别的歌单链接。</p>}
      <form action={submitLink}>
        <input name="link" placeholder="网易云 / QQ 音乐 歌单分享链接" style={{ width: "100%" }} required />
        <button type="submit">解析</button>
      </form>
      <p><a href="/shows">我的演出</a> · <a href="/settings">城市与手动关注</a></p>
    </main>
  );
}
```

`app/playlists/[id]/page.tsx`:
```tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getPlaylistTally } from "@/lib/services/resolve-playlist";
import { confirmSelection } from "../actions";

export default async function PlaylistDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const t = await getPlaylistTally(id);

  if (t.status === "failed") {
    return (
      <main style={{ maxWidth: 560, margin: "40px auto" }}>
        <h1>解析失败</h1>
        <p style={{ color: "crimson" }}>{t.failureReason}</p>
        <p><a href="/playlists">重试</a></p>
      </main>
    );
  }

  const confirm = confirmSelection.bind(null, id);
  return (
    <main style={{ maxWidth: 560, margin: "40px auto" }}>
      <h1>{t.title || "歌单"} — 选择要关注的音乐人</h1>
      <form action={confirm}>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {t.artists.map((a) => (
            <li key={a.name}>
              <input type="hidden" name="all_artists" value={a.name} />
              <label>
                <input type="checkbox" name="follow" value={a.name} defaultChecked />{" "}
                {a.name} <small>({a.songCount})</small>
              </label>
            </li>
          ))}
        </ul>
        <button type="submit">确认关注</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Smoke-test the flow**

Run: `pnpm dev`, log in, paste a real netease playlist link, confirm the artist list renders with checkboxes (default checked, sorted by song count), confirm follows redirects to `/shows`.
Expected: no runtime errors; `user_artists` rows created.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(web): paste playlist, resolve, and artist selection"
```

---

## Task 9: City management & manual artist add

**Files:**
- Create: `lib/repositories/cities.ts`
- Create: `app/settings/page.tsx`, `app/settings/actions.ts`
- Create: `lib/cities.ts` (city code list)
- Test: `lib/repositories/cities.test.ts`

**Interfaces:**
- Produces:
  - `getUserCities(userId): Promise<string[]>`, `setUserCities(userId, cityCodes): Promise<void>`
  - `CITIES: { code: string; name: string }[]` (a small curated list of major livehouse cities)

- [ ] **Step 1: Write failing test**

`lib/repositories/cities.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getUserCities, setUserCities } from "./cities";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe("cities repo", () => {
  it("replaces the user's city set", async () => {
    const user = await prisma.user.create({ data: { email: `city_${uid()}@e.com`, passwordHash: "x" } });
    await setUserCities(user.id, ["310000", "110000"]);
    expect((await getUserCities(user.id)).sort()).toEqual(["110000", "310000"]);
    await setUserCities(user.id, ["440300"]);
    expect(await getUserCities(user.id)).toEqual(["440300"]);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test lib/repositories/cities.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/cities.ts` and `lib/repositories/cities.ts`**

`lib/cities.ts`:
```ts
export const CITIES: { code: string; name: string }[] = [
  { code: "110000", name: "北京" },
  { code: "310000", name: "上海" },
  { code: "440100", name: "广州" },
  { code: "440300", name: "深圳" },
  { code: "330100", name: "杭州" },
  { code: "510100", name: "成都" },
  { code: "500000", name: "重庆" },
  { code: "420100", name: "武汉" },
  { code: "610100", name: "西安" },
  { code: "320100", name: "南京" },
];
```
Note: confirm these codes against Showstart's `cityCode` scheme during the Task 3 (Plan 1) live smoke; adjust values here if Showstart uses different codes.

`lib/repositories/cities.ts`:
```ts
import { prisma } from "@/lib/db";

export async function getUserCities(userId: string): Promise<string[]> {
  const rows = await prisma.userCity.findMany({ where: { userId }, select: { cityCode: true } });
  return rows.map((r) => r.cityCode);
}

export async function setUserCities(userId: string, cityCodes: string[]): Promise<void> {
  const unique = [...new Set(cityCodes)];
  await prisma.$transaction([
    prisma.userCity.deleteMany({ where: { userId } }),
    prisma.userCity.createMany({ data: unique.map((cityCode) => ({ userId, cityCode })) }),
  ]);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test lib/repositories/cities.test.ts`
Expected: PASS.

- [ ] **Step 5: Write settings page + actions**

`app/settings/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { setUserCities } from "@/lib/repositories/cities";
import { addManualArtist } from "@/lib/repositories/user-artists";
import { matchAllForUser } from "@/lib/pipeline";

export async function saveCities(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  await setUserCities(session.user.id, formData.getAll("city").map(String));
  redirect("/settings?saved=1");
}

export async function addArtist(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const name = String(formData.get("name") ?? "").trim();
  if (name) {
    await addManualArtist(session.user.id, name);
    await matchAllForUser(session.user.id);
  }
  redirect("/settings?added=1");
}
```

`app/settings/page.tsx`:
```tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { CITIES } from "@/lib/cities";
import { getUserCities } from "@/lib/repositories/cities";
import { saveCities, addArtist } from "./actions";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; added?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const sp = await searchParams;
  const mine = new Set(await getUserCities(session.user.id));
  return (
    <main style={{ maxWidth: 560, margin: "40px auto" }}>
      <h1>关注城市</h1>
      {sp.saved && <p style={{ color: "green" }}>已保存。</p>}
      <form action={saveCities}>
        {CITIES.map((c) => (
          <label key={c.code} style={{ display: "inline-block", width: 120 }}>
            <input type="checkbox" name="city" value={c.code} defaultChecked={mine.has(c.code)} /> {c.name}
          </label>
        ))}
        <div><button type="submit">保存城市</button></div>
      </form>

      <h2>手动添加音乐人</h2>
      {sp.added && <p style={{ color: "green" }}>已添加。</p>}
      <form action={addArtist}>
        <input name="name" placeholder="乐队 / 歌手名" required />
        <button type="submit">添加关注</button>
      </form>
      <p><a href="/playlists">粘歌单</a> · <a href="/shows">我的演出</a></p>
    </main>
  );
}
```

- [ ] **Step 6: Smoke-test**

Run: `pnpm dev`, open `/settings`, select cities and save; add a manual artist. Expected: selections persist across reload; `user_cities` and `user_artists` updated.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(web): city management and manual artist add"
```

---

## Task 10: "My shows" page

**Files:**
- Create: `lib/repositories/my-shows.ts`
- Create: `app/shows/page.tsx`
- Test: `lib/repositories/my-shows.test.ts`

**Interfaces:**
- Produces: `getUpcomingShowsForUser(userId): Promise<Array<{ id: string; title: string; cityCode: string; venue: string | null; showTime: Date | null; price: string | null; url: string; artistNames: string[] }>>` — matched shows for the user's followed artists in the user's cities, `showTime` in the future (nulls included), soonest first.

- [ ] **Step 1: Write failing test**

`lib/repositories/my-shows.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { upsertArtist } from "./artists";
import { upsertShow } from "./shows";
import { persistMatches } from "./matches";
import { getUpcomingShowsForUser } from "./my-shows";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe("getUpcomingShowsForUser", () => {
  it("returns matched upcoming shows in followed cities", async () => {
    const user = await prisma.user.create({
      data: { email: `ms_${uid()}@e.com`, passwordHash: "x", cities: { create: { cityCode: "310000" } } },
    });
    const artist = await upsertArtist(`Band_${uid()}`);
    await prisma.userArtist.create({ data: { userId: user.id, artistId: artist.id, status: "followed" } });
    const show = await upsertShow({
      showstartId: `S_${uid()}`, title: "巡演 上海", cityCode: "310000", venue: "MAO",
      showTime: "2030-01-01T20:00:00", price: "180", url: "http://x", performers: [artist.name],
    });
    await persistMatches([{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);

    const rows = await getUpcomingShowsForUser(user.id);
    const mine = rows.find((r) => r.id === show.id);
    expect(mine).toBeTruthy();
    expect(mine?.artistNames).toContain(artist.name);
  });

  it("excludes shows outside followed cities", async () => {
    const user = await prisma.user.create({
      data: { email: `ms_${uid()}@e.com`, passwordHash: "x", cities: { create: { cityCode: "110000" } } },
    });
    const artist = await upsertArtist(`Band_${uid()}`);
    await prisma.userArtist.create({ data: { userId: user.id, artistId: artist.id, status: "followed" } });
    const show = await upsertShow({
      showstartId: `S_${uid()}`, title: "x", cityCode: "310000", venue: null,
      showTime: "2030-01-01T20:00:00", price: null, url: "http://x", performers: [artist.name],
    });
    await persistMatches([{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);
    const rows = await getUpcomingShowsForUser(user.id);
    expect(rows.find((r) => r.id === show.id)).toBeUndefined();
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test lib/repositories/my-shows.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/repositories/my-shows.ts`**

```ts
import { prisma } from "@/lib/db";

export async function getUpcomingShowsForUser(userId: string) {
  const [cities, followed] = await Promise.all([
    prisma.userCity.findMany({ where: { userId }, select: { cityCode: true } }),
    prisma.userArtist.findMany({ where: { userId, status: "followed" }, select: { artistId: true } }),
  ]);
  const cityCodes = cities.map((c) => c.cityCode);
  const artistIds = followed.map((f) => f.artistId);
  if (cityCodes.length === 0 || artistIds.length === 0) return [];

  const shows = await prisma.show.findMany({
    where: {
      cityCode: { in: cityCodes },
      showArtists: { some: { artistId: { in: artistIds } } },
      OR: [{ showTime: { gte: new Date() } }, { showTime: null }],
    },
    include: { showArtists: { where: { artistId: { in: artistIds } }, include: { artist: true } } },
    orderBy: { showTime: "asc" },
  });

  return shows.map((s) => ({
    id: s.id,
    title: s.title,
    cityCode: s.cityCode,
    venue: s.venue,
    showTime: s.showTime,
    price: s.price,
    url: s.url,
    artistNames: s.showArtists.map((sa) => sa.artist.name),
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test lib/repositories/my-shows.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `app/shows/page.tsx`**

```tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getUpcomingShowsForUser } from "@/lib/repositories/my-shows";

export default async function ShowsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const shows = await getUpcomingShowsForUser(session.user.id);
  return (
    <main style={{ maxWidth: 640, margin: "40px auto" }}>
      <h1>我的演出</h1>
      {shows.length === 0 && (
        <p>还没有匹配到演出。先去 <a href="/playlists">粘歌单</a> 并在 <a href="/settings">设置</a> 里选关注城市。</p>
      )}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {shows.map((s) => (
          <li key={s.id} style={{ marginBottom: 16 }}>
            <b>{s.artistNames.join(" / ")}</b> — {s.title}<br />
            场馆:{s.venue ?? "待定"} · 时间:{s.showTime ? s.showTime.toLocaleString("zh-CN") : "待定"} · 票价:{s.price ?? "待定"}<br />
            <a href={s.url} target="_blank" rel="noreferrer">查看/购票</a>
          </li>
        ))}
      </ul>
      <p><a href="/playlists">粘歌单</a> · <a href="/settings">设置</a></p>
    </main>
  );
}
```

- [ ] **Step 6: Full test run + end-to-end smoke**

Run: `pnpm test`
Expected: ALL Plan 1–3 tests green.

End-to-end smoke (with `docker compose up` for postgres/mailhog/scraper and `pnpm dev` + `pnpm worker`):
register → verify (MailHog) → login → set cities → paste playlist → confirm artists → `/shows` shows immediate matches → run `runPipeline` once (temporarily invoke via a one-off `tsx -e "import('@/lib/pipeline').then(m=>m.runPipeline()).then(console.log)"`) → check MailHog for an aggregated email.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(web): my upcoming shows page"
```

---

## Task 11: Compose the full stack & README

**Files:**
- Modify: `docker-compose.yml` (add web + worker services)
- Create: `Dockerfile`
- Create: `README.md`

**Interfaces:**
- Produces: `docker compose up` bringing up postgres, mailhog, scraper, web, worker together.

- [ ] **Step 1: Write root `Dockerfile` (shared by web + worker)**

```dockerfile
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm prisma generate && pnpm build

# web
FROM base AS web
EXPOSE 3000
CMD ["pnpm", "start"]

# worker
FROM base AS worker
CMD ["pnpm", "worker"]
```

- [ ] **Step 2: Add web + worker to `docker-compose.yml`**

Append under `services:`:
```yaml
  web:
    build: { context: ., target: web }
    env_file: .env
    environment:
      DATABASE_URL: "postgresql://showremind:showremind@postgres:5432/showremind?schema=public"
      SCRAPER_BASE_URL: "http://scraper:8001"
      SMTP_HOST: "mailhog"
    ports: ["3000:3000"]
    depends_on: [postgres, scraper, mailhog]

  worker:
    build: { context: ., target: worker }
    env_file: .env
    environment:
      DATABASE_URL: "postgresql://showremind:showremind@postgres:5432/showremind?schema=public"
      SCRAPER_BASE_URL: "http://scraper:8001"
      SMTP_HOST: "mailhog"
    depends_on: [postgres, scraper, mailhog]
```

- [ ] **Step 3: Write `README.md`**

```markdown
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
```

- [ ] **Step 4: Verify the compose build**

Run: `docker compose build web worker`
Expected: both images build. (Full `docker compose up` requires `.env` with a real `AUTH_SECRET`.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: dockerize web + worker and add README"
```

---

## Self-Review Notes

- **Spec coverage (Plan 3 slice):** register/login/verify (Task 7 = MVP §10), paste→select→follow (Task 8 = 流程①.3-4), immediate match on follow (Task 8/9 = 流程①.5), city management + manual artist (Task 9), scheduled crawl→match→notify (Tasks 3/5/6 = 流程②③), aggregated dedup email (Task 4 = 流程③.3 + §7 dedup), admin alert on 3 consecutive failures (Task 6 = §7), my shows page (Task 10). Failure reasons surfaced on the playlist page (Task 8 = §7 歌单解析失败).
- **Type consistency:** `ShowDetail` (Plan 2 scraper-client) drives `upsertShow` and the crawler. `Match`/`MatchArtist`/`MatchShow` (Plan 2 matcher) drive `persistMatches`, `matchNewShows`, `matchAllForUser`. `ArtistTally` (Plan 2) flows playlist tally → selection UI. `normalizeName` reused by `upsertArtist`.
- **Deferred/known-simplifications:** playlist resolve is synchronous in the Server Action (fine for small playlists; the spec's "后台任务" async path can be added later without interface change since `resolvePlaylist(playlistId)` is already separate). Consecutive-failure counter is in-process on the worker (resets on restart) — acceptable for MVP, noted. City codes in `lib/cities.ts` must be confirmed against Showstart during the Plan 1 live smoke.
- **Schema additions in this plan:** `VerificationToken` (Task 1) and `PlaylistTally` (Task 8) — both additive migrations; no existing Plan 1 table field changed.
- **Placeholder scan:** the only intentional "adjust during smoke" notes are the Showstart city codes and the qq/showstart signature confirmation, both inherited from Plan 1's documented smoke — not code placeholders.
```
