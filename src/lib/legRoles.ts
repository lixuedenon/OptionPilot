// src/lib/legRoles.ts
import type { Leg, OptionType } from "./types";

export type LegRole =
  | "underlying"    // 正股仓位
  | "directional"   // 单腿方向性买入
  | "income"        // 单腿方向性卖出（收租）
  | "anchor"        // 价差/铁鹰里贴近现价、真正决定盈亏的主力腿
  | "protective"     // 价差/蝶式里的保护翼，限制最大亏损或降低成本
  | "core"          // 蝶式的中心腿（重复行权价那条），赌股价刚好落在附近
  | "speculative"   // 跨式/宽跨式，赌大波动、方向不限
  | "enhancement"   // 领口/备兑里卖出的那条，增强收益/收租
  | "generic";      // 没能归类到具体角色，退化成"这条腿本身在做什么"的直白描述

export interface LegRoleInfo {
  legId: string;
  role: LegRole;
  label: string;       // 短标签，比如"主力腿"
  explanation: string; // 完整的一句大白话解释
}

function fmtLeg(l: Leg): string {
  const typeLabel = l.type === "call" ? "Call" : "Put";
  return `${l.action === "buy" ? "买入" : "卖出"}${typeLabel}@${l.strike}`;
}

// A single, un-paired option leg. Without an underlying stock position,
// buying is a leveraged directional bet and selling is an income bet
// against the opposite direction. WITH a stock position present, the
// framing changes completely — a bought put isn't "betting on a decline,"
// it's insurance on the shares already held, and a sold call isn't
// "betting price won't rise," it's giving up some upside for income on
// a position already owned. Conflating the two was a real bug: a
// Collar's protective put came out labeled "leveraged bet on decline,"
// which is backwards for what it's actually doing there.
function explainLoneLeg(l: Leg, hasStock: boolean): LegRoleInfo {
  if (hasStock) {
    if (l.action === "sell") {
      const dir = l.type === "call" ? "涨过" : "跌破";
      return {
        legId: l.id,
        role: "enhancement",
        label: "增强收益腿",
        explanation: `${fmtLeg(l)}：在已持有的正股上收权利金增强收益，代价是股价${dir}这个价位时这部分收益被封顶。`,
      };
    }
    const dir = l.type === "put" ? "跌破" : "涨过";
    return {
      legId: l.id,
      role: "protective",
      label: "保护腿",
      explanation: `${fmtLeg(l)}：给已持有的正股买保险，股价${dir}这个价位时开始发挥保护作用。`,
    };
  }
  if (l.action === "buy") {
    const dir = l.type === "call" ? "上涨" : "下跌";
    return {
      legId: l.id,
      role: "directional",
      label: "方向性腿",
      explanation: `${fmtLeg(l)}：杠杆押注股价${dir}超过这个行权价，最大亏损就是付出的权利金。`,
    };
  }
  const dir = l.type === "call" ? "不会涨过" : "不会跌破";
  return {
    legId: l.id,
    role: "income",
    label: "收租腿",
    explanation: `${fmtLeg(l)}：收权利金，押注股价${dir}这个行权价。`,
  };
}

// Vertical spread (1 buy + 1 sell, same type): whichever leg has the
// higher ILLUSTRATIVE... no — here we're working with the user's REAL
// premiums directly (not a preset's illustrative ones), so "which leg is
// the anchor" is read straight off which side collected more premium —
// a net credit spread's sold leg is the anchor (income-generating, closer
// to the money); a net debit spread's bought leg is the anchor (paying
// for directional exposure). Same reasoning as scenarioEngine.ts's
// optimizeStrikes credit/debit split, just reading real premiums instead
// of inferring from an illustrative preset.
function explainVertical(sell: Leg, buy: Leg): LegRoleInfo[] {
  const netCredit = sell.premium >= buy.premium;
  const anchor = netCredit ? sell : buy;
  const other = netCredit ? buy : sell;
  const anchorDesc = netCredit
    ? `${fmtLeg(anchor)}：这条腿是主力，收的权利金比另一条腿多，组合的盈亏基本看它。`
    : `${fmtLeg(anchor)}：这条腿是主力，付出的权利金比另一条腿多，组合靠它建立方向判断。`;
  const otherDesc = netCredit
    ? `${fmtLeg(other)}：给上面那条卖出腿上保险，万一股价走远了，亏损被这条腿封顶。`
    : `${fmtLeg(other)}：卖出这条腿收一点权利金，用来降低主力腿的成本，同时也给主力腿的最大盈利封了顶。`;
  return [
    { legId: anchor.id, role: "anchor", label: "主力腿", explanation: anchorDesc },
    { legId: other.id, role: "protective", label: netCredit ? "保护腿" : "封顶腿", explanation: otherDesc },
  ];
}

// Butterfly shape: a strike shared by 2+ legs (the body), with at least
// one leg on each side of it (the wings). Same detection rule as
// scenarioEngine.ts's optimizeStrikes uses to tell a butterfly apart from
// a 1x2 ratio spread (which also has a repeated strike but only legs on
// ONE side of it).
function explainButterfly(legsOfType: Leg[], bodyStrike: number): LegRoleInfo[] {
  return legsOfType.map((l) => {
    if (l.strike === bodyStrike) {
      return {
        legId: l.id,
        role: "core" as const,
        label: "核心腿",
        explanation: `${fmtLeg(l)}：这是赌注的中心，押注股价到期时刚好落在这附近。`,
      };
    }
    return {
      legId: l.id,
      role: "protective" as const,
      label: "保护翼",
      explanation: `${fmtLeg(l)}：给核心腿上保险，限制股价走远时的最大亏损。`,
    };
  });
}

// Straddle/strangle shape: one call + one put, BOTH bought or BOTH sold —
// no anchor/protection relationship between them, they're a matched pair
// betting on volatility itself rather than a specific direction.
function explainSpeculativePair(call: Leg, put: Leg): LegRoleInfo[] {
  const buying = call.action === "buy";
  const desc = buying
    ? "押注股价会有大波动，不管涨跌，两条腿一起构成这个判断，没有主次之分。"
    : "收两条腿的权利金，押注股价不会有大波动，两条腿一起构成这个判断，没有主次之分。";
  return [
    { legId: call.id, role: "speculative", label: "投机腿", explanation: `${fmtLeg(call)}：${desc}` },
    { legId: put.id, role: "speculative", label: "投机腿", explanation: `${fmtLeg(put)}：${desc}` },
  ];
}

// Collar/covered-style: one call + one put, DIFFERENT actions (one bought,
// one sold, unlike the speculative pair above) — no shared strike
// relationship the way a vertical has, each leg does its own separate job.
function explainMixedPair(legs: Leg[]): LegRoleInfo[] {
  return legs.map((l) => {
    if (l.action === "sell") {
      return {
        legId: l.id,
        role: "enhancement" as const,
        label: "增强收益腿",
        explanation: `${fmtLeg(l)}：收权利金增强收益，代价是这个方向的空间被封顶。`,
      };
    }
    return {
      legId: l.id,
      role: "protective" as const,
      label: "保护腿",
      explanation: `${fmtLeg(l)}：花钱买保险，限制这个方向的最大亏损。`,
    };
  });
}

// Main entry point — classifies every leg in a real, user-built combo
// (not necessarily matching any of the 39 presets exactly). Falls back to
// a plain per-leg description for shapes that don't match a recognized
// pattern (an unusual mix of 3+ legs at odd strikes, say) rather than
// guessing at a relationship that isn't really there.
export function explainLegRoles(legs: Leg[]): LegRoleInfo[] {
  const active = legs.filter((l) => !l.disabled);
  const stockLegs = active.filter((l) => l.kind === "stock");
  const optionLegs = active.filter((l) => l.kind !== "stock");

  const out: LegRoleInfo[] = stockLegs.map((l) => ({
    legId: l.id,
    role: "underlying",
    label: "标的仓位",
    explanation: `${l.action === "buy" ? "持有" : "做空"}正股${l.shares ?? 100}股：整个组合的底仓，其余腿位都是围绕它做收益增强或风险保护。`,
  }));

  // Speculative / mixed pair check first — these span BOTH types (one
  // call + one put), so they need to be recognized before the per-type
  // loop below (which handles each type independently and would miss
  // this cross-type relationship entirely).
  const calls = optionLegs.filter((l) => l.type === "call");
  const puts = optionLegs.filter((l) => l.type === "put");
  if (stockLegs.length === 0 && calls.length === 1 && puts.length === 1) {
    if (calls[0].action === puts[0].action) {
      return [...out, ...explainSpeculativePair(calls[0], puts[0])];
    }
    return [...out, ...explainMixedPair([calls[0], puts[0]])];
  }

  for (const type of ["call", "put"] as OptionType[]) {
    const legsOfType = optionLegs.filter((l) => l.type === type);
    if (legsOfType.length === 0) continue;

    if (legsOfType.length === 1) {
      out.push(explainLoneLeg(legsOfType[0], stockLegs.length > 0));
      continue;
    }

    const shorts = legsOfType.filter((l) => l.action === "sell");
    const longs = legsOfType.filter((l) => l.action === "buy");

    // Butterfly: a strike shared by 2+ legs, with legs on both sides.
    const repeated = legsOfType.find((l) => legsOfType.filter((x) => x.strike === l.strike).length >= 2);
    const hasBothSides = repeated
      ? legsOfType.some((l) => l.strike < repeated.strike) && legsOfType.some((l) => l.strike > repeated.strike)
      : false;
    if (repeated && hasBothSides) {
      out.push(...explainButterfly(legsOfType, repeated.strike));
      continue;
    }

    // Simple vertical: exactly one bought and one sold leg of this type.
    if (shorts.length === 1 && longs.length === 1) {
      out.push(...explainVertical(shorts[0], longs[0]));
      continue;
    }

    // Anything else (a 1x2 ratio without both-sided wings, 3+ legs all
    // same action, or some other shape the presets don't produce but a
    // person could still build by hand) — describe each leg on its own
    // rather than guessing at a relationship. Still useful information,
    // just not claiming a role it can't confidently assign.
    for (const l of legsOfType) out.push(explainLoneLeg({ ...l }, stockLegs.length > 0));
  }

  return out;
}