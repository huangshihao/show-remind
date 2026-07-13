import { expect, it } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";

it("returns cities and public flags", async () => {
  const res = await app.request("/api/config", {}, env);
  const body = (await res.json()) as any;
  expect(Array.isArray(body.cities)).toBe(true);
  expect(body.cities.find((c: any) => c.code === "110000").name).toBe("北京");
  expect(body.publicMode).toBe(false); // test env PUBLIC_MODE="0"
});
