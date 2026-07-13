import { upsertArtist, type ArtistRow } from "./artists";

export async function addArtistToSubscription(
  db: D1Database,
  subscriptionId: string,
  artistName: string,
): Promise<string> {
  const artist = await upsertArtist(db, artistName);
  await db
    .prepare(
      "INSERT OR IGNORE INTO subscription_artists (subscription_id, artist_id) VALUES (?, ?)",
    )
    .bind(subscriptionId, artist.id)
    .run();
  return artist.id;
}

export async function removeArtist(
  db: D1Database,
  subscriptionId: string,
  artistId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM subscription_artists WHERE subscription_id=? AND artist_id=?")
    .bind(subscriptionId, artistId)
    .run();
}

export async function setArtists(
  db: D1Database,
  subscriptionId: string,
  artistNames: string[],
): Promise<void> {
  await db.prepare("DELETE FROM subscription_artists WHERE subscription_id=?").bind(subscriptionId).run();
  for (const name of artistNames) {
    await addArtistToSubscription(db, subscriptionId, name);
  }
}

export async function listArtists(db: D1Database, subscriptionId: string): Promise<ArtistRow[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.name, a.normalized_name, a.aliases
       FROM artists a JOIN subscription_artists sa ON sa.artist_id = a.id
       WHERE sa.subscription_id = ? ORDER BY a.name`,
    )
    .bind(subscriptionId)
    .all<{ id: string; name: string; normalized_name: string; aliases: string }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    normalizedName: r.normalized_name,
    aliases: JSON.parse(r.aliases),
  }));
}

export async function countArtists(db: D1Database, subscriptionId: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM subscription_artists WHERE subscription_id=?")
    .bind(subscriptionId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}
