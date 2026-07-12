from fastapi import FastAPI

app = FastAPI(title="show-remind-scraper")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
