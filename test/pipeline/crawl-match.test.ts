import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import { crawlCity } from "../../src/pipeline/crawl";
import { matchNewShows } from "../../src/pipeline/match";
import { upsertArtist } from "../../src/db/artists";
import { getShowsByIds } from "../../src/db/shows";
import * as showstart from "@/lib/sources/showstart";

beforeEach(applySchema);

it("crawlCity upserts only unseen shows and returns their ids", async () => {
  vi.spyOn(showstart, "fetchCityShows").mockResolvedValue({
    shows: [
      { showstartId: "1", title: "刺猬专场", cityCode: "110000", showTime: null, url: "u1", poster: null },
      { showstartId: "2", title: "达达", cityCode: "110000", showTime: null, url: "u2", poster: null },
    ],
  });
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

it("matchNewShows links shows to followed artists by performer", async () => {
  vi.spyOn(showstart, "fetchCityShows").mockResolvedValue({
    shows: [{ showstartId: "1", title: "x", cityCode: "110000", showTime: null, url: "u1", poster: null }],
  });
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
