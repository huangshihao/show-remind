import { it, expect } from "vitest";
import { showstartCityId } from "./cities";

it("maps行政区码 to Showstart internal city id", () => {
  expect(showstartCityId("110000")).toBe(10); // 北京
  expect(showstartCityId("420100")).toBe(27); // 武汉
  expect(showstartCityId("310000")).toBe(21); // 上海
});

it("returns undefined for an unknown city or one without a pinned Showstart id", () => {
  expect(showstartCityId("000000")).toBeUndefined();
  expect(showstartCityId("440300")).toBeUndefined(); // 深圳: id not confirmed yet
});
