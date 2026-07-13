import { useEffect, useReducer, useState } from "react";
import { initialWizard, wizardReducer, selectedArtistNames } from "./wizard-state";
import { getConfig, resolveLink, subscribe, requestLogin, type Config } from "./api";
import { Turnstile } from "./Turnstile";
import { getStoredToken } from "./session";

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
      <main className="card">
        <h1>就快好了 🎉</h1>
        <p>确认邮件已发到 <b>{state.email}</b>，点击里面的链接即可开始接收演出提醒。</p>
      </main>
    );

  return (
    <main className="card">
      <h1>Show-Remind</h1>
      <p className="sub">粘贴歌单，选关注的音乐人，留个邮箱，有新演出就发邮件。</p>
      {getStoredToken() ? (
        <p className="sub"><a href="/manage">← 进入我的管理页</a></p>
      ) : (
        <LoginEntry config={config} />
      )}
      {error && <p className="err">{error}</p>}

      {state.step === 0 && (
        <>
          <label>网易云 / QQ 音乐 公开歌单链接</label>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
          {config?.publicMode && (
            <Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} />
          )}
          <button disabled={busy || !link} onClick={onResolve}>解析歌单</button>
          <button className="link" onClick={() => dispatch({ type: "LOADED_PLAYLIST", title: "手动添加", artists: [] })}>
            跳过，手动输入音乐人
          </button>
        </>
      )}

      {state.step === 1 && (
        <>
          <label>选择要关注的音乐人（{selectedArtistNames(state).length}）</label>
          <ul className="artists">
            {state.artists.map((a) => (
              <li key={a.name}>
                <label>
                  <input
                    type="checkbox"
                    checked={state.selected.includes(a.name)}
                    onChange={() => dispatch({ type: "TOGGLE_ARTIST", name: a.name })}
                  />
                  {a.name} {a.songCount > 0 && <span className="count">· {a.songCount} 首</span>}
                </label>
              </li>
            ))}
          </ul>
          <ManualAdd onAdd={(name) => dispatch({ type: "ADD_MANUAL", name })} />
          <button disabled={!selectedArtistNames(state).length} onClick={() => dispatch({ type: "GOTO", step: 2 })}>
            下一步：选城市
          </button>
        </>
      )}

      {state.step === 2 && config && (
        <>
          <label>关注的城市（1-10）</label>
          <div className="cities">
            {config.cities.map((c) => (
              <label key={c.code}>
                <input
                  type="checkbox"
                  checked={state.cities.includes(c.code)}
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
            ))}
          </div>
          <button disabled={!state.cities.length} onClick={() => dispatch({ type: "GOTO", step: 3 })}>
            下一步：填邮箱
          </button>
        </>
      )}

      {state.step === 3 && (
        <>
          <label>接收提醒的邮箱</label>
          <input
            type="email"
            value={state.email}
            onChange={(e) => dispatch({ type: "SET_EMAIL", email: e.target.value })}
            placeholder="you@example.com"
          />
          {config?.publicMode && <Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} />}
          <button disabled={busy || !state.email} onClick={onSubscribe}>订阅</button>
        </>
      )}
    </main>
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
    return <p className="sub">如果这个邮箱订阅过，登录链接已发到你的邮箱，请查收。</p>;
  }

  if (!open) {
    return (
      <p className="sub">
        已经订阅过？<button className="link" onClick={() => setOpen(true)}>用邮箱登录</button>
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
    <div className="login-entry">
      <div className="manual">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <button disabled={busy || !email} onClick={onSubmit}>发送登录链接</button>
      </div>
      {config?.publicMode && <Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} />}
      {error && <p className="err">{error}</p>}
    </div>
  );
}

function ManualAdd({ onAdd }: { onAdd: (name: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="manual">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="手动添加音乐人" />
      <button
        className="link"
        onClick={() => {
          onAdd(v);
          setV("");
        }}
      >
        添加
      </button>
    </div>
  );
}
