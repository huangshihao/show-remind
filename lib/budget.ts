// Workers Free allows 50 EXTERNAL fetches per invocation (Cloudflare-internal
// services like D1 have a separate 1000 budget; every hop of a redirect chain
// counts; exceeding throws "Too many subrequests"). Batch call sites used to
// hand-count against that in comments — which breaks the moment two capped
// paths compose in one invocation (playlist pagination + avatar lookups) or
// one action costs two fetches (netease miss → Showstart fallback).
//
// Instead, the invocation entry point (route handler / cron run) creates one
// SubrequestBudget and threads it into every batch path. Callers tryTake(1)
// BEFORE each external fetch and degrade gracefully when refused — truncate
// pagination, skip the lookup, leave the email for the next run — never throw.
//
// The default stays under 50 to leave headroom for the stray fetches that are
// not worth threading a budget into (Turnstile verification, admin alert,
// short-link resolution, redirect hops).
export const EXTERNAL_SUBREQUEST_BUDGET = 45;

export class SubrequestBudget {
  private used = 0;

  constructor(private readonly limit: number = EXTERNAL_SUBREQUEST_BUDGET) {}

  // All-or-nothing: a refused take spends nothing.
  tryTake(n = 1): boolean {
    if (this.used + n > this.limit) return false;
    this.used += n;
    return true;
  }

  remaining(): number {
    return this.limit - this.used;
  }
}
