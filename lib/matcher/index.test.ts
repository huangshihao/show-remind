import { describe, it, expect } from "vitest";
import { matchShows, type MatchArtist, type MatchShow } from "./index";

const wanqing: MatchArtist = {
  id: "a1",
  name: "万能青年旅店",
  normalizedName: "万能青年旅店",
  aliases: ["万青"],
};
const radiohead: MatchArtist = {
  id: "a2",
  name: "Radiohead",
  normalizedName: "radiohead",
  aliases: [],
};

describe("matchShows", () => {
  it("matches by exact performer", () => {
    const shows: MatchShow[] = [{ id: "s1", title: "Live", performers: ["万能青年旅店"] }];
    expect(matchShows([wanqing], shows)).toEqual([
      { showId: "s1", artistId: "a1", matchedBy: "performer" },
    ]);
  });

  it("matches by alias against performers", () => {
    const shows: MatchShow[] = [{ id: "s1", title: "x", performers: ["万青"] }];
    expect(matchShows([wanqing], shows)[0].matchedBy).toBe("performer");
  });

  it("falls back to title contains", () => {
    const shows: MatchShow[] = [
      { id: "s2", title: "Radiohead 2026 巡演 上海", performers: [] },
    ];
    expect(matchShows([radiohead], shows)).toEqual([
      { showId: "s2", artistId: "a2", matchedBy: "title" },
    ]);
  });

  it("prefers performer over title when both would hit", () => {
    const shows: MatchShow[] = [
      { id: "s3", title: "Radiohead night", performers: ["Radiohead"] },
    ];
    expect(matchShows([radiohead], shows)[0].matchedBy).toBe("performer");
  });

  it("does not title-match single-character normalized names", () => {
    const short: MatchArtist = { id: "a3", name: "P", normalizedName: "p", aliases: [] };
    const shows: MatchShow[] = [{ id: "s4", title: "power up party", performers: [] }];
    expect(matchShows([short], shows)).toEqual([]);
  });

  it("normalizes fullwidth/case on both sides", () => {
    const shows: MatchShow[] = [{ id: "s5", title: "x", performers: ["ＲＡＤＩＯＨＥＡＤ"] }];
    expect(matchShows([radiohead], shows)[0].matchedBy).toBe("performer");
  });

  it("emits at most one match per (show, artist)", () => {
    const shows: MatchShow[] = [
      { id: "s6", title: "万能青年旅店 万青 专场", performers: ["万能青年旅店"] },
    ];
    expect(matchShows([wanqing], shows)).toHaveLength(1);
  });
});
