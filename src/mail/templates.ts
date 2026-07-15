import type { NotifyShow } from "../db/notifications";
import { CITIES } from "@/lib/cities";

// Email-safe rendition of the site's identity (web/src/styles.css): warm
// paper, ink, one acid-lime accent, monospace ticket stubs, hard offset
// shadows. Everything is tables + inline styles — no <style> block survives
// every client — and box-shadow simply degrades to the solid border where
// unsupported (Outlook).
const PAPER = "#efece1";
const CARD = "#fbfaf5";
const INK = "#16161a";
const SOFT = "#55554d";
const FAINT = "#8f8e83";
const ACID = "#c2f23c";
const ACID_INK = "#1a1e08";
const SANS =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function posterThumb(url: string): string {
  // Qiniu imageMogr2: limit width to 360px, keep aspect ratio (verified against
  // s2.showstart.com — `360x` works, `!360x0` returns 400). ~40-50KB per poster.
  return url.includes("?") ? url : `${url}?imageMogr2/thumbnail/360x/quality/85`;
}

function cityName(code: string): string {
  return CITIES.find((c) => c.code === code)?.name ?? code;
}

// "2026-07-31T20:00:00" -> ticket-stub pieces, without Date parsing (the
// string is already local wall-clock time). Unparseable -> null -> 待定 stub.
function stubParts(showTime: string | null): { mon: string; day: string; time: string } | null {
  if (!showTime) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(showTime);
  if (!m) return null;
  return {
    mon: `${Number(m[2])}月`,
    day: String(Number(m[3])),
    time: m[4] ? `${m[4]}:${m[5]}` : "",
  };
}

export function unsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/api/manage/unsubscribe?token=${token}`;
}

// The one acid-lime action per email. Bulletproof-ish: padded <a> renders as
// a button everywhere that matters here (Gmail/QQ/163/Apple Mail).
function ctaButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${ACID};color:${ACID_INK};font-family:${SANS};font-size:14px;font-weight:700;text-decoration:none;padding:10px 20px;border-radius:999px;border:1.5px solid ${INK};">${label}</a>`;
}

// Shared shell: paper background, 600px column, chip header, custom footer.
// `preheader` is the hidden snippet inbox lists show after the subject.
function shell(content: string, footer: string, preheader = ""): string {
  const pre = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>`
    : "";
  return `<div lang="zh-CN" style="margin:0;padding:0;background:${PAPER};">${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
      <tr><td style="padding:0 4px 18px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${INK};border-radius:9px;width:34px;height:34px;text-align:center;vertical-align:middle;">
            <span style="font-family:${MONO};font-size:14px;font-weight:700;color:${ACID};letter-spacing:0.5px;">SL</span>
          </td>
          <td style="padding-left:10px;font-family:${SANS};font-size:15px;font-weight:800;color:${INK};">Show Remind</td>
        </tr></table>
      </td></tr>
      ${content}
      <tr><td style="padding:10px 4px 0;font-family:${SANS};font-size:12px;color:${FAINT};line-height:1.7;">
        ${footer}
      </td></tr>
    </table>
  </td></tr>
</table></div>`;
}

function simpleActionEmail(
  subject: string,
  intro: string,
  url: string,
  buttonLabel: string,
): { subject: string; html: string } {
  const safeUrl = escapeHtml(url);
  const content = `<tr><td style="background:${CARD};border:1.5px solid ${INK};border-radius:14px;box-shadow:4px 4px 0 ${INK};padding:26px 24px;">
    <p style="margin:0 0 18px;font-family:${SANS};font-size:15px;color:${INK};line-height:1.7;">${intro}</p>
    <p style="margin:0 0 18px;">${ctaButton(safeUrl, buttonLabel)}</p>
    <p style="margin:0;font-family:${SANS};font-size:12px;color:${FAINT};line-height:1.6;word-break:break-all;">按钮打不开？复制这个链接：<br/><a href="${safeUrl}" style="color:${SOFT};">${safeUrl}</a></p>
  </td></tr>`;
  const footer = `如果不是你本人操作，忽略这封邮件即可。`;
  return { subject, html: shell(content, footer) };
}

export function confirmEmail(baseUrl: string, token: string): { subject: string; html: string } {
  return simpleActionEmail(
    "确认订阅 Show-Remind 演出提醒",
    "点一下按钮，确认订阅演出提醒。你关注的音乐人一有新演出，我们会第一时间发到这个邮箱。",
    `${baseUrl}/api/confirm?token=${token}`,
    "确认订阅",
  );
}

export function loginEmail(baseUrl: string, token: string): { subject: string; html: string } {
  return simpleActionEmail(
    "登录 Show-Remind · 管理你的关注",
    "点一下按钮，登录并管理你关注的音乐人和城市。",
    `${baseUrl}/manage?token=${token}`,
    "打开我的关注",
  );
}

// One ticket card per show: monospace date stub, dashed perforation, poster,
// meta, one acid CTA. Mirrors the site's shows list so the email reads as a
// strip of the same tickets.
function ticketCard(s: NotifyShow): string {
  const stub = stubParts(s.showTime);
  const stubInner = stub
    ? `<div style="font-family:${MONO};font-size:12px;color:${SOFT};">${escapeHtml(stub.mon)}</div>
       <div style="font-family:${MONO};font-size:30px;font-weight:700;color:${INK};line-height:1.15;">${escapeHtml(stub.day)}</div>
       ${stub.time ? `<div style="font-family:${MONO};font-size:12px;color:${SOFT};">${escapeHtml(stub.time)}</div>` : ""}`
    : `<div style="font-family:${MONO};font-size:13px;color:${SOFT};line-height:1.5;">时间<br/>待定</div>`;

  const artists = s.artistNames
    .map(
      (n) =>
        `<span style="display:inline-block;background:${ACID};color:${ACID_INK};font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;margin:0 6px 4px 0;">${escapeHtml(n)}</span>`,
    )
    .join("");

  const poster = s.poster
    ? `<td width="96" valign="top" style="padding:0 14px 0 0;"><img src="${escapeHtml(posterThumb(s.poster))}" alt="${escapeHtml(s.title)}" width="96" style="display:block;width:96px;height:auto;border-radius:10px;border:1px solid ${INK};"/></td>`
    : "";

  const meta = `<td valign="top">
      <p style="margin:0 0 8px;font-family:${SANS};font-size:16px;font-weight:800;color:${INK};line-height:1.4;">${escapeHtml(s.title)}</p>
      <p style="margin:0 0 8px;font-family:${SANS};line-height:1.9;">${artists}</p>
      <p style="margin:0 0 3px;font-family:${SANS};font-size:13px;color:${SOFT};">📍 ${escapeHtml(cityName(s.cityCode))} · ${escapeHtml(s.venue ?? "场地待定")}</p>
      <p style="margin:0 0 12px;font-family:${SANS};font-size:13px;color:${SOFT};">🎫 ${escapeHtml(s.price ?? "票价待定")}</p>
      ${ctaButton(escapeHtml(s.url), "购票 / 详情 →")}
    </td>`;

  return `<tr><td style="padding:0 0 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1.5px solid ${INK};border-radius:14px;box-shadow:4px 4px 0 ${INK};">
      <tr>
        <td width="76" align="center" valign="middle" style="border-right:2px dashed #cfc9b6;padding:18px 8px;">${stubInner}</td>
        <td style="padding:18px 18px 18px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${poster}${meta}</tr></table>
        </td>
      </tr>
    </table>
  </td></tr>`;
}

export function reminderEmail(
  shows: NotifyShow[],
  baseUrl: string,
  token: string,
): { subject: string; html: string } {
  const firstArtists = [...new Set(shows.flatMap((s) => s.artistNames))];
  const subject =
    shows.length === 1
      ? `你关注的 ${firstArtists.slice(0, 2).join("、")} 有新演出`
      : `你关注的音乐人有 ${shows.length} 场新演出`;

  const headline = `<tr><td style="padding:0 4px 16px;">
    <p style="margin:0 0 6px;font-family:${MONO};font-size:11px;letter-spacing:3px;color:${FAINT};">SHOW REMIND · 演出提醒</p>
    <p style="margin:0;font-family:${SANS};font-size:22px;font-weight:800;color:${INK};line-height:1.35;">${
      shows.length === 1 ? "你关注的音乐人有新演出" : `你关注的音乐人有 ${shows.length} 场新演出`
    }</p>
  </td></tr>`;

  const cards = shows.map(ticketCard).join("");
  const footer = `你收到这封邮件，是因为订阅了 Show Remind 的演出提醒。<a href="${unsubscribeUrl(baseUrl, token)}" style="color:${FAINT};">退订全部提醒</a>`;
  const preheader = shows
    .map((s) => `${s.artistNames.join("/")}《${s.title}》`)
    .join(" · ")
    .slice(0, 120);

  return { subject, html: shell(headline + cards, footer, preheader) };
}
