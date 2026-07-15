import { parsePlaylistLink } from "@/lib/adapters/parse-link";
import { resolveNeteasePlaylist, fetchArtistAvatar } from "@/lib/adapters/netease";
import { fetchQqPlaylist } from "@/lib/sources/qq";
import { tallyArtists } from "@/lib/adapters/tally";
import type { ArtistTally, ResolvedPlaylist } from "@/lib/adapters/types";
import { SubrequestBudget } from "@/lib/budget";

async function resolveQq(externalId: string, budget: SubrequestBudget): Promise<ResolvedPlaylist> {
  const { title, songs } = await fetchQqPlaylist(externalId, budget);
  return { platform: "qq", externalId, title, songs };
}

// Avatars come from the playlist platform itself. QQ carries them inline
// (singer mid → photo URL, zero extra requests); netease song payloads only
// carry artist ids, so those need one head-info lookup per artist.
//
// The lookups spend whatever is left of the invocation's SubrequestBudget
// after the playlist fetch, additionally capped per batch: any artist past
// the cap, or whose lookup fails or times out, simply keeps avatar: null and
// gets backfilled later (see src/services/avatar-backfill.ts). That's
// graceful degradation, never a resolve failure.
const AVATAR_LOOKUP_LIMIT = 30;
// One slow netease lookup shouldn't hang the whole resolve response.
const AVATAR_LOOKUP_TIMEOUT_MS = 4000;

// Soft timeout: resolves null on timeout OR error. Unlike the manage-page
// backfill (which must distinguish "no match" from "lookup failed" before
// caching ""), the resolve preview never caches — null just means "no avatar
// in this response", so collapsing failures into null is safe here.
function avatarWithTimeout(sourceId: string): Promise<string | null> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), AVATAR_LOOKUP_TIMEOUT_MS);
  });
  return Promise.race([fetchArtistAvatar(sourceId).catch(() => null), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

async function attachNeteaseAvatars(artists: ArtistTally[], budget: SubrequestBudget): Promise<void> {
  const pending = artists.filter((a) => !a.avatar && a.sourceId).slice(0, AVATAR_LOOKUP_LIMIT);
  await Promise.all(
    pending.map(async (artist) => {
      if (!budget.tryTake()) return; // stays null; backfilled on a later manage load
      artist.avatar = await avatarWithTimeout(artist.sourceId!);
    }),
  );
}

export async function resolvePlaylist(
  input: string,
  budget: SubrequestBudget = new SubrequestBudget(),
): Promise<{ platform: string; title: string; artists: ArtistTally[] }> {
  const parsed = await parsePlaylistLink(input);
  const playlist =
    parsed.platform === "netease"
      ? await resolveNeteasePlaylist(parsed.externalId, budget)
      : await resolveQq(parsed.externalId, budget);
  const artists = tallyArtists(playlist);
  if (parsed.platform === "netease") await attachNeteaseAvatars(artists, budget);
  // Every artist gets an explicit avatar (null when unknown). sourceId stays
  // on the tallies so the import path can persist it (see routes/manage.ts);
  // the public /api/resolve response strips it (see routes/resolve.ts).
  return {
    platform: parsed.platform,
    title: playlist.title,
    artists: artists.map((a) => ({ ...a, avatar: a.avatar ?? null })),
  };
}
