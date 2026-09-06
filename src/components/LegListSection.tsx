// src/components/LegListSection.tsx
import { Clock, Ban, Trash2, Plus, Save } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { Leg } from "@/lib/types";
import type { SavedStrategy } from "@/lib/savedStrategies";
import { weightedAvgIV } from "@/lib/pricing";
import { formatDateInput, parseDateInput } from "@/lib/dateUtils";
import { explainLegRoles } from "@/lib/legRoles";
import LegRow from "@/components/LegRow";
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
  trackedStrategy: SavedStrategy | undefined;
  activeSnapshotId: string | null;
  onUpdateSnapshotTime: (snapshotId: string, savedAt: number) => void;
  legToolbar: ReactNode;

  spot: number;
  openingAt: number;
  activeLegs: Leg[];
  effectiveTrackedSpot: number;
  // Real live market quote, decoupled from effectiveTrackedSpot — shown as
  // the "当前" spot number here instead of the back-solved value, which
  // keeps feeding the IV/attribution math elsewhere. Null when no quote is
  // available yet (falls back to effectiveTrackedSpot for display too).
  liveSpot: number | null;
  activeTrackedLegs: Leg[] | null;
  effectiveDaysElapsed: number;

  legs: Leg[];
  selectedCount: number;
  selectedLegIds: Set<string>;
  onClearLegSelection: () => void;
  onSelectAllLegs: () => void;
  canSaveStrategy: boolean;
  onSaveStrategy: () => void;
  allSelectedDisabled: boolean;
  onBulkToggleDisable: () => void;
  onRequestBulkDelete: () => void;

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
}

export default function LegListSection({
  isCompareMode,
  trackedStrategy,
  activeSnapshotId,
  onUpdateSnapshotTime,
  legToolbar,
  spot,
  openingAt,
  activeLegs,
  effectiveTrackedSpot,
  liveSpot,
  activeTrackedLegs,
  effectiveDaysElapsed,
  legs,
  selectedCount,
  selectedLegIds,
  onClearLegSelection,
  onSelectAllLegs,
  canSaveStrategy,
  onSaveStrategy,
  allSelectedDisabled,
  onBulkToggleDisable,
  onRequestBulkDelete,
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
}: Props) {
  const { t } = useI18n();
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

  return (
    <>
      <div className="p-2 space-y-1">
        {isCompareMode && (
          <div className="flex items-center gap-2 bg-slate-900/40 py-1 rounded px-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400">{t("compare.openCombo")}</span>
            <span className="text-[9px] text-slate-500">{t("compare.compareBase")}</span>
            {(() => {
              const snaps = trackedStrategy?.trackedSnapshots ?? [];
              const activeSnap = snaps.find((sn) => sn.id === activeSnapshotId) ?? snaps[snaps.length - 1];
              // Prefer a real snapshot's own save time when one exists (a
              // snapshot genuinely represents "today's check-in," a
              // different moment from when the position was first
              // opened). But with NO snapshot recorded yet, falling back
              // straight to trackedStrategy.createdAt (whenever "save to
              // library" happened to get clicked) skipped right past
              // openingAt (the date the person actually told the app the
              // position opened) — so editing openingAt and saving looked
              // like it had no effect here. openingAt is the more correct
              // fallback; createdAt only as a last resort if neither exists.
              const ts = activeSnap?.savedAt ?? trackedStrategy?.openingAt ?? trackedStrategy?.createdAt;
              if (!ts) return null;
              return (
                <label className="flex items-center gap-1 text-[9px] tabular-nums text-slate-500" title={t("compare.clickModifyDate")}>
                  <Clock size={9} className="text-slate-500" />
                  <input
                    type="date"
                    value={formatDateInput(ts)}
                    onChange={(e) => {
                      const newTs = parseDateInput(e.target.value);
                      if (newTs !== null && activeSnap) onUpdateSnapshotTime(activeSnap.id, newTs);
                    }}
                    className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[9px] tabular-nums text-slate-400 outline-none focus:border-sky-500 focus:text-sky-200 [color-scheme:dark]"
                  />
                </label>
              );
            })()}
            <div className="ml-auto flex items-center gap-2">
              {legToolbar}
            </div>
          </div>
        )}
        {isCompareMode && (() => {
          const openIV = spot > 0 ? weightedAvgIV(activeLegs, spot) : 0;
          const currSpot = effectiveTrackedSpot;
          const currIV = currSpot > 0 ? weightedAvgIV(activeTrackedLegs ?? [], currSpot) : 0;
          // Display-only: the "当前" spot number shows the real market
          // quote when available, NOT currSpot — IV above still uses
          // currSpot so it stays consistent with the tracked legs' actual
          // premiums (see the liveSpot prop comment).
          const displaySpot = liveSpot ?? currSpot;
          const spotChg = displaySpot - spot;
          const ivChg = openIV > 0 && currIV > 0 ? (currIV - openIV) * 100 : 0;
          return (
            <div className="mb-1 grid grid-cols-3 gap-1.5 rounded-lg border border-slate-800 bg-slate-900/40 p-2 text-[10px]">
              <div className="flex flex-col gap-0.5">
                <span className="text-slate-500">{t("compare.spot")}</span>
                <span className="tabular-nums text-slate-300">{t("compare.openLabel")} <span className="font-semibold text-emerald-400">{spot.toFixed(2)}</span></span>
                <span className="tabular-nums text-slate-300">{t("compare.currentLabel")} <span className="font-semibold text-sky-400">{displaySpot.toFixed(2)}</span></span>
                <span className={`tabular-nums font-semibold ${spotChg >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{spotChg >= 0 ? "+" : ""}{spotChg.toFixed(2)} ({spot > 0 ? (spotChg / spot * 100).toFixed(2) : "0.00"}%)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-slate-500">{t("compare.timeDecay")}</span>
                <span className="tabular-nums text-slate-300">{t("compare.openLabel")} <span className="font-semibold text-emerald-400">{activeLegs.length > 0 ? Math.round(Math.max(...activeLegs.map((l) => l.dte))) : "-"}</span> {t("compare.days")}</span>
                <span className="tabular-nums text-slate-300">{t("compare.currentLabel")} <span className="font-semibold text-sky-400">{activeLegs.length > 0 ? Math.max(0, Math.round(Math.max(...activeLegs.map((l) => l.dte)) - effectiveDaysElapsed)) : "-"}</span> {t("compare.days")}</span>
                <span className="tabular-nums font-semibold text-amber-400">{t("compare.elapsed")} {Math.round(effectiveDaysElapsed)} {t("compare.days")}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-slate-500">{t("compare.iv")}</span>
                <span className="tabular-nums text-slate-300">{t("compare.openLabel")} <span className="font-semibold text-emerald-400">{openIV > 0 ? (openIV * 100).toFixed(2) : "-"}%</span></span>
                <span className="tabular-nums text-slate-300">{t("compare.currentLabel")} <span className="font-semibold text-sky-400">{currIV > 0 ? (currIV * 100).toFixed(2) : "-"}%</span></span>
                <span className={`tabular-nums font-semibold ${ivChg >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{ivChg >= 0 ? "+" : ""}{ivChg.toFixed(2)}pp</span>
              </div>
            </div>
          );
        })()}
        {legs.length > 0 && (
          <div className="mb-1 flex items-center gap-2 rounded border border-slate-800 bg-slate-900/40 px-2 py-1">
            <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-slate-400">
              <input
                type="checkbox"
                checked={selectedCount > 0 && selectedCount === legs.length}
                ref={(el) => {
                  if (el) el.indeterminate = selectedCount > 0 && selectedCount < legs.length;
                }}
                onChange={() => (selectedCount === legs.length ? onClearLegSelection() : onSelectAllLegs())}
                className="h-3.5 w-3.5 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500"
              />
              {selectedCount > 0 ? t("leg.selectedCount", { count: selectedCount }) : t("leg.selectAll")}
            </label>
            <div className="ml-auto flex items-center gap-1.5">
              {selectedCount > 0 && (
                <>
                  <button
                    onClick={onBulkToggleDisable}
                    className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-amber-400 transition hover:border-amber-500/50 hover:bg-amber-950/30"
                  >
                    <Ban size={11} />
                    {allSelectedDisabled ? t("leg.bulkUnblock") : t("leg.bulkBlock")}
                  </button>
                  <button
                    onClick={onRequestBulkDelete}
                    className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-rose-400 transition hover:border-rose-500/50 hover:bg-rose-950/30"
                  >
                    <Trash2 size={11} />
                    {t("leg.bulkDelete")}
                  </button>
                </>
              )}
              <button
                onClick={onSaveStrategy}
                disabled={!canSaveStrategy}
                title={t("toolbar.saveStrategy")}
                className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-emerald-400 transition hover:border-emerald-500/50 hover:bg-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={11} />
                {t("toolbar.saveStrategy")}
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
              roleInfo={legRolesById.get(leg.id)}
              // Compare mode only, matched by position against the backing
              // SavedStrategy's own legs (not by id — these ids get
              // regenerated every time compare mode is entered, see
              // App.tsx's handleTrack/handleSwitchToCompare). A leg added
              // here after entering compare mode has no counterpart at its
              // index, so restoreOriginal stays undefined for it and its
              // restore button falls back to the normal live-fetch
              // behavior — there's no "original" to revert an unsaved new
              // leg to.
              restoreOriginal={isCompareMode ? trackedStrategy?.legs[i] : undefined}
              onChange={(patch) => onChangeLeg(leg.id, patch)}
              onToggleDisable={() => onToggleLeg(leg.id)}
              onDelete={() => onDeleteLeg(leg.id)}
              onAddToPreset={onAddToPreset}
              onRoll={() => onRoll(leg.id)}
              onHedge={onHedge}
              onProtect={() => onProtect(leg.id)}
              onCompare={() => onCompare(leg.id)}
              onMoveUp={() => onMoveLeg(i, -1)}
              onMoveDown={() => onMoveLeg(i, 1)}
              canMoveUp={i > 0}
              canMoveDown={i < legs.length - 1}
              selected={selectedLegIds.has(leg.id)}
              onToggleSelect={() => onToggleLegSelection(leg.id)}
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
