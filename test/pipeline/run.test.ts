import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import type { Env } from "../../src/env";
import { applySchema } from "../db/apply-schema";
import { createPendingSubscription, activateByToken } from "../../src/db/subscriptions";
import { runCrawl } from "../../src/pipeline/run";
import { crawlableCityCodes } from "@/lib/cities";

beforeEach(applySchema);

// See notify.test.ts: the ambient Cloudflare.Env misses the app-level vars that
// vitest.config.mts supplies, so cast to our own Env (src/env.ts).
const typedEnv = env as unknown as Env;

// Capture which cities runScheduled asks /internal/crawl to crawl, and stub the
// crawl itself out — this is about crawl *coverage*, not crawl mechanics.
function captureCrawledCities(): string[] {
  const crawled: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const url = new URL(String(input?.url ?? input));
    if (url.pathname === "/internal/crawl") crawled.push(url.searchParams.get("city")!);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  return crawled;
}

it("crawls a crawlable city that no subscription follows yet", async () => {
  // Only 武汉 is followed. 上海 is crawlable but nobody has subscribed to it —
  // it must still be crawled, otherwise a user who later adds 上海 finds an
  // empty shows table and the manage page has nothing to display.
  const { token } = await createPendingSubscription(typedEnv.DB, "fan@test.local", ["420100"]);
  await activateByToken(typedEnv.DB, token);

  const crawled = captureCrawledCities();
  await runCrawl(typedEnv);

  expect(crawled).toContain("310000"); // 上海
});

it("crawls every city with a Showstart id even with no subscriptions at all", async () => {
  const crawled = captureCrawledCities();
  await runCrawl(typedEnv);

  expect(crawled).toContain("110000"); // 北京
  expect(crawled).toContain("420100"); // 武汉
  expect(crawled).toContain("310000"); // 上海
});

// 深圳/杭州 were uncrawlable for as long as their Showstart ids were unknown, so
// they are the canaries: the sweep must reach every city the picker offers.
it("crawls every city the picker offers, leaving no city a dead end", async () => {
  const crawled = captureCrawledCities();
  await runCrawl(typedEnv);

  expect(crawled).toContain("440300"); // 深圳
  expect(crawled).toContain("330100"); // 杭州
  expect([...crawled].sort()).toEqual([...crawlableCityCodes()].sort());
});

// Cron Triggers get 15 minutes of wall time. A real crawlCity spends ~25 detail
// fetches x ~1.2s of deliberate rate-limit sleep, so ~30s+ per city; crawling
// ~20 cities one after another would blow the budget and the run would be killed
// partway through. The cities must be in flight together.
it("crawls cities concurrently rather than one after another", async () => {
  let inFlight = 0;
  let peakInFlight = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    peakInFlight = Math.max(peakInFlight, ++inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });

  await runCrawl(typedEnv);

  expect(peakInFlight).toBeGreaterThan(1);
});

// A single unreachable city must not abort the sweep or hide the rest.
it("reports a failed city without stopping the other cities", async () => {
  const crawled: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const url = new URL(String(input?.url ?? input));
    const city = url.searchParams.get("city")!;
    crawled.push(city);
    if (city === "310000") throw new Error("upstream exploded");
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });

  await expect(runCrawl(typedEnv)).resolves.toBeUndefined();
  expect(crawled.length).toBe(crawlableCityCodes().length);
});
