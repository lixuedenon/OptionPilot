// src/lib/positionHealth.ts
import type { Leg, Shifts, GreekBreakdown } from "./types";
import { probabilityOfProfit, legShiftedPrice } from "./pricing";

export type HealthStatus = "good" | "warning" | "bad";
export type HealthTier = "healthy" | "watch" | "warning" | "critical";

// Local alias instead of importing useI18n's type from I18nContext.tsx —
// this file has no React/JSX in it and shouldn't pull a component module
// in just for a function type. Structurally identical to I18nCtx["t"].
type TFunc = (key: string, vars?: Record<string, string | number>) => string;

export interface HealthFactor {
  label: string;
  status: HealthStatus;
  note: string;
  // One static, plain-language sentence explaining what this factor actually
  // measures — independent of the current value/status. Shown as a dimmer
  // second line under `note` in the popover so a user who doesn't already
  // know what "距盈亏平衡点" means can still act on the number. `note` stays
  // the concrete "here's your number and whether it's good" line; `meaning`
  // is the constant "here's what this number represents" line.
  meaning: string;
}

export interface HealthResult {
  score: number; // 0-100
  tier: HealthTier;
  summary: string; // one-line plain-language takeaway, not just raw numbers
  factors: HealthFactor[];
}

// Builds the hypothetical leg list representing "the position as it would
// look if the analysis-mode sliders' shift actually happened" — each
// option leg's dte is reduced by shifts.dT (floored at 0) and its premium
// is recomputed at the shifted price/vol via legShiftedPrice, un-signed
// and un-quantitied back to a plain per-contract price (legShiftedPrice
// returns sign*qty*price; dividing by sign*qty undoes both to match
// Leg.premium's own convention). Stock legs pass through unchanged.
//
// Health is evaluated against THIS shifted leg list at spot+shifts.dS —
// deliberately, not against the real "as of today" state — so it follows
// the sliders the same way decision-compare's "组合当前价值" does: the
// sliders represent a scenario to rehearse, and health should describe
// the position's condition IN that scenario, not always today's.
function buildShiftedLegs(legs: Leg[], shifts: Shifts, spot: number): Leg[] {
  return legs.map((leg) => {
    if (leg.kind === "stock") return leg;
    const sign = leg.action === "buy" ? 1 : -1;
    const qty = leg.qty ?? 1;
    const shiftedPremium = legShiftedPrice(leg, shifts, spot) / (sign * qty);
    const newDte = Math.max(0, Math.round(leg.dte - shifts.dT));
    return { ...leg, dte: newDte, premium: Math.max(0.01, shiftedPremium) };
  });
}

function clampFraction(value: number, badAt: number, goodAt: number): number {
  const f = (value - badAt) / (goodAt - badAt);
  return Math.max(0, Math.min(1, f));
}

function statusFromFraction(f: number): HealthStatus {
  if (f >= 0.66) return "good";
  if (f >= 0.33) return "warning";
  return "bad";
}

function buildSummary(tier: HealthTier, factors: HealthFactor[], t: TFunc): string {
  const bad = factors.filter((f) => f.status === "bad").map((f) => f.label);
  const warn = factors.filter((f) => f.status === "warning").map((f) => f.label);
  const sep = t("health.listSeparator");
  if (tier === "healthy" && bad.length === 0 && warn.length === 0) {
    return t("health.summary.healthy");
  }
  if (bad.length > 0) {
    return t("health.summary.bad", { list: bad.join(sep) });
  }
  if (warn.length > 0) {
    return t("health.summary.warn", { list: warn.join(sep) });
  }
  return t("health.summary.ok");
}

// Position Health is a composite score built entirely out of numbers this
// app already computes elsewhere (POP, breakevens, days to expiry, combo
// Greeks) — no new pricing math beyond the shift transform above. Four
// factors, 25 points each:
//
//   1. Probability of profit at the shifted scenario
//   2. Distance to nearest breakeven (also at the shifted scenario)
//   3. Days to expiry remaining AFTER the shifted time passage
//   4. Net delta exposure, normalized PER CONTRACT (not raw combo delta —
//      see the design notes on why raw delta unfairly penalizes larger
//      position sizes even when each contract's own risk is well-controlled)
//
// A "max loss vs max profit" risk/reward factor was tried and dropped in
// an earlier pass: for a premium-selling strategy (this app's primary use
// case), that ratio is almost always ugly by construction regardless of
// how well-chosen the strike is — it would penalize exactly the strategy
// type this app is built around, not flag genuinely reckless positions.
//
// All display text (labels, notes, static "what this means" lines, and the
// overall summary) is built from the `health.*` i18n keys via `t` — nothing
// here should be a hardcoded literal in either language. Callers (App.tsx)
// must include `t` (or the `lang` it depends on) in whatever memoizes this
// call, so results are recomputed when the language changes.
export function computeHealth(legs: Leg[], spot: number, shifts: Shifts, breakdown: GreekBreakdown, t: TFunc): HealthResult | null {
  const active = legs.filter((l) => !l.disabled);
  if (active.length === 0 || spot <= 0) return null;

  const shiftedSpot = Math.max(0.01, spot + shifts.dS);
  const shiftedLegs = buildShiftedLegs(active, shifts, spot);

  const factors: HealthFactor[] = [];
  let score = 0;

  // 1. Probability of profit (25 pts) — 30% or below is "bad", 70%+ is "good"
  const { pop, breakevens } = probabilityOfProfit(shiftedLegs, shiftedSpot);
  const popFraction = clampFraction(pop, 0.3, 0.7);
  score += popFraction * 25;
  const popSuffixKey =
    popFraction >= 0.66 ? "health.pop.suffixGood" : popFraction >= 0.33 ? "health.pop.suffixWarn" : "health.pop.suffixBad";
  factors.push({
    label: t("health.factor.pop"),
    status: statusFromFraction(popFraction),
    note: t("health.pop.note", { value: (pop * 100).toFixed(0) }) + t(popSuffixKey),
    meaning: t("health.pop.meaning"),
  });

  // 2. Distance to nearest breakeven, as % of the shifted spot (25 pts)
  if (breakevens.length > 0) {
    const nearestDistPct = Math.min(...breakevens.map((be) => Math.abs(shiftedSpot - be))) / shiftedSpot * 100;
    const beFraction = clampFraction(nearestDistPct, 2, 8);
    score += beFraction * 25;
    factors.push({
      label: t("health.factor.breakeven"),
      status: statusFromFraction(beFraction),
      note:
        t("health.breakeven.note", { value: nearestDistPct.toFixed(1) }) +
        (beFraction < 0.33 ? t("health.breakeven.suffixCritical") : ""),
      meaning: t("health.breakeven.meaning"),
    });
  } else {
    score += 25 * 0.5;
    factors.push({
      label: t("health.factor.breakeven"),
      status: "warning",
      note: t("health.breakeven.notFound"),
      meaning: t("health.breakeven.meaningNotFound"),
    });
  }

  // 3. Days to expiry remaining after the shift (25 pts)
  const optionLegs = shiftedLegs.filter((l) => l.kind !== "stock");
  if (optionLegs.length > 0) {
    const minDte = Math.min(...optionLegs.map((l) => l.dte));
    const dteFraction = clampFraction(minDte, 7, 30);
    score += dteFraction * 25;
    factors.push({
      label: t("health.factor.dte"),
      status: statusFromFraction(dteFraction),
      note:
        t("health.dte.note", { value: Math.round(minDte) }) +
        (dteFraction < 0.33 ? t("health.dte.suffixHighRisk") : ""),
      meaning: t("health.dte.meaning"),
    });
  } else {
    score += 25;
    factors.push({
      label: t("health.factor.dte"),
      status: "good",
      note: t("health.dte.noOptions"),
      meaning: t("health.dte.meaningNoOptions"),
    });
  }

  // 4. Net delta exposure, PER CONTRACT (25 pts) — dividing by total
  // quantity so a well-controlled 10-lot position doesn't get penalized
  // just for being bigger than a 1-lot one with the same per-contract risk.
  const totalQty = active.reduce((sum, l) => sum + (l.kind === "stock" ? 1 : (l.qty ?? 1)), 0);
  const avgDelta = totalQty > 0 ? breakdown.delta / totalQty : breakdown.delta;
  const absAvgDelta = Math.abs(avgDelta);
  const deltaFraction = clampFraction(absAvgDelta, 0.7, 0.3);
  score += deltaFraction * 25;
  factors.push({
    label: t("health.factor.delta"),
    status: statusFromFraction(deltaFraction),
    note:
      t("health.delta.note", {
        avg: `${avgDelta >= 0 ? "+" : ""}${avgDelta.toFixed(2)}`,
        net: `${breakdown.delta >= 0 ? "+" : ""}${breakdown.delta.toFixed(2)}`,
      }) + (deltaFraction < 0.33 ? t("health.delta.suffixDirectional") : ""),
    meaning: t("health.delta.meaning"),
  });

  const finalScore = Math.round(score);
  const tier: HealthTier = finalScore >= 75 ? "healthy" : finalScore >= 50 ? "watch" : finalScore >= 25 ? "warning" : "critical";
  const summary = buildSummary(tier, factors, t);

  return { score: finalScore, tier, summary, factors };
}