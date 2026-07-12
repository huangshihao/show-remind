import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { CITIES } from "@/lib/cities";
import { getUserCities } from "@/lib/repositories/cities";
import { saveCities, addArtist } from "./actions";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; added?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const sp = await searchParams;
  const mine = new Set(await getUserCities(session.user.id));
  return (
    <main style={{ maxWidth: 560, margin: "40px auto" }}>
      <h1>关注城市</h1>
      {sp.saved && <p style={{ color: "green" }}>已保存。</p>}
      <form action={saveCities}>
        {CITIES.map((c) => (
          <label key={c.code} style={{ display: "inline-block", width: 120 }}>
            <input type="checkbox" name="city" value={c.code} defaultChecked={mine.has(c.code)} /> {c.name}
          </label>
        ))}
        <div><button type="submit">保存城市</button></div>
      </form>

      <h2>手动添加音乐人</h2>
      {sp.added && <p style={{ color: "green" }}>已添加。</p>}
      <form action={addArtist}>
        <input name="name" placeholder="乐队 / 歌手名" required />
        <button type="submit">添加关注</button>
      </form>
      <p><a href="/playlists">粘歌单</a> · <a href="/shows">我的演出</a></p>
    </main>
  );
}
