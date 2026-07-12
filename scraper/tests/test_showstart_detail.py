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
    assert out.showstart_id == "100001"
    assert out.title == "万能青年旅店 2026 巡演 上海站"
    assert out.city_code == "310000"
    assert out.venue == "MAO Livehouse (上海)"
    assert out.show_time == "2026-08-01T20:00:00"
    assert out.price == "180-380"
    assert out.url == "https://wap.showstart.com/pages/activity/detail/detail?activityId=100001"
    assert out.performers == ["万能青年旅店", "特邀嘉宾"]


def test_endpoint_returns_camelcase(monkeypatch):
    async def fake_detail(self, show_id: str) -> dict:
        return FIXTURE

    monkeypatch.setattr(showstart.ShowstartClient, "fetch_show_detail_raw", fake_detail)
    client = TestClient(app)
    resp = client.get("/showstart/shows/100001")
    assert resp.status_code == 200
    body = resp.json()
    assert body["showstartId"] == "100001"
    assert body["performers"] == ["万能青年旅店", "特邀嘉宾"]
    assert body["venue"] == "MAO Livehouse (上海)"
