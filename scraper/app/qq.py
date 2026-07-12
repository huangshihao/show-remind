from typing import Any

from fastapi import HTTPException

from app.models import PlaylistOut, SongOut


def _extract_title(raw: dict[str, Any]) -> str:
    # qqmusic-api-python 0.6.x returns the songlist metadata under "info".
    info = raw.get("info") or raw.get("dirinfo") or {}
    return info.get("title") or info.get("dirname") or raw.get("dissname") or raw.get("title") or ""


def _extract_song_name(song: dict[str, Any]) -> str:
    return song.get("name") or song.get("songname") or song.get("title") or ""


def _extract_artists(song: dict[str, Any]) -> list[str]:
    singers = song.get("singer") or song.get("singers") or []
    names = [s.get("name") for s in singers if isinstance(s, dict) and s.get("name")]
    return names


def transform_qq_playlist(raw: dict[str, Any]) -> PlaylistOut:
    # 0.6.x uses "songs"; keep "songlist" as a fallback for older shapes.
    rows = raw.get("songs")
    if rows is None:
        rows = raw.get("songlist") or []
    songs = [SongOut(name=_extract_song_name(s), artists=_extract_artists(s)) for s in rows]
    return PlaylistOut(title=_extract_title(raw), songs=songs)


# num per page for the paginated songlist/get_detail call; anonymous access allows 100.
_QQ_PAGE_SIZE = 100
_QQ_MAX_PAGES = 60  # safety cap: 6000 songs


async def fetch_qq_playlist_raw(playlist_id: str) -> dict[str, Any]:
    """Fetch a public QQ Music songlist via qqmusic-api-python (0.6.x).

    Isolated so tests can monkeypatch it. Anonymous get_detail returns at most
    `num` songs per page, so we page until `hasmore` is falsy or `total` is reached
    and return a normalized {"info": {"title": ...}, "songs": [...]} shape.
    """
    from qqmusic_api import Client  # type: ignore

    client = Client()
    try:
        title = ""
        total: int | None = None
        all_songs: list[Any] = []
        page = 1
        while page <= _QQ_MAX_PAGES:
            resp = await client.songlist.get_detail(
                int(playlist_id), num=_QQ_PAGE_SIZE, page=page
            )
            d = resp.model_dump() if hasattr(resp, "model_dump") else dict(resp)
            if page == 1:
                code = d.get("code")
                if code not in (0, None):
                    raise RuntimeError(f"qq songlist code={code} msg={d.get('msg')!r}")
                title = (d.get("info") or {}).get("title", "")
                total = d.get("total")
            rows = d.get("songs") or []
            all_songs.extend(rows)
            reached_total = total is not None and len(all_songs) >= total
            if not rows or not d.get("hasmore") or reached_total:
                break
            page += 1
        return {"info": {"title": title}, "songs": all_songs}
    finally:
        await client.close()


async def get_qq_playlist(playlist_id: str) -> PlaylistOut:
    try:
        raw = await fetch_qq_playlist_raw(playlist_id)
    except Exception as exc:  # noqa: BLE001 - upstream lib raises many types
        raise HTTPException(status_code=502, detail=f"qq fetch failed: {exc}") from exc
    return transform_qq_playlist(raw)
