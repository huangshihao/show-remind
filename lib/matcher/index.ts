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

// Showstart often stores a performer as its Chinese name and English name stuck
// together — "蛙池WaChi", "白百 EndlessWhite", "PeaceHotel和平饭店". To match a
// followed artist ("蛙池") against those, split each performer on the CJK↔Latin
// boundary and treat each side as an alternative key, alongside the full name.
// Deliberately does NOT split a Latin run on spaces (so "Chinese Football" stays
// one key, not "chinese"/"football") and requires len>=2 — together these avoid
// false positives like GALA matching "...Galaxy Blind-box" (a substring, not a
// segment).
const CJK = /[㐀-鿿豈-﫿]+|[^㐀-鿿豈-﫿]+/g;
function performerKeys(performer: string): string[] {
  const norm = normalizeName(performer);
  const keys = new Set<string>([norm]);
  for (const seg of norm.match(CJK) ?? []) {
    const s = seg.trim();
    if (s.length >= 2) keys.add(s);
  }
  return [...keys];
}

export function matchShows(artists: MatchArtist[], shows: MatchShow[]): Match[] {
  const matches: Match[] = [];
  for (const show of shows) {
    const performerKeySet = new Set(show.performers.flatMap(performerKeys));
    const normTitle = normalizeName(show.title);
    for (const artist of artists) {
      const names = [artist.normalizedName, ...artist.aliases.map(normalizeName)].filter(Boolean);
      let matchedBy: "performer" | "title" | null = null;
      if (names.some((n) => performerKeySet.has(n))) {
        matchedBy = "performer";
      } else if (names.some((n) => n.length >= 2 && normTitle.includes(n))) {
        matchedBy = "title";
      }
      if (matchedBy) matches.push({ showId: show.id, artistId: artist.id, matchedBy });
    }
  }
  return matches;
}
