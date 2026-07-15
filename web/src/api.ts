export interface Config {
  cities: { code: string; name: string }[];
  publicMode: boolean;
  turnstileSiteKey: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const getConfig = () => fetch("/api/config").then((r) => json<Config>(r));

export const resolveLink = (link: string, turnstileToken?: string) =>
  fetch("/api/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ link, turnstileToken }),
  }).then((r) =>
    json<{
      platform: string;
      title: string;
      artists: { name: string; songCount: number; avatar?: string | null }[];
    }>(r),
  );

export const subscribe = (payload: {
  email: string;
  cities: string[];
  artists: string[];
  turnstileToken?: string;
}) =>
  fetch("/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => json<{ ok: boolean }>(r));

export const setManageCities = (token: string, cities: string[]) =>
  fetch(`/api/manage/cities?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cities }),
  }).then((r) => json<{ ok: boolean }>(r));

export const requestLogin = (email: string, turnstileToken?: string) =>
  fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, turnstileToken }),
  }).then((r) => json<{ ok: boolean }>(r));

export const importPlaylist = (link: string, token: string, turnstileToken?: string) =>
  fetch(`/api/manage/import?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ link, turnstileToken }),
  }).then((r) => json<{ added: number; artists: { id: string; name: string }[] }>(r));
