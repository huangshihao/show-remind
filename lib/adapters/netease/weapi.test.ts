import { describe, it, expect } from "vitest";
import { weapi } from "./weapi";

describe("weapi", () => {
  it("is deterministic given a fixed secret key", () => {
    const a = weapi({ id: "123", n: 100000 }, "1234567890123456");
    const b = weapi({ id: "123", n: 100000 }, "1234567890123456");
    expect(a).toEqual(b);
    expect(a.params).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(a.encSecKey).toHaveLength(256);
  });

  it("produces different params for different payloads", () => {
    const a = weapi({ id: "1" }, "1234567890123456");
    const b = weapi({ id: "2" }, "1234567890123456");
    expect(a.params).not.toBe(b.params);
  });
});
