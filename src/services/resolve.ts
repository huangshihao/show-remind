import { parsePlaylistLink } from "@/lib/adapters/parse-link";
import { resolveNeteasePlaylist } from "@/lib/adapters/netease";
import { fetchQqPlaylist } from "@/lib/sources/qq";
import { tallyArtists } from "@/lib/adapters/tally";
import type { ArtistTally, ResolvedPlaylist } from "@/lib/adapters/types";

async function resolveQq(externalId: string): Promise<ResolvedPlaylist> {
  const { title, songs } = await fetchQqPlaylist(externalId);
  return { platform: "qq", externalId, title, songs };
}

export async function resolvePlaylist(
  input: string,
): Promise<{ platform: string; title: string; artists: ArtistTally[] }> {
  const parsed = await parsePlaylistLink(input);
  const playlist =
    parsed.platform === "netease"
      ? await resolveNeteasePlaylist(parsed.externalId)
      : await resolveQq(parsed.externalId);
  return { platform: parsed.platform, title: playlist.title, artists: tallyArtists(playlist) };
}
