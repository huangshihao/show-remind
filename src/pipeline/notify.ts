import type { Env } from "../env";
import { findNotifyCandidates, markSent } from "../db/notifications";
import { getMailProvider } from "../mail/provider";
import { reminderEmail } from "../mail/templates";
import { SubrequestBudget } from "@/lib/budget";

// Every send ATTEMPT (retries included) is one external call to the mail
// API, so each takes from the invocation's SubrequestBudget. When it runs
// out, remaining candidates are deferred, not failed: they have no
// notification row yet, so the next cron run picks them up with a fresh
// budget. Deferred candidates count toward neither `sent` nor `failed`.
export async function runNotifications(
  db: D1Database,
  env: Env,
  budget: SubrequestBudget = new SubrequestBudget(),
): Promise<{ sent: number; failed: number }> {
  const candidates = await findNotifyCandidates(db);
  const mail = getMailProvider(env);
  let sent = 0;
  let failed = 0;
  for (const cand of candidates) {
    if (budget.remaining() === 0) break;
    const { subject, html } = reminderEmail(cand.shows, env.APP_BASE_URL, cand.token);
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok && budget.tryTake(); attempt++) {
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
    } else if (budget.remaining() > 0) {
      // tried 3 times and lost — leave no notification row so the next run
      // retries (mirrors old behavior)
      failed++;
    }
    // budget exhausted mid-candidate: deferred, next run retries
  }
  return { sent, failed };
}
