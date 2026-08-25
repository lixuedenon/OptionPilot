import { useEffect, useRef, useState } from "react";
import { HeartPulse } from "lucide-react";
import type { HealthResult } from "@/lib/positionHealth";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  health: HealthResult;
}

const TIER_COLOR: Record<HealthResult["tier"], string> = {
  healthy: "text-emerald-400",
  watch: "text-amber-400",
  warning: "text-orange-400",
  critical: "text-rose-400",
};

const TIER_DOT: Record<HealthResult["tier"], string> = {
  healthy: "bg-emerald-400",
  watch: "bg-amber-400",
  warning: "bg-orange-400",
  critical: "bg-rose-400",
};

const STATUS_DOT: Record<string, string> = {
  good: "bg-emerald-400",
  warning: "bg-amber-400",
  bad: "bg-rose-400",
};

export default function PositionHealthBadge({ health }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative flex shrink-0 items-center">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded border border-slate-800 bg-slate-900/40 px-2 py-1 transition hover:border-slate-600"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TIER_DOT[health.tier]}`} />
        <HeartPulse size={11} className={TIER_COLOR[health.tier]} />
        <span className="whitespace-nowrap text-[10px] text-slate-500">{t("health.title")}</span>
        <span className={`text-base font-bold tabular-nums leading-none ${TIER_COLOR[health.tier]}`}>{health.score}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-200">{t("health.title")}</span>
            <span className={`text-sm font-bold tabular-nums ${TIER_COLOR[health.tier]}`}>{health.score} / 100</span>
          </div>
          <div className="space-y-1.5">
            {health.factors.map((f, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[f.status]}`} />
                <div className="text-[10px] leading-relaxed">
                  <span className="font-semibold text-slate-300">{f.label}：</span>
                  <span className="text-slate-400">{f.note}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}