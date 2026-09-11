// src/components/PositionAdviceDialog.tsx
import { useEffect, useState } from "react";
import { X, Loader2, AlertTriangle } from "lucide-react";
import type { Leg } from "@/lib/types";
import { computePositionSignals, fetchPositionAdvice, type KbRecord, type MatchLevel, type SituationTag } from "@/lib/kbQuery";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  title: string;
  legs: Leg[]; // active legs, current (not opening) state
  spot: number; // current spot
  change: number; // current P&L relative to opening
  breakevens: number[];
  dte: number | null;
  matchedStrategyName: string | null;
  onClose: () => void;
}

// Styled after SituationExplainDialog.tsx's chrome (same backdrop-dismiss +
// X, scrollable body) — but this one is genuinely async (a real network
// round-trip to kb-retrieve, see kbQuery.ts), unlike that dialog's
// synchronous local computation, so it owns loading/error/empty states
// SituationExplainDialog never needed.
const TAG_LABEL_KEY: Record<SituationTag, string> = {
  near_expiry: "advice.tagNearExpiry",
  pin_risk: "advice.tagPinRisk",
  take_profit_target: "advice.tagTakeProfitTarget",
  stop_loss_trigger: "advice.tagStopLossTrigger",
};

export default function PositionAdviceDialog({ title, legs, spot, change, breakevens, dte, matchedStrategyName, onClose }: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<KbRecord[]>([]);
  const [matchLevel, setMatchLevel] = useState<MatchLevel | null>(null);
  const [primaryTag, setPrimaryTag] = useState<SituationTag | null>(null);

  useEffect(() => {
    const signals = computePositionSignals({ legs, spot, change, breakevens, dte });
    setPrimaryTag(signals.primaryTag);
    if (!signals.primaryTag) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPositionAdvice({ matchedStrategyName, legs, spot, tag: signals.primaryTag })
      .then((result) => {
        if (cancelled) return;
        setRecords(result.records);
        setMatchLevel(result.matchLevel);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Intentionally computed once on mount from the props as passed in —
    // this dialog represents a single point-in-time query, not a live
    // subscription that should re-query as the underlying position ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-[640px] max-w-[90vw] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-emerald-400">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={18} />
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-8 text-[12px] text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            {t("advice.loading")}
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-700/40 bg-rose-950/20 px-3 py-2 text-[12px] text-rose-300">
            <AlertTriangle size={14} />
            {t("advice.error")}
          </div>
        )}

        {!loading && !error && !primaryTag && (
          <p className="py-8 text-center text-[12px] text-slate-400">{t("advice.emptyNoSignal")}</p>
        )}

        {!loading && !error && primaryTag && records.length === 0 && (
          <p className="py-8 text-center text-[12px] text-slate-400">{t("advice.emptyNoMatch")}</p>
        )}

        {!loading && !error && primaryTag && records.length > 0 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full border border-sky-700/50 bg-sky-950/30 px-2 py-0.5 font-semibold text-sky-300">
                {t(TAG_LABEL_KEY[primaryTag])}
              </span>
              {matchLevel === "leg_direction" && <span className="text-amber-400">{t("advice.matchLevelLegDirection")}</span>}
              {matchLevel === "tag_only" && <span className="text-amber-400">{t("advice.matchLevelTagOnly")}</span>}
            </div>

            <div className="space-y-3 text-[12px] leading-relaxed text-slate-300">
              {records.map((r) => (
                <div key={r.id} className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-3">
                  <h3 className="mb-1.5 text-[13px] font-bold text-sky-300">{r.label}</h3>
                  <p className="mb-1.5"><span className="font-semibold text-emerald-400">{t("advice.answerLabel")}</span>{r.answer}</p>
                  <p className="mb-1.5 text-slate-400"><span className="font-semibold text-slate-300">{t("advice.reasoningLabel")}</span>{r.reasoning}</p>
                  <p className="text-amber-400/90"><span className="font-semibold text-amber-400">{t("advice.riskLabel")}</span>{r.risk_factors}</p>
                </div>
              ))}
            </div>

            <p className="border-t border-slate-800 pt-3 text-[10.5px] leading-relaxed text-slate-500">
              {t("advice.disclaimer")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
