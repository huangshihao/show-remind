import { prisma } from "@/lib/db";
import { crawlCities } from "@/lib/crawler/showstart";
import { getAllFollowedArtists, getFollowedArtists } from "@/lib/repositories/user-artists";
import { persistMatches } from "@/lib/repositories/matches";
import { matchShows, type MatchArtist, type MatchShow } from "@/lib/matcher";
import { runNotifications } from "@/lib/notifier";

async function loadShowsForMatching(showIds: string[]): Promise<MatchShow[]> {
  if (showIds.length === 0) return [];
  const shows = await prisma.show.findMany({ where: { id: { in: showIds } } });
  return shows.map((s) => ({
    id: s.id,
    title: s.title,
    performers: (s.performers as string[]) ?? [],
  }));
}

export async function matchNewShows(showIds: string[]): Promise<number> {
  const artists = await getAllFollowedArtists();
  const shows = await loadShowsForMatching(showIds);
  return persistMatches(matchShows(artists, shows));
}

export async function matchAllForUser(userId: string): Promise<number> {
  const artists: MatchArtist[] = await getFollowedArtists(userId);
  if (artists.length === 0) return 0;
  const dbShows = await prisma.show.findMany({ where: { showTime: { gte: new Date() } } });
  const shows: MatchShow[] = dbShows.map((s) => ({
    id: s.id,
    title: s.title,
    performers: (s.performers as string[]) ?? [],
  }));
  return persistMatches(matchShows(artists, shows));
}

async function unionCities(): Promise<string[]> {
  const rows = await prisma.userCity.findMany({ distinct: ["cityCode"], select: { cityCode: true } });
  return rows.map((r) => r.cityCode);
}

export async function runPipeline(): Promise<{
  crawled: number;
  matched: number;
  usersNotified: number;
  failedCities: string[];
}> {
  const cities = await unionCities();
  const { newShowIds, failedCities } = await crawlCities(cities);
  const matched = await matchNewShows(newShowIds);
  const { usersNotified } = await runNotifications();
  return { crawled: newShowIds.length, matched, usersNotified, failedCities };
}
