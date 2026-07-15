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

// D1 rejects a query with more than 100 bound parameters ("too many SQL
// variables"). Any `IN (${placeholders})` built one-per-id must therefore be
// chunked — a busy city's listing is ~150 shows, which silently took the entire
// crawl down for the biggest cities.
const D1_MAX_BOUND_PARAMS = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function filterNewShowstartIds(db: D1Database, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const seen = new Set<string>();
  for (const batch of chunk(ids, D1_MAX_BOUND_PARAMS)) {
    const placeholders = batch.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT showstart_id FROM shows WHERE showstart_id IN (${placeholders})`)
      .bind(...batch)
      .all<{ showstart_id: string }>();
    for (const r of results) seen.add(r.showstart_id);
  }
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

export async function getAllShows(db: D1Database): Promise<ShowRow[]> {
  const { results } = await db.prepare("SELECT * FROM shows").all<RawRow>();
  return results.map(toRow);
}

export async function getShowsByIds(db: D1Database, ids: string[]): Promise<ShowRow[]> {
  if (ids.length === 0) return [];
  const rows: ShowRow[] = [];
  for (const batch of chunk(ids, D1_MAX_BOUND_PARAMS)) {
    const placeholders = batch.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT * FROM shows WHERE id IN (${placeholders})`)
      .bind(...batch)
      .all<RawRow>();
    for (const r of results) rows.push(toRow(r));
  }
  return rows;
}
