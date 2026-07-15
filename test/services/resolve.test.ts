import { afterEach, expect, it, vi } from "vitest";
import { resolvePlaylist } from "../../src/services/resolve";
import { SubrequestBudget } from "@/lib/budget";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// One 3-artist netease playlist; head-info responses keyed by requested id.
function stubNetease() {
  const headInfoIds: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/api/v6/playlist/detail")) {
        return new Response(JSON.stringify({ playlist: { name: "N", trackIds: [{ id: 1 }] } }));
      }
      if (url.includes("/api/v3/song/detail")) {
        return new Response(
          JSON.stringify({
            songs: [
              {
                id: 1,
                name: "s",
                ar: [
                  { id: 11, name: "甲" },
                  { id: 22, name: "乙" },
                  { id: 33, name: "丙" },
                ],
              },
            ],
          }),
        );
      }
      const m = url.match(/head\/info\/get\?id=(\d+)/);
      if (m) {
        headInfoIds.push(m[1]);
        return new Response(
          JSON.stringify({ data: { artist: { avatar: `https://p2.music.126.net/${m[1]}.jpg` } } }),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return headInfoIds;
}

it("netease avatar lookups only spend what's left of the invocation budget", async () => {
  const headInfoIds = stubNetease();
  // budget 4 = playlist detail (1) + song batch (1) + only 2 avatar lookups
  const r = await resolvePlaylist("https://music.163.com/#/playlist?id=9", new SubrequestBudget(4));
  expect(headInfoIds).toHaveLength(2);
  expect(r.artists.filter((a) => a.avatar).length).toBe(2);
  expect(r.artists.filter((a) => a.avatar === null).length).toBe(1);
});

it("with a roomy budget every artist gets a lookup", async () => {
  const headInfoIds = stubNetease();
  const r = await resolvePlaylist("https://music.163.com/#/playlist?id=9", new SubrequestBudget(45));
  expect(headInfoIds).toHaveLength(3);
  expect(r.artists.every((a) => a.avatar)).toBe(true);
});
