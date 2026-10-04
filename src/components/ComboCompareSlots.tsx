// src/components/ComboCompareSlots.tsx
// "多方案对比"（方案B/C）的UI，只在分析模式渲染（由App.tsx判断）。
import { useMemo } from "react";
import { Plus, X, Ban, Trash2, Hash, Crosshair, CalendarClock, Save } from "lucide-react";
import type { Leg, Shifts } from "@/lib/types";
import type { CustomPreset } from "@/lib/customPresets";
import { matchStrategy } from "@/lib/matchStrategy";
import { priceCombo, maxProfitLoss, findBreakevens, probabilityOfProfit, attributePnl } from "@/lib/pricing";
import { COMPARE_SLOT_COLORS, MAX_COMPARE_SLOTS, type CompareSlot } from "@/hooks/useCompareSlots";
import type { LegBatchOps } from "@/hooks/useLegBatchOps";
import LegRow from "@/components/LegRow";
import PnlAttributionPanel from "@/components/PnlAttributionPanel";
import StrategyBadge from "@/components/StrategyBadge";
import PopBreakevenBadge from "@/components/PopBreakevenBadge";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  spot: number;
  symbol: string;
  customPresets: CustomPreset[];
  mainLegs: Leg[]; // 方案A，即App.tsx的`legs`
  slots: CompareSlot[];
  locked?: boolean; // 滑块离开原点时为true，只透传给LegRow暂停自动拉价；界面锁定由App.tsx的LockedOverlay统一负责
  // 每个方案的盈亏归因要跟随情景滑块，所以用analyticsSpot/analyticsShifts（spot是给到期结果类指标用的，不跟滑块）。
  analyticsSpot: number;
  analyticsShifts: Shifts;
  // 当前激活的combo（0=A，1=B，2=C），用于高亮；点击槽位容器调用onActivate(i+1)。
  activeComboIndex: number;
  onActivate: (comboIndex: number) => void;
  // B/C的批量操作（slotBatchOps[0]=B，[1]=C），只在该槽位激活时显示工具栏和复选框。
  slotBatchOps: LegBatchOps[];
  // 批量工具栏里的"保存策略组合"，App.tsx通过activeComboIndex知道是哪个槽位；不传时不显示。
  onSaveSlot?: () => void;
  onAddSlot: () => void;
  onRemoveSlot: (slotId: string) => void;
  onUpdateLeg: (slotId: string, legId: string, patch: Partial<Leg>) => void;
  onDeleteLeg: (slotId: string, legId: string) => void;
  onToggleLeg: (slotId: string, legId: string) => void;
}

// A/B/C三份候选combo共用的统计口径：净开仓成本 + 最大盈亏 + 盈亏平衡 +
// 到期盈利概率——全部是"到期结果"类指标（不跟随情景滑块，零位移求值），
// 跟CLAUDE.md"五、核心设计原则1"一致，也是maxProfitLoss/findBreakevens/
// probabilityOfProfit这几个既有函数本来的设计用途，不新造计算逻辑。
function useComboStats(legs: Leg[], spot: number, customPresets: CustomPreset[]) {
  return useMemo(() => {
    const active = legs.filter((l) => !l.disabled);
    if (active.length === 0 || spot <= 0) return null;
    const label = matchStrategy(active, spot, customPresets);
    const cost = priceCombo(active, { dS: 0, dT: 0, dV: 0 }, spot).netPremium;
    const { maxProfit, maxLoss } = maxProfitLoss(active, spot);
    const breakevens = findBreakevens(active, spot);
    const { pop } = probabilityOfProfit(active, spot);
    return { label, cost, maxProfit, maxLoss, breakevens, pop };
  }, [legs, spot, customPresets]);
}

// 每个方案自己的情景估值（跟主combo的scenarioPriceById同一算法，换成该槽位的legs）。
function useSlotScenarioPriceById(legs: Leg[], analyticsSpot: number, analyticsShifts: Shifts) {
  return useMemo(() => {
    const active = legs.filter((l) => !l.disabled);
    const m = new Map<string, number>();
    if (active.length === 0 || analyticsSpot <= 0) return m;
    const result = priceCombo(active, analyticsShifts, analyticsSpot);
    for (const pl of result.perLeg) m.set(pl.leg.id, pl.shifted);
    return m;
  }, [legs, analyticsSpot, analyticsShifts]);
}

// 每个方案自己的盈亏归因（跟主combo的analysisAttribution同一算法），各算各的，不合并（xue的要求）。
// 滑块在原点时没有可归因的变化，返回null。
function useComboAttribution(legs: Leg[], analyticsSpot: number, analyticsShifts: Shifts) {
  return useMemo(() => {
    const active = legs.filter((l) => !l.disabled);
    if (active.length === 0 || analyticsSpot <= 0) return null;
    if (analyticsShifts.dS === 0 && analyticsShifts.dT === 0 && analyticsShifts.dV === 0) return null;
    const { change } = priceCombo(active, analyticsShifts, analyticsSpot);
    return attributePnl(active, analyticsSpot, analyticsShifts.dS, analyticsShifts.dT, analyticsShifts.dV, change);
  }, [legs, analyticsSpot, analyticsShifts]);
}

export default function ComboCompareSlots({ spot, symbol, customPresets, mainLegs, slots, locked, analyticsSpot, analyticsShifts, activeComboIndex, onActivate, slotBatchOps, onSaveSlot, onAddSlot, onRemoveSlot, onUpdateLeg, onDeleteLeg, onToggleLeg }: Props) {
  const { t } = useI18n();
  const slotLabels = [t("compare.slotB"), t("compare.slotC")];

  const statsA = useComboStats(mainLegs, spot, customPresets);
  // Hooks can't be called inside .map with a variable count, so the two
  // (MAX_COMPARE_SLOTS) possible slot stats are computed with fixed calls
  // and then filtered against however many slots actually exist below.
  const statsSlot0 = useComboStats(slots[0]?.legs ?? [], spot, customPresets);
  const statsSlot1 = useComboStats(slots[1]?.legs ?? [], spot, customPresets);
  const slotStats = [statsSlot0, statsSlot1];

  // 同样的"固定调用数量"限制，归因也是两份固定hook调用，见上面slotStats
  // 的注释。maxAbs复用各自slot自己的maxProfit/maxLoss（跟主combo
  // attributionMaxAbs同一个算法，见PnlAttributionPanel.tsx对这个参数的
  // 注释——需要一把不随滑块移动的固定尺子）。
  const attrSlot0 = useComboAttribution(slots[0]?.legs ?? [], analyticsSpot, analyticsShifts);
  const attrSlot1 = useComboAttribution(slots[1]?.legs ?? [], analyticsSpot, analyticsShifts);
  const slotAttributions = [attrSlot0, attrSlot1];

  // 同样的"固定调用数量"限制，情景估值也是两份固定hook调用，见上面
  // slotStats的注释。
  const scenarioSlot0 = useSlotScenarioPriceById(slots[0]?.legs ?? [], analyticsSpot, analyticsShifts);
  const scenarioSlot1 = useSlotScenarioPriceById(slots[1]?.legs ?? [], analyticsSpot, analyticsShifts);
  const slotScenarioPriceById = [scenarioSlot0, scenarioSlot1];

  // 根容器不加横向padding，保证卡片内LegRow的缩进跟方案A一致（"..."菜单对齐）；标题行/提示文字自己加px-2。
  return (
    <div className="border-t border-slate-800/60 py-2">
      <div className="mb-1.5 flex items-center justify-between px-2">
        <span className="text-[11px] font-bold text-slate-300">{t("compare.title")}</span>
        <button
          onClick={onAddSlot}
          // 方案A还没有腿位时不能新建对比方案（B/C是用来跟A对比的）。
          disabled={slots.length >= MAX_COMPARE_SLOTS || mainLegs.length === 0}
          title={mainLegs.length === 0 ? t("compare.addSlotNeedsMainLegs") : t("compare.addSlot")}
          className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] font-semibold text-sky-400 transition hover:border-sky-500/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={11} />
          {t("compare.addSlot")}
        </button>
      </div>

      {slots.length === 0 && (
        <p className="px-2 text-[10px] text-slate-600">{t("compare.hint")}</p>
      )}

      {slots.map((slot, i) => {
        const color = COMPARE_SLOT_COLORS[i];
        const label = slotLabels[i];
        const stats = slotStats[i];
        const comboIndex = i + 1; // B=1, C=2 — see App.tsx's activeComboIndex
        const isActive = activeComboIndex === comboIndex;
        const batch = slotBatchOps[i];
        return (
          <div
            key={slot.id}
            onClick={() => onActivate(comboIndex)}
            className={`mb-2 cursor-pointer rounded border p-2 transition ${
              isActive ? "border-sky-500/70 bg-slate-900/60 ring-1 ring-sky-500/40" : "border-slate-800 bg-slate-900/40"
            }`}
          >
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[10px] font-bold" style={{ color }}>{label}</span>
                {stats?.label && (
                  <StrategyBadge name={stats.label} customPresets={customPresets} />
                )}
                {/* 这个方案自己的到期盈利+盈亏平衡 */}
                {stats && (
                  <PopBreakevenBadge pop={stats.pop} breakevens={stats.breakevens} />
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveSlot(slot.id); }}
                title={t("compare.remove")}
                className="rounded p-0.5 text-slate-600 transition hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={13} />
              </button>
            </div>

            {slot.legs.length === 0 && (
              <p className="mb-1 text-[9px] text-slate-600">{t("compare.emptySlot")}</p>
            )}

            {/* 批量操作工具栏（跟主combo同一套样式和文案），只在该槽位激活且有腿位时显示 */}
            {/* 放不下就换行；按钮纯图标 */}
            {isActive && batch && slot.legs.length > 0 && (
              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-slate-800 bg-slate-900/40 px-2 py-1">
                <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={batch.selectedCount > 0 && batch.selectedCount === slot.legs.length}
                    ref={(el) => {
                      if (el) el.indeterminate = batch.selectedCount > 0 && batch.selectedCount < slot.legs.length;
                    }}
                    onChange={(e) => {
                      e.stopPropagation();
                      if (batch.selectedCount === slot.legs.length) batch.clearLegSelection();
                      else batch.selectAllLegs();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  {batch.selectedCount > 0 ? t("leg.selectedCount", { count: batch.selectedCount }) : t("leg.selectAll")}
                </label>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {batch.selectedCount > 0 && (
                    <>
                    <button
                      onClick={(e) => { e.stopPropagation(); batch.bulkToggleDisable(); }}
                      title={batch.allSelectedDisabled ? t("leg.bulkUnblock") : t("leg.bulkBlock")}
                      className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-amber-400 transition hover:border-amber-500/50 hover:bg-amber-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Ban size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); batch.requestBulkDelete(); }}
                      title={t("leg.bulkDelete")}
                      className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-rose-400 transition hover:border-rose-500/50 hover:bg-rose-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); batch.unifyQty(); }}
                      disabled={!batch.canUnifyLegs}
                      title={`${t("leg.unifyQty")} · ${t("leg.unifyHint")}`}
                      className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-sky-400 transition hover:border-sky-500/50 hover:bg-sky-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Hash size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); batch.unifyStrike(); }}
                      disabled={!batch.canUnifyLegs}
                      title={`${t("leg.unifyStrike")} · ${t("leg.unifyHint")}`}
                      className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-sky-400 transition hover:border-sky-500/50 hover:bg-sky-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Crosshair size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); batch.unifyDte(); }}
                      disabled={!batch.canUnifyLegs}
                      title={`${t("leg.unifyDte")} · ${t("leg.unifyHint")}`}
                      className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-sky-400 transition hover:border-sky-500/50 hover:bg-sky-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <CalendarClock size={12} />
                    </button>
                    </>
                  )}
                  {/* 保存这个方案为一条新策略（跟主combo共用同一个策略库），写入逻辑见App.tsx的handleSaveStrategyForActive */}
                  {onSaveSlot && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onSaveSlot(); }}
                      title={t("toolbar.saveStrategy")}
                      className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-emerald-400 transition hover:border-emerald-500/50 hover:bg-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Save size={11} />
                      {t("toolbar.saveStrategy")}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              {slot.legs.map((leg, idx) => (
                <LegRow
                  key={leg.id}
                  leg={leg}
                  index={idx}
                  symbol={symbol}
                  spot={spot}
                  locked={locked}
                  scenarioPrice={slotScenarioPriceById[i].get(leg.id)}
                  onChange={(patch) => onUpdateLeg(slot.id, leg.id, patch)}
                  onToggleDisable={() => onToggleLeg(slot.id, leg.id)}
                  onDelete={() => onDeleteLeg(slot.id, leg.id)}
                  // B/C不接"添加到预设"（不传，菜单项就不显示）；复选框只在该槽位激活时显示。
                  selectable={isActive}
                  selected={batch?.selectedLegIds.has(leg.id) ?? false}
                  onToggleSelect={() => batch?.toggleLegSelection(leg.id)}
                />
              ))}
            </div>


            {/* 这个方案自己的盈亏归因，显示在它自己的卡片里（不合并） */}
            {slotAttributions[i] && (
              <PnlAttributionPanel
                attribution={slotAttributions[i]!}
                maxAbs={Math.max(Math.abs(stats?.maxProfit ?? 0), Math.abs(stats?.maxLoss ?? 0), 0.01)}
                showSteps={false}
              />
            )}
          </div>
        );
      })}

      {slots.length > 0 && (
        <table className="mt-1 w-full text-[10px]">
          <thead>
            <tr className="text-slate-500">
              <th className="pb-1 text-left font-normal"> </th>
              <th className="pb-1 text-right font-normal text-emerald-400">{t("compare.slotA")}</th>
              {slots.map((_, i) => (
                <th key={i} className="pb-1 text-right font-normal" style={{ color: COMPARE_SLOT_COLORS[i] }}>{slotLabels[i]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-800/60">
              <td className="py-1 pr-2 text-slate-500">{t("compare.table.cost")}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-slate-200">{statsA ? `$${Math.abs(statsA.cost).toFixed(2)}` : "—"}</td>
              {slots.map((_, i) => (
                <td key={i} className="py-1 pr-2 text-right tabular-nums text-slate-200">{slotStats[i] ? `$${Math.abs(slotStats[i]!.cost).toFixed(2)}` : "—"}</td>
              ))}
            </tr>
            <tr className="border-t border-slate-800/60">
              <td className="py-1 pr-2 text-slate-500">{t("scenario.maxProfit")}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-emerald-400">{statsA ? `$${statsA.maxProfit.toFixed(2)}` : "—"}</td>
              {slots.map((_, i) => (
                <td key={i} className="py-1 pr-2 text-right tabular-nums text-emerald-400">{slotStats[i] ? `$${slotStats[i]!.maxProfit.toFixed(2)}` : "—"}</td>
              ))}
            </tr>
            <tr className="border-t border-slate-800/60">
              <td className="py-1 pr-2 text-slate-500">{t("scenario.maxLoss")}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-rose-400">{statsA ? `$${statsA.maxLoss.toFixed(2)}` : "—"}</td>
              {slots.map((_, i) => (
                <td key={i} className="py-1 pr-2 text-right tabular-nums text-rose-400">{slotStats[i] ? `$${slotStats[i]!.maxLoss.toFixed(2)}` : "—"}</td>
              ))}
            </tr>
            <tr className="border-t border-slate-800/60">
              <td className="py-1 pr-2 text-slate-500">{t("leg.breakeven")}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-sky-300">{statsA && statsA.breakevens.length > 0 ? statsA.breakevens.map((b) => b.toFixed(2)).join(" / ") : "—"}</td>
              {slots.map((_, i) => (
                <td key={i} className="py-1 pr-2 text-right tabular-nums text-sky-300">{slotStats[i] && slotStats[i]!.breakevens.length > 0 ? slotStats[i]!.breakevens.map((b) => b.toFixed(2)).join(" / ") : "—"}</td>
              ))}
            </tr>
            <tr className="border-t border-slate-800/60">
              <td className="py-1 pr-2 text-slate-500">{t("leg.pop")}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-slate-200">{statsA ? `${(statsA.pop * 100).toFixed(0)}%` : "—"}</td>
              {slots.map((_, i) => (
                <td key={i} className="py-1 pr-2 text-right tabular-nums text-slate-200">{slotStats[i] ? `${(slotStats[i]!.pop * 100).toFixed(0)}%` : "—"}</td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}