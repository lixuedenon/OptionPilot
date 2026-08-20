const MAX = 20;
const STORAGE_KEY = "optionpilot_recent_symbols";

function loadFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function saveToStorage(symbols: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
}

export async function loadRecentSymbols(): Promise<string[]> {
  return loadFromStorage();
}

export async function addRecentSymbol(symbol: string): Promise<string[]> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return loadFromStorage();
  let symbols = loadFromStorage().filter((s) => s !== sym);
  symbols.unshift(sym);
  if (symbols.length > MAX) symbols = symbols.slice(0, MAX);
  saveToStorage(symbols);
  return symbols;
}
