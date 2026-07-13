import { Hono } from "hono";
import type { Env } from "../env";
import { getByEmail } from "../db/subscriptions";
import { getMailProvider } from "../mail/provider";
import { loginEmail } from "../mail/templates";
import { isEmail } from "../services/limits";
import { verifyTurnstile } from "../turnstile";

export const loginRouter = new Hono<{ Bindings: Env }>();

loginRouter.post("/", async (c) => {
  const body = await c.req.json<{ email?: string; turnstileToken?: string }>();
  const email = (body.email ?? "").trim();

  if (!isEmail(email)) return c.json({ error: "邮箱格式不正确" }, 400);

  if (c.env.PUBLIC_MODE === "1") {
    let ok = false;
    try {
      ok = !!body.turnstileToken && (await verifyTurnstile(body.turnstileToken, c.env.TURNSTILE_SECRET));
    } catch {
      ok = false;
    }
    if (!ok) return c.json({ error: "人机校验失败，请重试" }, 400);
  }

  const sub = await getByEmail(c.env.DB, email);
  if (sub) {
    const mail = getMailProvider(c.env);
    const { subject, html } = loginEmail(c.env.APP_BASE_URL, sub.token);
    await mail.send({ to: sub.email, subject, html });
  }

  // Always ok:true — never reveal whether the email has a subscription.
  return c.json({ ok: true });
});
