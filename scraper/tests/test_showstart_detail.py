import json
from pathlib import Path

from fastapi.testclient import TestClient

import app.showstart as showstart
from app.main import app
from app.showstart import transform_show_detail

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "showstart_detail_raw.json").read_text("utf-8")
)


def test_transform_detail_fields():
    out = transform_show_detail(FIXTURE)
    assert out.showstart_id == "299995"
    assert out.title == "尹毓恪「春日海啸」2026巡演 北京站"
    assert out.city_code == "10"
    assert out.venue == "菇的LIVE·蘑菇洞"
    assert out.show_time == "2026-07-12T20:00:00"
    assert out.price == "¥150起"
    assert out.url == "https://wap.showstart.com/pages/activity/detail/detail?activityId=299995"
    # host "WhyU传媒" (activityRoleType 5) is the organizer and is excluded;
    # performers come from sessionUserInfos[].userInfos[] with activityRoleType == 2.
    assert out.performers == ["尹毓恪", "特邀嘉宾"]


def test_endpoint_returns_camelcase(monkeypatch):
    async def fake_detail(self, show_id: str) -> dict:
        return FIXTURE

    monkeypatch.setattr(showstart.ShowstartClient, "fetch_show_detail_raw", fake_detail)
    client = TestClient(app)
    resp = client.get("/showstart/shows/299995")
    assert resp.status_code == 200
    body = resp.json()
    assert body["showstartId"] == "299995"
    assert body["performers"] == ["尹毓恪", "特邀嘉宾"]
    assert body["venue"] == "菇的LIVE·蘑菇洞"
