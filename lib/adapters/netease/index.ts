import type { ResolvedPlaylist, ResolvedSong } from "@/lib/adapters/types";
import { fetchPlaylistDetailRaw, fetchSongDetailRaw } from "./client";

const BATCH_SIZE = 500;

export function parsePlaylistMeta(raw: any): { title: string; trackIds: string[] } {
  const playlist = raw?.playlist ?? {};
  const trackIds = (playlist.trackIds ?? []).map((t: any) => String(t.id));
  return { title: playlist.name ?? "", trackIds };
}

export function parseSongDetail(raw: any): ResolvedSong[] {
  return (raw?.songs ?? []).map((s: any) => ({
    name: s.name ?? "",
    artists: (s.ar ?? s.artists ?? []).map((a: any) => a.name).filter(Boolean),
  }));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function resolveNeteasePlaylist(externalId: string): Promise<ResolvedPlaylist> {
  const meta = parsePlaylistMeta(await fetchPlaylistDetailRaw(externalId));
  const songs: ResolvedSong[] = [];
  for (const batch of chunk(meta.trackIds, BATCH_SIZE)) {
    const raw = await fetchSongDetailRaw(batch);
    songs.push(...parseSongDetail(raw));
  }
  return { platform: "netease", externalId, title: meta.title, songs };
}
