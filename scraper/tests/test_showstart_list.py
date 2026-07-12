import json
from pathlib import Path

from fastapi.testclient import TestClient

import app.showstart as showstart
from app.main import app
from app.showstart import transform_show_list

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "showstart_list_raw.json").read_text("utf-8")
)


def test_transform_maps_summary_fields():
    out = transform_show_list(FIXTURE, city_code="310000")
    assert len(out.shows) == 2
    first = out.shows[0]
    assert first.showstart_id == "100001"
    assert first.title == "万能青年旅店 2026 巡演 上海站"
    assert first.city_code == "310000"
    assert first.show_time == "2026-08-01T20:00:00"
    assert first.url == "https://wap.showstart.com/pages/activity/detail/detail?activityId=100001"


def test_endpoint_returns_camelcase(monkeypatch):
    async def fake_list(self, city_code: str, page: int) -> dict:
        return FIXTURE

    monkeypatch.setattr(showstart.ShowstartClient, "fetch_city_shows_raw", fake_list)
    client = TestClient(app)
    resp = client.get("/showstart/cities/310000/shows?page=1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["shows"][0]["showstartId"] == "100001"
    assert body["shows"][0]["cityCode"] == "310000"
