import { RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  trackedSpot: number;
  correctedSpot: number | null;
  correcting: boolean;
  canCorrect: boolean;
  onClose: () => void;
  onCorrect: () => void;
}

export default function ImpliedSpotInfoPanel({
  trackedSpot,
  correctedSpot,
  correcting,
  canCorrect,
  onClose,
  onCorrect,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-80 rounded-xl border border-sky-500/40 bg-slate-900 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-bold text-sky-300">{t("implied.title")}</span>
          <button onClick={onClose} className="text-slate-500 transition hover:text-slate-300">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="text-[12px] leading-relaxed text-slate-300">
          {t("implied.desc", { spot: trackedSpot.toFixed(2) })}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          {t("implied.example")}
        </p>
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-900/20 px-2.5 py-2">
          <p className="text-[11px] leading-relaxed text-amber-200">
            {t("implied.warning")}
          </p>
        </div>
        {correctedSpot !== null && (
          <p className="mt-2 text-[11px] leading-relaxed text-emerald-300">
            {t("implied.corrected", { spot: correctedSpot.toFixed(2) })}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onCorrect}
            disabled={correcting || !canCorrect}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {correcting ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {correcting ? t("implied.fetching") : t("implied.correct")}
          </button>
        </div>
      </div>
    </div>
  );
}