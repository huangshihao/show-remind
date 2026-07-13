import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "./apply-schema";
import { createPendingSubscription } from "../../src/db/subscriptions";
import { setArtistAvatar } from "../../src/db/artists";
import {
  setArtists,
  addArtistToSubscription,
  removeArtist,
  listArtists,
  countArtists,
} from "../../src/db/subscription-artists";

beforeEach(applySchema);
const db = () => env.DB;

async function sub() {
  return createPendingSubscription(db(), "a@b.com", ["110000"]);
}

it("setArtists replaces the follow set", async () => {
  const s = await sub();
  await setArtists(db(), s.id, ["海龟先生", "刺猬"]);
  expect((await listArtists(db(), s.id)).map((a) => a.name).sort()).toEqual(["刺猬", "海龟先生"]);
  await setArtists(db(), s.id, ["达达"]);
  expect((await listArtists(db(), s.id)).map((a) => a.name)).toEqual(["达达"]);
});

it("listArtists returns the cached avatar (null until looked up)", async () => {
  const s = await sub();
  const id = await addArtistToSubscription(db(), s.id, "刺猬");
  expect((await listArtists(db(), s.id))[0].avatar).toBeNull();
  await setArtistAvatar(db(), id, "https://s2.showstart.com/img/2503.jpg");
  expect((await listArtists(db(), s.id))[0].avatar).toBe("https://s2.showstart.com/img/2503.jpg");
});

it("add is idempotent and remove works; count reflects state", async () => {
  const s = await sub();
  const id1 = await addArtistToSubscription(db(), s.id, "刺猬");
  const id2 = await addArtistToSubscription(db(), s.id, "刺猬");
  expect(id1).toBe(id2);
  expect(await countArtists(db(), s.id)).toBe(1);
  await removeArtist(db(), s.id, id1);
  expect(await countArtists(db(), s.id)).toBe(0);
});
