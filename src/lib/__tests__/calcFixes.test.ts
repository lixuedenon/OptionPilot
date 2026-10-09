// src/lib/__tests__/calcFixes.test.ts
// 全面检查第二批（计算）：财报跳空和平常波动的下限一致、深度实值的假盈亏、远月平仓损耗、最大亏损扫到0、期限太短第0天就平。
import { describe, it, expect } from "vitest";
import type { Leg } from "@/lib/types";
import { blackScholes } from "@/lib/bs";
import { RATE, priceCombo } from "@/lib/pricing";
import { exEarningsVol } from "@/lib/earnings";
import { optionDelta } from "@/lib/legDelta";
import { prepareSim, runBatch, computeStats, openingBasis, capJump, type SimRules } from "@/lib/winRateSim";
import { expiryScan } from "@/lib/positionAdvisor";

const bs = (type: "call" | "put", strike: number, dte: number, vol: number, spot = 100) => blackScholes({ spot, strike, dte, vol, rate: RATE, type }).price;
const leg = (o: Partial<Leg>): Leg => ({ id: Math.random().toString(36), kind: "option", action: "sell", type: "put", strike: 100, dte: 30, premium: 1, qty: 1, ...o });
const HOLD: SimRules = { takeProfitPct: null, stopMult: null, closeFrac: 0 };

describe("财报：跳空 + 平常波动 = 期权价格里的波动", () => {
  it("周度财报、期限结构说平常波动只有三成：公道定价的卖出跨式平均≈0，不会被系统性看坏", () => {
    const iv = 0.5, dte = 7;
    const legs = [leg({ type: "call", premium: bs("call", 100, dte, iv), dte }), leg({ type: "put", premium: bs("put", 100, dte, iv), dte })];
    // 跟impliedFromChains同样的解法：平常波动=0.3σ，跳空=剩下的
    const T = dte / 365;
    const jump = Math.sqrt(iv * iv * T - (0.3 * iv) ** 2 * T);
    const p = prepareSim({ legs, spot: 100, basis: openingBasis(legs)!, pnlOffset: 0, rules: HOLD, earnings: { day: 3, jump } })!;
    const vol = exEarningsVol(iv, p.earnJump, dte);
    const st = computeStats(runBatch(p, vol, 40000, 7).outcomes);
    const credit = legs[0].premium + legs[1].premium;
    expect(Math.abs(st.avg)).toBeLessThan(0.03 * credit);
  });

  it("过去几次估出来的跳空太大时，按隐含波动率装得下的封顶", () => {
    expect(capJump(0.2, 0.5, 7)).toBeCloseTo(Math.sqrt(0.91) * 0.5 * Math.sqrt(7 / 365), 9);
    expect(capJump(0.02, 0.5, 7)).toBe(0.02);
  });
});

describe("深度实值：权利金低于模型最低价", () => {
  const deep = leg({ action: "buy", type: "call", strike: 50, dte: 365, premium: 50.5 });

  it("不动的时候盈亏是0，到期按内在价值", () => {
    expect(Math.abs(priceCombo([deep], { dS: 0, dT: 0, dV: 0 }, 100).change)).toBeLessThan(1e-6);
    const atExpiry = priceCombo([deep], { dS: 20, dT: 365, dV: 0 }, 100).change;
    expect(atExpiry).toBeCloseTo(70 - 50.5, 6);
  });

  it("Delta按1算，不会让整个组合的Delta消失", () => {
    expect(optionDelta(deep, 100)).toBe(1);
  });
});

describe("日历价差拿到近月到期", () => {
  it("远月那条还要平掉：扣它的成交损耗，单一到期日的组合不受影响", () => {
    const cal = [leg({ type: "call", dte: 30, premium: bs("call", 100, 30, 0.3) }), leg({ action: "buy", type: "call", dte: 60, premium: bs("call", 100, 60, 0.3) })];
    const pc = prepareSim({ legs: cal, spot: 100, basis: openingBasis(cal)!, pnlOffset: 0, rules: HOLD })!;
    const oc = runBatch(pc, 0.3, 200, 3).outcomes;
    expect(oc.every((o) => o.reason === "expiry" && (o.cost ?? 0) > 0)).toBe(true);
    const single = [leg({ type: "put", premium: bs("put", 100, 30, 0.3) })];
    const ps = prepareSim({ legs: single, spot: 100, basis: openingBasis(single)!, pnlOffset: 0, rules: HOLD })!;
    expect(runBatch(ps, 0.3, 200, 3).outcomes.every((o) => o.cost === 0)).toBe(true);
  });
});

describe("最大亏损", () => {
  it("卖Put扫到股价接近0：最大亏损≈行权价−权利金", () => {
    const sp = [leg({ type: "put", strike: 100, premium: 3 })];
    const p = prepareSim({ legs: sp, spot: 100, basis: 3, pnlOffset: 0, rules: HOLD })!;
    expect(expiryScan(p, 100).maxLoss!).toBeLessThan(-96.9);
  });
});

describe("期限太短", () => {
  it("剩1天、条件是剩1/4时间平仓：第0天就平（界面据此说明，不下\"不值得开\"的结论）", () => {
    const short = [leg({ type: "put", dte: 1, premium: bs("put", 100, 1, 0.3) })];
    const p = prepareSim({ legs: short, spot: 100, basis: openingBasis(short)!, pnlOffset: 0, rules: { ...HOLD, closeFrac: 0.25 } })!;
    expect(p.endDay).toBe(0);
  });
});
