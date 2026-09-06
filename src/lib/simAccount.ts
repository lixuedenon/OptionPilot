// src/lib/simAccount.ts
import type { Leg } from "./types";
import { computeComboMargin, type MarginNote } from "./margin";
import { classifySpotOnCurve, type CurvePosition } from "./pricing";
import { formatDateInput, daysBetweenLocalDates } from "./dateUtils";
import { fetchHistoricalBars, repriceLegsAtDate, type HistoricalBar } from "./historicalBackfill";

// Re-exported for existing callers (SimulatorPage.tsx) — the actual
// implementation now lives in dateUtils.ts as the app-wide canonical
// calendar-day-difference helper (App.tsx's compare-mode tracking uses it
// too, see dateUtils.ts's comment on daysBetweenLocalDates for why).
export { daysBetweenLocalDates };

export interface SimPosition {
  id: string;
  symbol: string;
  legs: Leg[]; // opening snapshot
  spot: number; // opening spot
  openedAt: number;
  costBasis: number; // positive = net debit paid to open, negative = net credit received
  status: "open" | "closed";
  closedAt?: number;
  closedLegs?: Leg[]; // closing snapshot (marked-to-market legs at close time)
  closedSpot?: number;
  realizedPnl?: number;
  note?: string;
}

export interface SimAccount {
  startingCapital: number;
  cash: number;
  createdAt: number;
}

const ACCOUNT_KEY = "optionpilot_sim_account";
const POSITIONS_KEY = "optionpilot_sim_positions";

function loadAccountFromStorage(): SimAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SimAccount;
  } catch {
    return null;
  }
}

function saveAccountToStorage(a: SimAccount): void {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a));
}

function loadPositionsFromStorage(): SimPosition[] {
  try {
    const raw = localStorage.getItem(POSITIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SimPosition[];
  } catch {
    return [];
  }
}

function savePositionsToStorage(positions: SimPosition[]): void {
  localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
}

// Sum of (buy ? +value : -value) per leg — positive means you paid net cash
// to open, negative means you received net credit. Matches the sign
// convention already used elsewhere in the app (e.g. PayoffChart's netCredit,
// just inverted: this is "cost", that is "credit").
// Stock legs use the entry price directly (no × shares) — this mirrors
// pricing.ts's legShiftedPrice, which deliberately keeps stock P&L on a
// per-share basis so it's on the same scale as option premiums; the shares
// field is informational only and never used in the app's P&L math.
export function computeCostBasis(legs: Leg[]): number {
  return legs.reduce((acc, l) => {
    if (l.disabled) return acc;
    const sign = l.action === "buy" ? 1 : -1;
    const qty = l.kind === "stock" ? 1 : (l.qty ?? 1);
    const value = l.kind === "stock" ? l.strike : l.premium;
    return acc + sign * qty * value;
  }, 0);
}

// Mark-to-market value of a position given the CURRENT spot price and CURRENT
// leg premiums — same sign convention and same per-share stock scale as
// computeCostBasis (see above), so realizedPnl = markValue - costBasis.
export function computeMarkValue(legs: Leg[], currentSpot: number): number {
  return legs.reduce((acc, l) => {
    if (l.disabled) return acc;
    const sign = l.action === "buy" ? 1 : -1;
    const qty = l.kind === "stock" ? 1 : (l.qty ?? 1);
    const value = l.kind === "stock" ? currentSpot : l.premium;
    return acc + sign * qty * value;
  }, 0);
}

export interface PositionSnapshot {
  positionId: string;
  dateISO: string; // yyyy-mm-dd, local calendar day — one snapshot per position per day
  recordedAt: number;
  spot: number;
  legs: Leg[]; // legs with premium refreshed to that moment's market price
  markValue: number;
  unrealizedPnl: number;
  // true when this entry was reconstructed by backfillSnapshots() from a
  // historical daily (open+close)/2 average plus theoretical Black-Scholes
  // repricing, rather than recorded from a real market refresh the person
  // actually did (recordSnapshot()). The Timeline UI must show these
  // differently — they're a same-order-of-magnitude ESTIMATE (flat vol
  // held from opening, no real bid/ask), not an actual observed price.
  estimated?: boolean;
}

const SNAPSHOTS_KEY = "optionpilot_sim_snapshots";

function todayLocalISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function loadSnapshotsFromStorage(): PositionSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PositionSnapshot[];
  } catch {
    return [];
  }
}

function saveSnapshotsToStorage(snaps: PositionSnapshot[]): void {
  localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snaps));
}

// Silently records "what this position was worth today" — called whenever a
// position is refreshed/viewed. One snapshot per (position, calendar day):
// refreshing again on the same day overwrites that day's entry rather than
// piling up duplicates. This is the data "regret mode" (comparing against a
// point mid-hold) needs — it can only cover days from when this was added
// onward, there's no way to backfill history for positions already closed.
export async function recordSnapshot(
  positionId: string,
  spot: number,
  legs: Leg[],
  costBasis: number,
): Promise<void> {
  const dateISO = todayLocalISO();
  const markValue = computeMarkValue(legs, spot);
  const snapshots = loadSnapshotsFromStorage();
  const idx = snapshots.findIndex((s) => s.positionId === positionId && s.dateISO === dateISO);
  const entry: PositionSnapshot = {
    positionId,
    dateISO,
    recordedAt: Date.now(),
    spot,
    legs,
    markValue,
    unrealizedPnl: markValue - costBasis,
  };
  if (idx >= 0) snapshots[idx] = entry;
  else snapshots.push(entry);
  saveSnapshotsToStorage(snapshots);
}

export async function loadSnapshotsForPosition(positionId: string): Promise<PositionSnapshot[]> {
  return loadSnapshotsFromStorage()
    .filter((s) => s.positionId === positionId)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

export async function deleteSnapshotsForPosition(positionId: string): Promise<void> {
  const snapshots = loadSnapshotsFromStorage().filter((s) => s.positionId !== positionId);
  saveSnapshotsToStorage(snapshots);
}

// Theoretical repricing of a position's legs at a historical point in time —
// thin wrapper over historicalBackfill.ts's shared repriceLegsAtDate (see
// that file for the flat-vol convention this uses). Stock legs need no
// repricing — computeMarkValue already prices them directly off the spot
// passed in.
function estimateMarkValueAtDate(position: SimPosition, avgSpot: number, dateISO: string): { markValue: number; legs: Leg[] } {
  const openedISO = formatDateInput(position.openedAt);
  const daysElapsed = Math.max(0, daysBetweenLocalDates(openedISO, dateISO));
  const repriced = repriceLegsAtDate(position.legs, position.spot, avgSpot, daysElapsed);
  return { markValue: computeMarkValue(repriced, avgSpot), legs: repriced };
}

// Fills the gaps in a position's Timeline: for every historical trading day
// between when it opened and today (or its close date, for a closed
// position) that has no REAL recorded snapshot — because the person simply
// didn't have the app open that day to trigger a refresh — this
// reconstructs an estimated one from that day's (open+close)/2 average
// price instead of leaving the day blank. Real snapshots always win: a day
// that already has one from recordSnapshot() is never overwritten. Today
// itself is deliberately left for a live refresh to fill for real, not
// estimated (see the loop's upper bound below) — same for a closed
// position's close date, which is already covered by its actual
// realizedPnl/closedSpot instead of needing an estimate.
export async function backfillSnapshots(position: SimPosition): Promise<PositionSnapshot[]> {
  const existing = await loadSnapshotsForPosition(position.id);
  const existingDates = new Set(existing.map((s) => s.dateISO));

  const openedISO = formatDateInput(position.openedAt);
  const endBoundISO = position.status === "closed" && position.closedAt
    ? formatDateInput(position.closedAt)
    : todayLocalISO();

  let bars: HistoricalBar[];
  try {
    bars = await fetchHistoricalBars(position.symbol);
  } catch {
    // No historical data available (thinly-traded symbol, rate-limited,
    // etc.) — fall back to showing whatever real snapshots exist rather
    // than failing the whole panel.
    return existing;
  }

  const toAdd: PositionSnapshot[] = [];
  for (const bar of bars) {
    if (bar.dateISO < openedISO) continue; // before this position existed
    if (bar.dateISO >= endBoundISO) continue; // today, or on/after close — real data's job, not an estimate's
    if (existingDates.has(bar.dateISO)) continue; // already have a real refresh for this day

    const { markValue, legs } = estimateMarkValueAtDate(position, bar.avgPrice, bar.dateISO);
    toAdd.push({
      positionId: position.id,
      dateISO: bar.dateISO,
      recordedAt: Date.now(),
      spot: bar.avgPrice,
      legs,
      markValue,
      unrealizedPnl: markValue - position.costBasis,
      estimated: true,
    });
  }

  if (toAdd.length > 0) {
    saveSnapshotsToStorage([...loadSnapshotsFromStorage(), ...toAdd]);
  }

  return [...existing, ...toAdd].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

// The unified "best exit point" read for the Timeline/复盘 panel — combines
// the historical daily P&L record (real + backfilled snapshots) with the
// curve-shape structural signal above, so the panel can tell the person not
// just WHICH day looked best in dollars but WHY: whether that day's (or the
// current/actual close's) price also sat in a structurally favorable spot
// on the strategy's own payoff curve. `comparePnl`/`compareSpot` are the
// point being compared AGAINST the historical best — unrealized P&L + live
// spot for a still-open position, realized P&L + closedSpot for a closed
// one; the caller (SimulatorPage) already has both, this just reasons over
// them rather than re-deriving them.
export interface ExitAnalysis {
  bestSnapshot: PositionSnapshot;
  bestStructural: CurvePosition;
  compareStructural: CurvePosition | null; // null only if compareSpot wasn't available (e.g. not yet refreshed)
}

export function analyzeBestExit(
  position: SimPosition,
  snapshots: PositionSnapshot[],
  compareSpot: number | null,
): ExitAnalysis | null {
  if (snapshots.length === 0) return null;
  const bestSnapshot = snapshots.reduce((a, b) => (b.unrealizedPnl > a.unrealizedPnl ? b : a), snapshots[0]);
  const bestStructural = classifySpotOnCurve(position.legs, position.spot, bestSnapshot.spot);
  const compareStructural = compareSpot != null ? classifySpotOnCurve(position.legs, position.spot, compareSpot) : null;
  return { bestSnapshot, bestStructural, compareStructural };
}

export async function loadSimAccount(): Promise<SimAccount | null> {
  return loadAccountFromStorage();
}

export async function initSimAccount(startingCapital: number): Promise<SimAccount> {
  const account: SimAccount = { startingCapital, cash: startingCapital, createdAt: Date.now() };
  saveAccountToStorage(account);
  return account;
}

// Clears the simulated account, all positions (open and closed), and every
// recorded daily snapshot (used by "regret mode" / position timelines) —
// a true fresh start, not just wiping the account+positions and leaving
// orphaned snapshot rows keyed to position ids that no longer exist.
export async function resetSimAccount(): Promise<void> {
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(POSITIONS_KEY);
  localStorage.removeItem(SNAPSHOTS_KEY);
}

export async function loadSimPositions(): Promise<SimPosition[]> {
  return loadPositionsFromStorage();
}

// Margin for every OPEN position, summed. Uses each position's stored
// OPENING spot rather than re-fetching a live quote per symbol — margin
// does technically drift with the live price (see margin.ts's naked-call
// formula), but re-fetching quotes for every open position on every check
// adds real network/async complexity for a number that's meant as a
// capital-availability guardrail, not a live risk figure. This is a
// deliberate approximation for v1; if it ever needs to track live prices
// instead, the shape of the change is "pass a symbol→spot map in" rather
// than a redesign.
export function computeMarginUsed(positions: SimPosition[]): number {
  return positions
    .filter((p) => p.status === "open")
    .reduce((sum, p) => sum + computeComboMargin(p.legs, p.spot).total, 0);
}

// What's actually free to open a NEW position with — cash minus whatever
// margin the currently-open positions are already holding as collateral.
// This is the number "钱花完了没法下单" is checked against, not raw cash,
// since a credit spread's premium already inflated cash even though most
// of that isn't really "free" while the position is open.
export function computeAvailableCapital(account: SimAccount, positions: SimPosition[]): number {
  return account.cash - computeMarginUsed(positions);
}

export interface MarginCheckResult {
  ok: boolean;
  required: number;
  available: number;
  shortfall: number; // 0 when ok
  breakdown: MarginNote[];
}

// Thrown by openSimPosition when a position can't be opened for lack of
// margin. Carries the full breakdown (not just a formatted message) so the
// UI can render a real itemized explanation instead of a single opaque
// error string — see MarginErrorDialog.tsx, which reads `.detail` directly.
export class InsufficientMarginError extends Error {
  detail: MarginCheckResult;
  constructor(detail: MarginCheckResult) {
    super(`保证金不足：需要$${detail.required.toFixed(2)}，当前可用$${detail.available.toFixed(2)}，还差$${detail.shortfall.toFixed(2)}`);
    this.name = "InsufficientMarginError";
    this.detail = detail;
  }
}

export function checkMarginForOpen(legs: Leg[], spot: number, account: SimAccount, positions: SimPosition[]): MarginCheckResult {
  const { total, notes } = computeComboMargin(legs, spot);
  const available = computeAvailableCapital(account, positions);
  const shortfall = Math.max(0, Math.round((total - available) * 100) / 100);
  return { ok: total <= available, required: total, available, shortfall, breakdown: notes };
}

export async function openSimPosition(params: {
  symbol: string;
  legs: Leg[];
  spot: number;
  // The combo's real opening date, when it has one (e.g. carried over from
  // a saved strategy that was actually opened days ago via analysis mode's
  // "add to sim account" shortcut — see App.tsx's handleAddToSimAccount).
  // Omitted (or undefined) for positions genuinely opened right now, such
  // as ones built from scratch in the simulator's own leg builder — those
  // correctly fall back to Date.now() below.
  openingAt?: number;
  // Free-form tag used by callers that need to identify a position later —
  // e.g. EarningsIvCrashTab.tsx stamps "earnings-iv-crash:{group}:{batchId}"
  // so earningsClosing.ts's parseEarningsNote()/groupEarningsPositions() can
  // find "all positions from this earnings batch" as a unit. Omitted for
  // positions opened by hand, which don't need to be found by anything.
  note?: string;
}): Promise<{ account: SimAccount; positions: SimPosition[] }> {
  const account = loadAccountFromStorage();
  if (!account) throw new Error("Simulated account not initialized");

  const positions = loadPositionsFromStorage();
  const check = checkMarginForOpen(params.legs, params.spot, account, positions);
  if (!check.ok) throw new InsufficientMarginError(check);

  const costBasis = computeCostBasis(params.legs);
  const position: SimPosition = {
    id: `simpos-${Date.now()}`,
    symbol: params.symbol,
    legs: params.legs,
    spot: params.spot,
    openedAt: params.openingAt ?? Date.now(),
    costBasis,
    status: "open",
    note: params.note,
  };

  const updatedAccount: SimAccount = { ...account, cash: account.cash - costBasis };
  saveAccountToStorage(updatedAccount);

  positions.unshift(position);
  savePositionsToStorage(positions);

  return { account: updatedAccount, positions };
}

export async function closeSimPosition(
  id: string,
  closingLegs: Leg[],
  closingSpot: number,
): Promise<{ account: SimAccount; positions: SimPosition[] }> {
  const account = loadAccountFromStorage();
  if (!account) throw new Error("Simulated account not initialized");

  const positions = loadPositionsFromStorage();
  const idx = positions.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error("Position not found");

  const position = positions[idx];
  const markValue = computeMarkValue(closingLegs, closingSpot);
  // Closing pays/receives cash equal to the position's current mark value in
  // the SAME sign convention as costBasis (verified against a worked
  // example: buy a call for 5 [costBasis=+5], later sell it back at 8
  // [markValue=+8] → you receive +8 cash, realized P&L = 8-5 = +3).
  const realizedPnl = markValue - position.costBasis;

  positions[idx] = {
    ...position,
    status: "closed",
    closedAt: Date.now(),
    closedLegs: closingLegs,
    closedSpot: closingSpot,
    realizedPnl,
  };
  savePositionsToStorage(positions);

  const updatedAccount: SimAccount = { ...account, cash: account.cash + markValue };
  saveAccountToStorage(updatedAccount);

  return { account: updatedAccount, positions };
}

// Adjust a still-open position by closing some legs and/or adding new ones —
// backs the leg-level "..." menu (roll / hedge / protect / close-this-leg)
// reused from the analysis workspace. Cash impact is computed from CURRENT
// market prices: closing legs credits their current mark value, opening new
// legs debits their current entry cost. costBasis is simply recomputed from
// whatever legs remain — no separate delta bookkeeping needed, since each
// leg's own `premium` field already carries its true entry cost (original
// for untouched legs, current-market for newly added ones).
export async function adjustSimPosition(
  positionId: string,
  params: {
    removeLegIds: string[];
    removedLegsMarket: Leg[]; // same legs as removeLegIds, premium/strike refreshed to current market — used only to compute the cash credit
    addLegs: Leg[]; // new legs, premium/strike already set to current market entry price
    currentSpot: number;
  },
): Promise<{ account: SimAccount; positions: SimPosition[] }> {
  const account = loadAccountFromStorage();
  if (!account) throw new Error("Simulated account not initialized");

  const positions = loadPositionsFromStorage();
  const idx = positions.findIndex((p) => p.id === positionId);
  if (idx < 0) throw new Error("Position not found");

  const position = positions[idx];
  const cashFromClosing = computeMarkValue(params.removedLegsMarket, params.currentSpot);
  const cashForOpening = -computeCostBasis(params.addLegs);
  const cashDelta = cashFromClosing + cashForOpening;

  const remainingLegs = position.legs.filter((l) => !params.removeLegIds.includes(l.id));
  const newLegs = [...remainingLegs, ...params.addLegs];
  const newCostBasis = computeCostBasis(newLegs);

  // If every leg just got closed out and nothing was added, there's nothing
  // left to hold — finish the job and move it to history instead of leaving
  // an empty position sitting open.
  if (newLegs.length === 0) {
    positions[idx] = {
      ...position,
      status: "closed",
      closedAt: Date.now(),
      closedLegs: params.removedLegsMarket,
      closedSpot: params.currentSpot,
      realizedPnl: cashFromClosing - position.costBasis,
    };
  } else {
    positions[idx] = { ...position, legs: newLegs, costBasis: newCostBasis };
  }
  savePositionsToStorage(positions);

  const updatedAccount: SimAccount = { ...account, cash: account.cash + cashDelta };
  saveAccountToStorage(updatedAccount);

  return { account: updatedAccount, positions };
}

export async function deleteSimPosition(id: string): Promise<SimPosition[]> {
  const positions = loadPositionsFromStorage().filter((p) => p.id !== id);
  savePositionsToStorage(positions);
  await deleteSnapshotsForPosition(id);
  return positions;
}