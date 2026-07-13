import { normalizeName } from "@/lib/matcher/normalize";
import { newId } from "./ids";

export interface ArtistRow {
  id: string;
  name: string;
  normalizedName: string;
  aliases: string[];
}

interface RawRow {
  id: string;
  name: string;
  normalized_name: string;
  aliases: string;
}

function toRow(r: RawRow): ArtistRow {
  return { id: r.id, name: r.name, normalizedName: r.normalized_name, aliases: JSON.parse(r.aliases) };
}

export async function upsertArtist(db: D1Database, name: string): Promise<ArtistRow> {
  const normalized = normalizeName(name);
  const existing = await db
    .prepare("SELECT * FROM artists WHERE normalized_name = ?")
    .bind(normalized)
    .first<RawRow>();
  if (existing) return toRow(existing);
  const id = newId();
  await db
    .prepare("INSERT INTO artists (id, name, normalized_name, aliases) VALUES (?, ?, ?, '[]')")
    .bind(id, name, normalized)
    .run();
  return { id, name, normalizedName: normalized, aliases: [] };
}

export async function getAllArtists(db: D1Database): Promise<ArtistRow[]> {
  const { results } = await db.prepare("SELECT * FROM artists").all<RawRow>();
  return results.map(toRow);
}
