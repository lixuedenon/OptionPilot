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
    // Drop nulls (Yahoo sometimes returns a null bar for a partial/no-trade
    // day) rather than letting them corrupt the log-return calculation on
    // the client — a gap in the series is fine, a null value inside it isn't.
    const closes = rawCloses.filter((c): c is number => c != null && c > 0);

    if (closes.length < 5) {
      return new Response(
        JSON.stringify({ error: "Not enough historical data to compute volatility" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const out: HistoricalPricesResult = {
      symbol: symbol.toUpperCase(),
      closes,
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