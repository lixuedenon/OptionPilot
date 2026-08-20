import type { OptionType } from "./types";
import { dateFromDte, dteFromDate } from "./dateUtils";

export interface OptionQuote {
  strike: number;
  bid: number;
  ask: number;
  lastPrice: number;
}

export interface OptionChainResponse {
  symbol: string;
  usedExpiry: number; // epoch seconds
  usedExpiryDate: string; // ISO yyyy-mm-dd
  expirationDates: number[];
  calls: OptionQuote[];
  puts: OptionQuote[];
}

export interface LegPremiumResult {
  premium: number;
  actualStrike: number;
  actualDte: number;
  actualExpiryDate: string;
  strikeSnapped: boolean;
  expirySnapped: boolean;
}

// Cache full chains by (symbol, requested expiry date) so legs that share the
// same on-screen expiry (e.g. every leg of an iron condor) reuse one request
// instead of firing one per leg.
const chainCache = new Map<string, Promise<OptionChainResponse>>();
// A synchronously-readable mirror of resolved chains — lets callers (like
// "add a new leg") grab an already-known real strike instantly instead of
// waiting on a promise, as long as the chain was warmed ahead of time.
const resolvedCache = new Map<string, OptionChainResponse>();

function cacheKey(symbol: string, targetDateISO: string): string {
  return `${symbol.trim().toUpperCase()}|${targetDateISO}`;
}

async function requestChain(symbol: string, targetDateISO: string): Promise<OptionChainResponse> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/option-chain?symbol=${encodeURIComponent(symbol)}&date=${encodeURIComponent(targetDateISO)}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `请求失败 (${resp.status})`);
  }
  const data = await resp.json();
  if (!data || !Array.isArray(data.calls) || !Array.isArray(data.puts)) {
    throw new Error("期权链数据格式错误");
  }
  return data as OptionChainResponse;
}

// Fetch the option chain for a symbol/expiry. Dedupes concurrent requests and
// caches by (symbol, target date). Pass force=true to always hit the network
// (used by the manual "restore market price" action) — the fresh result still
// replaces the cache entry so subsequent auto-fills benefit from it too.
export function getOptionChain(symbol: string, dte: number, force = false): Promise<OptionChainResponse> {
  const targetDateISO = dateFromDte(dte);
  const key = cacheKey(symbol, targetDateISO);

  if (!force) {
    const cached = chainCache.get(key);
    if (cached) return cached;
  }

  const p = requestChain(symbol, targetDateISO);
  chainCache.set(key, p);
  p.then((data) => {
    resolvedCache.set(key, data);
  }).catch(() => {
    // Don't let a failed request poison the cache for the next attempt.
    if (chainCache.get(key) === p) chainCache.delete(key);
  });
  return p;
}

// Synchronous lookup of a chain that's already finished loading — used to
// pick a real, listed strike the instant a new leg is created, with no
// network wait and no placeholder value that gets corrected a second later.
export function peekResolvedChain(symbol: string, dte: number): OptionChainResponse | null {
  const targetDateISO = dateFromDte(dte);
  const key = cacheKey(symbol, targetDateISO);
  return resolvedCache.get(key) ?? null;
}

export function nearestStrikeToSpot(quotes: OptionQuote[], spot: number): number | null {
  if (quotes.length === 0) return null;
  let best = quotes[0].strike;
  let bestDiff = Math.abs(best - spot);
  for (const q of quotes) {
    const diff = Math.abs(q.strike - spot);
    if (diff < bestDiff) {
      best = q.strike;
      bestDiff = diff;
    }
  }
  return best;
}

export function premiumFromQuote(q: OptionQuote): number {
  if (q.bid > 0 && q.ask > 0) return Math.round(((q.bid + q.ask) / 2) * 100) / 100;
  if (q.lastPrice > 0) return Math.round(q.lastPrice * 100) / 100;
  return 0;
}

export interface CachedResolution {
  strike: number;
  premium: number;
  dte: number;
}

// Best-effort synchronous resolution using a chain that's already been
// warmed into the cache (see peekResolvedChain). Returns null if nothing is
// cached yet for (symbol, dte) — callers should fall back to a placeholder
// value and let the async per-leg auto-fill effect correct it a moment
// later, same safety net used everywhere else in this file.
export function resolveFromCache(symbol: string, type: OptionType, targetStrike: number, dte: number): CachedResolution | null {
  const cached = peekResolvedChain(symbol, dte);
  if (!cached) return null;
  const rows = type === "call" ? cached.calls : cached.puts;
  const strike = nearestStrikeToSpot(rows, targetStrike);
  if (strike === null) return null;
  const q = rows.find((r) => r.strike === strike);
  if (!q) return null;
  const premium = premiumFromQuote(q);
  // Use the same local-calendar-date math as the rest of the app (dateFromDte
  // / dteFromDate) rather than raw UTC epoch arithmetic — mixing the two
  // rounds inconsistently depending on the user's timezone and can be off by
  // a day (e.g. showing 9/17 instead of the actual listed 9/18 expiry).
  const actualDte = dteFromDate(cached.usedExpiryDate);
  return { strike, premium, dte: actualDte };
}

function nearestStrikeQuote(quotes: OptionQuote[], targetStrike: number): OptionQuote | null {
  if (quotes.length === 0) return null;
  let best = quotes[0];
  let bestDiff = Math.abs(best.strike - targetStrike);
  for (const q of quotes) {
    const diff = Math.abs(q.strike - targetStrike);
    if (diff < bestDiff) {
      best = q;
      bestDiff = diff;
    }
  }
  return best;
}

// Resolve the market premium for a single leg. Snaps to the nearest available
// expiry and the nearest available strike on that expiry, reporting back
// whether either snap occurred so the caller can update the leg + notify the user.
export async function fetchLegPremium(
  symbol: string,
  type: OptionType,
  strike: number,
  dte: number,
  force = false,
): Promise<LegPremiumResult> {
  const requestedDateISO = dateFromDte(dte);
  const chain = await getOptionChain(symbol, dte, force);
  const quotes = type === "call" ? chain.calls : chain.puts;
  const q = nearestStrikeQuote(quotes, strike);
  if (!q) throw new Error("未找到可用的期权合约");

  const premium = premiumFromQuote(q);
  if (premium <= 0) throw new Error("该合约暂无有效报价");

  // Same fix as resolveFromCache: derive dte from the calendar date string,
  // not raw UTC-epoch subtraction, to avoid a timezone-driven off-by-one.
  const actualDte = dteFromDate(chain.usedExpiryDate);

  return {
    premium,
    actualStrike: q.strike,
    actualDte,
    actualExpiryDate: chain.usedExpiryDate,
    strikeSnapped: Math.abs(q.strike - strike) > 0.001,
    expirySnapped: chain.usedExpiryDate !== requestedDateISO,
  };
}