import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface QuoteResult {
  symbol: string;
  price: number;
  previousClose: number;
  regularMarketTime: number;
  marketState: string;
  source: string;
}

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

    // Yahoo Finance quote endpoint (no API key required)
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
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
        JSON.stringify({ error: "No quote data found for symbol" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const meta = result.meta ?? {};
    const indicators = result.indicators?.quote?.[0] ?? {};
    const closes = indicators.close ?? [];
    const lastValidClose = closes.find((c: number | null) => c != null);

    // regularMarketPrice is the most recent traded price (live during market hours, last close otherwise)
    const price = meta.regularMarketPrice ?? lastValidClose ?? 0;
    const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? 0;
    const regularMarketTime = meta.regularMarketTime ?? 0;
    const marketState = meta.marketState ?? "UNKNOWN";

    const out: QuoteResult = {
      symbol: symbol.toUpperCase(),
      price: Math.round(price * 100) / 100,
      previousClose: Math.round(previousClose * 100) / 100,
      regularMarketTime,
      marketState,
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
