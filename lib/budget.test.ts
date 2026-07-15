import { describe, it, expect } from "vitest";
import { SubrequestBudget, EXTERNAL_SUBREQUEST_BUDGET } from "./budget";

describe("SubrequestBudget", () => {
  it("hands out the configured number of takes, then refuses", () => {
    const b = new SubrequestBudget(3);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.remaining()).toBe(1);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
    expect(b.remaining()).toBe(0);
  });

  it("a refused take spends nothing (all-or-nothing for multi-take)", () => {
    const b = new SubrequestBudget(3);
    expect(b.tryTake(2)).toBe(true);
    expect(b.tryTake(2)).toBe(false); // only 1 left
    expect(b.remaining()).toBe(1);
    expect(b.tryTake(1)).toBe(true);
  });

  it("default budget leaves headroom under the 50-external free-plan cap", () => {
    expect(EXTERNAL_SUBREQUEST_BUDGET).toBeLessThan(50);
    expect(new SubrequestBudget().remaining()).toBe(EXTERNAL_SUBREQUEST_BUDGET);
  });
});
