// supabase/functions/eps-estimate/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// 2026-09-18新增：粗算未来1-2年估值区间用的数据源。跟 option-chain 共享同一个
// "服务端共享缓存"思路（见那边的注释），但TTL开得比期权链长得多——分析师EPS
// 预估是按季度/财报节奏修的，不是分钟级波动的数据，15分钟缓存对这个场景没
// 意义，6小时既能把Yahoo请求量压得很低，又不会让数据明显过期。
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function getSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceKey);
}

async function readCache(cacheKey: string): Promise<EpsEstimateResult | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("eps_estimate_cache")
      .select("data, fetched_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error || !data) return null;
    const fetchedAt = new Date(data.fetched_at as string).getTime();
    if (Date.now() - fetchedAt > CACHE_TTL_MS) return null;
    return data.data as EpsEstimateResult;
  } catch {
    return null;
  }
}

async function writeCache(cacheKey: string, symbol: string, result: EpsEstimateResult): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from("eps_estimate_cache").upsert({
      cache_key: cacheKey,
      symbol,
      data: result,
      fetched_at: new Date().toISOString(),
    });
  } catch {
    // Caching is a performance optimization, not a correctness requirement.
  }
}

// Same Yahoo session-cookie + crumb handshake as option-chain/index.ts —
// quoteSummary is gated behind it the same way the options chain is.
// Duplicated here rather than shared, matching how option-chain/stock-quote/
// market-context each already keep their own self-contained fetch logic
// (see CLAUDE-handover.md "修改共享逻辑前先确认哪些模块在复用它" — pulling
// this into _shared would mean touching option-chain's already-shipped path
// for a small amount of duplication saved; not worth the risk here).
let cachedCookie: string | null = null;
let cachedCrumb: string | null = null;
let cacheExpiresAt = 0;

async function fetchCrumbAndCookie(): Promise<{ cookie: string; crumb: string }> {
  const now = Date.now();
  if (cachedCookie && cachedCrumb && now < cacheExpiresAt) {
    return { cookie: cachedCookie, crumb: cachedCrumb };
  }

  const cookieResp = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
    redirect: "manual",
  });
  const setCookie = cookieResp.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Failed to obtain Yahoo session cookie");
  }
  const cookie = setCookie.split(";")[0];

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
  cacheExpiresAt = now + 20 * 60 * 1000;
  return { cookie, crumb };
}

// Yahoo wraps most numeric fields as { raw, fmt } but a few come back as
// plain numbers depending on endpoint/module — accept either, reject
// anything non-finite.
function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && "raw" in (v as Record<string, unknown>)) {
    const raw = (v as { raw?: unknown }).raw;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  return null;
}

interface EpsRangeOut {
  period: "1y" | "2y";
  epsLow: number;
  epsHigh: number;
  low: number; // epsLow * peMultiple
  high: number; // epsHigh * peMultiple
  numberOfAnalysts: number | null;
}

interface EpsEstimateResult {
  symbol: string;
  peMultiple: number;
  peSource: "forward" | "trailing";
  ranges: EpsRangeOut[];
}

async function fetchQuoteSummary(symbol: string): Promise<Record<string, unknown>> {
  const { cookie, crumb } = await fetchCrumbAndCookie();
  const modules = "earningsTrend,defaultKeyStatistics,summaryDetail,financialData";
  const base = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`;

  let resp = await fetch(`${base}?modules=${modules}&crumb=${crumb}`, {
    headers: { "User-Agent": UA, Cookie: cookie },
  });

  if (resp.status === 401 || resp.status === 403) {
    cachedCookie = null;
    cachedCrumb = null;
    const retry = await fetchCrumbAndCookie();
    resp = await fetch(`${base}?modules=${modules}&crumb=${retry.crumb}`, {
      headers: { "User-Agent": UA, Cookie: retry.cookie },
    });
  }

  if (!resp.ok) {
    throw new Error(`Yahoo Finance returned ${resp.status}`);
  }
  const data = await resp.json();
  const result = data?.quoteSummary?.result?.[0];
  if (!result) {
    const yahooError = data?.quoteSummary?.error?.description;
    throw new Error(yahooError || "No fundamentals data found for symbol");
  }
  return result;
}

function buildEstimate(symbol: string, result: Record<string, unknown>): EpsEstimateResult {
  const defaultKeyStatistics = (result.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const summaryDetail = (result.summaryDetail ?? {}) as Record<string, unknown>;
  const financialData = (result.financialData ?? {}) as Record<string, unknown>;
  const earningsTrend = (result.earningsTrend ?? {}) as Record<string, unknown>;

  // Forward P/E (price ÷ next-12-months consensus EPS) is what we want when
  // it exists — it's already "today's price, tomorrow's earnings". Fall
  // back to trailing P/E (price ÷ last 12 months' actual EPS) for names
  // Yahoo doesn't publish a forward multiple for.
  const forwardPE = num(defaultKeyStatistics.forwardPE) ?? num(summaryDetail.forwardPE);
  let peMultiple: number | null = forwardPE;
  let peSource: "forward" | "trailing" = "forward";
  if (peMultiple === null) {
    const trailingPE = num(summaryDetail.trailingPE);
    const currentPrice = num(financialData.currentPrice);
    const trailingEps = num(defaultKeyStatistics.trailingEps);
    peMultiple = trailingPE ?? (currentPrice !== null && trailingEps ? currentPrice / trailingEps : null);
    peSource = "trailing";
  }

  if (peMultiple === null || peMultiple <= 0) {
    return { symbol: symbol.toUpperCase(), peMultiple: 0, peSource, ranges: [] };
  }

  const trend = Array.isArray(earningsTrend.trend) ? earningsTrend.trend as Record<string, unknown>[] : [];
  const ranges: EpsRangeOut[] = [];
  for (const [period, label] of [["+1y", "1y"], ["+2y", "2y"]] as const) {
    const row = trend.find((t) => t.period === period);
    if (!row) continue;
    const est = (row.earningsEstimate ?? {}) as Record<string, unknown>;
    const epsLow = num(est.low);
    const epsHigh = num(est.high);
    if (epsLow === null || epsHigh === null) continue;
    // 2026-09-18新增：亏损股的P/E×EPS这套算法本来就不成立——如果某一年
    // 分析师预估的低值EPS还是负的（还没转正），"负EPS × 市盈率"算出来的
    // 是个没有意义的负数价格，不是"更悲观的估值下限"。这种情况直接跳过
    // 这一期，而不是硬算出一个误导性的数字。真正整体亏损、Yahoo自己都
    // 不给forwardPE/trailingPE的标的，前面peMultiple<=0那道检查已经会让
    // 整个徽章不显示，这里补的是"多数时间盈利但个别年份预估仍亏损"这个
    // 更细的边界情况。
    if (epsLow <= 0) continue;
    ranges.push({
      period: label,
      epsLow,
      epsHigh,
      low: Math.round(epsLow * peMultiple * 100) / 100,
      high: Math.round(epsHigh * peMultiple * 100) / 100,
      numberOfAnalysts: num(est.numberOfAnalysts),
    });
  }

  return { symbol: symbol.toUpperCase(), peMultiple: Math.round(peMultiple * 100) / 100, peSource, ranges };
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

    const cacheKey = symbol.toUpperCase();
    const cached = await readCache(cacheKey);
    if (cached) {
      return new Response(
        JSON.stringify(cached),
        { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "HIT" } },
      );
    }

    const result = await fetchQuoteSummary(symbol);
    const out = buildEstimate(symbol, result);

    await writeCache(cacheKey, out.symbol, out);

    return new Response(
      JSON.stringify(out),
      { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "MISS" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
