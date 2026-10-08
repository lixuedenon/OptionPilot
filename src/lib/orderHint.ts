// src/lib/orderHint.ts
// 挂单提示（2026-10-06，xue：挂单价跟市场价差得多时，告诉用户按这个权利金挂单，股价要到多少才会成交）。
// 思路：成交=这张期权（或整个组合的净价）在市场上值到你挂的价。隐含波动率按现在的市场价反推、保持不变，
// 反解"股价到多少时期权值这么多"；再按同一个波动率模拟股价，算今天/3天内碰到的机会（成交价会随时间价值减少往外移）。
// 前提写在界面上：IV不变（实际下跌时IV往往会涨，Put涨得更快，会比算的更早成交）。
import type { Leg } from "./types";
import { bsPrice } from "./bs";
import { impliedVol, RATE } from "./pricing";
import { mulberry32 } from "./winRateSim";

// 挂单价跟市场中间价至少差这么多才提示：$0.05，或市场价的5%，取大的
export function orderGap(mid: number): number {
  return Math.max(0.05, Math.abs(mid) * 0.05);
}

export interface PricedLeg {
  leg: Leg;
  mid: number; // 市场中间价（每股，正数）
}

interface ValueFn {
  // 第daysAhead天、股价S时，"你这一边"值多少：卖出/收钱=市场上能收到多少；买入/付钱=要付多少（都是正数）
  (S: number, daysAhead: number): number;
}

// 解 side×(f(S) − limit) = 0：从现价往下、往上各找离现价最近的成交股价（组合的净价可能两边都有，比如铁鹰）
function solveSides(f: ValueFn, limit: number, side: 1 | -1, spot: number, daysAhead: number): { down: number | null; up: number | null } {
  const g = (S: number) => side * (f(S, daysAhead) - limit);
  const find = (dir: 1 | -1): number | null => {
    let prevS = spot;
    let prev = g(spot);
    if (prev >= 0) return spot;
    for (let k = 1; k <= 200; k++) {
      const S = spot * (1 + dir * 0.0025 * k); // 每步0.25%，最远±50%
      if (S <= 0.01) break;
      const v = g(S);
      if (v >= 0) {
        let lo = prevS, hi = S;
        for (let i = 0; i < 40; i++) {
          const m = (lo + hi) / 2;
          if (g(m) >= 0) hi = m;
          else lo = m;
        }
        return (lo + hi) / 2;
      }
      prevS = S;
      prev = v;
    }
    return null;
  };
  return { down: find(-1), up: find(1) };
}

// 按同一个波动率模拟股价（每个交易日13步、零漂移），成交线从第0天的价位随时间线性移到第3天的价位；返回[今天内, 3天内]成交的比例
function fillOdds(spot: number, vol: number, now: { down: number | null; up: number | null }, d3: { down: number | null; up: number | null }): [number, number] {
  const rnd = mulberry32(20261006);
  const gauss = () => {
    let u = 0;
    while (u === 0) u = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  const STEPS = 13, DAYS = 3, P = 2000;
  const sd = vol * Math.sqrt(1 / 252 / STEPS);
  const lerp = (a: number | null, b: number | null, f: number) => (a == null ? null : b == null ? a : a + (b - a) * f);
  let hit1 = 0, hit3 = 0;
  for (let i = 0; i < P; i++) {
    let S = spot;
    for (let k = 1; k <= STEPS * DAYS; k++) {
      S *= Math.exp(-0.5 * sd * sd + sd * gauss());
      const f = Math.min(1, k / STEPS / DAYS);
      const lo = lerp(now.down, d3.down, f), hi = lerp(now.up, d3.up, f);
      if ((lo != null && S <= lo) || (hi != null && S >= hi)) {
        if (k <= STEPS) hit1++;
        hit3++;
        break;
      }
    }
  }
  return [hit1 / P, hit3 / P];
}

export interface OrderHint {
  kind: "wait" | "marketable";
  side: 1 | -1; // 1=卖出/净收钱，-1=买入/净付钱
  limit: number; // 你挂的价（正数）
  market: number; // 现在的市场价（正数）
  now: { down: number | null; up: number | null }; // 今天要成交，股价要到哪
  day3: { down: number | null; up: number | null }; // 拖到第3天成交，股价要到哪
  odds: [number, number] | null; // 今天内、3天内成交的机会
  vol: number;
}

function build(f: ValueFn, limit: number, market: number, side: 1 | -1, spot: number, vol: number): OrderHint | null {
  if (!(spot > 0) || !(limit > 0)) return null;
  if (Math.abs(limit - market) < orderGap(market)) return null;
  // 挂得比市场价"差"（卖得更低/买得更高）：基本马上成交
  if (side * (market - limit) >= 0) return { kind: "marketable", side, limit, market, now: { down: null, up: null }, day3: { down: null, up: null }, odds: null, vol };
  const now = solveSides(f, limit, side, spot, 0);
  // "3天"按3个交易日：模拟里是3个交易日的涨跌，时间价值按对应的日历天数（3×365/252≈4.3天）扣
  const day3 = solveSides(f, limit, side, spot, (3 * 365) / 252);
  if (now.down == null && now.up == null) return { kind: "wait", side, limit, market, now, day3, odds: [0, 0], vol };
  return { kind: "wait", side, limit, market, now, day3, odds: fillOdds(spot, vol, now, day3), vol };
}

// 单腿：limit=你填的权利金，mid=市场中间价
export function legOrderHint(leg: Leg, mid: number, spot: number, skew = 0): OrderHint | null {
  if (leg.kind === "stock" || !(mid > 0) || !(leg.dte > 0)) return null;
  const iv = impliedVol(spot, leg.strike, leg.dte, mid, leg.type);
  if (!(iv > 0.03)) return null;
  // skew：下跌时IV上升（第3组，lib/atmIv.ts的skewFromChain），0=IV不变
  const ivAt = (S: number) => Math.max(0.02, iv + skew * Math.log(spot / S));
  const f: ValueFn = (S, ahead) => bsPrice(S, leg.strike, Math.max(0.01, leg.dte - ahead), ivAt(S), RATE, leg.type);
  return build(f, leg.premium, mid, leg.action === "sell" ? 1 : -1, spot, iv);
}

// 整单：按各腿你填的权利金算净价，跟各腿市场中间价算的净价比。正股腿不参与（整单挂期权）。
export function comboOrderHint(priced: PricedLeg[], spot: number, skew = 0): OrderHint | null {
  const opts = priced.filter((p) => p.leg.kind !== "stock" && !p.leg.disabled && p.leg.dte > 0 && p.mid > 0);
  if (opts.length < 2 || opts.length !== priced.filter((p) => p.leg.kind !== "stock" && !p.leg.disabled).length) return null;
  const sgn = (l: Leg) => (l.action === "sell" ? 1 : -1) * (l.qty ?? 1);
  const netMine = opts.reduce((s, p) => s + sgn(p.leg) * p.leg.premium, 0);
  const netMkt = opts.reduce((s, p) => s + sgn(p.leg) * p.mid, 0);
  // 你的价跟市场价一个是净收、一个是净付（填错了或者正在改价），反解没有意义
  if (Math.abs(netMine) < 1e-9 || Math.abs(netMkt) < 1e-9 || Math.sign(netMine) !== Math.sign(netMkt)) return null;
  const side: 1 | -1 = netMkt >= 0 ? 1 : -1; // 净收钱=卖方
  const ivs = opts.map((p) => impliedVol(spot, p.leg.strike, p.leg.dte, p.mid, p.leg.type));
  if (ivs.some((v) => !(v > 0.03))) return null;
  // "你这一边"的净价：卖方=能收到的净权利金，买方=要付的净成本（都是正数）
  const f: ValueFn = (S, ahead) =>
    side * opts.reduce((s, p, i) => s + sgn(p.leg) * bsPrice(S, p.leg.strike, Math.max(0.01, p.leg.dte - ahead), Math.max(0.02, ivs[i] + skew * Math.log(spot / S)), RATE, p.leg.type), 0);
  const avgIv = ivs.reduce((a, b) => a + b, 0) / ivs.length;
  return build(f, Math.abs(netMine), Math.abs(netMkt), side, spot, avgIv);
}

// 到期盈亏平衡点里离 at 最近的那个（扫±50%），用来说"成交时离盈亏平衡还剩多少"。net：你收(+)/付(−)的净权利金
export function nearestBreakeven(legs: Leg[], net: number, at: number): number | null {
  const opts = legs.filter((l) => l.kind !== "stock" && !l.disabled);
  const pay = (S: number) =>
    net + opts.reduce((s, l) => {
      const intr = l.type === "call" ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S);
      return s + (l.action === "buy" ? 1 : -1) * (l.qty ?? 1) * intr;
    }, 0);
  let best: number | null = null;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const a = at * (0.5 + i / N), b = at * (0.5 + (i + 1) / N);
    const pa = pay(a), pb = pay(b);
    if ((pa > 0) !== (pb > 0)) {
      const x = a + ((b - a) * pa) / (pa - pb);
      if (best == null || Math.abs(x - at) < Math.abs(best - at)) best = x;
    }
  }
  return best;
}
