import { Hono } from "hono";
import type { Env } from "../env";
import { crawlCity } from "../pipeline/crawl";
import { matchNewShows } from "../pipeline/match";
import { runNotifications } from "../pipeline/notify";
import { deleteStalePending } from "../db/notifications";

export const internalRouter = new Hono<{ Bindings: Env }>();

function authorized(c: { env: Env; req: { header(name: string): string | undefined } }): boolean {
  const secret = c.env.INTERNAL_SECRET;
  return Boolean(secret) && c.req.header("x-internal-secret") === secret;
}

// Manual trigger for the reminder pipeline — same work as the 02:30 UTC cron
// (see runNotify in src/index.ts). Useful for re-sending after clearing a
// notification row, or for kicking reminders without waiting for tonight.
internalRouter.post("/notify", async (c) => {
  if (!authorized(c)) return c.text("forbidden", 403);
  const result = await runNotifications(c.env.DB, c.env);
  await deleteStalePending(c.env.DB, 48);
  return c.json(result);
});

internalRouter.get("/crawl", async (c) => {
  if (!authorized(c)) {
    return c.text("forbidden", 403);
  }
  const city = c.req.query("city");
  if (!city) return c.json({ error: "missing city" }, 400);
  try {
    const showIds = await crawlCity(c.env.DB, city);
    const matched = await matchNewShows(c.env.DB, showIds);
    return c.json({ city, newShows: showIds.length, matched });
  } catch (err) {
    return c.json({ city, error: String(err) }, 500);
  }
});
