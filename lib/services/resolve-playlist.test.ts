import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import * as netease from "@/lib/adapters/netease";
import { createPlaylistFromLink, resolvePlaylist, getPlaylistTally } from "./resolve-playlist";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
afterEach(() => vi.restoreAllMocks());

describe("resolve-playlist", () => {
  it("stores a tally on success", async () => {
    const user = await prisma.user.create({ data: { email: `rp_${uid()}@e.com`, passwordHash: "x" } });
    vi.spyOn(netease, "resolveNeteasePlaylist").mockResolvedValue({
      platform: "netease", externalId: "123", title: "摇滚",
      songs: [
        { name: "a", artists: ["万能青年旅店"] },
        { name: "b", artists: ["万能青年旅店"] },
        { name: "c", artists: ["重塑雕像的权利"] },
      ],
    });
    const { playlistId } = await createPlaylistFromLink(user.id, "https://music.163.com/playlist?id=123");
    await resolvePlaylist(playlistId);
    const t = await getPlaylistTally(playlistId);
    expect(t.status).toBe("ready");
    expect(t.artists[0]).toEqual({ name: "万能青年旅店", songCount: 2 });
  });

  it("marks failed with a reason on adapter error", async () => {
    const user = await prisma.user.create({ data: { email: `rp_${uid()}@e.com`, passwordHash: "x" } });
    vi.spyOn(netease, "resolveNeteasePlaylist").mockRejectedValue(new Error("私密歌单"));
    const { playlistId } = await createPlaylistFromLink(user.id, "https://music.163.com/playlist?id=999");
    await resolvePlaylist(playlistId);
    const t = await getPlaylistTally(playlistId);
    expect(t.status).toBe("failed");
    expect(t.failureReason).toContain("私密歌单");
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
