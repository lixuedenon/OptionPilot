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