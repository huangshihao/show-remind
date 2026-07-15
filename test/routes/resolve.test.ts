import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import { app } from "../../src/index";
import * as showstart from "@/lib/sources/showstart";

beforeEach(applySchema);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const post = (link: string) =>
  app.request(
    "/api/resolve",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ link }) },
    env,
  );

it("resolves a QQ link with avatars taken straight from the playlist's singer mids — no Showstart search", async () => {
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
                { name: "s1", singer: [{ name: "刺猬", mid: "002IZbHE0PLcjs" }] },
                { name: "s2", singer: [{ name: "刺猬", mid: "002IZbHE0PLcjs" }, { name: "海龟先生" }] },
              ],
            },
          },
        }),
      ),
    ),
  );
  const searchSpy = vi.spyOn(showstart, "searchArtist");
  const res = await post("https://y.qq.com/n/ryqq/playlist/12345");
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.title).toBe("My List");
  expect(body.artists[0]).toEqual({
    name: "刺猬",
    songCount: 2,
    avatar: "https://y.qq.com/music/photo_new/T001R300x300M000002IZbHE0PLcjs.jpg",
  });
  // a singer the playlist carries no mid for keeps avatar: null (backfilled later)
  expect(body.artists[1]).toEqual({ name: "海龟先生", songCount: 1, avatar: null });
  expect(searchSpy).not.toHaveBeenCalled();
});

function neteaseFetchStub(headInfo: (url: string) => Promise<Response> | Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/v6/playlist/detail")) {
      return new Response(JSON.stringify({ playlist: { name: "网易单", trackIds: [{ id: 111 }] } }));
    }
    if (url.includes("/api/v3/song/detail")) {
      return new Response(
        JSON.stringify({ songs: [{ id: 111, name: "s", ar: [{ id: 36012, name: "万能青年旅店" }] }] }),
      );
    }
    if (url.includes("/api/artist/head/info/get")) return headInfo(url);
    throw new Error(`unexpected fetch ${url}`);
  });
}

it("resolves a netease link and fetches avatars by artist id, upgrading http to https", async () => {
  const fetchMock = neteaseFetchStub(
    (url) => {
      expect(url).toContain("id=36012");
      return new Response(
        JSON.stringify({ code: 200, data: { artist: { id: 36012, avatar: "http://p2.music.126.net/a.jpg" } } }),
      );
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const res = await post("https://music.163.com/#/playlist?id=999");
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.artists).toEqual([
    { name: "万能青年旅店", songCount: 1, avatar: "https://p2.music.126.net/a.jpg" },
  ]);
});

it("times out a slow netease avatar lookup instead of hanging, leaving avatar: null", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", neteaseFetchStub(() => new Promise<Response>(() => {})));
  const resPromise = post("https://music.163.com/#/playlist?id=999");
  await vi.advanceTimersByTimeAsync(4000);
  const res = await resPromise;
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.artists[0]).toEqual({ name: "万能青年旅店", songCount: 1, avatar: null });
  vi.useRealTimers();
});

it("a failed netease avatar lookup degrades to avatar: null, not a resolve failure", async () => {
  vi.stubGlobal("fetch", neteaseFetchStub(() => new Response("boom", { status: 500 })));
  const res = await post("https://music.163.com/#/playlist?id=999");
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.artists[0]).toEqual({ name: "万能青年旅店", songCount: 1, avatar: null });
});

it("returns 400 with a readable message on an unrecognized link", async () => {
  const res = await app.request(
    "/api/resolve",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ link: "hello" }) },
    env,
  );
  expect(res.status).toBe(400);
  expect(((await res.json()) as any).error).toBeTruthy();
});
