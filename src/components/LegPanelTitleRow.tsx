// src/components/LegPanelTitleRow.tsx
import type { CustomPreset } from "@/lib/customPresets";
import StrategyBadge from "@/components/StrategyBadge";
import { useI18n } from "@/i18n/I18nContext";

// The leg panel's title row — strategy name badge and leg count. Split out
// of App.tsx purely to shrink that file; no behavior change from when this
// lived inline there. The analysis↔compare mode switch controls that used
// to live here (then briefly in AppHeader.tsx) now live in legToolbar
// (App.tsx), rendered inside whichever row that toolbar itself appears in —
// see legToolbar's own comment. The "对比模式" text badge this row used to
// show alongside the leg count was removed per xue's request 2026-09-06,
// along with the isCompareMode prop it was the only reason to accept.
interface Props {
  strategyName: string;
  customPresets: CustomPreset[];
  legsCount: number;
}

export default function LegPanelTitleRow({
  strategyName,
  customPresets,
  legsCount,
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
    </div>
  );
}
