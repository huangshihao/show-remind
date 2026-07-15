import { fetchCityShows, fetchShowDetail } from "@/lib/sources/showstart";
import { filterNewShowstartIds, upsertShow } from "../db/shows";
import { paceCrawl } from "./rate-limit";

// Hard stop on pagination. Rarely reached: the listing comes back newest-published
// first (SORT_NEWEST_FIRST), so a steady-state run hits already-known shows within
// a page or two and stops there. This cap only bites when seeding a cold city —
// and a cold city is better filled with scripts/seed.ts, which has no Worker
// budget to respect. MAX_PAGES + MAX_DETAILS_PER_RUN must stay under the 50
// external-subrequest ceiling: 20 + 25 = 45.
const MAX_PAGES = 20;
// How many consecutive all-known pages end the walk. Newest-first ordering is
// approximate rather than a strict activityId sort, so one known page could be a
// blip; two in a row means we have genuinely reached old ground.
const KNOWN_PAGES_BEFORE_STOP = 2;
// Workers Free bills two separate subrequest budgets per invocation: 50 EXTERNAL
// (fetch to the internet) and 1000 INTERNAL (D1/KV/R2). Only the Showstart calls
// count against the tight one — the show upserts and the per-page new-id lookups
// are D1, and spend the roomy one. Worst case external cost is MAX_PAGES list
// fetches + this many detail fetches (20 + 25 = 45), leaving headroom under 50 for
// redirects, each hop of which counts. Newest-published order means the freshest
// announcements enrich first; anything past the cap is picked up by the next run.
export const MAX_DETAILS_PER_RUN = 25;

export async function crawlCity(db: D1Database, cityCode: string): Promise<string[]> {
  // Dedup across pages defensively — a show appearing on two pages must not be
  // enriched twice.
  const newIds: string[] = [];
  const queued = new Set<string>();
  let knownPagesInARow = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { shows } = await fetchCityShows(cityCode, page);
    if (shows.length === 0) break;

    const unseen = await filterNewShowstartIds(db, [...new Set(shows.map((s) => s.showstartId))]);
    for (const id of unseen) {
      if (!queued.has(id)) {
        queued.add(id);
        newIds.push(id);
      }
    }

    if (unseen.length === 0) {
      if (++knownPagesInARow >= KNOWN_PAGES_BEFORE_STOP) break;
    } else {
      knownPagesInARow = 0;
    }
  }

  const batch = newIds.slice(0, MAX_DETAILS_PER_RUN);
  if (newIds.length > batch.length) {
    console.log(
      `crawlCity ${cityCode}: ${newIds.length} new shows, enriching ${batch.length} this run (budget cap), rest next run`,
    );
  }

  const savedIds: string[] = [];
  for (const showstartId of batch) {
    await paceCrawl();
    const detail = await fetchShowDetail(showstartId);
    // Showstart's detail API omits cityId (detail.cityCode is ""); fall back to
    // the city this crawl was asked for so the notify/manage filter can find it.
    const saved = await upsertShow(db, { ...detail, cityCode: detail.cityCode || cityCode });
    savedIds.push(saved.id);
  }
  return savedIds;
}
