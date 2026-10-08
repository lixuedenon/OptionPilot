// src/lib/retroHistory.ts
// ⑦⑧（今昔对比·复盘评估）：用这只股票过去2年的真实走势评价这笔——
// ⑦① 你遇到的行情正不正常（这几天的涨跌放到过去2年所有同样长的时段里排第几）
// ⑦② 当初这笔开得好不好（只用开仓前2年的走势：胜率、理论上值多少、卖出腿离现价多远——跟后来的运气分开看）
// ⑦③ 你那次调整在当时合不合理（调整那天离卖出腿多远、还剩几天，过去2年同样的起点之后越过卖出腿的比例）
// ⑧ 规则复盘：几种规则放在你真实走过的这条路上（只看这一次） vs 放到开仓前2年所有同样的仓位里（以过去2年为准）
// 走势一律用lib/histPaths.ts切出来的"按日历日走的真实段"，定价/规则/成交损耗跟万次推演同一套（winRateSim）。
import type { Leg } from "./types";
import { buildHistPaths, MIN_HIST_PATHS, type HistPaths } from "./histPaths";
import { prepareSim, simPnlAt, exitCost, maxShortDelta, runBatchPaths, computeStats, holdOutcomes, type SimRules, type SimSetup, type Prepared, type ExitReason } from "./winRateSim";
import { suggestRules, type RuleSuggestion } from "./futureSim";

export interface Series {
  closes: number[];
  timestamps: number[]; // unix秒
}

const YEAR = 365 * 86400;

// 只留 [fromSec, toSec) 之间的日线
export function sliceSeries(s: Series, fromSec: number, toSec: number): Series {
  const closes: number[] = [], timestamps: number[] = [];
  for (let i = 0; i < Math.min(s.closes.length, s.timestamps.length); i++) {
    const t = s.timestamps[i];
    if (t >= fromSec && t < toSec) {
      closes.push(s.closes[i]);
      timestamps.push(t);
    }
  }
  return { closes, timestamps };
}

// 一段段的终点涨跌（小数）
function endReturns(h: HistPaths): number[] {
  const w = h.days + 1;
  const out: number[] = [];
  for (let k = 0; k < h.count; k++) out.push(h.ratios[k * w + h.days] - 1);
  return out;
}

// ⑦① 过去2年（到toSec为止）任意days天的涨跌分布，你这次myRet排在哪：pct=比你更极端（同方向更大）的比例
// 财报这一组（2026-10-07）：earnT=过去财报股价反应那天的日线时间戳（lib/earnings.ts的earningsReactions）。
// 中间跨过财报的段和没跨过的段涨跌幅度差很多，混在一起判断"罕不罕见"两头都不准，所以两组各自至少30段时分开算。
export interface RegimeGroup {
  n: number;
  pct: number; // 这一组里比你更极端的比例（0..100）
}
export interface Regime {
  n: number;
  myRet: number;
  pctMoreExtreme: number; // 0..100（全部段）
  bins: { lo: number; hi: number; count: number; earn: number }[]; // earn=其中跨过财报的段数
  split: { earn: RegimeGroup; plain: RegimeGroup } | null;
}
// 一段（起点那天收盘 → 第days天收盘）中间有没有财报反应日：反应日在起点之后、终点当天或之前
export function spansEarnings(startSec: number, days: number, earnT: number[]): boolean {
  return earnT.some((t) => t > startSec + 43200 && t <= startSec + days * 86400 + 43200);
}
export function regime(series: Series, days: number, myRet: number, toSec: number, earnT: number[] = []): Regime | null {
  const s = sliceSeries(series, toSec - 2 * YEAR, toSec + 86400);
  const D = Math.max(1, Math.round(days));
  const h = buildHistPaths(s, D);
  if (!h || h.count < MIN_HIST_PATHS) return null;
  const rets = endReturns(h);
  const beyond = (r: number) => (myRet < 0 ? r <= myRet : r >= myRet);
  const more = rets.filter(beyond).length;
  const lo = Math.min(...rets, myRet), hi = Math.max(...rets, myRet);
  const N = 16, w = (hi - lo) / N || 1;
  const bins = Array.from({ length: N }, (_, i) => ({ lo: lo + i * w, hi: lo + (i + 1) * w, count: 0, earn: 0 }));
  const isEarn = rets.map((_, k) => earnT.length > 0 && spansEarnings(h.starts[k], D, earnT));
  rets.forEach((r, k) => {
    const b = bins[Math.min(N - 1, Math.floor((r - lo) / w))];
    b.count++;
    if (isEarn[k]) b.earn++;
  });
  const group = (want: boolean): RegimeGroup => {
    const rs = rets.filter((_, k) => isEarn[k] === want);
    return { n: rs.length, pct: rs.length ? (rs.filter(beyond).length / rs.length) * 100 : 0 };
  };
  const ge = group(true), gp = group(false);
  const split = ge.n >= MIN_HIST_PATHS && gp.n >= MIN_HIST_PATHS ? { earn: ge, plain: gp } : null;
  return { n: h.count, myRet, pctMoreExtreme: (more / rets.length) * 100, bins, split };
}

// 开仓那天的日线时间戳：开仓日（本地日期 yyyy-mm-dd）当天或之前最近的一根。开仓那天之前（含当天开盘时）的跳空不算持仓期间的
export function openBarSec(series: Series, openISO: string): number | null {
  let out: number | null = null;
  for (let i = 0; i < Math.min(series.closes.length, series.timestamps.length); i++) {
    if (new Date(series.timestamps[i] * 1000).toISOString().slice(0, 10) <= openISO) out = series.timestamps[i];
    else break;
  }
  return out;
}

// 开仓以来涨跌最大的那一天（前一个收盘 → 那天收盘），是不是财报反应日。startSec=开仓那天的日线时间戳（openBarSec）
export function biggestDay(series: Series, startSec: number, days: number, earnT: number[]): { t: number; move: number; earn: boolean } | null {
  const n = Math.min(series.closes.length, series.timestamps.length);
  let best: { t: number; move: number; earn: boolean } | null = null;
  for (let i = 1; i < n; i++) {
    const t = series.timestamps[i];
    if (t <= startSec + 43200 || t > startSec + days * 86400 + 43200) continue;
    if (series.timestamps[i - 1] < startSec - 43200) continue; // 前一个收盘要在开仓那天或之后
    const move = series.closes[i] / series.closes[i - 1] - 1;
    if (!best || Math.abs(move) > Math.abs(best.move)) best = { t, move, earn: earnT.some((e) => Math.abs(e - t) < 43200) };
  }
  return best;
}

// ⑦② 只用开仓前2年的走势：按你的规则赚钱的比例、一直拿到期平均多少→理论上值多少
export interface EntryQuality {
  n: number;
  winPct: number; // 按你现在的规则
  holdAvg: number; // 一直拿到期平均每笔
  fair: number; // 这组期权理论上值多少（每股、正数）
  basis: number; // 你实际收/付的
  shortDist: number | null; // 离现价最近的卖出腿离开仓价多远（小数，正=虚值方向的距离）
}
export function entryQuality(series: Series, setup: SimSetup, openSec: number, credit: boolean): EntryQuality | null {
  const p = prepareSim(setup);
  if (!p) return null;
  const s = sliceSeries(series, openSec - 2 * YEAR, openSec);
  const h = buildHistPaths(s, p.horizon);
  if (!h || h.count < MIN_HIST_PATHS) return null;
  const src = { ratios: h.ratios, days: h.days, indices: Array.from({ length: h.count }, (_, i) => i) };
  const outs = runBatchPaths(p, src).outcomes;
  const st = computeStats(outs);
  const hold = computeStats(holdOutcomes(outs, p.horizon));
  const fair = credit ? p.basis - hold.avg : p.basis + hold.avg;
  const shorts = setup.legs.filter((l) => !l.disabled && l.kind !== "stock" && l.action === "sell");
  let shortDist: number | null = null;
  for (const l of shorts) {
    const d = l.type === "put" ? 1 - l.strike / setup.spot : l.strike / setup.spot - 1;
    if (shortDist == null || Math.abs(d) < Math.abs(shortDist)) shortDist = d;
  }
  return { n: h.count, winPct: st.winPct, holdAvg: hold.avg, fair: Math.max(0, fair), basis: p.basis, shortDist };
}

// ⑦③ 调整那天：股价price、卖出腿strike、还剩remaining天。过去2年（到那天为止）同样天数的走势里，终点越过卖出腿的比例
export interface AdjustOdds {
  n: number;
  dist: number; // 当时离卖出腿多远（小数，正=还在虚值一侧）
  remaining: number;
  pBeyond: number; // 0..100
}
export function adjustOdds(series: Series, atSec: number, price: number, leg: Leg, remaining: number): AdjustOdds | null {
  if (!(remaining >= 1) || !(price > 0)) return null;
  const s = sliceSeries(series, atSec - 2 * YEAR, atSec + 86400);
  const h = buildHistPaths(s, Math.round(remaining));
  if (!h || h.count < MIN_HIST_PATHS) return null;
  const need = leg.strike / price - 1; // 要涨/跌这么多才到卖出腿
  const rets = endReturns(h);
  const beyond = rets.filter((r) => (leg.type === "put" ? r <= need : r >= need)).length;
  const dist = leg.type === "put" ? 1 - leg.strike / price : leg.strike / price - 1;
  return { n: h.count, dist, remaining: Math.round(remaining), pBeyond: (beyond / rets.length) * 100 };
}

// ⑧ 只看这一次：一条规则沿真实走过的每天收盘价（day从开仓算），第一次该下车的那一点；没下车=到今天还拿着
export interface OnceResult {
  rules: SimRules;
  kind: ExitReason | "holding";
  day: number;
  pnl: number; // 下车时（已扣成交损耗）或今天的盈亏
  cost: number;
}
export function rulesOnce(setup: SimSetup, rulesList: SimRules[], path: { day: number; price: number }[]): OnceResult[] {
  const out: OnceResult[] = [];
  for (const rules of rulesList) {
    const p: Prepared | null = prepareSim({ ...setup, rules });
    if (!p) continue;
    let res: OnceResult | null = null;
    for (const x of path) {
      if (x.day <= 0 || x.day > p.horizon) continue;
      const pnl = simPnlAt(p, x.day, x.price);
      const early = (kind: ExitReason): OnceResult => {
        const cost = exitCost(p, x.day, x.price);
        return { rules, kind, day: x.day, pnl: pnl - cost, cost };
      };
      if (x.day >= p.endDay) res = p.endDay < p.horizon ? early("time") : { rules, kind: "expiry", day: x.day, pnl, cost: 0 };
      else if (pnl >= p.tpLine) res = early("tp");
      else if (pnl <= p.slLine) res = early("sl");
      else if (p.deltaExit != null && maxShortDelta(p, x.day, x.price) >= p.deltaExit) res = early("delta");
      if (res) break;
    }
    if (!res) {
      const inside = path.filter((x) => x.day > 0 && x.day <= p.horizon);
      const last = inside.length ? inside[inside.length - 1] : undefined;
      res = { rules, kind: "holding", day: last?.day ?? 0, pnl: last ? simPnlAt(p, last.day, last.price) : 0, cost: 0 };
    }
    out.push(res);
  }
  return out;
}

// ⑧ 放到开仓前2年：同样的规则对比表（跟万次推演"比一比"同一个函数，只是走势换成开仓前2年的真实段）
export function rulesHistory(series: Series, setup: SimSetup, openSec: number, side: "credit" | "debit"): RuleSuggestion | null {
  const p = prepareSim(setup);
  if (!p) return null;
  const s = sliceSeries(series, openSec - 2 * YEAR, openSec);
  const h = buildHistPaths(s, p.horizon);
  if (!h || h.count < MIN_HIST_PATHS) return null;
  return suggestRules(setup, 0, h.count, 0, side, { ratios: h.ratios, days: h.days, indices: Array.from({ length: h.count }, (_, i) => i) });
}

// 开仓以来每天的真实收盘价（day=开仓后第几天，日历日）
export function dailyPathSince(series: Series, openSec: number, upToDay: number): { day: number; price: number }[] {
  const out: { day: number; price: number }[] = [];
  for (let i = 0; i < Math.min(series.closes.length, series.timestamps.length); i++) {
    const d = Math.round((series.timestamps[i] - openSec) / 86400);
    if (d >= 1 && d <= upToDay) out.push({ day: d, price: series.closes[i] });
  }
  return out;
}
