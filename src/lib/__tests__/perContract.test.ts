// src/lib/__tests__/perContract.test.ts
import { describe, it, expect } from "vitest";
import { contractUnit, perUnitParts, perUnitText } from "@/lib/perContract";
import type { Leg } from "@/lib/types";

const leg = (qty: number, kind: Leg["kind"] = "option"): Leg => ({ id: String(Math.random()), kind, action: "sell", type: "put", strike: 90, dte: 30, premium: 0.35, qty } as Leg);
const t = (k: string, v?: Record<string, string | number>) => `${k}:${v?.p}|${v?.n}|${v?.v}`;
const usd = (x: number) => `$${Math.abs(x).toFixed(2)}`;

describe("perContract", () => {
  it("张数的最大公约数；正股腿或1张时只写合计", () => {
    expect(contractUnit([leg(5)])).toBe(5);
    expect(contractUnit([leg(2), leg(4)])).toBe(2);
    expect(contractUnit([leg(1), leg(2)])).toBe(1);
    expect(contractUnit([leg(5), leg(100, "stock")])).toBe(1);
    expect(perUnitText(1.75, [leg(1)], t, usd)).toBe("$1.75");
  });
  it("5张卖0.35的Put：每张$0.35，5张共$1.75；多腿写每组", () => {
    expect(perUnitText(1.75, [leg(5)], t, usd)).toBe("price.perContract:$0.35|5|$1.75");
    expect(perUnitText(3, [leg(5), leg(5)], t, usd)).toBe("price.perSet:$0.60|5|$3.00");
  });
  it("合计=取到分的每张×张数，括号里的乘法对得上", () => {
    expect(perUnitText(4.99, [leg(5)], t, usd)).toBe("price.perContract:$1.00|5|$5.00");
  });
  it("正负对称取整：同一个差额正着写、负着写差不出一分", () => {
    expect(perUnitParts(0.625, [leg(5)]).per).toBe(0.13);
    expect(perUnitParts(-0.625, [leg(5)]).per).toBe(-0.13);
    expect(perUnitParts(-3.24, [leg(5)])).toEqual({ n: 5, per: -0.65, total: -3.25 });
  });
});
