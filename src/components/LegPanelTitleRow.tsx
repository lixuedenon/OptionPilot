// src/components/LegPanelTitleRow.tsx
// 2026-09-22：策略名称徽章（<StrategyBadge>）搬到LegListSection.tsx的"全选"
// 行旁边了（xue的要求，见那个文件顶部对应注释）——这个组件现在只剩"期权
// 腿位"标题文字+腿数，strategyName/customPresets两个prop也一并从这里删
// 除。没有直接删掉整个组件、改成内联写在App.tsx里，是因为它仍然承担"标题
// 行"这个独立的grid定位单元（col-start-1 row-start-1），保留一个专门组件
// 维持这层意图更清楚。
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  legsCount: number;
}

export default function LegPanelTitleRow({ legsCount }: Props) {
  const { t } = useI18n();
  return (
    <div className="col-start-1 row-start-1 flex min-w-0 shrink-0 items-center gap-2 whitespace-nowrap">
      <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-slate-300">{t("leg.legs")}</span>
      <span className="shrink-0 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">
        {legsCount} / 10
      </span>
    </div>
  );
}