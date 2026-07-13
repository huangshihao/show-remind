import { getAllArtists } from "../db/artists";
import { getShowsByIds } from "../db/shows";
import { persistMatches } from "../db/show-artists";
import { matchShows, type MatchShow } from "@/lib/matcher";

export async function matchNewShows(db: D1Database, showIds: string[]): Promise<number> {
  if (showIds.length === 0) return 0;
  const artists = await getAllArtists(db);
  if (artists.length === 0) return 0;
  const rows = await getShowsByIds(db, showIds);
  const shows: MatchShow[] = rows.map((s) => ({ id: s.id, title: s.title, performers: s.performers }));
  return persistMatches(db, matchShows(artists, shows));
}
