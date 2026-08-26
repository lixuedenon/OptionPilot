import type { Leg, Shifts, GreekBreakdown } from "./types";
import { probabilityOfProfit, legShiftedPrice } from "./pricing";

export type HealthStatus = "good" | "warning" | "bad";
export type HealthTier = "healthy" | "watch" | "warning" | "critical";

export interface HealthFactor {
  label: string;
  status: HealthStatus;
  note: string;
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

function buildSummary(tier: HealthTier, factors: HealthFactor[]): string {
  const bad = factors.filter((f) => f.status === "bad").map((f) => f.label);
  const warn = factors.filter((f) => f.status === "warning").map((f) => f.label);
  if (tier === "healthy" && bad.length === 0 && warn.length === 0) {
    return "整体状况良好，各项指标都在相对安全的区间内。";
  }
  if (bad.length > 0) {
    return `存在明显风险点：${bad.join("、")}偏弱，建议重点关注。`;
  }
  if (warn.length > 0) {
    return `整体可控，但${warn.join("、")}处于中等水平，值得留意。`;
  }
  return "整体状况尚可。";
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
export function computeHealth(legs: Leg[], spot: number, shifts: Shifts, breakdown: GreekBreakdown): HealthResult | null {
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
  factors.push({
    label: "到期盈利概率",
    status: statusFromFraction(popFraction),
    note: `${(pop * 100).toFixed(0)}%${popFraction >= 0.66 ? "，处于相对安全区间" : popFraction >= 0.33 ? "，中等水平" : "，明显偏低"}`,
  });

  // 2. Distance to nearest breakeven, as % of the shifted spot (25 pts)
  if (breakevens.length > 0) {
    const nearestDistPct = Math.min(...breakevens.map((be) => Math.abs(shiftedSpot - be))) / shiftedSpot * 100;
    const beFraction = clampFraction(nearestDistPct, 2, 8);
    score += beFraction * 25;
    factors.push({
      label: "距盈亏平衡点",
      status: statusFromFraction(beFraction),
      note: `距最近的盈亏平衡点约${nearestDistPct.toFixed(1)}%${beFraction < 0.33 ? "，非常接近临界" : ""}`,
    });
  } else {
    score += 25 * 0.5;
    factors.push({ label: "距盈亏平衡点", status: "warning", note: "扫描范围内没有找到盈亏平衡点" });
  }

  // 3. Days to expiry remaining after the shift (25 pts)
  const optionLegs = shiftedLegs.filter((l) => l.kind !== "stock");
  if (optionLegs.length > 0) {
    const minDte = Math.min(...optionLegs.map((l) => l.dte));
    const dteFraction = clampFraction(minDte, 7, 30);
    score += dteFraction * 25;
    factors.push({
      label: "临近到期风险",
      status: statusFromFraction(dteFraction),
      note: `最近一条腿剩${Math.round(minDte)}天${dteFraction < 0.33 ? "，Gamma风险较高，价格小幅波动可能明显影响盈亏" : ""}`,
    });
  } else {
    score += 25;
    factors.push({ label: "临近到期风险", status: "good", note: "组合中没有期权腿，无到期风险" });
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
    label: "方向暴露 (Delta)",
    status: statusFromFraction(deltaFraction),
    note: `平均每张合约Delta ${avgDelta >= 0 ? "+" : ""}${avgDelta.toFixed(2)}（组合净Delta ${breakdown.delta >= 0 ? "+" : ""}${breakdown.delta.toFixed(2)}）${deltaFraction < 0.33 ? "，已经比较接近方向性持仓" : ""}`,
  });

  const finalScore = Math.round(score);
  const tier: HealthTier = finalScore >= 75 ? "healthy" : finalScore >= 50 ? "watch" : finalScore >= 25 ? "warning" : "critical";
  const summary = buildSummary(tier, factors);

  return { score: finalScore, tier, summary, factors };
}