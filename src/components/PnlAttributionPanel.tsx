import { TrendingUp, Clock, Activity, HelpCircle } from "lucide-react";
import type { PnlAttribution } from "@/lib/pricing";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  attribution: PnlAttribution;
}

function Bar({ value, maxAbs }: { value: number; maxAbs: number }) {
  const pct = maxAbs > 0 ? Math.min(100, (Math.abs(value) / maxAbs) * 100) : 0;
  const positive = value >= 0;
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div
        className={`absolute top-0 h-full rounded-full ${positive ? "bg-emerald-500" : "bg-rose-500"}`}
        style={{ width: `${pct}%`, left: positive ? "50%" : `${50 - pct}%` }}
      />
      <div className="absolute left-1/2 top-0 h-full w-px bg-slate-600" />
    </div>
  );
}

export default function PnlAttributionPanel({ attribution }: Props) {
  const { t } = useI18n();
  const { priceEffect, timeEffect, ivEffect, residual, totalChange } = attribution;
  const maxAbs = Math.max(Math.abs(priceEffect), Math.abs(timeEffect), Math.abs(ivEffect), Math.abs(residual), 0.01);

  const rows = [
    { icon: TrendingUp, label: t("attribution.price"), value: priceEffect, color: "text-sky-400" },
    { icon: Clock, label: t("attribution.time"), value: timeEffect, color: "text-amber-400" },
    { icon: Activity, label: t("attribution.iv"), value: ivEffect, color: "text-violet-400" },
  ];

  return (
    <div className="mt-1.5 rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("attribution.title")}</span>
        <span
          title={t("attribution.residualHint")}
          className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-slate-600 hover:text-slate-400"
        >
          <HelpCircle size={11} />
        </span>
      </div>

      <div className="space-y-1.5">
        {rows.map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="flex items-center gap-2 text-[10px]">
            <Icon size={11} className={color} />
            <span className="w-14 shrink-0 text-slate-400">{label}</span>
            <div className="flex-1">
              <Bar value={value} maxAbs={maxAbs} />
            </div>
            <span className={`w-16 shrink-0 text-right font-semibold tabular-nums ${value >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {value >= 0 ? "+" : ""}{value.toFixed(2)}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2 text-[10px] opacity-70">
          <HelpCircle size={11} className="text-slate-500" />
          <span className="w-14 shrink-0 text-slate-500">{t("attribution.residual")}</span>
          <div className="flex-1">
            <Bar value={residual} maxAbs={maxAbs} />
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