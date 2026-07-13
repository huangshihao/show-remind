import type { Env } from "../env";
import { findNotifyCandidates, markSent } from "../db/notifications";
import { getMailProvider } from "../mail/provider";
import { reminderEmail } from "../mail/templates";

export async function runNotifications(
  db: D1Database,
  env: Env,
): Promise<{ sent: number; failed: number }> {
  const candidates = await findNotifyCandidates(db);
  const mail = getMailProvider(env);
  let sent = 0;
  let failed = 0;
  for (const cand of candidates) {
    const { subject, html } = reminderEmail(cand.shows, env.APP_BASE_URL, cand.token);
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        await mail.send({ to: cand.email, subject, html });
        ok = true;
      } catch {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    if (ok) {
      await markSent(db, cand.subscriptionId, cand.shows.map((s) => s.showId));
      sent++;
    } else {
      // leave no notification row so the next run retries (mirrors old behavior)
      failed++;
    }
  }
  return { sent, failed };
}
