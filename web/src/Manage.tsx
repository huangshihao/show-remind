import { useEffect, useState } from "react";
import { clearToken, storeToken } from "./session";

interface View {
  email: string;
  cities: string[];
  artists: { id: string; name: string }[];
}

export function Manage({ token }: { token: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");

  async function reload() {
    let res: Response;
    try {
      res = await fetch(`/api/manage?token=${token}`);
    } catch {
      // network blip — keep the remembered token, just show a retry hint
      return setError("加载失败，请检查网络后重试");
    }
    // Only a 404 means the token is genuinely invalid/unsubscribed — forget it.
    // Transient 5xx (D1 hiccup etc.) must NOT evict a valid remembered token.
    if (res.status === 404) {
      clearToken();
      return setError("链接无效或已退订");
    }
    if (!res.ok) {
      return setError("加载失败，请稍后重试");
    }
    setView(await res.json());
    storeToken(token);
  }
  useEffect(() => {
    reload();
  }, [token]);

  async function removeArtist(id: string) {
    await fetch(`/api/manage/artists/${id}?token=${token}`, { method: "DELETE" });
    reload();
  }
  async function addArtist(name: string) {
    await fetch(`/api/manage/artists?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    reload();
  }
  async function unsubscribe() {
    await fetch(`/api/manage/unsubscribe?token=${token}`, { method: "POST" });
    clearToken();
    setView(null);
    setError("已退订。想重新订阅请回首页。");
  }

  if (error) return <main className="card"><p>{error}</p></main>;
  if (!view) return <main className="card"><p>加载中…</p></main>;

  return (
    <main className="card">
      <h1>我的关注</h1>
      <p className="sub">{view.email}</p>
      <h3>音乐人</h3>
      <ul className="artists">
        {view.artists.map((a) => (
          <li key={a.id}>
            {a.name} <button className="link" onClick={() => removeArtist(a.id)}>移除</button>
          </li>
        ))}
      </ul>
      <ManualAdd onAdd={addArtist} />
      <hr />
      <button className="danger" onClick={unsubscribe}>退订全部提醒</button>
    </main>
  );
}

function ManualAdd({ onAdd }: { onAdd: (name: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="manual">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="添加音乐人" />
      <button className="link" onClick={() => { onAdd(v); setV(""); }}>添加</button>
    </div>
  );
}
