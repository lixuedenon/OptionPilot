// src/components/PnlAttributionPanel.tsx
import { TrendingUp, Clock, Activity, HelpCircle, Repeat } from "lucide-react";
import type { PnlAttribution } from "@/lib/pricing";
import { useI18n } from "@/i18n/I18nContext";
import Term from "@/components/Term";
import CanvasBox from "@/components/simCharts";
import { drawWaterfall } from "@/lib/simChartDraw";

interface Props {
  attribution: PnlAttribution;
  // A fixed reference scale (typically the combo's max profit/max loss —
  // see App.tsx) instead of scaling bars against whichever of the four
  // values happens to be biggest right now. That self-relative approach
  // meant the tallest bar always looked "maxed out" even as the actual
  // dollar amounts kept growing while dragging a slider, since the ruler
  // grew right along with the data. max profit/loss don't move with the
  // slider (see pricing.ts's own notes on why), so they make a ruler that
  // actually holds still.
  maxAbs: number;
  endLabel?: string; // 阶梯图最后一根的名字：推演未来="情景"，今昔对比="现在"（不传=情景）
  showSteps?: boolean; // 画不画阶梯图（多方案对比的小卡片里不画，卡片保持紧凑）；默认画
}

function Bar({ value, maxAbs }: { value: number; maxAbs: number }) {
  // pct is 0–100, relative to the FULL scale (maxAbs). But this bar is
  // centered at 50% and each side only has 50 percentage-points of visual
  // space to fill (left half for negative, right half for positive) — so
  // the visual fill must be pct/2, not pct. Using pct directly here used
  // to make "left" go negative (or "width" push past 100% on the positive
  // side) for any value past half of maxAbs, which overflow-hidden then
  // silently clipped — visually indistinguishable from being fully maxed
  // out, and further increases in the value made no visible difference.
  const pct = maxAbs > 0 ? Math.min(100, (Math.abs(value) / maxAbs) * 100) : 0;
  const visualPct = pct / 2;
  const positive = value >= 0;
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div
        className={`absolute top-0 h-full rounded-full ${positive ? "bg-emerald-500" : "bg-rose-500"}`}
        style={{ width: `${visualPct}%`, left: positive ? "50%" : `${50 - visualPct}%` }}
      />
      <div className="absolute left-1/2 top-0 h-full w-px bg-slate-600" />
    </div>
  );
}

export default function PnlAttributionPanel({ attribution, maxAbs, endLabel: endLabelProp, showSteps = true }: Props) {
  const { t } = useI18n();
  const { priceEffect, timeEffect, ivEffect, residual, totalChange } = attribution;
  const scale = Math.max(maxAbs, 0.01);
  const endLabel = endLabelProp ?? t("future.wfScen");

  const rows = [
    { icon: TrendingUp, label: t("attribution.price"), value: priceEffect, color: "text-sky-400" },
    { icon: Clock, label: t("attribution.time"), value: timeEffect, color: "text-amber-400" },
    { icon: Activity, label: t("attribution.iv"), value: ivEffect, color: "text-violet-400" },
  ];

  // 三项用平均法拆，分析模式下加起来就等于合计；只有对比模式里展期/平仓/保护/对冲/换合约才会剩下"调整"。
  const showAdjust = Math.abs(residual) >= 0.005;

  return (
    // data-lock-exempt：只读说明，情景滑块锁定左栏时这里的"?"仍可点开（见LockedOverlay）。
    <div data-lock-exempt className="mt-1.5 rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("attribution.title")}</span>
        <Term titleKey="attribution.panelTitle" descKey="attribution.panelExplain" iconTrigger>
          <HelpCircle size={11} />
        </Term>
      </div>

      <div className="space-y-1.5">
        {rows.map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="flex items-center gap-2 text-[10px]">
            <Icon size={11} className={color} />
            <span className="w-14 shrink-0 text-slate-400">{label}</span>
            <div className="flex-1">
              <Bar value={value} maxAbs={scale} />
            </div>
            <span className={`w-16 shrink-0 text-right font-semibold tabular-nums ${value >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {value >= 0 ? "+" : ""}{value.toFixed(2)}
            </span>
          </div>
        ))}
        {showAdjust && (
          <div className="flex items-center gap-2 text-[10px]">
            <Repeat size={11} className="shrink-0 text-amber-300" />
            <span className="flex w-14 shrink-0 items-center gap-1 text-slate-400">
              {t("attribution.adjust")}
              <Term titleKey="attribution.adjustTitle" descKey="attribution.adjustExplain" iconTrigger className="text-slate-500 hover:text-slate-300">
                <HelpCircle size={11} />
              </Term>
            </span>
            <div className="flex-1">
              <Bar value={residual} maxAbs={scale} />
            </div>
            <span className={`w-16 shrink-0 text-right font-semibold tabular-nums ${residual >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {residual >= 0 ? "+" : ""}{residual.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-1.5 text-[10px]">
        <span className="text-slate-500">{t("attribution.total")}</span>
        <span className={`font-bold tabular-nums ${totalChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {totalChange >= 0 ? "+" : ""}{totalChange.toFixed(2)}
        </span>
      </div>
      {/* 同一组数画成阶梯：从开仓的0出发，一项接一项累加到合计。高度固定120px；纵向按柱子缩放，至少是到期最大赚/亏的10%（几分钱不会被放大） */}
      {showSteps && (
        <CanvasBox
        className="mt-2 h-[120px]"
        draw={(g, W, H) =>
          drawWaterfall(
            g, W, H,
            [
              { label: t("attribution.price"), v: priceEffect },
              { label: t("attribution.time"), v: timeEffect },
              { label: t("attribution.iv"), v: ivEffect },
              ...(showAdjust ? [{ label: t("attribution.adjust"), v: residual }] : []),
            ],
            totalChange, t("future.axOpen"), endLabel, scale * 0.1,
          )
        }
        deps={[priceEffect, timeEffect, ivEffect, residual, totalChange, scale, endLabel, t]}
        label={t("attribution.title")}
        />
      )}
      <div className="mt-1 text-[10px] leading-snug text-slate-500">{t("attribution.interactNote")}</div>
    </div>
  );
}