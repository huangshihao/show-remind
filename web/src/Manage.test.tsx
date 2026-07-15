import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImportPlaylist } from "./Manage";

// vitest.web.config.ts doesn't set `test.globals: true`, so
// @testing-library/react's auto-cleanup (which only registers when
// `afterEach` is a global) never fires. Do it explicitly, or renders from
// one test leak into the next.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cfg = { cities: [], publicMode: false, turnstileSiteKey: "" };

it("imports a playlist and reports how many artists were added", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ added: 3, artists: [{ id: "a1", name: "刺猬" }] }), {
      headers: { "content-type": "application/json" },
    }),
  ));
  const onImported = vi.fn();
  render(<ImportPlaylist token="tok" config={cfg} onImported={onImported} />);

  fireEvent.change(screen.getByPlaceholderText(/粘贴另一个歌单链接/), {
    target: { value: "https://music.163.com/playlist?id=1" },
  });
  fireEvent.click(screen.getByText("导入"));

  await waitFor(() => expect(screen.getByText(/新增 3 位音乐人/)).toBeTruthy());
  expect(onImported).toHaveBeenCalledWith([{ id: "a1", name: "刺猬" }]);
});

it("resets the turnstile widget after a successful import, so a second playlist can be imported", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ added: 1, artists: [{ id: "a2", name: "万能青年旅店" }] }), {
      headers: { "content-type": "application/json" },
    }),
  ));
  const reset = vi.fn();
  vi.stubGlobal("turnstile", { reset });
  render(<ImportPlaylist token="tok" config={cfg} onImported={vi.fn()} />);

  fireEvent.change(screen.getByPlaceholderText(/粘贴另一个歌单链接/), {
    target: { value: "https://music.163.com/playlist?id=2" },
  });
  fireEvent.click(screen.getByText("导入"));

  await waitFor(() => expect(screen.getByText(/新增 1 位音乐人/)).toBeTruthy());
  expect(reset).toHaveBeenCalledWith();
});

it("shows the server's error message when the import fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ error: "歌单解析失败，请稍后重试" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    }),
  ));
  render(<ImportPlaylist token="tok" config={cfg} onImported={vi.fn()} />);

  fireEvent.change(screen.getByPlaceholderText(/粘贴另一个歌单链接/), {
    target: { value: "https://music.163.com/playlist?id=1" },
  });
  fireEvent.click(screen.getByText("导入"));

  await waitFor(() => expect(screen.getByText(/歌单解析失败/)).toBeTruthy());
});
