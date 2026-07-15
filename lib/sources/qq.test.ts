import { describe, it, expect } from "vitest";
import { transformQqDetail } from "./qq";

const DATA = {
  dirinfo: { title: "摇滚精神 · 身临其境的叙事现场" },
  songlist_size: 3,
  songlist: [
    { name: "故乡", singer: [{ name: "许巍", mid: "003tMF3k1s9DZv" }] },
    { name: "西湖", singer: [{ name: "痛仰乐队" }] },
    {
      name: "河北墨麒麟",
      singer: [{ name: "万能青年旅店", mid: "001Ff2mV3QP6Cv" }, { name: "客座嘉宾" }],
    },
  ],
};

describe("transformQqDetail", () => {
  it("maps dirinfo.title and songlist to a QqPlaylist, building avatars from singer mid", () => {
    const pl = transformQqDetail(DATA);
    expect(pl.title).toBe("摇滚精神 · 身临其境的叙事现场");
    expect(pl.songs).toHaveLength(3);
    expect(pl.songs[0]).toEqual({
      name: "故乡",
      artists: [
        {
          name: "许巍",
          avatar: "https://y.qq.com/music/photo_new/T001R300x300M000003tMF3k1s9DZv.jpg",
        },
      ],
    });
  });
  it("keeps multiple singers as an array; a singer without a mid gets no avatar", () => {
    expect(transformQqDetail(DATA).songs[2].artists).toEqual([
      {
        name: "万能青年旅店",
        avatar: "https://y.qq.com/music/photo_new/T001R300x300M000001Ff2mV3QP6Cv.jpg",
      },
      { name: "客座嘉宾" },
    ]);
  });
  it("a singer with a name but no mid still comes through, avatar-less", () => {
    expect(transformQqDetail(DATA).songs[1].artists).toEqual([{ name: "痛仰乐队" }]);
  });
  it("returns empty title/songs for missing data", () => {
    expect(transformQqDetail({})).toEqual({ title: "", songs: [] });
  });
});
