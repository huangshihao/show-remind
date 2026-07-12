import hashlib
from typing import Any

import httpx
from fastapi import HTTPException

from app.models import CityShowsOut, ShowDetailOut, ShowSummaryOut

WAP_BASE = "https://wap.showstart.com"
DETAIL_URL = WAP_BASE + "/pages/activity/detail/detail?activityId={id}"
# Salt is the known wap signing secret; update here if the upstream algorithm changes.
SIGN_SALT = "&d1zNAX3tE5vd1ukliozxfCB2AI="


def _normalize_time(raw_time: str | None) -> str | None:
    if not raw_time:
        return None
    return raw_time.strip().replace(" ", "T")


def _sign(params: dict[str, Any]) -> str:
    ordered = "".join(f"{k}={params[k]}" for k in sorted(params))
    return hashlib.md5((ordered + SIGN_SALT).encode("utf-8")).hexdigest()


class ShowstartClient:
    """Isolated network + signature layer. Transform functions do not depend on it,
    so parsing is testable offline; the live path is exercised in the manual smoke."""

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client

    async def _request(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        params = {**params, "sign": _sign(params)}
        owns = self._client is None
        client = self._client or httpx.AsyncClient(timeout=15)
        try:
            resp = await client.get(WAP_BASE + path, params=params)
            resp.raise_for_status()
            return resp.json()
        finally:
            if owns:
                await client.aclose()

    async def fetch_city_shows_raw(self, city_code: str, page: int) -> dict[str, Any]:
        return await self._request(
            "/api/activity/list", {"cityCode": city_code, "pageNo": page, "pageSize": 20}
        )

    async def fetch_show_detail_raw(self, show_id: str) -> dict[str, Any]:
        return await self._request("/api/activity/detail", {"activityId": show_id})


def _rows(raw: dict[str, Any]) -> list[dict[str, Any]]:
    data = raw.get("data") or {}
    return data.get("result") or data.get("list") or []


def transform_show_list(raw: dict[str, Any], city_code: str) -> CityShowsOut:
    shows: list[ShowSummaryOut] = []
    for row in _rows(raw):
        activity_id = str(row.get("activityId") or row.get("id") or "")
        if not activity_id:
            continue
        shows.append(
            ShowSummaryOut(
                showstart_id=activity_id,
                title=row.get("title") or "",
                city_code=str(row.get("cityCode") or city_code),
                show_time=_normalize_time(row.get("showTime")),
                url=DETAIL_URL.format(id=activity_id),
            )
        )
    return CityShowsOut(shows=shows)


async def get_city_shows(city_code: str, page: int) -> CityShowsOut:
    client = ShowstartClient()
    try:
        raw = await client.fetch_city_shows_raw(city_code, page)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"showstart list failed: {exc}") from exc
    return transform_show_list(raw, city_code)


def _detail_body(raw: dict[str, Any]) -> dict[str, Any]:
    return raw.get("data") or raw


def _performers(body: dict[str, Any]) -> list[str]:
    performers = body.get("performers") or body.get("artists") or []
    return [p.get("name") for p in performers if isinstance(p, dict) and p.get("name")]


def transform_show_detail(raw: dict[str, Any]) -> ShowDetailOut:
    body = _detail_body(raw)
    activity_id = str(body.get("activityId") or body.get("id") or "")
    return ShowDetailOut(
        showstart_id=activity_id,
        title=body.get("title") or "",
        city_code=str(body.get("cityCode") or ""),
        venue=body.get("siteName") or body.get("venue"),
        show_time=_normalize_time(body.get("showTime")),
        price=body.get("price"),
        url=DETAIL_URL.format(id=activity_id),
        performers=_performers(body),
    )


async def get_show_detail(show_id: str) -> ShowDetailOut:
    client = ShowstartClient()
    try:
        raw = await client.fetch_show_detail_raw(show_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"showstart detail failed: {exc}") from exc
    return transform_show_detail(raw)
