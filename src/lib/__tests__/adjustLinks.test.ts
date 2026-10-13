// src/lib/__tests__/adjustLinks.test.ts
import { describe, it, expect } from "vitest";
import type { Leg } from "../types";
import { adjustedLegs, adjustedCopy, restoreRollSource, hasRollChild } from "../adjustLinks";

const L = (id: string, strike: number, extra: Partial<Leg> = {}): Leg => ({ id, action: "sell", type: "put", strike, dte: 30, premium: 2, ...extra });

describe("adjustLinks", () => {
  it("第一次展期：原腿换成新腿，位置不变，原腿自己的保护腿留着", () => {
    const legs = [L("a", 100), L("p", 95, { action: "buy", derivedFrom: { legId: "a", via: "protect" } }), L("b", 110, { type: "call" })];
    const out = adjustedLegs(legs, "roll", L("n", 98), "a");
    expect(out.map((l) => l.id)).toEqual(["n", "p", "b"]);
  });

  it("已展期过的腿再展期：去掉上一次展期出来的腿和它下面的，换上这次的", () => {
    const legs = [
      L("a", 100, { disabled: true }),
      L("r1", 98, { derivedFrom: { legId: "a", via: "roll" } }),
      L("r1p", 93, { action: "buy", derivedFrom: { legId: "r1", via: "protect" } }),
      L("b", 110, { type: "call" }),
    ];
    expect(hasRollChild(legs, "a")).toBe(true);
    const out = adjustedLegs(legs, "roll", L("n", 96), "a");
    expect(out.map((l) => l.id)).toEqual(["n", "b"]);
  });

  it("保护插在原腿后面、对冲放最后，屏蔽的腿不进副本", () => {
    const legs = [L("a", 100), L("x", 90, { disabled: true }), L("b", 110)];
    expect(adjustedLegs(legs, "protect", L("p", 95), "a").map((l) => l.id)).toEqual(["a", "p", "b"]);
    expect(adjustedLegs(legs, "hedge", L("h", 100)).map((l) => l.id)).toEqual(["a", "b", "h"]);
  });

  it("副本是新id、去掉来源和已落袋字段", () => {
    const legs = [L("a", 100, { entryPremium: 2, openLegId: "o" })];
    const out = adjustedCopy(legs, "protect", L("p", 95, { derivedFrom: { legId: "a", via: "protect" } }), "a");
    expect(out.every((l) => l.id !== "a" && l.id !== "p")).toBe(true);
    expect(out.some((l) => l.derivedFrom || l.entryPremium !== undefined || l.openLegId)).toBe(false);
  });

  it("撤销一次展期：还有别的展期腿时原腿不恢复", () => {
    const legs = [L("a", 100, { disabled: true }), L("r2", 97, { derivedFrom: { legId: "a", via: "roll" } })];
    expect(restoreRollSource(legs, "a")[0].disabled).toBe(true);
    expect(restoreRollSource([legs[0]], "a")[0].disabled).toBe(false);
  });
});
