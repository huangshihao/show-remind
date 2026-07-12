import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getUpcomingShowsForUser } from "@/lib/repositories/my-shows";

export default async function ShowsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const shows = await getUpcomingShowsForUser(session.user.id);
  return (
    <main style={{ maxWidth: 640, margin: "40px auto" }}>
      <h1>我的演出</h1>
      {shows.length === 0 && (
        <p>还没有匹配到演出。先去 <a href="/playlists">粘歌单</a> 并在 <a href="/settings">设置</a> 里选关注城市。</p>
      )}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {shows.map((s) => (
          <li key={s.id} style={{ marginBottom: 16 }}>
            <b>{s.artistNames.join(" / ")}</b> — {s.title}<br />
            场馆:{s.venue ?? "待定"} · 时间:{s.showTime ? s.showTime.toLocaleString("zh-CN") : "待定"} · 票价:{s.price ?? "待定"}<br />
            <a href={s.url} target="_blank" rel="noreferrer">查看/购票</a>
          </li>
        ))}
      </ul>
      <p><a href="/playlists">粘歌单</a> · <a href="/settings">设置</a></p>
    </main>
  );
}
