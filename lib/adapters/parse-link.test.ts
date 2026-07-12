import { describe, it, expect, vi } from "vitest";
import { parsePlaylistLink, InvalidPlaylistLinkError } from "./parse-link";

describe("parsePlaylistLink", () => {
  it("parses netease full share link", async () => {
    const r = await parsePlaylistLink("https://music.163.com/playlist?id=123456&userid=1");
    expect(r).toEqual({ platform: "netease", externalId: "123456" });
  });
  it("parses netease /#/ hash link and app share text", async () => {
    const r = await parsePlaylistLink("分享歌单: https://music.163.com/#/playlist?id=789");
    expect(r).toEqual({ platform: "netease", externalId: "789" });
  });
  it("parses qq share link with id param", async () => {
    const r = await parsePlaylistLink("https://y.qq.com/n/ryqq/playlist/9527");
    expect(r).toEqual({ platform: "qq", externalId: "9527" });
  });
  it("parses qq link with ?id=", async () => {
    const r = await parsePlaylistLink("https://i.y.qq.com/n2/m/share/details/taoge.html?id=8888");
    expect(r).toEqual({ platform: "qq", externalId: "8888" });
  });
  it("throws on unrecognized input", async () => {
    await expect(parsePlaylistLink("https://example.com/x")).rejects.toBeInstanceOf(
      InvalidPlaylistLinkError,
    );
  });
});
