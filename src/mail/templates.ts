import type { NotifyShow } from "../db/notifications";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function posterThumb(url: string): string {
  return url.includes("?") ? url : `${url}?imageMogr2/thumbnail/!360x0/quality/85`;
}

export function unsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/api/manage/unsubscribe?token=${token}`;
}

export function confirmEmail(baseUrl: string, token: string): { subject: string; html: string } {
  const url = `${baseUrl}/api/confirm?token=${token}`;
  return {
    subject: "确认订阅 Show-Remind 演出提醒",
    html: `<p>点击确认订阅演出提醒：</p><p><a href="${url}">${url}</a></p>
      <p>如果不是你本人操作，忽略这封邮件即可。</p>`,
  };
}

export function reminderEmail(
  shows: NotifyShow[],
  baseUrl: string,
  token: string,
): { subject: string; html: string } {
  const rows = shows
    .map((s) => {
      const when = s.showTime ? s.showTime.slice(0, 16).replace("T", " ") : "待定";
      const maybe = s.hasTitleOnlyMatch ? "(可能相关) " : "";
      const artists = s.artistNames.map(escapeHtml).join(" / ");
      const venue = escapeHtml(s.venue ?? "待定");
      const price = escapeHtml(s.price ?? "待定");
      const url = escapeHtml(s.url);
      const poster = s.poster
        ? `<img src="${escapeHtml(posterThumb(s.poster))}" alt="" width="160" style="max-width:160px;height:auto;border-radius:8px;display:block;margin-bottom:6px"/>`
        : "";
      return `<li>${poster}<b>${maybe}${artists}</b> — ${escapeHtml(s.title)}<br/>
        场馆:${venue} · 时间:${escapeHtml(when)} · 票价:${price}<br/>
        <a href="${url}">${url}</a></li>`;
    })
    .join("");
  const footer = `<hr/><p style="font-size:12px;color:#888">
    <a href="${unsubscribeUrl(baseUrl, token)}">退订</a></p>`;
  return {
    subject: "你关注的音乐人有新演出",
    html: `<p>你关注的音乐人有新的演出:</p><ul>${rows}</ul>${footer}`,
  };
}
