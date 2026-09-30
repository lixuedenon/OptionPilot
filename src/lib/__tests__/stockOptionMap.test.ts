// src/lib/__tests__/stockOptionMap.test.ts
// 锁住"两个标签数字一致"：地形图任意一点的盈亏必须等于盈亏图那边priceCombo在同样偏移下的结果。
import { describe, it, expect } from "vitest";
import type { Leg } from "@/lib/types";
import { priceCombo } from "@/lib/pricing";
import { buildMapModel, summarizePath, PATH_GROUPS, comboBaseIv } from "@/lib/stockOptionMap";

const leg = (over: Partial<Leg>): Leg => ({ id: Math.random().toString(36), action: "buy", type: "call", strike: 100, dte: 30, premium: 5, ...over });

const COMBOS: Record<string, Leg[]> = {
  bullCall: [leg({ strike: 95, premium: 8 }), leg({ action: "sell", strike: 105, premium: 2.5 })],
  ironCondor: [
    leg({ type: "put", strike: 85, premium: 0.5 }),
    leg({ action: "sell", type: "put", strike: 90, premium: 1.2 }),
    leg({ action: "sell", strike: 110, premium: 1.2 }),
    leg({ strike: 115, premium: 0.5 }),
  ],
  calendar: [leg({ action: "sell", dte: 14, premium: 2 }), leg({ dte: 45, premium: 4 })],
  coveredCall: [leg({ kind: "stock", strike: 100, dte: 0, premium: 0, shares: 100 }), leg({ action: "sell", strike: 105, premium: 2, qty: 2 })],
};

describe("stockOptionMap", () => {
  for (const [name, legs] of Object.entries(COMBOS)) {
    it(`${name}: pnlAt equals priceCombo change at the same shifts`, () => {
      for (const dV of [0, 10, -5]) {
        const m = buildMapModel(legs, 100, dV)!;
        for (const day of [0, 3, Math.floor(m.horizon / 2), m.horizon]) {
          for (const price of [m.sMin, 97.3, 100, 104.2, m.sMax]) {
            const expected = priceCombo(legs, { dS: price - 100, dT: day, dV }, 100).change;
            expect(m.pnlAt(day, price)).toBeCloseTo(expected, 8);
          }
        }
      }
    });

    it(`${name}: leg values sum minus opening premium equals P&L`, () => {
      const m = buildMapModel(legs, 100, 0)!;
      const net = legs.reduce((s, l) => (l.kind === "stock" ? s : s + l.premium * (l.action === "buy" ? 1 : -1) * (l.qty ?? 1)), 0);
      const sum = m.legValuesAt(7, 103).reduce((a, b) => a + b, 0);
      expect(sum - net).toBeCloseTo(m.pnlAt(7, 103), 8);
    });
  }

  it("paths start at the start point and cone is symmetric in log space", () => {
    const m = buildMapModel(COMBOS.bullCall, 100, 0)!;
    for (const g of PATH_GROUPS) for (const id of g.paths) expect(m.path(id, 0)).toBeCloseTo(100, 8);
    expect(m.path("up", m.horizon)).toBeCloseTo(100 + m.move, 8);
    const [lo, hi] = m.cone(1, m.horizon);
    expect(Math.log(hi / 100)).toBeCloseTo(-Math.log(lo / 100), 8);
  });

  it("'from today' start moves the path origin and skips earlier days", () => {
    const m = buildMapModel(COMBOS.bullCall, 100, 0, { start: { day: 10, price: 104 } })!;
    expect(m.start).toEqual({ day: 10, price: 104 });
    expect(Number.isNaN(m.path("up", 5))).toBe(true);
    expect(m.path("flat", 20)).toBeCloseTo(104, 8);
    const sum = summarizePath(m, "flat");
    expect(sum.end).toBeCloseTo(m.pnlAt(m.horizon, 104), 8);
  });

  it("profit/loss color scales are tracked separately", () => {
    const m = buildMapModel(COMBOS.ironCondor, 100, 0)!;
    expect(m.maxLoss).toBeGreaterThan(m.maxProfit);
  });

  it("base IV ignores legs whose premium is not filled yet", () => {
    const iv = comboBaseIv([leg({ premium: 0 }), leg({ strike: 105, premium: 3 })], 100)!;
    expect(iv).toBeGreaterThan(0.05);
  });
});
