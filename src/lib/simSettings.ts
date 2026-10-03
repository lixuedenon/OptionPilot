// src/lib/simSettings.ts
// 胜率模拟和持仓建议共用的设定：止盈/止损/到期前平仓规则（卖方、买方分开）、手动填的"你假设的实际波动"、买方的假设年化涨跌。
// 两处读同一份，改一处另一处立刻跟着变，不会给出两套结论。规则存浏览器；手填的波动和涨跌只在本次打开期间有效（按股票代码区分）。
import { useEffect, useState, useSyncExternalStore } from "react";
import type { SimRules } from "@/lib/winRateSim";
import { computeHV, fetchHistoricalSeries } from "@/lib/historicalVolatility";

export type Side = "credit" | "debit";

const RULES_KEY = "optionpilot.winRateRules2";
// 卖方赚权利金的一半就走、亏到1倍止损；买方赚1倍、亏一半止损。
export const DEFAULT_RULES: Record<Side, SimRules> = {
  credit: { takeProfitPct: 0.5, stopMult: 1, closeFrac: 0.25 },
  debit: { takeProfitPct: 1, stopMult: 0.5, closeFrac: 0.25 },
};

export const fracLabel = (f: number) =>
  Math.abs(f - 0.25) < 1e-6 ? "1/4" : Math.abs(f - 1 / 3) < 1e-6 ? "1/3" : Math.abs(f - 0.5) < 1e-6 ? "1/2" : `${Math.round(f * 100)}%`;

function loadRules(): Record<Side, SimRules> {
  try {
    const r = JSON.parse(localStorage.getItem(RULES_KEY) ?? "null");
    if (r && typeof r.credit?.closeFrac === "number" && typeof r.debit?.closeFrac === "number") return r as Record<Side, SimRules>;
  } catch {
    /* 用默认 */
  }
  return DEFAULT_RULES;
}

interface State {
  rules: Record<Side, SimRules>;
  vol: { symbol: string; pct: number } | null; // 手填的实际波动（%）
  drift: { symbol: string; pct: number } | null; // 买方假设年化涨跌（%）
}

let state: State = { rules: loadRules(), vol: null, drift: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function setSideRules(side: Side, r: SimRules) {
  state = { ...state, rules: { ...state.rules, [side]: r } };
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(state.rules));
  } catch {
    /* 存不了就只在本次生效 */
  }
  emit();
}

export function setVolOverride(symbol: string, pct: number | null) {
  state = { ...state, vol: pct == null ? null : { symbol, pct } };
  emit();
}

export function setDriftPct(symbol: string, pct: number) {
  state = { ...state, drift: { symbol, pct } };
  emit();
}

export function useSimSettings(symbol: string) {
  const s = useSyncExternalStore(subscribe, () => state);
  return {
    rules: s.rules,
    volOverride: s.vol && s.vol.symbol === symbol ? s.vol.pct : null,
    driftPct: s.drift && s.drift.symbol === symbol ? s.drift.pct : 0,
  };
}

// 最近20个交易日的历史波动率（历史价格有10分钟内存缓存，两处同时用只取一次）。
export function useHv20(symbol: string) {
  const [hv, setHv] = useState<{ symbol: string; status: "loading" | "ok" | "error"; hv20?: number }>({ symbol, status: "loading" });
  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    setHv({ symbol, status: "loading" });
    fetchHistoricalSeries(symbol)
      .then((s) => {
        if (!alive) return;
        const hv20 = computeHV(s.closes, 20);
        setHv({ symbol, status: hv20 > 0 ? "ok" : "error", hv20 });
      })
      .catch(() => alive && setHv({ symbol, status: "error" }));
    return () => {
      alive = false;
    };
  }, [symbol]);
  return hv.symbol === symbol ? hv : { symbol, status: "loading" as const };
}
