import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import app from "../../src/index";
import { createPendingSubscription, activateByToken } from "../../src/db/subscriptions";
import { setArtists, listArtists } from "../../src/db/subscription-artists";

beforeEach(applySchema);

async function activeSub() {
  const sub = await createPendingSubscription(env.DB, "a@b.com", ["110000"]);
  await activateByToken(env.DB, sub.token);
  await setArtists(env.DB, sub.id, ["刺猬"]);
  return sub;
}
const j = (body: unknown) => ({
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

it("GET manage returns the subscription view", async () => {
  const sub = await activeSub();
  const res = await app.request(`/api/manage?token=${sub.token}`, {}, env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.email).toBe("a@b.com");
  expect(body.cities).toEqual(["110000"]);
  expect(body.artists.map((a: any) => a.name)).toEqual(["刺猬"]);
});

it("unknown token returns 404 everywhere", async () => {
  expect((await app.request("/api/manage?token=nope", {}, env)).status).toBe(404);
  expect((await app.request("/api/manage/cities?token=nope", j({ cities: ["110000"] }), env)).status).toBe(404);
});

it("add and remove artists", async () => {
  const sub = await activeSub();
  const add = await app.request(`/api/manage/artists?token=${sub.token}`, j({ name: "海龟先生" }), env);
  const { id } = (await add.json()) as any;
  expect((await listArtists(env.DB, sub.id)).length).toBe(2);
  const del = await app.request(`/api/manage/artists/${id}?token=${sub.token}`, { method: "DELETE" }, env);
  expect(del.status).toBe(200);
  expect((await listArtists(env.DB, sub.id)).map((a) => a.name)).toEqual(["刺猬"]);
});

it("update cities validates the set", async () => {
  const sub = await activeSub();
  expect((await app.request(`/api/manage/cities?token=${sub.token}`, j({ cities: ["310000"] }), env)).status).toBe(200);
  expect((await app.request(`/api/manage/cities?token=${sub.token}`, j({ cities: ["999999"] }), env)).status).toBe(400);
});

it("unsubscribe deletes the subscription", async () => {
  const sub = await activeSub();
  const res = await app.request(`/api/manage/unsubscribe?token=${sub.token}`, {}, env);
  expect(res.status).toBe(200);
  expect((await app.request(`/api/manage?token=${sub.token}`, {}, env)).status).toBe(404);
});
