// src/lib/__tests__/earnings.test.ts
// 财报这一组：按日线判断哪天反应（盘前当天/盘后第二天/周末公布）、下一次反应日、市场押多少和跳空大小、
// 推演里平常波动扣掉跳空；引擎里财报前后的隐含波动率（第0天不变、财报后回落）和跳空让结局更分散。
import { describe, it, expect } from "vitest";
import type { Leg } from "@/lib/types";
import { blackScholes } from "@/lib/bs";
import { RATE } from "@/lib/pricing";
import {
  earningsReactions, typicalAfterClose, reactionDateOf, nextWeekday, impliedFromChains, jumpFromPast, exEarningsVol, earningsDayFrom, type EarningsCtx,
} from "@/lib/earnings";
import { prepareSim, simPnlAt, runBatch, computeStats, openingBasis, type SimRules } from "@/lib/winRateSim";

// 工作日日线：从2026-01-05（周一）起，每天收盘价由moves给出（没写的日子不动）
function series(days: number, moves: Record<string, number>) {
  const closes: number[] = [];
  const timestamps: number[] = [];
  const d = new Date("2026-01-05T14:30:00Z");
  let c = 100;
  while (closes.length < days) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) {
      const iso = d.toISOString().slice(0, 10);
      if (moves[iso] != null) c *= 1 + moves[iso];
      closes.push(c);
      timestamps.push(Math.floor(d.getTime() / 1000));
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { closes, timestamps };
}

describe("earningsReactions", () => {
  it("盘后公布看第二天、盘前公布看当天、周末公布看下一个交易日", () => {
    const s = series(40, { "2026-01-08": 0.01, "2026-01-09": -0.08, "2026-01-21": 0.06, "2026-01-22": -0.01, "2026-02-02": 0.05 });
    const rs = earningsReactions(s, ["2026-01-08", "2026-01-21", "2026-01-31"]);
    expect(rs).toHaveLength(3);
    expect(rs[0]).toMatchObject({ date: "2026-01-08", day: "2026-01-09", afterClose: true });
    expect(rs[0].move).toBeCloseTo(-0.08, 6);
    expect(rs[1]).toMatchObject({ date: "2026-01-21", day: "2026-01-21", afterClose: false });
    expect(rs[1].move).toBeCloseTo(0.06, 6);
    expect(rs[2]).toMatchObject({ date: "2026-01-31", day: "2026-02-02", afterClose: null });
    expect(typicalAfterClose(rs)).toBe(true); // 看得出的两次里一次盘后、一次盘前：过半算盘后
  });

  it("公布日是数据最后一天（反应还没发生）或在数据之外时不算", () => {
    const s = series(10, {});
    const last = new Date(s.timestamps[9] * 1000).toISOString().slice(0, 10);
    expect(earningsReactions(s, [last, "2025-06-01", "2027-01-01"])).toHaveLength(0);
  });

  it("有盘中最高/最低时：涨的那天记最高、跌的那天记最低（相对前一个收盘）；没有就不记", () => {
    const s = series(40, { "2026-01-09": -0.08, "2026-01-21": 0.06 });
    const highs = s.closes.map((c) => c * 1.02);
    const lows = s.closes.map((c) => c * 0.97);
    const rs = earningsReactions({ ...s, highs, lows }, ["2026-01-08", "2026-01-21"]);
    const iDown = s.timestamps.findIndex((t) => new Date(t * 1000).toISOString().startsWith("2026-01-09"));
    const iUp = s.timestamps.findIndex((t) => new Date(t * 1000).toISOString().startsWith("2026-01-21"));
    expect(rs[0].extreme).toBeCloseTo(lows[iDown] / s.closes[iDown - 1] - 1, 9); // 跌的那天：最低
    expect(rs[0].extreme!).toBeLessThan(rs[0].move);
    expect(rs[1].extreme).toBeCloseTo(highs[iUp] / s.closes[iUp - 1] - 1, 9); // 涨的那天：最高
    expect(rs[1].extreme!).toBeGreaterThan(rs[1].move);
    expect(earningsReactions(s, ["2026-01-21"])[0].extreme).toBeUndefined();
  });
});

describe("reaction day", () => {
  it("盘后/不知道=下一个工作日，盘前=当天；周五盘后落到周一", () => {
    expect(nextWeekday("2026-10-09")).toBe("2026-10-12");
    expect(reactionDateOf("2026-10-08", true)).toBe("2026-10-09");
    expect(reactionDateOf("2026-10-08", null)).toBe("2026-10-09");
    expect(reactionDateOf("2026-10-08", false)).toBe("2026-10-08");
    expect(reactionDateOf("2026-10-10", false)).toBe("2026-10-12"); // 周六
  });
});

describe("implied move", () => {
  const quote = (type: "call" | "put", strike: number, vol: number, spot: number, dte: number) => {
    const p = blackScholes({ spot, strike, dte, vol, rate: RATE, type }).price;
    return { strike, bid: p - 0.01, ask: p + 0.01, lastPrice: p };
  };
  const chain = (vol: number, dte: number) => {
    const ks = [90, 95, 100, 105, 110];
    return { calls: ks.map((k) => quote("call", k, vol, 100, dte)), puts: ks.map((k) => quote("put", k, vol, 100, dte)) };
  };

  it("市场押=只算财报那一下（跳空按两个到期日的期限结构扣掉平常波动）", () => {
    // 平常波动30%、跳空8%：财报后7天到期的IV = √(0.3² + 0.08²·365/7)，35天到期的 = √(0.3² + 0.08²·365/35)
    const s1 = Math.sqrt(0.09 + (0.0064 * 365) / 7);
    const s2 = Math.sqrt(0.09 + (0.0064 * 365) / 35);
    const r = impliedFromChains(100, { chain: chain(s1, 7), dte: 7 }, { chain: chain(s2, 35), dte: 35 })!;
    expect(r.iv1).toBeCloseTo(s1, 2);
    expect(r.jump).toBeCloseTo(0.08, 2);
    // 市场押=只算财报那一下：跳空的平均幅度 0.08×√(2/π)≈6.4%；跨式是到期日为止的总幅度（≈0.8×σ√T≈7.1%），比它大
    expect(r.move).toBeCloseTo(0.08 * Math.sqrt(2 / Math.PI), 2);
    expect(r.straddle).toBeGreaterThan(r.move);
    // 财报后第一个到期日离得远（30天）时，跨式里大半是平常日子，市场押仍只是跳空那部分
    const f1 = Math.sqrt(0.09 + (0.0064 * 365) / 30), f2 = Math.sqrt(0.09 + (0.0064 * 365) / 60);
    const far = impliedFromChains(100, { chain: chain(f1, 30), dte: 30 }, { chain: chain(f2, 60), dte: 60 })!;
    expect(far.move).toBeCloseTo(0.08 * Math.sqrt(2 / Math.PI), 2);
    expect(far.straddle).toBeGreaterThan(far.move * 1.4);
  });

  it("没有第二个到期日时按平常波动=六成估；没有期权链时用过去几次的平均幅度", () => {
    const r = impliedFromChains(100, { chain: chain(0.6, 7), dte: 7 })!;
    expect(r.jump).toBeCloseTo(0.6 * 0.8 * Math.sqrt(7 / 365), 3);
    const past = jumpFromPast([
      { date: "a", day: "a", t: 0, move: 0.05, afterClose: true },
      { date: "b", day: "b", t: 0, move: -0.07, afterClose: true },
    ])!;
    expect(past.move).toBeCloseTo(0.06, 6);
    expect(past.jump).toBeCloseTo(0.06 * Math.sqrt(Math.PI / 2), 6);
    expect(jumpFromPast([{ date: "a", day: "a", t: 0, move: 0.05, afterClose: true }])).toBeNull();
  });

  it("推演的平常波动扣掉跳空，至少留三成（跟解期限结构的下限一致）；财报不在推演期间里不算", () => {
    expect(exEarningsVol(0.5, 0.08, 30)).toBeCloseTo(Math.sqrt(0.25 - (0.0064 * 365) / 30), 6);
    expect(exEarningsVol(0.3, 0.2, 10)).toBeCloseTo(0.09, 6);
    const ctx = { dayFromOpen: 20 } as EarningsCtx;
    expect(earningsDayFrom(ctx, 0, 30)).toBe(20);
    expect(earningsDayFrom(ctx, 5, 30)).toBe(15);
    expect(earningsDayFrom(ctx, 0, 19)).toBeNull();
    expect(earningsDayFrom(ctx, 20, 30)).toBeNull();
  });
});

describe("engine with earnings", () => {
  const bs = (type: "call" | "put", strike: number, dte: number, vol: number) => blackScholes({ spot: 100, strike, dte, vol, rate: 0.05, type }).price;
  const leg = (over: Partial<Leg>): Leg => ({ id: Math.random().toString(36), action: "sell", type: "put", strike: 100, dte: 30, premium: 1, ...over });
  // 卖出宽跨式 90P/110C，30天，IV 55%（含财报）
  const legs: Leg[] = [leg({ type: "put", strike: 90, premium: bs("put", 90, 30, 0.55) }), leg({ type: "call", strike: 110, premium: bs("call", 110, 30, 0.55) })];
  const RULES: SimRules = { takeProfitPct: null, stopMult: null, closeFrac: 0 };
  const base = { legs, spot: 100, basis: openingBasis(legs)!, pnlOffset: 0, rules: RULES };

  it("第0天盈亏为0（IV不变）；财报当天收盘后IV回落，同样的股价卖方多赚一截", () => {
    const p = prepareSim({ ...base, earnings: { day: 10, jump: 0.08 } })!;
    expect(p.earnDay).toBe(10);
    expect(Math.abs(simPnlAt(p, 0, 100))).toBeLessThan(1e-9);
    const before = simPnlAt(p, 9, 100);
    const after = simPnlAt(p, 10, 100);
    const plain = prepareSim(base)!;
    expect(after - before).toBeGreaterThan(simPnlAt(plain, 10, 100) - simPnlAt(plain, 9, 100) + 0.5);
  });

  it("没有财报时跟以前一模一样；加了跳空结局更分散、卖方赚钱的机会变少", () => {
    const a = runBatch(prepareSim(base)!, 0.3, 2000, 11).outcomes;
    const b = runBatch(prepareSim({ ...base, earnings: null })!, 0.3, 2000, 11).outcomes;
    expect(b.map((o) => o.pnl)).toEqual(a.map((o) => o.pnl));
    const j = runBatch(prepareSim({ ...base, earnings: { day: 10, jump: 0.12 } })!, 0.3, 4000, 11).outcomes;
    const sd = (os: typeof a) => {
      const r = os.map((o) => Math.log(o.price / 100));
      const m = r.reduce((x, y) => x + y, 0) / r.length;
      return Math.sqrt(r.reduce((x, y) => x + (y - m) ** 2, 0) / r.length);
    };
    expect(sd(j)).toBeGreaterThan(sd(a) * 1.15);
    // 财报落在推演期间外（到期之后）不算
    expect(prepareSim({ ...base, earnings: { day: 40, jump: 0.1 } })!.earnDay).toBeNull();
    expect(computeStats(j).winPct).toBeLessThan(computeStats(runBatch(prepareSim(base)!, 0.3, 4000, 11).outcomes).winPct);
  });
});
