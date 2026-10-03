// src/lib/__tests__/positionAdvisor.test.ts
// 锁住持仓建议的几条关键性质：情景点腿位的盈亏跟priceCombo一致、规则线优先、几种典型局面给出合理的建议。
import { describe, it, expect } from "vitest";
import type { Leg } from "@/lib/types";
import { priceCombo } from "@/lib/pricing";
import { blackScholes } from "@/lib/bs";
import { openingBasis, isCreditCombo, type SimRules } from "@/lib/winRateSim";
import { adviseCombo, scenarioLegs, ADVICE_DRIVER } from "@/lib/positionAdvisor";

const bs = (type: "call" | "put", strike: number, dte = 30, vol = 0.3, spot = 100) =>
  Math.round(blackScholes({ spot, strike, dte, vol, rate: 0.05, type }).price * 10000) / 10000;
const leg = (over: Partial<Leg>): Leg => ({ id: Math.random().toString(36), action: "buy", type: "call", strike: 100, dte: 30, premium: 5, ...over });

// 熊市Call价差：卖100、买110，30天，30%隐含波动率
const bearCall: Leg[] = [leg({ action: "sell", strike: 100, premium: bs("call", 100) }), leg({ strike: 110, premium: bs("call", 110) })];
const CREDIT: SimRules = { takeProfitPct: 0.5, stopMult: 1, closeFrac: 0.25 };
const net = (ls: Leg[]) => ls.reduce((s, l) => s + (l.action === "buy" ? 1 : -1) * (l.qty ?? 1) * l.premium, 0);

function adviseAt(dS: number, dT: number, rules = CREDIT) {
  const now = scenarioLegs(bearCall, { dS, dT, dV: 0 }, 100)!;
  const pnl = priceCombo(bearCall, { dS, dT, dV: 0 }, 100).change;
  return adviseCombo({ legs: now, spot: 100 + dS, basis: openingBasis(bearCall)!, credit: isCreditCombo(bearCall), pnl, totalTerm: 30, rules, vol: 0.3, n: 1500, seed: 7 })!;
}

describe("positionAdvisor", () => {
  it("情景点腿位的盈亏 = priceCombo同偏移下的change", () => {
    for (const s of [{ dS: 4, dT: 10, dV: 0 }, { dS: -6, dT: 20, dV: 5 }, { dS: 0, dT: 0, dV: -3 }]) {
      const now = scenarioLegs(bearCall, s, 100)!;
      expect(net(now) - net(bearCall)).toBeCloseTo(priceCombo(bearCall, s, 100).change, 6);
    }
  });

  it("情景日期过了最早到期日返回null", () => {
    expect(scenarioLegs(bearCall, { dS: 0, dT: 30, dV: 0 }, 100)).toBeNull();
  });

  it("开仓当天、股价没动：持有", () => {
    const a = adviseAt(0, 0);
    expect(a.action).toBe("hold");
    expect(a.rule).toBe("ok");
  });

  it("赚到止盈线：止盈平仓（规则线优先）", () => {
    const a = adviseAt(-8, 15);
    expect(a.action).toBe("takeProfit");
    expect(a.rule).toBe("hitTp");
    expect(ADVICE_DRIVER[a.rule]).toBe("pnl");
  });

  it("股价冲过买入腿、亏到止损线：止损平仓", () => {
    const a = adviseAt(12, 15);
    expect(a.action).toBe("stopLoss");
    expect(a.rule).toBe("hitSl");
  });

  it("小赚但股价贴着卖出腿：持有或止盈（离盈亏平衡点不到0.5个标准差）", () => {
    const a = adviseAt(0, 6);
    expect(a.signals.pnl).toBeGreaterThan(0);
    expect(a.action).toBe("holdOrTakeProfit");
    expect(a.rule).toBe("nearEdge");
  });

  it("不设止盈止损也能给建议", () => {
    const a = adviseAt(3, 10, { takeProfitPct: null, stopMult: null, closeFrac: 0 });
    expect(a).not.toBeNull();
    expect(["hold", "holdOrStopLoss", "stopLoss", "holdOrTakeProfit"]).toContain(a.action);
  });
});
