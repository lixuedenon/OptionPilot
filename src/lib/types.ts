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
  // `locked`: true once this leg's derivedFrom state has been captured into
  // at least one saved TrackedSnapshot (useStrategyOrchestration.ts's
  // saveTrackedSnapshotTo bakes it in right before calling
  // addTrackedSnapshot, and also writes it back onto the live trackedLegs so
  // the UI updates immediately — not just applied after the fact). Xue's
  // reasoning: once a roll/protect/hedge has been recorded into history,
  // "撤销" would silently rewrite that history out from under an
  // already-saved snapshot (the snapshot itself is never touched — it's an
  // immutable past record — but the live "今日组合" would no longer match
  // what was saved, which defeats the point of having saved it). Only ever
  // set to true, never cleared — once locked, permanently locked; a fresh
  // roll/protect/hedge done AFTER this one is a separate leg with its own
  // unset `locked`, so it's freely undoable until IT gets saved in turn.
  // LegRow.tsx's deleteConfig checks this before offering "撤销" as an
  // actionable item — see its comment for the disabled/locked rendering.
  derivedFrom?: { legId?: string; via: "roll" | "protect" | "hedge"; locked?: boolean };
  // 2026-09-12: set only on a TRACKED-combo leg ("今日组合") the moment it's
  // closed (平仓) or rolled away from — the P&L it had realized at that
  // exact instant, frozen forever after. Distinct from `disabled` (which by
  // itself just means "temporarily excluded from calculations, no memory
  // of why"): before this field existed, 平仓/展期 either deleted the leg
  // outright or merely disabled it, and either way its contribution to the
  // position's total P&L silently vanished — xue's report that closing a
  // leg should book its P&L rather than erase it. useComboAnalytics.ts's
  // realizedTrackedPnl sums this across trackedLegs and TrackedComboSection
  // adds it to the displayed total; it deliberately does NOT feed into
  // trackedResult.change/netChange, so it shows up in the P&L summary
  // numbers only, not in the tracked curve PayoffChart.tsx draws (xue chose
  // "只更新盈亏汇总数字" over reshaping the chart). Never set on opening
  // combo ("legs") legs — that combo is a hypothetical construction, not an
  // actual position, so "realized P&L" has no meaning there; `deleteLeg`
  // there stays a plain removal. Cleared back to undefined if the leg is
  // ever reactivated (toggleTrackedLeg un-blocking it, or "撤销展期"
  // restoring a roll's source) — a live leg's P&L is computed fresh from
  // trackedResult again, and leaving a stale value here would double-count
  // it into realizedTrackedPnl on top of the live number.
  closedPnl?: number;
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