import type { ArtistTally, ResolvedPlaylist } from "./types";
import { normalizeName } from "@/lib/matcher/normalize";

export function tallyArtists(playlist: ResolvedPlaylist): ArtistTally[] {
  const counts = new Map<string, { name: string; songCount: number }>();
  for (const song of playlist.songs) {
    const seen = new Set<string>();
    for (const artist of song.artists) {
      const key = normalizeName(artist);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const existing = counts.get(key);
      if (existing) existing.songCount += 1;
      else counts.set(key, { name: artist, songCount: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.songCount - a.songCount || a.name.localeCompare(b.name),
  );
}
