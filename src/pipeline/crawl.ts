import { fetchCityShows, fetchShowDetail } from "@/lib/sources/showstart";
import { filterNewShowstartIds, upsertShow } from "../db/shows";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 800 + Math.floor(Math.random() * 800);

export async function crawlCity(db: D1Database, cityCode: string): Promise<string[]> {
  const { shows } = await fetchCityShows(cityCode, 1);
  const newIds = await filterNewShowstartIds(db, shows.map((s) => s.showstartId));
  const savedIds: string[] = [];
  for (const showstartId of newIds) {
    await sleep(jitter());
    const detail = await fetchShowDetail(showstartId);
    // Showstart's detail API omits cityId (detail.cityCode comes back "");
    // fall back to the city this crawl was asked for, or the manage/notify
    // city filter would drop the show forever.
    const saved = await upsertShow(db, { ...detail, cityCode: detail.cityCode || cityCode });
    savedIds.push(saved.id);
  }
  return savedIds;
}
