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
  // Only ever "performer": the lineup is the sole evidence that an artist is
  // actually playing. Kept as a field (rather than dropped) because show_artists
  // records it and a future match kind would land here.
  matchedBy: "performer";
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

// Match strictly on the lineup. A title that names an artist is not evidence the
// artist is playing, and matching on it was wrong every single time against live
// data: a tribute night ("Avril Lavigne &Ladies Rock ...致敬之夜", lineup
// ["Red Star"]), another band's tour title (声子虫's 《THE CURE》), and a concert
// whose name merely contains the word ("Stars Gala音乐剧明星音乐会"). Sending
// someone to a show their favourite act is not playing is worse than staying
// quiet, so a show with no lineup — typically 音乐会/话剧 — matches nothing.
export function matchShows(artists: MatchArtist[], shows: MatchShow[]): Match[] {
  const matches: Match[] = [];
  for (const show of shows) {
    if (show.performers.length === 0) continue;
    const performerKeySet = new Set(show.performers.flatMap(performerKeys));
    for (const artist of artists) {
      const names = [artist.normalizedName, ...artist.aliases.map(normalizeName)].filter(Boolean);
      if (names.some((n) => performerKeySet.has(n))) {
        matches.push({ showId: show.id, artistId: artist.id, matchedBy: "performer" });
      }
    }
  }
  return matches;
}
