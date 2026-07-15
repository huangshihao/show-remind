import { zzcSign } from "./qq-sign";
import BASE_COMM from "./qq-device.json";

// QQ Music web API (u.y.qq.com/cgi-bin/musicu.fcg), reverse-engineered from
// qqmusic-api-python. The request is {comm, request:{module,method,param}};
// sign = zzcSign(bodyJSON) is passed as a query param. BASE_COMM is a device
// fingerprint captured from a working request (QIMEI etc.) — the server accepts
// a fixed/reused set. If QQ ever rejects it, re-capture and replace qq-device.json.

const MUSICU_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const PAGE_SIZE = 100;
const MAX_PAGES = 60; // safety cap: 6000 songs

export interface QqSongArtist {
  name: string;
  avatar?: string;
}
export interface QqSong {
  name: string;
  artists: QqSongArtist[];
}
export interface QqPlaylist {
  title: string;
  songs: QqSong[];
}

async function getDetailRaw(disstid: number, num: number, page: number): Promise<any> {
  const payload = {
    comm: BASE_COMM,
    request: {
      module: "music.srfDissInfo.DissInfo",
      method: "CgiGetDiss",
      param: {
        disstid,
        dirid: 0,
        song_num: num,
        song_begin: (page - 1) * num,
        tag: true,
        userinfo: true,
        onlysong: 0,
        orderlist: 1,
      },
    },
  };
  const body = JSON.stringify(payload);
  const sign = zzcSign(body);
  const resp = await fetch(`${MUSICU_URL}?_=${Date.now()}&sign=${sign}`, {
    method: "POST",
    body,
  });
  if (!resp.ok) throw new Error(`qq musicu responded ${resp.status}`);
  return resp.json();
}

function detailData(raw: any): any {
  return raw?.request?.data ?? {};
}

// Singer photo by mid, same URL scheme the QQ Music web player uses. R300x300
// is a server-side resize; the origin returns image/jpeg for any valid mid.
function singerAvatarUrl(mid: string): string {
  return `https://y.qq.com/music/photo_new/T001R300x300M000${mid}.jpg`;
}

export function transformQqDetail(data: any): QqPlaylist {
  const songs: QqSong[] = (data?.songlist ?? []).map((s: any) => ({
    name: s?.name ?? s?.songname ?? s?.title ?? "",
    artists: (s?.singer ?? [])
      .filter((x: any) => Boolean(x?.name))
      .map((x: any): QqSongArtist =>
        x.mid ? { name: x.name, avatar: singerAvatarUrl(x.mid) } : { name: x.name },
      ),
  }));
  return { title: data?.dirinfo?.title ?? "", songs };
}

export async function fetchQqPlaylist(externalId: string): Promise<QqPlaylist> {
  const id = Number(externalId);
  const first = await getDetailRaw(id, PAGE_SIZE, 1);
  const data = detailData(first);
  if (first?.request?.code !== 0 && data?.code !== 0) {
    throw new Error(
      `qq playlist ${externalId} failed: reqCode=${first?.request?.code} dataCode=${data?.code}`,
    );
  }
  const { title, songs } = transformQqDetail(data);
  const total: number = data?.songlist_size ?? songs.length;

  let page = 2;
  while (songs.length < total && page <= MAX_PAGES) {
    const next = await getDetailRaw(id, PAGE_SIZE, page);
    const batch = transformQqDetail(detailData(next)).songs;
    if (batch.length === 0) break;
    songs.push(...batch);
    page += 1;
  }
  return { title, songs };
}
