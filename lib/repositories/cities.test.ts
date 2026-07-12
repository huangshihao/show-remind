import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getUserCities, setUserCities } from "./cities";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe("cities repo", () => {
  it("replaces the user's city set", async () => {
    const user = await prisma.user.create({ data: { email: `city_${uid()}@e.com`, passwordHash: "x" } });
    await setUserCities(user.id, ["310000", "110000"]);
    expect((await getUserCities(user.id)).sort()).toEqual(["110000", "310000"]);
    await setUserCities(user.id, ["440300"]);
    expect(await getUserCities(user.id)).toEqual(["440300"]);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
