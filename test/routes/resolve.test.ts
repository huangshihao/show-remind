import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import { app } from "../../src/index";
import * as showstart from "@/lib/sources/showstart";

beforeEach(applySchema);

afterEach(() => {
  vi.restoreAllMocks();
});

it("resolves a QQ link to a tallied artist list with avatars attached", async () => {
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
  // Stub the Showstart artist search so resolve's avatar enrichment doesn't
  // hit the network; return a fixed hit keyed off requested name.
  vi.spyOn(showstart, "searchArtist").mockImplementation(async (name: string) =>
    name === "刺猬"
      ? { id: 2503, name: "刺猬Hedgehog", avatar: "https://s2.showstart.com/img/2503.jpg", fansNum: 337604 }
      : null,
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
  expect(body.artists[0]).toEqual({
    name: "刺猬",
    songCount: 2,
    avatar: "https://s2.showstart.com/img/2503.jpg",
  });
  expect(body.artists[1]).toEqual({ name: "海龟先生", songCount: 1, avatar: null });
  vi.unstubAllGlobals();
});

it("times out a slow avatar lookup instead of hanging, leaving avatar: null", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          request: {
            code: 0,
            data: {
              dirinfo: { title: "Slow List" },
              songlist_size: 1,
              songlist: [{ name: "s1", singer: [{ name: "慢艺人" }] }],
            },
          },
        }),
      ),
    ),
  );
  // searchArtist that never resolves — simulates a hung/slow Showstart lookup.
  vi.spyOn(showstart, "searchArtist").mockImplementation(() => new Promise(() => {}));
  const resPromise = app.request(
    "/api/resolve",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ link: "https://y.qq.com/n/ryqq/playlist/12345" }),
    },
    env,
  );
  await vi.advanceTimersByTimeAsync(4000);
  const res = await resPromise;
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.artists[0]).toEqual({ name: "慢艺人", songCount: 1, avatar: null });
  vi.useRealTimers();
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
