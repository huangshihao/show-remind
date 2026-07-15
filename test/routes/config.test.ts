import { expect, it } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../../src/index";
import { showstartCityId } from "@/lib/cities";

it("returns cities and public flags", async () => {
  const res = await app.request("/api/config", {}, env);
  const body = (await res.json()) as any;
  expect(Array.isArray(body.cities)).toBe(true);
  expect(body.cities.find((c: any) => c.code === "110000").name).toBe("北京");
  expect(body.publicMode).toBe(false); // test env PUBLIC_MODE="0"
});

// Offering a city the crawler can't reach sells a subscription that will never
// deliver a single show. Every offered city must be crawlable — which, now that
// the whole 区号 mapping is pinned, means every city is offered.
it("offers only cities the crawler can reach", async () => {
  const res = await app.request("/api/config", {}, env);
  const body = (await res.json()) as any;
  const codes = body.cities.map((c: any) => c.code);
  expect(codes).toContain("440300"); // 深圳
  expect(codes).toContain("330100"); // 杭州
  expect(codes).toContain("310000"); // 上海
  expect(codes.every((c: string) => showstartCityId(c) != null)).toBe(true);
});
