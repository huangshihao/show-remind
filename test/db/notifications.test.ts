import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "./apply-schema";
import { createPendingSubscription, activateByToken } from "../../src/db/subscriptions";
import { addArtistToSubscription } from "../../src/db/subscription-artists";
import { upsertShow } from "../../src/db/shows";
import { persistMatches } from "../../src/db/show-artists";
import { findNotifyCandidates, markSent } from "../../src/db/notifications";

beforeEach(applySchema);
const db = () => env.DB;

async function setup() {
  const sub = await createPendingSubscription(db(), "a@b.com", ["110000"]);
  await activateByToken(db(), sub.token);
  const artistId = await addArtistToSubscription(db(), sub.id, "刺猬");
  const show = await upsertShow(db(), {
    showstartId: "100", title: "刺猬专场", cityCode: "110000", venue: "MAO",
    showTime: "2026-08-01T20:00:00", price: "180", url: "https://x/100", performers: ["刺猬"],
    poster: "https://s2.showstart.com/100.jpg",
  });
  await persistMatches(db(), [{ showId: show.id, artistId, matchedBy: "performer" }]);
  return { sub, show };
}

it("finds a candidate for an active sub with a matched show in its city", async () => {
  const { show } = await setup();
  const cands = await findNotifyCandidates(db());
  expect(cands.length).toBe(1);
  expect(cands[0].shows.map((s) => s.showId)).toEqual([show.id]);
  expect(cands[0].shows[0].artistNames).toEqual(["刺猬"]);
  expect(cands[0].shows[0].hasTitleOnlyMatch).toBe(false);
  expect(cands[0].shows[0].poster).toBe("https://s2.showstart.com/100.jpg");
});

it("excludes shows outside the sub's cities", async () => {
  const { sub } = await setup();
  await env.DB.prepare("UPDATE subscriptions SET cities='[\"310000\"]' WHERE id=?").bind(sub.id).run();
  expect((await findNotifyCandidates(db())).length).toBe(0);
});

it("markSent prevents the same show from being a candidate again", async () => {
  const { sub, show } = await setup();
  await markSent(db(), sub.id, [show.id]);
  expect((await findNotifyCandidates(db())).length).toBe(0);
});

it("ignores pending (unconfirmed) subscriptions", async () => {
  const sub = await createPendingSubscription(db(), "p@b.com", ["110000"]);
  const artistId = await addArtistToSubscription(db(), sub.id, "刺猬");
  const show = await upsertShow(db(), {
    showstartId: "200", title: "x", cityCode: "110000", venue: null,
    showTime: null, price: null, url: "https://x/200", performers: ["刺猬"],
    poster: null,
  });
  await persistMatches(db(), [{ showId: show.id, artistId, matchedBy: "performer" }]);
  expect((await findNotifyCandidates(db())).length).toBe(0);
});
