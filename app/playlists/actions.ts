"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createPlaylistFromLink, resolvePlaylist } from "@/lib/services/resolve-playlist";
import { confirmFollows } from "@/lib/repositories/user-artists";
import { matchAllForUser } from "@/lib/pipeline";

export async function submitLink(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const link = String(formData.get("link") ?? "");
  let playlistId: string;
  try {
    ({ playlistId } = await createPlaylistFromLink(session.user.id, link));
  } catch {
    redirect("/playlists?error=bad_link");
  }
  await resolvePlaylist(playlistId); // synchronous for MVP; small playlists resolve quickly
  redirect(`/playlists/${playlistId}`);
}

export async function confirmSelection(playlistId: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const all = formData.getAll("all_artists").map(String);
  const followed = new Set(formData.getAll("follow").map(String));
  await confirmFollows(session.user.id, playlistId, {
    follow: [...followed],
    ignore: all.filter((n) => !followed.has(n)),
  });
  await matchAllForUser(session.user.id);
  redirect("/shows");
}
