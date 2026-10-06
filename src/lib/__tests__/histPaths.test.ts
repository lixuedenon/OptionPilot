// src/lib/__tests__/histPaths.test.ts
// 历史真实走法：切段按日历日、周末不动；套到今天股价上走规则，结果跟逐条手算一致。
import { describe, it, expect } from "vitest";
import type { Leg } from "@/lib/types";
import { buildHistPaths, histProbBeyond } from "@/lib/histPaths";
import { prepareSim, runBatchPaths, simPnlAt } from "@/lib/winRateSim";

// 交易日序列：只有周一到周五，每天+1%
function series(nDays: number) {
  const closes: number[] = [], timestamps: number[] = [];
  let t = Date.UTC(2024, 0, 1, 20) / 1000; // 周一 20:00 UTC（美东收盘）
  let c = 100;
  while (closes.length < nDays) {
    const wd = new Date(t * 1000).getUTCDay();
    if (wd !== 0 && wd !== 6) {
      closes.push(c);
      timestamps.push(t);
      c *= 1.01;
    }
    t += 86400;
  }
  return { closes, timestamps };
}

describe("histPaths", () => {
  it("cuts calendar-day windows; weekends repeat Friday's close", () => {
    const h = buildHistPaths(series(60), 7)!;
    expect(h.days).toBe(7);
    // 第一段从周一开始：第0..4天每天+1%，第5、6天（周末）停在周五，第7天（下周一）再+1%
    const r = Array.from(h.ratios.subarray(0, 8));
    expect(r[0]).toBeCloseTo(1, 6);
    expect(r[4]).toBeCloseTo(1.01 ** 4, 5);
    expect(r[5]).toBeCloseTo(1.01 ** 4, 5);
    expect(r[6]).toBeCloseTo(1.01 ** 4, 5);
    expect(r[7]).toBeCloseTo(1.01 ** 5, 5);
    // 最后一段的结束日不能超过数据最后一天
    const lastStart = h.starts[h.count - 1];
    expect(lastStart + 7 * 86400).toBeLessThanOrEqual(h.to + 43200);
    expect(histProbBeyond(h, 7, 1.02)).toBe(1); // 一直在涨：7天后都涨了2%以上
  });

  it("runBatchPaths walks the real path on today's spot", () => {
    const h = buildHistPaths(series(80), 10)!;
    const legs: Leg[] = [{ id: "a", action: "sell", type: "put", strike: 95, dte: 10, premium: 0.8 } as Leg];
    const p = prepareSim({ legs, spot: 100, basis: 0.8, pnlOffset: 0, rules: { takeProfitPct: null, stopMult: null, closeFrac: 0 } })!;
    const { outcomes, samples } = runBatchPaths(p, { ratios: h.ratios, days: h.days, indices: [0, 3] }, 2);
    expect(samples[0].prices[10]).toBeCloseTo(100 * h.ratios[10], 4);
    expect(samples[1].prices[4]).toBeCloseTo(100 * h.ratios[3 * 11 + 4] / h.ratios[3 * 11], 4);
    expect(outcomes[0].reason).toBe("expiry");
    expect(outcomes[0].pnl).toBeCloseTo(simPnlAt(p, 10, samples[0].prices[10]), 8);
  });
});
