// supabase/functions/record-iv/index.ts
// 每天收盘前（美东15:40～15:55）由pg_cron叫起，给iv_watchlist里的股票记一份当天的平值隐含波动率和平值跨式价格，存进iv_daily。
// Yahoo只给"现在"的期权价，历史IV只能这样自己一天天攒（IV Rank要攒约一年）。
// 分片跑：请求体 {shard, shards} 只处理 下标 % shards == shard 的代码，每片慢慢发请求（约每秒3次），一次不超过Edge Function的时间上限。
// 安全：部署时 --no-verify-jwt，改用请求头 x-cron-secret 跟环境变量 CRON_SECRET 比对；不对就拒绝，防止别人随便触发。
// 只在美东15:35～16:05之间真正记录（cron按UTC排了夏令时、冬令时两套时间，不在窗口里的那套直接跳过）；{force:true}可在其它时间手动补记。
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { blackScholes } from "../_shared/bs.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const RATE = 0.05; // 跟前端定价同一个无风险利率
const GAP_MS = 330; // 两次Yahoo请求之间至少隔这么久
const TIME_BUDGET_MS = 120_000; // 超过就停，剩下的记进errors（免得撞上Edge Function的时间上限）

interface Row { strike: number; bid?: number; ask?: number; lastPrice?: number; impliedVolatility?: number }
interface Block { expirationDate: number; calls?: Row[]; puts?: Row[] }
interface Chain { quote?: { regularMarketPrice?: number; regularMarketTime?: number }; expirationDates?: number[]; options?: Block[] }

let cookie: string | null = null;
let crumb: string | null = null;
let lastCall = 0;

async function pace() {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function auth(force = false) {
  if (cookie && crumb && !force) return;
  await pace();
  const r1 = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA } });
  const sc = r1.headers.get("set-cookie");
  if (!sc) throw new Error("no Yahoo cookie");
  cookie = sc.split(";")[0];
  await pace();
  const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookie } });
  const c = (await r2.text()).trim();
  if (!r2.ok || !c || c.includes("<")) throw new Error("no Yahoo crumb");
  crumb = c;
}

async function yahooJson(url: (crumb: string) => string): Promise<unknown> {
  await auth();
  await pace();
  let r = await fetch(url(crumb!), { headers: { "User-Agent": UA, Cookie: cookie! } });
  if (r.status === 401 || r.status === 403) {
    await auth(true);
    await pace();
    r = await fetch(url(crumb!), { headers: { "User-Agent": UA, Cookie: cookie! } });
  }
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  return await r.json();
}

async function chain(symbol: string, date?: number): Promise<Chain> {
  const data = await yahooJson((c) => `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?${date ? `date=${date}&` : ""}crumb=${c}`) as { optionChain?: { result?: Chain[] } };
  const res = data?.optionChain?.result?.[0];
  if (!res) throw new Error("no chain");
  return res;
}

async function nextEarnings(symbol: string): Promise<number | null> {
  try {
    const data = await yahooJson((c) => `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents&crumb=${c}`) as {
      quoteSummary?: { result?: { calendarEvents?: { earnings?: { earningsDate?: { raw?: number }[] } } }[] };
    };
    const raw = data?.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate?.[0]?.raw;
    return typeof raw === "number" ? raw : null;
  } catch {
    return null;
  }
}

// ── 美东时间工具 ──
function etParts(ms: number) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
}
const isoUTC = (epoch: number) => new Date(epoch * 1000).toISOString().slice(0, 10);
// Yahoo的到期日时间戳是那天UTC 0点；期权在美东16:00到期，按此算剩余日历天（带小数）。
function dteOf(expEpoch: number, nowMs: number): number {
  const expDate = isoUTC(expEpoch);
  const close = Date.parse(`${expDate}T20:00:00Z`); // 夏令时16:00 ET；冬令时差1小时，对天数影响可忽略
  return Math.max(0, (close - nowMs) / 86_400_000);
}

// ── 定价 ──
function priceOf(r: Row | undefined): { p: number; src: "mid" | "last" } | null {
  if (!r) return null;
  if (r.bid && r.ask && r.bid > 0 && r.ask >= r.bid) return { p: (r.bid + r.ask) / 2, src: "mid" };
  if (r.lastPrice && r.lastPrice > 0) return { p: r.lastPrice, src: "last" };
  return null;
}
function impliedVol(spot: number, strike: number, dte: number, price: number, type: "call" | "put"): number | null {
  const intrinsic = type === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  if (!(price > intrinsic * 0.999) || dte <= 0.05) return null;
  let lo = 0.01, hi = 5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = blackScholes({ spot, strike, dte, vol: mid, rate: RATE, type }).price;
    if (v < price) lo = mid; else hi = mid;
  }
  const iv = (lo + hi) / 2;
  return iv > 0.011 && iv < 4.9 ? iv : null;
}

interface AtmInfo { exp: string; dte: number; iv: number | null; strike: number; straddle: number | null; yahooIv: number | null; src: string; used: unknown }

// 某个到期日的平值IV：现价两侧最近的两个行权价，各取call、put的IV平均，再按行权价线性插值到现价；跨式用离现价最近的那个行权价。
function atm(block: Block, spot: number, nowMs: number): AtmInfo | null {
  const dte = dteOf(block.expirationDate, nowMs);
  const calls = new Map((block.calls ?? []).map((r) => [r.strike, r]));
  const puts = new Map((block.puts ?? []).map((r) => [r.strike, r]));
  const strikes = [...new Set([...calls.keys()].filter((k) => puts.has(k)))].sort((a, b) => a - b);
  if (strikes.length < 2) return null;
  let i = strikes.findIndex((k) => k >= spot);
  if (i <= 0) i = i === 0 ? 1 : strikes.length - 1;
  const kLo = strikes[i - 1], kHi = strikes[i];
  let src = "mid";
  const ivAt = (k: number) => {
    const c = priceOf(calls.get(k)), p = priceOf(puts.get(k));
    if (c?.src === "last" || p?.src === "last") src = "last";
    const ivs = [c && impliedVol(spot, k, dte, c.p, "call"), p && impliedVol(spot, k, dte, p.p, "put")].filter((v): v is number => typeof v === "number");
    return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  };
  const a = ivAt(kLo), b = ivAt(kHi);
  let iv: number | null = null;
  if (a != null && b != null) iv = kHi > kLo ? a + ((b - a) * (spot - kLo)) / (kHi - kLo) : a;
  else iv = a ?? b;
  const kNear = Math.abs(kLo - spot) <= Math.abs(kHi - spot) ? kLo : kHi;
  const cN = priceOf(calls.get(kNear)), pN = priceOf(puts.get(kNear));
  const yIvs = [calls.get(kNear)?.impliedVolatility, puts.get(kNear)?.impliedVolatility].filter((v): v is number => typeof v === "number" && v > 0.02);
  return {
    exp: isoUTC(block.expirationDate), dte, iv, strike: kNear,
    straddle: cN && pN ? cN.p + pN.p : null,
    yahooIv: yIvs.length ? yIvs.reduce((x, y) => x + y, 0) / yIvs.length : null,
    src,
    used: { kLo, kHi, ivLo: a, ivHi: b, call: cN?.p ?? null, put: pN?.p ?? null },
  };
}

async function blockFor(symbol: string, base: Chain, exp: number): Promise<Block | null> {
  const hit = base.options?.find((o) => o.expirationDate === exp);
  if (hit) return hit;
  const c = await chain(symbol, exp);
  return c.options?.find((o) => o.expirationDate === exp) ?? c.options?.[0] ?? null;
}

async function recordOne(symbol: string, nowMs: number, quality: string, today: string) {
  const base = await chain(symbol);
  const spot = base.quote?.regularMarketPrice;
  if (!spot || !(spot > 0)) throw new Error("no spot");
  const mt = base.quote?.regularMarketTime;
  if (mt && etParts(mt * 1000).date !== today) return { skipped: "market closed today" };
  const exps = (base.expirationDates ?? []).slice().sort((a, b) => a - b);
  if (!exps.length) throw new Error("no expirations");
  const withDte = exps.map((e) => ({ e, d: dteOf(e, nowMs) }));
  const usable = withDte.filter((x) => x.d >= 7);
  const e1 = [...usable].reverse().find((x) => x.d <= 30) ?? null;
  const e2 = usable.find((x) => x.d > 30) ?? null;
  const front = withDte.find((x) => x.d >= 0.5) ?? withDte[0];

  const cache = new Map<number, AtmInfo | null>();
  const info = async (e: number) => {
    if (!cache.has(e)) {
      const b = await blockFor(symbol, base, e);
      cache.set(e, b ? atm(b, spot, nowMs) : null);
    }
    return cache.get(e) ?? null;
  };
  const a1 = e1 ? await info(e1.e) : null;
  const a2 = e2 ? await info(e2.e) : null;
  const af = await info(front.e);

  // 30天IV：两边都有时按方差-时间插值；只有一边就用那一边
  let iv30: number | null = null;
  if (a1?.iv != null && a2?.iv != null && a2.dte > a1.dte) {
    const t1 = a1.dte, t2 = a2.dte;
    const v = (a1.iv * a1.iv * t1 * (t2 - 30) + a2.iv * a2.iv * t2 * (30 - t1)) / (30 * (t2 - t1));
    iv30 = v > 0 ? Math.sqrt(v) : null;
  } else iv30 = a1?.iv ?? a2?.iv ?? null;

  // 财报后第一个到期日（财报在70天内才记）：它的跨式÷股价就是"市场押多少"
  const earn = await nextEarnings(symbol);
  let ae: AtmInfo | null = null;
  let earnDate: string | null = null;
  if (earn && earn * 1000 > nowMs - 86_400_000 && earn * 1000 - nowMs < 70 * 86_400_000) {
    earnDate = etParts(earn * 1000).date;
    const ee = exps.find((e) => isoUTC(e) > earnDate!);
    if (ee) ae = await info(ee);
  }

  const srcs = [a1, a2, af, ae].filter(Boolean).map((x) => x!.src);
  return {
    row: {
      symbol, trade_date: today, spot, iv30,
      e1: a1?.exp ?? null, dte1: a1?.dte ?? null, iv1: a1?.iv ?? null,
      e2: a2?.exp ?? null, dte2: a2?.dte ?? null, iv2: a2?.iv ?? null,
      front_exp: af?.exp ?? null, front_dte: af?.dte ?? null, front_strike: af?.strike ?? null, front_straddle: af?.straddle ?? null,
      earn_date: earnDate, earn_exp: ae?.exp ?? null, earn_dte: ae?.dte ?? null, earn_strike: ae?.strike ?? null, earn_straddle: ae?.straddle ?? null, earn_iv: ae?.iv ?? null,
      yahoo_iv1: a1?.yahooIv ?? null,
      price_source: srcs.includes("last") ? "last" : "mid",
      quality,
      details: { e1: a1?.used ?? null, e2: a2?.used ?? null, front: af?.used ?? null, earn: ae?.used ?? null },
      recorded_at: new Date(nowMs).toISOString(),
    },
  };
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  const body = await req.json().catch(() => ({})) as { shard?: number; shards?: number; force?: boolean; symbols?: string[] };
  const shards = Math.max(1, Math.floor(body.shards ?? 1));
  const shard = Math.min(shards - 1, Math.max(0, Math.floor(body.shard ?? 0)));
  const started = Date.now();
  const et = etParts(started);
  const inWindow = (et.hour === 15 && et.minute >= 35) || (et.hour === 16 && et.minute <= 5);
  if (!inWindow && !body.force) {
    return new Response(JSON.stringify({ skipped: "outside 15:35-16:05 ET", et }), { headers: { "Content-Type": "application/json" } });
  }
  const quality = et.hour >= 16 || et.hour < 9 || (et.hour === 9 && et.minute < 30) ? "after_close" : "regular";

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: run } = await db.from("iv_record_runs").insert({ shard, shards }).select("id").single();

  let symbols: string[];
  if (body.symbols?.length) symbols = body.symbols.map((s) => s.toUpperCase());
  else {
    const { data } = await db.from("iv_watchlist").select("symbol").eq("active", true).order("symbol");
    symbols = (data ?? []).map((r: { symbol: string }) => r.symbol);
  }
  const mine = symbols.filter((_, i) => i % shards === shard);

  let ok = 0, failed = 0;
  const errors: Record<string, string> = {};
  let skipped: string | null = null;
  for (let i = 0; i < mine.length; i++) {
    const sym = mine[i];
    if (Date.now() - started > TIME_BUDGET_MS) {
      errors._timeout = `stopped before ${mine.slice(i).join(",")}`;
      break;
    }
    try {
      const r = await recordOne(sym, Date.now(), quality, et.date);
      if ("skipped" in r) {
        skipped = r.skipped as string;
        break; // 休市：整片都不用跑了
      }
      const { error } = await db.from("iv_daily").upsert(r.row, { onConflict: "symbol,trade_date" });
      if (error) throw new Error(error.message);
      ok++;
    } catch (e) {
      failed++;
      errors[sym] = e instanceof Error ? e.message : String(e);
    }
  }
  if (run?.id) {
    await db.from("iv_record_runs").update({ finished_at: new Date().toISOString(), ok, failed, skipped, errors: Object.keys(errors).length ? errors : null }).eq("id", run.id);
  }
  return new Response(JSON.stringify({ shard, shards, total: mine.length, ok, failed, skipped, quality, date: et.date, errors }), { headers: { "Content-Type": "application/json" } });
});
