// src/components/PnlAttributionPanel.tsx
import { TrendingUp, Clock, Activity, HelpCircle } from "lucide-react";
import type { PnlAttribution } from "@/lib/pricing";
import { useI18n } from "@/i18n/I18nContext";
import Term from "@/components/Term";

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

// Format with an explicit sign, matching the "+"/"-" + 2-decimal convention
// already used for every value rendered in this panel — so the numbers
// quoted inside the residual explanation below read exactly like the ones
// on screen.
function fmtSigned(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}

export default function PnlAttributionPanel({ attribution, maxAbs }: Props) {
  const { t } = useI18n();
  const { priceEffect, timeEffect, ivEffect, residual, totalChange } = attribution;
  const scale = Math.max(maxAbs, 0.01);

  const rows = [
    { icon: TrendingUp, label: t("attribution.price"), value: priceEffect, color: "text-sky-400" },
    { icon: Clock, label: t("attribution.time"), value: timeEffect, color: "text-amber-400" },
    { icon: Activity, label: t("attribution.iv"), value: ivEffect, color: "text-violet-400" },
  ];

  // The residual/"cross term" explanation used to be a static, abstract
  // paragraph (still kept below as attribution.residualHint, now unused —
  // Xue reviews dead i18n keys manually). That abstraction was the
  // complaint: plugging in this combo's actual numbers turns "the three
  // effects don't simply add up" into a worked example the person can
  // check against the numbers already on their screen.
  const sum = priceEffect + timeEffect + ivEffect;
  const residualVars = {
    price: fmtSigned(priceEffect),
    time: fmtSigned(timeEffect),
    iv: fmtSigned(ivEffect),
    sum: fmtSigned(sum),
    total: fmtSigned(totalChange),
    residual: fmtSigned(residual),
  };

  return (
    <div className="mt-1.5 rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
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
        <div className="flex items-center gap-2 text-[10px] opacity-70">
          <Term
            titleKey="attribution.residualTitle"
            descKey="attribution.residualExplain"
            descVars={residualVars}
            iconTrigger
            className="text-slate-500 hover:text-slate-300"
          >
            <HelpCircle size={11} />
          </Term>
          <span className="w-14 shrink-0 text-slate-500">{t("attribution.residual")}</span>
          <div className="flex-1">
            <Bar value={residual} maxAbs={scale} />
          </div>
          <span className={`w-16 shrink-0 text-right font-semibold tabular-nums ${residual >= 0 ? "text-emerald-400/70" : "text-rose-400/70"}`}>
            {residual >= 0 ? "+" : ""}{residual.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-1.5 text-[10px]">
        <span className="text-slate-500">{t("attribution.total")}</span>
        <span className={`font-bold tabular-nums ${totalChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {totalChange >= 0 ? "+" : ""}{totalChange.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
