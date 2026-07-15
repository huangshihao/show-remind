import { afterEach, expect, it, vi } from "vitest";
import { importPlaylist } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("posts the link to the manage import route with the token in the query", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ added: 2, artists: [{ id: "a1", name: "刺猬" }] }), {
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const res = await importPlaylist("https://music.163.com/playlist?id=1", "tok-123");

  expect(res.added).toBe(2);
  expect(res.artists).toEqual([{ id: "a1", name: "刺猬" }]);
  const [url, init] = fetchMock.mock.calls[0] as any;
  expect(url).toBe("/api/manage/import?token=tok-123");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({ link: "https://music.163.com/playlist?id=1" });
});

it("surfaces the server error message instead of a generic failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ error: "歌单解析失败，请稍后重试" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    }),
  ));

  await expect(importPlaylist("https://x/1", "tok")).rejects.toThrow("歌单解析失败，请稍后重试");
});
