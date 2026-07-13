import { useEffect, useState } from "react";
import { clearToken, storeToken } from "./session";
import { ArtistAvatar } from "./ArtistAvatar";

interface UpcomingShow {
  id: string;
  title: string;
  poster: string | null;
  cityCode: string;
  venue: string | null;
  showTime: string | null;
  price: string | null;
  url: string;
  artistNames: string[];
}

interface View {
  email: string;
  cities: string[];
  artists: { id: string; name: string; avatar?: string | null }[];
  shows: UpcomingShow[];
}

// Qiniu imageMogr2 thumbnail, same rule as the reminder email (see
// src/mail/templates.ts posterThumb): cap width at 360px, skip if the URL
// already carries a query string.
function posterThumb(url: string): string {
  return url.includes("?") ? url : `${url}?imageMogr2/thumbnail/360x/quality/85`;
}

function formatShowTime(showTime: string | null): string {
  return showTime ? showTime.slice(0, 16).replace("T", " ") : "待定";
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

      <h3>我关注的音乐人</h3>
      <div className="artist-photo-grid">
        {view.artists.map((a) => (
          <div key={a.id} className="artist-tile">
            <button
              type="button"
              className="artist-tile-remove"
              aria-label={`移除 ${a.name}`}
              onClick={() => removeArtist(a.id)}
            >
              ×
            </button>
            <ArtistAvatar name={a.name} avatar={a.avatar} size="fill" />
            <span className="artist-tile-name">{a.name}</span>
          </div>
        ))}
      </div>
      <ManualAdd onAdd={addArtist} />

      <h3>最近的演出</h3>
      {view.shows.length === 0 ? (
        <p className="sub">关注的音乐人暂时没有最近的演出</p>
      ) : (
        <ul className="show-cards">
          {view.shows.map((s) => (
            <li key={s.id} className="show-card">
              {s.poster && (
                <img className="show-poster" src={posterThumb(s.poster)} alt="" loading="lazy" />
              )}
              <div className="show-info">
                <p className="show-title">{s.title}</p>
                <p className="show-artists">{s.artistNames.join(" / ")}</p>
                <p className="show-meta">时间：{formatShowTime(s.showTime)}</p>
                <p className="show-meta">地点：{s.venue ?? "待定"}</p>
                <p className="show-meta">票价：{s.price ?? "待定"}</p>
                <a className="show-link" href={s.url} target="_blank" rel="noreferrer">
                  购票/详情
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

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
