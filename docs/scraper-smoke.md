# Scraper live smoke

Fixtures cover parsing only. These calls confirm the live upstream integrations.
Run against a running scraper (`docker compose up scraper` or `uv run uvicorn ...`).

## QQ playlist (use a real public QQ Music playlist id)
    curl -s "localhost:8001/qq/playlist/<PUBLIC_QQ_PLAYLIST_ID>" | jq '.title, (.songs | length)'
Expect a non-empty title and songs > 0. If the qqmusic-api-python call signature
differs from `songlist.get_detail(int(id))`, adjust `fetch_qq_playlist_raw` in
`app/qq.py` to match the installed version, keeping the return a dict shaped like
`tests/fixtures/qq_playlist_raw.json`.

## Showstart city list (310000 = Shanghai)
    curl -s "localhost:8001/showstart/cities/310000/shows?page=1" | jq '.shows | length'
Expect shows > 0. A 502 or empty list means the sign algorithm or endpoint path
changed — update `SIGN_SALT` / paths in `app/showstart.py`, re-record fixtures
if the response shape moved, and re-run `pytest`.

## Showstart detail
    curl -s "localhost:8001/showstart/shows/<activityId from the list>" | jq '.performers'
Expect a non-empty performers array.
