import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import { crawlCity } from "../../src/pipeline/crawl";
import { matchNewShows, matchArtistsToExistingShows } from "../../src/pipeline/match";
import { upsertArtist } from "../../src/db/artists";
import { getShowsByIds, upsertShow } from "../../src/db/shows";
import * as showstart from "@/lib/sources/showstart";

beforeEach(applySchema);

// Page 1 returns the given shows, every later page is empty (end of list).
function mockCityPages(shows: any[]) {
  vi.spyOn(showstart, "fetchCityShows").mockImplementation(async (_city: string, page: number) =>
    page === 1 ? { shows } : { shows: [] },
  );
}

it("crawlCity upserts only unseen shows and returns their ids", async () => {
  mockCityPages([
    { showstartId: "1", title: "刺猬专场", cityCode: "110000", showTime: null, url: "u1", poster: null },
    { showstartId: "2", title: "达达", cityCode: "110000", showTime: null, url: "u2", poster: null },
  ]);
  vi.spyOn(showstart, "fetchShowDetail").mockImplementation(async (id: string) => ({
    showstartId: id, title: `t${id}`, cityCode: "110000", venue: "MAO",
    showTime: "2026-08-01T20:00:00", price: "180", url: `u${id}`, performers: ["刺猬"],
    poster: `https://s2.showstart.com/${id}.jpg`,
  }));

  const ids = await crawlCity(env.DB, "110000");
  expect(ids.length).toBe(2);
  // second run sees them as known
  expect((await crawlCity(env.DB, "110000")).length).toBe(0);
  vi.restoreAllMocks();
});

it("crawlCity paginates until an empty page", async () => {
  const page1 = [
    { showstartId: "1", title: "a", cityCode: "110000", showTime: null, url: "u1", poster: null },
    { showstartId: "2", title: "b", cityCode: "110000", showTime: null, url: "u2", poster: null },
  ];
  const page2 = [
    { showstartId: "3", title: "c", cityCode: "110000", showTime: null, url: "u3", poster: null },
  ];
  vi.spyOn(showstart, "fetchCityShows").mockImplementation(async (_city: string, page: number) =>
    page === 1 ? { shows: page1 } : page === 2 ? { shows: page2 } : { shows: [] },
  );
  vi.spyOn(showstart, "fetchShowDetail").mockImplementation(async (id: string) => ({
    showstartId: id, title: `t${id}`, cityCode: "110000", venue: null,
    showTime: null, price: null, url: `u${id}`, performers: [], poster: null,
  }));

  const ids = await crawlCity(env.DB, "110000");
  expect(ids.length).toBe(3); // 2 from page 1 + 1 from page 2
  vi.restoreAllMocks();
});

it("crawlCity falls back to the crawled city when the detail response has no city", async () => {
  mockCityPages([{ showstartId: "7", title: "x", cityCode: "110000", showTime: null, url: "u7", poster: null }]);
  // Showstart's detail API omits cityId, so fetchShowDetail yields cityCode "".
  vi.spyOn(showstart, "fetchShowDetail").mockResolvedValue({
    showstartId: "7", title: "x", cityCode: "", venue: null,
    showTime: null, price: null, url: "u7", performers: ["刺猬"], poster: null,
  });
  const ids = await crawlCity(env.DB, "110000");
  expect((await getShowsByIds(env.DB, ids))[0].cityCode).toBe("110000");
  vi.restoreAllMocks();
});

it("matchArtistsToExistingShows links newly-followed artists to already-crawled shows", async () => {
  const show = await upsertShow(env.DB, {
    showstartId: "10", title: "刺猬夏日专场", cityCode: "110000", venue: null,
    showTime: "2099-08-01T20:00:00", price: null, url: "u10", performers: ["刺猬"], poster: null,
  });
  const other = await upsertShow(env.DB, {
    showstartId: "11", title: "无关演出", cityCode: "110000", venue: null,
    showTime: "2099-08-02T20:00:00", price: null, url: "u11", performers: ["别人"], poster: null,
  });
  const artist = await upsertArtist(env.DB, "刺猬");
  const n = await matchArtistsToExistingShows(env.DB, [artist.id]);
  expect(n).toBe(1);
  const { results } = await env.DB.prepare("SELECT show_id, artist_id FROM show_artists").all();
  expect(results).toEqual([{ show_id: show.id, artist_id: artist.id }]);
  expect(other.id).not.toBe(show.id);
});

it("matchArtistsToExistingShows with no artist ids is a no-op", async () => {
  expect(await matchArtistsToExistingShows(env.DB, [])).toBe(0);
});

it("matchNewShows links shows to followed artists by performer", async () => {
  mockCityPages([{ showstartId: "1", title: "x", cityCode: "110000", showTime: null, url: "u1", poster: null }]);
  vi.spyOn(showstart, "fetchShowDetail").mockResolvedValue({
    showstartId: "1", title: "x", cityCode: "110000", venue: null,
    showTime: null, price: null, url: "u1", performers: ["刺猬"], poster: null,
  });
  await upsertArtist(env.DB, "刺猬");
  const ids = await crawlCity(env.DB, "110000");
  const n = await matchNewShows(env.DB, ids);
  expect(n).toBe(1);
  expect((await getShowsByIds(env.DB, ids))[0].performers).toEqual(["刺猬"]);
  vi.restoreAllMocks();
});
