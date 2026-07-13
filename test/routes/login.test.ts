import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import { app } from "../../src/index";
import { createPendingSubscription } from "../../src/db/subscriptions";

beforeEach(applySchema);

async function login(body: unknown) {
  return app.request(
    "/api/login",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    env,
  );
}

it("existing subscribed email → 200 ok:true", async () => {
  await createPendingSubscription(env.DB, "a@b.com", ["110000"]);
  const res = await login({ email: "a@b.com" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

it("unknown email → still 200 ok:true (no existence leak)", async () => {
  const res = await login({ email: "nobody@b.com" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

it("invalid email → 400", async () => {
  const res = await login({ email: "not-an-email" });
  expect(res.status).toBe(400);
});
