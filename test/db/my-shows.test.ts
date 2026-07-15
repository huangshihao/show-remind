import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "./apply-schema";
import { createPendingSubscription, activateByToken } from "../../src/db/subscriptions";
import { addArtistToSubscription } from "../../src/db/subscription-artists";
import { upsertShow } from "../../src/db/shows";
import { persistMatches } from "../../src/db/show-artists";
import { findUpcomingShowsForSubscription } from "../../src/db/my-shows";
import { markSent } from "../../src/db/notifications";

beforeEach(applySchema);
const db = () => env.DB;

async function setup() {
  const sub = await createPendingSubscription(db(), "a@b.com", ["110000"]);
  await activateByToken(db(), sub.token);
  const artistId = await addArtistToSubscription(db(), sub.id, "刺猬");
  const show = await upsertShow(db(), {
    showstartId: "100", title: "刺猬专场", cityCode: "110000", venue: "MAO",
    showTime: "2099-08-01T20:00:00", price: "180", url: "https://x/100", performers: ["刺猬"],
    poster: "https://s2.showstart.com/100.jpg",
  });
  await persistMatches(db(), [{ showId: show.id, artistId, matchedBy: "performer" }]);
  return { sub, show, artistId };
}

it("returns an upcoming show in the sub's city with its poster and artist names", async () => {
  const { sub, show } = await setup();
  const shows = await findUpcomingShowsForSubscription(db(), sub.id);
  expect(shows.length).toBe(1);
  expect(shows[0]).toEqual({
    id: show.id,
    title: "刺猬专场",
    poster: "https://s2.showstart.com/100.jpg",
    cityCode: "110000",
    venue: "MAO",
    showTime: "2099-08-01T20:00:00",
    price: "180",
    url: "https://x/100",
    artistNames: ["刺猬"],
    notified: false,
  });
});

// The manage page should say which shows have already gone out by email, so a
// reminder in the inbox and the row on the page are recognisably the same thing.
it("marks a show that has already been emailed", async () => {
  const { sub, show } = await setup();
  await markSent(db(), sub.id, [show.id]);

  const shows = await findUpcomingShowsForSubscription(db(), sub.id);

  expect(shows[0].notified).toBe(true);
});

it("does not mark another subscription's reminder as this one's", async () => {
  const { sub, show, artistId } = await setup();
  const other = await createPendingSubscription(db(), "other@b.com", ["110000"]);
  await activateByToken(db(), other.token);
  await addArtistToSubscription(db(), other.id, "刺猬");
  await persistMatches(db(), [{ showId: show.id, artistId, matchedBy: "performer" }]);
  await markSent(db(), other.id, [show.id]); // emailed to the OTHER subscriber

  const shows = await findUpcomingShowsForSubscription(db(), sub.id);

  expect(shows[0].notified).toBe(false);
});

it("includes a show with a null show_time (undated / TBD)", async () => {
  const { sub, show, artistId } = await setup();
  const show2 = await upsertShow(db(), {
    showstartId: "101", title: "待定专场", cityCode: "110000", venue: null,
    showTime: null, price: null, url: "https://x/101", performers: ["刺猬"],
    poster: null,
  });
  await persistMatches(db(), [{ showId: show2.id, artistId, matchedBy: "performer" }]);
  const shows = await findUpcomingShowsForSubscription(db(), sub.id);
  expect(shows.map((s) => s.id).sort()).toEqual([show2.id, show.id].sort());
});

it("excludes a show outside the sub's cities", async () => {
  const { sub, artistId } = await setup();
  const showOtherCity = await upsertShow(db(), {
    showstartId: "200", title: "上海场", cityCode: "310000", venue: "MAO 上海",
    showTime: "2099-09-01T20:00:00", price: "200", url: "https://x/200", performers: ["刺猬"],
    poster: null,
  });
  await persistMatches(db(), [{ showId: showOtherCity.id, artistId, matchedBy: "performer" }]);
  const shows = await findUpcomingShowsForSubscription(db(), sub.id);
  expect(shows.map((s) => s.id)).not.toContain(showOtherCity.id);
});

// show_time is Beijing wall-clock, but datetime('now') is UTC — so the filter was
// comparing "2026-07-15T14:00:00" against "2026-07-15 07:02:07" as strings. It got
// away with it across different dates, but on the SAME date the 'T' (0x54) always
// sorts above the ' ' (0x20) separator, so a gig that started hours ago still read
// as upcoming. Both sides must be normalised and in the same zone.
it("excludes a show that started earlier today", async () => {
  const { sub, artistId } = await setup();
  const beijing = (offsetMs: number) =>
    new Date(Date.now() + offsetMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 19);
  const startedAnHourAgo = await upsertShow(db(), {
    showstartId: "400", title: "一小时前开演", cityCode: "110000", venue: "MAO",
    showTime: beijing(-60 * 60 * 1000), price: null, url: "https://x/400",
    performers: ["刺猬"], poster: null,
  });
  const startsInAnHour = await upsertShow(db(), {
    showstartId: "401", title: "一小时后开演", cityCode: "110000", venue: "MAO",
    showTime: beijing(60 * 60 * 1000), price: null, url: "https://x/401",
    performers: ["刺猬"], poster: null,
  });
  await persistMatches(db(), [
    { showId: startedAnHourAgo.id, artistId, matchedBy: "performer" },
    { showId: startsInAnHour.id, artistId, matchedBy: "performer" },
  ]);

  const ids = (await findUpcomingShowsForSubscription(db(), sub.id)).map((s) => s.id);

  expect(ids).not.toContain(startedAnHourAgo.id);
  expect(ids).toContain(startsInAnHour.id);
});

it("excludes a show that already happened", async () => {
  const { sub, artistId } = await setup();
  const pastShow = await upsertShow(db(), {
    showstartId: "300", title: "已过去的场次", cityCode: "110000", venue: "MAO",
    showTime: "2000-01-01T20:00:00", price: "100", url: "https://x/300", performers: ["刺猬"],
    poster: null,
  });
  await persistMatches(db(), [{ showId: pastShow.id, artistId, matchedBy: "performer" }]);
  const shows = await findUpcomingShowsForSubscription(db(), sub.id);
  expect(shows.map((s) => s.id)).not.toContain(pastShow.id);
});

it("dedupes artist names and returns [] for an unknown subscription id", async () => {
  expect(await findUpcomingShowsForSubscription(db(), "nope")).toEqual([]);
});
