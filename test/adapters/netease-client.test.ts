import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchPlaylistDetailRaw,
  fetchSongDetailRaw,
} from "../../lib/adapters/netease/client";

describe("netease plaintext client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchPlaylistDetailRaw POSTs to the playlist detail endpoint and returns parsed JSON", async () => {
    const mockResponse = { code: 200, playlist: { name: "x" } };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPlaylistDetailRaw("123");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://music.163.com/api/v6/playlist/detail");
    expect(options.method).toBe("POST");
    expect(result).toEqual(mockResponse);
  });

  it("fetchSongDetailRaw POSTs to the song detail endpoint and returns parsed JSON", async () => {
    const mockResponse = { code: 200, songs: [{ id: "1" }, { id: "2" }] };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSongDetailRaw(["1", "2"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://music.163.com/api/v3/song/detail");
    expect(options.method).toBe("POST");
    expect(result).toEqual(mockResponse);
  });

  it("throws when fetch resolves a non-ok response (status 500)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("error", { status: 500 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPlaylistDetailRaw("123")).rejects.toThrow(
      /netease.*status=500/
    );
  });

  it("throws when fetch resolves ok but with an empty body (Cloudflare soft-block case)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPlaylistDetailRaw("123")).rejects.toThrow(
      /netease.*status=200.*len=0/
    );
  });

  it("throws when response body is non-JSON (e.g., HTML anti-bot page)", async () => {
    const htmlBody = "<html><body>blocked</body></html>";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(htmlBody, { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPlaylistDetailRaw("123")).rejects.toThrow(
      /netease.*non-JSON.*status=200/
    );
  });
});
