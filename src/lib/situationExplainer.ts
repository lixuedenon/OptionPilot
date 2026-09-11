// src/lib/situationExplainer.ts
import type { Leg, Shifts } from "./types";
import type { ComboResult, PnlAttribution } from "./pricing";
import { maxProfitLoss } from "./pricing";
import type { HealthResult } from "./positionHealth";

// Local alias instead of importing useI18n's type from I18nContext.tsx — same
// convention as positionHealth.ts: this file has no React/JSX in it and
// shouldn't pull a component module in just for a function type.
type TFunc = (key: string, vars?: Record<string, string | number>) => string;

export interface ExplainSection {
  title: string;
  body: string;
}

export interface SituationExplanation {
  headline: string;
  sections: ExplainSection[];
}

// Everything here is rule-based/local — no AI call, no network request (xue's
// explicit choice, 2026-09-09: "规则模板，本地即时生成"). It's built entirely
// out of numbers this app already computes elsewhere (priceCombo/positionHealth/
// attributePnl/maxProfitLoss), the same "no new pricing math" approach
// positionHealth.ts itself documents — this module only adds lightweight
// classification (which zone a P&L sits in, whether delta/DTE/breakeven
// distance crosses a threshold worth flagging) on top of already-computed
// values. Suggestions in the "可以怎么处理" section only ever point at
// features that already exist in the app (Roll/Hedge/Protect/Compare) — never
// a specific buy/sell/direction call (xue's other explicit choice: "只指向
//已有功能"). All display text goes through `t` — nothing here is a hardcoded
// literal in either language.

const DTE_HINT_THRESHOLD = 21; // same tastytrade-style convention SimulatorPage.tsx's DTE_ALERT_THRESHOLD uses
const HIGH_DELTA_THRESHOLD = 0.7; // matches positionHealth.ts's own "bad" boundary for avg delta per contract
const LOW_DELTA_THRESHOLD = 0.3; // matches positionHealth.ts's own "good" boundary for avg delta per contract
const BREAKEVEN_HINT_THRESHOLD = 3; // percent — a supplementary trigger for the action-hint section, deliberately a bit looser than positionHealth's own 2%/8% good/bad band since this is "worth a mention", not itself a score

function fmtSigned(n: number, digits = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

type PnlZone = "nearMaxProfit" | "profit" | "nearMaxLoss" | "loss" | "flat";

function classifyPnl(change: number, maxProfit: number, maxLoss: number): { zone: PnlZone; pct: number } {
  if (Math.abs(change) < 0.01) return { zone: "flat", pct: 0 };
  if (change > 0) {
    const pct = maxProfit > 0 ? (change / maxProfit) * 100 : 0;
    return { zone: pct >= 70 ? "nearMaxProfit" : "profit", pct };
  }
  // maxLoss is itself negative (it's a PnL value), so change/maxLoss is positive when both are negative
  const pct = maxLoss < 0 ? (change / maxLoss) * 100 : 0;
  return { zone: pct >= 70 ? "nearMaxLoss" : "loss", pct };
}

function pnlBody(t: TFunc, zone: PnlZone, change: number, pct: number): string {
  const changeStr = fmtSigned(change, 0);
  switch (zone) {
    case "nearMaxProfit":
      return t("explain.pnlBodyNearMaxProfit", { change: changeStr, pct: pct.toFixed(0) });
    case "profit":
      return t("explain.pnlBodyProfit", { change: changeStr, pct: pct.toFixed(0) });
    case "nearMaxLoss":
      return t("explain.pnlBodyNearMaxLoss", { change: changeStr, pct: pct.toFixed(0) });
    case "loss":
      return t("explain.pnlBodyLoss", { change: changeStr, pct: pct.toFixed(0) });
    default:
      return t("explain.pnlBodyFlat", { change: changeStr });
  }
}

function deltaBody(t: TFunc, avgDelta: number): string {
  const a = Math.abs(avgDelta);
  const deltaStr = fmtSigned(avgDelta);
  const key = a >= HIGH_DELTA_THRESHOLD ? "explain.deltaBodyHigh" : a >= LOW_DELTA_THRESHOLD ? "explain.deltaBodyModerate" : "explain.deltaBodyLow";
  return t(key, { delta: deltaStr });
}

function avgDeltaPerContract(legs: Leg[], netDelta: number): number {
  const totalQty = legs.reduce((sum, l) => sum + (l.kind === "stock" ? 1 : (l.qty ?? 1)), 0);
  return totalQty > 0 ? netDelta / totalQty : netDelta;
}

// Nearest breakeven distance as a % of the given spot — breakevens themselves
// are shift-invariant (structural property of strikes/premiums only, see
// findBreakevens in pricing.ts), only which spot we measure distance from
// changes between analysis mode (shifted spot) and compare mode (today's spot).
function nearestBreakevenPct(breakevens: number[], atSpot: number): number | null {
  if (breakevens.length === 0 || atSpot <= 0) return null;
  return (Math.min(...breakevens.map((be) => Math.abs(atSpot - be))) / atSpot) * 100;
}

// Analysis mode: DTE remaining AFTER the slider's time shift — mirrors
// positionHealth.ts's buildShiftedLegs dte adjustment (that function itself
// is private/non-exported, so this is a minimal standalone re-derivation of
// just the dte part, not a duplicate of its premium-repricing logic).
function minShiftedDte(legs: Leg[], dT: number): number | null {
  const optionLegs = legs.filter((l) => l.kind !== "stock");
  if (optionLegs.length === 0) return null;
  return Math.min(...optionLegs.map((l) => Math.max(0, Math.round(l.dte - dT))));
}

function minDte(legs: Leg[]): number | null {
  const optionLegs = legs.filter((l) => l.kind !== "stock");
  if (optionLegs.length === 0) return null;
  return Math.min(...optionLegs.map((l) => l.dte));
}

// Deliberately NOT re-listing each of health.factors here (xue's explicit
// call, 2026-09-09: this used to copy PositionHealthBadge.tsx's popover
// content verbatim — POP/breakeven-distance/DTE/delta shown twice, word for
// word, in two different UI surfaces). This section now carries only the
// score plus health's own synthesized one-line summary (already rolls up
// which factors are bad/warning — see positionHealth.ts's buildSummary) and
// a pointer back to the badge for the four-factor breakdown, which stays
// the single source of truth for that detail. The standalone "方向暴露"
// section built by deltaBody() below is NOT redundant with this any more —
// it's the only delta-specific content left in this dialog.
function healthSections(t: TFunc, health: HealthResult | null): ExplainSection[] {
  if (!health) return [];
  return [
    {
      title: t("explain.healthTitle"),
      body: t("explain.healthSummaryBody", { score: String(health.score), summary: health.summary }),
    },
  ];
}

// Shared tail of both explainers: Roll/Hedge/Protect are available from both
// the opening combo (analysis mode) and today's combo (compare mode, see
// TrackedComboSection.tsx's onRoll/onHedge/onProtect), so those three hints
// are worded identically either way. Decision Compare ("决策对比") is
// analysis-mode only (see CLAUDE.md's "五、2" — TrackedComboSection.tsx
// never gets an onCompare prop), so the near-max-profit/loss hints — the
// only ones that would naturally reach for it — get a mode-specific pair of
// keys instead.
function actionHints(t: TFunc, params: {
  isCompareMode: boolean;
  dte: number | null;
  avgDelta: number;
  breakevenPct: number | null;
  zone: PnlZone;
  pct: number;
}): string {
  const { isCompareMode, dte, avgDelta, breakevenPct, zone, pct } = params;
  const hints: string[] = [];

  if (dte !== null && dte <= DTE_HINT_THRESHOLD) {
    hints.push(t("explain.actionDte", { dte: dte.toFixed(0) }));
  }
  if (Math.abs(avgDelta) >= HIGH_DELTA_THRESHOLD) {
    hints.push(t("explain.actionDelta", { delta: fmtSigned(avgDelta) }));
  }
  if (breakevenPct !== null && breakevenPct < BREAKEVEN_HINT_THRESHOLD) {
    hints.push(t("explain.actionBreakeven", { pct: breakevenPct.toFixed(1) }));
  }
  if (zone === "nearMaxProfit") {
    hints.push(t(isCompareMode ? "explain.actionNearMaxProfitCompare" : "explain.actionNearMaxProfitAnalysis", { pct: pct.toFixed(0) }));
  }
  if (zone === "nearMaxLoss") {
    hints.push(t(isCompareMode ? "explain.actionNearMaxLossCompare" : "explain.actionNearMaxLossAnalysis", { pct: pct.toFixed(0) }));
  }

  return hints.length > 0 ? hints.join(" ") : t("explain.actionNone");
}

// Analysis mode: explains what the CURRENT SLIDER POSITION means — a
// forward-looking scenario rehearsal, same framing as help.moduleAnalysisIntro.
export function explainAnalysisScenario(params: {
  legs: Leg[];
  spot: number;
  shifts: Shifts;
  result: ComboResult;
  health: HealthResult | null;
  attribution: PnlAttribution | null;
  breakevens: number[];
  t: TFunc;
}): SituationExplanation | null {
  const { legs, spot, shifts, result, health, attribution, breakevens, t } = params;
  const active = legs.filter((l) => !l.disabled);
  if (active.length === 0 || spot <= 0) return null;

  const shiftedSpot = Math.max(0.01, spot + shifts.dS);
  const spotPct = spot > 0 ? (shifts.dS / spot) * 100 : 0;
  const { maxProfit, maxLoss } = maxProfitLoss(active, spot);
  const { zone, pct } = classifyPnl(result.change, maxProfit, maxLoss);
  const avgDelta = avgDeltaPerContract(active, result.breakdown.delta);

  const sections: ExplainSection[] = [
    {
      title: t("explain.scenarioTitle"),
      body: t("explain.scenarioBody", {
        spot: shiftedSpot.toFixed(2),
        spotChange: fmtSigned(shifts.dS),
        spotPct: fmtSigned(spotPct, 1) + "%",
        days: shifts.dT.toFixed(0),
        vol: fmtSigned(shifts.dV, 0) + "%",
      }),
    },
    { title: t("explain.pnlTitle"), body: pnlBody(t, zone, result.change, pct) },
  ];

  if (attribution) {
    sections.push({
      title: t("explain.attributionTitle"),
      body: t("explain.attributionBody", {
        price: fmtSigned(attribution.priceEffect, 0),
        time: fmtSigned(attribution.timeEffect, 0),
        iv: fmtSigned(attribution.ivEffect, 0),
      }),
    });
  }

  sections.push({ title: t("explain.deltaTitle"), body: deltaBody(t, avgDelta) });
  sections.push(...healthSections(t, health));
  sections.push({
    title: t("explain.actionsTitle"),
    body: actionHints(t, {
      isCompareMode: false,
      dte: minShiftedDte(active, shifts.dT),
      avgDelta,
      breakevenPct: nearestBreakevenPct(breakevens, shiftedSpot),
      zone,
      pct,
    }),
  });

  return {
    headline: t("explain.headlineAnalysis", { spot: shiftedSpot.toFixed(2), days: shifts.dT.toFixed(0) }),
    sections,
  };
}

// Compare mode: explains what the CURRENT TRACKED POSITION means — a
// backward-looking read of what actually happened since opening, same
// framing as help.moduleCompareIntro. `greeks` is trackedGreeks (the real
// Black-Scholes combo Greeks at today's spot/premiums, zero shift) — NOT
// trackedResult, which carries a hardcoded-zero GreekBreakdown (see
// useComboAnalytics.ts's own comment on why those two are deliberately
// separate memos).
export function explainTrackedPosition(params: {
  legs: Leg[];
  openingSpot: number;
  trackedSpot: number;
  daysElapsed: number;
  result: ComboResult;
  greeks: ComboResult | null;
  health: HealthResult | null;
  attribution: PnlAttribution | null;
  breakevens: number[];
  t: TFunc;
}): SituationExplanation | null {
  const { legs, openingSpot, trackedSpot, daysElapsed, result, greeks, health, attribution, breakevens, t } = params;
  const active = legs.filter((l) => !l.disabled);
  if (active.length === 0 || trackedSpot <= 0) return null;

  const spotChange = trackedSpot - openingSpot;
  const spotPct = openingSpot > 0 ? (spotChange / openingSpot) * 100 : 0;
  const { maxProfit, maxLoss } = maxProfitLoss(active, trackedSpot);
  const { zone, pct } = classifyPnl(result.change, maxProfit, maxLoss);

  const sections: ExplainSection[] = [
    {
      title: t("explain.stateTitle"),
      body: t("explain.stateBody", {
        days: daysElapsed.toFixed(0),
        openSpot: openingSpot.toFixed(2),
        spot: trackedSpot.toFixed(2),
        spotChange: fmtSigned(spotChange),
        spotPct: fmtSigned(spotPct, 1) + "%",
      }),
    },
    { title: t("explain.pnlTitle"), body: pnlBody(t, zone, result.change, pct) },
  ];

  if (attribution) {
    sections.push({
      title: t("explain.attributionTitle"),
      body: t("explain.attributionBody", {
        price: fmtSigned(attribution.priceEffect, 0),
        time: fmtSigned(attribution.timeEffect, 0),
        iv: fmtSigned(attribution.ivEffect, 0),
      }),
    });
  }

  let avgDelta = 0;
  if (greeks) {
    avgDelta = avgDeltaPerContract(active, greeks.breakdown.delta);
    sections.push({ title: t("explain.deltaTitle"), body: deltaBody(t, avgDelta) });
  }

  sections.push(...healthSections(t, health));
  sections.push({
    title: t("explain.actionsTitle"),
    body: actionHints(t, {
      isCompareMode: true,
      dte: minDte(active),
      avgDelta,
      breakevenPct: nearestBreakevenPct(breakevens, trackedSpot),
      zone,
      pct,
    }),
  });

  return {
    headline: t("explain.headlineCompare", { days: daysElapsed.toFixed(0) }),
    sections,
  };
}