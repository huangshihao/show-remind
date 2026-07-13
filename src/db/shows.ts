import { newId } from "./ids";

export interface ShowInput {
  showstartId: string;
  title: string;
  cityCode: string;
  venue: string | null;
  showTime: string | null;
  price: string | null;
  url: string;
  performers: string[];
  poster: string | null;
}

export interface ShowRow extends ShowInput {
  id: string;
}

interface RawRow {
  id: string;
  showstart_id: string;
  title: string;
  city_code: string;
  venue: string | null;
  show_time: string | null;
  price: string | null;
  url: string;
  performers: string;
  poster: string | null;
}

function toRow(r: RawRow): ShowRow {
  return {
    id: r.id,
    showstartId: r.showstart_id,
    title: r.title,
    cityCode: r.city_code,
    venue: r.venue,
    showTime: r.show_time,
    price: r.price,
    url: r.url,
    performers: JSON.parse(r.performers),
    poster: r.poster,
  };
}

export async function filterNewShowstartIds(db: D1Database, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT showstart_id FROM shows WHERE showstart_id IN (${placeholders})`)
    .bind(...ids)
    .all<{ showstart_id: string }>();
  const seen = new Set(results.map((r) => r.showstart_id));
  return ids.filter((id) => !seen.has(id));
}

export async function upsertShow(db: D1Database, s: ShowInput): Promise<ShowRow> {
  const existing = await db
    .prepare("SELECT id FROM shows WHERE showstart_id = ?")
    .bind(s.showstartId)
    .first<{ id: string }>();
  const id = existing?.id ?? newId();
  await db
    .prepare(
      `INSERT INTO shows (id, showstart_id, title, city_code, venue, show_time, price, url, performers, poster)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(showstart_id) DO UPDATE SET
         title=excluded.title, city_code=excluded.city_code, venue=excluded.venue,
         show_time=excluded.show_time, price=excluded.price, url=excluded.url,
         performers=excluded.performers, poster=excluded.poster`,
    )
    .bind(
      id,
      s.showstartId,
      s.title,
      s.cityCode,
      s.venue,
      s.showTime,
      s.price,
      s.url,
      JSON.stringify(s.performers),
      s.poster,
    )
    .run();
  return { ...s, id };
}

export async function getShowsByIds(db: D1Database, ids: string[]): Promise<ShowRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM shows WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<RawRow>();
  return results.map(toRow);
}
