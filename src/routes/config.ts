import { Hono } from "hono";
import type { Env } from "../env";
import { CITIES } from "@/lib/cities";

export const configRouter = new Hono<{ Bindings: Env }>();

configRouter.get("/", (c) => {
  // Config reflects live server state (city list, turnstile). Never let a
  // browser/CDN serve a stale copy — otherwise a changed city list (or turnstile
  // key) wouldn't reach clients until their cache expired.
  c.header("Cache-Control", "no-store");
  return c.json({
    // Only expose code/name to the client; showstartId is an internal crawl detail.
    // Every listed city is crawlable (City.showstartId is required), so the picker
    // can never offer a city that would silently deliver nothing.
    cities: CITIES.map(({ code, name }) => ({ code, name })),
    publicMode: c.env.PUBLIC_MODE === "1",
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? "",
  });
});
