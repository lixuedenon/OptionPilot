// src/lib/__tests__/retroHistory.test.ts
// ⑦⑧：行情排名、开仓前2年的评价只用开仓前的数据、调整时的历史比例、规则沿真实路径的下车点。
import { describe, it, expect } from "vitest";
import type { Leg } from "@/lib/types";
import { blackScholes } from "@/lib/bs";
import { RATE } from "@/lib/pricing";
import { regime, biggestDay, openBarSec, spansEarnings, entryQuality, adjustOdds, rulesOnce, dailyPathSince, sliceSeries } from "@/lib/retroHistory";

// 3年的交易日，每天随机±1%（固定种子），最后一天对应openSec之后30天
function makeSeries(endSec: number, n = 760) {
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const closes: number[] = [], timestamps: number[] = [];
  let t = endSec, c = 100;
  const ts: number[] = [];
  while (ts.length < n) { const wd = new Date(t * 1000).getUTCDay(); if (wd !== 0 && wd !== 6) ts.unshift(t); t -= 86400; }
  for (let i = 0; i < n; i++) { c *= 1 + (rnd() - 0.5) * 0.02; closes.push(c); timestamps.push(ts[i]); }
  return { closes, timestamps };
}
const px = (k: number, s = 100, dte = 30) => blackScholes({ spot: s, strike: k, dte, vol: 0.3, rate: RATE, type: "put" }).price;
const legs: Leg[] = [
  { id: "a", action: "sell", type: "put", strike: 95, dte: 30, premium: px(95) } as Leg,
  { id: "b", action: "buy", type: "put", strike: 90, dte: 30, premium: px(90) } as Leg,
];

describe("retroHistory", () => {
  const openSec = Date.UTC(2026, 8, 1, 20) / 1000;
  const s = makeSeries(openSec + 30 * 86400);

  it("regime: a huge drop is rarer than a small one", () => {
    const big = regime(s, 20, -0.2, openSec + 20 * 86400)!;
    const small = regime(s, 20, -0.01, openSec + 20 * 86400)!;
    expect(big.pctMoreExtreme).toBeLessThan(small.pctMoreExtreme);
    expect(big.bins.reduce((a, b) => a + b.count, 0)).toBe(big.n);
  });

  it("entryQuality only uses data before the entry", () => {
    const setup = { legs, spot: 100, basis: px(95) - px(90), pnlOffset: 0, rules: { takeProfitPct: 0.5, stopMult: 2, closeFrac: 0 }, totalTerm: 30 };
    const a = entryQuality(s, setup, openSec, true)!;
    // 开仓之后的数据随便改，结果不变
    const s2 = { closes: s.closes.map((c, i) => (s.timestamps[i] >= openSec ? c * 0.5 : c)), timestamps: s.timestamps };
    const b = entryQuality(s2, setup, openSec, true)!;
    expect(b.winPct).toBe(a.winPct);
    expect(a.shortDist!).toBeCloseTo(0.05, 6);
    expect(sliceSeries(s, openSec - 10 * 86400, openSec).timestamps.every((t) => t < openSec)).toBe(true);
  });

  it("adjustOdds: further from the strike → less likely to cross", () => {
    const near = adjustOdds(s, openSec, 100, legs[0], 15)!; // 离95有5%
    const far = adjustOdds(s, openSec, 110, legs[0], 15)!; // 离95有13.6%
    expect(far.pBeyond).toBeLessThan(near.pBeyond);
  });

  it("rulesOnce: take-profit triggers on the first day the line is reached", () => {
    const setup = { legs, spot: 100, basis: px(95) - px(90), pnlOffset: 0, rules: { takeProfitPct: 0.5, stopMult: null, closeFrac: 0 }, totalTerm: 30 };
    const path = [{ day: 2, price: 101 }, { day: 5, price: 108 }, { day: 9, price: 112 }];
    const [r] = rulesOnce(setup, [setup.rules], path);
    expect(r.kind).toBe("tp");
    expect(r.day).toBe(5);
    expect(r.cost).toBeGreaterThan(0);
    const [h] = rulesOnce(setup, [setup.rules], [{ day: 2, price: 100 }]);
    expect(h.kind).toBe("holding");
    expect(dailyPathSince(s, openSec, 30).every((x) => x.day >= 1 && x.day <= 30)).toBe(true);
  });
  it("财报这一组：跨财报的段和没跨的段分开比；开仓以来最大的一天认得出是不是财报", () => {
    // 每63个交易日一次财报，那天跳 −8%/+8% 交替
    const e = { closes: [...s.closes], timestamps: [...s.timestamps] };
    const earnT: number[] = [];
    for (let i = 40, k = 0; i < e.closes.length; i += 63, k++) {
      const f = k % 2 ? 1.08 : 0.92;
      for (let j = i; j < e.closes.length; j++) e.closes[j] *= f;
      earnT.push(e.timestamps[i]);
    }
    const r = regime(e, 20, -0.07, openSec + 20 * 86400, earnT)!;
    expect(r.split).not.toBeNull();
    expect(r.split!.earn.n + r.split!.plain.n).toBe(r.n);
    // 跌7%：跨财报的段里常见得多
    expect(r.split!.earn.pct).toBeGreaterThan(r.split!.plain.pct + 10);
    expect(r.bins.reduce((a, b) => a + b.earn, 0)).toBe(r.split!.earn.n);
    // 没有财报日期时不分
    expect(regime(e, 20, -0.07, openSec + 20 * 86400)!.split).toBeNull();
    expect(spansEarnings(earnT[0] - 86400, 5, earnT)).toBe(true);
    expect(spansEarnings(earnT[0], 5, earnT)).toBe(false); // 起点当天收盘已经反应过了
    const tE = earnT[earnT.length - 1];
    const iE = e.timestamps.indexOf(tE);
    const b = biggestDay(e, e.timestamps[iE - 2], 10, earnT)!;
    expect(b.earn).toBe(true);
    expect(b.t).toBe(tE);
    // 开仓那天就是财报反应日：那天的跳空发生在开仓之前，不算
    const c = biggestDay(e, tE, 10, earnT);
    expect(c == null || c.t !== tE).toBe(true);
    expect(openBarSec(e, new Date(tE * 1000).toISOString().slice(0, 10))).toBe(tE);
  });
});
