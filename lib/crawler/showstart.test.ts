import { describe, it, expect, vi, afterEach } from "vitest";
import * as showsRepo from "@/lib/repositories/shows";
import { fetchCityShows, fetchShowDetail } from "@/lib/sources/showstart";
import { crawlCities } from "./showstart";

vi.mock("@/lib/sources/showstart", () => ({
  fetchCityShows: vi.fn(),
  fetchShowDetail: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("crawlCities", () => {
  it("fetches details only for new shows and upserts them", async () => {
    vi.mocked(fetchCityShows).mockResolvedValue({
      shows: [
        { showstartId: "1", title: "A", cityCode: "310000", showTime: null, url: "u1" },
        { showstartId: "2", title: "B", cityCode: "310000", showTime: null, url: "u2" },
      ],
    });
    vi.spyOn(showsRepo, "filterNewShowstartIds").mockResolvedValue(["2"]);
    vi.mocked(fetchShowDetail).mockResolvedValue({
      showstartId: "2", title: "B", cityCode: "310000", venue: "V", showTime: null,
      price: null, url: "u2", performers: ["万能青年旅店"],
    });
    const upsertSpy = vi.spyOn(showsRepo, "upsertShow").mockResolvedValue({ id: "db2", showstartId: "2" });

    const result = await crawlCities(["310000"]);
    expect(fetchShowDetail).toHaveBeenCalledOnce();
    expect(fetchShowDetail).toHaveBeenCalledWith("2");
    expect(upsertSpy).toHaveBeenCalledOnce();
    expect(result.newShowIds).toEqual(["db2"]);
    expect(result.failedCities).toEqual([]);
  });

  it("isolates a failing city", async () => {
    vi.mocked(fetchCityShows).mockRejectedValue(new Error("sign fail"));
    const result = await crawlCities(["310000"]);
    expect(result.failedCities).toEqual(["310000"]);
    expect(result.newShowIds).toEqual([]);
  });
});
