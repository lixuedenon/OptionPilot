// src/components/ComboCompareSlots.tsx
// "多方案对比"功能的UI——2026-09-21新增，见useCompareSlots.ts的设计说明。
// 只在分析模式（!isCompareMode）渲染，App.tsx负责这个前提判断，本组件
// 自己不重复判断。
import { useMemo } from "react";
import { Plus, X, Ban, Trash2, Hash, Crosshair, CalendarClock, Save } from "lucide-react";
import type { Leg, Shifts } from "@/lib/types";
import type { CustomPreset } from "@/lib/customPresets";
import { matchStrategy } from "@/lib/matchStrategy";
import { priceCombo, maxProfitLoss, findBreakevens, probabilityOfProfit, attributePnl } from "@/lib/pricing";
import { COMPARE_SLOT_COLORS, MAX_COMPARE_SLOTS, type CompareSlot } from "@/hooks/useCompareSlots";
import type { LegBatchOps } from "@/hooks/useLegBatchOps";
import LegRow from "@/components/LegRow";
import LockedOverlay from "@/components/LockedOverlay";
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
  locked?: boolean; // 跟主combo共用isExploring这套"滑块没归位就锁编辑"的规则
  // 2026-09-22新增：每个候选方案自己的盈亏归因（见下面useComboAttribution
  // 注释）要跟主combo一样跟随情景滑块，所以需要analyticsSpot/
  // analyticsShifts——不能直接复用上面的`spot`，那个是给LegRow/静态统计
  // 表（到期结果类指标，按设计不跟滑块）用的，语义不同，见App.tsx里
  // analyticsSpot/analyticsShifts自己的注释。
  analyticsSpot: number;
  analyticsShifts: Shifts;
  // 2026-09-22新增，"A/B/C完全对等"这轮改动：activeComboIndex跟App.tsx里
  // 那份state同一个编码（0=A主combo，1=第一个对比槽位/B，2=第二个/C），
  // 用来给当前"激活"的槽位画高亮边框；onActivate(i+1)在点击某个槽位容器
  // 时把它设为激活对象（i是slots数组下标，B是0→激活值1，C是1→激活值2）。
  // 同一时刻只有一个combo处于激活状态（跟主combo共用同一个state），激活
  // 状态目前只驱动"策略库"预设应用去哪个combo（见App.tsx的onSelectPreset
  // 分支）和这里的视觉高亮，不影响这个组件自己已有的逐槽位加腿/删腿/复
  // 选等操作。
  activeComboIndex: number;
  onActivate: (comboIndex: number) => void;
  // 2026-09-22新增："批量选择/全选/批量屏蔽/批量删除/统一数量-行权价-到
  // 期日"对B/C同等生效（xue明确要求）——按slots数组的位置对应，
  // slotBatchOps[0]是B，[1]是C，跟useLegBatchOps.ts里App.tsx固定调用两
  // 次的顺序一致。只在对应槽位处于"激活"状态时渲染这套工具栏（跟主combo
  // 一样，同一时刻只操作一个combo），未激活时槽位仍然正常显示腿位，只
  // 是没有批量工具栏/复选框。
  slotBatchOps: LegBatchOps[];
  // 2026-09-22新增：批量工具栏里的"保存策略组合"按钮——不带参数，因为
  // App.tsx已经通过activeComboIndex知道当前点的是哪个槽位，不需要这里
  // 再传slotId。可选是因为这个prop只在xue确认要做这个功能之后才会被
  // App.tsx传入；调用方没传时按钮不渲染。
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

// 2026-09-22新增：每个候选方案（B/C）自己的"情景估值"（每条腿在当前情景
// 滑块位置下的权利金），喂给下面每条LegRow的scenarioPrice prop——之前
// 这里根本没算这份数据，B/C的LegRow收到的scenarioPrice永远是undefined，
// 这条腿旁边的情景估值徽章（LegRow.tsx里`scenarioPrice !== undefined`那
// 段）就一直不出现，xue发现"新的方案没有出现情景估值"就是这个原因。跟
// 主combo的scenarioPriceById（useComboAnalytics.ts）算法完全一致——用
// priceCombo在analyticsSpot/analyticsShifts下重新定价，取每条腿的
// perLeg.shifted，只是换成这个slot自己的legs。
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

// 2026-09-22新增：每个候选方案（B/C）自己的盈亏归因——跟主combo的
// analysisAttribution（useComboAnalytics.ts）完全同一套算法，只是换成这个
// slot自己的legs。xue明确要求"不能放在一起"，所以这里不是共享一份归因、
// 而是每个slot各算各的，各自用自己的active/analyticsSpot/analyticsShifts
// 求值，互不影响。跟analysisAttribution一样，只有情景滑块真的偏离原点时
// 才有意义——静止在(0,0,0)时没有可归因的变化，返回null不渲染。
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

  // 2026-09-24改：根容器原来是px-3（12px）+下面每个方案卡片自己又是
  // p-2（8px）+1px边框，两层padding叠加，腿位行的实际起始缩进比方案A
  // （LegListSection.tsx，只有外层LockedOverlay一层p-2=8px）多出十几像
  // 素——xue反馈B/C两个对比方案的"..."菜单跟原始组合对不齐，根因就是这
  // 层多出来的缩进，不是LegRow.tsx内部列宽的问题（那部分上一轮已经改成
  // 固定宽度，combo内部自己是对齐的）。改法：根容器去掉横向padding，只
  // 留纵向的py-2；标题行/空提示文字各自单独补上px-2（它们不是LegRow，
  // 不需要跟A的缩进对齐，只是要有呼吸空间）；方案卡片自己的p-2保持不
  // 变，这样卡片内LegRow的缩进就变成单一的8px，跟A完全一致。
  return (
    <div className="border-t border-slate-800/60 py-2">
      <div className="mb-1.5 flex items-center justify-between px-2">
        <span className="text-[11px] font-bold text-slate-300">{t("compare.title")}</span>
        <button
          onClick={onAddSlot}
          disabled={locked || slots.length >= MAX_COMPARE_SLOTS}
          title={t("compare.addSlot")}
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
          <LockedOverlay
            key={slot.id}
            locked={locked}
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
                {/* 2026-09-22新增：这份方案自己的"到期盈利+盈亏平衡"——跟
                    主combo（LegListSection.tsx）同一套挪动逻辑，见App.tsx
                    里那处改动的注释和PopBreakevenBadge.tsx。 */}
                {stats && (
                  <PopBreakevenBadge pop={stats.pop} breakevens={stats.breakevens} />
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveSlot(slot.id); }}
                disabled={locked}
                title={t("compare.remove")}
                className="rounded p-0.5 text-slate-600 transition hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={13} />
              </button>
            </div>

            {slot.legs.length === 0 && (
              <p className="mb-1 text-[9px] text-slate-600">{t("compare.emptySlot")}</p>
            )}

            {/* 2026-09-22新增：批量操作工具栏，样式/文案跟LegListSection.tsx
                主combo那份完全一致（复用同一批i18n key，不新造一套文案）
                ——只在这个槽位"激活"且有腿位时渲染，未激活的槽位仍然可以
                正常逐条编辑/删除/屏蔽，只是没有全选/批量/统一这几个动作。 */}
            {/* 2026-09-24改：跟LegListSection.tsx主combo同一份修复——全选
                后这一行装不下会被压成逐字竖排文字，改成flex-wrap兜底+
                下面按钮全部收窄成纯图标+悬浮提示。 */}
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
                    disabled={locked}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  {batch.selectedCount > 0 ? t("leg.selectedCount", { count: batch.selectedCount }) : t("leg.selectAll")}
                </label>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {batch.selectedCount > 0 && (
                    <>
                    <button
                      onClick={(e) => { e.stopPropagation(); batch.bulkToggleDisable(); }}
                      disabled={locked}
                      title={batch.allSelectedDisabled ? t("leg.bulkUnblock") : t("leg.bulkBlock")}
                      className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-amber-400 transition hover:border-amber-500/50 hover:bg-amber-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Ban size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); batch.requestBulkDelete(); }}
                      disabled={locked}
                      title={t("leg.bulkDelete")}
                      className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-rose-400 transition hover:border-rose-500/50 hover:bg-rose-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); batch.unifyQty(); }}
                      disabled={!batch.canUnifyLegs || locked}
                      title={`${t("leg.unifyQty")} · ${t("leg.unifyHint")}`}
                      className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-sky-400 transition hover:border-sky-500/50 hover:bg-sky-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Hash size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); batch.unifyStrike(); }}
                      disabled={!batch.canUnifyLegs || locked}
                      title={`${t("leg.unifyStrike")} · ${t("leg.unifyHint")}`}
                      className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-sky-400 transition hover:border-sky-500/50 hover:bg-sky-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Crosshair size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); batch.unifyDte(); }}
                      disabled={!batch.canUnifyLegs || locked}
                      title={`${t("leg.unifyDte")} · ${t("leg.unifyHint")}`}
                      className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-sky-400 transition hover:border-sky-500/50 hover:bg-sky-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <CalendarClock size={12} />
                    </button>
                    </>
                  )}
                  {/* 2026-09-22新增："保存策略组合"——xue确认"激活哪个容器
                      就保存哪个，都存进同一个策略库"之后加的，位置/样式
                      照搬LegListSection.tsx主combo那颗同名按钮。这个槽位
                      存进去的是一条独立的新SavedStrategy记录（跟主combo
                      共用savedStrategies.ts那份storage，不是单独一套），
                      不要求先"转正"成主combo——onSaveSlot由App.tsx传入，
                      实际写入逻辑见App.tsx里handleSaveStrategyForActive/
                      handleOverwriteStrategyForActive的注释。 */}
                  {onSaveSlot && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onSaveSlot(); }}
                      disabled={locked}
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
                  // 2026-09-22新增：情景估值，见上面useSlotScenarioPriceById
                  // 的注释——之前这里没传这个prop，B/C的腿位旁边永远不会
                  // 出现情景估值徽章。
                  scenarioPrice={slotScenarioPriceById[i].get(leg.id)}
                  onChange={(patch) => onUpdateLeg(slot.id, leg.id, patch)}
                  onToggleDisable={() => onToggleLeg(slot.id, leg.id)}
                  onDelete={() => onDeleteLeg(slot.id, leg.id)}
                  // 对比槽位是临时候选方案，v1不接"添加到预设"这个动作
                  // （那套流程是给主combo的SavePresetDialog设计的，接进来
                  // 要多传一层presetSaveSource变体，v1先跳过——选定某个
                  // 方案后把它的legs整个搬进主combo，就能正常走现有的
                  // "添加到预设"/保存策略）。2026-09-22修复：之前这里传
                  // 的是一个静默no-op（点了没有任何反应），xue审查B/C跟A
                  // 的操作差异时发现——改成不传这个prop，LegRow.tsx现在
                  // 把它当可选prop处理，不传时菜单项直接不出现，跟
                  // onRoll/onHedge/onProtect/onCompare这几个B/C同样未接
                  // 的动作保持一致的"不适用就不显示"处理方式。
                  // 2026-09-22：复选框只在这个槽位被激活时显示——未激活时
                  // 不该让人以为可以勾选一个当前操作不了的组合。
                  selectable={isActive}
                  selected={batch?.selectedLegIds.has(leg.id) ?? false}
                  onToggleSelect={() => batch?.toggleLegSelection(leg.id)}
                />
              ))}
            </div>

            {/* 2026-09-22移除：这里原来有一个槽位自己的"+添加腿位"按钮——
                xue指出顶部工具栏那个"+"（legToolbar，App.tsx的
                handleToolbarAddLeg）本来就已经会加到当前激活的容器，激活
                某个B/C槽位后再点顶部"+"效果完全一样，这颗按钮是纯冗余，
                直接删掉，不额外保留禁用态或其它形式。 */}

            {/* 2026-09-22新增：这份方案自己的盈亏归因，画在它自己的卡片
                里面——不是共享面板，也不进下面的对比表，跟xue的要求一致
                ("盈亏归因是要单独在每个组合组里边体现的，不能放在一起")。
                gate在slotAttributions[i]非null上，即情景滑块已偏离原点且
                这个slot有活跃腿位时才渲染，跟主combo的
                analysisAttribution显示逻辑一致。 */}
            {slotAttributions[i] && (
              <PnlAttributionPanel
                attribution={slotAttributions[i]!}
                maxAbs={Math.max(Math.abs(stats?.maxProfit ?? 0), Math.abs(stats?.maxLoss ?? 0), 0.01)}
              />
            )}
          </LockedOverlay>
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