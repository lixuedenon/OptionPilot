// src/lib/earnings.ts
// 财报这一组（2026-10-07，xue确认过示意图）：
// ① 持仓建议卡"财报"一行：第几天有财报、市场押财报后涨跌多少（财报后第一个到期日的平值跨式 ÷ 现价）、卖出腿在不在这个范围里
// ② 万次推演：财报那天加一次跳空（大小按市场押的幅度），财报后各腿隐含波动率回落（IV crush）——引擎在winRateSim（SimSetup.earnings）
// ③ 过去几次财报实际动了多少（从日线找财报前后的真实涨跌）
// ④ ⑦①把"跨财报 / 不跨财报"的时段分开比（lib/retroHistory.ts的regime）
// 财报日期从Edge Function earnings-dates拿：下一次=Yahoo，过去=SEC 8-K Item 2.02的申报日期。
//
// 盘前还是盘后公布：SEC的申报时间不可靠（时区标注有歧义、有的公司隔天才交），所以不用它，直接看日线——
// 公布日当天的涨跌 vs 第二个交易日的涨跌，哪个大就是哪天反应的（盘前公布当天反应，盘后公布第二天反应）。
// 下一次财报按这家公司过去多数时候的习惯推（没有历史就当盘后，美股多数公司盘后公布）。
import { useEffect, useState } from "react";
import { bsPrice } from "./bs";
import { RATE } from "./pricing";
import { atmIvFromChain } from "./atmIv";
import { getOptionChain } from "./optionChain";
import { fetchHistoricalSeries } from "./historicalVolatility";
import { dteFromDate, todayISO, daysBetweenLocalDates, formatDateInput } from "./dateUtils";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// "过去几次财报"列几次
export const PAST_SHOWN = 8;
// √(π/2)：正态分布 E|X| = σ·√(2/π)，所以"平均涨跌幅度"换成标准差要乘它
const ABS_TO_SD = Math.sqrt(Math.PI / 2);

export interface EarningsDates {
  next: string | null; // 下一次财报日（美东日期）
  nextEstimated: boolean;
  past: string[]; // 过去的财报公布日，从旧到新
}

const datesCache = new Map<string, { at: number; p: Promise<EarningsDates> }>();

export function fetchEarningsDates(symbol: string): Promise<EarningsDates> {
  const sym = symbol.trim().toUpperCase();
  const hit = datesCache.get(sym);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.p;
  const p = (async () => {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/earnings-dates?symbol=${encodeURIComponent(sym)}`, {
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) throw new Error(`earnings-dates ${resp.status}`);
    const d = await resp.json();
    return {
      next: typeof d?.next === "string" ? d.next : null,
      nextEstimated: d?.nextEstimated === true,
      past: Array.isArray(d?.past) ? (d.past as unknown[]).filter((x): x is string => typeof x === "string").sort() : [],
    };
  })();
  datesCache.set(sym, { at: Date.now(), p });
  p.catch(() => datesCache.delete(sym));
  return p;
}

// 拿不到（没部署、ETF、网络）时 data=null；界面上就当没有财报信息，不报错
export function useEarningsDates(symbol: string): { status: "loading" | "ok" | "error"; data: EarningsDates | null } {
  const sym = symbol.trim().toUpperCase();
  const [st, setSt] = useState<{ sym: string; status: "loading" | "ok" | "error"; data: EarningsDates | null }>({ sym, status: "loading", data: null });
  useEffect(() => {
    if (!sym) return;
    let alive = true;
    setSt({ sym, status: "loading", data: null });
    fetchEarningsDates(sym)
      .then((d) => alive && setSt({ sym, status: "ok", data: d }))
      .catch(() => alive && setSt({ sym, status: "error", data: null }));
    return () => {
      alive = false;
    };
  }, [sym]);
  return st.sym === sym ? { status: st.status, data: st.data } : { status: "loading", data: null };
}

// ── 过去的财报反应 ──
export interface Reaction {
  date: string; // 公布日
  day: string; // 股价反应的那个交易日
  t: number; // 反应那天日线的时间戳（unix秒）
  move: number; // 反应那天的涨跌（小数）：前一个收盘 → 那天收盘
  afterClose: boolean | null; // true=第二天反应（盘后公布），false=当天反应（盘前/盘中），null=公布日不是交易日
}

const isoOf = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10); // Yahoo日线时间戳在美东开盘时刻（UTC 13:30/14:30），UTC日期=美东日期

export function earningsReactions(series: { closes: number[]; timestamps: number[] }, past: string[]): Reaction[] {
  const n = Math.min(series.closes.length, series.timestamps.length);
  if (n < 3) return [];
  const iso = series.timestamps.slice(0, n).map(isoOf);
  const c = series.closes;
  const out: Reaction[] = [];
  for (const D of past) {
    let i = 0;
    while (i < n && iso[i] < D) i++;
    if (i < 1 || i >= n) continue; // 数据里没有公布日前后
    if (iso[i] > D) {
      // 公布日不是交易日（周末/假日公布）：第一个交易日反应
      out.push({ date: D, day: iso[i], t: series.timestamps[i], move: c[i] / c[i - 1] - 1, afterClose: null });
      continue;
    }
    if (i + 1 >= n) continue; // 公布日就是最后一天：盘后公布的话反应还没发生，不算
    const same = c[i] / c[i - 1] - 1;
    const next = c[i + 1] / c[i] - 1;
    const k = Math.abs(next) > Math.abs(same) ? i + 1 : i;
    out.push({ date: D, day: iso[k], t: series.timestamps[k], move: k === i ? same : next, afterClose: k !== i });
  }
  return out;
}

// 这家公司多数时候盘后公布吗（看得出的那几次里过半）；一次都看不出时null
export function typicalAfterClose(rs: Reaction[]): boolean | null {
  const known = rs.filter((r) => r.afterClose != null);
  if (!known.length) return null;
  return known.filter((r) => r.afterClose).length * 2 >= known.length;
}

// 下一个工作日（不管节假日：假日那周最多差一天，对按日推演影响很小）
export function nextWeekday(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

// 股价哪天反应：盘后公布（或不知道，按盘后算）=下一个工作日；盘前=当天；公布日本身是周末也落到下一个工作日
export function reactionDateOf(date: string, afterClose: boolean | null): string {
  const wd = new Date(date + "T12:00:00Z").getUTCDay();
  if (wd === 0 || wd === 6) return nextWeekday(date);
  return afterClose === false ? date : nextWeekday(date);
}

// ── 市场押多少 ──
export interface ImpliedMove {
  move: number; // 市场押财报那一下涨跌约±多少（小数）= 跳空的平均幅度 jump·√(2/π)，不含到期前平常日子的波动
  jump: number; // 推演用的跳空大小（对数涨跌的标准差）：从期限结构里扣掉平常日子的波动
  iv1: number; // 财报后第一个到期日的平值IV
  straddle: number; // 那个到期日的平值跨式÷现价（到期日为止的总幅度，含平常日子）
}

// c1：财报后第一个到期日的期权链和剩余天数；c2：再往后至少3周的一个到期日（用来估"平常日子"的波动），可以没有。
// 跳空：σ1²·T1 = 平常波动²·T1 + 跳空²；平常波动从两个到期日解出来（b² = (σ2²T2 − σ1²T1)/(T2−T1)），
// 解不出或不合理时按σ1的六成算；跳空至少留σ1·√T1的四成（避免期限结构倒挂时算成0）。
export function impliedFromChains(
  spot: number,
  c1: { chain: Parameters<typeof atmIvFromChain>[0]; dte: number },
  c2?: { chain: Parameters<typeof atmIvFromChain>[0]; dte: number } | null,
): ImpliedMove | null {
  if (!(spot > 0) || !(c1.dte > 0)) return null;
  const s1 = atmIvFromChain(c1.chain, spot, c1.dte);
  if (s1 == null) return null;
  const T1 = c1.dte / 365;
  // 平值跨式÷现价是"到这个到期日为止"的幅度：财报离到期日近时≈财报那一下，离得远（比如财报后第一个到期日还有一个月）
  // 里面大半是平常日子的波动，跟过去财报"一天的反应"没法比。所以"市场押"只取跳空那部分（2026-10-07 xue实测AAPL发现）。
  const straddle = (bsPrice(spot, spot, c1.dte, s1, RATE, "call") + bsPrice(spot, spot, c1.dte, s1, RATE, "put")) / spot;
  let b2 = (0.6 * s1) ** 2;
  if (c2 && c2.dte >= c1.dte + 7) {
    const s2 = atmIvFromChain(c2.chain, spot, c2.dte);
    if (s2 != null) {
      const T2 = c2.dte / 365;
      const est = (s2 * s2 * T2 - s1 * s1 * T1) / (T2 - T1);
      if (est > 0) b2 = Math.min((0.95 * s1) ** 2, Math.max((0.3 * s1) ** 2, est));
    }
  }
  const jump = Math.sqrt(Math.max(s1 * s1 * T1 - b2 * T1, 0.16 * s1 * s1 * T1));
  return { move: jump / ABS_TO_SD, jump, iv1: s1, straddle };
}

// 没有期权链时退回过去几次财报的平均幅度
export function jumpFromPast(rs: Reaction[]): { move: number; jump: number } | null {
  const recent = rs.slice(-PAST_SHOWN);
  if (recent.length < 2) return null;
  const m = recent.reduce((a, r) => a + Math.abs(r.move), 0) / recent.length;
  return m > 0 ? { move: m, jump: m * ABS_TO_SD } : null;
}

// 推演里平常日子的波动：按隐含波动率推演时，隐含波动率本身含着财报的跳空，加了跳空要从里面扣掉，不然算了两遍。
// days=推演多少天（到最早到期日）；至少留原来的一半。手填/按最近实际波动时不用扣（那里面没有这次财报）。
export function exEarningsVol(vol: number, jump: number, days: number): number {
  if (!(days > 0) || !(jump > 0)) return vol;
  return Math.sqrt(Math.max((0.5 * vol) ** 2, vol * vol - (jump * jump * 365) / days));
}

// ── 合起来：App用 ──
export interface EarningsCtx {
  next: string; // 下一次财报公布日
  reaction: string; // 股价哪天反应
  estimated: boolean; // 公司还没确认日期
  afterClose: boolean | null; // 按过去习惯推的盘前/盘后（null=没有历史，按盘后算）
  dayFromOpen: number; // 反应那天是开仓后第几天（日历天）
  dayFromToday: number; // 离今天几天
  move: number | null; // 市场押的幅度（或过去平均），拿不到null
  jump: number | null; // 推演用的跳空大小
  moveSource: "market" | "past" | null;
  expiry: string | null; // 用来算"市场押"的那个到期日
  reactions: Reaction[]; // 过去几次（最多PAST_SHOWN次，从旧到新）
}

export interface EarningsState {
  status: "loading" | "ok" | "none" | "error"; // none=没有下一次财报的信息（ETF、没部署、Yahoo没给）
  ctx: EarningsCtx | null;
  past: Reaction[]; // 过去的财报反应（有日期就有，跟下一次无关）
}

const EMPTY: EarningsState = { status: "loading", ctx: null, past: [] };

export function useEarningsContext({ symbol, spot, openingAt, enabled }: { symbol: string; spot: number; openingAt: number; enabled: boolean }): EarningsState {
  const sym = symbol.trim().toUpperCase();
  const dates = useEarningsDates(enabled ? sym : "");
  const [series, setSeries] = useState<{ sym: string; s: { closes: number[]; timestamps: number[] } | null }>({ sym: "", s: null });
  // base=代码|反应日：换了才清掉旧值；股价按2%一档重算（报价每跳一下就重算会让万次推演一直重跑），重算期间先用上一次的
  const [implied, setImplied] = useState<{ base: string; v: (ImpliedMove & { expiry: string }) | null } | null>(null);

  useEffect(() => {
    if (!enabled || !sym) return;
    let alive = true;
    fetchHistoricalSeries(sym, "2y")
      .then((s) => alive && setSeries({ sym, s: s.timestamps.length === s.closes.length ? s : null }))
      .catch(() => alive && setSeries({ sym, s: null }));
    return () => {
      alive = false;
    };
  }, [enabled, sym]);

  const past = series.sym === sym && series.s && dates.data ? earningsReactions(series.s, dates.data.past) : [];
  const afterClose = typicalAfterClose(past);
  const next = dates.data?.next ?? null;
  const reaction = next ? reactionDateOf(next, afterClose) : null;
  const today = todayISO();
  const dayFromToday = reaction ? daysBetweenLocalDates(today, reaction) : 0;
  const impliedBase = enabled && reaction && dayFromToday >= 0 && spot > 0 ? `${sym}|${reaction}` : "";
  const impliedKey = impliedBase ? `${impliedBase}|${Math.round(Math.log(spot) * 50)}` : "";

  useEffect(() => {
    if (!impliedKey || !reaction) return;
    let alive = true;
    (async () => {
      try {
        const c0 = await getOptionChain(sym, Math.max(0, dayFromToday));
        const exps = [...new Set(c0.expirationDates.map((e) => isoOf(e)))].sort();
        const e1 = exps.find((e) => e >= reaction);
        if (!e1) throw new Error("no expiry after earnings");
        const d1 = dteFromDate(e1);
        const e2 = exps.find((e) => daysBetweenLocalDates(e1, e) >= 21);
        const [ch1, ch2] = await Promise.all([
          getOptionChain(sym, d1),
          e2 ? getOptionChain(sym, dteFromDate(e2)).catch(() => null) : Promise.resolve(null),
        ]);
        if (ch1.usedExpiryDate !== e1) throw new Error("expiry mismatch");
        const v = impliedFromChains(spot, { chain: ch1, dte: Math.max(0.5, d1) }, ch2 && e2 && ch2.usedExpiryDate === e2 ? { chain: ch2, dte: dteFromDate(e2) } : null);
        if (alive) setImplied((old) => (v ? { base: impliedBase, v: { ...v, expiry: e1 } } : old && old.base === impliedBase ? old : { base: impliedBase, v: null }));
      } catch {
        if (alive) setImplied((old) => (old && old.base === impliedBase ? old : { base: impliedBase, v: null }));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impliedKey]);

  if (!enabled || !sym) return EMPTY;
  if (dates.status === "loading") return EMPTY;
  if (dates.status === "error" || !dates.data) return { status: "error", ctx: null, past: [] };
  if (!next || !reaction || dayFromToday < 0) return { status: "none", ctx: null, past };
  const imp = implied && implied.base === impliedBase ? implied.v : null;
  const fallback = imp ? null : jumpFromPast(past);
  const ctx: EarningsCtx = {
    next,
    reaction,
    estimated: dates.data.nextEstimated,
    afterClose,
    dayFromOpen: daysBetweenLocalDates(formatDateInput(openingAt), reaction),
    dayFromToday,
    move: imp ? imp.move : fallback ? fallback.move : null,
    jump: imp ? imp.jump : fallback ? fallback.jump : null,
    moveSource: imp ? "market" : fallback ? "past" : null,
    expiry: imp ? imp.expiry : null,
    reactions: past.slice(-PAST_SHOWN),
  };
  return { status: "ok", ctx, past };
}

// 推演从第startDay天出发（开仓=0；情景分叉=情景那天）时，财报落在第几天；不在 1..horizon 里就不算
export function earningsDayFrom(ctx: EarningsCtx | null, startDay: number, horizon: number): number | null {
  if (!ctx) return null;
  const d = ctx.dayFromOpen - Math.round(startDay);
  return d >= 1 && d <= horizon ? d : null;
}
