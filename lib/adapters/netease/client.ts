import { weapi } from "./weapi";

const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Referer: "https://music.163.com",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
};

async function weapiPost(url: string, payload: unknown): Promise<any> {
  const { params, encSecKey } = weapi(payload);
  const body = new URLSearchParams({ params, encSecKey });
  const resp = await fetch(url, { method: "POST", headers: HEADERS, body });
  if (!resp.ok) throw new Error(`netease ${url} responded ${resp.status}`);
  return resp.json();
}

export async function fetchPlaylistDetailRaw(externalId: string): Promise<any> {
  return weapiPost("https://music.163.com/weapi/v6/playlist/detail", {
    id: externalId,
    n: 100000,
    s: 8,
  });
}

export async function fetchSongDetailRaw(trackIds: string[]): Promise<any> {
  const c = JSON.stringify(trackIds.map((id) => ({ id })));
  return weapiPost("https://music.163.com/weapi/v3/song/detail", { c });
}
