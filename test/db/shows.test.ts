import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "./apply-schema";
import { filterNewShowstartIds, upsertShow, getShowsByIds } from "../../src/db/shows";
import { persistMatches } from "../../src/db/show-artists";
import { upsertArtist } from "../../src/db/artists";

beforeEach(applySchema);
const db = () => env.DB;

const detail = (showstartId: string) => ({
  showstartId,
  title: `Show ${showstartId}`,
  cityCode: "110000",
  venue: "MAO",
  showTime: "2026-08-01T20:00:00",
  price: "180",
  url: `https://wap.showstart.com/x/${showstartId}`,
  performers: ["刺猬"],
  poster: "https://s2.showstart.com/x.jpg",
});

it("upsertShow inserts once and keeps id on re-upsert", async () => {
  const a = await upsertShow(db(), detail("100"));
  const b = await upsertShow(db(), { ...detail("100"), price: "200" });
  expect(b.id).toBe(a.id);
  expect(b.price).toBe("200");
});

it("filterNewShowstartIds returns only unseen ids", async () => {
  await upsertShow(db(), detail("100"));
  expect(await filterNewShowstartIds(db(), ["100", "101", "102"])).toEqual(["101", "102"]);
});

it("persistMatches links shows to artists idempotently", async () => {
  const show = await upsertShow(db(), detail("100"));
  const artist = await upsertArtist(db(), "刺猬");
  const n1 = await persistMatches(db(), [{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);
  const n2 = await persistMatches(db(), [{ showId: show.id, artistId: artist.id, matchedBy: "performer" }]);
  expect(n1).toBe(1);
  expect(n2).toBe(0);
});

it("getShowsByIds returns parsed rows", async () => {
  const s = await upsertShow(db(), detail("100"));
  const [row] = await getShowsByIds(db(), [s.id]);
  expect(row.performers).toEqual(["刺猬"]);
  expect(row.title).toBe("Show 100");
  expect(row.poster).toBe("https://s2.showstart.com/x.jpg");
});
