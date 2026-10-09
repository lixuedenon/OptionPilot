// src/components/ValueJourney.tsx
// 万次推演卡片的开头两块（推演未来、今昔对比共用）：
// ① 滑块的位置——股价、时间、隐含波动率各从开仓时变了多少；
// ② 期权的价值因此经历了什么——股价/时间/隐含波动率/调整各让你赚亏多少（大白话），加起来=情景（或今天）的盈亏。
// 阶梯图画在左边盈亏归因下面（同一组数，不在这里重复画，画法在lib/simChartDraw.ts的drawWaterfall）。
// 两种模式只是开头的说法不同（"如果走到这个情景" vs "这几天"），数字的算法一样（平均法拆分，见stockOptionMap.attributeSegment）。
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/I18nContext";
import type { PnlParts } from "@/lib/stockOptionMap";
import { summarize, type Factor, type Stance } from "@/lib/retroStory";
import type { Leg } from "@/lib/types";
import { perUnitText } from "@/lib/perContract";

const usd = (v: number) => `$${Math.abs(v).toFixed(2)}`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;

export function NowCells({ spot0, spot1, day, horizon, ivA, ivB }: { spot0: number; spot1: number; day: number; horizon: number; ivA: number; ivB: number | null }) {
  const { t } = useI18n();
  const chg = spot1 - spot0;
  const chgPct = (spot1 / spot0 - 1) * 100;
  const elapsedPct = Math.min(100, (day / Math.max(1, horizon)) * 100);
  const cell = (label: string, main: string, sub: string) => (
    <div className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-[13px] font-semibold tabular-nums text-slate-100">{main}</div>
      <div className="text-[10px] text-slate-400">{sub}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-2">
      {cell(
        t("future.nowPrice"),
        `${spot0.toFixed(2)} → ${spot1.toFixed(2)}`,
        Math.abs(chg) < 0.005 ? t("future.nowPriceFlat") : t(chg >= 0 ? "future.nowPriceUp" : "future.nowPriceDown", { v: usd(chg), p: Math.abs(chgPct).toFixed(1) }),
      )}
      {cell(t("future.nowTime"), t("future.nowTimeMain", { d: Math.round(day), n: horizon }), t("future.nowTimeSub", { p: elapsedPct.toFixed(0), r: Math.max(0, Math.round(horizon - day)) }))}
      {cell(
        t("future.nowIv"),
        ivB != null ? `${ivA.toFixed(1)}% → ${ivB.toFixed(1)}%` : `${ivA.toFixed(1)}%`,
        ivB == null ? t("future.nowIvNA") : Math.abs(ivB - ivA) < 0.05 ? t("future.nowIvFlat") : t(ivB >= ivA ? "future.nowIvUp" : "future.nowIvDown", { n: Math.abs(ivB - ivA).toFixed(1) }),
      )}
    </div>
  );
}

interface JourneyProps {
  mode: "retro" | "scenario";
  totals: PnlParts & { total: number };
  pnl: number; // 终点盈亏（今昔对比含已实现）
  credit: boolean;
  basis: number;
  stance: Stance;
  spot0: number;
  spot1: number;
  day: number;
  ivA: number; // 百分数
  ivB: number | null;
  legs?: Leg[]; // 有多张时开仓收/付写成"每张$x（n张共$y）"
}

export function JourneyBlock({ mode, totals, pnl, credit, basis, stance, spot0, spot1, day, ivA, ivB, legs }: JourneyProps) {
  const { t } = useI18n();
  const scen = mode === "scenario";
  const chg = spot1 - spot0;
  const chgPct = (spot1 / spot0 - 1) * 100;
  const fname = (f: Factor) => t(`future.f_${f}`);
  const summary = summarize(totals);
  const amt = (v: number) => (
    <span className={`w-16 shrink-0 text-right font-semibold tabular-nums ${v >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{signed(v)}</span>
  );
  const line = (key: string, v: number, head: string, why: string) => (
    <div key={key} className="flex gap-2">
      {amt(v)}
      <span>
        <b className="text-slate-100">{head}</b> {why}
      </span>
    </div>
  );
  const lines: ReactNode[] = [];
  // 情景里没动的那一项（比如只拖了波动率）不写，免得"股价涨了0%"这种空话
  if (Math.abs(chg) >= 0.005 || Math.abs(totals.price) >= 0.005) {
    lines.push(
      line("price", totals.price, Math.abs(chg) < 0.005 ? t("future.jPriceFlat") : t(chg >= 0 ? "future.jPriceUp" : "future.jPriceDown", { p: Math.abs(chgPct).toFixed(1) }),
        t(`future.why_price_${stance}_${totals.price >= 0 ? "gain" : "loss"}`)),
    );
  }
  if (day >= 0.5 || Math.abs(totals.time) >= 0.005) {
    lines.push(line("time", totals.time, t("future.jTime", { d: Math.round(day) }), t(`future.why_time_${totals.time >= 0 ? "gain" : "loss"}`)));
  }
  if (ivB != null && Math.abs(totals.iv) >= 0.005) {
    lines.push(
      line("iv", totals.iv, t(ivB >= ivA ? "future.jIvUp" : "future.jIvDown", { a: ivA.toFixed(1), b: ivB.toFixed(1) }),
        t(`future.why_iv_${ivB >= ivA ? "up" : "down"}_${totals.iv >= 0 ? "gain" : "loss"}`)),
    );
  }
  if (Math.abs(totals.adjust) >= 0.005) {
    lines.push(line("adj", totals.adjust, t("future.jAdjust"), t("future.why_adjust")));
  }
  const sumText =
    t(summary.total < 0 ? "future.sumLoss" : "future.sumGain", { f: fname(summary.main), v: usd(summary.mainValue) }) +
    (summary.others.length
      ? t(summary.total < 0 ? "future.sumLossHelp" : "future.sumGainDrag", { f: summary.others.map(fname).join(t("future.sep")), v: usd(summary.othersValue) })
      : t("future.period"));
  const openKey = credit ? (scen ? "future.jOpenCreditScen" : "future.jOpenCredit") : scen ? "future.jOpenDebitScen" : "future.jOpenDebit";
  return (
    <div className="flex flex-col gap-1">
      <div className="text-slate-400">{t(openKey, { v: legs ? perUnitText(basis, legs, t, usd) : usd(basis) })}</div>
      {lines}
      <div className="flex gap-2 border-t border-slate-800 pt-1">
        <span className={`w-16 shrink-0 text-right font-bold tabular-nums ${pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{signed(pnl)}</span>
        <b className="text-slate-100">{t(scen ? "future.jNowScen" : "future.jNow")}</b>
      </div>
      {lines.length > 1 && <div className="mt-1 font-semibold text-amber-200">{sumText}</div>}
      <div className="text-[10px] text-slate-500">{t("future.jSeeLeft")}</div>
    </div>
  );
}
