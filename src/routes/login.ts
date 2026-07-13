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
    // Fire-and-forget so the response returns in constant time whether or not
    // the email exists (no timing side-channel), and a mail-provider failure
    // can never turn into a 500-vs-200 existence oracle. waitUntil keeps the
    // send alive past the response; fall back to a bare promise in tests where
    // there is no ExecutionContext.
    const sending = mail.send({ to: sub.email, subject, html }).catch(() => {});
    try {
      c.executionCtx.waitUntil(sending);
    } catch {
      void sending;
    }
  }

  // Always ok:true — never reveal whether the email has a subscription.
  return c.json({ ok: true });
});
