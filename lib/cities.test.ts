import { it, expect } from "vitest";
import { showstartCityId, CITIES, crawlableCityCodes } from "./cities";

it("maps行政区码 to Showstart internal city id", () => {
  expect(showstartCityId("110000")).toBe(10); // 北京
  expect(showstartCityId("420100")).toBe(27); // 武汉
  expect(showstartCityId("310000")).toBe(21); // 上海
});

it("returns undefined for an unknown city", () => {
  expect(showstartCityId("000000")).toBeUndefined();
});

// Showstart's cityId is the city's telephone area code with the leading zero
// stripped (北京 010 -> 10, 深圳 0755 -> 755), verified against the live search
// API for every city in the list. 深圳/杭州 were previously believed unknowable
// and were silently uncrawlable — both are major live music markets.
it("maps the cities whose ids were once thought unknowable", () => {
  expect(showstartCityId("440300")).toBe(755); // 深圳
  expect(showstartCityId("330100")).toBe(571); // 杭州
});

it("can crawl every city it offers — no city is a dead end", () => {
  expect(crawlableCityCodes().length).toBe(CITIES.length);
  expect(CITIES.length).toBe(32);
});
