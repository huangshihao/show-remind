import { expect, it } from "vitest";
import { validCities, isEmail, MAX_CITIES } from "../../src/services/limits";

it("accepts known non-empty city sets within the cap", () => {
  expect(validCities(["110000"])).toBe(true);
  expect(validCities([])).toBe(false);
  expect(validCities(["999999"])).toBe(false);
  expect(validCities(Array(MAX_CITIES + 1).fill("110000"))).toBe(false);
});

it("isEmail validates basic shape", () => {
  expect(isEmail("a@b.com")).toBe(true);
  expect(isEmail("nope")).toBe(false);
});
