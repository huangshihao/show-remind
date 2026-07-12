import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { confirmFollows, addManualArtist, getFollowedArtists } from "./user-artists";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
async function makeUser() {
  return prisma.user.create({ data: { email: `u_${uid()}@e.com`, passwordHash: "x" } });
}

describe("user-artists repo", () => {
  it("records followed and ignored", async () => {
    const user = await makeUser();
    const n1 = `Band_${uid()}`;
    const n2 = `Skip_${uid()}`;
    await confirmFollows(user.id, null, { follow: [n1], ignore: [n2] });
    const followed = await getFollowedArtists(user.id);
    expect(followed.map((a) => a.name)).toContain(n1);
    expect(followed.map((a) => a.name)).not.toContain(n2);
  });

  it("addManualArtist adds a followed artist", async () => {
    const user = await makeUser();
    const n = `Manual_${uid()}`;
    await addManualArtist(user.id, n);
    const followed = await getFollowedArtists(user.id);
    expect(followed.map((a) => a.name)).toContain(n);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
