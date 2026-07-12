"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { setUserCities } from "@/lib/repositories/cities";
import { addManualArtist } from "@/lib/repositories/user-artists";
import { matchAllForUser } from "@/lib/pipeline";

export async function saveCities(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  await setUserCities(session.user.id, formData.getAll("city").map(String));
  redirect("/settings?saved=1");
}

export async function addArtist(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const name = String(formData.get("name") ?? "").trim();
  if (name) {
    await addManualArtist(session.user.id, name);
    await matchAllForUser(session.user.id);
  }
  redirect("/settings?added=1");
}
