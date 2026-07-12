import { normalizeName } from "./normalize";

export interface MatchArtist {
  id: string;
  name: string;
  normalizedName: string;
  aliases: string[];
}
export interface MatchShow {
  id: string;
  title: string;
  performers: string[];
}
export interface Match {
  showId: string;
  artistId: string;
  matchedBy: "performer" | "title";
}

export function matchShows(artists: MatchArtist[], shows: MatchShow[]): Match[] {
  const matches: Match[] = [];
  for (const show of shows) {
    const normPerformers = new Set(show.performers.map(normalizeName));
    const normTitle = normalizeName(show.title);
    for (const artist of artists) {
      const names = [artist.normalizedName, ...artist.aliases.map(normalizeName)].filter(Boolean);
      let matchedBy: "performer" | "title" | null = null;
      if (names.some((n) => normPerformers.has(n))) {
        matchedBy = "performer";
      } else if (names.some((n) => n.length >= 2 && normTitle.includes(n))) {
        matchedBy = "title";
      }
      if (matchedBy) matches.push({ showId: show.id, artistId: artist.id, matchedBy });
    }
  }
  return matches;
}
