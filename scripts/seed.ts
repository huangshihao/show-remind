// One-off/occasional bulk seeder: crawl Showstart from THIS machine and write the
// results straight into the remote D1.
//
// Why this exists: the Worker cannot enumerate a city, and no amount of tuning
// will let it. 上海's listing runs to ~4000 shows; even the ~45 pages that cover
// just its future cost more external subrequests than a Workers Free invocation
// gets (50) before a single detail is fetched. The Worker's job is the steady
// state instead: it sorts newest-published, so anything announced since yesterday
// is on page 1, and it stops as soon as it reaches shows it already has.
//
// Completeness is this script's job. Locally there is no subrequest ceiling, no
// 15-minute cron wall and no 10ms CPU limit, so it walks a city to the end.
// Use it to bootstrap a cold city; the Worker keeps it warm afterwards.
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
//   --cities=a,b     only these 行政区码 (default: every city in lib/cities.ts)
//   --limit=N        at most N new shows per city (default: unlimited)
//   --dry-run        crawl + match + write the .sql, but do not touch D1
//   --db=NAME        D1 database name (default: show-remind)
//   --repair-times   re-fetch shows stored with no show_time and fill it in from
//                    showStartTime, then exit. For rows written before the
//                    crawler read the epoch fields: their showTime was a date
//                    range the display-string regex could not parse, so they
//                    were stored NULL and read as "upcoming" forever. Normal
//                    seeding skips shows it already has, so those rows can only
//                    be fixed by asking for them explicitly.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CITIES } from "../lib/cities";
import { fetchCityShows, fetchShowDetail, SORT_BY_DATE, type ShowDetail } from "../lib/sources/showstart";
import { isUpcoming } from "../lib/time";
import { matchShows, type MatchArtist, type MatchShow } from "../lib/matcher";

// Local pacing. The Worker crawler sleeps ~800-1600ms between detail fetches to
// stay unobtrusive against Showstart's WAF; keep the same spirit here but allow a
// little concurrency, since ~4800 shows one-at-a-time would take over an hour.
const CONCURRENCY = 3;
const PACE_MS = () => 600 + Math.floor(Math.random() * 600);
// A runaway stop, not a budget: listCity walks the date sort and stops itself
// once the listing turns into history (~45 pages). The old cap of 40 was a budget
// and silently truncated every city at 400 shows.
const MAX_PAGES = 120;

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

// Enumerate a city's UPCOMING shows via the date sort, which runs ascending
// through the future and then turns around into the past (see SORT_BY_DATE). So
// the whole future lives in the first ~45 pages: walk until the listing turns
// around, then stop. Walking on would spend hundreds of pages on years of
// history — 上海 lists ~4000 shows of which only ~373 have not happened yet.
//
// The listing carries showStartTime, so past shows are dropped here for free
// rather than costing a ~1s detail fetch each to discover.
//
// The date sort's real shape is lumpier than "future then past" (probed on 上海):
//
//   p1      5/10 upcoming   mixed — long-running 话剧 that opened months ago
//   p2-p4   0/10            a POCKET of purely past shows
//   p5      4/10
//   p6-p40  10/10           the future, ascending 07-16 -> 11-06
//   p44+    0/10            the history tail, descending away
//
// So neither "this page is all past" nor "the dates turned around" can mark the
// end — both trip on the p2-p4 pocket and quit with 5 of 上海's 373 upcoming
// shows. Only a run of empty pages LONGER than that pocket is evidence of the
// tail. Listing is cheap (~0.35s/page), so the tolerance is generous and the hard
// cap is well past 上海's ~44.
const EMPTY_PAGES_BEFORE_STOP = 8;

async function listCity(code: string, name: string): Promise<string[]> {
  const upcoming = new Set<string>();
  let listed = 0;
  let pages = 0;
  let emptyRun = 0;
  let stoppedBy = "end of listing";

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { shows } = await fetchCityShows(code, page, SORT_BY_DATE);
    if (shows.length === 0) break;
    pages = page;
    listed += shows.length;

    const fresh = shows.filter((s) => isUpcoming(s.showTime));
    for (const s of fresh) upcoming.add(s.showstartId);

    if (fresh.length === 0) {
      if (++emptyRun >= EMPTY_PAGES_BEFORE_STOP) {
        stoppedBy = `${EMPTY_PAGES_BEFORE_STOP} pages of history`;
        break;
      }
    } else {
      emptyRun = 0;
    }
    await sleep(200);
  }

  // Never truncate silently — that is how the 400-show cap hid for so long.
  if (pages >= MAX_PAGES) stoppedBy = `HIT THE ${MAX_PAGES}-PAGE GUARD — city may be incomplete`;
  console.log(`   ${name}: ${listed} listed / ${pages} pages -> ${upcoming.size} upcoming (stop: ${stoppedBy})`);
  return [...upcoming];
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

// Re-fetch every show we stored without a time and fill it in from showStartTime.
async function repairTimes(): Promise<void> {
  const undated = d1Query<{ showstart_id: string; title: string }>(
    "SELECT showstart_id, title FROM shows WHERE show_time IS NULL",
  );
  console.log(`${undated.length} shows stored with no show_time\n`);
  if (undated.length === 0) return;

  const details = await fetchDetails(undated.map((s) => s.showstart_id), "repair");
  const dated = details.filter((d) => d.showTime !== null);
  console.log(`\nrecovered a time for ${dated.length} of ${details.length} re-fetched`);
  if (dated.length === 0 || DRY_RUN) {
    if (DRY_RUN) console.log("[dry-run] not applied");
    return;
  }
  d1ExecFile(
    dated
      .map((d) => `UPDATE shows SET show_time=${q(d.showTime)} WHERE showstart_id=${q(d.showstartId)};`)
      .join("\n"),
  );
  console.log("Done.");
}

// --- main -------------------------------------------------------------------

async function main() {
  if (has("repair-times")) {
    console.log(`Repairing missing show times in "${DB}"${DRY_RUN ? " (dry run)" : ""}\n`);
    return repairTimes();
  }
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
