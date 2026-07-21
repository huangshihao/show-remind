import { describe, it, expect, vi } from "vitest";
import { withNeteaseRetry } from "./retry";
import { SubrequestBudget } from "@/lib/budget";

const noSleep = async () => {};

describe("withNeteaseRetry", () => {
  it("returns the result on first success without spending budget", async () => {
    const budget = new SubrequestBudget(5);
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withNeteaseRetry(fn, budget, { sleepFn: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(budget.remaining()).toBe(5); // no retry → no extra subrequest spent
  });

  it("retries a transient failure and then succeeds, spending one budget unit per retry", async () => {
    const budget = new SubrequestBudget(5);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("netease risk-control code=-460"))
      .mockResolvedValue("ok");
    await expect(withNeteaseRetry(fn, budget, { sleepFn: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(budget.remaining()).toBe(4); // the one retry cost one subrequest
  });

  it("throws the last error after exhausting its retries", async () => {
    const budget = new SubrequestBudget(10);
    const fn = vi.fn().mockRejectedValue(new Error("netease risk-control code=-460"));
    await expect(
      withNeteaseRetry(fn, budget, { retries: 2, sleepFn: noSleep }),
    ).rejects.toThrow("code=-460");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("stops retrying (and throws) when the budget cannot cover another attempt", async () => {
    const budget = new SubrequestBudget(1);
    budget.tryTake(1); // no room left for a retry
    const fn = vi.fn().mockRejectedValue(new Error("netease risk-control code=-460"));
    await expect(
      withNeteaseRetry(fn, budget, { retries: 3, sleepFn: noSleep }),
    ).rejects.toThrow("code=-460");
    expect(fn).toHaveBeenCalledTimes(1); // budget refused the retry, so no second call
  });
});
