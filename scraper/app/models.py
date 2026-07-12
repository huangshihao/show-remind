from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class SongOut(CamelModel):
    name: str
    artists: list[str]


class PlaylistOut(CamelModel):
    title: str
    songs: list[SongOut]


class ShowSummaryOut(CamelModel):
    showstart_id: str
    title: str
    city_code: str
    show_time: str | None = None
    url: str


class CityShowsOut(CamelModel):
    shows: list[ShowSummaryOut]


class ShowDetailOut(CamelModel):
    showstart_id: str
    title: str
    city_code: str
    venue: str | None = None
    show_time: str | None = None
    price: str | None = None
    url: str
    performers: list[str]
