import { describe, it, expect } from "vitest";
import { tallyArtists } from "./tally";
import type { ResolvedPlaylist } from "./types";

const pl: ResolvedPlaylist = {
  platform: "netease",
  externalId: "1",
  title: "t",
  songs: [
    { name: "a", artists: [{ name: "万能青年旅店" }] },
    { name: "b", artists: [{ name: "万能青年旅店" }, { name: "重塑雕像的权利" }] },
    { name: "c", artists: [{ name: "重塑雕像的权利" }] },
    { name: "d", artists: [{ name: "重塑雕像的权利" }] },
  ],
};

describe("tallyArtists", () => {
  it("counts songs per artist and sorts desc then name asc", () => {
    expect(tallyArtists(pl)).toEqual([
      { name: "重塑雕像的权利", songCount: 3 },
      { name: "万能青年旅店", songCount: 2 },
    ]);
  });

  it("carries avatar and sourceId through, first non-empty value wins", () => {
    const withMeta: ResolvedPlaylist = {
      platform: "qq",
      externalId: "2",
      title: "t",
      songs: [
        { name: "a", artists: [{ name: "刺猬" }] },
        { name: "b", artists: [{ name: "刺猬", avatar: "https://img/1.jpg", sourceId: "11" }] },
        // later, different values must NOT overwrite the first non-empty ones
        { name: "c", artists: [{ name: "刺猬", avatar: "https://img/2.jpg", sourceId: "22" }] },
      ],
    };
    expect(tallyArtists(withMeta)).toEqual([
      { name: "刺猬", songCount: 3, avatar: "https://img/1.jpg", sourceId: "11" },
    ]);
  });

  it("dedupes the same artist within one song without double counting", () => {
    const dup: ResolvedPlaylist = {
      platform: "qq",
      externalId: "3",
      title: "t",
      songs: [{ name: "a", artists: [{ name: "刺猬" }, { name: "刺猬", avatar: "https://img/3.jpg" }] }],
    };
    expect(tallyArtists(dup)).toEqual([{ name: "刺猬", songCount: 1, avatar: "https://img/3.jpg" }]);
  });
});
