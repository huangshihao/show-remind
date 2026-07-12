import { prisma } from "@/lib/db";

export async function getUserCities(userId: string): Promise<string[]> {
  const rows = await prisma.userCity.findMany({ where: { userId }, select: { cityCode: true } });
  return rows.map((r) => r.cityCode);
}

export async function setUserCities(userId: string, cityCodes: string[]): Promise<void> {
  const unique = [...new Set(cityCodes)];
  await prisma.$transaction([
    prisma.userCity.deleteMany({ where: { userId } }),
    prisma.userCity.createMany({ data: unique.map((cityCode) => ({ userId, cityCode })) }),
  ]);
}
