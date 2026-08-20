import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// Yahoo now gates /v7/finance/options behind a session cookie + crumb token
// (the quote endpoint used by stock-quote does not need this, which is why
// that one still works without it). Cached at module scope so a warm
// function instance reuses the handshake instead of redoing it every call.
let cachedCookie: string | null = null;
let cachedCrumb: string | null = null;
let cacheExpiresAt = 0;

async function fetchCrumbAndCookie(): Promise<{ cookie: string; crumb: string }> {
  const now = Date.now();
  if (cachedCookie && cachedCrumb && now < cacheExpiresAt) {
    return { cookie: cachedCookie, crumb: cachedCrumb };
  }

  // Step 1: hit a Yahoo endpoint that hands out a session cookie.
  const cookieResp = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
    redirect: "manual",
  });
  const setCookie = cookieResp.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Failed to obtain Yahoo session cookie");
  }
  const cookie = setCookie.split(";")[0];

  // Step 2: exchange that cookie for a crumb token.
  const crumbResp = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  });
  if (!crumbResp.ok) {
    throw new Error(`Failed to obtain Yahoo crumb (${crumbResp.status})`);
  }
  const crumb = (await crumbResp.text()).trim();
  if (!crumb || crumb.includes("<html")) {
    throw new Error("Yahoo did not return a valid crumb");
  }

  cachedCookie = cookie;
  cachedCrumb = crumb;
  cacheExpiresAt = now + 20 * 60 * 1000; // 20 minutes
  return { cookie, crumb };
}

interface YahooOptionRow {
  strike: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
}

interface YahooOptionsBlock {
  expirationDate: number;
  calls?: YahooOptionRow[];
  puts?: YahooOptionRow[];
}

interface YahooChainResult {
  underlyingSymbol?: string;
  expirationDates?: number[];
  options?: YahooOptionsBlock[];
}

interface OptionQuote {
  strike: number;
  bid: number;
  ask: number;
  lastPrice: number;
}

interface ChainResult {
  symbol: string;
  usedExpiry: number; // epoch seconds
  usedExpiryDate: string; // ISO yyyy-mm-dd (UTC)
  expirationDates: number[];
  calls: OptionQuote[];
  puts: OptionQuote[];
}

function normalizeRows(rows: YahooOptionRow[] | undefined): OptionQuote[] {
  if (!rows) return [];
  return rows.map((r) => ({
    strike: r.strike,
    bid: typeof r.bid === "number" ? r.bid : 0,
    ask: typeof r.ask === "number" ? r.ask : 0,
    lastPrice: typeof r.lastPrice === "number" ? r.lastPrice : 0,
  }));
}

function isoDateUTC(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

async function fetchYahooChain(symbol: string, dateEpoch?: number): Promise<YahooChainResult> {
  const { cookie, crumb } = await fetchCrumbAndCookie();
  const base = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`;
  const params = new URLSearchParams();
  if (dateEpoch) params.set("date", String(dateEpoch));
  params.set("crumb", crumb);
  const yahooUrl = `${base}?${params.toString()}`;

  let resp = await fetch(yahooUrl, { headers: { "User-Agent": UA, Cookie: cookie } });

  // The cached crumb/cookie can go stale between calls — refresh once and retry.
  if (resp.status === 401 || resp.status === 403) {
    cachedCookie = null;
    cachedCrumb = null;
    const retry = await fetchCrumbAndCookie();
    const retryParams = new URLSearchParams();
    if (dateEpoch) retryParams.set("date", String(dateEpoch));
    retryParams.set("crumb", retry.crumb);
    resp = await fetch(`${base}?${retryParams.toString()}`, {
      headers: { "User-Agent": UA, Cookie: retry.cookie },
    });
  }

  if (!resp.ok) {
    throw new Error(`Yahoo Finance returned ${resp.status}`);
  }
  const data = await resp.json();
  const result = data?.optionChain?.result?.[0];
  if (!result) {
    const yahooError = data?.optionChain?.error?.description;
    throw new Error(yahooError || "No option chain data found for symbol");
  }
  return result as YahooChainResult;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol");
    const dateParam = url.searchParams.get("date"); // ISO yyyy-mm-dd, target expiry the client wants

    if (!symbol) {
      return new Response(
        JSON.stringify({ error: "Missing 'symbol' query parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // First call (no date): gives the full list of available expirations plus
    // the chain nearest to today, which Yahoo uses as its default.
    const base = await fetchYahooChain(symbol);
    const expirationDates = base.expirationDates ?? [];
    if (expirationDates.length === 0) {
      return new Response(
        JSON.stringify({ error: "No option expirations available for symbol" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Figure out which expiration we actually want: nearest available date to
    // the caller's requested date (or just Yahoo's default if none given).
    let targetEpoch: number | null = null;
    if (dateParam) {
      const parsed = Date.parse(`${dateParam}T00:00:00Z`);
      if (!Number.isNaN(parsed)) targetEpoch = Math.floor(parsed / 1000);
    }

    let usedExpiry: number;
    if (targetEpoch === null) {
      usedExpiry = base.options?.[0]?.expirationDate ?? expirationDates[0];
    } else {
      usedExpiry = expirationDates.reduce((best, cur) =>
        Math.abs(cur - targetEpoch!) < Math.abs(best - targetEpoch!) ? cur : best
      , expirationDates[0]);
    }

    // Reuse the default chain if it already matches; otherwise fetch that specific expiry.
    let block = base.options?.find((o) => o.expirationDate === usedExpiry);
    if (!block) {
      const specific = await fetchYahooChain(symbol, usedExpiry);
      block = specific.options?.find((o) => o.expirationDate === usedExpiry) ?? specific.options?.[0];
    }

    if (!block) {
      return new Response(
        JSON.stringify({ error: "No option data found for the selected expiry" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const out: ChainResult = {
      symbol: symbol.toUpperCase(),
      usedExpiry,
      usedExpiryDate: isoDateUTC(usedExpiry),
      expirationDates,
      calls: normalizeRows(block.calls),
      puts: normalizeRows(block.puts),
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