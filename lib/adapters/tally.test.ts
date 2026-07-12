import { describe, it, expect } from "vitest";
import { tallyArtists } from "./tally";
import type { ResolvedPlaylist } from "./types";

const pl: ResolvedPlaylist = {
  platform: "netease",
  externalId: "1",
  title: "t",
  songs: [
    { name: "a", artists: ["万能青年旅店"] },
    { name: "b", artists: ["万能青年旅店", "重塑雕像的权利"] },
    { name: "c", artists: ["重塑雕像的权利"] },
    { name: "d", artists: ["重塑雕像的权利"] },
  ],
};

describe("tallyArtists", () => {
  it("counts songs per artist and sorts desc then name asc", () => {
    expect(tallyArtists(pl)).toEqual([
      { name: "重塑雕像的权利", songCount: 3 },
      { name: "万能青年旅店", songCount: 2 },
    ]);
  });
});
