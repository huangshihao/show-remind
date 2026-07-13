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
