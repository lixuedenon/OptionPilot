// src/lib/savedStrategies.ts
import type { Leg, Shifts } from "./types";
import { formatDateInput, parseDateInput, daysBetweenLocalDates, todayISO, calendarDaysSince } from "./dateUtils";
import { fetchHistoricalBars, repriceLegsAtDate } from "./historicalBackfill";

export interface TrackedSnapshot {
  id: string;
  legs: Leg[];
  spot: number;
  savedAt: number;
  // true when this entry was reconstructed by backfillTrackedSnapshots()
  // from a historical daily (open+close)/2 average plus theoretical
  // Black-Scholes repricing, rather than a real market refresh the person
  // actually did (addTrackedSnapshot(), via "保存追踪快照"). Same convention
  // as the Simulator's PositionSnapshot.estimated — see historicalBackfill.ts.
  estimated?: boolean;
}

export interface SavedStrategy {
  id: string;
  filename: string;
  symbol: string;
  spot: number;
  legs: Leg[];
  shifts: Shifts;
  createdAt: number;
  openingAt?: number;
  starred?: boolean;
  tracking?: boolean;
  trackedSnapshots?: TrackedSnapshot[];
}

const STORAGE_KEY = "optionpilot_saved_strategies";

function migrateLegacySnapshots(s: SavedStrategy): SavedStrategy {
  if (s.trackedSnapshots) return s;
  const legacyLegs = (s as unknown as { trackedLegs?: Leg[] }).trackedLegs;
  const legacyAt = (s as unknown as { trackedAt?: number }).trackedAt;
  if (legacyLegs && legacyLegs.length > 0) {
    return {
      ...s,
      trackedSnapshots: [{ id: `snap-${s.id}-legacy`, legs: legacyLegs, spot: s.spot, savedAt: legacyAt ?? s.createdAt }],
    };
  }
  return s;
}

function loadFromStorage(): SavedStrategy[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SavedStrategy[];
    return arr.map(migrateLegacySnapshots);
  } catch {
    return [];
  }
}

function saveToStorage(strategies: SavedStrategy[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(strategies));
}

export async function loadSavedStrategies(): Promise<SavedStrategy[]> {
  return loadFromStorage();
}

export async function saveStrategy(s: Omit<SavedStrategy, "id" | "createdAt">): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const newStrategy: SavedStrategy = {
    ...s,
    id: `strat-${Date.now()}`,
    createdAt: Date.now(),
  };
  strategies.unshift(newStrategy);
  saveToStorage(strategies);
  return strategies;
}

export async function overwriteStrategy(id: string, s: Omit<SavedStrategy, "id" | "createdAt">): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((st) => st.id === id);
  if (idx >= 0) {
    strategies[idx] = { ...strategies[idx], ...s, id, createdAt: strategies[idx].createdAt };
    saveToStorage(strategies);
  }
  return strategies;
}

export async function deleteSavedStrategy(id: string): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage().filter((s) => s.id !== id);
  saveToStorage(strategies);
  return strategies;
}

export async function renameSavedStrategy(id: string, filename: string): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((s) => s.id === id);
  if (idx >= 0) {
    strategies[idx] = { ...strategies[idx], filename };
    saveToStorage(strategies);
  }
  return strategies;
}

export async function reorderSavedStrategies(all: SavedStrategy[]): Promise<SavedStrategy[]> {
  saveToStorage(all);
  return all;
}

export async function toggleStarStrategy(id: string): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((s) => s.id === id);
  if (idx >= 0) {
    strategies[idx] = { ...strategies[idx], starred: !strategies[idx].starred };
    saveToStorage(strategies);
  }
  return strategies;
}

export async function toggleTrackStrategy(id: string): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((s) => s.id === id);
  if (idx >= 0) {
    strategies[idx] = { ...strategies[idx], tracking: !strategies[idx].tracking };
    saveToStorage(strategies);
  }
  return strategies;
}

export async function addTrackedSnapshot(id: string, legs: Leg[], spot: number, savedAt: number): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((s) => s.id === id);
  if (idx >= 0) {
    const snapshots = strategies[idx].trackedSnapshots ?? [];
    const snap: TrackedSnapshot = { id: `snap-${savedAt}-${Date.now()}`, legs, spot, savedAt };
    strategies[idx] = {
      ...strategies[idx],
      trackedSnapshots: [...snapshots, snap],
      tracking: true,
    };
    saveToStorage(strategies);
  }
  return strategies;
}

// Fills the gaps in a tracked strategy's snapshot history: for every
// historical trading day between when it was opened and today that has no
// snapshot yet (real or previously-backfilled) — because nobody had the app
// open in Compare Mode that day to save one — this reconstructs an
// estimated one from that day's (open+close)/2 average price instead of
// leaving the day blank. Real snapshots (from addTrackedSnapshot) always
// win: this never overwrites a day that already has ANY entry. Today itself
// is deliberately left for a live "保存追踪快照" to fill for real, not an
// estimate. Mirrors the Simulator's backfillSnapshots() (simAccount.ts) —
// same historicalBackfill.ts helpers, same flat-vol convention — just
// against SavedStrategy/TrackedSnapshot's shape instead of
// SimPosition/PositionSnapshot's. Called from App.tsx whenever a strategy
// is (re-)entered in Compare Mode (handleTrack / handleSwitchToCompare), so
// "今日组合" doesn't default to whatever was last manually refreshed, even
// if that was days or weeks ago.
export async function backfillTrackedSnapshots(id: string): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((s) => s.id === id);
  if (idx < 0 || !strategies[idx].symbol) return strategies;

  const strategy = strategies[idx];
  const existing = strategy.trackedSnapshots ?? [];
  const existingDates = new Set(existing.map((snap) => formatDateInput(snap.savedAt)));
  const openedISO = formatDateInput(strategy.openingAt ?? strategy.createdAt);
  const todayIso = todayISO();

  let bars;
  try {
    bars = await fetchHistoricalBars(strategy.symbol);
  } catch {
    // No historical data available (thinly-traded symbol, rate-limited,
    // etc.) — leave existing snapshots untouched rather than failing
    // whatever triggered this (entering Compare Mode should still work).
    return strategies;
  }

  const toAdd: TrackedSnapshot[] = [];
  for (const bar of bars) {
    if (bar.dateISO < openedISO) continue; // before this strategy existed
    if (bar.dateISO >= todayIso) continue; // today — a live save's job, not an estimate's
    if (existingDates.has(bar.dateISO)) continue; // already has a real or backfilled entry

    const daysElapsed = daysBetweenLocalDates(openedISO, bar.dateISO);
    const repriced = repriceLegsAtDate(strategy.legs, strategy.spot, bar.avgPrice, daysElapsed);
    toAdd.push({
      id: `snap-${bar.dateISO}-backfill`,
      legs: repriced,
      spot: bar.avgPrice,
      savedAt: parseDateInput(bar.dateISO) ?? Date.now(),
      estimated: true,
    });
  }

  if (toAdd.length === 0) return strategies;

  const merged = [...existing, ...toAdd].sort((a, b) => a.savedAt - b.savedAt);
  strategies[idx] = { ...strategy, trackedSnapshots: merged, tracking: true };
  saveToStorage(strategies);
  return strategies;
}

export async function updateSnapshotTime(strategyId: string, snapshotId: string, savedAt: number): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((s) => s.id === strategyId);
  if (idx >= 0) {
    const snapshots = strategies[idx].trackedSnapshots ?? [];
    strategies[idx] = {
      ...strategies[idx],
      trackedSnapshots: snapshots.map((snap) => (snap.id === snapshotId ? { ...snap, savedAt } : snap)),
    };
    saveToStorage(strategies);
  }
  return strategies;
}

export async function deleteTrackedSnapshot(strategyId: string, snapshotId: string): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((s) => s.id === strategyId);
  if (idx >= 0) {
    const snapshots = strategies[idx].trackedSnapshots ?? [];
    strategies[idx] = {
      ...strategies[idx],
      trackedSnapshots: snapshots.filter((snap) => snap.id !== snapshotId),
    };
    saveToStorage(strategies);
  }
  return strategies;
}

export function generateFilename(
  symbol: string,
  direction: "buy" | "sell",
  strategyName: string,
  legs: Leg[],
): string {
  const sym = symbol.trim().toLowerCase() || "unknown";

  const name = strategyName
    ? strategyName.toLowerCase().replace(/\s+/g, "")
    : "custom";

  const optLegs = legs.filter((l) => l.kind !== "stock");
  const strikeLeg = optLegs.length > 0 ? optLegs[0] : legs[0];
  const strike = strikeLeg ? Math.round(strikeLeg.strike) : 0;

  const dteLeg = optLegs.length > 0 ? optLegs[0] : legs[0];
  const dte = dteLeg?.dte ?? 30;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + Math.round(dte));
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = String(d.getFullYear());

  const today = new Date();
  const todayStr =
    `${today.getFullYear()}` +
    `${String(today.getMonth() + 1).padStart(2, "0")}` +
    `${String(today.getDate()).padStart(2, "0")}`;

  return `${sym}_${direction}_${todayStr}_${name}_${strike}_${mm}${dd}${yyyy}`;
}

// Serializes a combo's full comparable state (legs + shifts + opening
// time) into one string, so App.tsx can detect "has anything changed since
// the last save" with a cheap !== against a previously-stored baseline
// string, instead of a deep-equality check. Deliberately broader than
// findDuplicate's norm() above (which only compares leg composition, for
// "is this the same combo as an existing saved one" duplicate detection) —
// this one also folds in disabled/shares/shifts/openingAt because ANY of
// those changing should mark the combo as dirty relative to its baseline.
export function serializeStrategyState(sym: string, ls: Leg[], sh: Shifts, oa: number): string {
  const norm = (l: Leg) => `${l.action}-${l.type}-${l.strike}-${l.dte}-${l.premium}-${l.kind ?? "option"}-${l.shares ?? 100}-${l.qty ?? 1}-${l.disabled ?? false}`;
  return `${sym}|${ls.map(norm).join("|")}|${sh.dS}|${sh.dT}|${sh.dV}|${oa}`;
}

export function findDuplicate(
  candidate: { symbol: string; spot: number; legs: Leg[]; shifts: Shifts },
  existing: SavedStrategy[],
): SavedStrategy | null {
  const norm = (l: Leg) => `${l.action}-${l.type}-${l.strike}-${l.dte}-${l.premium}-${l.kind ?? "option"}-${l.qty ?? 1}`;
  const candidateKey = candidate.legs.map(norm).join("|");
  for (const s of existing) {
    if (s.symbol !== candidate.symbol) continue;
    // `candidate` (handleOpenStrategy/handleTrack's in-editor combo) always
    // arrives with dte already decayed to "today" — but `s.legs` (the saved
    // opening combo) never decays, it's frozen at save time. Comparing them
    // raw made a strategy opened from the library, then switched into
    // compare mode after any days had passed, fail to re-link via
    // trackingStrategyId (its dte no longer matched byte-for-byte) — see
    // 2026-09-12 bug report. Decay s.legs by the same elapsed-days amount
    // before comparing so both sides are on the same footing.
    const daysElapsed = calendarDaysSince(s.openingAt ?? s.createdAt);
    const sLegsDecayed = s.legs.map((l) =>
      l.kind === "stock" ? l : { ...l, dte: Math.max(0, l.dte - daysElapsed) },
    );
    const sKey = sLegsDecayed.map(norm).join("|");
    if (sKey === candidateKey) return s;
  }
  return null;
}