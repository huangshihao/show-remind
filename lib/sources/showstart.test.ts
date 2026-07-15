import { describe, it, expect, vi, afterEach } from "vitest";
import {
  normalizeShowTime,
  transformShowList,
  transformShowDetail,
  transformArtistSearch,
  searchArtist,
  searchArtistStrict,
  fetchCityShows,
  ShowstartClient,
  SORT_NEWEST_FIRST,
} from "./showstart";

describe("normalizeShowTime", () => {
  it("parses Chinese show-time strings to ISO", () => {
    expect(normalizeShowTime("2026.07.12 本周日 20:00")).toBe("2026-07-12T20:00:00");
    expect(normalizeShowTime("2026.08.15 周六 20:30")).toBe("2026-08-15T20:30:00");
  });
  it("returns null for empty or unparseable input", () => {
    expect(normalizeShowTime(null)).toBeNull();
    expect(normalizeShowTime(undefined)).toBeNull();
    expect(normalizeShowTime("待定")).toBeNull();
  });
});

const LIST_RAW = {
  state: "1",
  success: true,
  result: {
    activityInfo: [
      {
        activityId: 299995,
        title: "尹毓恪「春日海啸」2026巡演 北京站",
        cityId: "10",
        siteName: "菇的LIVE·蘑菇洞",
        showTime: "2026.07.12 本周日 20:00",
        activityPrice: "¥150起",
        avatar: "https://s2.showstart.com/list/299995.jpg?imageView2/1/w/200",
      },
      { activityId: 100002, title: "重塑雕像的权利 北京站", cityId: "10", showTime: "2026.08.15 周六 20:30" },
    ],
  },
};

describe("transformShowList", () => {
  it("maps activityInfo rows to ShowSummary", () => {
    const { shows } = transformShowList(LIST_RAW, "10");
    expect(shows).toHaveLength(2);
    expect(shows[0]).toEqual({
      showstartId: "299995",
      title: "尹毓恪「春日海啸」2026巡演 北京站",
      cityCode: "10",
      showTime: "2026-07-12T20:00:00",
      url: "https://wap.showstart.com/pages/activity/detail/detail?activityId=299995",
      poster: "https://s2.showstart.com/list/299995.jpg?imageView2/1/w/200",
    });
  });
  it("falls back to the passed cityCode when a row has no cityId", () => {
    const raw = { result: { activityInfo: [{ activityId: 1, title: "x" }] } };
    expect(transformShowList(raw, "20").shows[0].cityCode).toBe("20");
  });
  it("returns poster: null when a row has no avatar", () => {
    const raw = { result: { activityInfo: [{ activityId: 100002, title: "x" }] } };
    expect(transformShowList(raw, "10").shows[0].poster).toBeNull();
  });
  it("returns empty shows for a missing result", () => {
    expect(transformShowList({}, "10").shows).toEqual([]);
  });
});

describe("fetchCityShows", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("translates the行政区码 to the Showstart internal id and requests isHome:0", async () => {
    const spy = vi
      .spyOn(ShowstartClient.prototype, "fetchCityShowsRaw")
      .mockResolvedValue(LIST_RAW);
    await fetchCityShows("110000", 1); // 北京行政区码 -> Showstart id 10
    expect(spy).toHaveBeenCalledWith("10", 1);
  });

  it("stamps the crawled行政区码 on every show (not Showstart's internal cityId)", async () => {
    vi.spyOn(ShowstartClient.prototype, "fetchCityShowsRaw").mockResolvedValue(LIST_RAW);
    const { shows } = await fetchCityShows("110000", 1);
    expect(shows.length).toBeGreaterThan(0);
    expect(shows.every((s) => s.cityCode === "110000")).toBe(true);
  });

  it("returns no shows and never calls the API for an unknown city code", async () => {
    const spy = vi
      .spyOn(ShowstartClient.prototype, "fetchCityShowsRaw")
      .mockResolvedValue(LIST_RAW);
    expect((await fetchCityShows("000000", 1)).shows).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  // The default sort is by show date, which buries a newly-announced far-future
  // show tens of pages deep — the crawler would not see it until its date drew
  // near, by which point tickets may be gone. sortType 2 orders by publication
  // recency instead (verified live: 5 pages of sortType 2 span ~1.3k activityIds
  // vs ~35k for the default), so newly announced shows surface on page 1.
  it("asks Showstart for the most recently published shows, not the soonest", async () => {
    const spy = vi
      .spyOn(ShowstartClient.prototype, "request" as any)
      .mockResolvedValue(LIST_RAW);

    await fetchCityShows("110000", 1);

    const body = JSON.parse((spy.mock.calls[0] as any[])[2]);
    expect(body.sortType).toBe(SORT_NEWEST_FIRST);
    expect(body.cityId).toBe(10);
    expect(body.isHome).toBe(0);
  });
});

const DETAIL_RAW = {
  state: "1",
  success: true,
  result: {
    activityId: 299995,
    title: "尹毓恪「春日海啸」2026巡演 北京站 北京 菇的LIVE·蘑菇洞",
    activityName: "尹毓恪「春日海啸」2026巡演 北京站",
    cityId: "10",
    showTime: "2026.07.12 本周日 20:00",
    price: "¥150 - 288",
    avatar: "https://s2.showstart.com/detail/299995.jpg",
    site: { siteName: "菇的LIVE·蘑菇洞" },
    host: [{ name: "WhyU传媒", activityRoleType: 5 }],
    sessionUserInfos: [
      {
        userInfos: [
          { name: "尹毓恪", activityRoleType: 2 },
          { name: "特邀嘉宾", activityRoleType: 2 },
        ],
      },
    ],
  },
};

describe("transformShowDetail", () => {
  it("extracts performers (roleType 2) and excludes the host (roleType 5)", () => {
    const d = transformShowDetail(DETAIL_RAW);
    expect(d.performers).toEqual(["尹毓恪", "特邀嘉宾"]);
  });
  it("maps venue / price / showTime / id", () => {
    const d = transformShowDetail(DETAIL_RAW);
    expect(d.showstartId).toBe("299995");
    expect(d.venue).toBe("菇的LIVE·蘑菇洞");
    expect(d.price).toBe("¥150 - 288");
    expect(d.showTime).toBe("2026-07-12T20:00:00");
    expect(d.url).toBe("https://wap.showstart.com/pages/activity/detail/detail?activityId=299995");
    expect(d.poster).toBe("https://s2.showstart.com/detail/299995.jpg");
  });
  it("returns poster: null when result has no avatar", () => {
    const d = transformShowDetail({ result: { activityId: 1 } });
    expect(d.poster).toBeNull();
  });
});

const SEARCH_RAW = {
  state: "1",
  success: true,
  result: [
    {
      id: 2503,
      name: "刺猬Hedgehog",
      avatar: "https://s2.showstart.com/img/2503.jpg",
      fansNum: 337604,
      userType: 2,
      type: 2,
    },
    { id: 9001, name: "某某场地", avatar: "https://s2.showstart.com/img/9001.jpg", fansNum: 50, type: 4 },
    { id: 9002, name: "普通用户", avatar: null, fansNum: 1, userType: 1 },
  ],
};

describe("transformArtistSearch", () => {
  it("keeps only entries with type or userType === 2", () => {
    const hits = transformArtistSearch(SEARCH_RAW);
    expect(hits).toEqual([
      { id: 2503, name: "刺猬Hedgehog", avatar: "https://s2.showstart.com/img/2503.jpg", fansNum: 337604 },
    ]);
  });
  it("returns empty array for a missing/non-array result", () => {
    expect(transformArtistSearch({})).toEqual([]);
    expect(transformArtistSearch({ result: null })).toEqual([]);
  });
  it("defaults avatar to null and fansNum to 0 when absent", () => {
    const raw = { result: [{ id: 1, name: "x", type: 2 }] };
    expect(transformArtistSearch(raw)).toEqual([{ id: 1, name: "x", avatar: null, fansNum: 0 }]);
  });
});

describe("searchArtist", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers an exact normalized-name match over a higher-fans hit", async () => {
    vi.spyOn(ShowstartClient.prototype, "searchUserRaw").mockResolvedValue({
      result: [
        { id: 1, name: "海龟先生乐队", avatar: "a.jpg", fansNum: 999999, type: 2 },
        { id: 2, name: "刺猬", avatar: "b.jpg", fansNum: 100, type: 2 },
      ],
    });
    const hit = await searchArtist("刺猬");
    expect(hit).toEqual({ id: 2, name: "刺猬", avatar: "b.jpg", fansNum: 100 });
  });

  it("falls back to the highest fansNum when no exact match exists", async () => {
    vi.spyOn(ShowstartClient.prototype, "searchUserRaw").mockResolvedValue({
      result: [
        { id: 1, name: "刺猬乐队A", avatar: "a.jpg", fansNum: 100, type: 2 },
        { id: 2, name: "刺猬乐队B", avatar: "b.jpg", fansNum: 200, type: 2 },
      ],
    });
    const hit = await searchArtist("刺猬");
    expect(hit?.id).toBe(2);
  });

  it("returns null when the search yields no artist hits", async () => {
    vi.spyOn(ShowstartClient.prototype, "searchUserRaw").mockResolvedValue({ result: [] });
    expect(await searchArtist("不存在的艺人")).toBeNull();
  });

  it("returns null (never throws) when the underlying request fails", async () => {
    vi.spyOn(ShowstartClient.prototype, "searchUserRaw").mockRejectedValue(new Error("network down"));
    expect(await searchArtist("刺猬")).toBeNull();
  });
});

describe("searchArtistStrict", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("matches the same result as searchArtist on success", async () => {
    vi.spyOn(ShowstartClient.prototype, "searchUserRaw").mockResolvedValue({
      result: [{ id: 2, name: "刺猬", avatar: "b.jpg", fansNum: 100, type: 2 }],
    });
    expect(await searchArtistStrict("刺猬")).toEqual({ id: 2, name: "刺猬", avatar: "b.jpg", fansNum: 100 });
  });

  it("returns null (a definitive no-match) when the search yields no hits", async () => {
    vi.spyOn(ShowstartClient.prototype, "searchUserRaw").mockResolvedValue({ result: [] });
    expect(await searchArtistStrict("不存在的艺人")).toBeNull();
  });

  it("THROWS (does not swallow) when the underlying request fails — the whole point of the strict variant", async () => {
    vi.spyOn(ShowstartClient.prototype, "searchUserRaw").mockRejectedValue(new Error("network down"));
    await expect(searchArtistStrict("刺猬")).rejects.toThrow("network down");
  });
});
