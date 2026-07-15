import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import { app } from "../../src/index";
import { createPendingSubscription, activateByToken } from "../../src/db/subscriptions";
import { setArtists, listArtists, addArtistToSubscription } from "../../src/db/subscription-artists";
import { upsertShow } from "../../src/db/shows";
import { persistMatches } from "../../src/db/show-artists";
import * as showstart from "@/lib/sources/showstart";
import * as netease from "@/lib/adapters/netease";
import { upsertArtist, setArtistAvatar, getAllArtists } from "../../src/db/artists";

beforeEach(applySchema);
// GET /api/manage lazily backfills avatars via searchArtistStrict; default it
// to "no match" so tests never touch the network. Individual tests override
// as needed.
beforeEach(() => {
  vi.spyOn(showstart, "searchArtistStrict").mockResolvedValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function activeSub() {
  const sub = await createPendingSubscription(env.DB, "a@b.com", ["110000"]);
  await activateByToken(env.DB, sub.token);
  await setArtists(env.DB, sub.id, ["刺猬"]);
  return sub;
}
const j = (body: unknown) => ({
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

it("GET manage returns the subscription view, including upcoming shows", async () => {
  const sub = await activeSub();
  const res = await app.request(`/api/manage?token=${sub.token}`, {}, env, createExecutionContext());
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.email).toBe("a@b.com");
  expect(body.cities).toEqual(["110000"]);
  expect(body.artists.map((a: any) => a.name)).toEqual(["刺猬"]);
  expect(body.shows).toEqual([]);
});

it("GET manage includes upcoming shows for the subscription's followed artists", async () => {
  const sub = await activeSub();
  const artists = await listArtists(env.DB, sub.id);
  const show = await upsertShow(env.DB, {
    showstartId: "900", title: "刺猬专场", cityCode: "110000", venue: "MAO",
    showTime: "2099-08-01T20:00:00", price: "180", url: "https://x/900", performers: ["刺猬"],
    poster: "https://s2.showstart.com/900.jpg",
  });
  await persistMatches(env.DB, [{ showId: show.id, artistId: artists[0].id, matchedBy: "performer" }]);

  const res = await app.request(`/api/manage?token=${sub.token}`, {}, env, createExecutionContext());
  const body = (await res.json()) as any;
  expect(body.shows).toEqual([
    {
      id: show.id,
      title: "刺猬专场",
      poster: "https://s2.showstart.com/900.jpg",
      cityCode: "110000",
      venue: "MAO",
      showTime: "2099-08-01T20:00:00",
      price: "180",
      url: "https://x/900",
      artistNames: ["刺猬"],
      notified: false,
    },
  ]);
});

it("GET manage backfills avatars in the background (waitUntil) and caches them (no re-search)", async () => {
  const sub = await createPendingSubscription(env.DB, "c@d.com", ["110000"]);
  await activateByToken(env.DB, sub.token);
  await setArtists(env.DB, sub.id, ["刺猬", "海龟先生"]);

  const AVATAR = "https://s2.showstart.com/img/2503.jpg";
  const spy = vi.spyOn(showstart, "searchArtistStrict").mockImplementation(async (name: string) =>
    name === "刺猬"
      ? { id: 2503, name: "刺猬Hedgehog", avatar: AVATAR, fansNum: 337604 }
      : null,
  );

  const byName = (body: any) =>
    Object.fromEntries(body.artists.map((a: any) => [a.name, a.avatar]));

  // First load answers immediately from the DB (avatars still null); the
  // Showstart lookups run in the background via waitUntil, not on the
  // response path.
  const ctx1 = createExecutionContext();
  const first = await app.request(`/api/manage?token=${sub.token}`, {}, env, ctx1);
  expect(first.status).toBe(200);
  expect(byName(await first.json())).toEqual({ 刺猬: null, 海龟先生: null });
  await waitOnExecutionContext(ctx1);
  // One background lookup per never-searched artist.
  expect(spy).toHaveBeenCalledTimes(2);

  // Second load: 刺猬 is now a cached URL, 海龟先生 a cached "" (searched-empty,
  // collapsed to null in the response). Neither is null in the DB anymore, so
  // no further searches fire.
  const ctx2 = createExecutionContext();
  const second = await app.request(`/api/manage?token=${sub.token}`, {}, env, ctx2);
  expect(second.status).toBe(200);
  expect(byName(await second.json())).toEqual({ 刺猬: AVATAR, 海龟先生: null });
  await waitOnExecutionContext(ctx2);
  expect(spy).toHaveBeenCalledTimes(2);
});

it("a hung Showstart lookup doesn't delay the response, and leaves avatar null, NOT cached as \"\"", async () => {
  vi.useFakeTimers();
  const sub = await createPendingSubscription(env.DB, "timeout@b.com", ["110000"]);
  await activateByToken(env.DB, sub.token);
  await setArtists(env.DB, sub.id, ["慢艺人"]);

  // searchArtistStrict that never resolves — simulates a hung Showstart lookup.
  // Note: vi.spyOn on an already-mocked method (from the top-of-file
  // beforeEach) returns the SAME spy instance, so call counts accumulate
  // across the mockImplementation swaps below — hence the mockClear() before
  // re-checking call counts for the second phase.
  const spy = vi.mocked(showstart.searchArtistStrict).mockImplementation(() => new Promise(() => {}));

  // The response must resolve WITHOUT advancing the fake clock: the hung
  // lookup runs in the background, not on the response path.
  const ctx = createExecutionContext();
  const res = await app.request(`/api/manage?token=${sub.token}`, {}, env, ctx);
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.artists.find((a: any) => a.name === "慢艺人").avatar).toBeNull();
  expect(spy).toHaveBeenCalledTimes(1);
  // Let the background lookup hit its 4s timeout and settle.
  await vi.advanceTimersByTimeAsync(4000);
  await waitOnExecutionContext(ctx);
  vi.useRealTimers();

  // Prove it wasn't cached as "": a later load with a real (non-hanging)
  // search must re-search this artist, because its avatar is still null.
  spy.mockClear();
  spy.mockResolvedValue(null);
  const ctx2 = createExecutionContext();
  const second = await app.request(`/api/manage?token=${sub.token}`, {}, env, ctx2);
  expect(second.status).toBe(200);
  await waitOnExecutionContext(ctx2);
  expect(spy).toHaveBeenCalledTimes(1);
});

it("a backfill error (not a timeout) also leaves avatar null, not cached as \"\"", async () => {
  const sub = await createPendingSubscription(env.DB, "err@b.com", ["110000"]);
  await activateByToken(env.DB, sub.token);
  await setArtists(env.DB, sub.id, ["出错乐队"]);

  vi.spyOn(showstart, "searchArtistStrict").mockRejectedValue(new Error("network down"));
  const ctx = createExecutionContext();
  const res = await app.request(`/api/manage?token=${sub.token}`, {}, env, ctx);
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.artists.find((a: any) => a.name === "出错乐队").avatar).toBeNull();
  await waitOnExecutionContext(ctx);
  const rows = await listArtists(env.DB, sub.id);
  expect(rows.find((a) => a.name === "出错乐队")!.avatar).toBeNull();
});

it("unknown token returns 404 everywhere", async () => {
  expect((await app.request("/api/manage?token=nope", {}, env)).status).toBe(404);
  expect((await app.request("/api/manage/cities?token=nope", j({ cities: ["110000"] }), env)).status).toBe(404);
});

it("remove artists", async () => {
  const sub = await activeSub();
  const id = await addArtistToSubscription(env.DB, sub.id, "海龟先生");
  expect((await listArtists(env.DB, sub.id)).length).toBe(2);
  const del = await app.request(`/api/manage/artists/${id}?token=${sub.token}`, { method: "DELETE" }, env);
  expect(del.status).toBe(200);
  expect((await listArtists(env.DB, sub.id)).map((a) => a.name)).toEqual(["刺猬"]);
});

it("adding an artist links it to already-crawled upcoming shows", async () => {
  const sub = await activeSub();
  const show = await upsertShow(env.DB, {
    showstartId: "901", title: "海龟先生巡演", cityCode: "110000", venue: "MAO",
    showTime: "2099-09-01T20:00:00", price: "200", url: "https://x/901", performers: ["海龟先生"],
    poster: null,
  });
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(
      JSON.stringify({
        request: {
          code: 0,
          data: {
            dirinfo: { title: "L" },
            songlist_size: 1,
            songlist: [{ name: "s1", singer: [{ name: "海龟先生" }] }],
          },
        },
      }),
    ),
  ));
  await app.request(`/api/manage/import?token=${sub.token}`, j({ link: "https://y.qq.com/n/ryqq/playlist/9" }), env);
  const res = await app.request(`/api/manage?token=${sub.token}`, {}, env, createExecutionContext());
  const body = (await res.json()) as any;
  expect(body.shows.map((s: any) => s.id)).toEqual([show.id]);
  vi.unstubAllGlobals();
});

it("import persists playlist avatars for new artists and heals existing avatar-less ones", async () => {
  const sub = await activeSub(); // 刺猬 already followed, avatar null
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          request: {
            code: 0,
            data: {
              dirinfo: { title: "L" },
              songlist_size: 2,
              songlist: [
                { name: "s1", singer: [{ name: "刺猬", mid: "002IZbHE0PLcjs" }] },
                { name: "s2", singer: [{ name: "新乐队", mid: "000NewBand0X" }] },
              ],
            },
          },
        }),
      ),
    ),
  );
  const res = await app.request(
    `/api/manage/import?token=${sub.token}`,
    j({ link: "https://y.qq.com/n/ryqq/playlist/9" }),
    env,
  );
  expect(res.status).toBe(200);
  const byName = Object.fromEntries(
    (await listArtists(env.DB, sub.id)).map((a) => [a.name, a.avatar]),
  );
  // new artist inserted with its playlist avatar
  expect(byName["新乐队"]).toBe("https://y.qq.com/music/photo_new/T001R300x300M000000NewBand0X.jpg");
  // pre-existing artist without an avatar healed by the re-import
  expect(byName["刺猬"]).toBe("https://y.qq.com/music/photo_new/T001R300x300M000002IZbHE0PLcjs.jpg");
  vi.unstubAllGlobals();
});

it("importing a netease playlist stores each artist's netease id for later exact avatar lookups", async () => {
  const sub = await activeSub();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/api/v6/playlist/detail")) {
        return new Response(JSON.stringify({ playlist: { name: "N", trackIds: [{ id: 1 }] } }));
      }
      if (url.includes("/api/v3/song/detail")) {
        return new Response(
          JSON.stringify({
            songs: [
              { id: 1, name: "s", ar: [{ id: 36012, name: "万能青年旅店" }, { id: 45001, name: "低苦艾" }] },
            ],
          }),
        );
      }
      if (url.includes("/api/artist/head/info/get")) {
        return new Response(
          JSON.stringify({ data: { artist: { avatar: "http://p2.music.126.net/wqny.jpg" } } }),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  const res = await app.request(
    `/api/manage/import?token=${sub.token}`,
    j({ link: "https://music.163.com/#/playlist?id=42" }),
    env,
  );
  expect(res.status).toBe(200);
  const rows = await listArtists(env.DB, sub.id);
  const wq = rows.find((a) => a.name === "万能青年旅店")!;
  expect(wq.neteaseId).toBe("36012");
  expect(wq.avatar).toBe("https://p2.music.126.net/wqny.jpg");
  expect(rows.find((a) => a.name === "低苦艾")!.neteaseId).toBe("45001");
  vi.unstubAllGlobals();
});

it("backfill prefers the stored netease id over a Showstart name search", async () => {
  const sub = await activeSub();
  const withId = await upsertArtist(env.DB, "梅卡德尔", null, "30016");
  await env.DB.prepare(
    "INSERT INTO subscription_artists (subscription_id, artist_id) VALUES (?, ?)",
  ).bind(sub.id, withId.id).run();

  const neteaseSpy = vi
    .spyOn(netease, "fetchArtistAvatar")
    .mockResolvedValue("https://p2.music.126.net/mkd.jpg");
  const showstartSpy = vi.mocked(showstart.searchArtistStrict);
  showstartSpy.mockClear();

  const ctx = createExecutionContext();
  const res = await app.request(`/api/manage?token=${sub.token}`, {}, env, ctx);
  expect(res.status).toBe(200);
  await waitOnExecutionContext(ctx);

  expect(neteaseSpy).toHaveBeenCalledWith("30016");
  // 梅卡德尔 went through netease; only the id-less 刺猬 fell back to Showstart.
  expect(showstartSpy).toHaveBeenCalledTimes(1);
  expect(showstartSpy).toHaveBeenCalledWith("刺猬");
  const rows = await listArtists(env.DB, sub.id);
  expect(rows.find((a) => a.name === "梅卡德尔")!.avatar).toBe("https://p2.music.126.net/mkd.jpg");
});

it("a searched-empty (\"\") artist WITH a netease id is retried via netease", async () => {
  const sub = await activeSub();
  const artist = await upsertArtist(env.DB, "盘尼西林", null, "13282");
  await setArtistAvatar(env.DB, artist.id, ""); // Showstart already missed it
  await env.DB.prepare(
    "INSERT INTO subscription_artists (subscription_id, artist_id) VALUES (?, ?)",
  ).bind(sub.id, artist.id).run();

  vi.spyOn(netease, "fetchArtistAvatar").mockResolvedValue("https://p2.music.126.net/pns.jpg");

  const ctx = createExecutionContext();
  await app.request(`/api/manage?token=${sub.token}`, {}, env, ctx);
  await waitOnExecutionContext(ctx);

  const rows = await listArtists(env.DB, sub.id);
  expect(rows.find((a) => a.name === "盘尼西林")!.avatar).toBe("https://p2.music.126.net/pns.jpg");
});

it("netease definitively having no photo falls back to Showstart once, then caches \"\" and clears the id (no retry loop)", async () => {
  const sub = await activeSub();
  const artist = await upsertArtist(env.DB, "无照片乐队", null, "40404");
  await env.DB.prepare(
    "INSERT INTO subscription_artists (subscription_id, artist_id) VALUES (?, ?)",
  ).bind(sub.id, artist.id).run();

  const neteaseSpy = vi.spyOn(netease, "fetchArtistAvatar").mockResolvedValue(null);
  const showstartSpy = vi.mocked(showstart.searchArtistStrict); // top-level mock: resolves null

  const ctx = createExecutionContext();
  await app.request(`/api/manage?token=${sub.token}`, {}, env, ctx);
  await waitOnExecutionContext(ctx);

  const row = (await getAllArtists(env.DB)).find((a) => a.name === "无照片乐队")!;
  expect(row.avatar).toBe(""); // both sources definitively missed
  expect(row.neteaseId).toBeNull(); // id cleared -> not retried forever

  // Second load: nothing pending for this artist anymore.
  neteaseSpy.mockClear();
  showstartSpy.mockClear();
  const ctx2 = createExecutionContext();
  await app.request(`/api/manage?token=${sub.token}`, {}, env, ctx2);
  await waitOnExecutionContext(ctx2);
  expect(neteaseSpy).not.toHaveBeenCalled();
  expect(showstartSpy).not.toHaveBeenCalledWith("无照片乐队");
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

it("importing a second, different playlist merges and dedupes across playlists", async () => {
  const sub = await activeSub();
  const before = (await listArtists(env.DB, sub.id)).length;

  function qqList(title: string, names: string[]) {
    return new Response(
      JSON.stringify({
        request: {
          code: 0,
          data: {
            dirinfo: { title },
            songlist_size: names.length,
            songlist: names.map((n, i) => ({ name: `s${i}`, singer: [{ name: n }] })),
          },
        },
      }),
    );
  }

  // 歌单 A：痛仰乐队 + 海龟先生
  vi.stubGlobal("fetch", vi.fn(async () => qqList("A", ["痛仰乐队", "海龟先生"])));
  const a = await app.request(
    `/api/manage/import?token=${sub.token}`,
    j({ link: "https://y.qq.com/n/ryqq/playlist/1" }),
    env,
  );
  expect(((await a.json()) as any).added).toBe(2);

  // 歌单 B：海龟先生（与 A 重叠）+ 达达乐队（新）
  vi.stubGlobal("fetch", vi.fn(async () => qqList("B", ["海龟先生", "达达乐队"])));
  const b = await app.request(
    `/api/manage/import?token=${sub.token}`,
    j({ link: "https://y.qq.com/n/ryqq/playlist/2" }),
    env,
  );
  // 只有达达乐队是新的；海龟先生已被 A 带进来了
  expect(((await b.json()) as any).added).toBe(1);

  const names = (await listArtists(env.DB, sub.id)).map((x) => x.name);
  expect(names).toContain("痛仰乐队");
  expect(names).toContain("海龟先生");
  expect(names).toContain("达达乐队");
  // 重叠的海龟先生只有一条，没有变成两行
  expect(names.filter((n) => n === "海龟先生").length).toBe(1);
  expect(names.length).toBe(before + 3);

  vi.unstubAllGlobals();
});
