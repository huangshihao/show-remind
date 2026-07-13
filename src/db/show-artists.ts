export interface MatchInput {
  showId: string;
  artistId: string;
  matchedBy: "performer" | "title";
}

export async function persistMatches(db: D1Database, matches: MatchInput[]): Promise<number> {
  let inserted = 0;
  for (const m of matches) {
    const res = await db
      .prepare("INSERT OR IGNORE INTO show_artists (show_id, artist_id, matched_by) VALUES (?, ?, ?)")
      .bind(m.showId, m.artistId, m.matchedBy)
      .run();
    inserted += res.meta.changes ?? 0;
  }
  return inserted;
}
