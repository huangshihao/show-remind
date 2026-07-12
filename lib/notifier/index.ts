import { prisma } from "@/lib/db";
import { findNotifyCandidates, type NotifyShow } from "./candidates";
import { sendMail } from "./mailer";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmail(shows: NotifyShow[]): string {
  const rows = shows
    .map((s) => {
      const when = s.showTime ? s.showTime.toISOString().slice(0, 16).replace("T", " ") : "待定";
      const maybe = s.hasTitleOnlyMatch ? "(可能相关) " : "";
      const artists = s.artistNames.map(escapeHtml).join(" / ");
      const venue = escapeHtml(s.venue ?? "待定");
      const price = escapeHtml(s.price ?? "待定");
      const url = escapeHtml(s.url);
      return `<li><b>${maybe}${artists}</b> — ${escapeHtml(s.title)}<br/>
        场馆:${venue} · 时间:${when} · 票价:${price}<br/>
        <a href="${url}">${url}</a></li>`;
    })
    .join("");
  return `<p>你关注的音乐人有新的演出:</p><ul>${rows}</ul>`;
}

async function sendWithRetry(email: string, html: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await sendMail(email, "你关注的音乐人有新演出", html);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  return false;
}

export async function runNotifications(): Promise<{ usersNotified: number; emailsFailed: number }> {
  const candidates = await findNotifyCandidates();
  let usersNotified = 0;
  let emailsFailed = 0;

  for (const { userId, email, shows } of candidates) {
    const ok = await sendWithRetry(email, renderEmail(shows));
    const status = ok ? "sent" : "failed";
    await prisma.notification.createMany({
      data: shows.map((s) => ({ userId, showId: s.showId, status, sentAt: ok ? new Date() : null })),
      skipDuplicates: true,
    });
    if (ok) usersNotified++;
    else emailsFailed++;
  }
  return { usersNotified, emailsFailed };
}
