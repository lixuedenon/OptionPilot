import { useState, useEffect, useCallback, useRef } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export interface StockQuote {
  symbol: string;
  price: number;
  previousClose: number;
  regularMarketTime: number;
  marketState: string;
  source: string;
}

// Imperative one-off fetch for callers that need a spot price outside of the
// hook's own symbol-tracking lifecycle (e.g. refreshing several different
// symbols' quotes at once, like the simulated account's position list).
export async function fetchSpotPrice(symbol: string): Promise<number> {
  const sym = symbol.trim();
  if (!sym) throw new Error("Missing symbol");
  const url = `${SUPABASE_URL}/functions/v1/stock-quote?symbol=${encodeURIComponent(sym)}`;
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
  const data: StockQuote = await resp.json();
  if (typeof data.price !== "number" || isNaN(data.price)) {
    throw new Error("Invalid price data");
  }
  return data.price;
}

export function useStockQuote(symbol: string) {
  // 报价跟请求它的代码绑在一起：换了代码以后，旧代码的报价（哪怕晚到）不再当成现在这只股票的价。
  const [state, setState] = useState<{ sym: string; quote: StockQuote } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestSym = useRef("");

  const fetchQuote = useCallback(async (sym: string) => {
    if (!sym || sym.trim().length === 0) return;
    latestSym.current = sym;
    setLoading(true);
    setError(null);
    try {
      const url = `${SUPABASE_URL}/functions/v1/stock-quote?symbol=${encodeURIComponent(sym)}`;
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
      const data: StockQuote = await resp.json();
      if (typeof data.price !== "number" || isNaN(data.price)) {
        throw new Error("Invalid price data");
      }
      if (latestSym.current !== sym) return;
      setState({ sym, quote: data });
    } catch (e) {
      if (latestSym.current !== sym) return;
      setError(e instanceof Error ? e.message : "Failed to fetch quote");
      setState(null);
    } finally {
      if (latestSym.current === sym) setLoading(false);
    }
  }, []);

  // Auto-fetch when symbol changes (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      if (symbol && symbol.trim().length > 0) {
        fetchQuote(symbol.trim());
      }
    }, 600);
    return () => clearTimeout(t);
  }, [symbol, fetchQuote]);

  const quote = state && state.sym === symbol.trim() ? state.quote : null;
  return { quote, loading, error, refetch: () => fetchQuote(symbol.trim()) };
}
