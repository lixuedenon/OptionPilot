// src/lib/pricing.ts
import type { Leg, Shifts, GreekBreakdown } from "./types";
import { blackScholes, ncdf } from "./bs";

const RATE = 0.05;

// Back out implied vol from premium via bisection (bounded 0.01–5).
export function impliedVol(spot: number, strike: number, dte: number, premium: number, type: "call" | "put"): number {
  let lo = 0.01, hi = 5.0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const p = blackScholes({ spot, strike, dte, vol: mid, rate: RATE, type }).price;
    if (p < premium) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Full B-S repricing of a single leg under the given shifts.
// dS: spot change ($), dT: calendar days elapsed, dV: vol change (percentage points).
export function legShiftedPrice(leg: Leg, s: Shifts, spot: number): number {
  const sign = leg.action === "buy" ? 1 : -1;
  const qty = leg.qty ?? 1;

  // Stock leg: per-unit PnL, same scale as option contracts (no × shares multiplier)
  if (leg.kind === "stock") {
    const newSpot = Math.max(0.01, spot + s.dS);
    return sign * (newSpot - leg.strike);
  }

  const iv = impliedVol(spot, leg.strike, leg.dte, leg.premium, leg.type);
  const newDte = Math.max(0, leg.dte - s.dT);
  const newVol = Math.max(0.01, iv + s.dV / 100);
  const newSpot = Math.max(0.01, spot + s.dS);

  let newPrice: number;
  if (newDte <= 0) {
    newPrice = leg.type === "call"
      ? Math.max(0, newSpot - leg.strike)
      : Math.max(0, leg.strike - newSpot);
  } else {
    newPrice = blackScholes({ spot: newSpot, strike: leg.strike, dte: newDte, vol: newVol, rate: RATE, type: leg.type }).price;
  }
  return newPrice * sign * qty;
}

// Greek breakdown via finite differences around the shifted state.
export function legGreekBreakdown(leg: Leg, s: Shifts, spot: number): GreekBreakdown {
  const sign = leg.action === "buy" ? 1 : -1;
  const qty = leg.qty ?? 1;

  // Stock leg: delta = 1 per unit (no γ/θ/ν), total is per-unit PnL
  if (leg.kind === "stock") {
    const newSpot = Math.max(0.01, spot + s.dS);
    const total = sign * (newSpot - leg.strike);
    return { delta: sign, gamma: 0, theta: 0, vega: 0, total };
  }

  const iv = impliedVol(spot, leg.strike, leg.dte, leg.premium, leg.type);
  const newDte = Math.max(0, leg.dte - s.dT);
  const newVol = Math.max(0.01, iv + s.dV / 100);
  const newSpot = Math.max(0.01, spot + s.dS);

  const basePrice = newDte <= 0
    ? (leg.type === "call" ? Math.max(0, newSpot - leg.strike) : Math.max(0, leg.strike - newSpot))
    : blackScholes({ spot: newSpot, strike: leg.strike, dte: newDte, vol: newVol, rate: RATE, type: leg.type }).price;

  const dSpot = 1;
  const upSpot = newSpot + dSpot;
  const upPrice = newDte <= 0
    ? (leg.type === "call" ? Math.max(0, upSpot - leg.strike) : Math.max(0, leg.strike - upSpot))
    : blackScholes({ spot: upSpot, strike: leg.strike, dte: newDte, vol: newVol, rate: RATE, type: leg.type }).price;
  const delta = (upPrice - basePrice);

  const dnSpot = Math.max(0.01, newSpot - dSpot);
  const dnPrice = newDte <= 0
    ? (leg.type === "call" ? Math.max(0, dnSpot - leg.strike) : Math.max(0, leg.strike - dnSpot))
    : blackScholes({ spot: dnSpot, strike: leg.strike, dte: newDte, vol: newVol, rate: RATE, type: leg.type }).price;
  const gamma = (upPrice - 2 * basePrice + dnPrice) / (dSpot * dSpot);

  const thetaDte = Math.max(0, newDte - 1);
  const thetaPrice = thetaDte <= 0
    ? (leg.type === "call" ? Math.max(0, newSpot - leg.strike) : Math.max(0, leg.strike - newSpot))
    : blackScholes({ spot: newSpot, strike: leg.strike, dte: thetaDte, vol: newVol, rate: RATE, type: leg.type }).price;
  const theta = (thetaPrice - basePrice);

  const vegaVol = newVol + 0.01;
  const vegaPrice = newDte <= 0
    ? (leg.type === "call" ? Math.max(0, newSpot - leg.strike) : Math.max(0, leg.strike - newSpot))
    : blackScholes({ spot: newSpot, strike: leg.strike, dte: newDte, vol: vegaVol, rate: RATE, type: leg.type }).price;
  const vega = (vegaPrice - basePrice);

  const total = basePrice - leg.premium;

  return {
    delta: delta * sign * qty,
    gamma: gamma * sign * qty,
    theta: theta * sign * qty,
    vega: vega * sign * qty,
    total: total * sign * qty,
  };
}

export interface ComboResult {
  netPremium: number;
  shiftedValue: number;
  change: number;
  breakdown: GreekBreakdown;
  perLeg: { leg: Leg; base: number; shifted: number; change: GreekBreakdown }[];
}

export function priceCombo(legs: Leg[], s: Shifts, spot: number): ComboResult {
  let netPremium = 0;
  let shiftedValue = 0;
  const breakdown: GreekBreakdown = { delta: 0, gamma: 0, theta: 0, vega: 0, total: 0 };
  const perLeg = legs.map((leg) => {
    const sign = leg.action === "buy" ? 1 : -1;
    const qty = leg.qty ?? 1;
    const base = leg.kind === "stock" ? 0 : leg.premium * sign * qty;
    const shifted = legShiftedPrice(leg, s, spot);
    const change = legGreekBreakdown(leg, s, spot);

    netPremium += base;
    shiftedValue += shifted;
    breakdown.delta += change.delta;
    breakdown.gamma += change.gamma;
    breakdown.theta += change.theta;
    breakdown.vega += change.vega;
    breakdown.total += change.total;

    return { leg, base, shifted, change };
  });

  return {
    netPremium,
    shiftedValue,
    change: shiftedValue - netPremium,
    breakdown,
    perLeg,
  };
}

// ── Probability of Profit (PoP) ──

// Compute the PnL for a given terminal spot price. For a single-expiry
// combo (the common case) this is exactly "at expiry" — every leg is
// intrinsic value only. For a MULTI-expiry combo (a calendar/diagonal,
// where legs don't share one dte), "at expiry" isn't one single moment —
// the correct evaluation point is the EARLIEST leg's own expiry (the
// "horizon"): legs that share that horizon dte are genuinely expiring
// then (intrinsic value is correct for them), but a leg with a LATER dte
// still has real time value at that moment and needs Black-Scholes, not
// intrinsic value, or its worth gets silently understated (this was the
// bug behind a calendar spread's "max loss" once coming out positive —
// nonsense, since pure-intrinsic pricing was pretending the far leg had
// already expired too). The far leg's implied vol is backed out from its
// OWN opening premium at `spot` (the position's real opening price, not
// sTest) and held constant — the same "flat vol" assumption already used
// everywhere else in this file (attributePnl, legShiftedPrice, etc.), not
// a new one introduced here.
export function pnlAtExpiry(legs: Leg[], sTest: number, spot?: number): number {
  const optionLegs = legs.filter((l) => l.kind !== "stock");
  const dtes = optionLegs.map((l) => l.dte);
  const horizonDte = dtes.length > 0 ? Math.min(...dtes) : 0;
  const multiExpiry = new Set(dtes).size > 1;

  let pnl = 0;
  for (const l of legs) {
    const sign = l.action === "buy" ? 1 : -1;
    if (l.kind === "stock") {
      pnl += sign * (sTest - l.strike); // per-unit, no × shares
      continue;
    }
    const qty = l.qty ?? 1;
    const remainingDte = l.dte - horizonDte;
    let value: number;
    if (!multiExpiry || remainingDte <= 0 || spot === undefined || spot <= 0) {
      // Single-expiry (the normal case), or this particular leg IS at the
      // horizon already, or no opening spot was given to back out an
      // implied vol from (callers that only ever pass single-expiry combos
      // don't need to pass spot at all — this mirrors the old 2-argument
      // behavior exactly when spot is omitted).
      value = l.type === "call" ? Math.max(0, sTest - l.strike) : Math.max(0, l.strike - sTest);
    } else {
      const iv = impliedVol(spot, l.strike, l.dte, l.premium, l.type);
      value = blackScholes({ spot: sTest, strike: l.strike, dte: remainingDte, vol: iv, rate: RATE, type: l.type }).price;
    }
    pnl += sign * qty * (value - l.premium);
  }
  return pnl;
}

// Max profit / max loss at expiry, scanned across the same spot window
// findBreakevens uses (±50% of spot, or at least ±$20) — mirrors what
// PayoffChart computes inline for its own chart rendering, exposed here as
// a standalone function so other features (e.g. decision comparison) can
// get the same numbers without duplicating the chart's scan logic.
export function maxProfitLoss(legs: Leg[], spot: number): { maxProfit: number; maxLoss: number } {
  if (legs.length === 0 || spot <= 0) return { maxProfit: 0, maxLoss: 0 };
  const range = Math.max(20, spot * 0.5);
  const sMin = Math.max(0.01, spot - range);
  const sMax = spot + range;
  const N = 500;
  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  for (let i = 0; i <= N; i++) {
    const s = sMin + (i / N) * (sMax - sMin);
    const pnl = pnlAtExpiry(legs, s, spot);
    if (pnl > maxProfit) maxProfit = pnl;
    if (pnl < maxLoss) maxLoss = pnl;
  }
  return { maxProfit, maxLoss };
}

// Same spot window as maxProfitLoss, but returns the sampled points
// themselves instead of just the min/max — for drawing an actual payoff
// curve (e.g. the decision-comparison mini-chart) rather than reporting a
// single number. Fewer samples than maxProfitLoss's scan (60 vs 500) since
// a small inline chart doesn't need that resolution and this runs once per
// scenario shown.
export interface PayoffPoint {
  spot: number;
  pnl: number;
}

export function payoffCurvePoints(legs: Leg[], spot: number, points = 60): PayoffPoint[] {
  if (legs.length === 0 || spot <= 0) return [];
  const range = Math.max(20, spot * 0.5);
  const sMin = Math.max(0.01, spot - range);
  const sMax = spot + range;
  const out: PayoffPoint[] = [];
  for (let i = 0; i <= points; i++) {
    const s = sMin + (i / points) * (sMax - sMin);
    out.push({ spot: s, pnl: pnlAtExpiry(legs, s, spot) });
  }
  return out;
}

// Find breakeven points by sampling the PnL curve and detecting sign changes.
export function findBreakevens(legs: Leg[], spot: number): number[] {
  const range = Math.max(20, spot * 0.5);
  const sMin = Math.max(0.01, spot - range);
  const sMax = spot + range;
  const N = 1000;
  const bes: number[] = [];
  let prevPnl = pnlAtExpiry(legs, sMin, spot);
  let prevS = sMin;
  for (let i = 1; i <= N; i++) {
    const s = sMin + (i / N) * (sMax - sMin);
    const pnl = pnlAtExpiry(legs, s, spot);
    if ((prevPnl < 0 && pnl >= 0) || (prevPnl > 0 && pnl <= 0)) {
      // linear interpolation for the crossing point
      const t = prevPnl / (prevPnl - pnl);
      bes.push(prevS + t * (s - prevS));
    }
    prevPnl = pnl;
    prevS = s;
  }
  return bes;
}

// Compute PoP assuming lognormal terminal spot distribution. For a
// single-expiry combo this is evaluated at the (premium-weighted average,
// though all legs share one dte anyway) expiry as before. For a MULTI-
// expiry combo, the distribution's time horizon T uses the EARLIEST leg's
// own dte — that's the actual moment pnlAtExpiry now evaluates at (see its
// own comment), so the probability distribution needs to describe the
// spot's distribution at THAT moment, not some blended average dte that
// doesn't correspond to when anything really happens. Using the old
// weighted-average dte here would have described the wrong distribution
// even after pnlAtExpiry itself got fixed to evaluate at the right point.
export function probabilityOfProfit(legs: Leg[], spot: number): { pop: number; breakevens: number[] } {
  if (legs.length === 0 || spot <= 0) return { pop: 0, breakevens: [] };

  const optionLegs = legs.filter((l) => l.kind !== "stock");
  const dtes = optionLegs.map((l) => l.dte);
  const multiExpiry = new Set(dtes).size > 1;
  const horizonDte = dtes.length > 0 ? Math.min(...dtes) : 0;

  // Weighted-average implied vol across legs (still premium-weighted —
  // multiple legs each have their own IV regardless of expiry structure).
  let totalWeight = 0;
  let weightedVol = 0;
  let weightedDte = 0;
  for (const l of legs) {
    if (l.kind === "stock") continue;
    const w = Math.abs(l.premium) * (l.qty ?? 1);
    if (w > 0) {
      const iv = impliedVol(spot, l.strike, l.dte, l.premium, l.type);
      weightedVol += iv * w;
      weightedDte += l.dte * w;
      totalWeight += w;
    }
  }
  if (totalWeight === 0) return { pop: 0, breakevens: [] };
  const vol = weightedVol / totalWeight;
  const dte = multiExpiry ? horizonDte : weightedDte / totalWeight;
  const T = dte / 365;

  const breakevens = findBreakevens(legs, spot);
  if (breakevens.length === 0) {
    // No breakeven crossing — always profit or always loss at expiry
    const pop = pnlAtExpiry(legs, spot, spot) >= 0 ? 1 : 0;
    return { pop, breakevens };
  }

  // Lognormal terminal distribution: ln(S_T) ~ N(ln(spot) + (r - σ²/2)T, σ²T)
  const mu = Math.log(spot) + (RATE - vol * vol / 2) * T;
  const sigma = vol * Math.sqrt(T);

  // Sort breakevens
  const sorted = [...breakevens].sort((a, b) => a - b);

  // The profit region is where pnl > 0. Sample at spot to determine which side is profit.
  // Build profit intervals from sorted breakevens.
  const profitIntervals: [number, number][] = [];
  const testBelow = pnlAtExpiry(legs, Math.max(0.01, sorted[0] - 1), spot);
  const testAbove = pnlAtExpiry(legs, sorted[sorted.length - 1] + 1, spot);

  if (testBelow > 0) profitIntervals.push([0, sorted[0]]);
  for (let i = 0; i < sorted.length - 1; i++) {
    const midS = (sorted[i] + sorted[i + 1]) / 2;
    if (pnlAtExpiry(legs, midS, spot) > 0) profitIntervals.push([sorted[i], sorted[i + 1]]);
  }
  if (testAbove > 0) profitIntervals.push([sorted[sorted.length - 1], Infinity]);

  // Sum the lognormal probability mass over profit intervals
  let prob = 0;
  for (const [lo, hi] of profitIntervals) {
    const zLo = (Math.log(Math.max(0.01, lo)) - mu) / sigma;
    const zHi = hi === Infinity ? Infinity : (Math.log(hi) - mu) / sigma;
    prob += ncdf(zHi) - ncdf(zLo);
  }

  return { pop: Math.max(0, Math.min(1, prob)), breakevens: sorted };
}

// ── Curve-shape ("structural") exit signal ──
//
// A purely geometric read of one price against a combo's OWN payoff-at-
// expiry curve — built from the ORIGINAL opening legs, since the strategy's
// shape doesn't change, only where spot sits on it does. This is a
// different kind of signal than comparing dollar P&L across days: a short
// straddle's curve peaks exactly at its strike, so a spot sitting near that
// peak is structurally close to "as good as this trade gets" from a timing
// standpoint, independent of what the historical daily snapshots say.
export type CurvePosition = "near-peak" | "in-zone" | "beyond-breakeven";

export function classifySpotOnCurve(legs: Leg[], openingSpot: number, testSpot: number): CurvePosition {
  if (legs.length === 0 || openingSpot <= 0) return "in-zone";

  const testPnl = pnlAtExpiry(legs, testSpot, openingSpot);
  if (testPnl < 0) return "beyond-breakeven";

  // Same spot window payoffCurvePoints/findBreakevens use, so "near" below
  // is relative to the same scale the rest of the curve is drawn on.
  const points = payoffCurvePoints(legs, openingSpot, 120);
  if (points.length === 0) return "in-zone";
  // Ties (e.g. a credit spread's flat max-profit plateau past both short
  // strikes) resolve to the FIRST point at max pnl in scan order — i.e. the
  // low-spot edge of the plateau, not its middle. Good enough for a rough
  // "is this near the sweet spot" read; not meant as a precise midpoint.
  const peak = points.reduce((a, b) => (b.pnl > a.pnl ? b : a), points[0]);

  const halfRange = Math.max(20, openingSpot * 0.5);
  const nearWindow = halfRange * 0.1; // tunable: how close counts as "near" the peak
  return Math.abs(testSpot - peak.spot) <= nearWindow ? "near-peak" : "in-zone";
}

// Back-solve the implied spot price from tracked leg premiums.
// Uses each leg's opening IV (from opening legs) and tracked DTE,
// then solves for S where BS(S, strike, dte, iv, type) = tracked premium.
// Returns a premium-weighted average across all option legs.
export function impliedSpotFromPremiums(
  openingLegs: Leg[],
  trackedLegs: Leg[],
  openingSpot: number
): number | null {
  if (openingLegs.length === 0 || trackedLegs.length === 0 || openingSpot <= 0) return null;

  let totalWeight = 0;
  let weightedSpot = 0;

  for (let i = 0; i < trackedLegs.length; i++) {
    const tracked = trackedLegs[i];
    const opening = openingLegs[i];
    if (!opening || tracked.kind === "stock") continue;
    if (tracked.premium <= 0 || opening.premium <= 0) continue;

    const openIV = impliedVol(openingSpot, opening.strike, opening.dte, opening.premium, opening.type);

    let impliedS: number;
    if (tracked.dte <= 0) {
      impliedS = tracked.type === "call"
        ? tracked.strike + tracked.premium
        : tracked.strike - tracked.premium;
    } else {
      let lo = 0.01, hi = openingSpot * 3;
      for (let j = 0; j < 60; j++) {
        const mid = (lo + hi) / 2;
        const price = blackScholes({ spot: mid, strike: tracked.strike, dte: tracked.dte, vol: openIV, rate: RATE, type: tracked.type }).price;
        if (tracked.type === "call") {
          if (price < tracked.premium) lo = mid; else hi = mid;
        } else {
          if (price > tracked.premium) lo = mid; else hi = mid;
        }
      }
      impliedS = (lo + hi) / 2;
    }

    if (impliedS <= 0 || impliedS > openingSpot * 10) continue;

    const weight = Math.abs(opening.premium) * (opening.qty ?? 1);
    weightedSpot += impliedS * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSpot / totalWeight : null;
}

// Weighted-average implied vol across option legs (weighted by |premium|).
export function weightedAvgIV(legs: Leg[], spot: number): number {
  if (legs.length === 0 || spot <= 0) return 0;
  let totalWeight = 0;
  let weightedVol = 0;
  for (const l of legs) {
    if (l.kind === "stock") continue;
    const w = Math.abs(l.premium) * (l.qty ?? 1);
    if (w > 0) {
      const iv = impliedVol(spot, l.strike, l.dte, l.premium, l.type);
      weightedVol += iv * w;
      totalWeight += w;
    }
  }
  return totalWeight > 0 ? weightedVol / totalWeight : 0;
}

// ── P/L Attribution (盈亏归因) ──
//
// Decomposes the observed change in a combo's value into how much came
// from price, time, and IV moving independently. Each single-factor effect
// re-prices the OPENING legs with only that one shift applied (the other
// two held at zero) and compares to the opening value — reusing priceCombo/
// legShiftedPrice exactly as the analysis-mode sliders already do, just
// three separate calls instead of one combined one.
//
// Black-Scholes isn't additively separable (price/time/vol interact —
// e.g. gamma means the price effect itself depends on how much time has
// passed), so priceEffect + timeEffect + ivEffect will not exactly equal
// the real observed change. The gap is reported honestly as `residual`
// (interaction effect) rather than silently absorbed into one of the three
// factors, which would misattribute it.
export interface PnlAttribution {
  priceEffect: number;
  timeEffect: number;
  ivEffect: number;
  residual: number;
  totalChange: number;
}

export function attributePnl(
  legs: Leg[],
  spot: number,
  dSpot: number,
  dDays: number,
  dVolPct: number,
  actualChange: number,
): PnlAttribution {
  const base = priceCombo(legs, { dS: 0, dT: 0, dV: 0 }, spot).shiftedValue;
  const priceOnly = priceCombo(legs, { dS: dSpot, dT: 0, dV: 0 }, spot).shiftedValue;
  const timeOnly = priceCombo(legs, { dS: 0, dT: dDays, dV: 0 }, spot).shiftedValue;
  const ivOnly = priceCombo(legs, { dS: 0, dT: 0, dV: dVolPct }, spot).shiftedValue;

  const priceEffect = priceOnly - base;
  const timeEffect = timeOnly - base;
  const ivEffect = ivOnly - base;
  const residual = actualChange - (priceEffect + timeEffect + ivEffect);

  return { priceEffect, timeEffect, ivEffect, residual, totalChange: actualChange };
}