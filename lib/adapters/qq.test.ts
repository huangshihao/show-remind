import { describe, it, expect, vi, afterEach } from "vitest";
import * as client from "@/lib/scraper-client";
import { resolveQqPlaylist } from "./qq";

afterEach(() => vi.restoreAllMocks());

describe("resolveQqPlaylist", () => {
  it("maps scraper playlist to ResolvedPlaylist", async () => {
    vi.spyOn(client.scraperClient, "qqPlaylist").mockResolvedValue({
      title: "摇滚",
      songs: [{ name: "s", artists: ["万能青年旅店", "客座"] }],
    });
    const r = await resolveQqPlaylist("42");
    expect(r).toEqual({
      platform: "qq",
      externalId: "42",
      title: "摇滚",
      songs: [{ name: "s", artists: ["万能青年旅店", "客座"] }],
    });
  });
});
