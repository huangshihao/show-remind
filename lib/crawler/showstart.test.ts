import { describe, it, expect, vi, afterEach } from "vitest";
import * as client from "@/lib/scraper-client";
import * as showsRepo from "@/lib/repositories/shows";
import { crawlCities } from "./showstart";

afterEach(() => vi.restoreAllMocks());

describe("crawlCities", () => {
  it("fetches details only for new shows and upserts them", async () => {
    vi.spyOn(client.scraperClient, "cityShows").mockResolvedValue({
      shows: [
        { showstartId: "1", title: "A", cityCode: "310000", showTime: null, url: "u1" },
        { showstartId: "2", title: "B", cityCode: "310000", showTime: null, url: "u2" },
      ],
    });
    vi.spyOn(showsRepo, "filterNewShowstartIds").mockResolvedValue(["2"]);
    const detailSpy = vi.spyOn(client.scraperClient, "showDetail").mockResolvedValue({
      showstartId: "2", title: "B", cityCode: "310000", venue: "V", showTime: null,
      price: null, url: "u2", performers: ["万能青年旅店"],
    });
    const upsertSpy = vi.spyOn(showsRepo, "upsertShow").mockResolvedValue({ id: "db2", showstartId: "2" });

    const result = await crawlCities(["310000"]);
    expect(detailSpy).toHaveBeenCalledOnce();
    expect(detailSpy).toHaveBeenCalledWith("2");
    expect(upsertSpy).toHaveBeenCalledOnce();
    expect(result.newShowIds).toEqual(["db2"]);
    expect(result.failedCities).toEqual([]);
  });

  it("isolates a failing city", async () => {
    vi.spyOn(client.scraperClient, "cityShows").mockRejectedValue(new Error("sign fail"));
    const result = await crawlCities(["310000"]);
    expect(result.failedCities).toEqual(["310000"]);
    expect(result.newShowIds).toEqual([]);
  });
});
