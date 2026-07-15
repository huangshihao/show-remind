import type { Env } from "../env";
import { runNotifications } from "./notify";
import { maybeAlertAdmin } from "./admin-alert";
import { deleteStalePending } from "../db/notifications";
import { crawlableCityCodes } from "@/lib/cities";

// Crawl coverage is deliberately NOT derived from what subscriptions currently
// follow. Doing that was a chicken-and-egg trap: a city nobody had subscribed to
// was never crawled, so the first person to add it saw an empty shows list until
// the next day's run — and only then if the crawl happened after they saved.
// Crawling every crawlable city keeps the shows table a city-independent corpus,
// so adding a city is a pure local match against data that is already there.
//
// Concurrent, not sequential: a Cron Trigger gets 15 minutes of wall time, and a
// cold city spends up to 25 detail fetches x ~1.2s of rate-limit sleep. Serially,
// 32 cities would exceed the budget and be killed mid-sweep. The Workers runtime
// caps a single invocation at 6 simultaneous outgoing connections, so these queue
// into waves of 6 on their own — no explicit pool needed, and Showstart never sees
// more than 6 of our connections at once.
//
// Budget: one external subrequest per city (32) plus at most one admin alert, well
// inside the 50-per-invocation ceiling on Workers Free. The mail run is a separate
// cron for exactly this reason — see runNotify.
export async function runCrawl(env: Env): Promise<void> {
  const cities = crawlableCityCodes();
  const results = await Promise.allSettled(
    cities.map(async (city) => {
      const resp = await fetch(`${env.APP_BASE_URL}/internal/crawl?city=${city}`, {
        headers: { "x-internal-secret": env.INTERNAL_SECRET },
      });
      if (!resp.ok) throw new Error(`crawl ${city} responded ${resp.status}`);
    }),
  );
  const failedCities = cities.filter((_city, i) => results[i].status === "rejected");
  await maybeAlertAdmin(env.DB, env, failedCities, cities.length);
}

// Separate invocation from runCrawl on purpose. Workers Free allows 50 external
// subrequests per invocation; the sweep already spends one per city, and each
// reminder email is another. Sharing one invocation would silently cap how many
// reminders could go out once the city list and subscriber count grew.
export async function runNotify(env: Env): Promise<void> {
  await runNotifications(env.DB, env);
  await deleteStalePending(env.DB, 48);
}
