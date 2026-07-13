import { expect, it } from "vitest";
import { confirmEmail, reminderEmail } from "../../src/mail/templates";
import type { NotifyShow } from "../../src/db/notifications";

const show: NotifyShow = {
  showId: "s1", title: "刺猬专场 <x>", cityCode: "110000", venue: "MAO",
  showTime: "2026-08-01T20:00:00", price: "180", url: "https://wap.showstart.com/x/1",
  poster: "https://s2.showstart.com/x.jpg",
  artistNames: ["刺猬"], hasTitleOnlyMatch: false,
};

it("confirmEmail links to /api/confirm with the token", () => {
  const { subject, html } = confirmEmail("https://s.com", "tok123");
  expect(subject).toBeTruthy();
  expect(html).toContain("https://s.com/api/confirm?token=tok123");
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

it("reminderEmail marks title-only matches as maybe-related", () => {
  const { html } = reminderEmail([{ ...show, hasTitleOnlyMatch: true }], "https://s.com", "t");
  expect(html).toContain("可能相关");
});

it("reminderEmail escapes HTML in the showTime-derived 'when' field", () => {
  // showTime is sliced to the first 16 chars before rendering, so the
  // injected markup must appear within that window to exercise escaping.
  const malicious: NotifyShow = { ...show, showTime: "<script>alert(1)</script>" };
  const { html } = reminderEmail([malicious], "https://s.com", "tok123");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});
