import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchQqPlaylist } from "@/lib/sources/qq";
import { resolveQqPlaylist } from "./qq";

vi.mock("@/lib/sources/qq", () => ({ fetchQqPlaylist: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe("resolveQqPlaylist", () => {
  it("maps qq playlist to ResolvedPlaylist", async () => {
    vi.mocked(fetchQqPlaylist).mockResolvedValue({
      title: "摇滚",
      songs: [{ name: "s", artists: ["万能青年旅店", "客座"] }],
    });
    const r = await resolveQqPlaylist("42");
    expect(r).toEqual({
      platform: "qq",
      externalId: "42",
      title: "摇滚",
      songs: [{ name: "s", artists: ["万能青年旅店", "客座"] }],
    });
  });
});
