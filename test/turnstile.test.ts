import { expect, it, vi } from "vitest";
import { verifyTurnstile } from "../src/turnstile";

it("returns true when siteverify succeeds", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }))));
  expect(await verifyTurnstile("tok", "secret")).toBe(true);
  vi.unstubAllGlobals();
});

it("returns false when siteverify fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }))));
  expect(await verifyTurnstile("tok", "secret")).toBe(false);
  vi.unstubAllGlobals();
});
