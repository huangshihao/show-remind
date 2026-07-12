import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

describe("prisma schema", () => {
  const email = `t_${Date.now()}@example.com`;

  it("creates and reads a user with a followed city", async () => {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: "x",
        cities: { create: { cityCode: "310000" } },
      },
      include: { cities: true },
    });
    expect(user.cities).toHaveLength(1);
    expect(user.cities[0].cityCode).toBe("310000");
  });

  it("enforces the (userId, showId) unique on notifications", async () => {
    const u = await prisma.user.create({ data: { email: `n_${Date.now()}@e.com`, passwordHash: "x" } });
    const s = await prisma.show.create({
      data: { showstartId: `s_${Date.now()}`, title: "T", cityCode: "310000", url: "http://x" },
    });
    await prisma.notification.create({ data: { userId: u.id, showId: s.id } });
    await expect(
      prisma.notification.create({ data: { userId: u.id, showId: s.id } }),
    ).rejects.toThrow();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
