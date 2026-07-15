import { Hono } from "hono";
import type { Env } from "./env";
import { resolveRouter } from "./routes/resolve";
import { subscribeRouter } from "./routes/subscribe";
import { confirmRouter } from "./routes/confirm";
import { manageRouter } from "./routes/manage";
import { loginRouter } from "./routes/login";
import { configRouter } from "./routes/config";
import { internalRouter } from "./routes/internal";
import { runCrawl, runNotify } from "./pipeline/run";

const app = new Hono<{ Bindings: Env }>();

// D1 enforces foreign keys only when asked, per connection.
app.use("*", async (c, next) => {
  await c.env.DB.prepare("PRAGMA foreign_keys = ON").run();
  await next();
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/resolve", resolveRouter);
app.route("/api/subscribe", subscribeRouter);
app.route("/api/confirm", confirmRouter);
app.route("/api/manage", manageRouter);
app.route("/api/login", loginRouter);
app.route("/api/config", configRouter);
app.route("/internal", internalRouter);

// Cron dispatch. Must match wrangler.jsonc `triggers.crons`: "0 2 * * *" crawls,
// "30 2 * * *" mails. Anything unrecognised falls back to the crawl, which is the
// safe default — a stray run costs a sweep, never a duplicate reminder.
export const NOTIFY_CRON = "30 2 * * *";

// Jitter so we never hit Showstart exactly on the minute. Kept well under the
// 15-minute Cron Trigger wall limit: the crawl sweep itself needs a few minutes
// (32 cities in waves of 6), so a large jitter could get the run killed before it
// finished.
const MAX_JITTER_MS = 3 * 60 * 1000;

export { app }; // for app.request in tests
export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // The runtime waits for the returned promise (up to the 15-min limit), so the
    // jittered sleep is safe here.
    const delay = Math.floor(Math.random() * MAX_JITTER_MS);
    const run = controller.cron === NOTIFY_CRON ? runNotify : runCrawl;
    ctx.waitUntil(new Promise<void>((r) => setTimeout(r, delay)).then(() => run(env)));
  },
};
