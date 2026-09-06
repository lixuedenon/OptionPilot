// src/lib/dateUtils.ts
export function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function dateFromDte(dte: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + Math.round(dte));
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function dteFromDate(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

// Snap a dte to the nearest Friday — US equity options list on Fridays
// (weekly/monthly expirations), so a default that isn't a Friday almost
// never corresponds to a real, tradeable contract.
export function nearestFridayDte(baseDte: number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const base = new Date(today);
  base.setDate(base.getDate() + Math.round(baseDte));

  const day = base.getDay(); // 0=Sun … 5=Fri … 6=Sat
  const forward = (5 - day + 7) % 7; // days to the next Friday (0 if already Friday)
  const backward = forward - 7; // days back to the previous Friday
  const delta = Math.abs(forward) <= Math.abs(backward) ? forward : backward;

  const snapped = new Date(base);
  snapped.setDate(snapped.getDate() + delta);

  return Math.max(0, Math.round((snapped.getTime() - today.getTime()) / 86400000));
}

// Local-date <input type="date"> read/write helpers — separate from
// dteFromDate/dateFromDte above (which work in days-from-today terms for
// option expiries) because these round-trip an absolute epoch timestamp
// instead (used for things like "when was this position opened" that
// aren't relative to today). Originally lived directly in App.tsx; moved
// here so the extracted leg-list component can use the exact same
// functions instead of a duplicate copy.
export function formatDateInput(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseDateInput(value: string): number | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.getTime();
}

// Fractional days elapsed since an epoch timestamp — used across
// compare-mode tracking (App.tsx) to derive "today's" DTE from an opening
// timestamp. Note: SimulatorPage.tsx has its own private copy of this same
// one-liner (pre-existing duplication, not touched by this move).
export function daysSince(ts: number): number {
  return (Date.now() - ts) / 86400000;
}

// Calendar-day difference between two LOCAL dates (yyyy-mm-dd), ignoring
// time-of-day entirely — "opened 09-01, today 09-04" is 3 no matter what
// hour either happened at. Originally lived only in simAccount.ts (for the
// sim account's Timeline backfill, which already worked in whole calendar
// days); moved here as the canonical version so compare-mode tracking in
// App.tsx can use the exact same day-counting convention instead of
// `daysSince`'s continuous 24-hour-period math (2026-09-05 bug: a strategy
// opened 09-01 and checked on 09-04 showed "已过2天" instead of 3, because
// `daysSince` measures whole 24h periods since the opening TIMESTAMP, not
// calendar dates — if the opening moment was later in the day than "now"
// is on the 4th, less than 3 full 24h periods have actually elapsed even
// though 3 calendar days separate the two dates on a wall calendar, which
// is how a person reads "开仓日 09-01" vs "today 09-04"). simAccount.ts
// re-exports this rather than keeping its own copy.
export function daysBetweenLocalDates(fromISO: string, toISO: string): number {
  const from = parseDateInput(fromISO);
  const to = parseDateInput(toISO);
  if (from == null || to == null) return 0;
  return Math.round((to - from) / 86400000);
}

// Convenience wrapper of daysBetweenLocalDates for the common case where
// both sides are epoch-ms timestamps (as `openingAt`/`savedAt` are in
// App.tsx) rather than pre-formatted date strings.
export function calendarDaysBetween(fromTs: number, toTs: number): number {
  return daysBetweenLocalDates(formatDateInput(fromTs), formatDateInput(toTs));
}

// calendarDaysBetween(ts, now) — "days elapsed" as a person reading two
// calendar dates would count it, for the common "since this timestamp, up
// to right now" case.
export function calendarDaysSince(ts: number): number {
  return calendarDaysBetween(ts, Date.now());
}