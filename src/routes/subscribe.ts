import { Hono } from "hono";
import type { Env } from "../env";
import { createPendingSubscription, getByEmail } from "../db/subscriptions";
import { addArtistReturningInserted, countArtists } from "../db/subscription-artists";
import { matchArtistsToExistingShows } from "../pipeline/match";
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
    let ok = false;
    try {
      ok = !!body.turnstileToken && (await verifyTurnstile(body.turnstileToken, c.env.TURNSTILE_SECRET));
    } catch {
      ok = false;
    }
    if (!ok) return c.json({ error: "人机校验失败，请重试" }, 400);
  }

  const mail = getMailProvider(c.env);

  const existing = await getByEmail(c.env.DB, email);
  if (existing && existing.status === "active") {
    // Do not let an unauthenticated re-subscribe modify a live subscription.
    // Re-send the (existing) magic link to the registered owner; reveal nothing.
    const { subject, html } = confirmEmail(c.env.APP_BASE_URL, existing.token);
    await mail.send({ to: existing.email, subject, html });
    return c.json({ ok: true });
  }

  const sub = await createPendingSubscription(c.env.DB, email, cities);
  // Merge into any existing list (a pending sub may already hold an earlier
  // playlist import) — replacing wholesale would silently wipe it.
  let room = MAX_ARTISTS - (await countArtists(c.env.DB, sub.id));
  const newArtistIds: string[] = [];
  for (const name of artists) {
    if (room <= 0) break;
    const { artistId, inserted } = await addArtistReturningInserted(c.env.DB, sub.id, name);
    if (inserted) {
      newArtistIds.push(artistId);
      room--;
    }
  }
  await matchArtistsToExistingShows(c.env.DB, newArtistIds);
  const { subject, html } = confirmEmail(c.env.APP_BASE_URL, sub.token);
  await mail.send({ to: email, subject, html });

  return c.json({ ok: true });
});
