import { prisma } from "@/lib/db";
import type { ArtistTally } from "@/lib/adapters/types";
import type { PlatformId } from "@/lib/adapters/types";

export async function createPlaylist(userId: string, platform: PlatformId, externalId: string) {
  return prisma.playlist.upsert({
    where: { userId_platform_externalId: { userId, platform, externalId } },
    create: { userId, platform, externalId, status: "pending" },
    update: { status: "pending", failureReason: null },
    select: { id: true },
  });
}

export async function setPlaylistReady(id: string, title: string, tally: ArtistTally[]) {
  await prisma.playlist.update({
    where: { id },
    data: { title, status: "ready", lastSyncedAt: new Date(), failureReason: null },
  });
  // The transient artist list for the selection screen lives in playlist_tallies.
  await prisma.playlistTally.deleteMany({ where: { playlistId: id } });
  await prisma.playlistTally.createMany({
    data: tally.map((t) => ({ playlistId: id, name: t.name, songCount: t.songCount })),
  });
}

export async function setPlaylistFailed(id: string, reason: string) {
  await prisma.playlist.update({ where: { id }, data: { status: "failed", failureReason: reason } });
}

export async function getPlaylist(id: string) {
  return prisma.playlist.findUnique({ where: { id }, include: { tally: { orderBy: { songCount: "desc" } } } });
}
