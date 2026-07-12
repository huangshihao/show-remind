from fastapi import FastAPI

from app.models import PlaylistOut
from app.qq import get_qq_playlist

app = FastAPI(title="show-remind-scraper")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/qq/playlist/{playlist_id}", response_model=PlaylistOut)
async def qq_playlist(playlist_id: str) -> PlaylistOut:
    return await get_qq_playlist(playlist_id)
