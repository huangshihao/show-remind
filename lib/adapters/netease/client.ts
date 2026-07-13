// NetEase plaintext API. The weapi encrypted gateway is soft-blocked for
// overseas (Cloudflare) egress IPs — returns HTTP 200 with an empty body.
// The plaintext /api/ endpoints are not IP-restricted and return the same JSON.
// See docs/showstart-reverse-engineering.md and spec §6 (2026-07-13 spike).

const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Referer: "https://music.163.com",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
};

async function post(url: string, form: Record<string, string>): Promise<any> {
  const resp = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: new URLSearchParams(form),
  });
  const text = await resp.text();
  if (!resp.ok || text.length === 0) {
    throw new Error(`netease ${url} responded status=${resp.status} len=${text.length}`);
  }
  return JSON.parse(text);
}

export async function fetchPlaylistDetailRaw(externalId: string): Promise<any> {
  return post("https://music.163.com/api/v6/playlist/detail", {
    id: externalId,
    n: "100000",
    s: "8",
  });
}

export async function fetchSongDetailRaw(trackIds: string[]): Promise<any> {
  const c = JSON.stringify(trackIds.map((id) => ({ id })));
  return post("https://music.163.com/api/v3/song/detail", { c });
}
