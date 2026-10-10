// src/lib/__tests__/backfillAnchor.test.ts
import { describe, it, expect } from "vitest";
import { backfillOpeningAnchor } from "@/lib/savedStrategies";
import { repriceLegsAtDate } from "@/lib/historicalBackfill";
import { impliedVol } from "@/lib/pricing";
import type { Leg } from "@/lib/types";

describe("回填起点", () => {
  it("策略是开仓29天后才存的：起点仍是开仓那天，估算快照沿用开仓时的隐含波动率", () => {
    const day = 86400000;
    const openingAt = new Date(2026, 8, 3, 12).getTime();
    const legsAsOf = openingAt + 29 * day;
    // legs的dte按legsAsOf存（还剩14天），权利金/股价是开仓那天的
    const legs: Leg[] = [{ id: "a", action: "sell", type: "put", strike: 90, dte: 14, premium: 0.35, qty: 5 } as Leg];
    const a = backfillOpeningAnchor({ legs, spot: 121.7, openingAt, legsAsOf, createdAt: legsAsOf });
    expect(a.legs[0].dte).toBe(43);
    const openIv = impliedVol(121.7, 90, 43, 0.35, "put");
    expect(openIv).toBeGreaterThan(0.45);
    expect(openIv).toBeLessThan(0.6);
    // 第30天、股价96的估算快照：反推回去还是开仓时的隐含波动率
    const est = repriceLegsAtDate(a.legs, a.spot, 96, 30)[0];
    expect(est.dte).toBe(13);
    expect(Math.abs(impliedVol(96, 90, est.dte, est.premium, "put") - openIv)).toBeLessThan(0.02);
  });
});
