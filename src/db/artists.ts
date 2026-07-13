import { normalizeName } from "@/lib/matcher/normalize";
import { newId } from "./ids";

export interface ArtistRow {
  id: string;
  name: string;
  normalizedName: string;
  aliases: string[];
  // null = never looked up; "" = looked up, Showstart had no match; a URL = found.
  avatar: string | null;
}

interface RawRow {
  id: string;
  name: string;
  normalized_name: string;
  aliases: string;
  avatar: string | null;
}

function toRow(r: RawRow): ArtistRow {
  return {
    id: r.id,
    name: r.name,
    normalizedName: r.normalized_name,
    aliases: JSON.parse(r.aliases),
    avatar: r.avatar,
  };
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
  return { id, name, normalizedName: normalized, aliases: [], avatar: null };
}

export async function getAllArtists(db: D1Database): Promise<ArtistRow[]> {
  const { results } = await db.prepare("SELECT * FROM artists").all<RawRow>();
  return results.map(toRow);
}

export async function setArtistAvatar(
  db: D1Database,
  artistId: string,
  avatar: string,
): Promise<void> {
  await db.prepare("UPDATE artists SET avatar=? WHERE id=?").bind(avatar, artistId).run();
}
