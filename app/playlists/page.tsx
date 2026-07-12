import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { submitLink } from "./actions";

export default async function PlaylistsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const sp = await searchParams;
  return (
    <main style={{ maxWidth: 560, margin: "40px auto" }}>
      <h1>粘贴歌单链接</h1>
      {sp.error === "bad_link" && <p style={{ color: "crimson" }}>无法识别的歌单链接。</p>}
      <form action={submitLink}>
        <input name="link" placeholder="网易云 / QQ 音乐 歌单分享链接" style={{ width: "100%" }} required />
        <button type="submit">解析</button>
      </form>
      <p><a href="/shows">我的演出</a> · <a href="/settings">城市与手动关注</a></p>
    </main>
  );
}
