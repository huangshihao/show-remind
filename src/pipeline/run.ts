import type { Env } from "../env";
import { runNotifications } from "./notify";
import { maybeAlertAdmin } from "./admin-alert";
import { deleteStalePending } from "../db/notifications";

export async function activeCities(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT cities FROM subscriptions WHERE status='active'")
    .all<{ cities: string }>();
  const set = new Set<string>();
  for (const r of results) for (const c of JSON.parse(r.cities) as string[]) set.add(c);
  return [...set];
}

export async function runScheduled(env: Env): Promise<void> {
  const cities = await activeCities(env.DB);
  const failedCities: string[] = [];

  for (const city of cities) {
    try {
      const resp = await fetch(`${env.APP_BASE_URL}/internal/crawl?city=${city}`, {
        headers: { "x-internal-secret": env.INTERNAL_SECRET },
      });
      if (!resp.ok) failedCities.push(city);
    } catch {
      failedCities.push(city);
    }
  }

  await runNotifications(env.DB, env);
  await maybeAlertAdmin(env.DB, env, failedCities, cities.length);
  await deleteStalePending(env.DB, 48);
}
