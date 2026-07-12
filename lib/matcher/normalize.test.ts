import { describe, it, expect } from "vitest";
import { normalizeName } from "./normalize";

describe("normalizeName", () => {
  it("lowercases and trims", () => {
    expect(normalizeName("  Radiohead  ")).toBe("radiohead");
  });
  it("collapses internal whitespace", () => {
    expect(normalizeName("New\t Order")).toBe("new order");
  });
  it("converts fullwidth to halfwidth", () => {
    expect(normalizeName("ＡＢＣ１２３")).toBe("abc123");
  });
  it("treats ideographic space as space", () => {
    expect(normalizeName("万能　青年")).toBe("万能 青年");
  });
});
