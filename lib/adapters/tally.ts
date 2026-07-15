import type { ArtistTally, ResolvedPlaylist } from "./types";
import { normalizeName } from "@/lib/matcher/normalize";

export function tallyArtists(playlist: ResolvedPlaylist): ArtistTally[] {
  const counts = new Map<string, ArtistTally>();
  for (const song of playlist.songs) {
    const seen = new Set<string>();
    for (const artist of song.artists) {
      const key = normalizeName(artist.name);
      if (!key) continue;
      const existing = counts.get(key);
      if (existing) {
        // First non-empty avatar/sourceId wins; later values never overwrite.
        if (!existing.avatar && artist.avatar) existing.avatar = artist.avatar;
        if (!existing.sourceId && artist.sourceId) existing.sourceId = artist.sourceId;
        if (!seen.has(key)) existing.songCount += 1;
      } else {
        const entry: ArtistTally = { name: artist.name, songCount: 1 };
        if (artist.avatar) entry.avatar = artist.avatar;
        if (artist.sourceId) entry.sourceId = artist.sourceId;
        counts.set(key, entry);
      }
      seen.add(key);
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.songCount - a.songCount || a.name.localeCompare(b.name),
  );
}
