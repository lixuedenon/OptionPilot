// supabase/functions/historical-prices/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface HistoricalPricesResult {
  symbol: string;
  closes: number[]; // oldest first
  // opens/timestamps are index-aligned with closes (same filtered bar set —
  // see the alignment note below), added for the sim account's Timeline
  // "estimate missing days" backfill (SimulatorPage.tsx / simAccount.ts),
  // which needs each day's (open+close)/2 as a stand-in spot price, not
  // just the closes historicalVolatility.ts already consumed this for.
  opens: number[];
  timestamps: number[]; // unix seconds (UTC), Yahoo's per-bar session timestamp
  source: string;
}

// Separate from stock-quote (which only ever needs today's price) because
// this needs a multi-month RANGE of daily closes to compute historical
// volatility — a different Yahoo Finance chart query (range=2mo instead of
// range=1d), not just a different parameter on the same call.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol");
    if (!symbol) {
      return new Response(
        JSON.stringify({ error: "Missing 'symbol' query parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2 months of daily bars is enough for a 30-trading-day HV lookback
    // with room to spare (~42 trading days in 2 calendar months), without
    // pulling more history than this feature actually needs.
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2mo`;
    const resp = await fetch(yahooUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: `Yahoo Finance returned ${resp.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      return new Response(
        JSON.stringify({ error: "No historical data found for symbol" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const rawOpens: (number | null)[] = result.indicators?.quote?.[0]?.open ?? [];
    const rawTimestamps: (number | null)[] = result.timestamp ?? [];

    // Build the filtered bar set from indices where BOTH open and close are
    // valid, keeping closes/opens/timestamps index-aligned with each other.
    // (Previously this only filtered `closes` on its own — fine when that
    // was the only array returned, but that would silently desync opens/
    // timestamps against it once those were added, since a null bar shifts
    // every array's indices differently unless they're filtered together.)
    const closes: number[] = [];
    const opens: number[] = [];
    const timestamps: number[] = [];
    for (let i = 0; i < rawCloses.length; i++) {
      const c = rawCloses[i];
      const o = rawOpens[i];
      const ts = rawTimestamps[i];
      if (c != null && c > 0 && o != null && o > 0 && ts != null) {
        closes.push(c);
        opens.push(o);
        timestamps.push(ts);
      }
    }

    if (closes.length < 5) {
      return new Response(
        JSON.stringify({ error: "Not enough historical data to compute volatility" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const out: HistoricalPricesResult = {
      symbol: symbol.toUpperCase(),
      closes,
      opens,
      timestamps,
      source: "yahoo-finance",
    };

    return new Response(
      JSON.stringify(out),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});