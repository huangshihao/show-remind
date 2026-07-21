// NetEase plaintext API. The weapi encrypted gateway is soft-blocked for
// overseas (Cloudflare) egress IPs — returns HTTP 200 with an empty body.
// The plaintext /api/ endpoints are not IP-restricted and return the same JSON.
// See docs/superpowers/specs/2026-07-13-cloudflare-open-source-refactor-design.md §6 and spec (2026-07-13 spike).

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
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`netease ${url} non-JSON body status=${resp.status}`);
  }
  // Overseas egress (Cloudflare / CI) gets intermittent risk control: the
  // request answers 200 with a valid JSON body but a non-200 `code` and no
  // data (e.g. -460 "网络繁忙"). Success always carries code:200, so treat any
  // explicit non-200 code as a (transient, retryable) failure rather than
  // letting it slip through as a silent empty result. A body that omits code
  // is left alone.
  if (typeof json?.code === "number" && json.code !== 200) {
    throw new Error(`netease ${url} risk-control code=${json.code} status=${resp.status}`);
  }
  return json;
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

// Artist head info by id — the song payloads carry artist ids but no images;
// this endpoint returns the avatar. Same plaintext /api/ family as the two
// above, so it works from Cloudflare egress too.
export async function fetchArtistHeadRaw(artistId: string): Promise<any> {
  return post(`https://music.163.com/api/artist/head/info/get?id=${encodeURIComponent(artistId)}`, {});
}
