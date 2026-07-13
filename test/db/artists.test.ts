import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "./apply-schema";
import { upsertArtist, getAllArtists } from "../../src/db/artists";

beforeEach(applySchema);
const db = () => env.DB;

it("inserts a new artist and is idempotent on normalized name", async () => {
  const a = await upsertArtist(db(), "海龟先生");
  const b = await upsertArtist(db(), "海龟先生");
  expect(b.id).toBe(a.id);
  expect((await getAllArtists(db())).length).toBe(1);
});

it("treats case/whitespace variants as the same artist", async () => {
  // normalizeName lowercases + collapses whitespace (it does NOT strip
  // hyphens), so these two spellings normalize to the same key.
  const a = await upsertArtist(db(), "Re TROS");
  const b = await upsertArtist(db(), "re   tros");
  expect(b.id).toBe(a.id);
});
