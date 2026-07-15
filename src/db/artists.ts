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

// `avatar` (when given) is a playlist-sourced photo URL: stored on insert, and
// used to heal an existing row whose avatar is null (never looked up) or ""
// (Showstart search came up empty). A real avatar already on the row wins —
// this never overwrites one URL with another.
export async function upsertArtist(
  db: D1Database,
  name: string,
  avatar?: string | null,
): Promise<ArtistRow> {
  const normalized = normalizeName(name);
  const existing = await db
    .prepare("SELECT * FROM artists WHERE normalized_name = ?")
    .bind(normalized)
    .first<RawRow>();
  if (existing) {
    const row = toRow(existing);
    if (avatar && !row.avatar) {
      await setArtistAvatar(db, row.id, avatar);
      row.avatar = avatar;
    }
    return row;
  }
  const id = newId();
  await db
    .prepare("INSERT INTO artists (id, name, normalized_name, aliases, avatar) VALUES (?, ?, ?, '[]', ?)")
    .bind(id, name, normalized, avatar ?? null)
    .run();
  return { id, name, normalizedName: normalized, aliases: [], avatar: avatar ?? null };
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
