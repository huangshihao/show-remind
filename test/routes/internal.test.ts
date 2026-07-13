import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import { app } from "../../src/index";
import * as showstart from "@/lib/sources/showstart";

beforeEach(applySchema);

it("rejects without the internal secret", async () => {
  const res = await app.request("/internal/crawl?city=110000", {}, env);
  expect(res.status).toBe(403);
});

it("crawls a city when the secret matches", async () => {
  vi.spyOn(showstart, "fetchCityShows").mockResolvedValue({
    shows: [{ showstartId: "1", title: "x", cityCode: "110000", showTime: null, url: "u1" }],
  });
  vi.spyOn(showstart, "fetchShowDetail").mockResolvedValue({
    showstartId: "1", title: "x", cityCode: "110000", venue: null,
    showTime: null, price: null, url: "u1", performers: ["刺猬"],
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
