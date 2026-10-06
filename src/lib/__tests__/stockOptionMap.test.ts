// src/lib/__tests__/stockOptionMap.test.ts
// 锁住"两个标签数字一致"：地形图任意一点的盈亏必须等于盈亏图那边priceCombo在同样偏移下的结果。
import { describe, it, expect } from "vitest";
import type { Leg } from "@/lib/types";
import { priceCombo } from "@/lib/pricing";
import { buildMapModel, summarizePath, PATH_GROUPS, comboBaseIv, trackedTotalPnl, buildTrackedHistory, buildAttributionTimeline, openingTerrain } from "@/lib/stockOptionMap";
import { repriceLegsAtDate } from "@/lib/historicalBackfill";

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

describe("stockOptionMap tracked mode", () => {
  const opening = [
    { id: "a", action: "sell", type: "put", strike: 95, dte: 40, premium: 2 },
    { id: "b", action: "buy", type: "put", strike: 90, dte: 40, premium: 1 },
  ] as Leg[];

  it("trackedTotalPnl = sum(current - opening) + realized", () => {
    const now = [
      { ...opening[0], premium: 1.2, dte: 30 },
      { ...opening[1], premium: 0.4, dte: 30 },
      { id: "x", action: "buy", type: "call", strike: 110, dte: 30, premium: 1, disabled: true, closedPnl: 0.5 },
    ] as Leg[];
    // 卖出腿 -1.2 - (-2) = +0.8；买入腿 0.4 - 1 = -0.6；已实现 +0.5
    expect(trackedTotalPnl(opening, now, 100, 100)).toBeCloseTo(0.7, 10);
  });

  it("timeOffset model: NaN before today, equals the offset at today's price", () => {
    const m = buildMapModel(opening.map((l) => ({ ...l, dte: 30 })), 102, 0, { timeOffset: 10, pnlOffset: 0.7 })!;
    expect(m.horizon).toBe(40);
    expect(Number.isNaN(m.pnlAt(5, 100))).toBe(true);
    expect(m.pnlAt(10, 102)).toBeCloseTo(0.7, 8);
    expect(m.start).toEqual({ day: 10, price: 102 });
  });

  it("opening terrain fills the days before today; an estimated snapshot sits exactly on it (gap 0)", () => {
    const m = buildMapModel(opening.map((l) => ({ ...l, dte: 30 })), 102, 0, { timeOffset: 10, pnlOffset: 0.7, opening: { legs: opening, spot: 100 } })!;
    const terrain = openingTerrain({ legs: opening, spot: 100 })!;
    expect(terrain(0, 100)).toBeCloseTo(0, 6);
    expect(m.pnlAt(5, 98)).toBeCloseTo(terrain(5, 98), 10);
    expect(m.pnlAt(10, 102)).toBeCloseTo(0.7, 8);
    // 估算快照=开仓组合按开仓IV重定价（隐含波动率不变、没调整），真实总账跟地形之差应为0（只差权利金四舍五入到分）
    const est = repriceLegsAtDate(opening, 100, 97, 6);
    expect(trackedTotalPnl(opening, est, 97, 100)).toBeCloseTo(terrain(6, 97), 1);
  });

  it("history lists snapshots in time order and marks the first appearance of a roll", () => {
    const openAt = new Date(2026, 8, 1).getTime();
    const day = (n: number) => new Date(2026, 8, 1 + n, 12).getTime();
    const rolled = { id: "r", action: "sell", type: "put", strike: 93, dte: 45, premium: 1.5, derivedFrom: { legId: "a", via: "roll" } } as Leg;
    const { points, markers } = buildTrackedHistory(
      [
        { legs: [opening[0], opening[1], rolled], spot: 97, savedAt: day(6) },
        { legs: opening, spot: 101, savedAt: day(3), estimated: true },
        { legs: [opening[0], opening[1], rolled], spot: 98, savedAt: day(8) },
      ],
      opening, 100, openAt,
    );
    expect(points.map((p) => p.day)).toEqual([0, 3, 6, 8]);
    expect(points[1].estimated).toBe(true);
    expect(markers).toEqual([{ day: 6, via: "roll" }]);
  });
});

describe("attribution timeline", () => {
  const L = (id: string, action: "buy" | "sell", type: "call" | "put", strike: number, premium: number, dte: number, extra: Partial<Leg> = {}): Leg => ({ id, action, type, strike, premium, dte, qty: 1, ...extra });
  const open: Leg[] = [L("a", "sell", "put", 95, 1.6, 30), L("b", "buy", "put", 90, 0.6, 30)];
  it("parts sum to the P&L change and a pure time step is mostly theta", () => {
    const s0 = { legs: open, spot: 100, day: 0, pnl: 0 };
    const later: Leg[] = [L("a2", "sell", "put", 95, 1.2, 25, { openLegId: "a" }), L("b2", "buy", "put", 90, 0.4, 25, { openLegId: "b" })];
    const s1 = { legs: later, spot: 100, day: 5, pnl: trackedTotalPnl(open, later, 100, 100) };
    const { segments, totals } = buildAttributionTimeline([s0, s1]);
    const seg = segments[0];
    expect(seg.price + seg.time + seg.iv + seg.adjust).toBeCloseTo(seg.total, 10);
    expect(Math.abs(seg.price)).toBeLessThan(1e-9);
    expect(seg.time).toBeGreaterThan(0);
    expect(Math.abs(seg.adjust)).toBeLessThan(1e-9);
    expect(totals.total).toBeCloseTo(0.2, 10);
  });
  it("a closed leg shows up as adjustment, price move as price", () => {
    const s0 = { legs: open, spot: 100, day: 0, pnl: 0 };
    const later: Leg[] = [L("a2", "sell", "put", 95, 3, 28, { openLegId: "a", disabled: true, closedPnl: -1.4 }), L("b2", "buy", "put", 90, 1.1, 28, { openLegId: "b" })];
    const s1 = { legs: later, spot: 96, day: 2, pnl: trackedTotalPnl(open, later, 96, 100) };
    const seg = buildAttributionTimeline([s0, s1]).segments[0];
    expect(seg.price).toBeGreaterThan(0); // 买入的put在跌价中赚钱
    expect(seg.adjust).toBeLessThan(0); // 平掉卖出put的已实现亏损
    expect(seg.price + seg.time + seg.iv + seg.adjust).toBeCloseTo(seg.total, 10);
  });
});
