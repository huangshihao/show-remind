import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getPlaylistTally } from "@/lib/services/resolve-playlist";
import { confirmSelection } from "../actions";

export default async function PlaylistDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const t = await getPlaylistTally(id);

  if (t.status === "failed") {
    return (
      <main style={{ maxWidth: 560, margin: "40px auto" }}>
        <h1>解析失败</h1>
        <p style={{ color: "crimson" }}>{t.failureReason}</p>
        <p><a href="/playlists">重试</a></p>
      </main>
    );
  }

  const confirm = confirmSelection.bind(null, id);
  return (
    <main style={{ maxWidth: 560, margin: "40px auto" }}>
      <h1>{t.title || "歌单"} — 选择要关注的音乐人</h1>
      <form action={confirm}>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {t.artists.map((a) => (
            <li key={a.name}>
              <input type="hidden" name="all_artists" value={a.name} />
              <label>
                <input type="checkbox" name="follow" value={a.name} defaultChecked />{" "}
                {a.name} <small>({a.songCount})</small>
              </label>
            </li>
          ))}
        </ul>
        <button type="submit">确认关注</button>
      </form>
    </main>
  );
}
