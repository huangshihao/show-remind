import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "../db/apply-schema";
import { backfillAvatars } from "../../src/services/avatar-backfill";
import { upsertArtist, getAllArtists } from "../../src/db/artists";
import * as showstart from "@/lib/sources/showstart";
import * as netease from "@/lib/adapters/netease";
import { SubrequestBudget } from "@/lib/budget";

beforeEach(applySchema);
afterEach(() => vi.restoreAllMocks());

it("stops looking up avatars when the budget runs out; the rest stay pending for the next load", async () => {
  const a = await upsertArtist(env.DB, "甲");
  const b = await upsertArtist(env.DB, "乙");
  const c = await upsertArtist(env.DB, "丙");
  const spy = vi
    .spyOn(showstart, "searchArtistStrict")
    .mockResolvedValue({ id: 1, name: "x", avatar: "https://s2.showstart.com/x.jpg", fansNum: 1 });

  await backfillAvatars(env.DB, [a, b, c], new SubrequestBudget(2));

  expect(spy).toHaveBeenCalledTimes(2);
  const rows = await getAllArtists(env.DB);
  expect(rows.filter((r) => r.avatar === "https://s2.showstart.com/x.jpg").length).toBe(2);
  expect(rows.filter((r) => r.avatar === null).length).toBe(1); // pending, retried later
});

it("the netease-miss → Showstart fallback needs a second budget take; without one it stops cleanly", async () => {
  const artist = await upsertArtist(env.DB, "查无照片", null, "40404");
  vi.spyOn(netease, "fetchArtistAvatar").mockResolvedValue(null); // definitive: profile has no photo
  const showstartSpy = vi.spyOn(showstart, "searchArtistStrict");

  await backfillAvatars(env.DB, [artist], new SubrequestBudget(1));

  // The one budgeted fetch went to netease; the fallback search was refused.
  expect(showstartSpy).not.toHaveBeenCalled();
  const row = (await getAllArtists(env.DB))[0];
  expect(row.avatar).toBeNull(); // still pending — Showstart gets its shot next load
  expect(row.neteaseId).toBeNull(); // but the definitive netease answer is recorded
});
