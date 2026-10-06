// src/lib/__tests__/atmIv.test.ts
// 平值IV：现价两侧行权价call/put反推IV平均后按行权价插值；坏报价跳过；只有一侧且离得远时不算。
import { describe, it, expect } from "vitest";
import { atmIvFromChain } from "@/lib/atmIv";
import { RATE } from "@/lib/pricing";
import { blackScholes } from "@/lib/bs";

const DTE = 30;
const quote = (type: "call" | "put", strike: number, vol: number, spot: number) => {
  const p = blackScholes({ spot, strike, dte: DTE, vol, rate: RATE, type }).price;
  return { strike, bid: p - 0.01, ask: p + 0.01, lastPrice: p };
};
// 波动率微笑：行权价越低IV越高
const smile = (k: number) => 0.3 + (100 - k) * 0.004;
const chainAt = (spot: number, strikes: number[]) => ({
  calls: strikes.map((k) => quote("call", k, smile(k), spot)),
  puts: strikes.map((k) => quote("put", k, smile(k), spot)),
});

describe("atmIvFromChain", () => {
  it("interpolates between the two strikes around spot", () => {
    const iv = atmIvFromChain(chainAt(101, [90, 95, 100, 105, 110]), 101, DTE)!;
    const expected = smile(100) + (smile(105) - smile(100)) * (1 / 5);
    expect(iv).toBeCloseTo(expected, 3);
  });

  it("is lower than the OTM-put average a bull put spread would give (smile)", () => {
    const iv = atmIvFromChain(chainAt(100, [90, 95, 100, 105]), 100, DTE)!;
    const legsAvg = (smile(95) + smile(90)) / 2;
    expect(iv).toBeLessThan(legsAvg);
  });

  it("skips strikes without usable quotes", () => {
    const c = chainAt(101, [95, 100, 105, 110]);
    c.calls[1] = { strike: 100, bid: 0, ask: 0, lastPrice: 0 };
    c.puts[1] = { strike: 100, bid: 0, ask: 0, lastPrice: 0 };
    const iv = atmIvFromChain(c, 101, DTE)!;
    // 100没有报价 → 下一档95和上一档105之间插值
    const expected = smile(95) + (smile(105) - smile(95)) * (6 / 10);
    expect(iv).toBeCloseTo(expected, 3);
  });

  it("returns null when nothing is near the money", () => {
    expect(atmIvFromChain(chainAt(100, [150, 160]), 100, DTE)).toBeNull();
    expect(atmIvFromChain({ calls: [], puts: [] }, 100, DTE)).toBeNull();
  });
});
