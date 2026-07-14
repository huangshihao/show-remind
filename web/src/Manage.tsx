import { useEffect, useState } from "react";
import { clearToken, storeToken } from "./session";
import { getConfig, setManageCities, type Config } from "./api";
import { ArtistAvatar } from "./ArtistAvatar";
import { Shell, Loading } from "./Shell";

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

// 110000 -> 北京. Falls back to a short code label if we don't know the city.
const CITY_NAMES: Record<string, string> = {
  "110000": "北京", "310000": "上海", "440100": "广州", "440300": "深圳",
  "330100": "杭州", "510100": "成都", "500000": "重庆", "420100": "武汉",
  "320100": "南京", "610100": "西安", "120000": "天津", "370200": "青岛",
  "350100": "福州", "350200": "厦门", "430100": "长沙", "410100": "郑州",
};
const cityName = (code: string) => CITY_NAMES[code] ?? code;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Split "2026-07-14T20:30:00" into ticket-stub pieces without Date parsing
// (avoids timezone surprises; the string is already local wall-clock time).
function stubParts(showTime: string | null): { mon: string; day: string; time: string } | null {
  if (!showTime) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(showTime);
  if (!m) return null;
  const monthIdx = Number(m[2]) - 1;
  return {
    mon: MONTHS[monthIdx] ?? m[2],
    day: String(Number(m[3])),
    time: m[4] ? `${m[4]}:${m[5]}` : "",
  };
}

// Qiniu imageMogr2 thumbnail, same rule as the reminder email (see
// src/mail/templates.ts posterThumb): cap width, skip if the URL already
// carries a query string.
function posterThumb(url: string): string {
  return url.includes("?") ? url : `${url}?imageMogr2/thumbnail/240x/quality/85`;
}

export function Manage({ token }: { token: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<0 | 1>(0);
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    // City list for the editor; failure just leaves editing unavailable.
    getConfig().then(setConfig).catch(() => {});
  }, []);

  async function reload() {
    let res: Response;
    try {
      res = await fetch(`/api/manage?token=${token}`);
    } catch {
      return setError("加载失败，请检查网络后重试");
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function removeArtist(id: string) {
    // optimistic: drop it immediately, then sync
    setView((v) => (v ? { ...v, artists: v.artists.filter((a) => a.id !== id) } : v));
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
  async function saveCities(cities: string[]) {
    // optimistic city update, then confirm from the server
    setView((v) => (v ? { ...v, cities } : v));
    await setManageCities(token, cities);
    reload();
  }
  async function unsubscribe() {
    await fetch(`/api/manage/unsubscribe?token=${token}`, { method: "POST" });
    clearToken();
    setView(null);
    setError("已退订。想重新订阅，回首页再来一次就好。");
  }

  if (error)
    return (
      <Shell>
        <div className="notice pop-in">
          <div className="big">🎧</div>
          <h1>没能打开</h1>
          <p>{error}</p>
          <div style={{ marginTop: 18 }}>
            <a className="btn accent" href="/">回首页</a>
          </div>
        </div>
      </Shell>
    );

  if (!view)
    return (
      <Shell>
        <Loading />
      </Shell>
    );

  return (
    <Shell right={<span className="tag">我的关注</span>}>
      <div className="me-head rise">
        <p className="eyebrow" style={{ marginBottom: 8 }}>我的关注</p>
        <span className="who">
          <span className="dot" aria-hidden="true" />
          {view.email}
        </span>
        <CitiesRow
          cities={view.cities}
          options={config?.cities ?? null}
          onSave={saveCities}
          label={(code) => config?.cities.find((c) => c.code === code)?.name ?? cityName(code)}
        />
      </div>

      <div className="tabs rise rise-1" data-active={tab} role="tablist" aria-label="关注内容">
        <span className="glider" aria-hidden="true" />
        <button role="tab" aria-selected={tab === 0} onClick={() => setTab(0)}>
          音乐人 <span className="n">{view.artists.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 1} onClick={() => setTab(1)}>
          演出 <span className="n">{view.shows.length}</span>
        </button>
      </div>

      {tab === 0 ? (
        <ArtistsTab artists={view.artists} onAdd={addArtist} onRemove={removeArtist} />
      ) : (
        <ShowsTab shows={view.shows} />
      )}

      <div className="footer-actions">
        <button className="btn-ghost" onClick={unsubscribe} style={{ color: "var(--coral)" }}>
          退订全部提醒
        </button>
      </div>
    </Shell>
  );
}

// City pills with an inline editor. Collapsed: shows the followed cities plus
// an "编辑" toggle. Expanded: a chip grid (all cities from /api/config) to
// pick 1–10, wired to POST /api/manage/cities.
function CitiesRow({
  cities,
  options,
  onSave,
  label,
}: {
  cities: string[];
  options: { code: string; name: string }[] | null;
  onSave: (cities: string[]) => Promise<void>;
  label: (code: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(cities);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function open() {
    setDraft(cities);
    setErr("");
    setEditing(true);
  }
  function toggle(code: string) {
    setDraft((d) => (d.includes(code) ? d.filter((x) => x !== code) : [...d, code]));
  }
  async function save() {
    setBusy(true);
    setErr("");
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  if (!editing)
    return (
      <div className="me-cities">
        {cities.map((c) => (
          <span key={c} className="pill">📍 {label(c)}</span>
        ))}
        {options && (
          <button className="pill pill-edit" onClick={open}>✎ 编辑城市</button>
        )}
      </div>
    );

  const valid = draft.length >= 1 && draft.length <= 10;
  return (
    <div className="city-editor pop-in">
      <p className="hint" style={{ margin: "0 0 10px" }}>选择接收提醒的城市（1–10 个）</p>
      <ul className="cities">
        {options!.map((c) => {
          const on = draft.includes(c.code);
          return (
            <li key={c.code}>
              <label className={`city-chip${on ? " on" : ""}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(c.code)} />
                {c.name}
              </label>
            </li>
          );
        })}
      </ul>
      {err && <p className="error">{err}</p>}
      <div className="editor-actions">
        <button className="btn accent" onClick={save} disabled={busy || !valid}>
          {busy ? "保存中…" : "保存"}
        </button>
        <button className="btn-ghost" onClick={() => setEditing(false)}>取消</button>
      </div>
    </div>
  );
}

function ArtistsTab({
  artists,
  onAdd,
  onRemove,
}: {
  artists: View["artists"];
  onAdd: (name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState("");
  function submit() {
    const name = v.trim();
    if (!name) return;
    onAdd(name);
    setV("");
    setAdding(false);
  }

  if (artists.length === 0 && !adding)
    return (
      <section className="rise">
        <div className="empty">
          <span className="glyph">🎸</span>
          <h3>还没有关注的音乐人</h3>
          <p>加几位你喜欢的乐队或音乐人，他们开演出时我们会提醒你。</p>
          <div style={{ marginTop: 16 }}>
            <button className="btn accent" onClick={() => setAdding(true)}>＋ 添加音乐人</button>
          </div>
        </div>
      </section>
    );

  return (
    <section className="rise">
      {adding && (
        <div className="inline-add pop-in" style={{ marginBottom: 14 }}>
          <input
            className="input"
            autoFocus
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="音乐人名称"
          />
          <button className="btn accent" onClick={submit} disabled={!v.trim()}>添加</button>
        </div>
      )}
      <div className="artist-wall">
        {artists.map((a) => (
          <div key={a.id} className="artist-tile">
            <button
              type="button"
              className="artist-tile-remove"
              aria-label={`移除 ${a.name}`}
              onClick={() => onRemove(a.id)}
            >
              ×
            </button>
            <ArtistAvatar name={a.name} avatar={a.avatar} size="fill" />
            <span className="artist-tile-name">{a.name}</span>
          </div>
        ))}
        {!adding && (
          <button className="add-tile" onClick={() => setAdding(true)}>
            <span className="plus">＋</span>
            添加
          </button>
        )}
      </div>
    </section>
  );
}

function ShowsTab({ shows }: { shows: UpcomingShow[] }) {
  if (shows.length === 0)
    return (
      <section className="rise">
        <div className="empty">
          <span className="glyph">🎟️</span>
          <h3>暂时没有临近的演出</h3>
          <p>你关注的音乐人还没有排上你所在城市的演出。一旦有新场次，会立刻出现在这里，也会发到你邮箱。</p>
        </div>
      </section>
    );

  return (
    <section className="rise">
      <ul className="shows">
        {shows.map((s) => {
          const stub = stubParts(s.showTime);
          return (
            <li key={s.id} className="ticket pop-in">
              {stub ? (
                <div className="stub">
                  <span className="mon">{stub.mon}</span>
                  <span className="day">{stub.day}</span>
                  {stub.time && <span className="time">{stub.time}</span>}
                </div>
              ) : (
                <div className="stub tbd">时间<br />待定</div>
              )}
              <div className="perf" aria-hidden="true" />
              <div className="body">
                {s.poster && <img className="poster" src={posterThumb(s.poster)} alt="" loading="lazy" />}
                <div className="meta">
                  <p className="t-title">{s.title}</p>
                  <p className="t-artists">
                    {s.artistNames.map((n, i) => (
                      <span key={n}>
                        {i > 0 && " · "}
                        <mark>{n}</mark>
                      </span>
                    ))}
                  </p>
                  <p className="t-row">📍 {cityName(s.cityCode)} · {s.venue ?? "场地待定"}</p>
                  <p className="t-row">🎫 {s.price ?? "票价待定"}</p>
                  <a className="t-cta" href={s.url} target="_blank" rel="noreferrer">购票 / 详情 →</a>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
