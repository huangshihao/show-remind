import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import { app } from "../../src/index";
import { getByEmail } from "../../src/db/subscriptions";

beforeEach(applySchema);

async function subscribe(body: unknown, customEnv: Record<string, any> = {}) {
  return app.request(
    "/api/subscribe",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    { ...env, ...customEnv },
  );
}

it("missing turnstile token under PUBLIC_MODE=1 → 400", async () => {
  const res = await subscribe(
    { email: "a@b.com", cities: ["110000"], artists: ["刺猬"] },
    { PUBLIC_MODE: "1", TURNSTILE_SECRET: "test" },
  );
  expect(res.status).toBe(400);
  const sub = await getByEmail(env.DB, "a@b.com");
  expect(sub).toBeNull();
});

it("turnstile siteverify throws → graceful 400", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("network blip");
  }));
  try {
    const res = await subscribe(
      { email: "a@b.com", cities: ["110000"], artists: ["刺猬"], turnstileToken: "tok" },
      { PUBLIC_MODE: "1", TURNSTILE_SECRET: "test" },
    );
    expect(res.status).toBe(400);
    const sub = await getByEmail(env.DB, "a@b.com");
    expect(sub).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("valid turnstile → subscription created", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }))));
  try {
    const res = await subscribe(
      { email: "a@b.com", cities: ["110000"], artists: ["刺猬"], turnstileToken: "tok" },
      { PUBLIC_MODE: "1", TURNSTILE_SECRET: "test" },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    const sub = await getByEmail(env.DB, "a@b.com");
    expect(sub).not.toBeNull();
    expect(sub?.status).toBe("pending");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("resolve with no token under PUBLIC_MODE=1 → 400", async () => {
  const res = await app.request(
    "/api/resolve",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
    { ...env, PUBLIC_MODE: "1", TURNSTILE_SECRET: "test" },
  );
  expect(res.status).toBe(400);
});
