import type { SavedStrategy } from "./savedStrategies";
import type { CustomPreset } from "./customPresets";

export interface ExportData {
  version: 1;
  exportedAt: number;
  savedStrategies: SavedStrategy[];
  customPresets: CustomPreset[];
  recentSymbols: string[];
}

export function exportAllData(): void {
  const data: ExportData = {
    version: 1,
    exportedAt: Date.now(),
    savedStrategies: JSON.parse(localStorage.getItem("optionpilot_saved_strategies") ?? "[]"),
    customPresets: JSON.parse(localStorage.getItem("optionpilot_custom_presets") ?? "[]"),
    recentSymbols: JSON.parse(localStorage.getItem("optionpilot_recent_symbols") ?? "[]"),
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

  if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
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

  return parsed;
}
