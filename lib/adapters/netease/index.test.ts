import { describe, it, expect, vi, afterEach } from "vitest";
import playlistDetail from "./__fixtures__/playlist_detail.json";
import songDetail from "./__fixtures__/song_detail.json";
import * as client from "./client";
import { parsePlaylistMeta, parseSongDetail, resolveNeteasePlaylist } from "./index";

afterEach(() => vi.restoreAllMocks());

describe("netease parsing", () => {
  it("extracts title and trackIds", () => {
    expect(parsePlaylistMeta(playlistDetail)).toEqual({
      title: "我的摇滚",
      trackIds: ["111", "222", "333"],
    });
  });
  it("maps songs with artist arrays", () => {
    expect(parseSongDetail(songDetail)).toEqual([
      { name: "杀死那个石家庄人", artists: ["万能青年旅店"] },
      { name: "河北墨麒麟", artists: ["万能青年旅店", "客座"] },
      { name: "Pyramid Song", artists: ["Radiohead"] },
    ]);
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
