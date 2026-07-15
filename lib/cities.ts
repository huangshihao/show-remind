export interface City {
  code: string; // 行政区码 (what subscriptions store and the notify filter uses)
  name: string;
  // Showstart's city id for /app/activity/search — NOT the 行政区码 (北京 is 10,
  // not 110000). It is the city's telephone 区号 with the leading zero stripped:
  // 北京 010 -> 10, 上海 021 -> 21, 深圳 0755 -> 755, 杭州 0571 -> 571.
  //
  // This was previously believed to be an opaque internal enum that could only be
  // discovered by probing, so the 22 cities below whose ids nobody had probed sat
  // uncrawlable — fetchCityShows returned [] for them forever, and 深圳/杭州 (two
  // of the largest live music markets) silently never produced a single show.
  // Every id here is verified against the live search API. Showstart's own
  // /app/common/city endpoint still 500s, which is why the map stays pinned.
  showstartId: number;
}

// 4 municipalities + all provincial capitals + 深圳. 行政区码 per GB/T 2260
// (capital = province prefix + 0100).
export const CITIES: City[] = [
  { code: "110000", name: "北京", showstartId: 10 },
  { code: "120000", name: "天津", showstartId: 22 },
  { code: "310000", name: "上海", showstartId: 21 },
  { code: "500000", name: "重庆", showstartId: 23 },
  { code: "440100", name: "广州", showstartId: 20 },
  { code: "440300", name: "深圳", showstartId: 755 },
  { code: "320100", name: "南京", showstartId: 25 },
  { code: "330100", name: "杭州", showstartId: 571 },
  { code: "420100", name: "武汉", showstartId: 27 },
  { code: "510100", name: "成都", showstartId: 28 },
  { code: "610100", name: "西安", showstartId: 29 },
  { code: "210100", name: "沈阳", showstartId: 24 },
  { code: "130100", name: "石家庄", showstartId: 311 },
  { code: "140100", name: "太原", showstartId: 351 },
  { code: "150100", name: "呼和浩特", showstartId: 471 },
  { code: "220100", name: "长春", showstartId: 431 },
  { code: "230100", name: "哈尔滨", showstartId: 451 },
  { code: "340100", name: "合肥", showstartId: 551 },
  { code: "350100", name: "福州", showstartId: 591 },
  { code: "360100", name: "南昌", showstartId: 791 },
  { code: "370100", name: "济南", showstartId: 531 },
  { code: "410100", name: "郑州", showstartId: 371 },
  { code: "430100", name: "长沙", showstartId: 731 },
  { code: "450100", name: "南宁", showstartId: 771 },
  { code: "460100", name: "海口", showstartId: 898 },
  { code: "520100", name: "贵阳", showstartId: 851 },
  { code: "530100", name: "昆明", showstartId: 871 },
  { code: "540100", name: "拉萨", showstartId: 891 },
  { code: "620100", name: "兰州", showstartId: 931 },
  { code: "630100", name: "西宁", showstartId: 971 },
  { code: "640100", name: "银川", showstartId: 951 },
  { code: "650100", name: "乌鲁木齐", showstartId: 991 },
];

// 行政区码 → Showstart city id. undefined only for a code that isn't a city we
// support; every supported city has an id.
export function showstartCityId(code: string): number | undefined {
  return CITIES.find((c) => c.code === code)?.showstartId;
}

// Every city in CITIES is crawlable — City.showstartId is required, so a city
// that can't be reached can't be added to the list without a type error. The
// crawler sweeps all of them, which is what lets a user add a city and match
// against shows that are already stored.
export function crawlableCityCodes(): string[] {
  return CITIES.map((c) => c.code);
}
