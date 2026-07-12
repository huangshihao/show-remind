import { parsePlaylistLink } from "@/lib/adapters/parse-link";
import { resolveNeteasePlaylist } from "@/lib/adapters/netease";
import { resolveQqPlaylist } from "@/lib/adapters/qq";
import { tallyArtists } from "@/lib/adapters/tally";
import type { ArtistTally } from "@/lib/adapters/types";
import {
  createPlaylist,
  getPlaylist,
  setPlaylistFailed,
  setPlaylistReady,
} from "@/lib/repositories/playlists";

export async function createPlaylistFromLink(
  userId: string,
  link: string,
): Promise<{ playlistId: string }> {
  const { platform, externalId } = await parsePlaylistLink(link);
  const pl = await createPlaylist(userId, platform, externalId);
  return { playlistId: pl.id };
}

export async function resolvePlaylist(playlistId: string): Promise<void> {
  const pl = await getPlaylist(playlistId);
  if (!pl) throw new Error("playlist not found");
  try {
    const resolved =
      pl.platform === "netease"
        ? await resolveNeteasePlaylist(pl.externalId)
        : await resolveQqPlaylist(pl.externalId);
    await setPlaylistReady(playlistId, resolved.title, tallyArtists(resolved));
  } catch (err) {
    await setPlaylistFailed(playlistId, (err as Error).message);
  }
}

export async function getPlaylistTally(playlistId: string): Promise<{
  title: string;
  status: string;
  failureReason: string | null;
  artists: ArtistTally[];
}> {
  const pl = await getPlaylist(playlistId);
  if (!pl) throw new Error("playlist not found");
  return {
    title: pl.title ?? "",
    status: pl.status,
    failureReason: pl.failureReason,
    artists: pl.tally.map((t) => ({ name: t.name, songCount: t.songCount })),
  };
}
