// src/lib/__tests__/retroStory.test.ts
import { describe, it, expect } from "vitest";
import type { Leg } from "@/lib/types";
import { priceStance, summarize, journeyRows, keyLevels } from "@/lib/retroStory";

const leg = (o: Partial<Leg>): Leg => ({ id: Math.random().toString(36), kind: "option", action: "sell", type: "call", strike: 100, qty: 1, dte: 30, premium: 2, ...o }) as Leg;

describe("今昔对比的叙事", () => {
  it("组合靠什么赚钱：看到期盈亏的形状，远离现价的价差也不会被当成中性", () => {
    const bearCall = [leg({ strike: 260, premium: 12 }), leg({ action: "buy", strike: 290, premium: 4 })];
    expect(priceStance(bearCall, 237.7, 8)).toBe("bear");
    expect(priceStance([leg({ type: "put", strike: 90, premium: 1 })], 100, 1)).toBe("bull");
    const condor = [
      leg({ action: "buy", type: "put", strike: 85, premium: 0.5 }), leg({ type: "put", strike: 90, premium: 1.2 }),
      leg({ strike: 110, premium: 1.2 }), leg({ action: "buy", strike: 115, premium: 0.5 }),
    ];
    expect(priceStance(condor, 100, 1.4)).toBe("neutral");
    expect(priceStance([leg({ action: "buy", premium: 4 }), leg({ action: "buy", type: "put", premium: 4 })], 100, 8)).toBe("wide");
  });

  it("一句话总结：亏损的主因 + 往反方向帮了多少", () => {
    const s = summarize({ price: -7, time: 0.4, iv: 1.8, adjust: 0, total: -4.8 });
    expect(s.main).toBe("price");
    expect(s.others).toEqual(["time", "iv"]);
    expect(s.othersValue).toBeCloseTo(2.2, 8);
    expect(summarize({ price: 1, time: 3, iv: -0.5, adjust: 0, total: 3.5 }).main).toBe("time");
  });

  it("历程超过上限时把最早的几段合并，四项之和不变", () => {
    const states = Array.from({ length: 12 }, (_, i) => ({ day: i, spot: 100 + i, pnl: -i * 0.1 }));
    const segs = states.slice(1).map((s, i) => ({ fromDay: i, toDay: s.day, price: -0.1, time: 0.02, iv: -0.02, adjust: 0, total: -0.1, estimated: false }));
    const rows = journeyRows(states, segs, 8);
    expect(rows.length).toBe(8);
    expect(rows[0].fromDay).toBe(0);
    expect(rows[rows.length - 1].toDay).toBe(11);
    const sum = rows.reduce((a, r) => a + r.parts.price, 0);
    expect(sum).toBeCloseTo(-1.1, 8);
  });

  it("关键价位：卖看涨价差的盈亏平衡点 = 卖出行权价 + 收的权利金（按总账）", () => {
    const legs = [leg({ strike: 260, dte: 21, premium: 15 }), leg({ action: "buy", strike: 290, dte: 21, premium: 5 })];
    // 今天组合价值10、开仓收了7.88 → 总账 −2.12
    const lv = keyLevels(legs, 270, -2.12)!;
    expect(lv.profitSide).toBe("below");
    expect(lv.breakevens[0]).toBeCloseTo(267.88, 1);
    expect(lv.maxProfit!).toBeCloseTo(7.88, 2);
    expect(lv.maxLoss!).toBeCloseTo(7.88 - 30, 2);
  });
});
