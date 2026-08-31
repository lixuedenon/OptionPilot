// src/lib/historicalVolatility.ts

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fetches raw daily closes (oldest first) from the historical-prices Edge
// Function. Kept separate from computeHV below so the network call and the
// math can be tested/reasoned about independently — this function's only
// job is "get the numbers," not "know what a trading day's return means."
export async function fetchHistoricalCloses(symbol: string): Promise<number[]> {
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
  if (!Array.isArray(data.closes) || data.closes.length === 0) {
    throw new Error("Invalid historical price data");
  }
  return data.closes as number[];
}

// Annualized historical (realized) volatility — the standard deviation of
// daily log returns over the trailing `lookbackDays` trading days, scaled
// to a yearly figure by √252 (the conventional trading-days-per-year
// annualization factor used everywhere else in options analytics, same
// convention Barchart/Schwab/thinkorswim's own HV figures use, so a number
// shown here is directly comparable to what a person sees on those
// platforms rather than being annualized on some other implicit basis).
export function computeHV(closes: number[], lookbackDays = 30): number {
  const window = closes.slice(-Math.min(lookbackDays + 1, closes.length));
  if (window.length < 3) return 0;
  const logReturns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    if (window[i - 1] > 0 && window[i] > 0) {
      logReturns.push(Math.log(window[i] / window[i - 1]));
    }
  }
  if (logReturns.length < 2) return 0;
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

export type IvHvBias = "sellRich" | "buyCheap" | "stillRich" | null;

export interface IvHvNote {
  iv: number;
  hv: number;
  ratio: number;
  bias: IvHvBias; // null = ratio is in the normal/unremarkable range
}

// IV almost always sits above HV on average (the "volatility risk premium"
// — sellers are structurally compensated for taking on the risk), so a
// plain "IV > HV" check would flag nearly everything as "rich" and say
// nothing useful. The threshold instead looks for a MEANINGFULLY wide or
// narrow gap — retuned from real trader convention (roughly 1.3x+ read as
// genuinely rich, sub-~1.05x read as offering little premium over what's
// actually been happening), not a textbook-exact cutoff. This is
// deliberately a STANDALONE substitute for true IV Rank/Percentile (see
// the chat discussion) — usable today without a year of accumulated
// history, at the cost of being a rougher, single-snapshot signal rather
// than a full 52-week distribution.
export const RICH_THRESHOLD = 1.3;
export const CHEAP_THRESHOLD = 1.05;

// A low RATIO alone isn't enough to call premium "cheap" — a name with IV
// at 103% and HV at 162% has a low ratio (0.63, well under CHEAP_THRESHOLD)
// but the IV itself is still a big number; the premium collected selling
// there is genuinely rich in absolute terms, the stock has just been
// realizing even MORE movement than that already-high IV prices in. Ratio
// alone would call this "cheap, consider buying instead," which is
// backwards — caught by exactly this case. Gating the "buyCheap" bias on
// absolute IV also being low (below this floor) keeps the ratio signal
// meaningful without it firing on names that are volatile in every sense.
export const LOW_ABSOLUTE_IV = 0.30;

// Always returns the comparison (iv/hv/ratio) so the person can see WHERE
// things stand even when nothing crosses a threshold — testing this
// showed every early attempt landing inside the normal range and
// therefore showing nothing at all, which reads as "broken" rather than
// "nothing notable right now." `bias` stays null in that normal-range
// case; the caller decides how much weight to put on a null vs non-null
// bias (e.g. showing the raw numbers regardless, but only escalating to a
// "consider switching" style callout when bias is set).
export function computeIvHvNote(iv: number, hv: number): IvHvNote | null {
  if (iv <= 0 || hv <= 0) return null;
  const ratio = iv / hv;
  let bias: IvHvBias = null;
  if (ratio >= RICH_THRESHOLD) {
    bias = "sellRich";
  } else if (ratio <= CHEAP_THRESHOLD) {
    // Low ratio alone would say "cheap, favor buying" — but if IV itself
    // is still objectively high, the premium is rich in absolute terms
    // regardless of how it compares to an even-higher realized figure.
    // "stillRich" says exactly that instead of giving backwards advice.
    bias = iv < LOW_ABSOLUTE_IV ? "buyCheap" : "stillRich";
  }
  return { iv, hv, ratio, bias };
}