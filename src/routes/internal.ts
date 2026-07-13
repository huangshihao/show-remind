import { Hono } from "hono";
import type { Env } from "../env";
import { crawlCity } from "../pipeline/crawl";
import { matchNewShows } from "../pipeline/match";

export const internalRouter = new Hono<{ Bindings: Env }>();

internalRouter.get("/crawl", async (c) => {
  const secret = c.env.INTERNAL_SECRET;
  if (!secret || c.req.header("x-internal-secret") !== secret) {
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
