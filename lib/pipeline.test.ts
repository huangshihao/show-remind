import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { upsertArtist } from "@/lib/repositories/artists";
import { upsertShow } from "@/lib/repositories/shows";
import { matchNewShows } from "./pipeline";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
afterEach(() => vi.restoreAllMocks());

describe("matchNewShows", () => {
  it("creates show_artists for followed artists appearing in performers", async () => {
    const user = await prisma.user.create({ data: { email: `p_${uid()}@e.com`, passwordHash: "x" } });
    const artist = await upsertArtist(`万能青年旅店_${uid()}`);
    await prisma.userArtist.create({ data: { userId: user.id, artistId: artist.id, status: "followed" } });
    const show = await upsertShow({
      showstartId: `S_${uid()}`, title: "巡演", cityCode: "310000", venue: "V",
      showTime: null, price: null, url: "http://x", performers: [artist.name],
    });
    const created = await matchNewShows([show.id]);
    expect(created).toBeGreaterThanOrEqual(1);
    const sa = await prisma.showArtist.findFirst({ where: { showId: show.id, artistId: artist.id } });
    expect(sa?.matchedBy).toBe("performer");
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
