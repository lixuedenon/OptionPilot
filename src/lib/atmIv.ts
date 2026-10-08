// src/lib/atmIv.ts
// 第1组「波动率口径统一」：推演未来时"市场预计股价会怎么动"只用一个数——最近到期日平值期权的隐含波动率。
// 原来三处各算各的：地形图喇叭口和持仓建议用各腿隐含波动率的简单平均，波动率滑块小字用按权利金加权的平均，
// 万次推演的"隐含"选项又是简单平均。卖方组合的腿多半是虚值，虚值Put的隐含波动率因为波动率微笑天然偏高，
// 平均出来比市场对股价本身的预期高，三处数字还互相对不上。平值期权才是市场对"股价本身会动多少"的报价（VIX同一个思路）。
//
// 平值IV = 现价两侧最近的两个行权价，各自call/put反推IV取平均，再按现价在两者之间的位置线性插值。
// 深度实值/虚值不用；买卖价都没有就用最后成交价；反推出来<3%或>300%的当作坏数据丢掉（跟record-iv同一套做法）。
// 取不到期权链（手动输入、没代码、请求失败、开仓日不是今天）时退回各腿简单平均（comboBaseIv）。
import { useEffect, useMemo, useState } from "react";
import type { Leg } from "./types";
import { impliedVol } from "./pricing";
import { getOptionChain, peekResolvedChain, premiumFromQuote, type OptionChainResponse, type OptionQuote } from "./optionChain";
import { dteFromDate } from "./dateUtils";
import { comboBaseIv } from "./stockOptionMap";

const IV_MIN = 0.03;
const IV_MAX = 3;

function quoteIv(q: OptionQuote | undefined, spot: number, dte: number, type: "call" | "put"): number | null {
  if (!q) return null;
  const px = premiumFromQuote(q);
  if (!(px > 0)) return null;
  // 价格低于内在价值（收盘后过期报价常见）反推不出IV
  const intrinsic = type === "call" ? Math.max(0, spot - q.strike) : Math.max(0, q.strike - spot);
  if (px <= intrinsic + 0.005) return null;
  const iv = impliedVol(spot, q.strike, dte, px, type);
  return iv >= IV_MIN && iv <= IV_MAX ? iv : null;
}

function strikeIv(chain: Pick<OptionChainResponse, "calls" | "puts">, strike: number, spot: number, dte: number): number | null {
  const c = quoteIv(chain.calls.find((q) => q.strike === strike), spot, dte, "call");
  const p = quoteIv(chain.puts.find((q) => q.strike === strike), spot, dte, "put");
  if (c != null && p != null) return (c + p) / 2;
  return c ?? p;
}

// dte：这条链的到期日离今天的天数（日历天）。返回小数（0.30=30%），取不到返回null。
export function atmIvFromChain(chain: Pick<OptionChainResponse, "calls" | "puts">, spot: number, dte: number): number | null {
  if (!(spot > 0) || !(dte > 0)) return null;
  const strikes = [...new Set([...chain.calls, ...chain.puts].map((q) => q.strike))].filter((k) => k > 0).sort((a, b) => a - b);
  if (strikes.length === 0) return null;
  const below = strikes.filter((k) => k <= spot).reverse();
  const above = strikes.filter((k) => k > spot);
  // 两侧各往外找最多3档，跳过没有有效报价的行权价
  const pick = (list: number[]) => {
    for (const k of list.slice(0, 3)) {
      const iv = strikeIv(chain, k, spot, dte);
      if (iv != null) return { k, iv };
    }
    return null;
  };
  const lo = pick(below);
  const hi = pick(above);
  if (lo && hi) {
    if (hi.k === lo.k) return lo.iv;
    const w = (spot - lo.k) / (hi.k - lo.k);
    return lo.iv + (hi.iv - lo.iv) * Math.min(1, Math.max(0, w));
  }
  const one = lo ?? hi;
  // 只有一侧时离现价太远就不算（超过5%不再是"平值"）
  return one && Math.abs(one.k / spot - 1) <= 0.05 ? one.iv : null;
}

export interface MarketIv {
  iv: number | null; // 小数；legs没有期权腿时为null
  source: "atm" | "legs"; // atm=最近到期日平值期权；legs=各腿隐含波动率平均（取不到期权链时的退路）
  skew: number; // 第3组：微笑斜率（见skewFromChain）；取不到期权链时为0
}

// 第3组「下跌时IV上升」：最近到期日的波动率微笑有多斜。用虚值期权（行权价<现价的Put、>现价的Call，离现价−15%～+10%以内）
// 的IV对 ln(行权价/现价) 做直线回归，斜率取负号（股票通常是左高右低，结果为正）。含义：股价跌10%，各行权价的IV大约上升 skew×0.1。
// 这是"局部波动率"的经验做法：跌的时候不光是期权越来越值钱，波动率本身也在涨（实盘里下跌时Put往往涨得比只按股价算的更快）。
// 限制在0～1.5之间；点太少（<4个）返回0。
export function skewFromChain(chain: Pick<OptionChainResponse, "calls" | "puts">, spot: number, dte: number): number {
  if (!(spot > 0) || !(dte > 0)) return 0;
  const xs: number[] = [], ys: number[] = [];
  const add = (q: OptionQuote, type: "call" | "put") => {
    const m = Math.log(q.strike / spot);
    if (m < -0.15 || m > 0.1) return;
    if (type === "put" ? q.strike > spot : q.strike < spot) return;
    const iv = quoteIv(q, spot, dte, type);
    if (iv == null) return;
    xs.push(m);
    ys.push(iv);
  };
  chain.puts.forEach((q) => add(q, "put"));
  chain.calls.forEach((q) => add(q, "call"));
  if (xs.length < 4) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx <= 0) return 0;
  return Math.max(0, Math.min(1.5, -sxy / sxx));
}

// 第3组「成交损耗」：每条期权腿现在的半个买卖价差占中间价的比例（期权链实时报价）；拿不到报价的腿为undefined（模拟里按默认公式）。
// dteShift：legs的dte是从哪天算的离今天几天（分析模式开仓日在过去时=开仓后过了几天），查今天的期权链要减掉
export function useLegSpreads(symbol: string, legs: Leg[], enabled: boolean, dteShift = 0): (number | undefined)[] {
  const sym = symbol.trim().toUpperCase();
  const key = legs.map((l) => `${l.kind ?? "o"}:${l.type}:${l.strike}:${l.dte}`).join("|") + `@${dteShift}`;
  const [out, setOut] = useState<(number | undefined)[]>([]);
  useEffect(() => {
    if (!enabled || !sym) {
      setOut([]);
      return;
    }
    let alive = true;
    Promise.all(
      legs.map(async (l) => {
        const dte = l.dte - dteShift;
        if (l.kind === "stock" || !(dte >= 1)) return undefined;
        try {
          const c = peekResolvedChain(sym, dte) ?? (await getOptionChain(sym, dte));
          const q = (l.type === "call" ? c.calls : c.puts).find((r) => r.strike === l.strike);
          if (!q || !(q.bid > 0) || !(q.ask > q.bid)) return undefined;
          const mid = (q.bid + q.ask) / 2;
          return Math.min(0.5, (q.ask - q.bid) / 2 / mid);
        } catch {
          return undefined;
        }
      }),
    ).then((r) => alive && setOut(r));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sym, key]);
  return out;
}

// 推演未来用的"市场预期波动"：开仓日是今天、有代码、期权链取得到时用最近到期日平值IV，否则退回各腿平均。
// chainSpot：期权链那一刻的股价（实时报价），没有就用spot。期权链走optionChain.ts的缓存，腿位自动填权利金时通常已经拉过，不会多一次请求。
export function useMarketIv(opts: { symbol: string; legs: Leg[]; spot: number; chainSpot?: number; enabled: boolean }): MarketIv {
  const { symbol, legs, spot, chainSpot, enabled } = opts;
  const options = legs.filter((l) => l.kind !== "stock" && !l.disabled);
  const nearDte = options.length > 0 ? Math.min(...options.map((l) => l.dte)) : 0;
  const sym = symbol.trim().toUpperCase();
  const canUseChain = enabled && sym !== "" && nearDte >= 1;
  const [chain, setChain] = useState<OptionChainResponse | null>(() => (canUseChain ? peekResolvedChain(sym, nearDte) : null));

  useEffect(() => {
    if (!canUseChain) {
      setChain(null);
      return;
    }
    const hit = peekResolvedChain(sym, nearDte);
    if (hit) {
      setChain(hit);
      return;
    }
    let alive = true;
    setChain(null);
    getOptionChain(sym, nearDte)
      .then((c) => alive && setChain(c))
      .catch(() => alive && setChain(null));
    return () => {
      alive = false;
    };
  }, [canUseChain, sym, nearDte]);

  const legsIv = useMemo(() => comboBaseIv(legs.filter((l) => !l.disabled), spot), [legs, spot]);
  const atm = useMemo(() => {
    if (!chain || !canUseChain) return null;
    const s = chainSpot && chainSpot > 0 ? chainSpot : spot;
    const dte = chain.usedExpiryDate ? Math.max(0.5, dteFromDate(chain.usedExpiryDate)) : nearDte;
    return atmIvFromChain(chain, s, dte);
  }, [chain, canUseChain, chainSpot, spot, nearDte]);

  const skew = useMemo(() => {
    if (!chain || !canUseChain) return 0;
    const s = chainSpot && chainSpot > 0 ? chainSpot : spot;
    const dte = chain.usedExpiryDate ? Math.max(0.5, dteFromDate(chain.usedExpiryDate)) : nearDte;
    return skewFromChain(chain, s, dte);
  }, [chain, canUseChain, chainSpot, spot, nearDte]);

  if (atm != null) return { iv: atm, source: "atm", skew };
  return { iv: legsIv, source: "legs", skew };
}
