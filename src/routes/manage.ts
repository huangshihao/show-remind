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
import { backfillAvatars } from "../services/avatar-backfill";
import { resolvePlaylist } from "../services/resolve";
import { validCities, MAX_ARTISTS } from "../services/limits";
import { verifyTurnstile } from "../turnstile";
import { findUpcomingShowsForSubscription } from "../db/my-shows";
import { SubrequestBudget } from "@/lib/budget";

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
  // Snapshot the response view BEFORE kicking off the backfill: backfill
  // mutates `artists` rows as lookups land, and the response must reflect
  // what the DB held at read time, not a race with the background writes.
  // "" (searched-empty) collapses to null so the frontend shows a placeholder.
  const artistsView = artists.map((a) => ({ id: a.id, name: a.name, avatar: a.avatar || null }));
  // Off the response path: avatar lookups (up to 30 × 4s) used to gate the
  // whole page load. waitUntil lets the response return now; freshly found
  // avatars show up on the next load. The budget is fresh — this GET spends
  // no external fetches before here — but waitUntil work still shares the
  // invocation's 50-external ceiling, which the budget enforces.
  c.executionCtx.waitUntil(backfillAvatars(c.env.DB, artists, new SubrequestBudget()));
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
    // One budget per invocation: playlist pagination + avatar lookups share it.
    resolved = await resolvePlaylist(link, new SubrequestBudget());
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
