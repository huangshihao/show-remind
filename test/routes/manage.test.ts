import { beforeEach, expect, it, vi } from "vitest";
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

it("import only counts newly-linked artists toward added/cap, not already-followed ones", async () => {
  const sub = await activeSub();
  const before = (await listArtists(env.DB, sub.id)).length;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          request: {
            code: 0,
            data: {
              dirinfo: { title: "My List" },
              songlist_size: 2,
              songlist: [
                { name: "s1", singer: [{ name: "痛仰乐队" }] },
                { name: "s2", singer: [{ name: "海龟先生" }] },
              ],
            },
          },
        }),
      ),
    ),
  );
  const body = j({ link: "https://y.qq.com/n/ryqq/playlist/12345" });

  const first = await app.request(`/api/manage/import?token=${sub.token}`, body, env);
  expect(first.status).toBe(200);
  const firstBody = (await first.json()) as any;
  expect(firstBody.added).toBe(2);
  expect((await listArtists(env.DB, sub.id)).length).toBe(before + 2);

  const second = await app.request(`/api/manage/import?token=${sub.token}`, body, env);
  expect(second.status).toBe(200);
  const secondBody = (await second.json()) as any;
  expect(secondBody.added).toBe(0);
  expect((await listArtists(env.DB, sub.id)).length).toBe(before + 2);

  vi.unstubAllGlobals();
});
