// src/hooks/useEpsEstimate.ts
// 2026-09-18新增：粗算未来1-2年估值区间（分析师EPS预估区间 × 当前市盈率），
// 数据源见 supabase/functions/eps-estimate。跟 useStockQuote.ts 是同一套
// "换标的代码后防抖自动拉取"模式，故意照抄它的结构，方便以后一起维护。
import { useState, useEffect, useCallback } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export interface EpsRange {
  period: "1y" | "2y";
  epsLow: number;
  epsHigh: number;
  low: number;
  high: number;
  numberOfAnalysts: number | null;
}

export interface EpsEstimate {
  symbol: string;
  peMultiple: number;
  peSource: "forward" | "trailing";
  ranges: EpsRange[];
}

export function useEpsEstimate(symbol: string) {
  const [estimate, setEstimate] = useState<EpsEstimate | null>(null);
  const [loading, setLoading] = useState(false);

  // 没有对外暴露 error：这是个锦上添花的辅助信息（不是所有标的都有分析师
  // 预估，比如大部分ETF），拉取失败或者没数据就静默不显示这块UI，不占
  // header的位置去解释原因——跟quote/premium那些核心数据不一样，那些拿不到
  // 会明确提示，这个没有必要。
  const fetchEstimate = useCallback(async (sym: string) => {
    if (!sym || sym.trim().length === 0) return;
    setLoading(true);
    try {
      const url = `${SUPABASE_URL}/functions/v1/eps-estimate?symbol=${encodeURIComponent(sym)}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
      });
      if (!resp.ok) throw new Error("request failed");
      const data: EpsEstimate = await resp.json();
      setEstimate(data.ranges && data.ranges.length > 0 ? data : null);
    } catch {
      setEstimate(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      if (symbol && symbol.trim().length > 0) {
        fetchEstimate(symbol.trim());
      } else {
        setEstimate(null);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [symbol, fetchEstimate]);

  return { estimate, loading };
}
