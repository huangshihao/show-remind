from fastapi import FastAPI

from app.models import CityShowsOut, PlaylistOut, ShowDetailOut
from app.qq import get_qq_playlist
from app.showstart import get_city_shows, get_show_detail

app = FastAPI(title="show-remind-scraper")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/qq/playlist/{playlist_id}", response_model=PlaylistOut)
async def qq_playlist(playlist_id: str) -> PlaylistOut:
    return await get_qq_playlist(playlist_id)


@app.get("/showstart/cities/{city_code}/shows", response_model=CityShowsOut)
async def showstart_city_shows(city_code: str, page: int = 1) -> CityShowsOut:
    return await get_city_shows(city_code, page)


@app.get("/showstart/shows/{show_id}", response_model=ShowDetailOut)
async def showstart_show_detail(show_id: str) -> ShowDetailOut:
    return await get_show_detail(show_id)
