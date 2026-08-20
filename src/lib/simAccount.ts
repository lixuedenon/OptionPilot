import type { Leg } from "./types";

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

export async function loadSimAccount(): Promise<SimAccount | null> {
  return loadAccountFromStorage();
}

export async function initSimAccount(startingCapital: number): Promise<SimAccount> {
  const account: SimAccount = { startingCapital, cash: startingCapital, createdAt: Date.now() };
  saveAccountToStorage(account);
  return account;
}

export async function resetSimAccount(): Promise<void> {
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(POSITIONS_KEY);
}

export async function loadSimPositions(): Promise<SimPosition[]> {
  return loadPositionsFromStorage();
}

export async function openSimPosition(params: {
  symbol: string;
  legs: Leg[];
  spot: number;
}): Promise<{ account: SimAccount; positions: SimPosition[] }> {
  const account = loadAccountFromStorage();
  if (!account) throw new Error("Simulated account not initialized");

  const costBasis = computeCostBasis(params.legs);
  const position: SimPosition = {
    id: `simpos-${Date.now()}`,
    symbol: params.symbol,
    legs: params.legs,
    spot: params.spot,
    openedAt: Date.now(),
    costBasis,
    status: "open",
  };

  const updatedAccount: SimAccount = { ...account, cash: account.cash - costBasis };
  saveAccountToStorage(updatedAccount);

  const positions = loadPositionsFromStorage();
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