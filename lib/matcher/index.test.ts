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

  // The lineup is the only evidence that an artist is actually playing. A title
  // naming an artist proves nothing — every one of these is a real false positive
  // this matcher produced against live Showstart data.
  it("does not match a tribute night that only names the artist in its title", () => {
    const avril: MatchArtist = {
      id: "av", name: "Avril Lavigne", normalizedName: "avril lavigne", aliases: [],
    };
    const shows: MatchShow[] = [
      {
        id: "s2",
        title: "Avril Lavigne &Ladies Rock 艾薇儿&歌后联盟摇滚传奇致敬之夜",
        performers: ["Red Star"], // a tribute act — Avril is not on this bill
      },
    ];
    expect(matchShows([avril], shows)).toEqual([]);
  });

  it("does not match when the artist's name is another band's tour title (The Cure ≠ 声子虫《THE CURE》)", () => {
    const cure: MatchArtist = { id: "c", name: "The Cure", normalizedName: "the cure", aliases: [] };
    const shows: MatchShow[] = [
      { id: "s3", title: '声子虫2026《THE CURE》"解药"巡演 上海站', performers: ["声子虫乐队"] },
    ];
    expect(matchShows([cure], shows)).toEqual([]);
  });

  it("ignores a show with no lineup at all, however suggestive its title", () => {
    const shows: MatchShow[] = [{ id: "s4", title: "Radiohead 2026 巡演 上海", performers: [] }];
    expect(matchShows([radiohead], shows)).toEqual([]);
  });

  it("matches on the lineup even when the title also names the artist", () => {
    const shows: MatchShow[] = [
      { id: "s5", title: "Radiohead night", performers: ["Radiohead"] },
    ];
    expect(matchShows([radiohead], shows)).toEqual([
      { showId: "s5", artistId: "a2", matchedBy: "performer" },
    ]);
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

  const wachi: MatchArtist = { id: "w", name: "蛙池", normalizedName: "蛙池", aliases: [] };
  const gala: MatchArtist = { id: "g", name: "GALA", normalizedName: "gala", aliases: [] };

  it("matches a Chinese name against a bilingual performer (蛙池 ← 蛙池WaChi)", () => {
    const shows: MatchShow[] = [{ id: "s7", title: "音乐节", performers: ["蛙池WaChi"] }];
    expect(matchShows([wachi], shows)).toEqual([
      { showId: "s7", artistId: "w", matchedBy: "performer" },
    ]);
  });

  it("does NOT falsely match a name that is only a substring of a segment (GALA ≠ Galaxy Blind-box)", () => {
    const shows: MatchShow[] = [{ id: "s8", title: "音乐节", performers: ["宇宙盲盒Galaxy Blind-box"] }];
    expect(matchShows([gala], shows)).toEqual([]);
  });

  it("still matches an all-Latin band whose name has spaces, without matching a single word", () => {
    const chineseFootball: MatchArtist = {
      id: "cf", name: "Chinese Football", normalizedName: "chinese football", aliases: [],
    };
    const football: MatchArtist = { id: "fb", name: "Football", normalizedName: "football", aliases: [] };
    const shows: MatchShow[] = [{ id: "s9", title: "x", performers: ["Chinese Football"] }];
    expect(matchShows([chineseFootball, football], shows)).toEqual([
      { showId: "s9", artistId: "cf", matchedBy: "performer" },
    ]);
  });
});
