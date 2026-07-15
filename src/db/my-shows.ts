import { UPCOMING } from "./time";
export interface UpcomingShow {
  id: string;
  title: string;
  poster: string | null;
  cityCode: string;
  venue: string | null;
  showTime: string | null;
  price: string | null;
  url: string;
  artistNames: string[];
  // Whether a reminder email for this show has already gone out to THIS
  // subscription, so the page can mark it rather than look like it never fired.
  notified: boolean;
}

interface JoinRow {
  show_id: string;
  title: string;
  city_code: string;
  venue: string | null;
  show_time: string | null;
  price: string | null;
  url: string;
  poster: string | null;
  first_seen_at: string;
  artist_name: string;
  notified: number;
}

const UPCOMING_SHOWS_LIMIT = 20;

// Shows matching the subscription's followed artists, in its cities, that
// haven't happened yet. Mirrors findNotifyCandidates' join shape (subs →
// subscription_artists → show_artists → shows → artists) but is scoped to a
// single subscription and unconditioned on notification status — this powers
// the manage page's "upcoming shows" display, not the reminder pipeline.
export async function findUpcomingShowsForSubscription(
  db: D1Database,
  subscriptionId: string,
): Promise<UpcomingShow[]> {
  const sub = await db
    .prepare("SELECT cities FROM subscriptions WHERE id = ?")
    .bind(subscriptionId)
    .first<{ cities: string }>();
  if (!sub) return [];
  const cities = JSON.parse(sub.cities) as string[];

  const { results } = await db
    .prepare(
      `SELECT sh.id AS show_id, sh.title, sh.city_code, sh.venue, sh.show_time, sh.price, sh.url,
              sh.poster, sh.first_seen_at, a.name AS artist_name,
              EXISTS (
                SELECT 1 FROM notifications n
                WHERE n.subscription_id = sa.subscription_id AND n.show_id = sh.id
              ) AS notified
       FROM subscription_artists sa
       JOIN show_artists xsa ON xsa.artist_id = sa.artist_id
       JOIN shows sh ON sh.id = xsa.show_id
       JOIN artists a ON a.id = sa.artist_id
       WHERE sa.subscription_id = ?
         AND ${UPCOMING("sh.show_time")}`,
    )
    .bind(subscriptionId)
    .all<JoinRow>();

  // Group by show (a show can have multiple followed performers, one row
  // each), collecting distinct artist names. City filtering happens in JS,
  // same as findNotifyCandidates, since `cities` is a JSON array column.
  const byShow = new Map<string, UpcomingShow & { firstSeenAt: string }>();
  for (const r of results) {
    if (!cities.includes(r.city_code)) continue;
    let show = byShow.get(r.show_id);
    if (!show) {
      show = {
        id: r.show_id,
        title: r.title,
        poster: r.poster,
        cityCode: r.city_code,
        venue: r.venue,
        showTime: r.show_time,
        price: r.price,
        url: r.url,
        artistNames: [],
        notified: r.notified === 1,
        firstSeenAt: r.first_seen_at,
      };
      byShow.set(r.show_id, show);
    }
    if (!show.artistNames.includes(r.artist_name)) show.artistNames.push(r.artist_name);
  }

  return [...byShow.values()]
    .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))
    .slice(0, UPCOMING_SHOWS_LIMIT)
    .map(({ firstSeenAt: _firstSeenAt, ...show }) => show);
}
