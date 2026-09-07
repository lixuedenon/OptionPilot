// src/lib/types.ts
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
  // Compare-mode only: the id this leg had in the OPENING combo ("legs") at
  // the moment a trackedLegs entry was derived/cloned from it (trackedLegs
  // always gets a fresh uid() for its own `id`, so this is the only
  // surviving link back to "which opening leg does this correspond to").
  // Used instead of array-index pairing (App.tsx's trackedResult,
  // pricing.ts's impliedSpotFromPremiums, PayoffChart.tsx's
  // calcTrackedPnL/calcTrackedPnLAtTime) because legs/trackedLegs can
  // reorder or grow independently (moveTrackedLeg, a roll/hedge/protect
  // added directly to trackedLegs) — position alone stops meaning "the same
  // leg" the moment that happens. Undefined for opening-combo legs
  // themselves, and for a tracked leg that has no opening counterpart (e.g.
  // a hedge added straight to trackedLegs post-2026-09-06) — callers that
  // key off this field already treat "no match found" as a leg standing on
  // its own, not an error.
  openLegId?: string;
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