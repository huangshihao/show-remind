import { prisma } from "@/lib/db";
import { upsertArtist } from "./artists";
import type { MatchArtist } from "@/lib/matcher";

async function setStatus(
  userId: string,
  sourcePlaylistId: string | null,
  name: string,
  status: "followed" | "ignored",
) {
  const artist = await upsertArtist(name);
  await prisma.userArtist.upsert({
    where: { userId_artistId: { userId, artistId: artist.id } },
    create: { userId, artistId: artist.id, sourcePlaylistId, status },
    update: { status, sourcePlaylistId },
  });
}

export async function confirmFollows(
  userId: string,
  sourcePlaylistId: string | null,
  params: { follow: string[]; ignore: string[] },
): Promise<void> {
  for (const name of params.follow) await setStatus(userId, sourcePlaylistId, name, "followed");
  for (const name of params.ignore) await setStatus(userId, sourcePlaylistId, name, "ignored");
}

export async function addManualArtist(userId: string, name: string): Promise<void> {
  await setStatus(userId, null, name, "followed");
}

function toMatchArtist(a: {
  id: string; name: string; normalizedName: string; aliases: unknown;
}): MatchArtist {
  return { id: a.id, name: a.name, normalizedName: a.normalizedName, aliases: (a.aliases as string[]) ?? [] };
}

export async function getFollowedArtists(userId: string): Promise<MatchArtist[]> {
  const rows = await prisma.userArtist.findMany({
    where: { userId, status: "followed" },
    include: { artist: true },
  });
  return rows.map((r) => toMatchArtist(r.artist));
}

export async function getAllFollowedArtists(): Promise<MatchArtist[]> {
  const artists = await prisma.artist.findMany({
    where: { userArtists: { some: { status: "followed" } } },
  });
  return artists.map(toMatchArtist);
}
