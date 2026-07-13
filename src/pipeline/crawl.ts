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
    const saved = await upsertShow(db, detail);
    savedIds.push(saved.id);
  }
  return savedIds;
}
