import { describe, it, expect, vi, afterEach } from "vitest";
import playlistDetail from "./__fixtures__/playlist_detail.json";
import songDetail from "./__fixtures__/song_detail.json";
import * as client from "./client";
import {
  parsePlaylistMeta,
  parseSongDetail,
  parseArtistAvatar,
  fetchArtistAvatar,
  resolveNeteasePlaylist,
} from "./index";

afterEach(() => vi.restoreAllMocks());

describe("netease parsing", () => {
  it("extracts title and trackIds", () => {
    expect(parsePlaylistMeta(playlistDetail)).toEqual({
      title: "我的摇滚",
      trackIds: ["111", "222", "333"],
    });
  });
  it("maps songs with artist arrays, capturing the netease artist id as sourceId", () => {
    expect(parseSongDetail(songDetail)).toEqual([
      { name: "杀死那个石家庄人", artists: [{ name: "万能青年旅店", sourceId: "36012" }] },
      {
        name: "河北墨麒麟",
        artists: [{ name: "万能青年旅店", sourceId: "36012" }, { name: "客座" }],
      },
      { name: "Pyramid Song", artists: [{ name: "Radiohead", sourceId: "94152" }] },
    ]);
  });
});

describe("parseArtistAvatar", () => {
  it("reads data.artist.avatar and upgrades http:// to https:// (the API returns http, pages are https)", () => {
    const raw = {
      code: 200,
      data: { artist: { id: 36012, avatar: "http://p2.music.126.net/abc==/109951.jpg" } },
    };
    expect(parseArtistAvatar(raw)).toBe("https://p2.music.126.net/abc==/109951.jpg");
  });
  it("falls back to cover, and to null when neither is present", () => {
    expect(
      parseArtistAvatar({ data: { artist: { cover: "https://p1.music.126.net/c.jpg" } } }),
    ).toBe("https://p1.music.126.net/c.jpg");
    expect(parseArtistAvatar({ data: { artist: {} } })).toBeNull();
    expect(parseArtistAvatar({})).toBeNull();
  });
});

describe("fetchArtistAvatar", () => {
  it("fetches head info by artist id and returns the parsed avatar", async () => {
    const spy = vi.spyOn(client, "fetchArtistHeadRaw").mockResolvedValue({
      code: 200,
      data: { artist: { id: 36012, avatar: "http://p2.music.126.net/abc.jpg" } },
    });
    await expect(fetchArtistAvatar("36012")).resolves.toBe("https://p2.music.126.net/abc.jpg");
    expect(spy).toHaveBeenCalledWith("36012");
  });
});

describe("resolveNeteasePlaylist", () => {
  it("resolves title + all songs, batching trackIds", async () => {
    vi.spyOn(client, "fetchPlaylistDetailRaw").mockResolvedValue(playlistDetail);
    const songSpy = vi.spyOn(client, "fetchSongDetailRaw").mockResolvedValue(songDetail);
    const r = await resolveNeteasePlaylist("999");
    expect(r.platform).toBe("netease");
    expect(r.externalId).toBe("999");
    expect(r.title).toBe("我的摇滚");
    expect(r.songs).toHaveLength(3);
    expect(songSpy).toHaveBeenCalledTimes(1); // 3 ids -> 1 batch
  });

  it("throws if a song batch fails (no partial data)", async () => {
    vi.spyOn(client, "fetchPlaylistDetailRaw").mockResolvedValue(playlistDetail);
    vi.spyOn(client, "fetchSongDetailRaw").mockRejectedValue(new Error("risk control"));
    await expect(resolveNeteasePlaylist("999")).rejects.toThrow("risk control");
  });
});
