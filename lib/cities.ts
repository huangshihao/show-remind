export interface City {
  code: string; // 行政区码 (what subscriptions store and the notify filter uses)
  name: string;
  // Showstart's INTERNAL city id, required by /app/activity/search (北京=10, NOT
  // the行政区码 110000). Confirmed by probing the live search API. Showstart's
  // own /app/common/city map endpoint (which would give these dynamically) is
  // currently returning server errors, so these are pinned here; ids are stable.
  // 深圳/杭州 ids are not yet confirmed — a city without one is skipped by the
  // crawler (see fetchCityShows) rather than crawled against the wrong id.
  showstartId?: number;
}

export const CITIES: City[] = [
  { code: "110000", name: "北京", showstartId: 10 },
  { code: "310000", name: "上海", showstartId: 21 },
  { code: "440100", name: "广州", showstartId: 20 },
  { code: "440300", name: "深圳" },
  { code: "330100", name: "杭州" },
  { code: "510100", name: "成都", showstartId: 28 },
  { code: "500000", name: "重庆", showstartId: 23 },
  { code: "420100", name: "武汉", showstartId: 27 },
  { code: "610100", name: "西安", showstartId: 29 },
  { code: "320100", name: "南京", showstartId: 25 },
];

// 行政区码 → Showstart internal city id. undefined for an unknown city or one
// whose Showstart id isn't pinned yet.
export function showstartCityId(code: string): number | undefined {
  return CITIES.find((c) => c.code === code)?.showstartId;
}
