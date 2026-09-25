// src/components/LegListSection.tsx
import { Clock, Ban, Trash2, Plus, Save, Hash, Crosshair, CalendarClock, Pencil, RotateCcw, AlertTriangle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { Leg } from "@/lib/types";
import type { SavedStrategy } from "@/lib/savedStrategies";
import type { CustomPreset } from "@/lib/customPresets";
import { formatDateInput, parseDateInput } from "@/lib/dateUtils";
import { explainLegRoles } from "@/lib/legRoles";
import { computeLegLinks } from "@/lib/legLinks";
import LegRow from "@/components/LegRow";
import LockedOverlay from "@/components/LockedOverlay";
import StrategyBadge from "@/components/StrategyBadge";
import PopBreakevenBadge from "@/components/PopBreakevenBadge";
import { useI18n } from "@/i18n/I18nContext";

// This is the App.tsx split's second step (see the AppHeader extraction
// for the first) — same pure-JSX, no-state-moves pattern. The prop list
// is longer than the header's was: this section reads/writes individual
// legs, drives bulk selection, and (in compare mode) renders a live
// opening-vs-current stats block, so it genuinely touches more of
// App.tsx's state than the header did. That's the real, unavoidable cost
// of this step — more surface area to keep correct when wiring up the
// call site, not a sign the extraction itself is riskier in kind.
interface Props {
  isCompareMode: boolean;
  // 2026-09-22新增：策略名称徽章，从LegPanelTitleRow.tsx搬过来——xue的要
  // 求是紧挨着"全选"复选框显示，而不是顶部标题行。strategyName为空字符
  // 串时（还没识别出策略）不渲染，跟原来在LegPanelTitleRow.tsx里的判断
  // 条件一致。
  strategyName: string;
  customPresets: CustomPreset[];
  // 2026-09-22新增：只在存在B/C对比方案时非null——App.tsx这时把原来顶
  // 部单独显示的"到期盈利+盈亏平衡"readout挪到这里，紧挨着策略徽章，
  // 见App.tsx里那处改动的注释和PopBreakevenBadge.tsx。只有一个方案A
  // 时传null，这里不渲染，App.tsx顶部保持原样，不重复显示两份。
  inlinePopBreakeven: { pop: number; breakevens: number[] } | null;
  // ⚠️ 2026-09-14: trackedStrategy/activeSnapshotId/onUpdateSnapshotTime当
  // 前在这个组件里未被使用了——它们以前驱动的是"开仓组合"标题栏那个日期
  // 字段，但那个字段实际改的是"当前选中快照的保存时间"，跟"开仓组合"这个
  // 标题本身是错位的（真正的bug，见CLAUDE.md）。修复后这个字段改回严格显示
  // /模拟openingAt本身，不再碰快照时间，所以这三个prop在这个组件里空转。
  // "编辑某条快照自己的保存时间"是一个独立、之前确实在用的能力，只是长错
  // 了位置——没有删掉这几个prop/App.tsx里的handleUpdateSnapshotTime，是为了
  // 不在没跟xue确认前就丢掉这个能力；如果还需要，更合适的新家是
  // TrackedComboSection.tsx的快照选择器那一块。
  trackedStrategy: SavedStrategy | undefined;
  activeSnapshotId: string | null;
  onUpdateSnapshotTime: (snapshotId: string, savedAt: number) => void;
  legToolbar: ReactNode;

  spot: number;
  openingAt: number;
  // 对比模式"开仓组合"标题栏日期字段的临时模拟值——见App.tsx里
  // openingAtSimOverride状态的注释。null=未在模拟，显示真实openingAt；
  // 非null=用户刚确认要预览的假设日期，只影响这个字段自己的显示，不
  // 持久化、不重算legs/定价。
  openingAtSimOverride: number | null;
  onSetOpeningAtSimOverride: (ts: number | null) => void;
  activeLegs: Leg[];

  legs: Leg[];
  selectedCount: number;
  selectedLegIds: Set<string>;
  onClearLegSelection: () => void;
  onSelectAllLegs: () => void;
  // 2026-09-24：这个prop不再用来决定"保存策略组合"按钮是否可点——见下面
  // 按钮定义处的注释。App.tsx里`canSaveStrategy`这同一个值还在给
  // AppHeader.tsx用来判断"有没有未保存的改动，离开前要不要弹确认"，那
  // 是完全独立、依然成立的用途，这个prop本身留着不删（调用方App.tsx也
  // 还在传），只是这个组件自己不再用它来禁用按钮。
  canSaveStrategy: boolean;
  onSaveStrategy: () => void;
  allSelectedDisabled: boolean;
  onBulkToggleDisable: () => void;
  onRequestBulkDelete: () => void;
  // "统一数量/行权价/到期日" — syncs the rest of the selected legs to the
  // first selected leg's value (option legs only; see useLegEditing.ts).
  // canUnifyLegs is false whenever fewer than two selected legs are
  // eligible, which disables all three buttons at once rather than each
  // silently no-op'ing on click.
  canUnifyLegs: boolean;
  onUnifyQty: () => void;
  onUnifyStrike: () => void;
  onUnifyDte: () => void;

  scenarioPriceById: Map<string, number>;
  symbol: string;
  onChangeLeg: (id: string, patch: Partial<Leg>) => void;
  onToggleLeg: (id: string) => void;
  onDeleteLeg: (id: string) => void;
  onAddToPreset: () => void;
  onRoll: (id: string) => void;
  onHedge: () => void;
  onProtect: (id: string) => void;
  onCompare: (id: string) => void;
  onMoveLeg: (index: number, direction: -1 | 1) => void;
  onToggleLegSelection: (id: string) => void;

  simOrigin?: boolean;
  onConfirmSimOpen?: (payload: { symbol: string; legs: Leg[]; spot: number; openingAt: number }) => void;

  // 2026-09-17新增：分析模式情景滑块离开(0,0,0)时由App.tsx算出的
  // isExploring，锁定全选/批量操作/保存策略组合/确认开仓，并透传给每个
  // LegRow锁定单腿字段——直到用户点击"重置"。
  locked?: boolean;
  // 2026-09-17新增：这条策略的真实到期日已经过去（App.tsx的
  // isExpiredReal，两种模式通用）。对比模式下这个列表本来就靠
  // hidePriceRefresh整体挡住市场价刷新（历史快照，见下面那行注释），真
  // 正需要这个新prop生效的是分析模式（isCompareMode=false）——之前分析
  // 模式下"打开策略"遇到过期策略只弹了ExpiredStrategyDialog，选"保留"之
  // 后这个列表本身的"恢复市场价"按钮完全没被挡住，点了会静默把这条腿换
  // 成今天附近别的合约再定价，见LegRow.tsx的expired prop注释。
  contractsExpired?: boolean;
}

export default function LegListSection({
  isCompareMode,
  strategyName,
  customPresets,
  inlinePopBreakeven,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept unused on purpose, see the Props interface comment just above
  trackedStrategy,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept unused on purpose, see the Props interface comment just above
  activeSnapshotId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept unused on purpose, see the Props interface comment just above
  onUpdateSnapshotTime,
  legToolbar,
  spot,
  openingAt,
  openingAtSimOverride,
  onSetOpeningAtSimOverride,
  activeLegs,
  legs,
  selectedCount,
  selectedLegIds,
  onClearLegSelection,
  onSelectAllLegs,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept unused on purpose, see the Props interface comment just above
  canSaveStrategy,
  onSaveStrategy,
  allSelectedDisabled,
  onBulkToggleDisable,
  onRequestBulkDelete,
  canUnifyLegs,
  onUnifyQty,
  onUnifyStrike,
  onUnifyDte,
  scenarioPriceById,
  symbol,
  onChangeLeg,
  onToggleLeg,
  onDeleteLeg,
  onAddToPreset,
  onRoll,
  onHedge,
  onProtect,
  onCompare,
  onMoveLeg,
  onToggleLegSelection,
  simOrigin,
  onConfirmSimOpen,
  locked = false,
  contractsExpired = false,
}: Props) {
  const { t, lang } = useI18n();
  // Computed once per render off the whole active leg list (roles like
  // "anchor"/"protective" only make sense relative to each other — a
  // single leg can't be classified in isolation), then looked up per row
  // below. Disabled legs get no entry (legRoles.ts only classifies active
  // ones), so their menu simply won't show the item.
  const legRolesById = useMemo(() => {
    const map = new Map<string, { label: string; explanation: string }>();
    for (const r of explainLegRoles(activeLegs)) map.set(r.legId, { label: r.label, explanation: r.explanation });
    return map;
  }, [activeLegs]);

  // Roll/Protect pairing badges (see lib/legLinks.ts) — computed off the
  // full opening-combo leg list, same scope as legRolesById above.
  const legLinksById = useMemo(() => computeLegLinks(legs), [legs]);

  // "开仓组合"标题栏日期字段：2026-09-14重做（CLAUDE.md六、24/相关bug）。
  // 以前这里显示的其实是`activeSnap?.savedAt`（快照保存时间），不是真正
  // 的开仓日期——跟"开仓组合"这个标题本身就是错位的，而且`onChange`改的
  // 也是快照时间，不是openingAt。现在固定显示/只涉及openingAt（或它的
  // 临时模拟值），彻底跟快照时间分开。默认只读；点击铅笔图标后先看到一句
  // 警告+日期框，需要显式点"预览"确认才会真正生效——生效的也只是本地、
  // 不持久化的模拟值（openingAtSimOverride），不是真的修改openingAt，见
  // App.tsx对应状态的注释。
  const [editingOpeningDate, setEditingOpeningDate] = useState(false);
  const [openingDateDraft, setOpeningDateDraft] = useState("");
  const effectiveOpeningAt = openingAtSimOverride ?? openingAt;

  return (
    <>
      <LockedOverlay locked={locked} className="p-2 space-y-1">
        {isCompareMode && (
          <div className="flex flex-wrap items-center gap-2 bg-slate-900/40 py-1 rounded px-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400">{t("compare.openCombo")}</span>
            <span className="text-[9px] text-slate-500">{t("compare.compareBase")}</span>
            <span className="flex items-center gap-1 text-[9px] tabular-nums text-slate-500">
              <Clock size={9} className="text-slate-500" />
              {formatDateInput(effectiveOpeningAt)}
            </span>
            {openingAtSimOverride !== null && (
              <button
                type="button"
                onClick={() => onSetOpeningAtSimOverride(null)}
                title={t("compare.restoreRealDate")}
                className="flex items-center gap-0.5 rounded border border-amber-700/60 bg-amber-950/40 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-amber-300 transition hover:border-amber-600 hover:text-amber-200"
              >
                <RotateCcw size={8} /> {t("compare.simulatingBadge")}
              </button>
            )}
            {!editingOpeningDate ? (
              <button
                type="button"
                onClick={() => {
                  setOpeningDateDraft(formatDateInput(effectiveOpeningAt));
                  setEditingOpeningDate(true);
                }}
                title={t("compare.simulateOpeningDate")}
                className="text-slate-600 transition hover:text-slate-300"
              >
                <Pencil size={10} />
              </button>
            ) : (
              <div className="flex items-center gap-1.5 rounded border border-amber-700/50 bg-amber-950/20 px-1.5 py-1">
                <AlertTriangle size={10} className="shrink-0 text-amber-400" />
                <span className="max-w-[220px] text-[8px] leading-tight text-amber-200">{t("compare.simulateOpeningDateWarning")}</span>
                <input
                  type="date"
                  lang={lang === "en" ? "en" : "zh-CN"}
                  value={openingDateDraft}
                  onChange={(e) => setOpeningDateDraft(e.target.value)}
                  className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[9px] tabular-nums text-slate-300 outline-none focus:border-sky-500 focus:text-sky-200 [color-scheme:dark]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const newTs = parseDateInput(openingDateDraft);
                    if (newTs !== null) onSetOpeningAtSimOverride(newTs);
                    setEditingOpeningDate(false);
                  }}
                  className="rounded bg-amber-600 px-1.5 py-0.5 text-[8px] font-semibold text-white transition hover:bg-amber-500"
                >
                  {t("compare.confirmSimulateDate")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingOpeningDate(false)}
                  className="rounded border border-slate-600 px-1.5 py-0.5 text-[8px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
                >
                  {t("common.cancel")}
                </button>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              {legToolbar}
            </div>
          </div>
        )}
        {/* The compare-mode 股价/时间流逝/隐含波动率 stats grid that used to
            render here was removed 2026-09-07 — it was a near-duplicate of
            TrackedComboSection.tsx's own grid just below it (same three
            columns, computed from the same activeLegs/activeTrackedLegs/
            spot values), except that one is a strict superset: it adds a
            fourth 持仓盈亏 column. Per xue's request, only one survives. */}
        {/* 2026-09-24改：加了flex-wrap（+gap-y-1）作为最后一道防线——全选
            后"已选N条"+策略徽章+到期盈利/盈亏平衡+若干操作按钮全部挤在
            一行，内容比容器宽时，没有flex-wrap会被flexbox压缩到文字逐字
            竖排（本行下面每个子项现在都补了shrink-0+whitespace-nowrap，
            不会再被压缩），改成"装不下就换到第二行"而不是压扁文字或水
            平滚动。 */}
        {legs.length > 0 && (
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-slate-800 bg-slate-900/40 px-2 py-1">
            <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10px] text-slate-400">
              <input
                type="checkbox"
                checked={selectedCount > 0 && selectedCount === legs.length}
                ref={(el) => {
                  if (el) el.indeterminate = selectedCount > 0 && selectedCount < legs.length;
                }}
                onChange={() => (selectedCount === legs.length ? onClearLegSelection() : onSelectAllLegs())}
                disabled={locked}
                className="h-3.5 w-3.5 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              />
              {selectedCount > 0 ? t("leg.selectedCount", { count: selectedCount }) : t("leg.selectAll")}
            </label>
            {strategyName && (
              <StrategyBadge name={strategyName} customPresets={customPresets} />
            )}
            {inlinePopBreakeven && (
              <PopBreakevenBadge pop={inlinePopBreakeven.pop} breakevens={inlinePopBreakeven.breakevens} />
            )}
            {/* 2026-09-24改：全选后这一排按钮原来是图标+文字，5个批量按钮
                +保存按钮加起来太宽，在38%宽的左侧面板里装不下，被flexbox
                挤压到文字逐字换行竖排（"批\n量\n屏\n蔽"）——违反了"容器尺寸
                不能变"这条硬性要求。改成跟App.tsx legToolbar同样的处理：
                全部收窄成纯图标+悬浮提示（title），文字挪进title，不再
                占据横向空间；容器/按钮框本身尺寸不变，只是不再显示文字。 */}
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {selectedCount > 0 && (
                <>
                  <button
                    onClick={onBulkToggleDisable}
                    disabled={locked}
                    title={allSelectedDisabled ? t("leg.bulkUnblock") : t("leg.bulkBlock")}
                    className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-amber-400 transition hover:border-amber-500/50 hover:bg-amber-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Ban size={12} />
                  </button>
                  <button
                    onClick={onRequestBulkDelete}
                    disabled={locked}
                    title={t("leg.bulkDelete")}
                    className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-rose-400 transition hover:border-rose-500/50 hover:bg-rose-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={12} />
                  </button>
                  <button
                    onClick={onUnifyQty}
                    disabled={!canUnifyLegs || locked}
                    title={`${t("leg.unifyQty")} · ${t("leg.unifyHint")}`}
                    className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-sky-400 transition hover:border-sky-500/50 hover:bg-sky-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Hash size={12} />
                  </button>
                  <button
                    onClick={onUnifyStrike}
                    disabled={!canUnifyLegs || locked}
                    title={`${t("leg.unifyStrike")} · ${t("leg.unifyHint")}`}
                    className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-sky-400 transition hover:border-sky-500/50 hover:bg-sky-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Crosshair size={12} />
                  </button>
                  <button
                    onClick={onUnifyDte}
                    disabled={!canUnifyLegs || locked}
                    title={`${t("leg.unifyDte")} · ${t("leg.unifyHint")}`}
                    className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-sky-400 transition hover:border-sky-500/50 hover:bg-sky-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <CalendarClock size={12} />
                  </button>
                </>
              )}
              {/* 2026-09-24修复：这个按钮原来是`disabled={!canSaveStrategy
                  || locked}`——`canSaveStrategy`要求方案A的内容跟
                  `strategyBaseline`（上次保存/打开时的快照）有差异才能点，
                  没有任何改动时按钮是禁用的。但方案B/C同名按钮从来没有这
                  条"必须有改动"的门槛（只看`locked`），保存对话框自己的
                  `findDuplicate`已经会在检测到完全重复时提示"覆盖"而不是
                  静默建重复记录，按钮层面的这道额外门槛是多余的、也是A跟
                  B/C行为不对等的根源——xue反馈"焦点切到A就不能保存了"，
                  根因就是这个：不是bug意义上的坏了，是A自己"必须先改点什
                  么"这条B/C没有的隐藏限制。去掉这条限制，改成只看
                  `locked`，跟B/C完全一致。 */}
              <button
                onClick={onSaveStrategy}
                disabled={locked}
                title={t("toolbar.saveStrategy")}
                className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-emerald-400 transition hover:border-emerald-500/50 hover:bg-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={12} />
              </button>
            </div>
          </div>
        )}
        {legs.length === 0 ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 text-slate-600">
            <span className="text-sm">{t("leg.noLegs")}</span>
            <span className="text-xs">{t("leg.noLegsHint")}</span>
          </div>
        ) : (
          legs.map((leg, i) => (
            <LegRow
              key={leg.id}
              leg={leg}
              index={i}
              scenarioPrice={isCompareMode ? undefined : scenarioPriceById.get(leg.id)}
              symbol={symbol}
              spot={spot}
              roleInfo={legRolesById.get(leg.id)}
              linkInfo={legLinksById.get(leg.id)}
              // Compare mode's "开仓组合" (opening combo) is historical/
              // fixed data — no market refresh makes sense for it, and its
              // structure is locked (see App.tsx's compare-mode leg
              // toolbar: add/clear/preset are all disabled there too), so
              // delete/roll/hedge/protect/compare2 are all withheld in that
              // mode — only move-up/down, add-to-preset, block/unblock, and
              // role-info survive. Outside compare mode this is the one and
              // only combo (analysis mode), so everything is live.
              hidePriceRefresh={isCompareMode}
              expired={contractsExpired}
              onChange={(patch) => onChangeLeg(leg.id, patch)}
              onToggleDisable={() => onToggleLeg(leg.id)}
              onDelete={isCompareMode ? undefined : () => onDeleteLeg(leg.id)}
              onAddToPreset={onAddToPreset}
              onRoll={isCompareMode ? undefined : () => onRoll(leg.id)}
              onHedge={isCompareMode ? undefined : onHedge}
              onProtect={isCompareMode ? undefined : () => onProtect(leg.id)}
              onCompare={isCompareMode ? undefined : () => onCompare(leg.id)}
              onMoveUp={() => onMoveLeg(i, -1)}
              onMoveDown={() => onMoveLeg(i, 1)}
              canMoveUp={i > 0}
              canMoveDown={i < legs.length - 1}
              selected={selectedLegIds.has(leg.id)}
              onToggleSelect={() => onToggleLegSelection(leg.id)}
              locked={locked}
            />
          ))
        )}
      </LockedOverlay>

      {/* Confirm-open sits right under the leg rows the person just
          reviewed/adjusted, not up in the header — the button's whole job
          here is "does this combo look right, commit it" right after
          looking at exactly that. */}
      {simOrigin && onConfirmSimOpen && (
        <div className="shrink-0 px-2 pb-2">
          <button
            onClick={() => onConfirmSimOpen({ symbol, legs: activeLegs, spot, openingAt })}
            disabled={activeLegs.length === 0 || spot <= 0 || locked}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-500 bg-emerald-600 py-2 text-[12px] font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={13} />
            <span>{t("sim.confirmOpen")}</span>
          </button>
        </div>
      )}
    </>
  );
}