import { fetchCityShows, fetchShowDetail } from "@/lib/sources/showstart";
import { filterNewShowstartIds, upsertShow } from "../db/shows";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 800 + Math.floor(Math.random() * 800);

// Walk the city's paged list until an empty page, up to this cap. Each page is
// one cheap subrequest (10 shows), so a high cap is fine — it just needs to
// cover a busy city's full listing (武汉 alone runs ~120 shows / 12 pages out
// to a few months) so far-dated shows aren't invisible to the crawler.
const MAX_PAGES = 15;
// Detail fetch + upsert dominate the Workers 50-subrequest budget (shared with
// the match step in the same /internal/crawl invocation). Cap how many new
// shows we enrich per run; the rest stay unseen and are picked up next run.
// The list is roughly date-ordered, so nearer shows enrich first.
export const MAX_DETAILS_PER_RUN = 6;

export async function crawlCity(db: D1Database, cityCode: string): Promise<string[]> {
  const seenIds = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { shows } = await fetchCityShows(cityCode, page);
    if (shows.length === 0) break;
    // Dedup across pages defensively — a show appearing on two pages must not be
    // enriched twice.
    for (const s of shows) seenIds.add(s.showstartId);
  }

  const newIds = await filterNewShowstartIds(db, [...seenIds]);
  const batch = newIds.slice(0, MAX_DETAILS_PER_RUN);
  if (newIds.length > batch.length) {
    console.log(
      `crawlCity ${cityCode}: ${newIds.length} new shows, enriching ${batch.length} this run (budget cap), rest next run`,
    );
  }

  const savedIds: string[] = [];
  for (const showstartId of batch) {
    await sleep(jitter());
    const detail = await fetchShowDetail(showstartId);
    // Showstart's detail API omits cityId (detail.cityCode is ""); fall back to
    // the city this crawl was asked for so the notify/manage filter can find it.
    const saved = await upsertShow(db, { ...detail, cityCode: detail.cityCode || cityCode });
    savedIds.push(saved.id);
  }
  return savedIds;
}
