import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import { app } from "../../src/index";
import * as showstart from "@/lib/sources/showstart";
import * as run from "../../src/pipeline/run";
import { createPendingSubscription, activateByToken } from "../../src/db/subscriptions";
import { addArtistToSubscription } from "../../src/db/subscription-artists";
import { upsertShow } from "../../src/db/shows";
import { persistMatches } from "../../src/db/show-artists";

beforeEach(applySchema);

it("rejects without the internal secret", async () => {
  const res = await app.request("/internal/crawl?city=110000", {}, env);
  expect(res.status).toBe(403);
});

it("crawls a city when the secret matches", async () => {
  vi.spyOn(showstart, "fetchCityShows").mockResolvedValue({
    shows: [{ showstartId: "1", title: "x", cityCode: "110000", showTime: null, url: "u1", poster: null }],
  });
  vi.spyOn(showstart, "fetchShowDetail").mockResolvedValue({
    showstartId: "1", title: "x", cityCode: "110000", venue: null,
    showTime: null, price: null, url: "u1", performers: ["刺猬"], poster: null,
  });
  const res = await app.request(
    "/internal/crawl?city=110000",
    { headers: { "x-internal-secret": "test-internal" } },
    env,
  );
  expect(res.status).toBe(200);
  expect((await res.json() as any).newShows).toBe(1);
  vi.restoreAllMocks();
});

it("fails closed when INTERNAL_SECRET is unset (empty)", async () => {
  const res = await app.request(
    "/internal/crawl?city=110000",
    { headers: { "x-internal-secret": "anything" } },
    { ...env, INTERNAL_SECRET: "" },
  );
  expect(res.status).toBe(403);
});

it("crawl-sweep endpoint rejects without the secret, runs the sweep with it", async () => {
  expect((await app.request("/internal/crawl-sweep", { method: "POST" }, env)).status).toBe(403);

  const sweep = vi.spyOn(run, "runCrawl").mockResolvedValue();
  const res = await app.request(
    "/internal/crawl-sweep",
    { method: "POST", headers: { "x-internal-secret": "test-internal" } },
    env,
  );
  expect(res.status).toBe(200);
  expect(sweep).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
});

it("notify endpoint rejects without the secret, runs the reminder pipeline with it", async () => {
  expect((await app.request("/internal/notify", { method: "POST" }, env)).status).toBe(403);

  // one active sub following an artist with an upcoming matched show
  const sub = await createPendingSubscription(env.DB, "n@b.com", ["110000"]);
  await activateByToken(env.DB, sub.token);
  const artistId = await addArtistToSubscription(env.DB, sub.id, "刺猬");
  const show = await upsertShow(env.DB, {
    showstartId: "n1", title: "刺猬专场", cityCode: "110000", venue: "MAO",
    showTime: "2099-08-01T20:00:00", price: "180", url: "https://x/n1", performers: ["刺猬"],
    poster: null,
  });
  await persistMatches(env.DB, [{ showId: show.id, artistId, matchedBy: "performer" }]);

  const trigger = () =>
    app.request("/internal/notify", { method: "POST", headers: { "x-internal-secret": "test-internal" } }, env);
  const first = await trigger();
  expect(first.status).toBe(200);
  expect(((await first.json()) as any).sent).toBe(1);
  // idempotent: already notified, nothing left to send
  expect(((await (await trigger()).json()) as any).sent).toBe(0);
});
