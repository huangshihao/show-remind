# Live source smoke

Fixtures (`lib/sources/*.test.ts`, `lib/adapters/**/*.test.ts`) cover parsing only, against
recorded responses. `scripts/smoke.ts` is the live counterpart: it calls the three real
upstream APIs directly and confirms they still return usable data. This is how you find out
fast when a fixture test still passes but the real API has moved.

Run it locally:

    npx tsx scripts/smoke.ts

It checks:

- **NetEase** — resolves a public plaintext playlist (`resolveNeteasePlaylist` in
  `lib/adapters/netease`) and expects a non-empty song list.
- **QQ Music** — fetches a public playlist (`fetchQqPlaylist` in `lib/sources/qq`) and expects
  a non-empty song list. Override the playlist id with `SMOKE_QQ_PLAYLIST` if the default one
  disappears.
- **Showstart** — fetches the Shanghai city show list (`fetchCityShows` in
  `lib/sources/showstart`) and then the detail of the first show (`fetchShowDetail`), expecting
  at least one show and a non-empty performers array.

Each check prints a `✓ <name>: ...` line on success or a `✗ <name>: <error>` line on failure.
The script exits non-zero if any of the three checks fails.

A GitHub Actions workflow (`.github/workflows/smoke.yml`) runs this daily and on
`workflow_dispatch`. On failure it opens (or comments on an existing) `smoke-failure`-labelled
issue so a broken upstream integration gets noticed without anyone needing to watch the badge
in `README.md`.

If a check fails, start by reading `docs/showstart-reverse-engineering.md` (for Showstart) or
the relevant client in `lib/sources/` / `lib/adapters/`, update the code to match the upstream's
current behavior, and refresh the fixture(s) it broke.
