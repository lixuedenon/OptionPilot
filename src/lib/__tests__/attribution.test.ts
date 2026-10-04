// src/lib/__tests__/attribution.test.ts
import { describe, it, expect } from "vitest";
import { attributePnl, priceCombo } from "@/lib/pricing";
import { attributeSegment } from "@/lib/stockOptionMap";
import type { Leg } from "@/lib/types";

const put = (o: Partial<Leg>): Leg => ({ id: "p", kind: "option", action: "sell", type: "put", strike: 90, qty: 5, dte: 43, premium: 0.35, ...o }) as unknown as Leg;

describe("盈亏归因（平均法）", () => {
  it("分析模式：三项之和等于总变化，没有交叉项", () => {
    const legs = [put({})];
    const shifts = { dS: -27, dT: 29, dV: 10 };
    const total = priceCombo(legs, shifts, 121.7).change;
    const a = attributePnl(legs, 121.7, shifts.dS, shifts.dT, shifts.dV, total);
    expect(a.priceEffect + a.timeEffect + a.ivEffect).toBeCloseTo(total, 6);
    expect(Math.abs(a.residual)).toBeLessThan(1e-6);
  });

  it("今昔对比：LULU卖90Put，用实时股价拆出IV下降的贡献", () => {
    const open = put({});
    const today = put({ id: "t", openLegId: "p", dte: 14, premium: 1.17 });
    const total = -5 * (1.17 - 0.35);
    const p = attributeSegment({ legs: [open], spot: 121.7, day: 0, pnl: 0 }, { legs: [today], spot: 94.46, day: 29, pnl: total });
    expect(p.price + p.time + p.iv + p.adjust).toBeCloseTo(total, 6);
    expect(Math.abs(p.adjust)).toBeLessThan(0.01);
    expect(p.price).toBeCloseTo(-12.83, 1);
    expect(p.time).toBeCloseTo(5.77, 1);
    expect(p.iv).toBeCloseTo(2.95, 1);
  });

  it("直接改了行权价的腿不算同一张合约，变化全部算调整", () => {
    const open = put({});
    const changed = put({ id: "t", openLegId: "p", strike: 85, dte: 14, premium: 0.6 });
    const total = -5 * (0.6 - 0.35);
    const p = attributeSegment({ legs: [open], spot: 121.7, day: 0, pnl: 0 }, { legs: [changed], spot: 94.46, day: 29, pnl: total });
    expect(p.price).toBe(0);
    expect(p.iv).toBe(0);
    expect(p.adjust).toBeCloseTo(total, 6);
  });
});

describe("保存快照前的权利金检查", async () => {
  const { premiumSanityIssues } = await import("@/lib/pricing");
  it("正常报价不报错，打错一位数会被拦下", () => {
    expect(premiumSanityIssues([put({ dte: 14, premium: 1.17 })], 94.46)).toHaveLength(0);
    const ref = { legs: [put({})], spot: 121.7 };
    expect(premiumSanityIssues([put({ id: "t", openLegId: "p", dte: 14, premium: 1.17 })], 94.46, ref)).toHaveLength(0);
    expect(premiumSanityIssues([put({ id: "t", openLegId: "p", dte: 14, premium: 11.7 })], 94.46, ref)[0]?.kind).toBe("ivJump");
    expect(premiumSanityIssues([put({ dte: 14, premium: 40 })], 94.46)[0]?.kind).toBe("ivTooHigh");
    expect(premiumSanityIssues([put({ dte: 14, premium: 0.5, strike: 110 })], 94.46)[0]?.kind).toBe("belowIntrinsic");
  });
});
