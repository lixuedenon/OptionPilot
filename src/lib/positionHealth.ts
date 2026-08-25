import type { Leg, GreekBreakdown } from "./types";
import { probabilityOfProfit } from "./pricing";

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
  factors: HealthFactor[];
}

// Position Health is a composite score built entirely out of numbers this
// app already computes elsewhere (POP, breakevens, days to expiry, combo
// Greeks) — no new pricing math, just a weighted read of four angles on
// "how exposed is this combo right now":
//
//   1. Probability of profit (30 pts)      — from probabilityOfProfit()
//   2. Distance to nearest breakeven (25)  — how much room before it flips
//   3. Days to expiry / gamma risk (25)    — very near expiry = twitchy
//   4. Net delta exposure (20)             — how directional it's become
//
// A "max loss vs max profit" risk/reward factor was tried and dropped: for
// a premium-selling strategy (this app's primary use case per
// STRATEGY_REQUIREMENTS — small defined credit against a theoretically
// large loss if deep ITM at expiry), that ratio is almost always ugly by
// construction, regardless of how well-chosen the strike is. Scoring it
// would penalize exactly the strategy type this app is built around, not
// flag genuinely reckless positions — see the verification notes for the
// synthetic test that caught this.
//
// Each factor is scored on a smooth gradient between a "good" and "bad"
// threshold rather than a hard cliff, so the number doesn't jump
// dramatically for a one-cent difference in the underlying inputs.
function clampFraction(value: number, badAt: number, goodAt: number): number {
  // Returns 0 at/beyond badAt, 1 at/beyond goodAt, linear in between.
  // Works whether goodAt > badAt (higher-is-better) or goodAt < badAt
  // (lower-is-better) — the ratio still lands in [0,1] either way.
  const f = (value - badAt) / (goodAt - badAt);
  return Math.max(0, Math.min(1, f));
}

function statusFromFraction(f: number): HealthStatus {
  if (f >= 0.66) return "good";
  if (f >= 0.33) return "warning";
  return "bad";
}

export function computeHealth(legs: Leg[], spot: number, breakdown: GreekBreakdown): HealthResult | null {
  const active = legs.filter((l) => !l.disabled);
  if (active.length === 0 || spot <= 0) return null;

  const factors: HealthFactor[] = [];
  let score = 0;

  // 1. Probability of profit (30 pts) — 30% or below is "bad", 70%+ is "good"
  const { pop, breakevens } = probabilityOfProfit(active, spot);
  const popFraction = clampFraction(pop, 0.3, 0.7);
  score += popFraction * 30;
  factors.push({
    label: "到期盈利概率",
    status: statusFromFraction(popFraction),
    note: `${(pop * 100).toFixed(0)}%${popFraction >= 0.66 ? "，处于相对安全区间" : popFraction >= 0.33 ? "，中等水平" : "，明显偏低"}`,
  });

  // 2. Distance to nearest breakeven, as % of spot (25 pts) — inside 2% is
  // "bad" (one bad day away from flipping), 8%+ is "good" cushion
  if (breakevens.length > 0) {
    const nearestDistPct = Math.min(...breakevens.map((be) => Math.abs(spot - be))) / spot * 100;
    const beFraction = clampFraction(nearestDistPct, 2, 8);
    score += beFraction * 25;
    factors.push({
      label: "距盈亏平衡点",
      status: statusFromFraction(beFraction),
      note: `现价距最近的盈亏平衡点约${nearestDistPct.toFixed(1)}%${beFraction < 0.33 ? "，非常接近临界" : ""}`,
    });
  } else {
    // No breakeven crossing in the scanned range — combo is either always
    // profitable or always losing at expiry regardless of price; treat as
    // neutral rather than guessing which.
    score += 25 * 0.5;
    factors.push({ label: "距盈亏平衡点", status: "warning", note: "扫描范围内没有找到盈亏平衡点" });
  }

  // 3. Days to expiry (25 pts) — under 7 days is "bad" (gamma risk climbs
  // fast near expiry), 30+ days is "good"
  const optionLegs = active.filter((l) => l.kind !== "stock");
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
    score += 25; // pure stock position has no expiry/gamma risk in this sense
    factors.push({ label: "临近到期风险", status: "good", note: "组合中没有期权腿，无到期风险" });
  }

  // 4. Net delta exposure (20 pts) — |delta| under 0.3 is "good" (roughly
  // market-neutral), over 1.0 reads as having drifted into a directional bet
  const absDelta = Math.abs(breakdown.delta);
  const deltaFraction = clampFraction(absDelta, 1.0, 0.3);
  score += deltaFraction * 20;
  factors.push({
    label: "方向暴露 (Delta)",
    status: statusFromFraction(deltaFraction),
    note: `组合净Delta ${breakdown.delta >= 0 ? "+" : ""}${breakdown.delta.toFixed(2)}${deltaFraction < 0.33 ? "，已经比较接近方向性持仓" : ""}`,
  });

  const finalScore = Math.round(score);
  const tier: HealthTier = finalScore >= 75 ? "healthy" : finalScore >= 50 ? "watch" : finalScore >= 25 ? "warning" : "critical";

  return { score: finalScore, tier, factors };
}