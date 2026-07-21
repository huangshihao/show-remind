import type { SubrequestBudget } from "@/lib/budget";

const DEFAULT_RETRIES = 2; // up to 3 attempts total
const DEFAULT_BASE_DELAY_MS = 500; // 500ms, 1000ms — brief, bounded backoff

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface NeteaseRetryOptions {
  retries?: number;
  baseDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

// NetEase applies intermittent risk control to overseas (Cloudflare / CI)
// egress — the plaintext /api endpoints answer 200 with a code!==200 body that
// the client guard turns into a throw (see client.ts). That's transient, so a
// couple of backoff retries usually recover it (issue #3).
//
// Each RETRY spends one unit of the invocation's SubrequestBudget, so the total
// number of real external fetches never exceeds the Cloudflare subrequest
// ceiling the budget guards. When the budget can't cover another attempt, we
// stop and surface the last error — callers keep their existing fail/degrade
// contract. The first attempt is NOT charged here; the caller already reserved
// it before calling.
export async function withNeteaseRetry<T>(
  fn: () => Promise<T>,
  budget: SubrequestBudget,
  opts: NeteaseRetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleepFn = opts.sleepFn ?? realSleep;

  let lastErr: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt >= retries || !budget.tryTake(1)) throw lastErr;
      await sleepFn(baseDelayMs * (attempt + 1));
    }
  }
}
