export type OptionType = "call" | "put";
export type Action = "buy" | "sell";
export type LegKind = "option" | "stock";

export interface Leg {
  id: string;
  action: Action;
  type: OptionType;
  strike: number;
  dte: number; // days to expiry
  premium: number; // current option price ($)
  kind?: LegKind; // "stock" for a 100-share underlying leg
  shares?: number; // number of shares (100 for standard lot)
  qty?: number; // number of contracts, options legs only (default 1 if omitted)
  disabled?: boolean; // soft-delete: leg stays visible but excluded from calculations
}

export interface Shifts {
  dS: number; // spot change ($)
  dT: number; // days forward
  dV: number; // vol change (percentage points)
}

export interface GreekBreakdown {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  total: number;
}