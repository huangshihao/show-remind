import { normalizeName } from "@/lib/matcher/normalize";
import { newId } from "./ids";

export interface ArtistRow {
  id: string;
  name: string;
  normalizedName: string;
  aliases: string[];
  // null = never looked up; "" = looked up, no source had a match; a URL = found.
  avatar: string | null;
  // Netease artist id captured from an imported playlist; lets the backfill
  // fetch the photo exactly instead of name-searching Showstart.
  neteaseId: string | null;
}

interface RawRow {
  id: string;
  name: string;
  normalized_name: string;
  aliases: string;
  avatar: string | null;
  netease_id: string | null;
}

function toRow(r: RawRow): ArtistRow {
  return {
    id: r.id,
    name: r.name,
    normalizedName: r.normalized_name,
    aliases: JSON.parse(r.aliases),
    avatar: r.avatar,
    neteaseId: r.netease_id,
  };
}

// `avatar` (when given) is a playlist-sourced photo URL: stored on insert, and
// used to heal an existing row whose avatar is null (never looked up) or ""
// (a previous search came up empty). A real avatar already on the row wins —
// this never overwrites one URL with another. `neteaseId` follows the same
// heal-if-missing rule.
export async function upsertArtist(
  db: D1Database,
  name: string,
  avatar?: string | null,
  neteaseId?: string | null,
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
    if (neteaseId && !row.neteaseId) {
      await setArtistNeteaseId(db, row.id, neteaseId);
      row.neteaseId = neteaseId;
    }
    return row;
  }
  const id = newId();
  await db
    .prepare(
      "INSERT INTO artists (id, name, normalized_name, aliases, avatar, netease_id) VALUES (?, ?, ?, '[]', ?, ?)",
    )
    .bind(id, name, normalized, avatar ?? null, neteaseId ?? null)
    .run();
  return {
    id,
    name,
    normalizedName: normalized,
    aliases: [],
    avatar: avatar ?? null,
    neteaseId: neteaseId ?? null,
  };
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

// Pass null to clear the id — done when the netease profile definitively has
// no photo, so the row isn't retried on every backfill pass.
export async function setArtistNeteaseId(
  db: D1Database,
  artistId: string,
  neteaseId: string | null,
): Promise<void> {
  await db.prepare("UPDATE artists SET netease_id=? WHERE id=?").bind(neteaseId, artistId).run();
}
