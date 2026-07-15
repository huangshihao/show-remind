import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import type { Env } from "../../src/env";
import { applySchema } from "../db/apply-schema";
import { maybeAlertAdmin, ALERT_AFTER_FAILURES } from "../../src/pipeline/admin-alert";
import * as provider from "../../src/mail/provider";

beforeEach(applySchema);

const CITIES = ["110000", "310000", "420100"];
const typedEnv = { ...env, ADMIN_EMAIL: "admin@test.local" } as unknown as Env;

// Capture what would be mailed rather than asserting on the console provider.
interface Sent {
  to: string;
  subject: string;
  html: string;
}
function captureMail() {
  const send = vi.fn(async (_msg: Sent) => {});
  vi.spyOn(provider, "getMailProvider").mockReturnValue({ send } as any);
  return send;
}

// Run the alerter over N runs where `failed` is the same each time.
async function runs(n: number, failed: string[], e: Env = typedEnv) {
  let last = false;
  for (let i = 0; i < n; i++) last = await maybeAlertAdmin(env.DB, e, failed, CITIES);
  return last;
}

it("does not alert on a single transient failure", async () => {
  const send = captureMail();
  expect(await runs(1, ["310000"])).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

// The whole point. The old rule only counted a run where EVERY city failed, so
// one city broken forever was invisible among 32 healthy ones.
it("alerts when one city keeps failing while the rest are healthy", async () => {
  const send = captureMail();
  expect(await runs(ALERT_AFTER_FAILURES, ["310000"])).toBe(true);
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][0].html).toContain("310000");
});

// The old code reset the counter whenever any city succeeded, so 31 of 32 cities
// could fail every run forever and the streak never moved off zero.
it("a healthy city does not reset a broken city's streak", async () => {
  const send = captureMail();
  for (let i = 0; i < ALERT_AFTER_FAILURES; i++) {
    // 110000 flaps between healthy and failing; 310000 is broken throughout.
    await maybeAlertAdmin(env.DB, typedEnv, i % 2 === 0 ? ["310000", "110000"] : ["310000"], CITIES);
  }
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][0].html).toContain("310000");
});

it("stops counting once a city recovers", async () => {
  const send = captureMail();
  await runs(ALERT_AFTER_FAILURES - 1, ["310000"]);
  await maybeAlertAdmin(env.DB, typedEnv, [], CITIES); // recovered
  expect(await runs(ALERT_AFTER_FAILURES - 1, ["310000"])).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

// A broken city must not mail every single run for the rest of time.
it("does not repeat the alert on every run while a city stays broken", async () => {
  const send = captureMail();
  await runs(ALERT_AFTER_FAILURES + 3, ["310000"]);
  expect(send).toHaveBeenCalledOnce();
});

// Production had no ADMIN_EMAIL set, so this function could never mail at all —
// it counted diligently to 3 and returned false every time.
it("returns false when no admin address is configured", async () => {
  const send = captureMail();
  const noAddr = { ...env, ADMIN_EMAIL: "" } as unknown as Env;
  expect(await runs(ALERT_AFTER_FAILURES + 2, ["310000"], noAddr)).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
