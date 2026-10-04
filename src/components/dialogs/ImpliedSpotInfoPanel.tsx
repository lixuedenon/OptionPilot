// src/components/dialogs/ImpliedSpotInfoPanel.tsx
import { useI18n } from "@/i18n/I18nContext";
import { formatDateInput } from "@/lib/dateUtils";

interface Props {
  symbol: string;
  trackedSpot: number;
  // 今日组合权利金和股价是哪个时刻的；null=实时。
  asOf: number | null;
  onClose: () => void;
}

// 今昔对比统计格里股价旁的"i"：说明这个股价从哪来、隐含波动率怎么算。股价跟权利金必须是同一时刻的。
export default function ImpliedSpotInfoPanel({ symbol, trackedSpot, asOf, onClose }: Props) {
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
          {asOf === null
            ? t("implied.descLive", { symbol: symbol.trim().toUpperCase(), spot: trackedSpot.toFixed(2) })
            : t("implied.descAsOf", { date: formatDateInput(asOf), spot: trackedSpot.toFixed(2) })}
        </p>
      </div>
    </div>
  );
}
