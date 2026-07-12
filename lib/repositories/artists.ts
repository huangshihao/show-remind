import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/matcher/normalize";

export async function upsertArtist(name: string) {
  const normalizedName = normalizeName(name);
  const artist = await prisma.artist.upsert({
    where: { normalizedName },
    create: { name: name.trim(), normalizedName, aliases: [] },
    update: {},
  });
  return {
    id: artist.id,
    name: artist.name,
    normalizedName: artist.normalizedName,
    aliases: (artist.aliases as string[]) ?? [],
  };
}
