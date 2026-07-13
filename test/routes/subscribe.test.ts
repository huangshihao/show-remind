import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import { app } from "../../src/index";
import { getByEmail } from "../../src/db/subscriptions";
import { listArtists } from "../../src/db/subscription-artists";

beforeEach(applySchema);

async function subscribe(body: unknown) {
  return app.request(
    "/api/subscribe",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    env,
  );
}

it("creates a pending sub with artists and returns ok", async () => {
  const res = await subscribe({ email: "a@b.com", cities: ["110000"], artists: ["刺猬", "海龟先生"] });
  expect(res.status).toBe(200);
  const sub = await getByEmail(env.DB, "a@b.com");
  expect(sub?.status).toBe("pending");
  expect((await listArtists(env.DB, sub!.id)).length).toBe(2);
});

it("rejects invalid email / empty cities / no artists", async () => {
  expect((await subscribe({ email: "x", cities: ["110000"], artists: ["刺猬"] })).status).toBe(400);
  expect((await subscribe({ email: "a@b.com", cities: [], artists: ["刺猬"] })).status).toBe(400);
  expect((await subscribe({ email: "a@b.com", cities: ["110000"], artists: [] })).status).toBe(400);
});

it("confirm activates the sub and redirects to manage", async () => {
  await subscribe({ email: "a@b.com", cities: ["110000"], artists: ["刺猬"] });
  const sub = await getByEmail(env.DB, "a@b.com");
  const res = await app.request(`/api/confirm?token=${sub!.token}`, {}, env);
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(`/manage?token=${sub!.token}`);
  expect((await getByEmail(env.DB, "a@b.com"))?.status).toBe("active");
});

it("confirm with unknown token returns 404", async () => {
  const res = await app.request("/api/confirm?token=nope", {}, env);
  expect(res.status).toBe(404);
});

it("re-subscribing an ACTIVE email does not clobber its artists/status", async () => {
  await subscribe({ email: "a@b.com", cities: ["110000"], artists: ["刺猬"] });
  const first = await getByEmail(env.DB, "a@b.com");
  await app.request(`/api/confirm?token=${first!.token}`, {}, env);

  const res = await subscribe({ email: "a@b.com", cities: ["310000"], artists: ["达达"] });
  expect(res.status).toBe(200);

  const sub = await getByEmail(env.DB, "a@b.com");
  expect(sub?.status).toBe("active");
  expect(sub?.token).toBe(first!.token);
  const artists = await listArtists(env.DB, sub!.id);
  expect(artists.map((a) => a.name)).toEqual(["刺猬"]);
});
