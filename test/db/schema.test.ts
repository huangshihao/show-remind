import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "./apply-schema";

beforeEach(applySchema);

it("creates all six tables", async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all<{ name: string }>();
  const names = results.map((r) => r.name);
  expect(names).toEqual(
    expect.arrayContaining([
      "subscriptions",
      "artists",
      "subscription_artists",
      "shows",
      "show_artists",
      "notifications",
    ]),
  );
});
