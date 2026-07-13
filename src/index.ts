import { Hono } from "hono";
import type { Env } from "./env";
import { resolveRouter } from "./routes/resolve";
import { subscribeRouter } from "./routes/subscribe";
import { confirmRouter } from "./routes/confirm";
import { manageRouter } from "./routes/manage";
import { configRouter } from "./routes/config";

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
app.route("/api/config", configRouter);

export default app;
