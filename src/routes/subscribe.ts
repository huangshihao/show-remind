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
