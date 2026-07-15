import { Hono } from "hono";
import type { Env } from "../env";
import { getByToken, setCities, deleteByToken, type SubscriptionRow } from "../db/subscriptions";
import {
  listArtists,
  addArtistReturningInserted,
  removeArtist,
  countArtists,
} from "../db/subscription-artists";
import { matchArtistsToExistingShows } from "../pipeline/match";
import { setArtistAvatar, setArtistNeteaseId, type ArtistRow } from "../db/artists";
import { searchArtistStrict } from "@/lib/sources/showstart";
import { fetchArtistAvatar } from "@/lib/adapters/netease";
import { resolvePlaylist } from "../services/resolve";
import { validCities, MAX_ARTISTS } from "../services/limits";
import { verifyTurnstile } from "../turnstile";
import { findUpcomingShowsForSubscription } from "../db/my-shows";

export const manageRouter = new Hono<{ Bindings: Env }>();

// Cap avatar lookups per manage load. Each pending artist costs 1 external
// fetch (netease head-info or Showstart search — D1 writes don't count
// against the 50-external-subrequest budget), and this runs in waitUntil so
// it shares the same invocation budget as the response. 30 lookups + the
// rare netease→Showstart double leaves comfortable headroom; artists past
// the cap stay pending and get picked up on a later load. See
// src/services/resolve.ts for the analogous cap on the resolve path.
const AVATAR_LOOKUP_LIMIT = 30;
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

// Lazily backfill avatars. Pending rows are those never looked up
// (avatar === null) plus searched-empty ("") rows that gained a netease id —
// a Showstart miss says nothing about netease, which knows every playlist
// artist. avatar semantics: null = never searched, "" = every source we had
// came up empty (don't re-search), a URL = found. Mutates rows in place;
// never throws.
//
// An artist with a netease id resolves via head-info (exact, by id). A
// DEFINITIVE "profile has no photo" clears the id (so the row can't loop
// through the netease path on every load) and falls through to one Showstart
// name search. Artists without an id go straight to Showstart.
//
// Critical: only a DEFINITIVE "lookup succeeded, nothing found" may cache
// "". A timeout or a network/parse error must leave the row's state as-is so
// it is retried on the next load — caching those as "" would be
// indistinguishable from a genuine miss and the avatar would never be found.
// That's why this uses searchArtistStrict / fetchArtistAvatar (both throw on
// error) instead of a null-swallowing variant.
async function backfillAvatars(db: D1Database, artists: ArtistRow[]): Promise<void> {
  const pending = artists
    .filter((a) => a.avatar === null || (a.avatar === "" && a.neteaseId))
    .slice(0, AVATAR_LOOKUP_LIMIT);
  await Promise.all(
    pending.map(async (artist) => {
      try {
        if (artist.neteaseId) {
          const fromNetease = await withTimeout(
            fetchArtistAvatar(artist.neteaseId),
            AVATAR_LOOKUP_TIMEOUT_MS,
          );
          if (fromNetease) {
            await setArtistAvatar(db, artist.id, fromNetease);
            artist.avatar = fromNetease;
            return;
          }
          await setArtistNeteaseId(db, artist.id, null);
          artist.neteaseId = null;
        }
        const hit = await withTimeout(searchArtistStrict(artist.name), AVATAR_LOOKUP_TIMEOUT_MS);
        const avatar = hit?.avatar ?? ""; // mark searched-empty when no hit or hit has no photo
        await setArtistAvatar(db, artist.id, avatar);
        artist.avatar = avatar;
      } catch {
        // timeout or error: leave the row as-is, retried on a later load
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
  // Snapshot the response view BEFORE kicking off the backfill: backfill
  // mutates `artists` rows as lookups land, and the response must reflect
  // what the DB held at read time, not a race with the background writes.
  // "" (searched-empty) collapses to null so the frontend shows a placeholder.
  const artistsView = artists.map((a) => ({ id: a.id, name: a.name, avatar: a.avatar || null }));
  // Off the response path: Showstart lookups (up to 15 × 4s) used to gate the
  // whole page load. waitUntil lets the response return now; freshly found
  // avatars show up on the next load.
  c.executionCtx.waitUntil(backfillAvatars(c.env.DB, artists));
  const shows = await findUpcomingShowsForSubscription(c.env.DB, sub.id);
  return c.json({
    email: sub.email,
    cities: sub.cities,
    artists: artistsView,
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
    return c.json({ error: "歌单解析失败，请稍后重试" }, 502);
  }
  // Public-mode abuse protection only — self-host imports the whole playlist.
  const cap =
    c.env.PUBLIC_MODE === "1" ? MAX_ARTISTS - (await countArtists(c.env.DB, sub.id)) : Infinity;
  let added = 0;
  const newArtistIds: string[] = [];
  for (const a of resolved.artists) {
    if (added >= cap) break;
    const { artistId, inserted } = await addArtistReturningInserted(
      c.env.DB,
      sub.id,
      a.name,
      a.avatar,
      a.sourceId,
    );
    if (inserted) {
      added++;
      newArtistIds.push(artistId);
    }
  }
  await matchArtistsToExistingShows(c.env.DB, newArtistIds);
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
