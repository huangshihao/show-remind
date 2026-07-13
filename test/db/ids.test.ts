import { expect, it } from "vitest";
import { newId, newToken } from "../../src/db/ids";

it("newId returns a uuid", () => {
  expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(newId()).not.toBe(newId());
});

it("newToken returns 64 hex chars and is unique", () => {
  const t = newToken();
  expect(t).toMatch(/^[0-9a-f]{64}$/);
  expect(newToken()).not.toBe(t);
});
