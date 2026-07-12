import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { upsertArtist } from "./artists";
import { upsertShow } from "./shows";
import { persistMatches } from "./matches";
import { getUpcomingShowsForUser } from "./my-shows";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe("getUpcomingShowsForUser", () => {
  it("returns matched upcoming shows in followed cities", async () => {
    const user = await prisma.user.create({
      data: { email: `ms_${uid()}@e.com`, passwordHash: "x", cities: { create: { cityCode: "310000" } } },
    });
    const artist = await upsertArtist(`Band_${uid()}`);
    await prisma.userArtist.create({ data: { userId: user.id, artistId: artist.id, status: "followed" } });
    const show = await upsertShow({
      showstartId: `S_${uid()}`, title: "巡演 上海", cityCode: "310000", venue: "MAO",
      showTime: "2030-01-01T20:00:00", price: "180", url: "http://x", performers: [artist.name],
    });
    await persistMatches([{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);

    const rows = await getUpcomingShowsForUser(user.id);
    const mine = rows.find((r) => r.id === show.id);
    expect(mine).toBeTruthy();
    expect(mine?.artistNames).toContain(artist.name);
  });

  it("excludes shows outside followed cities", async () => {
    const user = await prisma.user.create({
      data: { email: `ms_${uid()}@e.com`, passwordHash: "x", cities: { create: { cityCode: "110000" } } },
    });
    const artist = await upsertArtist(`Band_${uid()}`);
    await prisma.userArtist.create({ data: { userId: user.id, artistId: artist.id, status: "followed" } });
    const show = await upsertShow({
      showstartId: `S_${uid()}`, title: "x", cityCode: "310000", venue: null,
      showTime: "2030-01-01T20:00:00", price: null, url: "http://x", performers: [artist.name],
    });
    await persistMatches([{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);
    const rows = await getUpcomingShowsForUser(user.id);
    expect(rows.find((r) => r.id === show.id)).toBeUndefined();
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
