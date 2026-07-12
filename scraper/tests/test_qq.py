import json
from pathlib import Path

from fastapi.testclient import TestClient

import app.qq as qq
from app.main import app
from app.qq import transform_qq_playlist

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "qq_playlist_raw.json").read_text("utf-8"))


def test_transform_reads_title_and_songs():
    out = transform_qq_playlist(FIXTURE)
    assert out.title == "我的摇滚歌单"
    assert len(out.songs) == 3
    assert out.songs[0].name == "杀死那个石家庄人"
    assert out.songs[0].artists == ["万能青年旅店"]


def test_transform_keeps_multiple_singers_as_array():
    out = transform_qq_playlist(FIXTURE)
    assert out.songs[2].artists == ["万能青年旅店", "客座嘉宾"]


def test_endpoint_returns_camelcase(monkeypatch):
    async def fake_fetch(playlist_id: str) -> dict:
        return FIXTURE

    monkeypatch.setattr(qq, "fetch_qq_playlist_raw", fake_fetch)
    client = TestClient(app)
    resp = client.get("/qq/playlist/123456")
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "我的摇滚歌单"
    assert body["songs"][0]["artists"] == ["万能青年旅店"]
