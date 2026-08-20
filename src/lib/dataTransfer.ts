import type { SavedStrategy } from "./savedStrategies";
import type { CustomPreset } from "./customPresets";
import type { SimAccount, SimPosition, PositionSnapshot } from "./simAccount";

export interface ExportData {
  version: 1 | 2;
  exportedAt: number;
  savedStrategies: SavedStrategy[];
  customPresets: CustomPreset[];
  recentSymbols: string[];
  // Added in version 2 — the simulated account (balance, open/closed
  // positions, daily mark-to-market snapshots) previously lived only in
  // localStorage and wasn't covered by backup/restore at all, so trading
  // history could silently disappear on a cache clear or browser switch.
  // Optional so version-1 backup files (and any restore of them) still work.
  simAccount?: SimAccount | null;
  simPositions?: SimPosition[];
  simSnapshots?: PositionSnapshot[];
}

export function exportAllData(): void {
  const data: ExportData = {
    version: 2,
    exportedAt: Date.now(),
    savedStrategies: JSON.parse(localStorage.getItem("optionpilot_saved_strategies") ?? "[]"),
    customPresets: JSON.parse(localStorage.getItem("optionpilot_custom_presets") ?? "[]"),
    recentSymbols: JSON.parse(localStorage.getItem("optionpilot_recent_symbols") ?? "[]"),
    simAccount: JSON.parse(localStorage.getItem("optionpilot_sim_account") ?? "null"),
    simPositions: JSON.parse(localStorage.getItem("optionpilot_sim_positions") ?? "[]"),
    simSnapshots: JSON.parse(localStorage.getItem("optionpilot_sim_snapshots") ?? "[]"),
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const d = new Date();
  const ts =
    `${d.getFullYear()}` +
    `${String(d.getMonth() + 1).padStart(2, "0")}` +
    `${String(d.getDate()).padStart(2, "0")}` +
    `_${String(d.getHours()).padStart(2, "0")}` +
    `${String(d.getMinutes()).padStart(2, "0")}`;
  a.download = `optionpilot_backup_${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importAllData(file: File): Promise<ExportData> {
  const text = await file.text();
  const parsed = JSON.parse(text) as ExportData;

  if (!parsed || typeof parsed !== "object" || (parsed.version !== 1 && parsed.version !== 2)) {
    throw new Error("文件格式不正确");
  }

  if (Array.isArray(parsed.savedStrategies)) {
    localStorage.setItem("optionpilot_saved_strategies", JSON.stringify(parsed.savedStrategies));
  }
  if (Array.isArray(parsed.customPresets)) {
    localStorage.setItem("optionpilot_custom_presets", JSON.stringify(parsed.customPresets));
  }
  if (Array.isArray(parsed.recentSymbols)) {
    localStorage.setItem("optionpilot_recent_symbols", JSON.stringify(parsed.recentSymbols));
  }
  // version-1 backups predate these fields entirely, so leave existing
  // simulated-account data untouched rather than wiping it on import.
  if (parsed.simAccount !== undefined) {
    localStorage.setItem("optionpilot_sim_account", JSON.stringify(parsed.simAccount));
  }
  if (Array.isArray(parsed.simPositions)) {
    localStorage.setItem("optionpilot_sim_positions", JSON.stringify(parsed.simPositions));
  }
  if (Array.isArray(parsed.simSnapshots)) {
    localStorage.setItem("optionpilot_sim_snapshots", JSON.stringify(parsed.simSnapshots));
  }

  return parsed;
}