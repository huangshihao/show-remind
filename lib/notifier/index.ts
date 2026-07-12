import { prisma } from "@/lib/db";
import { findNotifyCandidates, type NotifyShow } from "./candidates";
import { sendMail } from "./mailer";

function renderEmail(shows: NotifyShow[]): string {
  const rows = shows
    .map((s) => {
      const when = s.showTime ? s.showTime.toISOString().slice(0, 16).replace("T", " ") : "待定";
      const maybe = s.hasTitleOnlyMatch ? "(可能相关) " : "";
      return `<li><b>${maybe}${s.artistNames.join(" / ")}</b> — ${s.title}<br/>
        场馆:${s.venue ?? "待定"} · 时间:${when} · 票价:${s.price ?? "待定"}<br/>
        <a href="${s.url}">${s.url}</a></li>`;
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
