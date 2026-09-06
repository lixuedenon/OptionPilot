// src/lib/historicalBackfill.ts
//
// Shared historical-bar fetch + flat-vol theoretical repricing. Originally
// lived only inside simAccount.ts (for the Simulator's per-position
// Timeline backfill); factored out here so Compare Mode's tracked-snapshot
// backfill (savedStrategies.ts) can reuse the exact same logic instead of
// growing a second near-identical copy — this app already has a documented
// pattern of near-duplicate pricing helpers (see PayoffChart.tsx's four
// calcXxx functions), and there was no reason to add a third for this.
//
// The repricing convention (hold each leg's OWN opening-implied IV flat and
// reprice at a historical day's average price) matches pricing.ts's
// legShiftedPrice / decisionCompare.ts's roll estimate elsewhere in the app
// — see CLAUDE.md's notes on why a single flat vol per leg, not a full
// surface, is this app's deliberate simplification.
import type { Leg } from "./types";
import { blackScholes } from "./bs";
import { impliedVol } from "./pricing";
import { formatDateInput } from "./dateUtils";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Matches pricing.ts's private RATE / simAccount.ts's former SIM_RATE — kept
// as a local const (RATE isn't exported from pricing.ts) so every caller of
// this backfill estimate uses the same risk-free-rate convention.
export const BACKFILL_RATE = 0.05;

export interface HistoricalBar {
  dateISO: string; // local calendar day
  avgPrice: number; // (open + close) / 2 for that trading day
}

// Pulls a symbol's ~2mo daily bar history from the historical-prices Edge
// Function and reduces it to one (date, average-price) pair per trading
// day. A bar missing open/timestamp is dropped rather than guessed at — see
// the Edge Function's own alignment note for why those three arrays are
// filtered together here.
export async function fetchHistoricalBars(symbol: string): Promise<HistoricalBar[]> {
  const url = `${SUPABASE_URL}/functions/v1/historical-prices?symbol=${encodeURIComponent(symbol)}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${resp.status})`);
  }
  const data = await resp.json();
  const closes: number[] = Array.isArray(data.closes) ? data.closes : [];
  const opens: number[] = Array.isArray(data.opens) ? data.opens : [];
  const timestamps: number[] = Array.isArray(data.timestamps) ? data.timestamps : [];

  const bars: HistoricalBar[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (opens[i] == null || timestamps[i] == null) continue;
    bars.push({
      dateISO: formatDateInput(timestamps[i] * 1000),
      avgPrice: (opens[i] + closes[i]) / 2,
    });
  }
  return bars;
}

// Theoretical repricing of a fixed set of "opening" legs at a historical
// point in time: each option leg's IV is back-solved once from its OWN
// opening premium (at `openingSpot`/its own original dte), held flat, and
// used to reprice at `avgSpot` and `newDte = leg.dte - daysElapsed`. Stock
// legs pass through unchanged — callers price those directly off the spot
// they already have. This is necessarily an ESTIMATE (no real historical
// option-chain bid/ask exists to fall back to), which is why every caller
// marks the resulting snapshot `estimated: true`.
export function repriceLegsAtDate(legs: Leg[], openingSpot: number, avgSpot: number, daysElapsed: number): Leg[] {
  return legs.map((l) => {
    if (l.kind === "stock") return l;
    const openIv = impliedVol(openingSpot, l.strike, l.dte, l.premium, l.type);
    const newDte = Math.max(0, l.dte - daysElapsed);
    const theoPrice = newDte <= 0
      ? (l.type === "call" ? Math.max(0, avgSpot - l.strike) : Math.max(0, l.strike - avgSpot))
      : blackScholes({ spot: avgSpot, strike: l.strike, dte: newDte, vol: Math.max(0.01, openIv), rate: BACKFILL_RATE, type: l.type }).price;
    return { ...l, premium: Math.round(theoPrice * 100) / 100, dte: newDte };
  });
}