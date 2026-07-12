import { describe, it, expect } from "vitest";
import { transformQqDetail } from "./qq";

const DATA = {
  dirinfo: { title: "摇滚精神 · 身临其境的叙事现场" },
  songlist_size: 3,
  songlist: [
    { name: "故乡", singer: [{ name: "许巍" }] },
    { name: "西湖", singer: [{ name: "痛仰乐队" }] },
    { name: "河北墨麒麟", singer: [{ name: "万能青年旅店" }, { name: "客座嘉宾" }] },
  ],
};

describe("transformQqDetail", () => {
  it("maps dirinfo.title and songlist to a QqPlaylist", () => {
    const pl = transformQqDetail(DATA);
    expect(pl.title).toBe("摇滚精神 · 身临其境的叙事现场");
    expect(pl.songs).toHaveLength(3);
    expect(pl.songs[0]).toEqual({ name: "故乡", artists: ["许巍"] });
  });
  it("keeps multiple singers as an array", () => {
    expect(transformQqDetail(DATA).songs[2].artists).toEqual(["万能青年旅店", "客座嘉宾"]);
  });
  it("returns empty title/songs for missing data", () => {
    expect(transformQqDetail({})).toEqual({ title: "", songs: [] });
  });
});
