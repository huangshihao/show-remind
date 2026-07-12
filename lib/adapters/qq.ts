import { fetchQqPlaylist } from "@/lib/sources/qq";
import type { ResolvedPlaylist } from "./types";

export async function resolveQqPlaylist(externalId: string): Promise<ResolvedPlaylist> {
  const pl = await fetchQqPlaylist(externalId);
  return {
    platform: "qq",
    externalId,
    title: pl.title,
    songs: pl.songs.map((s) => ({ name: s.name, artists: s.artists })),
  };
}
