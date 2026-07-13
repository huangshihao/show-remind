export interface NotifyShow {
  showId: string;
  title: string;
  cityCode: string;
  venue: string | null;
  showTime: string | null;
  price: string | null;
  url: string;
  poster: string | null;
  artistNames: string[];
  hasTitleOnlyMatch: boolean;
}

export interface Candidate {
  subscriptionId: string;
  email: string;
  token: string;
  shows: NotifyShow[];
}

interface JoinRow {
  subscription_id: string;
  email: string;
  token: string;
  cities: string;
  show_id: string;
  title: string;
  city_code: string;
  venue: string | null;
  show_time: string | null;
  price: string | null;
  url: string;
  poster: string | null;
  artist_name: string;
  matched_by: string;
}

export async function findNotifyCandidates(db: D1Database): Promise<Candidate[]> {
  // Join active subs → their followed artists → matching shows → not yet notified.
  // City filtering is done in JS because cities is a JSON array column.
  const { results } = await db
    .prepare(
      `SELECT s.id AS subscription_id, s.email, s.token, s.cities,
              sh.id AS show_id, sh.title, sh.city_code, sh.venue, sh.show_time, sh.price, sh.url, sh.poster,
              a.name AS artist_name, xsa.matched_by
       FROM subscriptions s
       JOIN subscription_artists sa ON sa.subscription_id = s.id
       JOIN show_artists xsa ON xsa.artist_id = sa.artist_id
       JOIN shows sh ON sh.id = xsa.show_id
       JOIN artists a ON a.id = sa.artist_id
       WHERE s.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.subscription_id = s.id AND n.show_id = sh.id
         )`,
    )
    .all<JoinRow>();

  // Group by subscription, then by show.
  const bySub = new Map<string, Candidate>();
  for (const r of results) {
    const cities = JSON.parse(r.cities) as string[];
    if (!cities.includes(r.city_code)) continue;
    let cand = bySub.get(r.subscription_id);
    if (!cand) {
      cand = { subscriptionId: r.subscription_id, email: r.email, token: r.token, shows: [] };
      bySub.set(r.subscription_id, cand);
    }
    let show = cand.shows.find((x) => x.showId === r.show_id);
    if (!show) {
      show = {
        showId: r.show_id,
        title: r.title,
        cityCode: r.city_code,
        venue: r.venue,
        showTime: r.show_time,
        price: r.price,
        url: r.url,
        poster: r.poster,
        artistNames: [],
        hasTitleOnlyMatch: true,
      };
      cand.shows.push(show);
    }
    if (!show.artistNames.includes(r.artist_name)) show.artistNames.push(r.artist_name);
    if (r.matched_by !== "title") show.hasTitleOnlyMatch = false;
  }
  return [...bySub.values()].filter((c) => c.shows.length > 0);
}

export async function markSent(db: D1Database, subscriptionId: string, showIds: string[]): Promise<void> {
  for (const showId of showIds) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO notifications (subscription_id, show_id, status, sent_at) VALUES (?, ?, 'sent', datetime('now'))",
      )
      .bind(subscriptionId, showId)
      .run();
  }
}

export async function deleteStalePending(db: D1Database, hours: number): Promise<number> {
  const res = await db
    .prepare(
      `DELETE FROM subscriptions WHERE status='pending' AND created_at < datetime('now', ?)`,
    )
    .bind(`-${hours} hours`)
    .run();
  return res.meta.changes ?? 0;
}
