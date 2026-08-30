import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";
import type { MarginCheckResult } from "@/lib/simAccount";

interface Props {
  detail: MarginCheckResult;
  onClose: () => void;
}

// Shown when openSimPosition rejects a position for lack of margin. The
// three headline numbers (needed / available / short by) plus the itemized
// per-leg breakdown are both necessary — the breakdown is what lets a
// beginner actually understand WHY a combo costs what it costs (e.g. "this
// $50,000 is because the short put is cash-secured, not because something's
// broken"), not just that it costs too much. See margin.ts's own notes on
// why cash-secured-put is the default and why calendars/diagonals fall back
// to the naked formula — those choices are exactly the kind of thing that
// looks like a bug until you see the breakdown.
export default function MarginErrorDialog({ detail, onClose }: Props) {
  const { t } = useI18n();
  const items = detail.breakdown.filter((n) => n.amount !== 0 || n.kind !== "iron-condor");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-96 max-w-[92vw] rounded-xl border border-rose-500/30 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={18} className="text-rose-400" />
          <h3 className="text-sm font-bold text-rose-200">{t("margin.insufficientTitle")}</h3>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 text-center">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-slate-500">{t("margin.required")}</div>
            <div className="text-[13px] font-bold tabular-nums text-slate-200">${detail.required.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-slate-500">{t("margin.available")}</div>
            <div className="text-[13px] font-bold tabular-nums text-sky-300">${detail.available.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-slate-500">{t("margin.shortBy")}</div>
            <div className="text-[13px] font-bold tabular-nums text-rose-400">${detail.shortfall.toFixed(2)}</div>
          </div>
        </div>

        {items.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("margin.breakdown")}
            </div>
            <div className="space-y-1 rounded-lg border border-slate-800 bg-slate-950/20 p-2">
              {items.map((n, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-400">{n.label}</span>
                  <span className={`shrink-0 font-semibold tabular-nums ${n.amount < 0 ? "text-emerald-400" : "text-slate-200"}`}>
                    {n.amount < 0 ? "−$" + Math.abs(n.amount).toFixed(2) : "$" + n.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mb-4 text-[11px] leading-relaxed text-slate-500">
          {t("margin.explainerNote")}
        </p>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md bg-slate-700 px-4 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-600"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
