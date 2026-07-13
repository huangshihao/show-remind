import { expect, it, vi } from "vitest";
import { resendProvider, consoleProvider } from "../../src/mail/provider";

it("resendProvider POSTs to Resend with auth + payload", async () => {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ id: "x" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const p = resendProvider("re_key", "Show <n@d.com>");
  await p.send({ to: "u@d.com", subject: "hi", html: "<b>hi</b>" });
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer re_key" });
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body).toMatchObject({ from: "Show <n@d.com>", to: "u@d.com", subject: "hi" });
  vi.unstubAllGlobals();
});

it("resendProvider throws on non-2xx", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 422 })));
  await expect(resendProvider("k", "f").send({ to: "u", subject: "s", html: "h" })).rejects.toThrow();
  vi.unstubAllGlobals();
});

it("consoleProvider resolves without throwing", async () => {
  await expect(consoleProvider().send({ to: "u", subject: "s", html: "h" })).resolves.toBeUndefined();
});
