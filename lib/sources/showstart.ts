import crypto from "node:crypto";
import { normalizeName } from "@/lib/matcher/normalize";
import { showstartCityId } from "@/lib/cities";

// Showstart wap v3 API, reverse-engineered.
// See docs/showstart-reverse-engineering.md for the full contract.

const API_BASE = "https://wap.showstart.com/v3";
const detailUrl = (id: string) =>
  `https://wap.showstart.com/pages/activity/detail/detail?activityId=${id}`;

// Device fingerprint header value (URL-encoded JSON). Not part of the signature,
// but the WAF rejects requests that omit it (response state "sys001").
const DEVICE_INFO = encodeURIComponent(
  JSON.stringify({
    vendorName: "",
    deviceMode: "PC",
    deviceName: "",
    systemName: "macos",
    systemVersion: "10.15.7",
    cpuMode: " ",
    cpuCores: "",
    cpuArch: "",
    memerySize: "",
    diskSize: "",
    network: "4G",
    resolution: "1920*1080",
    pixelResolution: "",
  }),
);

// Response states meaning the guest accessToken is stale and must be refreshed.
const TOKEN_ERROR_STATES = new Set([
  "token-clean-at",
  "token-expire-at",
  "token-expire-ut",
  "token-clean-ut",
  "login.other.terminal",
]);

const TIME_RE = /(\d{4})\.(\d{1,2})\.(\d{1,2}).*?(\d{1,2}):(\d{2})/;

// /app/activity/search sortType, probed against the live API:
//   "" | "0" | "1" | "3" -> by show date, soonest first (all identical)
//   "2"                  -> by publication recency, newest first
//   "4" | "5"            -> include long-past shows (2023/2024); not useful here
// Newest-first is what an incremental crawler wants: a show announced today for
// a date months out appears on page 1 here, but tens of pages deep under the
// date sort — so the date sort can't see new announcements until they're nearly
// upon us, which for a ticket-reminder product is exactly too late.
export const SORT_NEWEST_FIRST = "2";

// The date sort has a shape worth knowing (probed against 上海, which lists ~4000
// shows in total): pages 1..~45 are the UPCOMING shows in ascending date order,
// and from roughly page 46 the listing turns around and walks the PAST in
// descending order (p40 -> 2026-10-19, p50 -> 2026-07-03, p100 -> 2026-05-28).
//
// So every upcoming show in a city is reachable in the first ~45 pages, and
// everything after that is history. That makes this the right sort for a full
// enumeration — walk until the dates turn around — while SORT_NEWEST_FIRST is the
// right sort for an incremental crawl. Same set, different order, very different
// cost: 45 pages instead of 400.
export const SORT_BY_DATE = "";

function md5(text: string): string {
  return crypto.createHash("md5").update(text, "utf8").digest("hex");
}

export function normalizeShowTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = TIME_RE.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const pad = (n: string) => n.padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${mi}:00`;
}

// Showstart's epoch-ms fields are the authoritative instant; showTime is only a
// display string. Prefer the epoch: a multi-day event's showTime is a RANGE
// ("2026.05.01－05.04") that carries no clock time and cannot be parsed at all,
// which used to yield NULL — and NULL was read as "date unknown, so upcoming",
// leaving finished festivals on the page for months.
//
// Emitted as Beijing wall-clock (the venue's own timezone), matching what the
// site displays and what the UI renders verbatim. Done by offsetting rather than
// via Intl: China has had a single UTC+8 offset with no DST since 1991, so the
// arithmetic is exact and does not depend on the runtime's ICU data.
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export function showTimeFromEpoch(epochMs: unknown): string | null {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs) || epochMs <= 0) return null;
  return new Date(epochMs + BEIJING_OFFSET_MS).toISOString().slice(0, 19);
}

export interface ShowSummary {
  showstartId: string;
  title: string;
  cityCode: string;
  showTime: string | null;
  url: string;
  poster: string | null;
}

export interface ShowDetail {
  showstartId: string;
  title: string;
  cityCode: string;
  venue: string | null;
  showTime: string | null;
  price: string | null;
  url: string;
  performers: string[];
  poster: string | null;
}

export class ShowstartClient {
  private deviceNo = crypto.randomBytes(16).toString("hex"); // 32 hex, stable per client
  private accessToken = "";
  private tokenPromise: Promise<void> | null = null;

  private sign(body: string, urlPath: string, trace: string): string {
    // accessToken + sign + idToken + userId + "wap" + deviceNo + body + urlPath + "997" + CSAPPID + traceId
    return md5(
      this.accessToken +
        "" + // sign (CUSUT)
        "" + // idToken (CUSIT)
        "" + // userId (CUSID)
        "wap" +
        this.deviceNo +
        body +
        urlPath +
        "997" +
        "wap" + // CSAPPID
        trace,
    );
  }

  private headers(body: string, urlPath: string): Record<string, string> {
    const trace = crypto.randomBytes(16).toString("hex") + Date.now();
    return {
      "Content-Type": "application/json",
      CUSAT: this.accessToken || "nil",
      CUSUT: "nil",
      CUSIT: "nil",
      CUSID: "nil",
      CUSNAME: "nil",
      CTERMINAL: "wap",
      CSAPPID: "wap",
      CDEVICENO: this.deviceNo,
      CUUSERREF: this.deviceNo,
      CVERSION: "997",
      CDEVICEINFO: DEVICE_INFO,
      CRTRACEID: trace,
      st_flpv: "",
      CRPSIGN: this.sign(body, urlPath, trace),
    };
  }

  private async callRaw(method: "GET" | "POST", urlPath: string, body: string): Promise<any> {
    const init: RequestInit = { method, headers: this.headers(body, urlPath) };
    if (method === "POST") init.body = body;
    const resp = await fetch(API_BASE + urlPath, init);
    if (!resp.ok) throw new Error(`showstart ${urlPath} responded ${resp.status}`);
    return resp.json();
  }

  private async doFetchToken(): Promise<void> {
    const data = await this.callRaw("GET", "/waf/gettoken", "");
    const token = data?.result?.accessToken?.access_token;
    if (!token) {
      throw new Error(`showstart gettoken failed: state=${data?.state} msg=${data?.msg}`);
    }
    this.accessToken = token;
  }

  // Single-flight guard: concurrent callers (e.g. up to 40 parallel avatar
  // lookups in resolve.ts) that all see a missing/stale token must share ONE
  // /waf/gettoken request, not fire one each (thundering herd on the 50
  // Workers subrequest budget, and bot-like to Showstart's WAF).
  private fetchToken(): Promise<void> {
    if (!this.tokenPromise) {
      this.tokenPromise = this.doFetchToken().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  private async request(method: "GET" | "POST", urlPath: string, body = ""): Promise<any> {
    if (!this.accessToken) await this.fetchToken();
    let data = await this.callRaw(method, urlPath, body);
    if (TOKEN_ERROR_STATES.has(String(data?.state ?? "").toLowerCase())) {
      await this.fetchToken(); // same deviceNo, new token
      data = await this.callRaw(method, urlPath, body);
    }
    return data;
  }

  // showstartCityId is Showstart's INTERNAL city id (北京=10), not the行政区码.
  // isHome MUST be 0: isHome:1 returns a fixed home/featured feed and ignores
  // cityId, so every city would get the same ~10 curated shows.
  // sortType defaults to newest-published (see SORT_NEWEST_FIRST).
  async fetchCityShowsRaw(
    showstartCityId: string,
    page: number,
    sortType: string = SORT_NEWEST_FIRST,
  ): Promise<any> {
    const body = JSON.stringify({
      activityType: 0,
      pageNo: page,
      isHome: 0,
      saleSituation: "",
      startTime: "",
      endTime: "",
      showStyle: "",
      sortType,
      service: "",
      price: "",
      cityType: 0,
      cityId: Number(showstartCityId),
      st_flpv: "",
      sign: "",
      trackPath: "",
    });
    return this.request("POST", "/app/activity/search", body);
  }

  async fetchShowDetailRaw(showId: string): Promise<any> {
    const body = JSON.stringify({
      activityId: Number(showId),
      st_flpv: "",
      sign: "",
      trackPath: "",
    });
    return this.request("POST", "/wap/activity/details", body);
  }

  async searchUserRaw(keyword: string): Promise<any> {
    return this.request(
      "POST",
      "/app/user/search",
      JSON.stringify({ keyword, pageNo: 1, pageSize: 5 }),
    );
  }
}

export function transformShowList(raw: any, cityCode: string): { shows: ShowSummary[] } {
  const rows: any[] = raw?.result?.activityInfo ?? [];
  const shows: ShowSummary[] = [];
  for (const row of rows) {
    const id = String(row?.activityId ?? "");
    if (!id) continue;
    shows.push({
      showstartId: id,
      title: row?.title ?? "",
      cityCode: String(row?.cityId ?? cityCode),
      showTime: showTimeFromEpoch(row?.showStartTime) ?? normalizeShowTime(row?.showTime),
      url: detailUrl(id),
      poster: row?.avatar ?? null,
    });
  }
  return { shows };
}

function detailVenue(result: any): string | null {
  const site = result?.site;
  if (site && typeof site === "object") return site.siteName ?? site.name ?? null;
  if (typeof site === "string") return site || null;
  return result?.siteName ?? null;
}

function detailPerformers(result: any): string[] {
  // Performers are sessionUserInfos[].userInfos[] with activityRoleType === 2.
  // host[] (activityRoleType 5) is the organizer and is excluded.
  const names: string[] = [];
  const seen = new Set<string>();
  for (const session of result?.sessionUserInfos ?? []) {
    for (const user of session?.userInfos ?? []) {
      if (user?.activityRoleType === 2) {
        const name = user?.name;
        if (name && !seen.has(name)) {
          seen.add(name);
          names.push(name);
        }
      }
    }
  }
  return names;
}

export function transformShowDetail(raw: any): ShowDetail {
  const result = raw?.result ?? {};
  const id = String(result?.activityId ?? "");
  const price = result?.price;
  return {
    showstartId: id,
    title: result?.title ?? result?.activityName ?? "",
    cityCode: String(result?.cityId ?? ""),
    venue: detailVenue(result),
    showTime: showTimeFromEpoch(result?.showStartTime) ?? normalizeShowTime(result?.showTime),
    price: price != null && price !== "" ? String(price) : null,
    url: detailUrl(id),
    performers: detailPerformers(result),
    poster: result?.avatar ?? null,
  };
}

// A single shared client reuses one deviceNo + guest token across requests.
let shared: ShowstartClient | null = null;
function client(): ShowstartClient {
  if (!shared) shared = new ShowstartClient();
  return shared;
}

// cityCode is the行政区码 (e.g. 110000). Translates it to Showstart's internal
// city id for the request, then stamps that行政区码 back onto every show — a
// row's own cityId (when present) is Showstart's internal id, which the
// subscription/notify city filter doesn't understand. Returns no shows for a
// city with no pinned Showstart id, rather than crawling against a wrong id.
export async function fetchCityShows(
  cityCode: string,
  page: number,
  sortType: string = SORT_NEWEST_FIRST,
): Promise<{ shows: ShowSummary[] }> {
  const ssid = showstartCityId(cityCode);
  if (ssid == null) return { shows: [] };
  const raw = await client().fetchCityShowsRaw(String(ssid), page, sortType);
  const { shows } = transformShowList(raw, cityCode);
  return { shows: shows.map((s) => ({ ...s, cityCode })) };
}

export async function fetchShowDetail(showId: string): Promise<ShowDetail> {
  return transformShowDetail(await client().fetchShowDetailRaw(showId));
}

export interface ArtistHit {
  id: number;
  name: string;
  avatar: string | null;
  fansNum: number;
}

export function transformArtistSearch(raw: any): ArtistHit[] {
  const rows: any[] = Array.isArray(raw?.result) ? raw.result : [];
  const hits: ArtistHit[] = [];
  for (const row of rows) {
    if (row?.type !== 2 && row?.userType !== 2) continue;
    hits.push({
      id: row?.id,
      name: row?.name ?? "",
      avatar: row?.avatar ?? null,
      fansNum: row?.fansNum ?? 0,
    });
  }
  return hits;
}

// Searches Showstart's artist database and picks the best match for `name`:
// an exact normalized-name match wins; otherwise the hit with the most fans.
// Returns null only when the search itself succeeded but yielded no artist
// hits — a genuine "not found". Network/parse failures are NOT swallowed
// here; they throw, so a caller can tell "no match" apart from "couldn't
// check" (see searchArtist below for the swallowing sibling).
export async function searchArtistStrict(name: string): Promise<ArtistHit | null> {
  const hits = transformArtistSearch(await client().searchUserRaw(name));
  if (hits.length === 0) return null;
  const target = normalizeName(name);
  const exact = hits.find((hit) => normalizeName(hit.name) === target);
  if (exact) return exact;
  return hits.reduce((best, hit) => (hit.fansNum > best.fansNum ? hit : best));
}

// Same matching logic as searchArtistStrict, but never throws — a lookup
// failure just means no avatar, not a broken resolve. Used by resolve.ts,
// where degrading to "no avatar" on error is the desired behavior (unlike
// manage.ts's avatar backfill, which must NOT cache an error as "no match").
export async function searchArtist(name: string): Promise<ArtistHit | null> {
  try {
    return await searchArtistStrict(name);
  } catch {
    return null;
  }
}
