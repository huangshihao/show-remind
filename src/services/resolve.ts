import { parsePlaylistLink } from "@/lib/adapters/parse-link";
import { resolveNeteasePlaylist } from "@/lib/adapters/netease";
import { fetchQqPlaylist } from "@/lib/sources/qq";
import { tallyArtists } from "@/lib/adapters/tally";
import type { ArtistTally, ResolvedPlaylist } from "@/lib/adapters/types";
import { searchArtist } from "@/lib/sources/showstart";

async function resolveQq(externalId: string): Promise<ResolvedPlaylist> {
  const { title, songs } = await fetchQqPlaylist(externalId);
  return { platform: "qq", externalId, title, songs };
}

// Workers caps a single invocation at 50 subrequests. Only the top-ranked
// artists (tally is sorted by songCount desc) get an avatar lookup; the rest
// keep avatar: undefined rather than risk exhausting the subrequest budget.
const AVATAR_LOOKUP_LIMIT = 40;
// One slow Showstart search shouldn't hang the whole resolve response.
const AVATAR_LOOKUP_TIMEOUT_MS = 4000;

function searchArtistWithTimeout(name: string): Promise<Awaited<ReturnType<typeof searchArtist>>> {
  return Promise.race([
    searchArtist(name),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), AVATAR_LOOKUP_TIMEOUT_MS)),
  ]);
}

async function attachAvatars(artists: ArtistTally[]): Promise<ArtistTally[]> {
  const toLookup = artists.slice(0, AVATAR_LOOKUP_LIMIT);
  await Promise.all(
    toLookup.map(async (artist) => {
      const hit = await searchArtistWithTimeout(artist.name);
      artist.avatar = hit?.avatar ?? null;
    }),
  );
  return artists;
}

export async function resolvePlaylist(
  input: string,
): Promise<{ platform: string; title: string; artists: ArtistTally[] }> {
  const parsed = await parsePlaylistLink(input);
  const playlist =
    parsed.platform === "netease"
      ? await resolveNeteasePlaylist(parsed.externalId)
      : await resolveQq(parsed.externalId);
  const artists = await attachAvatars(tallyArtists(playlist));
  return { platform: parsed.platform, title: playlist.title, artists };
}
