import { describe, it, expect, vi, afterEach } from "vitest";
import * as mailer from "./mailer";
import { maybeAlertAdmin } from "./admin-alert";

afterEach(() => vi.restoreAllMocks());

// Deviation from brief: vitest.config.ts does not load .env, so
// ADMIN_ALERT_EMAIL is unset in the test process by default. Set it here
// so the "alerts on 3rd failure" case exercises the real send path instead
// of short-circuiting on a missing admin address.
process.env.ADMIN_ALERT_EMAIL ??= "admin@show-remind.local";

describe("maybeAlertAdmin", () => {
  it("alerts on the 3rd consecutive full failure", async () => {
    const spy = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    expect(await maybeAlertAdmin(["310000"], 1, 3)).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });
  it("does not alert before 3 or on partial failure", async () => {
    const spy = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    expect(await maybeAlertAdmin(["310000"], 1, 2)).toBe(false);
    expect(await maybeAlertAdmin([], 2, 5)).toBe(false); // no failed cities -> not a full failure
    expect(spy).not.toHaveBeenCalled();
  });
});
