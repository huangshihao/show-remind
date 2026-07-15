import { useEffect, useReducer, useState } from "react";
import { initialWizard, wizardReducer, selectedArtistNames } from "./wizard-state";
import { getConfig, resolveLink, subscribe, requestLogin, type Config } from "./api";
import { Turnstile } from "./Turnstile";
import { ArtistAvatar } from "./ArtistAvatar";
import { Shell } from "./Shell";

const STEP_COUNT = 4;

export function Wizard() {
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialWizard);
  const [config, setConfig] = useState<Config | null>(null);
  const [link, setLink] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    getConfig().then(setConfig).catch((e) => setError(String(e)));
  }, []);

  async function onResolve() {
    setBusy(true);
    setError("");
    try {
      const r = await resolveLink(link, token || undefined);
      dispatch({ type: "LOADED_PLAYLIST", title: r.title, artists: r.artists });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function onSubscribe() {
    setBusy(true);
    setError("");
    try {
      await subscribe({
        email: state.email,
        cities: state.cities,
        artists: selectedArtistNames(state),
        turnstileToken: token || undefined,
      });
      setDone(true);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <Shell>
        <div className="notice pop-in">
          <div className="big">🎫</div>
          <h1>就差最后一步</h1>
          <p>
            确认邮件已寄往 <b>{state.email}</b>。点开里面的链接，之后有你关注的音乐人来 livehouse，我们第一时间发邮件叫你。
          </p>
        </div>
      </Shell>
    );

  const selectedCount = selectedArtistNames(state).length;

  return (
    <Shell>
      {state.step === 0 && (
        <section className="rise">
          <p className="eyebrow">网易云 / QQ 音乐 → livehouse</p>
          <h1 className="display">
            关注的人来演出，<br />
            <em>别再错过</em>。
          </h1>
          <p className="lede">
            粘贴一份歌单，挑出你想追的音乐人，留个邮箱。他们在你的城市开演出时，你会先知道。
          </p>

          {error && <p className="error">{error}</p>}

          <div className="hero-card rise rise-1">
            <label className="field-label" htmlFor="playlist">歌单链接</label>
            <input
              id="playlist"
              className="input"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://music.163.com/playlist?id=…"
              inputMode="url"
            />
            {config?.publicMode && <div style={{ marginTop: 12 }}><Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} /></div>}
            <div style={{ marginTop: 16 }}>
              <button className="btn accent full" disabled={busy || !link} onClick={onResolve}>
                {busy ? "解析中…" : "解析歌单"}
              </button>
            </div>
            <p className="platform-note">
              <span><b>支持</b> 网易云音乐</span>
              <span><b>·</b> QQ 音乐</span>
              <span><b>·</b> 公开歌单</span>
            </p>
          </div>

          <LoginEntry config={config} />
        </section>
      )}

      {state.step > 0 && <StepRail step={state.step} />}

      {state.step === 1 && (
        <section className="rise">
          <div className="section-head">
            <h2>挑出想追的音乐人 <span className="count-chip">{selectedCount}</span></h2>
            <button className="btn-ghost" onClick={() => dispatch({ type: "GOTO", step: 0 })}>← 换歌单</button>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="artist-grid">
            {state.artists.map((a) => {
              const selected = state.selected.includes(a.name);
              return (
                <button
                  key={a.name}
                  type="button"
                  className={`artist-card${selected ? " selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => dispatch({ type: "TOGGLE_ARTIST", name: a.name })}
                >
                  <span className="artist-avatar-wrap">
                    <ArtistAvatar name={a.name} avatar={a.avatar} />
                    {selected && <span className="artist-check" aria-hidden="true">✓</span>}
                  </span>
                  <span className="artist-name">{a.name}</span>
                  {a.songCount > 0 && <span className="count">{a.songCount} 首</span>}
                </button>
              );
            })}
          </div>
          <button className="btn full" disabled={!selectedCount} onClick={() => dispatch({ type: "GOTO", step: 2 })}>
            下一步 · 选城市
          </button>
        </section>
      )}

      {state.step === 2 && config && (
        <section className="rise">
          <div className="section-head">
            <h2>你在哪些城市看演出</h2>
            <button className="btn-ghost" onClick={() => dispatch({ type: "GOTO", step: 1 })}>← 返回</button>
          </div>
          <p className="hint" style={{ margin: "0 0 14px" }}>最多 10 个。只有这些城市的演出会提醒你。</p>
          <ul className="cities">
            {config.cities.map((c) => {
              const on = state.cities.includes(c.code);
              return (
                <li key={c.code}>
                  <label className={`city-chip${on ? " on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        dispatch({
                          type: "SET_CITIES",
                          cities: e.target.checked
                            ? [...state.cities, c.code]
                            : state.cities.filter((x) => x !== c.code),
                        })
                      }
                    />
                    {c.name}
                  </label>
                </li>
              );
            })}
          </ul>
          <div style={{ marginTop: 22 }}>
            <button className="btn full" disabled={!state.cities.length} onClick={() => dispatch({ type: "GOTO", step: 3 })}>
              下一步 · 填邮箱
            </button>
          </div>
        </section>
      )}

      {state.step === 3 && (
        <section className="rise">
          <div className="section-head">
            <h2>提醒发到哪个邮箱</h2>
            <button className="btn-ghost" onClick={() => dispatch({ type: "GOTO", step: 2 })}>← 返回</button>
          </div>
          <p className="hint" style={{ margin: "0 0 14px" }}>
            关注 <b className="mono">{selectedCount}</b> 位音乐人 · <b className="mono">{state.cities.length}</b> 个城市
          </p>
          {error && <p className="error">{error}</p>}
          <label className="field-label" htmlFor="email">邮箱</label>
          <input
            id="email"
            className="input"
            type="email"
            value={state.email}
            onChange={(e) => dispatch({ type: "SET_EMAIL", email: e.target.value })}
            placeholder="you@example.com"
            inputMode="email"
          />
          {config?.publicMode && <div style={{ marginTop: 12 }}><Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} /></div>}
          <div style={{ marginTop: 18 }}>
            <button className="btn accent full" disabled={busy || !state.email} onClick={onSubscribe}>
              {busy ? "提交中…" : "开始接收演出提醒"}
            </button>
          </div>
        </section>
      )}
    </Shell>
  );
}

function StepRail({ step }: { step: number }) {
  return (
    <div className="steprail" aria-hidden="true">
      {Array.from({ length: STEP_COUNT }, (_, i) => (
        <span key={i} className={`seg ${i < step ? "done" : i === step ? "active" : ""}`} />
      ))}
    </div>
  );
}

function LoginEntry({ config }: { config: Config | null }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  if (sent) {
    return <p className="login-row"><span>📮 如果这个邮箱订阅过，登录链接已发出，去收件箱看看。</span></p>;
  }

  if (!open) {
    return (
      <p className="login-row">
        已经订阅过？
        <button className="btn-ghost" onClick={() => setOpen(true)}>用邮箱登录</button>
      </p>
    );
  }

  async function onSubmit() {
    setBusy(true);
    setError("");
    try {
      await requestLogin(email, token || undefined);
      setSent(true);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-panel">
      <label className="field-label" htmlFor="login-email">用订阅时的邮箱登录</label>
      <div className="inline-add">
        <input
          id="login-email"
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          inputMode="email"
        />
        <button className="btn" disabled={busy || !email} onClick={onSubmit}>发送链接</button>
      </div>
      {config?.publicMode && <Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} />}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
