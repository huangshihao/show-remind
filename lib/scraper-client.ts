import { z } from "zod";

export class ScraperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScraperError";
  }
}

const SongSchema = z.object({ name: z.string(), artists: z.array(z.string()) });
export const QqPlaylistSchema = z.object({ title: z.string(), songs: z.array(SongSchema) });

export const ShowSummarySchema = z.object({
  showstartId: z.string(),
  title: z.string(),
  cityCode: z.string(),
  showTime: z.string().nullable(),
  url: z.string(),
});
export const CityShowsSchema = z.object({ shows: z.array(ShowSummarySchema) });

export const ShowDetailSchema = z.object({
  showstartId: z.string(),
  title: z.string(),
  cityCode: z.string(),
  venue: z.string().nullable(),
  showTime: z.string().nullable(),
  price: z.string().nullable(),
  url: z.string(),
  performers: z.array(z.string()),
});

export type QqPlaylist = z.infer<typeof QqPlaylistSchema>;
export type ShowSummary = z.infer<typeof ShowSummarySchema>;
export type CityShows = z.infer<typeof CityShowsSchema>;
export type ShowDetail = z.infer<typeof ShowDetailSchema>;

function baseUrl(): string {
  return process.env.SCRAPER_BASE_URL ?? "http://localhost:8001";
}

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(baseUrl() + path);
  } catch (err) {
    throw new ScraperError(`scraper request failed for ${path}: ${(err as Error).message}`);
  }
  if (!resp.ok) throw new ScraperError(`scraper ${path} responded ${resp.status}`);
  const json = await resp.json();
  return schema.parse(json);
}

export const scraperClient = {
  qqPlaylist: (id: string) =>
    getJson(`/qq/playlist/${encodeURIComponent(id)}`, QqPlaylistSchema),
  cityShows: (cityCode: string, page: number) =>
    getJson(`/showstart/cities/${encodeURIComponent(cityCode)}/shows?page=${page}`, CityShowsSchema),
  showDetail: (id: string) =>
    getJson(`/showstart/shows/${encodeURIComponent(id)}`, ShowDetailSchema),
};
