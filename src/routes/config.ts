import { Hono } from "hono";
import type { Env } from "../env";
import { CITIES } from "@/lib/cities";

export const configRouter = new Hono<{ Bindings: Env }>();

configRouter.get("/", (c) =>
  c.json({
    cities: CITIES,
    publicMode: c.env.PUBLIC_MODE === "1",
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? "",
  }),
);
