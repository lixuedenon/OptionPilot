// src/lib/retroStory.ts
// 今昔对比"万次推演"卡片的叙事数据：开仓→今天，组合的价值经历了什么（股价/时间/隐含波动率/调整各让你赚亏多少、
// 一段一段怎么走过来的）、这笔组合本身怕涨还是怕跌、到期时的关键价位。这里只算数字和选哪种说法，文字在翻译文件里。
import type { Leg } from "@/lib/types";
import { prepareSim, simPnlAt } from "@/lib/winRateSim";
import { expiryScan } from "@/lib/positionAdvisor";
import type { PnlParts, SegmentAttribution } from "@/lib/stockOptionMap";

export type Factor = "price" | "time" | "iv" | "adjust";
export const FACTORS: Factor[] = ["price", "time", "iv", "adjust"];

// 这笔组合（开仓时）靠什么赚钱：bull=涨或不动赚、bear=跌或不动赚、neutral=待在一个区间里赚（铁鹰、卖跨式）、
// wide=大幅波动才赚（买跨式）。看到期盈亏的形状：股价到0.6倍、1.4倍时比现价处好还是差（差别超过基准的10%才算）。
// 不用开仓那一刻的Delta：远离现价的价差（如卖260/买290看涨、现价238）Delta很小，会被误判成中性。
export type Stance = "bull" | "bear" | "neutral" | "wide";
export function priceStance(openingLegs: Leg[], spot: number, basis: number): Stance {
  const p = prepareSim({ legs: openingLegs, spot, basis: Math.max(basis, 1e-6), pnlOffset: 0, rules: { takeProfitPct: null, stopMult: null, closeFrac: 0 } });
  if (!p) return "neutral";
  const at = (x: number) => simPnlAt(p, p.horizon, x);
  const m = at(spot);
  const up = at(spot * 1.4) - m;
  const down = at(spot * 0.6) - m;
  const tol = 0.1 * basis;
  if (up < -tol && down < -tol) return "neutral";
  if (up > tol && down > tol) return "wide";
  return up >= down ? "bull" : "bear";
}

// 一句话总结：亏损（或盈利）主要来自哪一项，哪些项往反方向帮/拖了多少。
export interface Summary {
  total: number;
  main: Factor;
  mainValue: number;
  others: Factor[]; // 跟总结果方向相反的项
  othersValue: number;
}
export function summarize(totals: PnlParts & { total: number }): Summary {
  const losing = totals.total < 0;
  const vals = FACTORS.map((f) => ({ f, v: totals[f] }));
  const same = vals.filter((x) => (losing ? x.v < 0 : x.v > 0)).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const opposite = vals.filter((x) => (losing ? x.v > 0.005 : x.v < -0.005));
  const main = same[0] ?? [...vals].sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
  return {
    total: totals.total,
    main: main.f,
    mainValue: main.v,
    others: opposite.map((x) => x.f),
    othersValue: opposite.reduce((a, x) => a + x.v, 0),
  };
}

// 一段一段的历程：开仓点→各快照→今天。超过maxRows段时把相邻的合并（从最早的开始），保证表不会太长。
export interface JourneyRow {
  fromDay: number;
  toDay: number;
  fromSpot: number;
  toSpot: number;
  fromPnl: number;
  toPnl: number;
  parts: PnlParts;
  main: Factor; // 这一段影响最大的一项
  estimated: boolean;
}
export function journeyRows(
  states: { day: number; spot: number; pnl: number }[],
  segments: SegmentAttribution[],
  maxRows = 8,
): JourneyRow[] {
  const byDay = new Map(states.map((s) => [s.day, s]));
  let rows = segments.map((g) => ({ ...g }));
  while (rows.length > maxRows) {
    const [a, b] = rows;
    rows = [
      {
        fromDay: a.fromDay, toDay: b.toDay, total: a.total + b.total, estimated: a.estimated || b.estimated,
        price: a.price + b.price, time: a.time + b.time, iv: a.iv + b.iv, adjust: a.adjust + b.adjust,
      },
      ...rows.slice(2),
    ];
  }
  return rows.flatMap((g) => {
    const s0 = byDay.get(g.fromDay);
    const s1 = byDay.get(g.toDay);
    if (!s0 || !s1) return [];
    const parts = { price: g.price, time: g.time, iv: g.iv, adjust: g.adjust };
    const main = FACTORS.reduce((m, f) => (Math.abs(parts[f]) > Math.abs(parts[m]) ? f : m), "price" as Factor);
    return [{ fromDay: g.fromDay, toDay: g.toDay, fromSpot: s0.spot, toSpot: s1.spot, fromPnl: s0.pnl, toPnl: s1.pnl, parts, main, estimated: g.estimated }];
  });
}

// 到期时的关键价位（按今天的组合、开仓至今的总账）：盈亏平衡点、最多赚、最多亏（null=不封顶）。
export interface KeyLevels {
  breakevens: number[];
  profitSide: "below" | "above" | "between" | "outside" | null; // 不亏的区域在平衡点的哪一边
  maxProfit: number | null;
  maxLoss: number | null;
}
export function keyLevels(todayLegs: Leg[], nowSpot: number, pnlNow: number): KeyLevels | null {
  const legs = todayLegs.filter((l) => !l.disabled);
  if (legs.length === 0 || legs.some((l) => l.kind === "stock")) return null;
  const p = prepareSim({ legs, spot: nowSpot, basis: 1, pnlOffset: pnlNow, rules: { takeProfitPct: null, stopMult: null, closeFrac: 0 } });
  if (!p) return null;
  const scan = expiryScan(p, nowSpot);
  const bes: number[] = [];
  for (let i = 1; i < scan.vals.length; i++) {
    const a = scan.vals[i - 1], b = scan.vals[i];
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) {
      const x0 = scan.prices[i - 1], x1 = scan.prices[i];
      bes.push(b === a ? x0 : x0 + ((x1 - x0) * -a) / (b - a));
    }
  }
  // 只留离现价最近的两个，太远的（5倍、0.02倍现价附近）没有意义
  const near = bes.filter((x) => x > nowSpot * 0.2 && x < nowSpot * 3).sort((a, b) => Math.abs(a - nowSpot) - Math.abs(b - nowSpot)).slice(0, 2).sort((a, b) => a - b);
  let side: KeyLevels["profitSide"] = null;
  const at = (x: number) => simPnlAt(p, p.horizon, x);
  if (near.length === 1) side = at(near[0] * 0.98) >= 0 ? "below" : "above";
  else if (near.length === 2) side = at((near[0] + near[1]) / 2) >= 0 ? "between" : "outside";
  return { breakevens: near, profitSide: side, maxProfit: scan.maxProfit, maxLoss: scan.maxLoss };
}
