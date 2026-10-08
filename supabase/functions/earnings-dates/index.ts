// supabase/functions/earnings-dates/index.ts
// 财报日期（2026-10-07，财报这一组）：
// - 下一次财报日：Yahoo quoteSummary 的 calendarEvents（跟 record-iv 同一个来源；公司还没确认时Yahoo给一个日期区间，标 estimated）。
// - 过去的财报日：SEC EDGAR 公开的申报记录——公司公布季度业绩时要交一份 8-K，里面勾 Item 2.02（Results of Operations and Financial Condition），
//   这份 8-K 的申报日期就是财报公布日（盘前公布=当天，盘后公布=当天，股价反应在第二个交易日；前端按真实日线判断是哪一天反应的）。
//   外国公司（交 6-K 的，比如 BABA、TSM）和 ETF 没有 8-K，过去日期是空的，前端会退回只看"涨跌最大的那一天"。
// 结果存进 price_history_cache（range='earnings'，不用新建表），12小时内同一个代码只查一次。
// SEC 要求请求头 User-Agent 带联系方式：部署前设置 supabase secrets set SEC_USER_AGENT="OptionPilot 你的邮箱"。没设也能跑，但SEC可能拒绝。
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const YAHOO_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const SEC_UA = Deno.env.get("SEC_USER_AGENT") || "OptionPilot earnings-dates (contact not set)";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PAST_YEARS = 6; // 过去财报留多少年（⑦①最多看2年，"过去几次财报"看8次，6年足够）

export interface EarningsDatesResult {
  symbol: string;
  next: string | null; // 下一次财报日（美东日期 yyyy-mm-dd），没有/已过=null
  nextEstimated: boolean; // 公司还没确认（Yahoo给的是区间或标了估计）
  past: string[]; // 过去的财报公布日（8-K Item 2.02 的申报日期，美东日期），从旧到新
  sources: { next: "yahoo" | null; past: "sec" | null };
}

function db() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function readCache(symbol: string): Promise<EarningsDatesResult | null> {
  try {
    const { data, error } = await db().from("price_history_cache").select("data, fetched_at").eq("symbol", symbol).eq("range", "earnings").maybeSingle();
    if (error || !data) return null;
    if (Date.now() - new Date(data.fetched_at as string).getTime() > CACHE_TTL_MS) return null;
    return data.data as EarningsDatesResult;
  } catch {
    return null;
  }
}

async function writeCache(symbol: string, result: EarningsDatesResult): Promise<void> {
  try {
    await db().from("price_history_cache").upsert({ symbol, range: "earnings", data: result, fetched_at: new Date().toISOString() });
  } catch {
    /* 缓存只是省请求 */
  }
}

// 美东日期
function etDate(ms: number): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date(ms));
}

// ── Yahoo：下一次财报日（cookie + crumb，跟 record-iv / option-chain 同一套握手）──
let cookie: string | null = null;
let crumb: string | null = null;
async function yahooAuth(force = false) {
  if (cookie && crumb && !force) return;
  const r1 = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": YAHOO_UA } });
  const sc = r1.headers.get("set-cookie");
  if (!sc) throw new Error("no Yahoo cookie");
  cookie = sc.split(";")[0];
  const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": YAHOO_UA, Cookie: cookie } });
  const c = (await r2.text()).trim();
  if (!r2.ok || !c || c.includes("<")) throw new Error("no Yahoo crumb");
  crumb = c;
}

async function nextEarnings(symbol: string): Promise<{ date: string; estimated: boolean } | null> {
  try {
    await yahooAuth();
    const url = () => `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents&crumb=${crumb}`;
    let r = await fetch(url(), { headers: { "User-Agent": YAHOO_UA, Cookie: cookie! } });
    if (r.status === 401 || r.status === 403) {
      await yahooAuth(true);
      r = await fetch(url(), { headers: { "User-Agent": YAHOO_UA, Cookie: cookie! } });
    }
    if (!r.ok) return null;
    const data = await r.json() as {
      quoteSummary?: { result?: { calendarEvents?: { earnings?: { earningsDate?: { raw?: number }[]; isEarningsDateEstimate?: boolean } } }[] };
    };
    const e = data?.quoteSummary?.result?.[0]?.calendarEvents?.earnings;
    const raws = (e?.earningsDate ?? []).map((x) => x?.raw).filter((x): x is number => typeof x === "number");
    if (!raws.length) return null;
    const dates = raws.map((r) => etDate(r * 1000)).sort();
    const date = dates[0];
    if (date < etDate(Date.now())) return null; // Yahoo有时还挂着上一次的
    return { date, estimated: e?.isEarningsDateEstimate === true || new Set(dates).size > 1 };
  } catch {
    return null;
  }
}

// ── SEC：过去的财报日 ──
let tickerMap: Map<string, number> | null = null;
async function cikOf(symbol: string): Promise<number | null> {
  if (!tickerMap) {
    const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": SEC_UA } });
    if (!r.ok) throw new Error(`SEC tickers ${r.status}`);
    const j = await r.json() as Record<string, { cik_str: number; ticker: string }>;
    tickerMap = new Map(Object.values(j).map((x) => [x.ticker.toUpperCase(), x.cik_str]));
  }
  // SEC 用 BRK-B，Yahoo/用户常写 BRK.B
  return tickerMap.get(symbol) ?? tickerMap.get(symbol.replace(/\./g, "-")) ?? null;
}

interface FilingArrays { form?: string[]; items?: string[]; filingDate?: string[] }

function pick(f: FilingArrays, out: string[]) {
  const n = Math.min(f.form?.length ?? 0, f.items?.length ?? 0, f.filingDate?.length ?? 0);
  for (let i = 0; i < n; i++) {
    if (f.form![i] === "8-K" && f.items![i].split(",").map((s) => s.trim()).includes("2.02")) out.push(f.filingDate![i]);
  }
}

async function pastEarnings(symbol: string): Promise<string[] | null> {
  try {
    const cik = await cikOf(symbol);
    if (cik == null) return null;
    const pad = String(cik).padStart(10, "0");
    const r = await fetch(`https://data.sec.gov/submissions/CIK${pad}.json`, { headers: { "User-Agent": SEC_UA } });
    if (!r.ok) return null;
    const j = await r.json() as { filings?: { recent?: FilingArrays & { filingDate?: string[] }; files?: { name: string; filingFrom?: string; filingTo?: string }[] } };
    const dates: string[] = [];
    const recent = j.filings?.recent ?? {};
    pick(recent, dates);
    // recent 只放最近约1000份申报；申报多的公司（大量 Form 4）可能只覆盖一两年，不够就再读一份更早的
    const since = new Date(Date.now() - PAST_YEARS * 365 * 86400000).toISOString().slice(0, 10);
    const oldestRecent = (recent.filingDate ?? []).reduce((m, d) => (d < m ? d : m), "9999-99-99");
    if (oldestRecent > since) {
      const older = (j.filings?.files ?? []).filter((f) => !f.filingTo || f.filingTo >= since).slice(0, 2);
      for (const f of older) {
        const r2 = await fetch(`https://data.sec.gov/submissions/${f.name}`, { headers: { "User-Agent": SEC_UA } });
        if (r2.ok) pick(await r2.json() as FilingArrays, dates);
      }
    }
    // 同一次财报偶尔会补交一份（8-K/A不算，但有的公司隔一两天再交一份2.02）：7天内只留最早那天
    const sorted = [...new Set(dates)].filter((d) => d >= since).sort();
    const kept: string[] = [];
    for (const d of sorted) {
      if (!kept.length || Date.parse(d) - Date.parse(kept[kept.length - 1]) > 7 * 86400000) kept.push(d);
    }
    return kept;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const raw = new URL(req.url).searchParams.get("symbol");
    if (!raw) {
      return new Response(JSON.stringify({ error: "Missing 'symbol' query parameter" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const symbol = raw.trim().toUpperCase();
    const cached = await readCache(symbol);
    if (cached) return new Response(JSON.stringify(cached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const [next, past] = await Promise.all([nextEarnings(symbol), pastEarnings(symbol)]);
    const out: EarningsDatesResult = {
      symbol,
      next: next?.date ?? null,
      nextEstimated: next?.estimated ?? false,
      past: past ?? [],
      sources: { next: next ? "yahoo" : null, past: past ? "sec" : null },
    };
    // 两边都失败（多半是网络/被拒）就不缓存，下次再试
    if (next || past) await writeCache(symbol, out);
    return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
