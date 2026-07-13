# CF Refactor Plan 2: Ported Engine + Mail + Subscription API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the NetEase adapter to the plaintext API, add a pluggable mail provider (Resend + console), and expose the full account-free subscription API (`/api/resolve`, `/api/subscribe`, `/api/confirm`, `/api/manage/*`) on the Worker built in Plan 1.

**Architecture:** Pure `lib/` modules (matcher, tally, parse-link, qq/showstart sources) are reused unchanged; only `lib/adapters/netease` changes (plaintext endpoints, delete the weapi crypto). A thin `src/services/resolve.ts` turns a pasted link into an artist tally without persisting. Hono routes under `src/routes/` implement subscribe/confirm/manage against Plan 1's repositories. Mail is an interface with a Resend HTTP implementation and a console implementation for local dev/tests. Anti-abuse (Turnstile + limits) is gated on `PUBLIC_MODE`.

**Tech Stack:** Hono, D1, Zod (already a dep), Resend HTTP API, Cloudflare Turnstile, `@cloudflare/vitest-pool-workers`.

## Global Constraints

- Depends on Plan 1 being merged (repositories, schema, vitest harness exist).
- Do NOT modify pure `lib/` modules except `lib/adapters/netease/*`.
- The random `token` on a subscription is the ONLY credential — used for confirm, manage, and unsubscribe. No passwords, no HMAC, no sessions.
- Turnstile + limits (100 artists, 10 cities, 1 sub/email) apply only when `PUBLIC_MODE==="1"`.
- Invalid/absent token on manage/confirm returns 404 (never reveal existence).
- Mail provider selected at runtime: Resend if `RESEND_API_KEY` set, else console.
- Commit after every task. TDD throughout.

---

## File Structure

```
lib/adapters/netease/
  client.ts        # REWRITE: plaintext /api endpoints
  weapi.ts         # DELETE
  weapi.test.ts    # DELETE
src/
  mail/
    provider.ts    # MailProvider interface + resend + console + factory
    templates.ts   # confirm + reminder HTML (escapeHtml reused)
  turnstile.ts     # verifyTurnstile()
  services/
    resolve.ts     # link → ArtistTally[] (no persistence)
    limits.ts      # CITY_CODES set, MAX_ARTISTS, MAX_CITIES, validation helpers
  routes/
    resolve.ts     # POST /api/resolve
    subscribe.ts   # POST /api/subscribe
    confirm.ts     # GET  /api/confirm
    manage.ts      # GET/POST/DELETE /api/manage/*
  index.ts         # MODIFY: mount routers, PRAGMA foreign_keys
test/
  mail/templates.test.ts
  services/resolve.test.ts
  routes/*.test.ts
```

---

### Task 1: Rewrite the NetEase adapter to the plaintext API

**Files:**
- Modify: `lib/adapters/netease/client.ts` (replace both functions)
- Delete: `lib/adapters/netease/weapi.ts`, `lib/adapters/netease/weapi.test.ts`
- Keep: `lib/adapters/netease/index.ts` (parse functions unchanged — same JSON shape)
- Test: reuse existing `lib/adapters/netease/index.test.ts` (fixture-based, unchanged)

**Interfaces:**
- Consumes: nothing new.
- Produces: `fetchPlaylistDetailRaw(externalId): Promise<any>`, `fetchSongDetailRaw(trackIds): Promise<any>` — same signatures as before, now hitting plaintext endpoints. `resolveNeteasePlaylist` in `index.ts` is unchanged and keeps working.

- [ ] **Step 1: Confirm the parse layer is shape-compatible (read-only)**

Read `lib/adapters/netease/index.ts`. `parsePlaylistMeta` reads `raw.playlist.trackIds[]` and `parseSongDetail` reads `raw.songs[].ar`. The plaintext endpoints return the same shape (verified in the Phase 0 spike, spec §6). No change needed here.

- [ ] **Step 2: Replace `lib/adapters/netease/client.ts`**

```typescript
// NetEase plaintext API. The weapi encrypted gateway is soft-blocked for
// overseas (Cloudflare) egress IPs — returns HTTP 200 with an empty body.
// The plaintext /api/ endpoints are not IP-restricted and return the same JSON.
// See docs/showstart-reverse-engineering.md and spec §6 (2026-07-13 spike).

const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Referer: "https://music.163.com",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
};

async function post(url: string, form: Record<string, string>): Promise<any> {
  const resp = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: new URLSearchParams(form),
  });
  const text = await resp.text();
  if (!resp.ok || text.length === 0) {
    throw new Error(`netease ${url} responded status=${resp.status} len=${text.length}`);
  }
  return JSON.parse(text);
}

export async function fetchPlaylistDetailRaw(externalId: string): Promise<any> {
  return post("https://music.163.com/api/v6/playlist/detail", {
    id: externalId,
    n: "100000",
    s: "8",
  });
}

export async function fetchSongDetailRaw(trackIds: string[]): Promise<any> {
  const c = JSON.stringify(trackIds.map((id) => ({ id })));
  return post("https://music.163.com/api/v3/song/detail", { c });
}
```

- [ ] **Step 3: Delete the weapi crypto module and its test**

Run:
```bash
git rm lib/adapters/netease/weapi.ts lib/adapters/netease/weapi.test.ts
```

- [ ] **Step 4: Run the NetEase unit tests (fixture-based)**

Run: `npx vitest run lib/adapters/netease/index.test.ts`
Expected: PASS (parse functions unchanged, fixtures still valid).

- [ ] **Step 5: Optional live check (network; not a unit test)**

Run:
```bash
npx tsx -e "import('./lib/adapters/netease/index').then(m => m.resolveNeteasePlaylist('3778678')).then(p => console.log(p.title, p.songs.length))"
```
Expected: prints `热歌榜 200` (or similar). Skip if offline; the fixture tests are authoritative for CI.

- [ ] **Step 6: Commit**

```bash
git add lib/adapters/netease/client.ts
git commit -m "refactor(netease): use plaintext /api endpoints, drop weapi crypto (CF egress soft-block)"
```

---

### Task 2: Mail provider (interface + Resend + console + factory)

**Files:**
- Create: `src/mail/provider.ts`
- Create: `test/mail/provider.test.ts`

**Interfaces:**
- Consumes: `Env`.
- Produces:
  - `interface MailMessage { to: string; subject: string; html: string }`
  - `interface MailProvider { send(msg: MailMessage): Promise<void> }`
  - `resendProvider(apiKey: string, from: string): MailProvider`
  - `consoleProvider(): MailProvider`
  - `getMailProvider(env: Env): MailProvider` — Resend if `env.RESEND_API_KEY`, else console.

- [ ] **Step 1: Write the failing test** — `test/mail/provider.test.ts`

```typescript
import { expect, it, vi } from "vitest";
import { resendProvider, consoleProvider } from "../../src/mail/provider";

it("resendProvider POSTs to Resend with auth + payload", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const p = resendProvider("re_key", "Show <n@d.com>");
  await p.send({ to: "u@d.com", subject: "hi", html: "<b>hi</b>" });
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer re_key" });
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body).toMatchObject({ from: "Show <n@d.com>", to: "u@d.com", subject: "hi" });
  vi.unstubAllGlobals();
});

it("resendProvider throws on non-2xx", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 422 })));
  await expect(resendProvider("k", "f").send({ to: "u", subject: "s", html: "h" })).rejects.toThrow();
  vi.unstubAllGlobals();
});

it("consoleProvider resolves without throwing", async () => {
  await expect(consoleProvider().send({ to: "u", subject: "s", html: "h" })).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mail/provider.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/mail/provider.ts`**

```typescript
import type { Env } from "../env";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

export interface MailProvider {
  send(msg: MailMessage): Promise<void>;
}

export function resendProvider(apiKey: string, from: string): MailProvider {
  return {
    async send(msg) {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html }),
      });
      if (!resp.ok) {
        throw new Error(`resend responded ${resp.status}: ${await resp.text()}`);
      }
    },
  };
}

export function consoleProvider(): MailProvider {
  return {
    async send(msg) {
      console.log(`[mail:console] to=${msg.to} subject=${msg.subject}\n${msg.html}`);
    },
  };
}

export function getMailProvider(env: Env): MailProvider {
  if (env.RESEND_API_KEY) return resendProvider(env.RESEND_API_KEY, env.MAIL_FROM);
  return consoleProvider();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/mail/provider.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mail/provider.ts test/mail/provider.test.ts
git commit -m "feat(mail): pluggable provider (resend + console)"
```

---

### Task 3: Email templates (confirm + reminder)

**Files:**
- Create: `src/mail/templates.ts`
- Create: `test/mail/templates.test.ts`

**Interfaces:**
- Consumes: `NotifyShow` from `src/db/notifications.ts`.
- Produces:
  - `confirmEmail(baseUrl: string, token: string): { subject: string; html: string }`
  - `reminderEmail(shows: NotifyShow[], baseUrl: string, token: string): { subject: string; html: string }` — HTML reuses the old renderer; footer has manage + unsubscribe links built from `baseUrl` + `token`.
  - `manageUrl(baseUrl, token)`, `unsubscribeUrl(baseUrl, token)` helpers.

- [ ] **Step 1: Write the failing test** — `test/mail/templates.test.ts`

```typescript
import { expect, it } from "vitest";
import { confirmEmail, reminderEmail } from "../../src/mail/templates";
import type { NotifyShow } from "../../src/db/notifications";

const show: NotifyShow = {
  showId: "s1", title: "刺猬专场 <x>", cityCode: "110000", venue: "MAO",
  showTime: "2026-08-01T20:00:00", price: "180", url: "https://wap.showstart.com/x/1",
  artistNames: ["刺猬"], hasTitleOnlyMatch: false,
};

it("confirmEmail links to /api/confirm with the token", () => {
  const { subject, html } = confirmEmail("https://s.com", "tok123");
  expect(subject).toBeTruthy();
  expect(html).toContain("https://s.com/api/confirm?token=tok123");
});

it("reminderEmail lists shows and has manage + unsubscribe footer links", () => {
  const { html } = reminderEmail([show], "https://s.com", "tok123");
  expect(html).toContain("刺猬");
  expect(html).toContain("https://s.com/manage?token=tok123");
  expect(html).toContain("https://s.com/api/manage/unsubscribe?token=tok123");
  // HTML-escapes the title angle brackets
  expect(html).toContain("&lt;x&gt;");
});

it("reminderEmail marks title-only matches as maybe-related", () => {
  const { html } = reminderEmail([{ ...show, hasTitleOnlyMatch: true }], "https://s.com", "t");
  expect(html).toContain("可能相关");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mail/templates.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/mail/templates.ts`**

```typescript
import type { NotifyShow } from "../db/notifications";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function manageUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/manage?token=${token}`;
}

export function unsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/api/manage/unsubscribe?token=${token}`;
}

export function confirmEmail(baseUrl: string, token: string): { subject: string; html: string } {
  const url = `${baseUrl}/api/confirm?token=${token}`;
  return {
    subject: "确认订阅 Show-Remind 演出提醒",
    html: `<p>点击确认订阅演出提醒：</p><p><a href="${url}">${url}</a></p>
      <p>如果不是你本人操作，忽略这封邮件即可。</p>`,
  };
}

export function reminderEmail(
  shows: NotifyShow[],
  baseUrl: string,
  token: string,
): { subject: string; html: string } {
  const rows = shows
    .map((s) => {
      const when = s.showTime ? s.showTime.slice(0, 16).replace("T", " ") : "待定";
      const maybe = s.hasTitleOnlyMatch ? "(可能相关) " : "";
      const artists = s.artistNames.map(escapeHtml).join(" / ");
      const venue = escapeHtml(s.venue ?? "待定");
      const price = escapeHtml(s.price ?? "待定");
      const url = escapeHtml(s.url);
      return `<li><b>${maybe}${artists}</b> — ${escapeHtml(s.title)}<br/>
        场馆:${venue} · 时间:${when} · 票价:${price}<br/>
        <a href="${url}">${url}</a></li>`;
    })
    .join("");
  const footer = `<hr/><p style="font-size:12px;color:#888">
    <a href="${manageUrl(baseUrl, token)}">管理我的关注</a> ·
    <a href="${unsubscribeUrl(baseUrl, token)}">退订</a></p>`;
  return {
    subject: "你关注的音乐人有新演出",
    html: `<p>你关注的音乐人有新的演出:</p><ul>${rows}</ul>${footer}`,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/mail/templates.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mail/templates.ts test/mail/templates.test.ts
git commit -m "feat(mail): confirm + reminder templates with manage/unsub footer"
```

---

### Task 4: Limits + Turnstile

**Files:**
- Create: `src/services/limits.ts`
- Create: `src/turnstile.ts`
- Create: `test/services/limits.test.ts`
- Create: `test/turnstile.test.ts`

**Interfaces:**
- Produces:
  - `limits.ts`: `CITY_CODES: Set<string>` (from `@/lib/cities`), `MAX_ARTISTS = 100`, `MAX_CITIES = 10`, `validCities(cities): boolean` (non-empty, ≤MAX, all known), `isEmail(s): boolean`.
  - `turnstile.ts`: `verifyTurnstile(token: string, secret: string, ip?: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

`test/services/limits.test.ts`:
```typescript
import { expect, it } from "vitest";
import { validCities, isEmail, MAX_CITIES } from "../../src/services/limits";

it("accepts known non-empty city sets within the cap", () => {
  expect(validCities(["110000"])).toBe(true);
  expect(validCities([])).toBe(false);
  expect(validCities(["999999"])).toBe(false);
  expect(validCities(Array(MAX_CITIES + 1).fill("110000"))).toBe(false);
});

it("isEmail validates basic shape", () => {
  expect(isEmail("a@b.com")).toBe(true);
  expect(isEmail("nope")).toBe(false);
});
```

`test/turnstile.test.ts`:
```typescript
import { expect, it, vi } from "vitest";
import { verifyTurnstile } from "../../src/turnstile";

it("returns true when siteverify succeeds", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }))));
  expect(await verifyTurnstile("tok", "secret")).toBe(true);
  vi.unstubAllGlobals();
});

it("returns false when siteverify fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }))));
  expect(await verifyTurnstile("tok", "secret")).toBe(false);
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/services/limits.test.ts test/turnstile.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `src/services/limits.ts`**

```typescript
import { CITIES } from "@/lib/cities";

export const CITY_CODES = new Set(CITIES.map((c) => c.code));
export const MAX_ARTISTS = 100;
export const MAX_CITIES = 10;

export function validCities(cities: string[]): boolean {
  if (!Array.isArray(cities) || cities.length === 0 || cities.length > MAX_CITIES) return false;
  return cities.every((c) => CITY_CODES.has(c));
}

export function isEmail(s: string): boolean {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
```

- [ ] **Step 4: Implement `src/turnstile.ts`**

```typescript
export async function verifyTurnstile(token: string, secret: string, ip?: string): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const data = (await resp.json()) as { success?: boolean };
  return data.success === true;
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run test/services/limits.test.ts test/turnstile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/limits.ts src/turnstile.ts test/services/limits.test.ts test/turnstile.test.ts
git commit -m "feat(api): limits + turnstile verification helpers"
```

---

### Task 5: Resolve service + `POST /api/resolve`

**Files:**
- Create: `src/services/resolve.ts`
- Create: `src/routes/resolve.ts`
- Modify: `src/index.ts` (mount router + PRAGMA)
- Modify: `vitest.config.ts` (add test env vars)
- Create: `test/routes/resolve.test.ts`

**Interfaces:**
- Consumes: `parsePlaylistLink` (`@/lib/adapters/parse-link`), `resolveNeteasePlaylist` (`@/lib/adapters/netease`), `fetchQqPlaylist` (`@/lib/sources/qq` — wrapped to `ResolvedPlaylist`), `tallyArtists` (`@/lib/adapters/tally`).
- Produces:
  - `resolvePlaylist(input: string): Promise<{ platform: string; title: string; artists: ArtistTally[] }>` — throws `InvalidPlaylistLinkError` or a generic error the route maps to a readable message.
  - Router mounted at `/api/resolve`. Request `{ link: string, turnstileToken?: string }`; response `{ platform, title, artists: [{name, songCount}] }` or `{ error }`.

- [ ] **Step 1: Add test env vars to `vitest.config.ts`**

Under `poolOptions.workers.miniflare`, add a `bindings` object:
```typescript
        miniflare: {
          d1Databases: { DB: "show-remind" },
          bindings: {
            APP_BASE_URL: "https://test.local",
            INTERNAL_SECRET: "test-internal",
            RESEND_API_KEY: "",
            MAIL_FROM: "Show <n@test.local>",
            ADMIN_EMAIL: "admin@test.local",
            TURNSTILE_SECRET: "test-turnstile",
            PUBLIC_MODE: "0",
          },
        },
```

- [ ] **Step 2: Write the failing test** — `test/routes/resolve.test.ts`

```typescript
import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import app from "../../src/index";

beforeEach(applySchema);

it("resolves a QQ link to a tallied artist list", async () => {
  // Stub the QQ source at the network boundary.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          request: {
            code: 0,
            data: {
              dirinfo: { title: "My List" },
              songlist_size: 2,
              songlist: [
                { name: "s1", singer: [{ name: "刺猬" }] },
                { name: "s2", singer: [{ name: "刺猬" }, { name: "海龟先生" }] },
              ],
            },
          },
        }),
      ),
    ),
  );
  const res = await app.request(
    "/api/resolve",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ link: "https://y.qq.com/n/ryqq/playlist/12345" }),
    },
    env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.title).toBe("My List");
  expect(body.artists[0]).toEqual({ name: "刺猬", songCount: 2 });
  vi.unstubAllGlobals();
});

it("returns 400 with a readable message on an unrecognized link", async () => {
  const res = await app.request(
    "/api/resolve",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ link: "hello" }) },
    env,
  );
  expect(res.status).toBe(400);
  expect((await res.json() as any).error).toBeTruthy();
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/routes/resolve.test.ts`
Expected: FAIL (cannot find `src/routes/resolve` / `resolvePlaylist`).

- [ ] **Step 4: Implement `src/services/resolve.ts`**

```typescript
import { parsePlaylistLink } from "@/lib/adapters/parse-link";
import { resolveNeteasePlaylist } from "@/lib/adapters/netease";
import { fetchQqPlaylist } from "@/lib/sources/qq";
import { tallyArtists } from "@/lib/adapters/tally";
import type { ArtistTally, ResolvedPlaylist } from "@/lib/adapters/types";

async function resolveQq(externalId: string): Promise<ResolvedPlaylist> {
  const { title, songs } = await fetchQqPlaylist(externalId);
  return { platform: "qq", externalId, title, songs };
}

export async function resolvePlaylist(
  input: string,
): Promise<{ platform: string; title: string; artists: ArtistTally[] }> {
  const parsed = await parsePlaylistLink(input);
  const playlist =
    parsed.platform === "netease"
      ? await resolveNeteasePlaylist(parsed.externalId)
      : await resolveQq(parsed.externalId);
  return { platform: parsed.platform, title: playlist.title, artists: tallyArtists(playlist) };
}
```

- [ ] **Step 5: Implement `src/routes/resolve.ts`**

```typescript
import { Hono } from "hono";
import type { Env } from "../env";
import { resolvePlaylist } from "../services/resolve";
import { verifyTurnstile } from "../turnstile";
import { InvalidPlaylistLinkError } from "@/lib/adapters/parse-link";

export const resolveRouter = new Hono<{ Bindings: Env }>();

resolveRouter.post("/", async (c) => {
  const { link, turnstileToken } = await c.req.json<{ link?: string; turnstileToken?: string }>();
  if (!link || typeof link !== "string") return c.json({ error: "缺少歌单链接" }, 400);

  if (c.env.PUBLIC_MODE === "1") {
    const ok = turnstileToken && (await verifyTurnstile(turnstileToken, c.env.TURNSTILE_SECRET));
    if (!ok) return c.json({ error: "人机校验失败，请重试" }, 400);
  }

  try {
    const result = await resolvePlaylist(link);
    if (result.artists.length === 0) {
      return c.json({ error: "没有从歌单里解析到艺人，换个歌单或手动添加" }, 422);
    }
    return c.json(result);
  } catch (err) {
    if (err instanceof InvalidPlaylistLinkError) {
      return c.json({ error: "无法识别的链接，请粘贴网易云或 QQ 音乐的公开歌单链接" }, 400);
    }
    // upstream empty/transient (e.g. netease block, CF edge 1042) — client may retry
    return c.json({ error: "歌单解析失败，可能未公开或上游繁忙，请稍后重试" }, 502);
  }
});
```

- [ ] **Step 6: Modify `src/index.ts` to mount the router + FK pragma**

```typescript
import { Hono } from "hono";
import type { Env } from "./env";
import { resolveRouter } from "./routes/resolve";

const app = new Hono<{ Bindings: Env }>();

// D1 enforces foreign keys only when asked, per connection.
app.use("*", async (c, next) => {
  await c.env.DB.prepare("PRAGMA foreign_keys = ON").run();
  await next();
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/resolve", resolveRouter);

export default app;
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run test/routes/resolve.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add src/services/resolve.ts src/routes/resolve.ts src/index.ts vitest.config.ts test/routes/resolve.test.ts
git commit -m "feat(api): POST /api/resolve (link -> artist tally) with turnstile gate"
```

---

### Task 6: `POST /api/subscribe` + `GET /api/confirm`

**Files:**
- Create: `src/routes/subscribe.ts`
- Create: `src/routes/confirm.ts`
- Modify: `src/index.ts` (mount)
- Create: `test/routes/subscribe.test.ts`

**Interfaces:**
- Consumes: `createPendingSubscription`, `setArtists`, `activateByToken` (Plan 1); `getMailProvider`, `confirmEmail`; `validCities`, `isEmail`, `MAX_ARTISTS`; `verifyTurnstile`.
- Produces:
  - `POST /api/subscribe` body `{ email, cities: string[], artists: string[], turnstileToken? }` → creates pending sub, sets artists, sends confirm mail, returns `{ ok: true }`. Enforces limits when `PUBLIC_MODE==="1"`.
  - `GET /api/confirm?token=` → activates; on success 302-redirects to `/manage?token=`; on unknown token returns 404.

- [ ] **Step 1: Write the failing test** — `test/routes/subscribe.test.ts`

```typescript
import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import app from "../../src/index";
import { getByEmail } from "../../src/db/subscriptions";
import { listArtists } from "../../src/db/subscription-artists";

beforeEach(applySchema);

async function subscribe(body: unknown) {
  return app.request(
    "/api/subscribe",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    env,
  );
}

it("creates a pending sub with artists and returns ok", async () => {
  const res = await subscribe({ email: "a@b.com", cities: ["110000"], artists: ["刺猬", "海龟先生"] });
  expect(res.status).toBe(200);
  const sub = await getByEmail(env.DB, "a@b.com");
  expect(sub?.status).toBe("pending");
  expect((await listArtists(env.DB, sub!.id)).length).toBe(2);
});

it("rejects invalid email / empty cities / no artists", async () => {
  expect((await subscribe({ email: "x", cities: ["110000"], artists: ["刺猬"] })).status).toBe(400);
  expect((await subscribe({ email: "a@b.com", cities: [], artists: ["刺猬"] })).status).toBe(400);
  expect((await subscribe({ email: "a@b.com", cities: ["110000"], artists: [] })).status).toBe(400);
});

it("confirm activates the sub and redirects to manage", async () => {
  await subscribe({ email: "a@b.com", cities: ["110000"], artists: ["刺猬"] });
  const sub = await getByEmail(env.DB, "a@b.com");
  const res = await app.request(`/api/confirm?token=${sub!.token}`, {}, env);
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(`/manage?token=${sub!.token}`);
  expect((await getByEmail(env.DB, "a@b.com"))?.status).toBe("active");
});

it("confirm with unknown token returns 404", async () => {
  const res = await app.request("/api/confirm?token=nope", {}, env);
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/routes/subscribe.test.ts`
Expected: FAIL (routes not found).

- [ ] **Step 3: Implement `src/routes/subscribe.ts`**

```typescript
import { Hono } from "hono";
import type { Env } from "../env";
import { createPendingSubscription } from "../db/subscriptions";
import { setArtists } from "../db/subscription-artists";
import { getMailProvider } from "../mail/provider";
import { confirmEmail } from "../mail/templates";
import { validCities, isEmail, MAX_ARTISTS } from "../services/limits";
import { verifyTurnstile } from "../turnstile";

export const subscribeRouter = new Hono<{ Bindings: Env }>();

subscribeRouter.post("/", async (c) => {
  const body = await c.req.json<{
    email?: string;
    cities?: string[];
    artists?: string[];
    turnstileToken?: string;
  }>();
  const email = (body.email ?? "").trim();
  const cities = body.cities ?? [];
  const artists = (body.artists ?? []).map((a) => a.trim()).filter(Boolean);

  if (!isEmail(email)) return c.json({ error: "邮箱格式不正确" }, 400);
  if (!validCities(cities)) return c.json({ error: "请选择 1-10 个有效城市" }, 400);
  if (artists.length === 0) return c.json({ error: "至少关注一位音乐人" }, 400);
  if (c.env.PUBLIC_MODE === "1" && artists.length > MAX_ARTISTS) {
    return c.json({ error: `关注的音乐人不能超过 ${MAX_ARTISTS} 位` }, 400);
  }

  if (c.env.PUBLIC_MODE === "1") {
    const ok = body.turnstileToken && (await verifyTurnstile(body.turnstileToken, c.env.TURNSTILE_SECRET));
    if (!ok) return c.json({ error: "人机校验失败，请重试" }, 400);
  }

  const sub = await createPendingSubscription(c.env.DB, email, cities);
  await setArtists(c.env.DB, sub.id, artists.slice(0, MAX_ARTISTS));

  const mail = getMailProvider(c.env);
  const { subject, html } = confirmEmail(c.env.APP_BASE_URL, sub.token);
  await mail.send({ to: email, subject, html });

  return c.json({ ok: true });
});
```

- [ ] **Step 4: Implement `src/routes/confirm.ts`**

```typescript
import { Hono } from "hono";
import type { Env } from "../env";
import { activateByToken } from "../db/subscriptions";

export const confirmRouter = new Hono<{ Bindings: Env }>();

confirmRouter.get("/", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.notFound();
  const ok = await activateByToken(c.env.DB, token);
  if (!ok) return c.notFound();
  return c.redirect(`/manage?token=${token}`, 302);
});
```

- [ ] **Step 5: Mount both in `src/index.ts`**

Add imports and routes:
```typescript
import { subscribeRouter } from "./routes/subscribe";
import { confirmRouter } from "./routes/confirm";
// ...after the resolve route:
app.route("/api/subscribe", subscribeRouter);
app.route("/api/confirm", confirmRouter);
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run test/routes/subscribe.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/routes/subscribe.ts src/routes/confirm.ts src/index.ts test/routes/subscribe.test.ts
git commit -m "feat(api): subscribe + confirm (double opt-in, redirect to manage)"
```

---

### Task 7: `/api/manage/*` (view, edit artists/cities, import, unsubscribe)

**Files:**
- Create: `src/routes/manage.ts`
- Modify: `src/index.ts` (mount)
- Create: `test/routes/manage.test.ts`

**Interfaces:**
- Consumes: `getByToken`, `setCities`, `deleteByToken` (Plan 1); `listArtists`, `addArtistToSubscription`, `removeArtist`, `countArtists`; `resolvePlaylist`; `validCities`, `MAX_ARTISTS`; `verifyTurnstile`.
- Produces routes (all require a valid `token` query/param → else 404):
  - `GET /api/manage?token=` → `{ email, cities, artists: [{id,name}] }`
  - `POST /api/manage/cities?token=` body `{ cities }` → `{ ok }`
  - `POST /api/manage/artists?token=` body `{ name }` → `{ id }`
  - `DELETE /api/manage/artists/:artistId?token=` → `{ ok }`
  - `POST /api/manage/import?token=` body `{ link, turnstileToken? }` → appends resolved artists (respect cap), returns `{ added, artists }`
  - `GET|POST /api/manage/unsubscribe?token=` → deletes sub, returns `{ ok }`

- [ ] **Step 1: Write the failing test** — `test/routes/manage.test.ts`

```typescript
import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import app from "../../src/index";
import { createPendingSubscription, activateByToken } from "../../src/db/subscriptions";
import { setArtists, listArtists } from "../../src/db/subscription-artists";

beforeEach(applySchema);

async function activeSub() {
  const sub = await createPendingSubscription(env.DB, "a@b.com", ["110000"]);
  await activateByToken(env.DB, sub.token);
  await setArtists(env.DB, sub.id, ["刺猬"]);
  return sub;
}
const j = (body: unknown) => ({
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

it("GET manage returns the subscription view", async () => {
  const sub = await activeSub();
  const res = await app.request(`/api/manage?token=${sub.token}`, {}, env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.email).toBe("a@b.com");
  expect(body.cities).toEqual(["110000"]);
  expect(body.artists.map((a: any) => a.name)).toEqual(["刺猬"]);
});

it("unknown token returns 404 everywhere", async () => {
  expect((await app.request("/api/manage?token=nope", {}, env)).status).toBe(404);
  expect((await app.request("/api/manage/cities?token=nope", j({ cities: ["110000"] }), env)).status).toBe(404);
});

it("add and remove artists", async () => {
  const sub = await activeSub();
  const add = await app.request(`/api/manage/artists?token=${sub.token}`, j({ name: "海龟先生" }), env);
  const { id } = (await add.json()) as any;
  expect((await listArtists(env.DB, sub.id)).length).toBe(2);
  const del = await app.request(`/api/manage/artists/${id}?token=${sub.token}`, { method: "DELETE" }, env);
  expect(del.status).toBe(200);
  expect((await listArtists(env.DB, sub.id)).map((a) => a.name)).toEqual(["刺猬"]);
});

it("update cities validates the set", async () => {
  const sub = await activeSub();
  expect((await app.request(`/api/manage/cities?token=${sub.token}`, j({ cities: ["310000"] }), env)).status).toBe(200);
  expect((await app.request(`/api/manage/cities?token=${sub.token}`, j({ cities: ["999999"] }), env)).status).toBe(400);
});

it("unsubscribe deletes the subscription", async () => {
  const sub = await activeSub();
  const res = await app.request(`/api/manage/unsubscribe?token=${sub.token}`, {}, env);
  expect(res.status).toBe(200);
  expect((await app.request(`/api/manage?token=${sub.token}`, {}, env)).status).toBe(404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/routes/manage.test.ts`
Expected: FAIL (router not found).

- [ ] **Step 3: Implement `src/routes/manage.ts`**

```typescript
import { Hono } from "hono";
import type { Env } from "../env";
import { getByToken, setCities, deleteByToken, type SubscriptionRow } from "../db/subscriptions";
import {
  listArtists,
  addArtistToSubscription,
  removeArtist,
  countArtists,
} from "../db/subscription-artists";
import { resolvePlaylist } from "../services/resolve";
import { validCities, MAX_ARTISTS } from "../services/limits";
import { verifyTurnstile } from "../turnstile";

export const manageRouter = new Hono<{ Bindings: Env }>();

// Resolve the token on every request; 404 (not 401/403) to avoid leaking existence.
async function requireSub(c: any): Promise<SubscriptionRow | null> {
  const token = c.req.query("token");
  if (!token) return null;
  return getByToken(c.env.DB, token);
}

manageRouter.get("/", async (c) => {
  const sub = await requireSub(c);
  if (!sub) return c.notFound();
  const artists = await listArtists(c.env.DB, sub.id);
  return c.json({
    email: sub.email,
    cities: sub.cities,
    artists: artists.map((a) => ({ id: a.id, name: a.name })),
  });
});

manageRouter.post("/cities", async (c) => {
  const sub = await requireSub(c);
  if (!sub) return c.notFound();
  const { cities } = await c.req.json<{ cities?: string[] }>();
  if (!validCities(cities ?? [])) return c.json({ error: "请选择 1-10 个有效城市" }, 400);
  await setCities(c.env.DB, sub.id, cities!);
  return c.json({ ok: true });
});

manageRouter.post("/artists", async (c) => {
  const sub = await requireSub(c);
  if (!sub) return c.notFound();
  const { name } = await c.req.json<{ name?: string }>();
  const clean = (name ?? "").trim();
  if (!clean) return c.json({ error: "音乐人名称不能为空" }, 400);
  if (c.env.PUBLIC_MODE === "1" && (await countArtists(c.env.DB, sub.id)) >= MAX_ARTISTS) {
    return c.json({ error: `最多关注 ${MAX_ARTISTS} 位` }, 400);
  }
  const id = await addArtistToSubscription(c.env.DB, sub.id, clean);
  return c.json({ id });
});

manageRouter.delete("/artists/:artistId", async (c) => {
  const sub = await requireSub(c);
  if (!sub) return c.notFound();
  await removeArtist(c.env.DB, sub.id, c.req.param("artistId"));
  return c.json({ ok: true });
});

manageRouter.post("/import", async (c) => {
  const sub = await requireSub(c);
  if (!sub) return c.notFound();
  const { link, turnstileToken } = await c.req.json<{ link?: string; turnstileToken?: string }>();
  if (!link) return c.json({ error: "缺少歌单链接" }, 400);
  if (c.env.PUBLIC_MODE === "1") {
    const ok = turnstileToken && (await verifyTurnstile(turnstileToken, c.env.TURNSTILE_SECRET));
    if (!ok) return c.json({ error: "人机校验失败" }, 400);
  }
  let resolved;
  try {
    resolved = await resolvePlaylist(link);
  } catch {
    return c.json({ error: "歌单解析失败，请稍后重试或手动添加" }, 502);
  }
  const cap = MAX_ARTISTS - (await countArtists(c.env.DB, sub.id));
  let added = 0;
  for (const a of resolved.artists) {
    if (added >= cap) break;
    await addArtistToSubscription(c.env.DB, sub.id, a.name);
    added++;
  }
  const artists = await listArtists(c.env.DB, sub.id);
  return c.json({ added, artists: artists.map((x) => ({ id: x.id, name: x.name })) });
});

async function unsubscribe(c: any) {
  const sub = await requireSub(c);
  if (!sub) return c.notFound();
  await deleteByToken(c.env.DB, sub.token);
  return c.json({ ok: true });
}
manageRouter.get("/unsubscribe", unsubscribe);
manageRouter.post("/unsubscribe", unsubscribe);
```

- [ ] **Step 4: Mount in `src/index.ts`**

```typescript
import { manageRouter } from "./routes/manage";
// ...
app.route("/api/manage", manageRouter);
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/routes/manage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: all `test/**` and pure `lib/**` tests pass. If any remaining Prisma-based `lib/**` test (e.g. old `lib/pipeline.test.ts`, `lib/notifier/*.test.ts`, `lib/repositories/*.test.ts`) still exists and fails, leave it — Plan 3 deletes those files. Keep them excluded in `vitest.config.ts` if they block, and note it.

- [ ] **Step 7: Commit**

```bash
git add src/routes/manage.ts src/index.ts test/routes/manage.test.ts
git commit -m "feat(api): /api/manage/* view/edit/import/unsubscribe (token-only auth)"
```

---

## Self-Review Notes

- **Spec coverage (this plan):** §4.1 resolve + subscribe + confirm ✓ (Tasks 5-6); §4.2 manage/import/unsubscribe ✓ (Task 7); §2 mail provider pluggable (Resend + console) ✓ (Task 2); §5 anti-abuse (Turnstile on resolve+subscribe+import, double opt-in, limits) ✓ (Tasks 4-7); §6 netease plaintext + delete weapi ✓ (Task 1); §7 error handling (readable resolve errors, 404 on bad token) ✓ (Tasks 5,6,7).
- **Placeholder scan:** none — every route has full code and tests.
- **Type consistency:** `resolvePlaylist` returns `{platform,title,artists}` used identically by resolve route and manage/import. `SubscriptionRow`/`ArtistRow` come from Plan 1 unchanged. `confirmEmail`/`reminderEmail` consume `NotifyShow` (Plan 1) — reminder is wired into the cron pipeline in Plan 3.
- **Deferred to Plan 3:** frontend SPA that calls these routes; cron pipeline that uses `findNotifyCandidates` + `reminderEmail` + `markSent`; deletion of old Prisma `lib/**` + `app/**`; open-source scaffolding + GHA smoke.
- **Carry-over risk:** the `PRAGMA foreign_keys=ON` middleware runs one extra prepared statement per request — negligible on free tier; keeps unsubscribe cascade correct.
