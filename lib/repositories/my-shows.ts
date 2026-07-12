import { prisma } from "@/lib/db";

export async function getUpcomingShowsForUser(userId: string) {
  const [cities, followed] = await Promise.all([
    prisma.userCity.findMany({ where: { userId }, select: { cityCode: true } }),
    prisma.userArtist.findMany({ where: { userId, status: "followed" }, select: { artistId: true } }),
  ]);
  const cityCodes = cities.map((c) => c.cityCode);
  const artistIds = followed.map((f) => f.artistId);
  if (cityCodes.length === 0 || artistIds.length === 0) return [];

  const shows = await prisma.show.findMany({
    where: {
      cityCode: { in: cityCodes },
      showArtists: { some: { artistId: { in: artistIds } } },
      OR: [{ showTime: { gte: new Date() } }, { showTime: null }],
    },
    include: { showArtists: { where: { artistId: { in: artistIds } }, include: { artist: true } } },
    orderBy: { showTime: "asc" },
  });

  return shows.map((s) => ({
    id: s.id,
    title: s.title,
    cityCode: s.cityCode,
    venue: s.venue,
    showTime: s.showTime,
    price: s.price,
    url: s.url,
    artistNames: s.showArtists.map((sa) => sa.artist.name),
  }));
}
