// supabase/functions/historical-prices/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
  // 盘中最高/最低（跟closes对齐；Yahoo缺的那根用开盘/收盘里大的/小的补）——财报那一行要画每次反应当天盘中走到多远
  highs: number[];
  lows: number[];
  timestamps: number[]; // unix seconds (UTC), Yahoo's per-bar session timestamp
  source: string;
}

// 5y/10y：万次推演"这只股票历史上的真实走法"（第2组）
const ALLOWED_RANGES = new Set(["1mo", "2mo", "3mo", "6mo", "1y", "2y", "5y", "10y"]);

// 共享缓存（表price_history_cache，迁移20261006180000）：所有用户共用一份，6小时内同一个代码同一个区间只打一次Yahoo。
// 缓存读写失败都不影响正常返回（当成没命中 / 不写）。
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function db() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function readCache(symbol: string, range: string): Promise<HistoricalPricesResult | null> {
  try {
    const { data, error } = await db().from("price_history_cache").select("data, fetched_at").eq("symbol", symbol).eq("range", range).maybeSingle();
    if (error || !data) return null;
    if (Date.now() - new Date(data.fetched_at as string).getTime() > CACHE_TTL_MS) return null;
    // 加highs/lows以前存的缓存没有这两项，当作过期重新拉
    const d = data.data as HistoricalPricesResult;
    if (!Array.isArray(d?.highs) || !Array.isArray(d?.lows)) return null;
    return d;
  } catch {
    return null;
  }
}

async function writeCache(symbol: string, range: string, result: HistoricalPricesResult): Promise<void> {
  try {
    await db().from("price_history_cache").upsert({ symbol, range, data: result, fetched_at: new Date().toISOString() });
  } catch {
    /* 缓存只是省请求，写失败下次再拉 */
  }
}

// Separate from stock-quote (which only ever needs today's price) because
// this needs a multi-month RANGE of daily closes to compute historical
// volatility — a different Yahoo Finance chart query (a multi-month range instead of
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

    // 默认2个月（历史波动率和回填够用）；今昔对比画开仓以来的真实走势时按开仓距今多久传更长的range。
    const range = ALLOWED_RANGES.has(url.searchParams.get("range") ?? "") ? url.searchParams.get("range")! : "2mo";
    const sym = symbol.trim().toUpperCase();
    const cached = await readCache(sym, range);
    if (cached) {
      return new Response(JSON.stringify(cached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
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
    const rawHighs: (number | null)[] = result.indicators?.quote?.[0]?.high ?? [];
    const rawLows: (number | null)[] = result.indicators?.quote?.[0]?.low ?? [];
    const rawTimestamps: (number | null)[] = result.timestamp ?? [];

    // Build the filtered bar set from indices where BOTH open and close are
    // valid, keeping closes/opens/timestamps index-aligned with each other.
    // (Previously this only filtered `closes` on its own — fine when that
    // was the only array returned, but that would silently desync opens/
    // timestamps against it once those were added, since a null bar shifts
    // every array's indices differently unless they're filtered together.)
    const closes: number[] = [];
    const opens: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];
    const timestamps: number[] = [];
    for (let i = 0; i < rawCloses.length; i++) {
      const c = rawCloses[i];
      const o = rawOpens[i];
      const ts = rawTimestamps[i];
      if (c != null && c > 0 && o != null && o > 0 && ts != null) {
        closes.push(c);
        opens.push(o);
        const h = rawHighs[i], l = rawLows[i];
        highs.push(h != null && h > 0 ? Math.max(h, o, c) : Math.max(o, c));
        lows.push(l != null && l > 0 ? Math.min(l, o, c) : Math.min(o, c));
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
      symbol: sym,
      closes,
      opens,
      highs,
      lows,
      timestamps,
      source: "yahoo-finance",
    };
    await writeCache(sym, range, out);

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