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
