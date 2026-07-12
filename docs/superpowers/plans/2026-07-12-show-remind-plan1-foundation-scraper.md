# Show-Remind Plan 1: Foundation & Python Scraper Service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the repository, database schema, and a standalone Python scraper service that returns QQ Music playlists and Showstart show lists/details as clean JSON.

**Architecture:** Single repo. A Next.js app (scaffolded here, fleshed out in Plans 2–3) plus a separate `scraper/` Python FastAPI service. Postgres and MailHog run via docker-compose. This plan delivers two frozen contracts every later plan depends on: the **Prisma schema** and the **scraper HTTP API** (camelCase JSON).

**Tech Stack:** Next.js 15 (App Router, TypeScript), Prisma + PostgreSQL 16, Vitest; Python 3.12 + FastAPI + httpx + pydantic v2 + pytest; qqmusic-api-python; docker-compose.

## Plan Decomposition (context)

This spec is delivered as three sequenced plans. Each is independently testable.

- **Plan 1 (this doc): Foundation & Python Scraper Service.** Repo, tooling, docker-compose, full Prisma schema + migration, and the Python scraper (QQ playlist + Showstart list/detail). Testable via `pytest` + `curl` + a migrated DB — no UI needed.
- **Plan 2: Node lib/ engine.** `scraper-client` (zod), playlist link parser, netease adapter (weapi vendor), qq adapter, and the `matcher` pure functions. Testable via `vitest` + a smoke script.
- **Plan 3: Persistence, worker pipeline & web app.** DB repositories, `crawler/showstart`, `notifier` (nodemailer), `worker.ts` (node-cron), Auth.js, and pages (paste playlist → select artists → cities → my shows). Delivers the full product.

## Global Constraints

- Node package manager: **pnpm**. Python package/venv manager: **uv** (fallback: `python -m venv` + pip).
- Node **20+**, Python **3.12**.
- Scraper HTTP JSON is **camelCase** on the wire. Node consumers validate every response with zod (Plan 2).
- Table names in Postgres are snake_case (via Prisma `@@map`); Prisma model fields are camelCase.
- The scraper is **stateless**: no DB access, no business logic, no scheduled jobs. It only fetches + transforms.
- Fragile network/signature code is isolated behind a client class; **transform functions are pure and fully unit-tested against recorded fixtures** — tests never hit the live network.
- Platform string values are exactly `"netease"` and `"qq"`. `matched_by` values are exactly `"performer"` and `"title"`.
- All commits use Conventional Commits (`feat:`, `chore:`, `test:`, etc.).

---

## Frozen Contract: Scraper HTTP API

Later plans code against exactly these shapes. Do not rename fields.

```
GET /health
  → 200 { "status": "ok" }

GET /qq/playlist/{id}
  → 200 { "title": string, "songs": [ { "name": string, "artists": string[] } ] }

GET /showstart/cities/{cityCode}/shows?page={n}
  → 200 { "shows": [ { "showstartId": string, "title": string,
                       "cityCode": string, "showTime": string|null, "url": string } ] }

GET /showstart/shows/{id}
  → 200 { "showstartId": string, "title": string, "cityCode": string,
          "venue": string|null, "showTime": string|null, "price": string|null,
          "url": string, "performers": string[] }

Errors: 502 { "detail": "<reason>" } when the upstream fetch/parse fails.
```

`showTime` is an ISO-8601 string (or null if the source gives none). All string IDs.

---

## Task 1: Repo scaffolding & tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `.nvmrc`
- Create: `docker-compose.yml`
- Create: `app/page.tsx`, `app/layout.tsx`, `next.config.ts`
- Test: `lib/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: a runnable Next.js app, `pnpm test` running Vitest, and `docker compose up postgres mailhog` bringing up Postgres (`localhost:5432`) and MailHog (SMTP `1025`, UI `8025`).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "show-remind",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:migrate": "prisma migrate dev",
    "prisma:generate": "prisma generate"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@prisma/client": "^6.2.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "prisma": "^6.2.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create supporting config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "scraper"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "lib/**/__tests__/**/*.test.ts"],
  },
});
```

`next.config.ts`:
```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {};
export default nextConfig;
```

`.nvmrc`:
```
20
```

`.gitignore`:
```
node_modules/
.next/
.env
.env.local
*.log
scraper/.venv/
scraper/__pycache__/
scraper/**/__pycache__/
.pytest_cache/
```

`.env.example`:
```
DATABASE_URL="postgresql://showremind:showremind@localhost:5432/showremind?schema=public"
SCRAPER_BASE_URL="http://localhost:8001"
SMTP_HOST="localhost"
SMTP_PORT="1025"
SMTP_FROM="Show-Remind <no-reply@show-remind.local>"
ADMIN_ALERT_EMAIL="admin@show-remind.local"
```

- [ ] **Step 3: Create the minimal Next.js app**

`app/layout.tsx`:
```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
```

`app/page.tsx`:
```tsx
export default function Home() {
  return <main>Show-Remind</main>;
}
```

- [ ] **Step 4: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: showremind
      POSTGRES_PASSWORD: showremind
      POSTGRES_DB: showremind
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U showremind"]
      interval: 5s
      timeout: 3s
      retries: 5

  mailhog:
    image: mailhog/mailhog
    ports:
      - "1025:1025"
      - "8025:8025"

volumes:
  pgdata:
```

- [ ] **Step 5: Write the smoke test**

`lib/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("toolchain smoke", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Install deps and verify the toolchain**

Run:
```bash
pnpm install
cp .env.example .env
pnpm test
docker compose up -d postgres mailhog
```
Expected: `pnpm test` prints `1 passed`; `docker compose ps` shows `postgres` healthy and `mailhog` running.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app, tooling, and docker-compose"
```

---

## Task 2: Prisma schema & initial migration

**Files:**
- Create: `prisma/schema.prisma`
- Create: `lib/db.ts`
- Test: `lib/__tests__/db.test.ts`

**Interfaces:**
- Produces: `prisma` client via `import { prisma } from "@/lib/db"`, and all tables from spec §4 (`users`, `user_cities`, `playlists`, `artists`, `user_artists`, `shows`, `show_artists`, `notifications`). Plans 2–3 consume these models. Field names and enum-like string values below are frozen.

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String    @map("password_hash")
  emailVerified DateTime? @map("email_verified")
  createdAt     DateTime  @default(now()) @map("created_at")
  cities        UserCity[]
  playlists     Playlist[]
  artists       UserArtist[]
  notifications Notification[]
  @@map("users")
}

model UserCity {
  id       String @id @default(cuid())
  userId   String @map("user_id")
  cityCode String @map("city_code")
  user     User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, cityCode])
  @@map("user_cities")
}

model Playlist {
  id            String    @id @default(cuid())
  userId        String    @map("user_id")
  platform      String
  externalId    String    @map("external_id")
  title         String?
  status        String    @default("pending") // pending | resolving | ready | failed
  failureReason String?   @map("failure_reason")
  lastSyncedAt  DateTime? @map("last_synced_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userArtists   UserArtist[]
  @@unique([userId, platform, externalId])
  @@map("playlists")
}

model Artist {
  id             String   @id @default(cuid())
  name           String
  normalizedName String   @unique @map("normalized_name")
  aliases        Json     @default("[]")
  createdAt      DateTime @default(now()) @map("created_at")
  userArtists    UserArtist[]
  showArtists    ShowArtist[]
  @@map("artists")
}

model UserArtist {
  id               String    @id @default(cuid())
  userId           String    @map("user_id")
  artistId         String    @map("artist_id")
  sourcePlaylistId String?   @map("source_playlist_id")
  status           String    @default("followed") // followed | ignored
  createdAt        DateTime  @default(now()) @map("created_at")
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  artist           Artist    @relation(fields: [artistId], references: [id], onDelete: Cascade)
  sourcePlaylist   Playlist? @relation(fields: [sourcePlaylistId], references: [id], onDelete: SetNull)
  @@unique([userId, artistId])
  @@map("user_artists")
}

model Show {
  id            String    @id @default(cuid())
  showstartId   String    @unique @map("showstart_id")
  title         String
  cityCode      String    @map("city_code")
  venue         String?
  showTime      DateTime? @map("show_time")
  price         String?
  url           String
  performers    Json      @default("[]")
  firstSeenAt   DateTime  @default(now()) @map("first_seen_at")
  showArtists   ShowArtist[]
  notifications Notification[]
  @@index([cityCode])
  @@map("shows")
}

model ShowArtist {
  id        String @id @default(cuid())
  showId    String @map("show_id")
  artistId  String @map("artist_id")
  matchedBy String @map("matched_by") // performer | title
  show      Show   @relation(fields: [showId], references: [id], onDelete: Cascade)
  artist    Artist @relation(fields: [artistId], references: [id], onDelete: Cascade)
  @@unique([showId, artistId])
  @@map("show_artists")
}

model Notification {
  id        String    @id @default(cuid())
  userId    String    @map("user_id")
  showId    String    @map("show_id")
  status    String    @default("pending") // pending | sent | failed
  sentAt    DateTime? @map("sent_at")
  createdAt DateTime  @default(now()) @map("created_at")
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  show      Show      @relation(fields: [showId], references: [id], onDelete: Cascade)
  @@unique([userId, showId])
  @@map("notifications")
}
```

- [ ] **Step 2: Write `lib/db.ts` (singleton Prisma client)**

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 3: Run the migration (this also generates the client)**

Run (Postgres must be up from Task 1):
```bash
pnpm prisma migrate dev --name init
```
Expected: creates `prisma/migrations/*_init/migration.sql`, applies it, and prints "Your database is now in sync with your schema." Also generates the client.

- [ ] **Step 4: Write a DB round-trip test**

`lib/__tests__/db.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

describe("prisma schema", () => {
  const email = `t_${Date.now()}@example.com`;

  it("creates and reads a user with a followed city", async () => {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: "x",
        cities: { create: { cityCode: "310000" } },
      },
      include: { cities: true },
    });
    expect(user.cities).toHaveLength(1);
    expect(user.cities[0].cityCode).toBe("310000");
  });

  it("enforces the (userId, showId) unique on notifications", async () => {
    const u = await prisma.user.create({ data: { email: `n_${Date.now()}@e.com`, passwordHash: "x" } });
    const s = await prisma.show.create({
      data: { showstartId: `s_${Date.now()}`, title: "T", cityCode: "310000", url: "http://x" },
    });
    await prisma.notification.create({ data: { userId: u.id, showId: s.id } });
    await expect(
      prisma.notification.create({ data: { userId: u.id, showId: s.id } }),
    ).rejects.toThrow();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 5: Run the test**

Run: `pnpm test lib/__tests__/db.test.ts`
Expected: PASS (2 tests). Requires `DATABASE_URL` in `.env` and Postgres running.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema, migration, and db client"
```

---

## Task 3: Scraper service skeleton

**Files:**
- Create: `scraper/pyproject.toml`
- Create: `scraper/app/__init__.py`, `scraper/app/main.py`
- Create: `scraper/tests/__init__.py`, `scraper/tests/test_health.py`
- Create: `scraper/README.md`

**Interfaces:**
- Produces: FastAPI app object `app.main:app` with `GET /health → {"status":"ok"}`, served by uvicorn on port 8001. `pytest` runnable from `scraper/`.

- [ ] **Step 1: Create `scraper/pyproject.toml`**

```toml
[project]
name = "show-remind-scraper"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "httpx>=0.27",
    "pydantic>=2.9",
    "qqmusic-api-python>=0.2",
]

[dependency-groups]
dev = [
    "pytest>=8.3",
]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

- [ ] **Step 2: Create the app skeleton**

`scraper/app/__init__.py`: (empty file)

`scraper/app/main.py`:
```python
from fastapi import FastAPI

app = FastAPI(title="show-remind-scraper")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 3: Write the health test**

`scraper/tests/__init__.py`: (empty file)

`scraper/tests/test_health.py`:
```python
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

- [ ] **Step 4: Create the env and run the test**

Run:
```bash
cd scraper && uv venv && uv sync --dev && uv run pytest -v
```
(Fallback without uv: `python3.12 -m venv .venv && . .venv/bin/activate && pip install -e . pytest && pytest -v`.)
Expected: `test_health` PASS.

- [ ] **Step 5: Write `scraper/README.md`**

```markdown
# show-remind-scraper

Stateless fetch/transform service for QQ Music playlists and Showstart shows.
No DB, no business logic, no scheduling. camelCase JSON out.

## Run
    uv sync --dev
    uv run uvicorn app.main:app --port 8001 --reload

## Test
    uv run pytest -v
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(scraper): FastAPI skeleton with health endpoint"
```

---

## Task 4: Scraper response contract models

**Files:**
- Create: `scraper/app/models.py`
- Test: `scraper/tests/test_models.py`

**Interfaces:**
- Produces: pydantic models `SongOut`, `PlaylistOut`, `ShowSummaryOut`, `CityShowsOut`, `ShowDetailOut`. All serialize with camelCase keys. Endpoints in Tasks 5–7 return these; Plan 2's zod schemas mirror them.

- [ ] **Step 1: Write the failing test**

`scraper/tests/test_models.py`:
```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd scraper && uv run pytest tests/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models'`.

- [ ] **Step 3: Write `scraper/app/models.py`**

```python
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd scraper && uv run pytest tests/test_models.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Ensure endpoints serialize by alias (app config)**

Modify `scraper/app/main.py` to default all responses to alias serialization by adding a custom default. Replace the file with:
```python
from fastapi import FastAPI
from fastapi.responses import ORJSONResponse

app = FastAPI(title="show-remind-scraper")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```
Note: endpoints in Tasks 5–7 declare `response_model=...` and FastAPI serializes by alias by default (`response_model_by_alias=True`), so camelCase keys are emitted automatically. No global change needed beyond keeping models as defined. (`ORJSONResponse` import is optional; leave the file as the skeleton if you prefer — this step is a no-op confirmation.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(scraper): camelCase response contract models"
```

---

## Task 5: QQ Music playlist endpoint

**Files:**
- Create: `scraper/app/qq.py`
- Create: `scraper/tests/fixtures/qq_playlist_raw.json`
- Test: `scraper/tests/test_qq.py`
- Modify: `scraper/app/main.py`

**Interfaces:**
- Consumes: `PlaylistOut`, `SongOut` from Task 4.
- Produces: `transform_qq_playlist(raw: dict) -> PlaylistOut` (pure) and `GET /qq/playlist/{id}`. Async network fetch lives in `fetch_qq_playlist_raw(playlist_id: str) -> dict`, mockable in tests.

- [ ] **Step 1: Record a fixture from a real QQ playlist response**

Create `scraper/tests/fixtures/qq_playlist_raw.json` capturing the shape qqmusic-api-python returns for a songlist. Use this representative structure (trim to the fields we read):
```json
{
  "dirinfo": { "title": "我的摇滚歌单" },
  "songlist": [
    { "name": "杀死那个石家庄人", "singer": [{ "name": "万能青年旅店" }] },
    { "name": "大石碎胸口", "singer": [{ "name": "万能青年旅店" }] },
    { "name": "河北墨麒麟", "singer": [{ "name": "万能青年旅店" }, { "name": "客座嘉宾" }] }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`scraper/tests/test_qq.py`:
```python
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd scraper && uv run pytest tests/test_qq.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.qq'`.

- [ ] **Step 4: Write `scraper/app/qq.py`**

```python
from typing import Any

from fastapi import HTTPException

from app.models import PlaylistOut, SongOut


def _extract_title(raw: dict[str, Any]) -> str:
    dirinfo = raw.get("dirinfo") or {}
    return dirinfo.get("title") or raw.get("dissname") or raw.get("title") or ""


def _extract_song_name(song: dict[str, Any]) -> str:
    return song.get("name") or song.get("songname") or song.get("title") or ""


def _extract_artists(song: dict[str, Any]) -> list[str]:
    singers = song.get("singer") or song.get("singers") or []
    names = [s.get("name") for s in singers if isinstance(s, dict) and s.get("name")]
    return names


def transform_qq_playlist(raw: dict[str, Any]) -> PlaylistOut:
    songs = [
        SongOut(name=_extract_song_name(s), artists=_extract_artists(s))
        for s in (raw.get("songlist") or [])
    ]
    return PlaylistOut(title=_extract_title(raw), songs=songs)


async def fetch_qq_playlist_raw(playlist_id: str) -> dict[str, Any]:
    """Fetch a public QQ Music songlist via qqmusic-api-python.

    Isolated so tests can monkeypatch it. The exact call is confirmed against the
    installed qqmusic-api-python version during the manual smoke (Task 8).
    """
    from qqmusic_api import songlist  # type: ignore

    detail = await songlist.get_detail(int(playlist_id))
    return detail if isinstance(detail, dict) else dict(detail)


async def get_qq_playlist(playlist_id: str) -> PlaylistOut:
    try:
        raw = await fetch_qq_playlist_raw(playlist_id)
    except Exception as exc:  # noqa: BLE001 - upstream lib raises many types
        raise HTTPException(status_code=502, detail=f"qq fetch failed: {exc}") from exc
    return transform_qq_playlist(raw)
```

- [ ] **Step 5: Wire the route in `scraper/app/main.py`**

Replace `scraper/app/main.py` with:
```python
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd scraper && uv run pytest tests/test_qq.py -v`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(scraper): QQ Music playlist endpoint with fixture tests"
```

---

## Task 6: Showstart city-shows list endpoint

**Files:**
- Create: `scraper/app/showstart.py`
- Create: `scraper/tests/fixtures/showstart_list_raw.json`
- Test: `scraper/tests/test_showstart_list.py`
- Modify: `scraper/app/main.py`

**Interfaces:**
- Consumes: `ShowSummaryOut`, `CityShowsOut` from Task 4.
- Produces: `ShowstartClient` (network + signature, isolated), `transform_show_list(raw: dict, city_code: str) -> CityShowsOut` (pure), and `GET /showstart/cities/{cityCode}/shows?page={n}`.

- [ ] **Step 1: Record a list fixture**

Create `scraper/tests/fixtures/showstart_list_raw.json` (representative wap list-page shape; trim to fields read):
```json
{
  "state": 1,
  "data": {
    "result": [
      { "activityId": 100001, "title": "万能青年旅店 2026 巡演 上海站", "cityCode": "310000", "showTime": "2026-08-01 20:00:00" },
      { "activityId": 100002, "title": "重塑雕像的权利 上海", "cityCode": "310000", "showTime": "2026-08-15 20:30:00" }
    ]
  }
}
```

- [ ] **Step 2: Write the failing test**

`scraper/tests/test_showstart_list.py`:
```python
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd scraper && uv run pytest tests/test_showstart_list.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.showstart'`.

- [ ] **Step 4: Write `scraper/app/showstart.py`**

```python
import hashlib
from typing import Any

import httpx
from fastapi import HTTPException

from app.models import CityShowsOut, ShowSummaryOut

WAP_BASE = "https://wap.showstart.com"
DETAIL_URL = WAP_BASE + "/pages/activity/detail/detail?activityId={id}"
# Salt is the known wap signing secret; update here if the upstream algorithm changes.
SIGN_SALT = "&d1zNAX3tE5vd1ukliozxfCB2AI="


def _normalize_time(raw_time: str | None) -> str | None:
    if not raw_time:
        return None
    return raw_time.strip().replace(" ", "T")


def _sign(params: dict[str, Any]) -> str:
    ordered = "".join(f"{k}={params[k]}" for k in sorted(params))
    return hashlib.md5((ordered + SIGN_SALT).encode("utf-8")).hexdigest()


class ShowstartClient:
    """Isolated network + signature layer. Transform functions do not depend on it,
    so parsing is testable offline; the live path is exercised in the manual smoke."""

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client

    async def _request(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        params = {**params, "sign": _sign(params)}
        owns = self._client is None
        client = self._client or httpx.AsyncClient(timeout=15)
        try:
            resp = await client.get(WAP_BASE + path, params=params)
            resp.raise_for_status()
            return resp.json()
        finally:
            if owns:
                await client.aclose()

    async def fetch_city_shows_raw(self, city_code: str, page: int) -> dict[str, Any]:
        return await self._request(
            "/api/activity/list", {"cityCode": city_code, "pageNo": page, "pageSize": 20}
        )

    async def fetch_show_detail_raw(self, show_id: str) -> dict[str, Any]:
        return await self._request("/api/activity/detail", {"activityId": show_id})


def _rows(raw: dict[str, Any]) -> list[dict[str, Any]]:
    data = raw.get("data") or {}
    return data.get("result") or data.get("list") or []


def transform_show_list(raw: dict[str, Any], city_code: str) -> CityShowsOut:
    shows: list[ShowSummaryOut] = []
    for row in _rows(raw):
        activity_id = str(row.get("activityId") or row.get("id") or "")
        if not activity_id:
            continue
        shows.append(
            ShowSummaryOut(
                showstart_id=activity_id,
                title=row.get("title") or "",
                city_code=str(row.get("cityCode") or city_code),
                show_time=_normalize_time(row.get("showTime")),
                url=DETAIL_URL.format(id=activity_id),
            )
        )
    return CityShowsOut(shows=shows)


async def get_city_shows(city_code: str, page: int) -> CityShowsOut:
    client = ShowstartClient()
    try:
        raw = await client.fetch_city_shows_raw(city_code, page)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"showstart list failed: {exc}") from exc
    return transform_show_list(raw, city_code)
```

- [ ] **Step 5: Wire the route in `scraper/app/main.py`**

Add to `scraper/app/main.py` (imports and route):
```python
from app.models import CityShowsOut, PlaylistOut
from app.showstart import get_city_shows
```
```python
@app.get("/showstart/cities/{city_code}/shows", response_model=CityShowsOut)
async def showstart_city_shows(city_code: str, page: int = 1) -> CityShowsOut:
    return await get_city_shows(city_code, page)
```
Resulting full `scraper/app/main.py`:
```python
from fastapi import FastAPI

from app.models import CityShowsOut, PlaylistOut
from app.qq import get_qq_playlist
from app.showstart import get_city_shows

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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd scraper && uv run pytest tests/test_showstart_list.py -v`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(scraper): Showstart city-shows list endpoint with fixture tests"
```

---

## Task 7: Showstart show-detail endpoint

**Files:**
- Create: `scraper/tests/fixtures/showstart_detail_raw.json`
- Test: `scraper/tests/test_showstart_detail.py`
- Modify: `scraper/app/showstart.py`, `scraper/app/main.py`

**Interfaces:**
- Consumes: `ShowDetailOut` from Task 4; `ShowstartClient` from Task 6.
- Produces: `transform_show_detail(raw: dict) -> ShowDetailOut` (pure) and `GET /showstart/shows/{id}`. `performers` is extracted from the detail payload's artist list.

- [ ] **Step 1: Record a detail fixture**

Create `scraper/tests/fixtures/showstart_detail_raw.json`:
```json
{
  "state": 1,
  "data": {
    "activityId": 100001,
    "title": "万能青年旅店 2026 巡演 上海站",
    "cityCode": "310000",
    "siteName": "MAO Livehouse (上海)",
    "showTime": "2026-08-01 20:00:00",
    "price": "180-380",
    "performers": [
      { "name": "万能青年旅店" },
      { "name": "特邀嘉宾" }
    ]
  }
}
```

- [ ] **Step 2: Write the failing test**

`scraper/tests/test_showstart_detail.py`:
```python
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd scraper && uv run pytest tests/test_showstart_detail.py -v`
Expected: FAIL with `ImportError: cannot import name 'transform_show_detail'`.

- [ ] **Step 4: Add transform + accessor to `scraper/app/showstart.py`**

Append to `scraper/app/showstart.py`:
```python
from app.models import ShowDetailOut


def _detail_body(raw: dict[str, Any]) -> dict[str, Any]:
    return raw.get("data") or raw


def _performers(body: dict[str, Any]) -> list[str]:
    performers = body.get("performers") or body.get("artists") or []
    return [p.get("name") for p in performers if isinstance(p, dict) and p.get("name")]


def transform_show_detail(raw: dict[str, Any]) -> ShowDetailOut:
    body = _detail_body(raw)
    activity_id = str(body.get("activityId") or body.get("id") or "")
    return ShowDetailOut(
        showstart_id=activity_id,
        title=body.get("title") or "",
        city_code=str(body.get("cityCode") or ""),
        venue=body.get("siteName") or body.get("venue"),
        show_time=_normalize_time(body.get("showTime")),
        price=body.get("price"),
        url=DETAIL_URL.format(id=activity_id),
        performers=_performers(body),
    )


async def get_show_detail(show_id: str) -> ShowDetailOut:
    client = ShowstartClient()
    try:
        raw = await client.fetch_show_detail_raw(show_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"showstart detail failed: {exc}") from exc
    return transform_show_detail(raw)
```

- [ ] **Step 5: Wire the route in `scraper/app/main.py`**

Add import and route:
```python
from app.models import CityShowsOut, PlaylistOut, ShowDetailOut
from app.showstart import get_city_shows, get_show_detail
```
```python
@app.get("/showstart/shows/{show_id}", response_model=ShowDetailOut)
async def showstart_show_detail(show_id: str) -> ShowDetailOut:
    return await get_show_detail(show_id)
```

- [ ] **Step 6: Run the full scraper test suite**

Run: `cd scraper && uv run pytest -v`
Expected: PASS — all tests across health, models, qq, showstart list, showstart detail.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(scraper): Showstart show-detail endpoint with fixture tests"
```

---

## Task 8: Dockerize the scraper, wire compose, and smoke-test the live path

**Files:**
- Create: `scraper/Dockerfile`
- Create: `scraper/.dockerignore`
- Modify: `docker-compose.yml`
- Create: `docs/scraper-smoke.md`

**Interfaces:**
- Produces: `scraper` service in docker-compose on port 8001, reachable at `SCRAPER_BASE_URL`. A documented manual smoke that confirms the two live upstream integrations (which fixtures deliberately do not cover).

- [ ] **Step 1: Write `scraper/Dockerfile`**

```dockerfile
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir "fastapi>=0.115" "uvicorn[standard]>=0.32" \
    "httpx>=0.27" "pydantic>=2.9" "qqmusic-api-python>=0.2"

COPY app ./app

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
```

- [ ] **Step 2: Write `scraper/.dockerignore`**

```
.venv/
__pycache__/
**/__pycache__/
tests/
.pytest_cache/
```

- [ ] **Step 3: Add the scraper service to `docker-compose.yml`**

Append under `services:`:
```yaml
  scraper:
    build: ./scraper
    ports:
      - "8001:8001"
    restart: unless-stopped
```

- [ ] **Step 4: Build and start the scraper**

Run:
```bash
docker compose up -d --build scraper
curl -s localhost:8001/health
```
Expected: `{"status":"ok"}`.

- [ ] **Step 5: Write `docs/scraper-smoke.md` and run the live smoke**

`docs/scraper-smoke.md`:
```markdown
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
```

Run the three `curl` commands above. Record actual output in the PR/commit notes.
If an upstream integration is broken, fix the isolated client/fetch function and
re-record the corresponding fixture, then re-run `pytest`. Parsing tests must stay green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(scraper): Dockerfile, compose wiring, and live smoke doc"
```

---

## Self-Review Notes

- **Spec coverage (Plan 1 slice):** Prisma schema covers all 8 tables in spec §4 (Task 2). Scraper covers QQ playlist (spec §5 流程①.2), Showstart city list (流程②.3) and detail (流程②.4). Netease adapter, matcher, worker, notifier, auth, and pages are explicitly deferred to Plans 2–3 (see Plan Decomposition).
- **Contract stability:** The scraper HTTP contract and Prisma field names are frozen in this plan; Plan 2's zod schemas and Plan 3's repositories must mirror them exactly.
- **Fragile code isolation:** QQ fetch (`fetch_qq_playlist_raw`) and Showstart network+sign (`ShowstartClient`) are the only untested-by-CI paths, deliberately covered by the Task 8 manual smoke; every transform is unit-tested offline.
- **Deferred assumptions to confirm during smoke:** exact qqmusic-api-python call; Showstart endpoint paths, param names, and `SIGN_SALT`. Task 8 documents exactly what to adjust and to re-record fixtures if shapes move.
