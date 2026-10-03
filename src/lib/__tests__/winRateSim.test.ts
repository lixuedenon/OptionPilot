// src/lib/__tests__/winRateSim.test.ts
// 锁住胜率模拟的几条关键性质：盈亏口径跟priceCombo一致、盈亏正负号（卖方组合价值下降=赚钱）、
// 规则确实生效、同一seed可复现、盈亏平衡波动率落在隐含波动率附近。
import { describe, it, expect } from "vitest";
import type { Leg } from "@/lib/types";
import { priceCombo } from "@/lib/pricing";
import {
  prepareSim, simPnlAt, runBatch, computeStats, batchStability, breakevenCurve, findBreakeven,
  cushion, openingBasis, isCreditCombo, startStatus, volGrid, retroDistribution, percentileOf, moveInSigma,
  deltaPerContract, driftGrid, driftCurve, findDriftBreakeven, driftCushion, probPriceBeyond, mulberry32, type SimRules,
} from "@/lib/winRateSim";
import { blackScholes } from "@/lib/bs";

const bs = (type: "call" | "put", strike: number, dte = 30, vol = 0.3, spot = 100) =>
  Math.round(blackScholes({ spot, strike, dte, vol, rate: 0.05, type }).price * 10000) / 10000;
const leg = (over: Partial<Leg>): Leg => ({ id: Math.random().toString(36), action: "buy", type: "call", strike: 100, dte: 30, premium: 5, ...over });

// 铁鹰90/95/105/110，30天，按30%隐含波动率定价
const condor: Leg[] = [
  leg({ type: "put", strike: 90, premium: bs("put", 90) }),
  leg({ action: "sell", type: "put", strike: 95, premium: bs("put", 95) }),
  leg({ action: "sell", strike: 105, premium: bs("call", 105) }),
  leg({ strike: 110, premium: bs("call", 110) }),
];
const RULES: SimRules = { takeProfitPct: 0.5, stopMult: 1, closeFrac: 0.25 };
const setup = (rules: SimRules = RULES, extra: Partial<{ pnlOffset: number }> = {}) => ({
  legs: condor, spot: 100, basis: openingBasis(condor)!, pnlOffset: extra.pnlOffset ?? 0, rules,
});

describe("winRateSim", () => {
  it("P&L matches priceCombo at the same shifts", () => {
    const p = prepareSim(setup())!;
    for (const [day, price] of [[0, 100], [5, 96.5], [15, 108], [30, 91]] as const) {
      expect(simPnlAt(p, day, price)).toBeCloseTo(priceCombo(condor, { dS: price - 100, dT: day, dV: 0 }, 100).change, 8);
    }
  });

  it("short condor profits when the price stays put (sign check)", () => {
    const p = prepareSim(setup())!;
    expect(isCreditCombo(condor)).toBe(true);
    expect(simPnlAt(p, 20, 100)).toBeGreaterThan(0);
    expect(simPnlAt(p, 30, 120)).toBeLessThan(0);
  });

  it("rules are applied: exits respect the thresholds and the close day", () => {
    const p = prepareSim(setup())!;
    expect(p.endDay).toBe(22); // 30天×1/4≈8天时平仓
    const { outcomes } = runBatch(p, 0.3, 2000, 7);
    for (const o of outcomes) {
      if (o.reason === "tp") expect(o.pnl).toBeGreaterThanOrEqual(0.5 * p.basis - 1e-9);
      if (o.reason === "sl") expect(o.pnl).toBeLessThanOrEqual(-p.basis + 1e-9);
      if (o.reason === "time") expect(o.day).toBe(22);
      expect(o.reason).not.toBe("expiry");
    }
    const s = computeStats(outcomes);
    expect(s.byReason.tp.pct + s.byReason.sl.pct + s.byReason.time.pct + s.byReason.expiry.pct).toBeCloseTo(100, 6);
    expect(s.byReason.tp.pct).toBeGreaterThan(20);
    expect(s.byReason.sl.pct).toBeGreaterThan(5);
  });

  it("a 2x stop on this condor is never reached (max loss is ~1.6x the credit)", () => {
    const p = prepareSim(setup({ takeProfitPct: null, stopMult: 2, closeFrac: 0 }))!;
    const s = computeStats(runBatch(p, 0.3, 2000, 3).outcomes);
    expect(s.byReason.sl.pct).toBe(0);
    expect(s.byReason.expiry.pct).toBe(100);
  });

  it("same seed reproduces, batches of 1000 are stable", () => {
    const p = prepareSim(setup())!;
    const a = computeStats(runBatch(p, 0.24, 500, 42).outcomes);
    const b = computeStats(runBatch(p, 0.24, 500, 42).outcomes);
    expect(a.avg).toBe(b.avg);
    const runs = Array.from({ length: 10 }, (_, i) => runBatch(p, 0.24, 1000, 100 + i).outcomes);
    const all = computeStats(runs.flat());
    expect(batchStability(computeStats(runs[0]), all, p.basis).similar).toBe(true);
  });

  it("breakeven vol sits near the implied vol, and lower realized vol leaves a cushion", () => {
    const p = prepareSim(setup())!;
    const curve = breakevenCurve(p, volGrid(0.3, 0.24), 2000, 9);
    const be = findBreakeven(p, curve, 2000, 9);
    expect(be.side).toBe("short");
    expect(be.vol!).toBeGreaterThan(0.26);
    expect(be.vol!).toBeLessThan(0.34);
    const c = cushion(be, 0.24)!;
    expect(c.value).toBeGreaterThan(0.1);
    expect(cushion(be, 0.4)!.tier).toBe("none");
  });

  it("long options are the 'long' side", () => {
    const longCall = [leg({ strike: 100, dte: 60, premium: bs("call", 100, 60) })];
    const p = prepareSim({ legs: longCall, spot: 100, basis: openingBasis(longCall)!, pnlOffset: 0, rules: { takeProfitPct: null, stopMult: null, closeFrac: 0 } })!;
    const be = findBreakeven(p, breakevenCurve(p, volGrid(0.3, 0.3), 1500, 5), 1500, 5);
    expect(be.side).toBe("long");
  });

  it("compare-mode start status and offset", () => {
    expect(startStatus(prepareSim(setup(RULES, { pnlOffset: 2 }))!)).toBe("atTakeProfit");
    expect(startStatus(prepareSim({ ...setup(), legs: condor.map((l) => ({ ...l, dte: 5 })), totalTerm: 30 })!)).toBe("inCloseWindow");
    const p = prepareSim(setup(RULES, { pnlOffset: 0.3 }))!;
    expect(simPnlAt(p, 0, 100)).toBeCloseTo(0.3, 8);
  });

  it("stock legs have no basis", () => {
    expect(openingBasis([leg({ kind: "stock", strike: 100, dte: 0, premium: 0 }), leg({ action: "sell", strike: 105, premium: 2 })])).toBeNull();
  });

  it("look-back: distribution at today, percentile and sigma move", () => {
    const sorted = retroDistribution({ legs: condor, spot: 100, day: 10, vol: 0.3 }, 3000, 11);
    expect(sorted.length).toBe(3000);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]).toBeGreaterThanOrEqual(sorted[i - 1]);
    // 10天后价格不动时，卖方铁鹰的盈亏（时间价值）应该在中位数附近或更好
    const flat = simPnlAt(prepareSim(setup())!, 10, 100);
    expect(percentileOf(sorted, flat)).toBeGreaterThan(40);
    expect(percentileOf(sorted, -100)).toBe(0);
    expect(percentileOf(sorted, 100)).toBe(100);
    expect(moveInSigma(100, 100 * Math.exp(0.3 * Math.sqrt(10 / 365)), 0.3, 10)).toBeCloseTo(1, 6);
  });

  it("close rule scales with the opening term", () => {
    const year = condor.map((l) => ({ ...l, dte: 360 }));
    const p = prepareSim({ legs: year, spot: 100, basis: 1, pnlOffset: 0, rules: RULES })!;
    expect(p.closeAtRemaining).toBe(90);
    expect(p.endDay).toBe(270);
  });

  it("buyer: long call needs an up-drift to break even, more drift = more profit", () => {
    const longCall = [leg({ strike: 90, dte: 120, premium: bs("call", 90, 120) })];
    const p = prepareSim({ legs: longCall, spot: 100, basis: openingBasis(longCall)!, pnlOffset: 0, rules: { takeProfitPct: null, stopMult: null, closeFrac: 0 } })!;
    expect(deltaPerContract(p)).toBeGreaterThan(0.6);
    const curve = driftCurve(p, 0.3, driftGrid(), 1500, 4);
    expect(curve[curve.length - 1].avg).toBeGreaterThan(curve[0].avg);
    const req = findDriftBreakeven(p, 0.3, curve, 1500, 4)!;
    expect(req).toBeGreaterThan(0); // 零漂移时买call平均小亏（付了利息），需要一点涨幅才不亏
    expect(req).toBeLessThan(0.15);
    expect(driftCushion(req, 0.2).tier).toBe("ample");
    expect(driftCushion(req, 0).tier).toBe("none");
  });

  it("情景点概率跟同一模型的逐日随机走势一致", () => {
    const rand = mulberry32(99);
    const vol = 0.4, days = 20, n = 20000;
    let up = 0, down = 0;
    for (let i = 0; i < n; i++) {
      let lnS = Math.log(100);
      for (let d = 0; d < days; d++) {
        const z = Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
        lnS += -0.5 * vol * vol / 365 + vol * Math.sqrt(1 / 365) * z;
      }
      const S = Math.exp(lnS);
      if (S >= 108) up++;
      if (S <= 93) down++;
    }
    expect(probPriceBeyond(100, 108, vol, 0, days)).toBeCloseTo(up / n, 1);
    expect(probPriceBeyond(100, 93, vol, 0, days)).toBeCloseTo(down / n, 1);
    expect(probPriceBeyond(100, 108, vol, 0.5, days)).toBeGreaterThan(probPriceBeyond(100, 108, vol, 0, days));
  });
});
