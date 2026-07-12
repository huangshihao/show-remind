# Show-Remind Plan 2: Node lib/ Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure Node `lib/` engine — resolve a playlist link into artists (netease natively, QQ via the scraper), and match artists against shows — all unit-tested without a database or UI.

**Architecture:** Consumes Plan 1's frozen scraper HTTP contract. Netease weapi crypto is vendored (no runtime dependency on the archived package). QQ and Showstart go through a zod-validated `scraper-client`. The `matcher` is a pure function — the most heavily tested unit.

**Tech Stack:** TypeScript, zod, Node `node:crypto`, Vitest. No new services.

**Prerequisite:** Plan 1 complete (repo, tooling, Prisma schema, running scraper on `SCRAPER_BASE_URL`).

## Global Constraints

- All modules under `lib/` are pure/stateless (no Prisma imports in Plan 2). Persistence lands in Plan 3.
- Platform values exactly `"netease"` | `"qq"`. `matchedBy` values exactly `"performer"` | `"title"`.
- zod schemas in `lib/scraper-client.ts` must mirror Plan 1's scraper contract field-for-field.
- Fragile network code (netease HTTP, scraper HTTP) is isolated behind functions/objects tests can mock; transforms are pure and fixture-tested.
- `normalizeName` is the single normalization used everywhere (artist persistence in Plan 3 imports it from here).
- Conventional Commits.

---

## Frozen Contract: lib types (Plans 3 consumes these)

```ts
// lib/adapters/types.ts
export type PlatformId = "netease" | "qq";
export interface ResolvedSong { name: string; artists: string[]; }
export interface ResolvedPlaylist {
  platform: PlatformId;
  externalId: string;
  title: string;
  songs: ResolvedSong[];
}
export interface ArtistTally { name: string; songCount: number; }

// lib/matcher/index.ts
export interface MatchArtist { id: string; name: string; normalizedName: string; aliases: string[]; }
export interface MatchShow { id: string; title: string; performers: string[]; }
export interface Match { showId: string; artistId: string; matchedBy: "performer" | "title"; }
```

---

## Task 1: Adapter types, normalization, artist tally

**Files:**
- Create: `lib/adapters/types.ts`
- Create: `lib/matcher/normalize.ts`
- Create: `lib/adapters/tally.ts`
- Test: `lib/matcher/normalize.test.ts`, `lib/adapters/tally.test.ts`

**Interfaces:**
- Produces: types above; `normalizeName(raw: string): string`; `tallyArtists(playlist: ResolvedPlaylist): ArtistTally[]` sorted by songCount desc, then name asc.

- [ ] **Step 1: Write failing tests**

`lib/matcher/normalize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeName } from "./normalize";

describe("normalizeName", () => {
  it("lowercases and trims", () => {
    expect(normalizeName("  Radiohead  ")).toBe("radiohead");
  });
  it("collapses internal whitespace", () => {
    expect(normalizeName("New\t Order")).toBe("new order");
  });
  it("converts fullwidth to halfwidth", () => {
    expect(normalizeName("ＡＢＣ１２３")).toBe("abc123");
  });
  it("treats ideographic space as space", () => {
    expect(normalizeName("万能　青年")).toBe("万能 青年");
  });
});
```

`lib/adapters/tally.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tallyArtists } from "./tally";
import type { ResolvedPlaylist } from "./types";

const pl: ResolvedPlaylist = {
  platform: "netease",
  externalId: "1",
  title: "t",
  songs: [
    { name: "a", artists: ["万能青年旅店"] },
    { name: "b", artists: ["万能青年旅店", "重塑雕像的权利"] },
    { name: "c", artists: ["重塑雕像的权利"] },
    { name: "d", artists: ["重塑雕像的权利"] },
  ],
};

describe("tallyArtists", () => {
  it("counts songs per artist and sorts desc then name asc", () => {
    expect(tallyArtists(pl)).toEqual([
      { name: "重塑雕像的权利", songCount: 3 },
      { name: "万能青年旅店", songCount: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test lib/matcher/normalize.test.ts lib/adapters/tally.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write the implementations**

`lib/adapters/types.ts`:
```ts
export type PlatformId = "netease" | "qq";

export interface ResolvedSong {
  name: string;
  artists: string[];
}

export interface ResolvedPlaylist {
  platform: PlatformId;
  externalId: string;
  title: string;
  songs: ResolvedSong[];
}

export interface ArtistTally {
  name: string;
  songCount: number;
}
```

`lib/matcher/normalize.ts`:
```ts
export function normalizeName(raw: string): string {
  return raw
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
```

`lib/adapters/tally.ts`:
```ts
import type { ArtistTally, ResolvedPlaylist } from "./types";
import { normalizeName } from "@/lib/matcher/normalize";

export function tallyArtists(playlist: ResolvedPlaylist): ArtistTally[] {
  const counts = new Map<string, { name: string; songCount: number }>();
  for (const song of playlist.songs) {
    const seen = new Set<string>();
    for (const artist of song.artists) {
      const key = normalizeName(artist);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const existing = counts.get(key);
      if (existing) existing.songCount += 1;
      else counts.set(key, { name: artist, songCount: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.songCount - a.songCount || a.name.localeCompare(b.name),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test lib/matcher/normalize.test.ts lib/adapters/tally.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(lib): adapter types, name normalization, artist tally"
```

---

## Task 2: Playlist link parser

**Files:**
- Create: `lib/adapters/parse-link.ts`
- Test: `lib/adapters/parse-link.test.ts`

**Interfaces:**
- Produces: `parsePlaylistLink(input: string): Promise<{ platform: PlatformId; externalId: string }>`. Throws `InvalidPlaylistLinkError` when unrecognized. Expands `163cn.tv` short links via a `fetch` HEAD/GET redirect (isolated as `resolveShortLink`, mockable).

- [ ] **Step 1: Write failing tests**

`lib/adapters/parse-link.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { parsePlaylistLink, InvalidPlaylistLinkError } from "./parse-link";

describe("parsePlaylistLink", () => {
  it("parses netease full share link", async () => {
    const r = await parsePlaylistLink("https://music.163.com/playlist?id=123456&userid=1");
    expect(r).toEqual({ platform: "netease", externalId: "123456" });
  });
  it("parses netease /#/ hash link and app share text", async () => {
    const r = await parsePlaylistLink("分享歌单: https://music.163.com/#/playlist?id=789");
    expect(r).toEqual({ platform: "netease", externalId: "789" });
  });
  it("parses qq share link with id param", async () => {
    const r = await parsePlaylistLink("https://y.qq.com/n/ryqq/playlist/9527");
    expect(r).toEqual({ platform: "qq", externalId: "9527" });
  });
  it("parses qq link with ?id=", async () => {
    const r = await parsePlaylistLink("https://i.y.qq.com/n2/m/share/details/taoge.html?id=8888");
    expect(r).toEqual({ platform: "qq", externalId: "8888" });
  });
  it("throws on unrecognized input", async () => {
    await expect(parsePlaylistLink("https://example.com/x")).rejects.toBeInstanceOf(
      InvalidPlaylistLinkError,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test lib/adapters/parse-link.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/adapters/parse-link.ts`**

```ts
import type { PlatformId } from "./types";

export class InvalidPlaylistLinkError extends Error {
  constructor(input: string) {
    super(`Unrecognized playlist link: ${input}`);
    this.name = "InvalidPlaylistLinkError";
  }
}

export interface ParsedLink {
  platform: PlatformId;
  externalId: string;
}

function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/);
  return m ? m[0] : null;
}

export async function resolveShortLink(url: string): Promise<string> {
  const resp = await fetch(url, { redirect: "follow", method: "GET" });
  return resp.url || url;
}

function tryParse(rawUrl: string): ParsedLink | null {
  let url: URL;
  try {
    url = new URL(rawUrl.replace("/#/", "/"));
  } catch {
    return null;
  }
  const host = url.hostname;
  const idParam = url.searchParams.get("id");

  if (host.includes("music.163.com")) {
    if (idParam) return { platform: "netease", externalId: idParam };
    return null;
  }
  if (host.includes("y.qq.com") || host.includes("qq.com")) {
    if (idParam) return { platform: "qq", externalId: idParam };
    const m = url.pathname.match(/playlist\/(\d+)/);
    if (m) return { platform: "qq", externalId: m[1] };
    return null;
  }
  return null;
}

export async function parsePlaylistLink(input: string): Promise<ParsedLink> {
  const url = firstUrl(input.trim());
  if (!url) throw new InvalidPlaylistLinkError(input);

  let target = url;
  if (/163cn\.tv/.test(url)) {
    target = await resolveShortLink(url);
  }
  const parsed = tryParse(target);
  if (!parsed) throw new InvalidPlaylistLinkError(input);
  return parsed;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test lib/adapters/parse-link.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(lib): playlist share-link parser"
```

---

## Task 3: Scraper client (zod-validated)

**Files:**
- Create: `lib/scraper-client.ts`
- Test: `lib/scraper-client.test.ts`

**Interfaces:**
- Produces: `scraperClient.qqPlaylist(id)`, `scraperClient.cityShows(cityCode, page)`, `scraperClient.showDetail(id)`; exported types `QqPlaylist`, `CityShows`, `ShowDetail`, `ShowSummary`; `ScraperError`. zod schemas mirror Plan 1's contract.

- [ ] **Step 1: Write failing tests**

`lib/scraper-client.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { scraperClient, ScraperError } from "./scraper-client";

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown, url = "http://localhost:8001/x") {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    url,
    json: async () => body,
  } as Response);
}

describe("scraperClient", () => {
  it("parses a valid qq playlist", async () => {
    const spy = mockFetch(200, { title: "t", songs: [{ name: "s", artists: ["a"] }] });
    const r = await scraperClient.qqPlaylist("123");
    expect(r.songs[0].artists).toEqual(["a"]);
    expect(spy.mock.calls[0][0]).toContain("/qq/playlist/123");
  });

  it("throws ScraperError on non-2xx", async () => {
    mockFetch(502, { detail: "boom" });
    await expect(scraperClient.showDetail("1")).rejects.toBeInstanceOf(ScraperError);
  });

  it("throws on schema mismatch (contract drift)", async () => {
    mockFetch(200, { shows: [{ showstartId: 1 }] }); // wrong types/missing fields
    await expect(scraperClient.cityShows("310000", 1)).rejects.toThrow();
  });

  it("builds the city-shows url with page", async () => {
    const spy = mockFetch(200, { shows: [] });
    await scraperClient.cityShows("310000", 2);
    expect(spy.mock.calls[0][0]).toContain("/showstart/cities/310000/shows?page=2");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test lib/scraper-client.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/scraper-client.ts`**

```ts
import { z } from "zod";

export class ScraperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScraperError";
  }
}

const SongSchema = z.object({ name: z.string(), artists: z.array(z.string()) });
export const QqPlaylistSchema = z.object({ title: z.string(), songs: z.array(SongSchema) });

export const ShowSummarySchema = z.object({
  showstartId: z.string(),
  title: z.string(),
  cityCode: z.string(),
  showTime: z.string().nullable(),
  url: z.string(),
});
export const CityShowsSchema = z.object({ shows: z.array(ShowSummarySchema) });

export const ShowDetailSchema = z.object({
  showstartId: z.string(),
  title: z.string(),
  cityCode: z.string(),
  venue: z.string().nullable(),
  showTime: z.string().nullable(),
  price: z.string().nullable(),
  url: z.string(),
  performers: z.array(z.string()),
});

export type QqPlaylist = z.infer<typeof QqPlaylistSchema>;
export type ShowSummary = z.infer<typeof ShowSummarySchema>;
export type CityShows = z.infer<typeof CityShowsSchema>;
export type ShowDetail = z.infer<typeof ShowDetailSchema>;

function baseUrl(): string {
  return process.env.SCRAPER_BASE_URL ?? "http://localhost:8001";
}

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(baseUrl() + path);
  } catch (err) {
    throw new ScraperError(`scraper request failed for ${path}: ${(err as Error).message}`);
  }
  if (!resp.ok) throw new ScraperError(`scraper ${path} responded ${resp.status}`);
  const json = await resp.json();
  return schema.parse(json);
}

export const scraperClient = {
  qqPlaylist: (id: string) =>
    getJson(`/qq/playlist/${encodeURIComponent(id)}`, QqPlaylistSchema),
  cityShows: (cityCode: string, page: number) =>
    getJson(`/showstart/cities/${encodeURIComponent(cityCode)}/shows?page=${page}`, CityShowsSchema),
  showDetail: (id: string) =>
    getJson(`/showstart/shows/${encodeURIComponent(id)}`, ShowDetailSchema),
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test lib/scraper-client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(lib): zod-validated scraper client"
```

---

## Task 4: QQ adapter

**Files:**
- Create: `lib/adapters/qq.ts`
- Test: `lib/adapters/qq.test.ts`

**Interfaces:**
- Consumes: `scraperClient` (Task 3), `ResolvedPlaylist` (Task 1).
- Produces: `resolveQqPlaylist(externalId: string): Promise<ResolvedPlaylist>`.

- [ ] **Step 1: Write failing test**

`lib/adapters/qq.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import * as client from "@/lib/scraper-client";
import { resolveQqPlaylist } from "./qq";

afterEach(() => vi.restoreAllMocks());

describe("resolveQqPlaylist", () => {
  it("maps scraper playlist to ResolvedPlaylist", async () => {
    vi.spyOn(client.scraperClient, "qqPlaylist").mockResolvedValue({
      title: "摇滚",
      songs: [{ name: "s", artists: ["万能青年旅店", "客座"] }],
    });
    const r = await resolveQqPlaylist("42");
    expect(r).toEqual({
      platform: "qq",
      externalId: "42",
      title: "摇滚",
      songs: [{ name: "s", artists: ["万能青年旅店", "客座"] }],
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test lib/adapters/qq.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/adapters/qq.ts`**

```ts
import { scraperClient } from "@/lib/scraper-client";
import type { ResolvedPlaylist } from "./types";

export async function resolveQqPlaylist(externalId: string): Promise<ResolvedPlaylist> {
  const pl = await scraperClient.qqPlaylist(externalId);
  return {
    platform: "qq",
    externalId,
    title: pl.title,
    songs: pl.songs.map((s) => ({ name: s.name, artists: s.artists })),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test lib/adapters/qq.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(lib): QQ playlist adapter via scraper client"
```

---

## Task 5: Netease weapi crypto (vendored)

**Files:**
- Create: `lib/adapters/netease/weapi.ts`
- Test: `lib/adapters/netease/weapi.test.ts`

**Interfaces:**
- Produces: `weapi(payload: unknown, secretKey?: string): { params: string; encSecKey: string }`. `secretKey` is injectable for deterministic tests; defaults to a random 16-char key.

- [ ] **Step 1: Write failing test**

`lib/adapters/netease/weapi.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { weapi } from "./weapi";

describe("weapi", () => {
  it("is deterministic given a fixed secret key", () => {
    const a = weapi({ id: "123", n: 100000 }, "1234567890123456");
    const b = weapi({ id: "123", n: 100000 }, "1234567890123456");
    expect(a).toEqual(b);
    expect(a.params).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(a.encSecKey).toHaveLength(256);
  });

  it("produces different params for different payloads", () => {
    const a = weapi({ id: "1" }, "1234567890123456");
    const b = weapi({ id: "2" }, "1234567890123456");
    expect(a.params).not.toBe(b.params);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test lib/adapters/netease/weapi.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/adapters/netease/weapi.ts`**

```ts
import crypto from "node:crypto";

const PRESET_KEY = "0CoJUm6Qyw8W8jud";
const IV = "0102030405060708";
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const PUBLIC_KEY = "010001";
const MODULUS =
  "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";

function aesEncrypt(text: string, key: string): string {
  const cipher = crypto.createCipheriv("aes-128-cbc", key, IV);
  return cipher.update(text, "utf8", "base64") + cipher.final("base64");
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

function rsaEncrypt(text: string): string {
  const reversed = text.split("").reverse().join("");
  const biText = BigInt("0x" + Buffer.from(reversed, "utf8").toString("hex"));
  const enc = modPow(biText, BigInt("0x" + PUBLIC_KEY), BigInt("0x" + MODULUS));
  return enc.toString(16).padStart(256, "0");
}

function randomKey(len: number): string {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += BASE62[bytes[i] % BASE62.length];
  return out;
}

export function weapi(
  payload: unknown,
  secretKey: string = randomKey(16),
): { params: string; encSecKey: string } {
  const text = JSON.stringify(payload);
  const params = aesEncrypt(aesEncrypt(text, PRESET_KEY), secretKey);
  const encSecKey = rsaEncrypt(secretKey);
  return { params, encSecKey };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test lib/adapters/netease/weapi.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(lib): vendored netease weapi crypto"
```

---

## Task 6: Netease adapter (playlist/detail + batched song/detail)

**Files:**
- Create: `lib/adapters/netease/client.ts`
- Create: `lib/adapters/netease/index.ts`
- Create: `lib/adapters/netease/__fixtures__/playlist_detail.json`
- Create: `lib/adapters/netease/__fixtures__/song_detail.json`
- Test: `lib/adapters/netease/index.test.ts`

**Interfaces:**
- Consumes: `weapi` (Task 5), `ResolvedPlaylist` (Task 1).
- Produces: pure `parsePlaylistMeta(raw): { title: string; trackIds: string[] }`, `parseSongDetail(raw): ResolvedSong[]`, and `resolveNeteasePlaylist(externalId): Promise<ResolvedPlaylist>`. Network in `client.ts` (`fetchPlaylistDetailRaw`, `fetchSongDetailRaw`), mockable. Batches song ids by 500. If any batch fails, the whole resolve throws (no partial data).

- [ ] **Step 1: Write fixtures**

`lib/adapters/netease/__fixtures__/playlist_detail.json`:
```json
{
  "playlist": {
    "name": "我的摇滚",
    "trackIds": [{ "id": 111 }, { "id": 222 }, { "id": 333 }]
  }
}
```

`lib/adapters/netease/__fixtures__/song_detail.json`:
```json
{
  "songs": [
    { "id": 111, "name": "杀死那个石家庄人", "ar": [{ "name": "万能青年旅店" }] },
    { "id": 222, "name": "河北墨麒麟", "ar": [{ "name": "万能青年旅店" }, { "name": "客座" }] },
    { "id": 333, "name": "Pyramid Song", "ar": [{ "name": "Radiohead" }] }
  ]
}
```

- [ ] **Step 2: Write failing tests**

`lib/adapters/netease/index.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import playlistDetail from "./__fixtures__/playlist_detail.json";
import songDetail from "./__fixtures__/song_detail.json";
import * as client from "./client";
import { parsePlaylistMeta, parseSongDetail, resolveNeteasePlaylist } from "./index";

afterEach(() => vi.restoreAllMocks());

describe("netease parsing", () => {
  it("extracts title and trackIds", () => {
    expect(parsePlaylistMeta(playlistDetail)).toEqual({
      title: "我的摇滚",
      trackIds: ["111", "222", "333"],
    });
  });
  it("maps songs with artist arrays", () => {
    expect(parseSongDetail(songDetail)).toEqual([
      { name: "杀死那个石家庄人", artists: ["万能青年旅店"] },
      { name: "河北墨麒麟", artists: ["万能青年旅店", "客座"] },
      { name: "Pyramid Song", artists: ["Radiohead"] },
    ]);
  });
});

describe("resolveNeteasePlaylist", () => {
  it("resolves title + all songs, batching trackIds", async () => {
    vi.spyOn(client, "fetchPlaylistDetailRaw").mockResolvedValue(playlistDetail);
    const songSpy = vi.spyOn(client, "fetchSongDetailRaw").mockResolvedValue(songDetail);
    const r = await resolveNeteasePlaylist("999");
    expect(r.platform).toBe("netease");
    expect(r.externalId).toBe("999");
    expect(r.title).toBe("我的摇滚");
    expect(r.songs).toHaveLength(3);
    expect(songSpy).toHaveBeenCalledTimes(1); // 3 ids -> 1 batch
  });

  it("throws if a song batch fails (no partial data)", async () => {
    vi.spyOn(client, "fetchPlaylistDetailRaw").mockResolvedValue(playlistDetail);
    vi.spyOn(client, "fetchSongDetailRaw").mockRejectedValue(new Error("risk control"));
    await expect(resolveNeteasePlaylist("999")).rejects.toThrow("risk control");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test lib/adapters/netease/index.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 4: Write `lib/adapters/netease/client.ts`**

```ts
import { weapi } from "./weapi";

const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Referer: "https://music.163.com",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
};

async function weapiPost(url: string, payload: unknown): Promise<any> {
  const { params, encSecKey } = weapi(payload);
  const body = new URLSearchParams({ params, encSecKey });
  const resp = await fetch(url, { method: "POST", headers: HEADERS, body });
  if (!resp.ok) throw new Error(`netease ${url} responded ${resp.status}`);
  return resp.json();
}

export async function fetchPlaylistDetailRaw(externalId: string): Promise<any> {
  return weapiPost("https://music.163.com/weapi/v6/playlist/detail", {
    id: externalId,
    n: 100000,
    s: 8,
  });
}

export async function fetchSongDetailRaw(trackIds: string[]): Promise<any> {
  const c = JSON.stringify(trackIds.map((id) => ({ id })));
  return weapiPost("https://music.163.com/weapi/v3/song/detail", { c });
}
```

- [ ] **Step 5: Write `lib/adapters/netease/index.ts`**

```ts
import type { ResolvedPlaylist, ResolvedSong } from "@/lib/adapters/types";
import { fetchPlaylistDetailRaw, fetchSongDetailRaw } from "./client";

const BATCH_SIZE = 500;

export function parsePlaylistMeta(raw: any): { title: string; trackIds: string[] } {
  const playlist = raw?.playlist ?? {};
  const trackIds = (playlist.trackIds ?? []).map((t: any) => String(t.id));
  return { title: playlist.name ?? "", trackIds };
}

export function parseSongDetail(raw: any): ResolvedSong[] {
  return (raw?.songs ?? []).map((s: any) => ({
    name: s.name ?? "",
    artists: (s.ar ?? s.artists ?? []).map((a: any) => a.name).filter(Boolean),
  }));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function resolveNeteasePlaylist(externalId: string): Promise<ResolvedPlaylist> {
  const meta = parsePlaylistMeta(await fetchPlaylistDetailRaw(externalId));
  const songs: ResolvedSong[] = [];
  for (const batch of chunk(meta.trackIds, BATCH_SIZE)) {
    const raw = await fetchSongDetailRaw(batch);
    songs.push(...parseSongDetail(raw));
  }
  return { platform: "netease", externalId, title: meta.title, songs };
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test lib/adapters/netease/index.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(lib): netease adapter with batched song/detail"
```

---

## Task 7: Matcher

**Files:**
- Create: `lib/matcher/index.ts`
- Test: `lib/matcher/index.test.ts`

**Interfaces:**
- Consumes: `normalizeName` (Task 1).
- Produces: types `MatchArtist`, `MatchShow`, `Match`; `matchShows(artists: MatchArtist[], shows: MatchShow[]): Match[]`. One match per (show, artist); `performer` wins over `title`; title match requires normalized name length ≥ 2.

- [ ] **Step 1: Write failing tests**

`lib/matcher/index.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { matchShows, type MatchArtist, type MatchShow } from "./index";

const wanqing: MatchArtist = {
  id: "a1",
  name: "万能青年旅店",
  normalizedName: "万能青年旅店",
  aliases: ["万青"],
};
const radiohead: MatchArtist = {
  id: "a2",
  name: "Radiohead",
  normalizedName: "radiohead",
  aliases: [],
};

describe("matchShows", () => {
  it("matches by exact performer", () => {
    const shows: MatchShow[] = [{ id: "s1", title: "Live", performers: ["万能青年旅店"] }];
    expect(matchShows([wanqing], shows)).toEqual([
      { showId: "s1", artistId: "a1", matchedBy: "performer" },
    ]);
  });

  it("matches by alias against performers", () => {
    const shows: MatchShow[] = [{ id: "s1", title: "x", performers: ["万青"] }];
    expect(matchShows([wanqing], shows)[0].matchedBy).toBe("performer");
  });

  it("falls back to title contains", () => {
    const shows: MatchShow[] = [
      { id: "s2", title: "Radiohead 2026 巡演 上海", performers: [] },
    ];
    expect(matchShows([radiohead], shows)).toEqual([
      { showId: "s2", artistId: "a2", matchedBy: "title" },
    ]);
  });

  it("prefers performer over title when both would hit", () => {
    const shows: MatchShow[] = [
      { id: "s3", title: "Radiohead night", performers: ["Radiohead"] },
    ];
    expect(matchShows([radiohead], shows)[0].matchedBy).toBe("performer");
  });

  it("does not title-match single-character normalized names", () => {
    const short: MatchArtist = { id: "a3", name: "P", normalizedName: "p", aliases: [] };
    const shows: MatchShow[] = [{ id: "s4", title: "power up party", performers: [] }];
    expect(matchShows([short], shows)).toEqual([]);
  });

  it("normalizes fullwidth/case on both sides", () => {
    const shows: MatchShow[] = [{ id: "s5", title: "x", performers: ["ＲＡＤＩＯＨＥＡＤ"] }];
    expect(matchShows([radiohead], shows)[0].matchedBy).toBe("performer");
  });

  it("emits at most one match per (show, artist)", () => {
    const shows: MatchShow[] = [
      { id: "s6", title: "万能青年旅店 万青 专场", performers: ["万能青年旅店"] },
    ];
    expect(matchShows([wanqing], shows)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test lib/matcher/index.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/matcher/index.ts`**

```ts
import { normalizeName } from "./normalize";

export interface MatchArtist {
  id: string;
  name: string;
  normalizedName: string;
  aliases: string[];
}
export interface MatchShow {
  id: string;
  title: string;
  performers: string[];
}
export interface Match {
  showId: string;
  artistId: string;
  matchedBy: "performer" | "title";
}

export function matchShows(artists: MatchArtist[], shows: MatchShow[]): Match[] {
  const matches: Match[] = [];
  for (const show of shows) {
    const normPerformers = new Set(show.performers.map(normalizeName));
    const normTitle = normalizeName(show.title);
    for (const artist of artists) {
      const names = [artist.normalizedName, ...artist.aliases.map(normalizeName)].filter(Boolean);
      let matchedBy: "performer" | "title" | null = null;
      if (names.some((n) => normPerformers.has(n))) {
        matchedBy = "performer";
      } else if (names.some((n) => n.length >= 2 && normTitle.includes(n))) {
        matchedBy = "title";
      }
      if (matchedBy) matches.push({ showId: show.id, artistId: artist.id, matchedBy });
    }
  }
  return matches;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test lib/matcher/index.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full Node suite**

Run: `pnpm test`
Expected: PASS — all Plan 1 (db, smoke) + Plan 2 lib tests green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(lib): matcher with performer/title rules"
```

---

## Self-Review Notes

- **Spec coverage (Plan 2 slice):** netease adapter (spec §5 流程①.2, weapi vendored per §3.1), QQ adapter via scraper, link parsing (流程①.1 incl. short link), matcher rules (§6: normalization, performer exact, title contains len≥2, feat arrays preserved). Immediate-match-on-follow and persistence are Plan 3.
- **Type consistency:** `ResolvedPlaylist`/`ResolvedSong`/`ArtistTally` (Task 1) reused by qq (Task 4) and netease (Task 6). `MatchArtist`/`MatchShow`/`Match` frozen in the contract block and Task 7. `normalizeName` single source (Task 1), imported by tally, matcher, and (Plan 3) artist persistence.
- **Contract mirror:** zod schemas (Task 3) match Plan 1 scraper JSON exactly (camelCase, nullable fields).
- **Fragile isolation:** netease HTTP (`client.ts`) and scraper HTTP mocked in tests; all parse/transform/match functions pure and fixture-tested.
