import { getAllArtists } from "../db/artists";
import { getAllShows, getShowsByIds } from "../db/shows";
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

// Crawl-time matching (above) only sees artists that already exist, so an
// artist followed AFTER a show was crawled would never link to it. Call this
// whenever artists are added to a subscription; persistMatches uses INSERT OR
// IGNORE, so re-matching an already-linked artist is idempotent.
export async function matchArtistsToExistingShows(db: D1Database, artistIds: string[]): Promise<number> {
  if (artistIds.length === 0) return 0;
  const idSet = new Set(artistIds);
  const artists = (await getAllArtists(db)).filter((a) => idSet.has(a.id));
  if (artists.length === 0) return 0;
  const rows = await getAllShows(db);
  const shows: MatchShow[] = rows.map((s) => ({ id: s.id, title: s.title, performers: s.performers }));
  return persistMatches(db, matchShows(artists, shows));
}
