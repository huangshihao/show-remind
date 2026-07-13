import { Hono } from "hono";
import type { Env } from "../env";
import { getByToken, setCities, deleteByToken, type SubscriptionRow } from "../db/subscriptions";
import {
  listArtists,
  addArtistToSubscription,
  addArtistReturningInserted,
  removeArtist,
  countArtists,
} from "../db/subscription-artists";
import { setArtistAvatar, type ArtistRow } from "../db/artists";
import { searchArtistStrict } from "@/lib/sources/showstart";
import { resolvePlaylist } from "../services/resolve";
import { validCities, MAX_ARTISTS } from "../services/limits";
import { verifyTurnstile } from "../turnstile";
import { findUpcomingShowsForSubscription } from "../db/my-shows";

export const manageRouter = new Hono<{ Bindings: Env }>();

// Cap avatar lookups per manage load: each never-searched artist costs 1
// search + 1 write-back (~2 subrequests), on top of the getByToken +
// listArtists reads already spent. 15 artists × 2 subrequests + overhead
// stays well under the 50-subrequest budget; artists past the cap keep
// avatar: null and get filled on a later load. See src/services/resolve.ts
// for the analogous cap on the resolve path.
const AVATAR_LOOKUP_LIMIT = 15;
// One slow Showstart search shouldn't hang the whole manage response.
const AVATAR_LOOKUP_TIMEOUT_MS = 4000;

// Unlike a `Promise.race` that resolves null on timeout, this REJECTS — so a
// timeout is indistinguishable from any other thrown error to the caller,
// and neither gets treated as "search succeeded, no match" (see A1 below).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("avatar lookup timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Lazily backfill avatars for artists that were never looked up (avatar === null).
// avatar semantics: null = never searched, "" = searched but Showstart had no
// match (don't re-search), a URL = found. Mutates rows in place; never throws.
//
// Critical: only a DEFINITIVE "search succeeded, no artist found" may cache
// "". A timeout or a network/parse error must leave the row as null so it is
// retried on the next load — caching those as "" would be indistinguishable
// from a genuine miss and the avatar would never be found. That's why this
// uses searchArtistStrict (throws on error) instead of searchArtist (which
// swallows errors into null, making them look like "no match" to a caller).
async function backfillAvatars(db: D1Database, artists: ArtistRow[]): Promise<void> {
  const pending = artists.filter((a) => a.avatar === null).slice(0, AVATAR_LOOKUP_LIMIT);
  await Promise.all(
    pending.map(async (artist) => {
      try {
        const hit = await withTimeout(searchArtistStrict(artist.name), AVATAR_LOOKUP_TIMEOUT_MS);
        const avatar = hit?.avatar ?? ""; // mark searched-empty when no hit or hit has no photo
        await setArtistAvatar(db, artist.id, avatar);
        artist.avatar = avatar;
      } catch {
        // timeout or error: leave avatar null, retried on a later load
      }
    }),
  );
}

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
  await backfillAvatars(c.env.DB, artists);
  const shows = await findUpcomingShowsForSubscription(c.env.DB, sub.id);
  return c.json({
    email: sub.email,
    cities: sub.cities,
    // "" (searched-empty) collapses to null so the frontend shows a placeholder.
    artists: artists.map((a) => ({ id: a.id, name: a.name, avatar: a.avatar || null })),
    shows,
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
    let ok = false;
    try {
      ok = !!turnstileToken && (await verifyTurnstile(turnstileToken, c.env.TURNSTILE_SECRET));
    } catch {
      ok = false;
    }
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
    const { inserted } = await addArtistReturningInserted(c.env.DB, sub.id, a.name);
    if (inserted) added++;
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
