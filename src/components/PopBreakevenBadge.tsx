// src/components/PopBreakevenBadge.tsx
// 2026-09-22新增：把"到期盈利概率+盈亏平衡"这个小readout独立成一个组件，
// 只有一个原始方案(A)时渲染在顶部（App.tsx原有位置不变），一旦出现B/C
// 对比方案时，改成挪到每个方案自己的"全选+策略徽章"那一行旁边（各方案
// 各显示各自的），不再在顶部单独显示——xue的原话是"移动"不是"多显示一
// 份"。抽成组件是因为同一段JSX现在有三处调用（A在LegListSection.tsx里、
// B/C在ComboCompareSlots.tsx里），复制三份容易改一处忘一处。
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  pop: number;
  breakevens: number[];
}

export default function PopBreakevenBadge({ pop, breakevens }: Props) {
  const { t } = useI18n();
  if (pop <= 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex items-baseline gap-1">
        <span className="whitespace-nowrap text-[10px] text-slate-500">{t("leg.pop")}</span>
        <span className={`text-xs font-bold tabular-nums leading-none ${
          pop >= 0.55 ? "text-emerald-400" : pop >= 0.45 ? "text-amber-400" : "text-rose-400"
        }`}>{(pop * 100).toFixed(0)}%</span>
      </div>
      {breakevens.length > 0 && (
        <div className="flex items-baseline gap-1">
          <span className="whitespace-nowrap text-[10px] text-slate-500">{t("leg.breakeven")}</span>
          <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-sky-300">
            {breakevens.map((be) => be.toFixed(2)).join(" / ")}
          </span>
        </div>
      )}
    </div>
  );
}
