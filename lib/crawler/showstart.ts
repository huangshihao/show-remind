import { fetchCityShows, fetchShowDetail } from "@/lib/sources/showstart";
import { filterNewShowstartIds, upsertShow } from "@/lib/repositories/shows";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 1000 + Math.floor(Math.random() * 1000); // 1-2s

export async function crawlCities(
  cityCodes: string[],
): Promise<{ newShowIds: string[]; failedCities: string[] }> {
  const newShowIds: string[] = [];
  const failedCities: string[] = [];

  for (const cityCode of cityCodes) {
    try {
      const { shows } = await fetchCityShows(cityCode, 1);
      const newIds = await filterNewShowstartIds(shows.map((s) => s.showstartId));
      for (const showstartId of newIds) {
        await sleep(jitter());
        const detail = await fetchShowDetail(showstartId);
        const saved = await upsertShow(detail);
        newShowIds.push(saved.id);
      }
    } catch {
      failedCities.push(cityCode);
    }
  }
  return { newShowIds, failedCities };
}
