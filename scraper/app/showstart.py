import hashlib
import json
import re
import secrets
import time
import urllib.parse
from typing import Any

import httpx
from fastapi import HTTPException

from app.models import CityShowsOut, ShowDetailOut, ShowSummaryOut

API_BASE = "https://wap.showstart.com/v3"
DETAIL_URL = "https://wap.showstart.com/pages/activity/detail/detail?activityId={id}"

# Device fingerprint header value (URL-encoded JSON). Not part of the signature,
# but the WAF rejects requests that omit it (response state "sys001").
_DEVICE_INFO = urllib.parse.quote(
    json.dumps(
        {
            "vendorName": "",
            "deviceMode": "PC",
            "deviceName": "",
            "systemName": "macos",
            "systemVersion": "10.15.7",
            "cpuMode": " ",
            "cpuCores": "",
            "cpuArch": "",
            "memerySize": "",
            "diskSize": "",
            "network": "4G",
            "resolution": "1920*1080",
            "pixelResolution": "",
        },
        separators=(",", ":"),
    ),
    safe="",
)

# Response states meaning the guest accessToken is stale and must be refreshed.
_TOKEN_ERROR_STATES = {
    "token-clean-at",
    "token-expire-at",
    "token-expire-ut",
    "token-clean-ut",
    "login.other.terminal",
}

_TIME_RE = re.compile(r"(\d{4})\.(\d{1,2})\.(\d{1,2}).*?(\d{1,2}):(\d{2})")


def _md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def _normalize_time(raw_time: str | None) -> str | None:
    """'2026.07.12 本周日 20:00' -> '2026-07-12T20:00:00'."""
    if not raw_time:
        return None
    m = _TIME_RE.search(raw_time)
    if not m:
        return None
    y, mo, d, h, mi = m.groups()
    return f"{y}-{int(mo):02d}-{int(d):02d}T{int(h):02d}:{mi}:00"


def _json_body(obj: dict[str, Any]) -> str:
    # Must equal the exact bytes sent on the wire; the signature hashes this string.
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


class ShowstartClient:
    """Network + signature layer for the Showstart wap v3 API.

    Reverse-engineered contract (see docs/showstart-reverse-engineering.md):
    every request carries a CRPSIGN header
        md5(accessToken + sign + idToken + userId + "wap" + deviceNo
            + body + urlPath + "997" + CSAPPID + traceId)
    plus a CDEVICEINFO header (required by the WAF). A guest accessToken is fetched
    from /waf/gettoken and is bound to a stable deviceNo. The transform functions do
    not depend on this class, so parsing stays testable offline.
    """

    def __init__(self, http: httpx.AsyncClient | None = None) -> None:
        self._http = http
        self._device_no = secrets.token_hex(16)  # 32 lowercase hex, stable per client
        self._access_token = ""

    def _sign(self, body: str, url_path: str, trace: str) -> str:
        return _md5(
            self._access_token
            + ""  # sign (CUSUT), empty when anonymous
            + ""  # idToken (CUSIT)
            + ""  # userId (CUSID)
            + "wap"
            + self._device_no
            + body
            + url_path
            + "997"
            + "wap"  # CSAPPID
            + trace
        )

    def _headers(self, body: str, url_path: str) -> dict[str, str]:
        trace = secrets.token_hex(16) + str(int(time.time() * 1000))
        return {
            "Content-Type": "application/json",
            "CUSAT": self._access_token or "nil",
            "CUSUT": "nil",
            "CUSIT": "nil",
            "CUSID": "nil",
            "CUSNAME": "nil",
            "CTERMINAL": "wap",
            "CSAPPID": "wap",
            "CDEVICENO": self._device_no,
            "CUUSERREF": self._device_no,
            "CVERSION": "997",
            "CDEVICEINFO": _DEVICE_INFO,
            "CRTRACEID": trace,
            "st_flpv": "",
            "CRPSIGN": self._sign(body, url_path, trace),
        }

    async def _call(
        self, http: httpx.AsyncClient, method: str, url_path: str, body: str
    ) -> dict[str, Any]:
        headers = self._headers(body, url_path)
        if method == "GET":
            resp = await http.get(API_BASE + url_path, headers=headers)
        else:
            resp = await http.post(
                API_BASE + url_path, headers=headers, content=body.encode("utf-8")
            )
        resp.raise_for_status()
        return resp.json()

    async def _fetch_token(self, http: httpx.AsyncClient) -> None:
        data = await self._call(http, "GET", "/waf/gettoken", "")
        try:
            self._access_token = data["result"]["accessToken"]["access_token"]
        except (KeyError, TypeError) as exc:
            raise RuntimeError(
                f"showstart gettoken failed: state={data.get('state')} msg={data.get('msg')}"
            ) from exc

    async def _request(self, method: str, url_path: str, body: str = "") -> dict[str, Any]:
        owns = self._http is None
        http = self._http or httpx.AsyncClient(timeout=20)
        try:
            if not self._access_token:
                await self._fetch_token(http)
            data = await self._call(http, method, url_path, body)
            if str(data.get("state", "")).lower() in _TOKEN_ERROR_STATES:
                await self._fetch_token(http)  # same deviceNo, new token
                data = await self._call(http, method, url_path, body)
            return data
        finally:
            if owns:
                await http.aclose()

    async def fetch_city_shows_raw(self, city_code: str, page: int) -> dict[str, Any]:
        body = _json_body(
            {
                "activityType": 0,
                "pageNo": page,
                "isHome": 1,
                "saleSituation": "",
                "startTime": "",
                "endTime": "",
                "showStyle": "",
                "sortType": "",
                "service": "",
                "price": "",
                "cityType": 0,
                "cityId": int(city_code),
                "st_flpv": "",
                "sign": "",
                "trackPath": "",
            }
        )
        return await self._request("POST", "/app/activity/search", body)

    async def fetch_show_detail_raw(self, show_id: str) -> dict[str, Any]:
        body = _json_body(
            {"activityId": int(show_id), "st_flpv": "", "sign": "", "trackPath": ""}
        )
        return await self._request("POST", "/wap/activity/details", body)


# A single shared client reuses one deviceNo + guest token across requests.
_shared_client: ShowstartClient | None = None


def _client() -> ShowstartClient:
    global _shared_client
    if _shared_client is None:
        _shared_client = ShowstartClient()
    return _shared_client


def _list_rows(raw: dict[str, Any]) -> list[dict[str, Any]]:
    result = raw.get("result") or {}
    return result.get("activityInfo") or []


def transform_show_list(raw: dict[str, Any], city_code: str) -> CityShowsOut:
    shows: list[ShowSummaryOut] = []
    for row in _list_rows(raw):
        activity_id = str(row.get("activityId") or "")
        if not activity_id:
            continue
        shows.append(
            ShowSummaryOut(
                showstart_id=activity_id,
                title=row.get("title") or "",
                city_code=str(row.get("cityId") or city_code),
                show_time=_normalize_time(row.get("showTime")),
                url=DETAIL_URL.format(id=activity_id),
            )
        )
    return CityShowsOut(shows=shows)


async def get_city_shows(city_code: str, page: int) -> CityShowsOut:
    try:
        raw = await _client().fetch_city_shows_raw(city_code, page)
    except Exception as exc:  # noqa: BLE001 - upstream/network raises many types
        raise HTTPException(status_code=502, detail=f"showstart list failed: {exc}") from exc
    return transform_show_list(raw, city_code)


def _detail_venue(result: dict[str, Any]) -> str | None:
    site = result.get("site")
    if isinstance(site, dict):
        return site.get("siteName") or site.get("name")
    if isinstance(site, str):
        return site or None
    return result.get("siteName")


def _detail_performers(result: dict[str, Any]) -> list[str]:
    # Performers are sessionUserInfos[].userInfos[] with activityRoleType == 2.
    # host[] (activityRoleType 5) is the organizer and is excluded.
    names: list[str] = []
    seen: set[str] = set()
    for session in result.get("sessionUserInfos") or []:
        for user in session.get("userInfos") or []:
            if user.get("activityRoleType") == 2:
                name = user.get("name")
                if name and name not in seen:
                    seen.add(name)
                    names.append(name)
    return names


def transform_show_detail(raw: dict[str, Any]) -> ShowDetailOut:
    result = raw.get("result") or {}
    activity_id = str(result.get("activityId") or "")
    price = result.get("price")
    return ShowDetailOut(
        showstart_id=activity_id,
        title=result.get("title") or result.get("activityName") or "",
        city_code=str(result.get("cityId") or ""),
        venue=_detail_venue(result),
        show_time=_normalize_time(result.get("showTime")),
        price=str(price) if price not in (None, "") else None,
        url=DETAIL_URL.format(id=activity_id),
        performers=_detail_performers(result),
    )


async def get_show_detail(show_id: str) -> ShowDetailOut:
    try:
        raw = await _client().fetch_show_detail_raw(show_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"showstart detail failed: {exc}") from exc
    return transform_show_detail(raw)
