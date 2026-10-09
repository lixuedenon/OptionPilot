// src/components/PnlHeadline.tsx
// 图表区的盈亏头部：情景日期 + 组合盈亏（金额+盈利/亏损）+ 平仓净值（收/付）和盈亏百分比。金额统一按每股（跟期权报价同一个数，用户自己×100就是每张），不再有每股/每张切换。
// 电脑版分析模式放在"盈亏图 / 股价 vs 期权价"标签同一行，两个标签共用；跟踪对比模式和手机版仍由PayoffChart自己显示。
import { useI18n } from "@/i18n/I18nContext";
import { formatDateInput } from "@/lib/dateUtils";

interface Props {
  dateTs: number | null;
  pnl: number;
  netValue: number;
  netChange: number;
  hasStock: boolean;
  className?: string;
}

// 固定mm/dd/yyyy（xue指定）。
function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

export default function PnlHeadline({ dateTs, pnl, netValue, netChange, hasStock, className }: Props) {
  const { t } = useI18n();
  const isFlat = Math.abs(pnl) < 0.005;
  const sign = isFlat ? "flat" : pnl > 0 ? "profit" : "loss";
  const amountCls = sign === "profit" ? "text-emerald-400" : sign === "loss" ? "text-rose-400" : "text-slate-300";
  const labelCls = sign === "profit" ? "text-emerald-500" : sign === "loss" ? "text-rose-500" : "text-slate-500";
  const label = sign === "profit" ? t("chart.profit") : sign === "loss" ? t("chart.loss") : t("chart.flat");
  // 盈亏占开仓权利金的百分比（对照"盈利50%/亏损50%平仓"）；含正股腿或开仓权利金≈0时退回显示金额。
  const basis = Math.abs(netValue - netChange);
  const pct = !hasStock && basis > 0.005 ? (netChange / basis) * 100 : null;
  const money = (v: number) => Math.abs(v).toFixed(2);
  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      {dateTs !== null && (
        <span className="whitespace-nowrap text-sm font-bold tabular-nums text-sky-300" title={formatDateInput(dateTs)}>
          {fmtDate(dateTs)}
        </span>
      )}
      <span className="flex items-baseline gap-1.5">
        <span className={`text-lg font-black tabular-nums leading-none ${amountCls}`}>
          {sign === "profit" ? "+" : sign === "loss" ? "−" : ""}${money(pnl)}
        </span>
        <span className={`whitespace-nowrap text-[9px] font-bold ${labelCls}`}>{label}</span>
      </span>
      {/* 净值>0：现在平仓能收回这笔钱；<0：平仓要付出这笔钱（比如卖方组合）。 */}
      <span className="shrink-0 whitespace-nowrap rounded border border-slate-700 bg-slate-900 px-1.5 py-0 text-[9px]" title={t("chart.netHint")}>
        <span className="text-slate-500">{netValue >= 0 ? t("chart.netReceive") : t("chart.netPay")} </span>
        <span className="font-bold tabular-nums text-slate-100">${money(netValue)}</span>
        <span
          className={"ml-1 font-semibold tabular-nums " + (netChange >= 0 ? "text-emerald-400" : "text-rose-400")}
          title={pct !== null ? t("chart.pnlPctHint") : undefined}
        >
          {netChange >= 0 || Math.abs(netChange) < 0.005 ? "+" : "−"}{pct !== null ? `${Math.abs(pct).toFixed(1)}%` : money(netChange)}
        </span>
      </span>
    </div>
  );
}
