// src/lib/__tests__/trackedPairing.test.ts
// 今日组合每条腿的成本基准必须一对一配到对的开仓腿：加了保护/对冲腿、调过顺序、id对不上（老数据）都不能拿别的腿的开仓价当成本。
import { describe, it, expect } from "vitest";
import type { Leg } from "@/lib/types";
import { pairOpeningLegs } from "@/lib/pricing";
import { trackedTotalPnl } from "@/lib/stockOptionMap";
import { fillEntryPremiums, type TrackedSnapshot } from "@/lib/savedStrategies";

const L = (id: string, action: "buy" | "sell", strike: number, premium: number, extra: Partial<Leg> = {}): Leg => ({
  id, kind: "option", action, type: "put", strike, dte: 30, premium, qty: 1, ...extra,
});

describe("pairOpeningLegs", () => {
  const opening = [L("A", "sell", 230, 4.2), L("B", "buy", 220, 1.9)];

  it("加了保护腿（插在中间）后，原来的两条腿仍配自己的开仓价，保护腿用它自己的开仓价", () => {
    const tracked = [
      L("a1", "sell", 230, 6.0, { openLegId: "A" }),
      L("p1", "buy", 220, 2.6, { derivedFrom: { legId: "a1", via: "protect" }, entryPremium: 2.0 }),
      L("b1", "buy", 220, 2.5, { openLegId: "B" }),
    ];
    const b = pairOpeningLegs(tracked, opening);
    expect(b[0]?.premium).toBe(4.2);
    expect(b[1]).toMatchObject({ premium: 2.0, own: true });
    expect(b[2]?.premium).toBe(1.9);
    // 总账：卖230 (4.2→6.0) −1.8；保护 (2.0→2.6) +0.6；买220 (1.9→2.5) +0.6
    expect(trackedTotalPnl(opening, tracked, 225, 236)).toBeCloseTo(-0.6, 9);
  });

  it("调过顺序、id也对不上（老数据）时按同一张合约配", () => {
    const tracked = [L("x", "buy", 220, 2.5), L("y", "sell", 230, 6.0)];
    const b = pairOpeningLegs(tracked, opening);
    expect(b[0]?.premium).toBe(1.9);
    expect(b[1]?.premium).toBe(4.2);
  });

  it("保护腿恰好跟一条开仓腿是同一张合约，也不抢它的成本", () => {
    const tracked = [
      L("p1", "buy", 220, 2.6, { derivedFrom: { via: "protect" }, entryPremium: 2.2 }),
      L("a1", "sell", 230, 6.0, { openLegId: "A" }),
      L("b1", "buy", 220, 2.5, { openLegId: "B" }),
    ];
    const b = pairOpeningLegs(tracked, opening);
    expect(b[0]).toMatchObject({ premium: 2.2, own: true });
    expect(b[2]?.premium).toBe(1.9);
  });

  it("展期：原腿已平（不在活动腿里），新腿用自己的开仓价，不拿原腿的", () => {
    const tracked = [L("r1", "sell", 220, 3.0, { dte: 60, derivedFrom: { legId: "a1", via: "roll" }, entryPremium: 3.4 }), L("b1", "buy", 220, 2.5, { openLegId: "B" })];
    const b = pairOpeningLegs(tracked, [opening[1]]);
    expect(b[0]).toMatchObject({ premium: 3.4, own: true });
    expect(b[1]?.premium).toBe(1.9);
  });
});

describe("fillEntryPremiums", () => {
  it("老数据：从最早出现这条新腿的真实快照里补开仓价，估算快照不算", () => {
    const roll = (premium: number): Leg => L("r", "sell", 220, premium, { derivedFrom: { via: "roll" } });
    const snaps: TrackedSnapshot[] = [
      { id: "s2", legs: [roll(2.8)], spot: 1, savedAt: 200 },
      { id: "e1", legs: [roll(9.9)], spot: 1, savedAt: 150, estimated: true },
      { id: "s1", legs: [roll(3.4)], spot: 1, savedAt: 100 },
    ];
    expect(fillEntryPremiums([roll(2.5)], snaps)[0].entryPremium).toBe(3.4);
  });
});
