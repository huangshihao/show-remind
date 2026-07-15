// shows.show_time is Beijing wall-clock ("2026-05-01T14:00:00") — the venue's own
// timezone, stored the way Showstart displays it and the way the UI renders it
// verbatim. SQLite's datetime('now') is UTC, so comparing the two directly is
// wrong twice over: an 8-hour skew, and a separator mismatch ('T' vs ' ') that
// makes a raw string compare read any same-day gig as still upcoming.
//
// Wrapping both sides in datetime() normalises the 'T', and the offset puts them
// in the same zone. China has had a single UTC+8 offset with no DST since 1991,
// so the shift is exact.
export const BEIJING_NOW = "datetime('now', '+8 hours')";

// A show is upcoming while its start is in the future. NULL means we never got a
// time for it at all — vanishingly rare now that the epoch fields are read
// (see showTimeFromEpoch) — and is kept rather than hidden.
export const UPCOMING = (showTimeCol: string) =>
  `(${showTimeCol} IS NULL OR datetime(${showTimeCol}) >= ${BEIJING_NOW})`;
