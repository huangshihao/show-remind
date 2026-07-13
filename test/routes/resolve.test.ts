import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import app from "../../src/index";

beforeEach(applySchema);

it("resolves a QQ link to a tallied artist list", async () => {
  // Stub the QQ source at the network boundary.
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
                { name: "s1", singer: [{ name: "刺猬" }] },
                { name: "s2", singer: [{ name: "刺猬" }, { name: "海龟先生" }] },
              ],
            },
          },
        }),
      ),
    ),
  );
  const res = await app.request(
    "/api/resolve",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ link: "https://y.qq.com/n/ryqq/playlist/12345" }),
    },
    env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.title).toBe("My List");
  expect(body.artists[0]).toEqual({ name: "刺猬", songCount: 2 });
  vi.unstubAllGlobals();
});

it("returns 400 with a readable message on an unrecognized link", async () => {
  const res = await app.request(
    "/api/resolve",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ link: "hello" }) },
    env,
  );
  expect(res.status).toBe(400);
  expect((await res.json() as any).error).toBeTruthy();
});
