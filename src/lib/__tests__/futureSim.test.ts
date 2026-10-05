// src/lib/__tests__/futureSim.test.ts
import { describe, it, expect } from "vitest";
import type { Leg } from "@/lib/types";
import { prepareSim, runBatch, computeStats, holdOutcomes, simPnlAt } from "@/lib/winRateSim";
import { newDensity, runCloud, replayRules, suggestRules, PriceStore, priceBands, pickStories, FORK_PATHS, FORK_SEED } from "@/lib/futureSim";
import { adviseCombo } from "@/lib/positionAdvisor";

const put = (o: Partial<Leg>): Leg => ({ id: "p", kind: "option", action: "sell", type: "put", strike: 90, qty: 5, dte: 43, premium: 0.35, ...o }) as unknown as Leg;
const rules = { takeProfitPct: 0.5, stopMult: 2, closeFrac: 0 };
const setup = (extra: object = {}) => ({ legs: [put({})], spot: 121.7, basis: 1.75, pnlOffset: 0, rules, totalTerm: 43, ...extra });

describe("万次推演", () => {
  it("每条走势都走到到期日；换规则不改变走势本身", () => {
    const p1 = prepareSim(setup())!;
    const p2 = prepareSim(setup({ rules: { takeProfitPct: null, stopMult: null, closeFrac: 0 } }))!;
    const a = runBatch(p1, 0.5, 200, 3, 5).samples;
    const b = runBatch(p2, 0.5, 200, 3, 5).samples;
    for (let i = 0; i < 5; i++) {
      expect(a[i].prices.length).toBe(p1.horizon + 1);
      expect(a[i].prices).toEqual(b[i].prices);
    }
  });

  it("一直拿到期的结果 = 同一条走势在到期日的盈亏", () => {
    const p = prepareSim(setup())!;
    const { outcomes, samples } = runBatch(p, 0.5, 50, 9, 50);
    outcomes.forEach((o, i) => expect(o.holdPnl).toBeCloseTo(simPnlAt(p, p.horizon, samples[i].prices[p.horizon]), 8));
    const hold = computeStats(holdOutcomes(outcomes, p.horizon));
    expect(hold.byReason.expiry.pct).toBe(100);
  });

  it("密度云：每天都记一次，合计 = 走势条数×(天数+1)（价格都在范围内时）", () => {
    const p = prepareSim(setup())!;
    const spec = { sMin: 1, sMax: 1000, rows: 40, days: p.horizon };
    const d = newDensity(spec);
    runCloud(p, 0.5, 300, 5, spec, d);
    const total = d.holding.reduce((a, b) => a + b, 0) + d.after.reduce((a, b) => a + b, 0);
    expect(total).toBe(300 * (p.horizon + 1));
  });

  it("波动率滑块：隐含波动率下降，卖方同样的走势赚得更多", () => {
    const base = computeStats(runBatch(prepareSim(setup({ rules: { takeProfitPct: null, stopMult: null, closeFrac: 0.5 } }))!, 0.5, 2000, 11).outcomes);
    const crush = computeStats(runBatch(prepareSim(setup({ rules: { takeProfitPct: null, stopMult: null, closeFrac: 0.5 }, dV: -15 }))!, 0.5, 2000, 11).outcomes);
    expect(crush.avg).toBeGreaterThan(base.avg);
  });

  it("从情景点分出的云跟持仓建议卡片是同一组走势", () => {
    const legs = [put({ dte: 30, premium: 0.9 })];
    const s = { legs, spot: 105, basis: 1.75, pnlOffset: -2.75, rules, totalTerm: 43 };
    const p = prepareSim(s)!;
    const spec = { sMin: 1, sMax: 1000, rows: 40, days: 43 };
    const fork = computeStats(runCloud(p, 0.5, FORK_PATHS, FORK_SEED, spec, newDensity(spec), { dayOffset: 13 }).outcomes);
    const advice = adviseCombo({ legs, spot: 105, basis: 1.75, credit: true, pnl: -2.75, totalTerm: 43, rules, vol: 0.5, drift: 0, n: FORK_PATHS, seed: FORK_SEED })!;
    expect(fork.byReason.tp.pct / 100).toBeCloseTo(advice.signals.pTp, 10);
    expect(fork.byReason.sl.pct / 100).toBeCloseTo(advice.signals.pSl, 10);
    expect(fork.winPct / 100).toBeCloseTo(advice.signals.pWin, 10);
  });
});

describe("地形图风险分区（不用模拟的快速版建议）", async () => {
  const { prepareQuickAdvice, quickAdvice, scenarioLegs } = await import("@/lib/positionAdvisor");
  const { priceCombo } = await import("@/lib/pricing");
  const cases: { legs: Leg[]; spot: number; credit: boolean; basis: number }[] = [
    { legs: [put({})], spot: 121.7, credit: true, basis: 1.75 },
    {
      legs: [
        { id: "a", kind: "option", action: "sell", type: "call", strike: 237.5, qty: 1, dte: 28, premium: 13.63 },
        { id: "b", kind: "option", action: "buy", type: "call", strike: 262.5, qty: 1, dte: 28, premium: 4.97 },
      ] as Leg[],
      spot: 237.65, credit: true, basis: 8.66,
    },
    { legs: [{ id: "c", kind: "option", action: "buy", type: "call", strike: 100, qty: 1, dte: 60, premium: 6 } as Leg], spot: 100, credit: false, basis: 6 },
  ];
  it("跟完整的持仓建议一致（完整版用到模拟的那几条除外）", () => {
    let compared = 0;
    for (const c of cases) {
      const term = Math.round(Math.min(...c.legs.map((l) => l.dte)));
      const ctx = prepareQuickAdvice({ legs: c.legs, spot: c.spot, basis: c.basis, credit: c.credit, rules, totalTerm: term })!;
      for (const day of [0, 5, 12, 20, term - 6]) {
        for (const f of [0.8, 0.9, 0.97, 1, 1.03, 1.1, 1.2]) {
          const price = c.spot * f;
          const s = { dS: price - c.spot, dT: day, dV: 0 };
          const legsNow = scenarioLegs(c.legs, s, c.spot);
          if (!legsNow) continue;
          const pnl = priceCombo(c.legs, s, c.spot).change;
          const full = adviseCombo({ legs: legsNow, spot: price, basis: c.basis, credit: c.credit, pnl, totalTerm: term, rules, vol: 0.4, n: 200, seed: 1 })!;
          if (["pStop", "recover", "recoverWatch"].includes(full.rule)) continue;
          expect(quickAdvice(ctx, day, price, pnl)).toBe(full.action);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(60);
  });

  it("规则复盘：沿真实的路按天找第一次该下车的点", () => {
    // 基准1.75：止盈线+0.875、止损线−3.5
    const p = prepareSim(setup())!;
    const pts = [
      { day: 0, price: 121.7, pnl: 0 },
      { day: 12, price: 110, pnl: -4 },
      { day: 5, price: 125, pnl: 0.9 },
    ];
    expect(replayRules(pts, p)).toEqual({ day: 5, price: 125, pnl: 0.9, kind: "tp" });
    expect(replayRules(pts.filter((x) => x.day !== 5), p)?.kind).toBe("sl");
    expect(replayRules([{ day: 3, price: 120, pnl: 0.2 }], p)).toBeNull();
    // 剩1/4时间平仓：43天 → 第32天起该平仓
    const pt = prepareSim(setup({ rules: { takeProfitPct: null, stopMult: null, closeFrac: 0.25 } }))!;
    expect(replayRules([{ day: 20, price: 120, pnl: 0.5 }, { day: 35, price: 121, pnl: 1 }], pt)).toEqual({ day: 35, price: 121, pnl: 1, kind: "time" });
  });

  it("换个规则：同一组走势比较，现在的规则就在候选里时不重复试；结果可复现", () => {
    const cur = { takeProfitPct: 0.5, stopMult: 2, closeFrac: 0.25 };
    const a = suggestRules(setup({ rules: cur }), 0.5, 800, 77, "credit")!;
    const b = suggestRules(setup({ rules: cur }), 0.5, 800, 77, "credit")!;
    expect(a.tried).toBe(5);
    expect(a).toEqual(b);
    // 现在的成绩 = 同一个种子直接跑一遍的成绩
    const p = prepareSim(setup({ rules: cur }))!;
    expect(a.current.avg).toBeCloseTo(computeStats(runBatch(p, 0.5, 800, 77).outcomes).avg, 10);
    // 建议的规则（如果有）真的满足"更好"的条件之一
    if (a.best) expect(a.best.avg > a.current.avg || a.best.worst5 >= a.current.worst5 * 0.8).toBe(true);
  });

  it("平面图：范围带用全部走势、典型结局按规则分类且占比加起来100%", () => {
    const p = prepareSim(setup())!;
    const spec = { sMin: 1, sMax: 1000, rows: 40, days: p.horizon };
    const store = new PriceStore(400, p.horizon);
    const run = runCloud(p, 0.5, 400, 21, spec, newDensity(spec), { extraStep: store.step });
    expect(store.filled).toBe(400);
    const bands = priceBands(store);
    expect(bands[0].p50).toBeCloseTo(121.7, 3);
    expect(bands[bands.length - 1].day).toBe(p.horizon);
    for (const b of bands) expect(b.p5 <= b.p25 && b.p25 <= b.p50 && b.p50 <= b.p75 && b.p75 <= b.p95).toBe(true);
    const stories = pickStories(run.outcomes, store, 5);
    expect(stories.reduce((a, x) => a + x.share, 0)).toBeCloseTo(100, 6);
    for (const st of stories) {
      expect(st.prices.length).toBe(p.horizon + 1);
      expect(st.prices[0]).toBeCloseTo(121.7, 4);
    }
  });
});
