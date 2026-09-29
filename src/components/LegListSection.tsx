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
import StrategyBadge from "@/components/StrategyBadge";
import PopBreakevenBadge from "@/components/PopBreakevenBadge";
import StepBadge from "@/components/StepBadge";
import { clickGuideTarget } from "@/lib/guide";
import { useI18n } from "@/i18n/I18nContext";
import { useIsMobile } from "@/hooks/useIsMobile";

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
  // 策略名称徽章，显示在"全选"旁；未识别出策略时为空字符串，不渲染。
  strategyName: string;
  customPresets: CustomPreset[];
  // 只在存在B/C时非null：到期盈利+盈亏平衡显示在策略徽章旁（App.tsx顶部不再显示）。
  inlinePopBreakeven: { pop: number; breakevens: number[] } | null;
  // ⚠️ trackedStrategy/activeSnapshotId/onUpdateSnapshotTime目前在这个组件里未使用（"编辑快照保存时间"的能力暂时保留，
  // 还没跟xue确认要不要；如需要，应放到TrackedComboSection的快照选择器里）。
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
  // 不再用来禁用"保存策略组合"按钮；App.tsx仍用同一个值判断离开前是否要提示保存。
  canSaveStrategy: boolean;
  // 新用户引导：保存按钮上显示可选步骤4（从没保存过策略时）。
  showSaveGuide?: boolean;
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

  // 滑块离开原点时为true，只透传给LegRow暂停自动拉价；界面锁定由App.tsx的LockedOverlay统一负责。
  locked?: boolean;
  // 策略真实到期日已过（两种模式通用），透传给LegRow挡住市场价刷新，见LegRow的expired。
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
  showSaveGuide = false,
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
  const isMobile = useIsMobile();
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

  // "开仓组合"日期字段：只显示/模拟openingAt（不是快照保存时间）。默认只读；点铅笔→警告+日期框→点"预览"才生效，
  // 生效的也只是本地临时值（openingAtSimOverride），不持久化。
  const [editingOpeningDate, setEditingOpeningDate] = useState(false);
  const [openingDateDraft, setOpeningDateDraft] = useState("");
  const effectiveOpeningAt = openingAtSimOverride ?? openingAt;

  return (
    <>
      <div className="p-2 space-y-1">
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
        {/* flex-wrap兜底：内容放不下就换行，不压扁文字、不横向滚动。 */}
        {legs.length > 0 && (
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-slate-800 bg-slate-900/40 px-2 py-1">
            {/* 手机上不做批量选择：不显示全选和批量按钮，只留策略名和保存按钮。 */}
            {!isMobile && (
            <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10px] text-slate-400">
              <input
                type="checkbox"
                checked={selectedCount > 0 && selectedCount === legs.length}
                ref={(el) => {
                  if (el) el.indeterminate = selectedCount > 0 && selectedCount < legs.length;
                }}
                onChange={() => (selectedCount === legs.length ? onClearLegSelection() : onSelectAllLegs())}
                className="h-3.5 w-3.5 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              />
              {selectedCount > 0 ? t("leg.selectedCount", { count: selectedCount }) : t("leg.selectAll")}
            </label>
            )}
            {strategyName && (
              <StrategyBadge name={strategyName} customPresets={customPresets} />
            )}
            {inlinePopBreakeven && (
              <PopBreakevenBadge pop={inlinePopBreakeven.pop} breakevens={inlinePopBreakeven.breakevens} />
            )}
            {/* 批量按钮全部纯图标（文字在title里），保证左侧面板放得下、不被挤成竖排文字。 */}
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {selectedCount > 0 && !isMobile && (
                <>
                  <button
                    onClick={onBulkToggleDisable}
                    title={allSelectedDisabled ? t("leg.bulkUnblock") : t("leg.bulkBlock")}
                    className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-amber-400 transition hover:border-amber-500/50 hover:bg-amber-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Ban size={12} />
                  </button>
                  <button
                    onClick={onRequestBulkDelete}
                    title={t("leg.bulkDelete")}
                    className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-rose-400 transition hover:border-rose-500/50 hover:bg-rose-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={12} />
                  </button>
                  <button
                    onClick={onUnifyQty}
                    disabled={!canUnifyLegs}
                    title={`${t("leg.unifyQty")} · ${t("leg.unifyHint")}`}
                    className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-sky-400 transition hover:border-sky-500/50 hover:bg-sky-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Hash size={12} />
                  </button>
                  <button
                    onClick={onUnifyStrike}
                    disabled={!canUnifyLegs}
                    title={`${t("leg.unifyStrike")} · ${t("leg.unifyHint")}`}
                    className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-sky-400 transition hover:border-sky-500/50 hover:bg-sky-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Crosshair size={12} />
                  </button>
                  <button
                    onClick={onUnifyDte}
                    disabled={!canUnifyLegs}
                    title={`${t("leg.unifyDte")} · ${t("leg.unifyHint")}`}
                    className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-sky-400 transition hover:border-sky-500/50 hover:bg-sky-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <CalendarClock size={12} />
                  </button>
                </>
              )}
              {/* 不要求"必须有改动"才能保存（跟B/C一致）；完全重复时保存对话框会提示覆盖。 */}
              <span className="relative flex">
              {showSaveGuide && <StepBadge n={4} title={t("guide.step4")} optional />}
              <button
                onClick={onSaveStrategy}
                title={t("toolbar.saveStrategy")}
                className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-emerald-400 transition hover:border-emerald-500/50 hover:bg-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={12} />
              </button>
              </span>
            </div>
          </div>
        )}
        {legs.length === 0 ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 text-slate-400">
            <span className="text-sm">{t("leg.noLegs")}</span>
            {isCompareMode ? (
              <span className="text-xs">{t("leg.noLegsHint")}</span>
            ) : (
              // 引导文字里的"+"、"预设策略"、"策略库"像网页链接一样可点，点了等于点页面上的原始控件。
              <span className="max-w-[460px] px-4 text-center text-xs leading-relaxed">
                {t("guide.emptyHint").split(/(\{plus\}|\{preset\}|\{library\})/).map((part, i) => {
                  const target = part === "{plus}" ? "add-leg" : part === "{preset}" ? "preset" : part === "{library}" ? "library" : null;
                  if (!target) return <span key={i}>{part}</span>;
                  const label = target === "add-leg" ? "+" : target === "preset" ? t("guide.linkPreset") : t("toolbar.presetLabel");
                  return (
                    <span
                      key={i}
                      role="link"
                      onClick={() => clickGuideTarget(target)}
                      className="cursor-pointer font-semibold text-sky-400 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-300"
                    >
                      {label}
                    </span>
                  );
                })}
              </span>
            )}
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
      </div>

      {/* Confirm-open sits right under the leg rows the person just
          reviewed/adjusted, not up in the header — the button's whole job
          here is "does this combo look right, commit it" right after
          looking at exactly that. */}
      {simOrigin && onConfirmSimOpen && (
        <div className="shrink-0 px-2 pb-2">
          <button
            onClick={() => onConfirmSimOpen({ symbol, legs: activeLegs, spot, openingAt })}
            disabled={activeLegs.length === 0 || spot <= 0}
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