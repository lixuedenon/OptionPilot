// src/lib/__tests__/adjustReview.test.ts
// 第5组：原组合不调整拿到今天——有报价用报价、没报价按开仓IV估、到期按内在价值；总账按买卖方向×张数。
import { describe, it, expect } from "vitest";
import type { Leg } from "@/lib/types";
import { blackScholes } from "@/lib/bs";
import { RATE } from "@/lib/pricing";
import { holdLegPrice, holdPnl, priceNearDay } from "@/lib/adjustReview";

const px = (k: number, s: number, dte: number) => blackScholes({ spot: s, strike: k, dte, vol: 0.3, rate: RATE, type: "put" }).price;
const leg = (o: Partial<Leg>): Leg => ({ id: "a", action: "sell", type: "put", strike: 95, dte: 30, premium: px(95, 100, 30), ...o }) as Leg;

describe("adjustReview", () => {
  it("uses the live quote when there is one, otherwise estimates at the entry IV", () => {
    const l = leg({});
    expect(holdLegPrice(l, 100, 97, 10, 1.23, 97)).toEqual({ price: 1.23, estimated: false });
    const e = holdLegPrice(l, 100, 97, 10, null, 97);
    expect(e.estimated).toBe(true);
    expect(e.price).toBeCloseTo(px(95, 97, 20), 3);
  });

  it("expired legs use intrinsic value at the expiry-day price", () => {
    expect(holdLegPrice(leg({}), 100, 99, 35, null, 92)).toEqual({ price: 3, estimated: false });
  });

  it("hold P&L of a short put spread = credit − today's spread value", () => {
    const a = leg({});
    const b = leg({ id: "b", action: "buy", strike: 90, premium: px(90, 100, 30) });
    const pa = { price: 2, estimated: false }, pb = { price: 0.5, estimated: true };
    const r = holdPnl([a, b], [pa, pb]);
    expect(r.pnl).toBeCloseTo((a.premium - b.premium) - (2 - 0.5), 10);
    expect(r.estimated).toBe(true);
  });

  it("priceNearDay picks the closest point", () => {
    expect(priceNearDay([{ day: 0, price: 100 }, { day: 10, price: 95 }, { day: 20, price: 97 }], 12, 0)).toBe(95);
  });
});
