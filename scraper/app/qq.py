from typing import Any

from fastapi import HTTPException

from app.models import PlaylistOut, SongOut


def _extract_title(raw: dict[str, Any]) -> str:
    dirinfo = raw.get("dirinfo") or {}
    return dirinfo.get("title") or raw.get("dissname") or raw.get("title") or ""


def _extract_song_name(song: dict[str, Any]) -> str:
    return song.get("name") or song.get("songname") or song.get("title") or ""


def _extract_artists(song: dict[str, Any]) -> list[str]:
    singers = song.get("singer") or song.get("singers") or []
    names = [s.get("name") for s in singers if isinstance(s, dict) and s.get("name")]
    return names


def transform_qq_playlist(raw: dict[str, Any]) -> PlaylistOut:
    songs = [
        SongOut(name=_extract_song_name(s), artists=_extract_artists(s))
        for s in (raw.get("songlist") or [])
    ]
    return PlaylistOut(title=_extract_title(raw), songs=songs)


async def fetch_qq_playlist_raw(playlist_id: str) -> dict[str, Any]:
    """Fetch a public QQ Music songlist via qqmusic-api-python.

    Isolated so tests can monkeypatch it. The exact call is confirmed against the
    installed qqmusic-api-python version during the manual smoke (Task 8).
    """
    from qqmusic_api import songlist  # type: ignore

    detail = await songlist.get_detail(int(playlist_id))
    return detail if isinstance(detail, dict) else dict(detail)


async def get_qq_playlist(playlist_id: str) -> PlaylistOut:
    try:
        raw = await fetch_qq_playlist_raw(playlist_id)
    except Exception as exc:  # noqa: BLE001 - upstream lib raises many types
        raise HTTPException(status_code=502, detail=f"qq fetch failed: {exc}") from exc
    return transform_qq_playlist(raw)
