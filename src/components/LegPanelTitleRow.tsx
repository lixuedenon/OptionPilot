// src/components/LegPanelTitleRow.tsx
import type { CustomPreset } from "@/lib/customPresets";
import StrategyBadge from "@/components/StrategyBadge";
import { useI18n } from "@/i18n/I18nContext";

// The leg panel's title row — strategy name badge, leg count, and the
// "对比模式" badge. Split out of App.tsx purely to shrink that file; no
// behavior change from when this lived inline there. The analysis↔compare
// mode switch controls that used to live here moved to AppHeader.tsx (top
// toolbar, between the preset picker and the symbol field) per xue's
// request — this row only reports which mode is active now, it doesn't
// switch it.
interface Props {
  strategyName: string;
  customPresets: CustomPreset[];
  legsCount: number;
  isCompareMode: boolean;
}

export default function LegPanelTitleRow({
  strategyName,
  customPresets,
  legsCount,
  isCompareMode,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="col-start-1 row-start-1 flex min-w-0 shrink-0 items-center gap-2 whitespace-nowrap">
      <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-slate-300">{t("leg.legs")}</span>
      {strategyName && (
        <StrategyBadge name={strategyName} customPresets={customPresets} />
      )}
      <span className="shrink-0 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">
        {legsCount} / 10
      </span>
      {isCompareMode && (
        <span className="rounded bg-sky-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
          {t("leg.compareMode")}
        </span>
      )}
    </div>
  );
}
