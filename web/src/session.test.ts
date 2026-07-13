import { beforeEach, expect, it } from "vitest";
import { clearToken, getStoredToken, storeToken } from "./session";

beforeEach(() => localStorage.clear());

it("returns null when nothing is stored", () => {
  expect(getStoredToken()).toBeNull();
});

it("stores and retrieves a token", () => {
  storeToken("abc123");
  expect(getStoredToken()).toBe("abc123");
});

it("clears a stored token", () => {
  storeToken("abc123");
  clearToken();
  expect(getStoredToken()).toBeNull();
});
