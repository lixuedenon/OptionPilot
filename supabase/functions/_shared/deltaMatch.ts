import { blackScholes } from "./bs.ts";

// Same bisection approach as src/lib/pricing.ts's impliedVol() — kept in
// sync manually for the same reason bs.ts is duplicated (see that file's
// header comment). The option-chain response only carries strike/bid/ask/
// lastPrice, never implied vol directly, so every consumer in this app
// (charts, tracking mode, and now the AI pipeline) always back-solves vol
// from the quoted premium the same way, rather than trusting a vendor IV
// field that doesn't exist here.
const RATE = 0.05;

export function impliedVol(spot: number, strike: number, dte: number, premium: number, type: "call" | "put"): number {
  let lo = 0.01, hi = 5.0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const p = blackScholes({ spot, strike, dte, vol: mid, rate: RATE, type }).price;
    if (p < premium) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Matches src/lib/optionChain.ts's premiumFromQuote(): prefer the bid/ask
// midpoint, fall back to last traded price.
export interface DeltaQuote {
  strike: number;
  bid: number;
  ask: number;
  lastPrice: number;
}

function premiumFromQuote(q: DeltaQuote): number {
  if (q.bid > 0 && q.ask > 0) return Math.round(((q.bid + q.ask) / 2) * 100) / 100;
  if (q.lastPrice > 0) return Math.round(q.lastPrice * 100) / 100;
  return 0;
}

// Back-solves a single contract's implied vol from its quoted premium, then
// prices it through Black-Scholes to read off delta. This is the "given a
// contract, what's its delta" primitive everything else in this module
// builds on.
export function contractDelta(
  quote: DeltaQuote,
  spot: number,
  dte: number,
  type: "call" | "put",
): number | null {
  const premium = premiumFromQuote(quote);
  if (premium <= 0 || spot <= 0 || quote.strike <= 0) return null;
  const vol = impliedVol(spot, quote.strike, dte, premium, type);
  return blackScholes({ spot, strike: quote.strike, dte, vol, rate: RATE, type }).delta;
}

export interface DeltaMatchResult {
  quote: DeltaQuote;
  delta: number;
  premium: number;
}

// Finds the contract in `quotes` whose computed delta is closest to
// `targetDelta`. This is what lets TQQQ's leg parameters be locked to the
// same delta the AI chose for QQQ, instead of asking the model to reason
// about TQQQ independently and hoping it stays consistent — see the AI
// strategy integration notes on why delta-matching replaces a second model
// call for TQQQ entirely.
export function findContractByTargetDelta(
  quotes: DeltaQuote[],
  targetDelta: number,
  spot: number,
  dte: number,
  type: "call" | "put",
): DeltaMatchResult | null {
  let best: DeltaMatchResult | null = null;
  let bestDiff = Infinity;

  for (const quote of quotes) {
    const delta = contractDelta(quote, spot, dte, type);
    if (delta === null) continue;
    const diff = Math.abs(delta - targetDelta);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { quote, delta, premium: premiumFromQuote(quote) };
    }
  }

  return best;
}