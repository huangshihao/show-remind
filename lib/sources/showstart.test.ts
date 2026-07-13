import { describe, it, expect } from "vitest";
import { normalizeShowTime, transformShowList, transformShowDetail } from "./showstart";

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
