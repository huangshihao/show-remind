from app.models import PlaylistOut, ShowDetailOut


def test_playlist_serializes_camelcase():
    out = PlaylistOut(title="歌单", songs=[{"name": "歌", "artists": ["万能青年旅店"]}])
    dumped = out.model_dump(by_alias=True)
    assert dumped == {"title": "歌单", "songs": [{"name": "歌", "artists": ["万能青年旅店"]}]}


def test_show_detail_camelcase_keys():
    out = ShowDetailOut(
        showstart_id="123",
        title="演出",
        city_code="310000",
        venue="MAO",
        show_time="2026-08-01T20:00:00",
        price="180",
        url="http://x",
        performers=["万能青年旅店"],
    )
    dumped = out.model_dump(by_alias=True)
    assert set(dumped.keys()) == {
        "showstartId", "title", "cityCode", "venue", "showTime", "price", "url", "performers",
    }
    assert dumped["showstartId"] == "123"
    assert dumped["cityCode"] == "310000"
