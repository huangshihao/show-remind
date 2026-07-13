import { Hono } from "hono";
import type { Env } from "./env";
import { resolveRouter } from "./routes/resolve";
import { subscribeRouter } from "./routes/subscribe";
import { confirmRouter } from "./routes/confirm";
import { manageRouter } from "./routes/manage";
import { loginRouter } from "./routes/login";
import { configRouter } from "./routes/config";
import { internalRouter } from "./routes/internal";
import { runScheduled } from "./pipeline/run";

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

export { app }; // for app.request in tests
export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // jitter 0-10 min so runs are not exactly on the minute
    const delay = Math.floor(Math.random() * 10 * 60 * 1000);
    ctx.waitUntil(new Promise<void>((r) => setTimeout(r, delay)).then(() => runScheduled(env)));
  },
};
