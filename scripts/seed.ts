// One-off/occasional bulk seeder: crawl Showstart from THIS machine and write the
// results straight into the remote D1.
//
// Why this exists: the Worker crawl is incremental and healthy in steady state
// (a city gains a handful of shows a day), but a COLD city has ~150 shows and the
// Worker can only enrich MAX_DETAILS_PER_RUN of them per daily run — so seeding a
// fresh city from empty takes days. Running locally has none of the Workers Free
// limits (50 external subrequests, 15-min cron wall, 10ms CPU), so the whole
// country can be filled in one pass.
//
// Safe to re-run and safe to interrupt: each city is written as soon as it is
// crawled, and only shows whose showstart_id is not already in D1 are fetched, so
// a rerun resumes at the first unfinished city rather than redoing the work.
//
//   mise x node@22 -- npx vite-node scripts/seed.ts -- --dry-run
//   mise x node@22 -- npx vite-node scripts/seed.ts -- --cities=310000,420100
//   mise x node@22 -- npx vite-node scripts/seed.ts
//
// Flags:
//   --cities=a,b   only these 行政区码 (default: every city in lib/cities.ts)
//   --limit=N      at most N new shows per city (default: unlimited)
//   --dry-run      crawl + match + write the .sql, but do not touch D1
//   --db=NAME      D1 database name (default: show-remind)

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CITIES } from "../lib/cities";
import { fetchCityShows, fetchShowDetail, type ShowDetail } from "../lib/sources/showstart";
import { matchShows, type MatchArtist, type MatchShow } from "../lib/matcher";

// Local pacing. The Worker crawler sleeps ~800-1600ms between detail fetches to
// stay unobtrusive against Showstart's WAF; keep the same spirit here but allow a
// little concurrency, since ~4800 shows one-at-a-time would take over an hour.
const CONCURRENCY = 3;
const PACE_MS = () => 600 + Math.floor(Math.random() * 600);
// Generous: a local run has no page budget, but stop runaway pagination.
const MAX_PAGES = 40;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const has = (name: string) => args.includes(`--${name}`);

const DB = flag("db") ?? "show-remind";
const DRY_RUN = has("dry-run");
const LIMIT = flag("limit") ? Number(flag("limit")) : Infinity;
const ONLY = flag("cities")?.split(",").filter(Boolean);
const targets = ONLY ? CITIES.filter((c) => ONLY.includes(c.code)) : CITIES;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- D1 access via wrangler -------------------------------------------------

function wrangler(wrArgs: string[]): string {
  return execFileSync("npx", ["wrangler", ...wrArgs], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function d1Query<T>(sql: string): T[] {
  const raw = wrangler(["d1", "execute", DB, "--remote", "--json", "--command", sql]);
  // wrangler prints warnings before the JSON payload; start at the first bracket.
  const json = raw.slice(raw.indexOf("["));
  return JSON.parse(json)[0]?.results ?? [];
}

function d1ExecFile(sql: string): void {
  const file = join(mkdtempSync(join(tmpdir(), "seed-")), "seed.sql");
  writeFileSync(file, sql);
  if (DRY_RUN) {
    console.log(`   [dry-run] SQL written to ${file} (${sql.length} bytes), not applied`);
    return;
  }
  wrangler(["d1", "execute", DB, "--remote", "--file", file, "--yes"]);
}

// SQLite string literal. Doubling the quote is the only escape SQLite defines for
// single-quoted strings; everything else (newlines, emoji, CJK) is literal.
const q = (v: string | null | undefined): string =>
  v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;

// --- crawl ------------------------------------------------------------------

async function listCity(code: string, name: string): Promise<string[]> {
  const ids = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { shows } = await fetchCityShows(code, page);
    if (shows.length === 0) break;
    for (const s of shows) ids.add(s.showstartId);
    await sleep(200);
  }
  console.log(`   ${name}: ${ids.size} shows listed`);
  return [...ids];
}

// Fetch details with a small worker pool, pacing each request.
async function fetchDetails(ids: string[], label: string): Promise<ShowDetail[]> {
  const out: ShowDetail[] = [];
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (next < ids.length) {
        const id = ids[next++];
        await sleep(PACE_MS());
        try {
          out.push(await fetchShowDetail(id));
        } catch (e) {
          console.log(`   ! ${label} detail ${id} failed: ${String(e).slice(0, 80)}`);
        }
        if (++done % 25 === 0) console.log(`   ${label}: ${done}/${ids.length} details`);
      }
    }),
  );
  return out;
}

function showsSql(rows: Array<ShowDetail & { rowId: string }>): string {
  return rows
    .map(
      (s) =>
        `INSERT INTO shows (id, showstart_id, title, city_code, venue, show_time, price, url, performers, poster) ` +
        `VALUES (${q(s.rowId)}, ${q(s.showstartId)}, ${q(s.title)}, ${q(s.cityCode)}, ${q(s.venue)}, ` +
        `${q(s.showTime)}, ${q(s.price)}, ${q(s.url)}, ${q(JSON.stringify(s.performers))}, ${q(s.poster)}) ` +
        `ON CONFLICT(showstart_id) DO UPDATE SET title=excluded.title, city_code=excluded.city_code, ` +
        `venue=excluded.venue, show_time=excluded.show_time, price=excluded.price, url=excluded.url, ` +
        `performers=excluded.performers, poster=excluded.poster;`,
    )
    .join("\n");
}

// --- main -------------------------------------------------------------------

async function main() {
  console.log(`Seeding ${targets.length} cities into "${DB}"${DRY_RUN ? " (dry run)" : ""}\n`);

  console.log("1. Reading what D1 already has…");
  const known = new Set(
    d1Query<{ showstart_id: string }>("SELECT showstart_id FROM shows").map((r) => r.showstart_id),
  );
  console.log(`   ${known.size} shows already stored\n`);

  // Write after EACH city, not once at the end. A single write at the end means an
  // interrupted run throws away everything it crawled — which is exactly what
  // happened on the first 30-city attempt (391 北京 details, discarded on exit).
  console.log("2. Crawling…");
  let written = 0;
  for (const city of targets) {
    const listed = await listCity(city.code, city.name);
    const unseen = listed.filter((id) => !known.has(id)).slice(0, LIMIT);
    if (unseen.length === 0) {
      console.log(`   ${city.name}: nothing new\n`);
      continue;
    }
    const details = await fetchDetails(unseen, city.name);
    if (details.length === 0) continue;
    // Showstart's detail API omits cityId; fall back to the city we asked for,
    // exactly as src/pipeline/crawl.ts does.
    const rows = details.map((d) => ({ ...d, cityCode: d.cityCode || city.code, rowId: randomUUID() }));
    d1ExecFile(showsSql(rows));
    written += rows.length;
    for (const r of rows) known.add(r.showstartId);
    console.log(`   ${city.name}: +${rows.length} written\n`);
  }

  if (written === 0) {
    console.log("Nothing new to write. Done.");
    return;
  }
  console.log(`3. Wrote ${written} shows.`);

  // Re-match from scratch against what D1 actually holds. Reading the ids back
  // (rather than trusting the ones we just generated) keeps this correct even if a
  // show already existed under a different row id, and re-matching every show —
  // not just the new ones — repairs any match the Worker previously missed.
  console.log("\n4. Matching against followed artists…");
  if (DRY_RUN) {
    console.log("   [dry-run] skipping match (needs the shows to be in D1 first)");
    return;
  }
  const artists = d1Query<{ id: string; name: string; normalized_name: string; aliases: string }>(
    "SELECT id, name, normalized_name, aliases FROM artists",
  ).map<MatchArtist>((a) => ({
    id: a.id,
    name: a.name,
    normalizedName: a.normalized_name,
    aliases: JSON.parse(a.aliases),
  }));
  const stored = d1Query<{ id: string; title: string; performers: string }>(
    "SELECT id, title, performers FROM shows",
  ).map<MatchShow>((s) => ({ id: s.id, title: s.title, performers: JSON.parse(s.performers) }));

  const matches = matchShows(artists, stored);
  console.log(`   ${artists.length} artists x ${stored.length} shows -> ${matches.length} matches`);
  if (matches.length > 0) {
    d1ExecFile(
      matches
        .map(
          (m) =>
            `INSERT OR IGNORE INTO show_artists (show_id, artist_id, matched_by) ` +
            `VALUES (${q(m.showId)}, ${q(m.artistId)}, ${q(m.matchedBy)});`,
        )
        .join("\n"),
    );
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
