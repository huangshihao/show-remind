import { expect, it } from "vitest";
import { confirmEmail, loginEmail, reminderEmail } from "../../src/mail/templates";
import type { NotifyShow } from "../../src/db/notifications";

const show: NotifyShow = {
  showId: "s1", title: "刺猬专场 <x>", cityCode: "110000", venue: "MAO",
  showTime: "2026-08-01T20:00:00", price: "180", url: "https://wap.showstart.com/x/1",
  poster: "https://s2.showstart.com/x.jpg",
  artistNames: ["刺猬"],
};

it("confirmEmail links to /api/confirm with the token", () => {
  const { subject, html } = confirmEmail("https://s.com", "tok123");
  expect(subject).toBeTruthy();
  expect(html).toContain("https://s.com/api/confirm?token=tok123");
});

it("loginEmail links to the /manage page with the token", () => {
  const { subject, html } = loginEmail("https://s.com", "tok123");
  expect(subject).toBeTruthy();
  expect(html).toContain("https://s.com/manage?token=tok123");
});

it("reminderEmail subject names the artist for one show, counts shows for several", () => {
  const one = reminderEmail([show], "https://s.com", "t");
  expect(one.subject).toContain("刺猬");
  const second: NotifyShow = { ...show, showId: "s2", title: "另一场", artistNames: ["海龟先生"] };
  const third: NotifyShow = { ...show, showId: "s3", title: "第三场", artistNames: ["低苦艾"] };
  const many = reminderEmail([show, second, third], "https://s.com", "t");
  expect(many.subject).toContain("3");
});

it("reminderEmail renders every show in ONE email, with city name and a ticket CTA", () => {
  const second: NotifyShow = {
    ...show, showId: "s2", title: "上海站", cityCode: "310000",
    artistNames: ["海龟先生"], url: "https://wap.showstart.com/x/2",
  };
  const { html } = reminderEmail([show, second], "https://s.com", "t");
  // both shows in one mail
  expect(html).toContain("刺猬专场");
  expect(html).toContain("上海站");
  // city codes rendered as names
  expect(html).toContain("北京");
  expect(html).toContain("上海");
  // one ticket link per show
  expect(html).toContain("https://wap.showstart.com/x/1");
  expect(html).toContain("https://wap.showstart.com/x/2");
});

it("reminderEmail shows a 待定 stub when the show has no parseable time", () => {
  const undated: NotifyShow = { ...show, showTime: null };
  const { html } = reminderEmail([undated], "https://s.com", "t");
  expect(html).toContain("待定");
});

it("reminderEmail has only an unsubscribe link in the footer (no manage link)", () => {
  const { html } = reminderEmail([show], "https://s.com", "tok123");
  expect(html).toContain("刺猬");
  // footer no longer links to the /manage page
  expect(html).not.toContain("https://s.com/manage?token=tok123");
  // one-click unsubscribe link remains
  expect(html).toContain("https://s.com/api/manage/unsubscribe?token=tok123");
  // HTML-escapes the title angle brackets
  expect(html).toContain("&lt;x&gt;");
});

it("reminderEmail renders a poster thumbnail when the show has a poster", () => {
  const { html } = reminderEmail([show], "https://s.com", "tok123");
  expect(html).toContain("<img");
  expect(html).toContain("https://s2.showstart.com/x.jpg?imageMogr2/thumbnail/360x/quality/85");
});

it("reminderEmail leaves an already-parameterized poster URL untouched", () => {
  // Showstart list-row avatars already carry an imageMogr2 query string.
  const withQuery = { ...show, poster: "https://s2.showstart.com/x.jpg?imageMogr2/thumbnail/!350x500r" };
  const { html } = reminderEmail([withQuery], "https://s.com", "t");
  expect(html).toContain("x.jpg?imageMogr2/thumbnail/!350x500r");
  expect(html).not.toContain("thumbnail/360x/quality"); // our default thumbnail param was NOT double-appended
});

it("reminderEmail renders no img tag when the show has no poster", () => {
  const { html } = reminderEmail([{ ...show, poster: null }], "https://s.com", "tok123");
  expect(html).not.toContain("<img");
});

it("reminderEmail never renders a raw showTime string (unparseable time becomes a 待定 stub)", () => {
  // The date stub is built by regex from showTime; anything that doesn't
  // match renders as the 待定 stub, so hostile input has no injection path.
  const malicious: NotifyShow = { ...show, showTime: "<script>alert(1)</script>" };
  const { html } = reminderEmail([malicious], "https://s.com", "tok123");
  expect(html).not.toContain("<script>");
  expect(html).toContain("待定");
});
