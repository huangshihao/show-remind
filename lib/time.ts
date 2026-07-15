// Show times are Beijing wall-clock strings ("2026-05-01T14:00:00") — the venue's
// own timezone, which is what Showstart displays and what the UI renders verbatim.
// Comparing them means building "now" in the same shape. China has had a single
// UTC+8 offset with no DST since 1991, so the shift is exact and needs no ICU.
//
// The SQL side of this same question lives in src/db/time.ts (UPCOMING).
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export function beijingNow(): string {
  return new Date(Date.now() + BEIJING_OFFSET_MS).toISOString().slice(0, 19);
}

// A null time means Showstart gave us no start instant at all. That is rare, and
// "we don't know" is not grounds for discarding a show — treat it as upcoming and
// let the detail fetch settle it.
export function isUpcoming(showTime: string | null, now: string = beijingNow()): boolean {
  return showTime === null || showTime >= now;
}
