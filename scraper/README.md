# show-remind-scraper

Stateless fetch/transform service for QQ Music playlists and Showstart shows.
No DB, no business logic, no scheduling. camelCase JSON out.

## Run
    uv sync --dev
    uv run uvicorn app.main:app --port 8001 --reload

## Test
    uv run pytest -v
