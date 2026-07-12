import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { upsertArtist } from "./artists";
import { filterNewShowstartIds, upsertShow } from "./shows";
import { persistMatches } from "./matches";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe("artists repo", () => {
  it("dedupes by normalized name", async () => {
    const n = `万能青年旅店_${uid()}`;
    const a = await upsertArtist(`  ${n}  `);
    const b = await upsertArtist(n);
    expect(b.id).toBe(a.id);
    expect(a.normalizedName).toBe(n.toLowerCase());
  });
});

describe("shows repo", () => {
  it("filters out showstartIds already stored", async () => {
    const sid = `S_${uid()}`;
    await upsertShow({
      showstartId: sid, title: "T", cityCode: "310000", venue: null,
      showTime: "2026-08-01T20:00:00", price: "100", url: "http://x", performers: ["万能青年旅店"],
    });
    const missing = `S_${uid()}`;
    const result = await filterNewShowstartIds([sid, missing]);
    expect(result).toEqual([missing]);
  });

  it("upsert is idempotent on showstartId", async () => {
    const sid = `S_${uid()}`;
    const base = { showstartId: sid, title: "T", cityCode: "310000", venue: null,
      showTime: null, price: null, url: "http://x", performers: [] };
    const a = await upsertShow(base);
    const b = await upsertShow({ ...base, title: "T2" });
    expect(b.id).toBe(a.id);
  });
});

describe("matches repo", () => {
  it("persists show_artists and is dedup-safe", async () => {
    const artist = await upsertArtist(`A_${uid()}`);
    const show = await upsertShow({
      showstartId: `S_${uid()}`, title: "T", cityCode: "310000", venue: null,
      showTime: null, price: null, url: "http://x", performers: [],
    });
    const m = [{ showId: show.id, artistId: artist.id, matchedBy: "performer" as const }];
    const created = await persistMatches(m);
    expect(created).toBe(1);
    const again = await persistMatches(m);
    expect(again).toBe(0);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
