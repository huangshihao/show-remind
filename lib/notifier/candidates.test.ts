import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { upsertArtist } from "@/lib/repositories/artists";
import { upsertShow } from "@/lib/repositories/shows";
import { persistMatches } from "@/lib/repositories/matches";
import { findNotifyCandidates } from "./candidates";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe("findNotifyCandidates", () => {
  it("includes a matched show in a followed city, excludes already-notified", async () => {
    const email = `c_${uid()}@e.com`;
    const user = await prisma.user.create({
      data: { email, passwordHash: "x", emailVerified: new Date(), cities: { create: { cityCode: "310000" } } },
    });
    const artist = await upsertArtist(`Band_${uid()}`);
    await prisma.userArtist.create({ data: { userId: user.id, artistId: artist.id, status: "followed" } });
    const show = await upsertShow({
      showstartId: `S_${uid()}`, title: "T", cityCode: "310000", venue: "V",
      showTime: "2027-01-01T20:00:00", price: "100", url: "http://x", performers: [artist.name],
    });
    await persistMatches([{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);

    let cands = await findNotifyCandidates();
    const mine = cands.find((c) => c.userId === user.id);
    expect(mine?.shows.map((s) => s.showId)).toContain(show.id);

    // after notifying, it is excluded
    await prisma.notification.create({ data: { userId: user.id, showId: show.id, status: "sent" } });
    cands = await findNotifyCandidates();
    expect(cands.find((c) => c.userId === user.id)).toBeUndefined();
  });

  it("excludes shows outside the user's cities", async () => {
    const user = await prisma.user.create({
      data: { email: `c_${uid()}@e.com`, passwordHash: "x", emailVerified: new Date(),
        cities: { create: { cityCode: "440300" } } },
    });
    const artist = await upsertArtist(`Band_${uid()}`);
    await prisma.userArtist.create({ data: { userId: user.id, artistId: artist.id, status: "followed" } });
    const show = await upsertShow({
      showstartId: `S_${uid()}`, title: "T", cityCode: "310000", venue: "V",
      showTime: null, price: null, url: "http://x", performers: [artist.name],
    });
    await persistMatches([{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);
    const cands = await findNotifyCandidates();
    expect(cands.find((c) => c.userId === user.id)).toBeUndefined();
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
