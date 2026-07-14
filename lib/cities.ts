export interface City {
  code: string; // 行政区码 (what subscriptions store and the notify filter uses)
  name: string;
  // Showstart's INTERNAL city id, required by /app/activity/search (北京=10, NOT
  // the行政区码 110000). Confirmed by probing the live search API. Showstart's
  // own /app/common/city map endpoint (which would give these dynamically) is
  // currently returning server errors, so known ids are pinned here; ids are
  // stable. A city WITHOUT a showstartId is selectable but not yet crawled
  // (fetchCityShows skips it) — fill the id in to enable its shows.
  showstartId?: number;
}

// 4 municipalities + all provincial capitals + 深圳. 行政区码 per GB/T 2260
// (capital = province prefix + 0100). showstartId filled where confirmed.
export const CITIES: City[] = [
  { code: "110000", name: "北京", showstartId: 10 },
  { code: "120000", name: "天津", showstartId: 22 },
  { code: "310000", name: "上海", showstartId: 21 },
  { code: "500000", name: "重庆", showstartId: 23 },
  { code: "440100", name: "广州", showstartId: 20 },
  { code: "440300", name: "深圳" },
  { code: "320100", name: "南京", showstartId: 25 },
  { code: "330100", name: "杭州" },
  { code: "420100", name: "武汉", showstartId: 27 },
  { code: "510100", name: "成都", showstartId: 28 },
  { code: "610100", name: "西安", showstartId: 29 },
  { code: "210100", name: "沈阳", showstartId: 24 },
  { code: "130100", name: "石家庄" },
  { code: "140100", name: "太原" },
  { code: "150100", name: "呼和浩特" },
  { code: "220100", name: "长春" },
  { code: "230100", name: "哈尔滨" },
  { code: "340100", name: "合肥" },
  { code: "350100", name: "福州" },
  { code: "360100", name: "南昌" },
  { code: "370100", name: "济南" },
  { code: "410100", name: "郑州" },
  { code: "430100", name: "长沙" },
  { code: "450100", name: "南宁" },
  { code: "460100", name: "海口" },
  { code: "520100", name: "贵阳" },
  { code: "530100", name: "昆明" },
  { code: "540100", name: "拉萨" },
  { code: "620100", name: "兰州" },
  { code: "630100", name: "西宁" },
  { code: "640100", name: "银川" },
  { code: "650100", name: "乌鲁木齐" },
];

// 行政区码 → Showstart internal city id. undefined for an unknown city or one
// whose Showstart id isn't pinned yet.
export function showstartCityId(code: string): number | undefined {
  return CITIES.find((c) => c.code === code)?.showstartId;
}
