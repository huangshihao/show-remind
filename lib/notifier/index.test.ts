import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { upsertArtist } from "@/lib/repositories/artists";
import { upsertShow } from "@/lib/repositories/shows";
import { persistMatches } from "@/lib/repositories/matches";
import * as mailer from "./mailer";
import { runNotifications } from "./index";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
afterEach(() => vi.restoreAllMocks());

describe("runNotifications", () => {
  it("sends one aggregated email and records notifications", async () => {
    const sendSpy = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    const user = await prisma.user.create({
      data: { email: `r_${uid()}@e.com`, passwordHash: "x", emailVerified: new Date(),
        cities: { create: { cityCode: "310000" } } },
    });
    const artist = await upsertArtist(`Band_${uid()}`);
    await prisma.userArtist.create({ data: { userId: user.id, artistId: artist.id, status: "followed" } });
    for (let i = 0; i < 2; i++) {
      const show = await upsertShow({
        showstartId: `S_${uid()}_${i}`, title: `T${i}`, cityCode: "310000", venue: "V",
        showTime: null, price: null, url: "http://x", performers: [artist.name],
      });
      await persistMatches([{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);
    }
    const result = await runNotifications();
    expect(sendSpy).toHaveBeenCalledOnce(); // aggregated: one email despite two shows
    expect(result.usersNotified).toBeGreaterThanOrEqual(1);
    const notifs = await prisma.notification.count({ where: { userId: user.id, status: "sent" } });
    expect(notifs).toBe(2);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
