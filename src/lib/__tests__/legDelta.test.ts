// src/lib/__tests__/legDelta.test.ts
// Delta：单腿跟BS一致、组合按买卖方向×张数加总；按Delta挑行权价挑最接近的；挂单提示反解的股价代回去刚好等于挂单价。
import { describe, it, expect } from "vitest";
import type { Leg } from "@/lib/types";
import { blackScholes } from "@/lib/bs";
import { RATE } from "@/lib/pricing";
import { optionDelta, comboDelta, strikeForDelta } from "@/lib/legDelta";
import { legOrderHint, comboOrderHint, nearestBreakeven } from "@/lib/orderHint";

const S = 100, DTE = 30;
const px = (type: "call" | "put", k: number, v = 0.3, s = S, dte = DTE) => blackScholes({ spot: s, strike: k, dte, vol: v, rate: RATE, type }).price;
const leg = (o: Partial<Leg>): Leg => ({ id: Math.random().toString(36), action: "sell", type: "put", strike: 95, dte: DTE, premium: px("put", 95), ...o }) as Leg;

describe("legDelta", () => {
  it("option delta matches Black-Scholes at the leg's own implied vol", () => {
    const l = leg({});
    const d = optionDelta(l, S)!;
    expect(d).toBeCloseTo(blackScholes({ spot: S, strike: 95, dte: DTE, vol: 0.3, rate: RATE, type: "put" }).delta, 3);
    expect(d).toBeLessThan(0);
  });

  it("combo delta = sum of sign × qty × option delta", () => {
    const a = leg({});
    const b = leg({ action: "buy", strike: 90, premium: px("put", 90), qty: 2 });
    const expected = -optionDelta(a, S)! + 2 * optionDelta(b, S)!;
    expect(comboDelta([a, b], S)!).toBeCloseTo(expected, 6);
    // 卖Put价差在股价下跌时Delta变大（方向风险变大）
    expect(comboDelta([a, leg({ action: "buy", strike: 90, premium: px("put", 90) })], S, 94)!).toBeGreaterThan(comboDelta([a, leg({ action: "buy", strike: 90, premium: px("put", 90) })], S)!);
  });

  it("strikeForDelta picks the listed strike with the closest |delta|", () => {
    const strikes = [85, 90, 95, 100, 105];
    const q = (k: number) => { const p = px("put", k); return { strike: k, bid: p - 0.01, ask: p + 0.01, lastPrice: p }; };
    const chain = { calls: [], puts: strikes.map(q) };
    const hit = strikeForDelta(chain, "put", S, DTE, 0.3)!;
    const ds = strikes.map((k) => Math.abs(blackScholes({ spot: S, strike: k, dte: DTE, vol: 0.3, rate: RATE, type: "put" }).delta));
    const best = strikes[ds.reduce((bi, d, i) => (Math.abs(d - 0.3) < Math.abs(ds[bi] - 0.3) ? i : bi), 0)];
    expect(hit.strike).toBe(best);
  });
});

describe("orderHint", () => {
  it("selling above mid: the solved fill price reprices the option to the limit", () => {
    const mid = px("put", 95);
    const l = leg({ premium: mid + 0.4 });
    const h = legOrderHint(l, mid, S)!;
    expect(h.kind).toBe("wait");
    expect(h.now.down).not.toBeNull();
    expect(px("put", 95, 0.3, h.now.down!)).toBeCloseTo(mid + 0.4, 2);
    // 3天后成交要跌得更多（时间价值掉了）
    expect(h.day3.down!).toBeLessThan(h.now.down!);
    expect(h.odds![1]).toBeGreaterThanOrEqual(h.odds![0]);
  });

  it("selling below mid is marketable; small gaps give no hint", () => {
    const mid = px("put", 95);
    expect(legOrderHint(leg({ premium: mid - 0.3 }), mid, S)!.kind).toBe("marketable");
    expect(legOrderHint(leg({ premium: mid + 0.02 }), mid, S)).toBeNull();
  });

  it("combo credit above market fills on a drop; iron condor can fill either side", () => {
    const a = leg({ strike: 95, premium: px("put", 95) + 0.3 });
    const b = leg({ action: "buy", strike: 90, premium: px("put", 90) });
    const h = comboOrderHint([{ leg: a, mid: px("put", 95) }, { leg: b, mid: px("put", 90) }], S)!;
    expect(h.side).toBe(1);
    expect(h.now.down!).toBeLessThan(S);
    expect(h.now.up).toBeNull();
    const ic = [
      { leg: leg({ action: "buy", strike: 85, premium: px("put", 85) }), mid: px("put", 85) },
      { leg: leg({ strike: 92, premium: px("put", 92) + 0.15 }), mid: px("put", 92) },
      { leg: leg({ type: "call", strike: 108, premium: px("call", 108) + 0.15 }), mid: px("call", 108) },
      { leg: leg({ action: "buy", type: "call", strike: 115, premium: px("call", 115) }), mid: px("call", 115) },
    ];
    const h2 = comboOrderHint(ic, S)!;
    expect(h2.now.down!).toBeLessThan(S);
    expect(h2.now.up!).toBeGreaterThan(S);
  });

  it("nearestBreakeven of a short put spread = short strike − credit", () => {
    const legs = [leg({ strike: 95 }), leg({ action: "buy", strike: 90 })];
    expect(nearestBreakeven(legs, 1.2, 100)!).toBeCloseTo(93.8, 1);
  });
});
