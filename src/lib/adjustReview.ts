// src/lib/adjustReview.ts
// 第5组「要是没调整会怎样」（今昔对比·复盘评估）：做过展期/保护/对冲/平仓的仓位，把开仓那组原封不动拿到今天，
// 按今天的价格算它的总账，跟真实总账（含调整、已实现）比，差值就是"调整带来的"。
// 原组合今天的价格：期权链里查得到同一张合约（同行权价、同到期日）就用实时中间价；查不到（已到期、没有这个行权价、没联网）
// 按开仓时这条腿自己的隐含波动率估算，标"估"。已经到期的腿按到期那天的股价算内在价值（真实走过的路里离到期日最近的那一天）。
import type { Leg } from "./types";
import { bsPrice } from "./bs";
import { impliedVol, RATE } from "./pricing";

export interface HoldLegPrice {
  price: number; // 今天每股价格（正数）
  estimated: boolean; // true=查不到实时报价，按开仓IV估的（或按到期内在价值）
}

// 开仓那组的一条腿今天值多少。quoteMid：期权链里同一张合约的中间价（查不到传null）。priceAtExpiry：已到期时那天的股价。
export function holdLegPrice(leg: Leg, openSpot: number, nowSpot: number, todayDay: number, quoteMid: number | null, priceAtExpiry: number): HoldLegPrice {
  if (leg.kind === "stock") return { price: nowSpot, estimated: false };
  const dteNow = leg.dte - todayDay;
  if (dteNow <= 0) {
    const S = priceAtExpiry;
    return { price: leg.type === "call" ? Math.max(0, S - leg.strike) : Math.max(0, leg.strike - S), estimated: false };
  }
  if (quoteMid != null && quoteMid > 0) return { price: quoteMid, estimated: false };
  const iv = leg.premium > 0 ? impliedVol(openSpot, leg.strike, leg.dte, leg.premium, leg.type) : 0.3;
  return { price: bsPrice(nowSpot, leg.strike, dteNow, Math.max(0.03, iv), RATE, leg.type), estimated: true };
}

// 原组合拿到今天的总账（每股，跟App里盈亏同一口径：正股按每股、期权按张数）
export function holdPnl(legs: Leg[], prices: HoldLegPrice[]): { pnl: number; estimated: boolean } {
  let pnl = 0;
  let est = false;
  legs.forEach((l, i) => {
    if (l.disabled) return;
    const sign = l.action === "buy" ? 1 : -1;
    const p = prices[i];
    if (!p) return;
    if (p.estimated) est = true;
    if (l.kind === "stock") pnl += sign * (p.price - l.strike);
    else pnl += sign * (l.qty ?? 1) * (p.price - l.premium);
  });
  return { pnl, estimated: est };
}

// 真实走过的路里离某一天最近的那一点的股价
export function priceNearDay(history: { day: number; price: number }[], day: number, fallback: number): number {
  let best: { day: number; price: number } | null = null;
  for (const h of history) if (!best || Math.abs(h.day - day) < Math.abs(best.day - day)) best = h;
  return best ? best.price : fallback;
}
