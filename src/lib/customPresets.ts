import type { Leg } from "./types";

export interface CustomPreset {
  id: string;
  name: string;
  desc: string;
  market: string;
  stocks: string;
  direction: string;
  legs: Leg[];
  createdAt: number;
}

const STORAGE_KEY = "optionpilot_custom_presets";

function loadFromStorage(): CustomPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CustomPreset[];
  } catch {
    return [];
  }
}

function saveToStorage(presets: CustomPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export async function loadCustomPresets(): Promise<CustomPreset[]> {
  return loadFromStorage();
}

export async function addCustomPreset(p: Omit<CustomPreset, "id" | "createdAt">): Promise<CustomPreset[]> {
  const presets = loadFromStorage();
  const newPreset: CustomPreset = {
    ...p,
    id: `cp-${Date.now()}`,
    createdAt: Date.now(),
  };
  presets.push(newPreset);
  saveToStorage(presets);
  return presets;
}

export async function deleteCustomPreset(id: string): Promise<CustomPreset[]> {
  const presets = loadFromStorage().filter((p) => p.id !== id);
  saveToStorage(presets);
  return presets;
}
