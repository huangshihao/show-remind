import { describe, it, expect, vi, afterEach } from "vitest";
import { scraperClient, ScraperError } from "./scraper-client";

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown, url = "http://localhost:8001/x") {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    url,
    json: async () => body,
  } as Response);
}

describe("scraperClient", () => {
  it("parses a valid qq playlist", async () => {
    const spy = mockFetch(200, { title: "t", songs: [{ name: "s", artists: ["a"] }] });
    const r = await scraperClient.qqPlaylist("123");
    expect(r.songs[0].artists).toEqual(["a"]);
    expect(spy.mock.calls[0][0]).toContain("/qq/playlist/123");
  });

  it("throws ScraperError on non-2xx", async () => {
    mockFetch(502, { detail: "boom" });
    await expect(scraperClient.showDetail("1")).rejects.toBeInstanceOf(ScraperError);
  });

  it("throws on schema mismatch (contract drift)", async () => {
    mockFetch(200, { shows: [{ showstartId: 1 }] }); // wrong types/missing fields
    await expect(scraperClient.cityShows("310000", 1)).rejects.toThrow();
  });

  it("builds the city-shows url with page", async () => {
    const spy = mockFetch(200, { shows: [] });
    await scraperClient.cityShows("310000", 2);
    expect(spy.mock.calls[0][0]).toContain("/showstart/cities/310000/shows?page=2");
  });
});
