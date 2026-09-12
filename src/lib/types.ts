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
  // 2026-09-12: records which leg (if any) this one was created FROM via
  // Roll/Protect/Hedge, and which action created it — lets the UI show a
  // "linked to leg #N" badge (see lib/legLinks.ts) and lets deleteLeg/
  // closeTrackedLeg (useLegEditing.ts) auto-restore the source leg when the
  // person undoes a roll, instead of leaving them to manually re-enable one
  // leg and delete the other and hope they matched the right pair — xue
  // reported that was exactly the confusing part once more than one
  // roll/protect/hedge had happened. `legId` is present for roll/protect
  // (both act on one specific existing leg) but absent for hedge, which
  // targets the whole combo rather than any single leg (handleHedge takes
  // no legId — see useLegEditing.ts). Only meaningful within the SAME
  // legs/trackedLegs array it was set in — like openLegId above, leg ids
  // get regenerated when a strategy is opened/tracked again, so this link
  // isn't guaranteed to survive a save-and-reopen round trip; code reading
  // it already has to treat "referenced leg not found" as "no link" rather
  // than an error (see computeLegLinks in lib/legLinks.ts).
  derivedFrom?: { legId?: string; via: "roll" | "protect" | "hedge" };
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