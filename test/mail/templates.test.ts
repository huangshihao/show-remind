import { expect, it } from "vitest";
import { confirmEmail, reminderEmail } from "../../src/mail/templates";
import type { NotifyShow } from "../../src/db/notifications";

const show: NotifyShow = {
  showId: "s1", title: "刺猬专场 <x>", cityCode: "110000", venue: "MAO",
  showTime: "2026-08-01T20:00:00", price: "180", url: "https://wap.showstart.com/x/1",
  artistNames: ["刺猬"], hasTitleOnlyMatch: false,
};

it("confirmEmail links to /api/confirm with the token", () => {
  const { subject, html } = confirmEmail("https://s.com", "tok123");
  expect(subject).toBeTruthy();
  expect(html).toContain("https://s.com/api/confirm?token=tok123");
});

it("reminderEmail lists shows and has manage + unsubscribe footer links", () => {
  const { html } = reminderEmail([show], "https://s.com", "tok123");
  expect(html).toContain("刺猬");
  expect(html).toContain("https://s.com/manage?token=tok123");
  expect(html).toContain("https://s.com/api/manage/unsubscribe?token=tok123");
  // HTML-escapes the title angle brackets
  expect(html).toContain("&lt;x&gt;");
});

it("reminderEmail marks title-only matches as maybe-related", () => {
  const { html } = reminderEmail([{ ...show, hasTitleOnlyMatch: true }], "https://s.com", "t");
  expect(html).toContain("可能相关");
});
