import type { Leg, Shifts } from "./types";

export interface TrackedSnapshot {
  id: string;
  legs: Leg[];
  spot: number;
  savedAt: number;
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

export function findDuplicate(
  candidate: { symbol: string; spot: number; legs: Leg[]; shifts: Shifts },
  existing: SavedStrategy[],
): SavedStrategy | null {
  const norm = (l: Leg) => `${l.action}-${l.type}-${l.strike}-${l.dte}-${l.premium}-${l.kind ?? "option"}-${l.qty ?? 1}`;
  const candidateKey = candidate.legs.map(norm).join("|");
  for (const s of existing) {
    if (s.symbol !== candidate.symbol) continue;
    const sKey = s.legs.map(norm).join("|");
    if (sKey === candidateKey) return s;
  }
  return null;
}