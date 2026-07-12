import { prisma } from "@/lib/db";
import type { Match } from "@/lib/matcher";

export async function persistMatches(matches: Match[]): Promise<number> {
  if (matches.length === 0) return 0;
  const result = await prisma.showArtist.createMany({
    data: matches.map((m) => ({ showId: m.showId, artistId: m.artistId, matchedBy: m.matchedBy })),
    skipDuplicates: true,
  });
  return result.count;
}
