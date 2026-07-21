import type { ResolvedPlaylist, ResolvedSong, ResolvedSongArtist } from "@/lib/adapters/types";
import { fetchPlaylistDetailRaw, fetchSongDetailRaw, fetchArtistHeadRaw } from "./client";
import { withNeteaseRetry, type NeteaseRetryOptions } from "./retry";
import { SubrequestBudget } from "@/lib/budget";

const BATCH_SIZE = 500;

export function parsePlaylistMeta(raw: any): { title: string; trackIds: string[] } {
  const playlist = raw?.playlist ?? {};
  const trackIds = (playlist.trackIds ?? []).map((t: any) => String(t.id));
  return { title: playlist.name ?? "", trackIds };
}

export function parseSongDetail(raw: any): ResolvedSong[] {
  return (raw?.songs ?? []).map((s: any) => ({
    name: s.name ?? "",
    artists: (s.ar ?? s.artists ?? [])
      .filter((a: any) => Boolean(a?.name))
      .map((a: any): ResolvedSongArtist =>
        a.id ? { name: a.name, sourceId: String(a.id) } : { name: a.name },
      ),
  }));
}

// head-info payloads carry `avatar` (and sometimes only `cover`) as http://
// URLs; the SPA is served over https, so an http image would be blocked as
// mixed content. The 126.net image CDN serves the same path over https.
export function parseArtistAvatar(raw: any): string | null {
  const artist = raw?.data?.artist ?? {};
  const url = artist.avatar || artist.cover;
  return url ? String(url).replace(/^http:\/\//, "https://") : null;
}

// Throws on network/parse failure (caller decides whether that means retry
// later); resolves null only on a definitive "no avatar on the profile".
export async function fetchArtistAvatar(artistId: string): Promise<string | null> {
  return parseArtistAvatar(await fetchArtistHeadRaw(artistId));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// `budget` caps the EXTERNAL fetches (1 playlist detail + 1 per 500-song
// batch). Running out mid-list truncates the song list — graceful, mirrors
// the QQ pagination cap. Each core fetch is retried through withNeteaseRetry to
// ride out the intermittent overseas risk control (issue #3); its retries also
// draw down `budget`, so the ceiling still holds. `retry` is a test seam for
// injecting a no-op sleep — production uses the default backoff.
export async function resolveNeteasePlaylist(
  externalId: string,
  budget: SubrequestBudget = new SubrequestBudget(),
  retry: NeteaseRetryOptions = {},
): Promise<ResolvedPlaylist> {
  if (!budget.tryTake())
    throw new Error(`netease playlist ${externalId}: subrequest budget exhausted`);
  const meta = parsePlaylistMeta(
    await withNeteaseRetry(() => fetchPlaylistDetailRaw(externalId), budget, retry),
  );
  const songs: ResolvedSong[] = [];
  for (const batch of chunk(meta.trackIds, BATCH_SIZE)) {
    if (!budget.tryTake()) break;
    const raw = await withNeteaseRetry(() => fetchSongDetailRaw(batch), budget, retry);
    songs.push(...parseSongDetail(raw));
  }
  return { platform: "netease", externalId, title: meta.title, songs };
}
