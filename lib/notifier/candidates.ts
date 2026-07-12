import { prisma } from "@/lib/db";

export interface NotifyShow {
  showId: string;
  title: string;
  cityCode: string;
  venue: string | null;
  showTime: Date | null;
  price: string | null;
  url: string;
  artistNames: string[];
  hasTitleOnlyMatch: boolean;
}

export async function findNotifyCandidates(): Promise<
  Array<{ userId: string; email: string; shows: NotifyShow[] }>
> {
  const users = await prisma.user.findMany({
    where: { emailVerified: { not: null } },
    include: { cities: true, artists: { where: { status: "followed" }, select: { artistId: true } } },
  });

  const out: Array<{ userId: string; email: string; shows: NotifyShow[] }> = [];

  for (const user of users) {
    const cityCodes = user.cities.map((c) => c.cityCode);
    const followedArtistIds = new Set(user.artists.map((a) => a.artistId));
    if (cityCodes.length === 0 || followedArtistIds.size === 0) continue;

    const shows = await prisma.show.findMany({
      where: {
        cityCode: { in: cityCodes },
        showArtists: { some: { artistId: { in: [...followedArtistIds] } } },
        notifications: { none: { userId: user.id } },
      },
      include: { showArtists: { include: { artist: true } } },
    });

    const notifyShows: NotifyShow[] = shows.map((s) => {
      const mine = s.showArtists.filter((sa) => followedArtistIds.has(sa.artistId));
      return {
        showId: s.id,
        title: s.title,
        cityCode: s.cityCode,
        venue: s.venue,
        showTime: s.showTime,
        price: s.price,
        url: s.url,
        artistNames: mine.map((sa) => sa.artist.name),
        hasTitleOnlyMatch: mine.every((sa) => sa.matchedBy === "title"),
      };
    });

    if (notifyShows.length > 0) out.push({ userId: user.id, email: user.email, shows: notifyShows });
  }
  return out;
}
