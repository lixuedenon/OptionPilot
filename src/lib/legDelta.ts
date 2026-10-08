// src/lib/legDelta.ts
// Delta（2026-10-06，xue：单腿和整个组合的Delta都是很重要的指标）。只回答"股价动$1，钱动多少"，
// 不拿它给组合贴"看涨/看跌"的标签（离现价远的价差Delta很小，会被误判成中性——retroStory.priceStance就是为此不用Delta）。
// 口径：每条腿显示的是这张期权本身的Delta（Put为负，不管买卖）；组合Delta=各腿按买卖方向×张数加起来（每股，跟App里盈亏同一口径），
// 正股腿每单位记±1（跟legShiftedPrice一样，正股按每股盈亏、不乘股数）。隐含波动率按各腿自己的权利金反推。
import type { Leg } from "./types";
import { blackScholes } from "./bs";
import { impliedVol, RATE } from "./pricing";
import { premiumFromQuote, type OptionChainResponse } from "./optionChain";

const IV_MIN = 0.03;

// 这张期权本身的Delta（看这张合约，Put为负）；权利金没填好（反推不出可信IV）时返回null。ivOverride给了就用它。
export function optionDelta(leg: Leg, spot: number, ivOverride?: number): number | null {
  if (leg.kind === "stock") return 1;
  if (!(spot > 0) || !(leg.strike > 0)) return null;
  if (leg.dte <= 0) {
    if (leg.type === "call") return spot > leg.strike ? 1 : 0;
    return spot < leg.strike ? -1 : 0;
  }
  const iv = ivOverride ?? (leg.premium > 0 ? impliedVol(spot, leg.strike, leg.dte, leg.premium, leg.type) : NaN);
  if (!(iv >= IV_MIN)) return null;
  return blackScholes({ spot, strike: leg.strike, dte: leg.dte, vol: iv, rate: RATE, type: leg.type }).delta;
}

// 组合Delta（每股）：spot=各腿权利金对应的股价（反推IV用），at=要在哪个股价算（默认就是spot；IV按各腿不变）。
export function comboDelta(legs: Leg[], spot: number, at = spot): number | null {
  let sum = 0;
  let any = false;
  for (const l of legs) {
    if (l.disabled) continue;
    const sign = l.action === "buy" ? 1 : -1;
    if (l.kind === "stock") {
      sum += sign;
      any = true;
      continue;
    }
    const iv = l.premium > 0 && l.dte > 0 ? impliedVol(spot, l.strike, l.dte, l.premium, l.type) : undefined;
    const d = optionDelta(l, at, iv !== undefined && iv >= IV_MIN ? iv : undefined);
    if (d == null) return null;
    sum += sign * (l.qty ?? 1) * d;
    any = true;
  }
  return any ? sum : null;
}

// 按Delta选行权价：在期权链里挑Delta绝对值最接近target的那一档（各档按自己的市场价反推IV）。target按正数填（0.30），Put的Delta是负的。
export function strikeForDelta(
  chain: Pick<OptionChainResponse, "calls" | "puts">, type: "call" | "put", spot: number, dte: number, target: number,
): { strike: number; delta: number; premium: number } | null {
  if (!(spot > 0) || !(dte > 0) || !(target > 0)) return null;
  const rows = type === "call" ? chain.calls : chain.puts;
  let best: { strike: number; delta: number; premium: number } | null = null;
  let bestDiff = Infinity;
  for (const q of rows) {
    const premium = premiumFromQuote(q);
    if (!(premium > 0)) continue;
    const iv = impliedVol(spot, q.strike, dte, premium, type);
    if (!(iv >= IV_MIN) || iv > 3) continue;
    const delta = blackScholes({ spot, strike: q.strike, dte, vol: iv, rate: RATE, type }).delta;
    const diff = Math.abs(Math.abs(delta) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { strike: q.strike, delta, premium };
    }
  }
  return best;
}
