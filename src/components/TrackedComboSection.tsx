// src/components/TrackedComboSection.tsx
import { History, Save, Trash2 } from "lucide-react";
import type { Leg } from "@/lib/types";
import type { ComboResult } from "@/lib/pricing";
import { weightedAvgIV } from "@/lib/pricing";
import type { SavedStrategy, TrackedSnapshot } from "@/lib/savedStrategies";
import LegRow from "@/components/LegRow";
import { useI18n } from "@/i18n/I18nContext";

// Compare mode's "今日组合" (today's combo) block — snapshot picker/save
// button header, the opening-vs-current stats grid, and the tracked legs
// list themselves. Split out of App.tsx purely to shrink that file; no
// behavior change from when this lived inline there. The caller (App.tsx)
// still guards rendering with `isCompareMode && trackedLegs`, so this
// component can assume trackedLegs is non-null.
interface Props {
  trackedLegs: Leg[];
  trackedStrategy: SavedStrategy | undefined;
  activeSnapshotId: string | null;
  onSelectSnapshot: (snap: TrackedSnapshot) => void;
  onDeleteSnapshot: (snapshotId: string) => void;
  onSaveTracked: () => void;
  trackedDirty: boolean;

  trackedResult: ComboResult | null;
  spot: number;
  activeLegs: Leg[];
  effectiveTrackedSpot: number;
  // Real live market quote, decoupled from effectiveTrackedSpot — shown as
  // the "当前" spot number here instead of the back-solved value. Null when
  // no quote is available yet (falls back to effectiveTrackedSpot).
  liveSpot: number | null;
  activeTrackedLegs: Leg[] | null;
  effectiveDaysElapsed: number;
  onToggleImpliedInfo: () => void;

  symbol: string;
  trackedLegPnlById: Map<string, number>;
  trackedLegRolesById: Map<string, { label: string; explanation: string }>;
  onChangeTrackedLeg: (id: string, patch: Partial<Leg>) => void;
  onRoll: (id: string) => void;
  onHedge: () => void;
  onProtect: (id: string) => void;
  onMoveTrackedLeg: (index: number, direction: -1 | 1) => void;
}

export default function TrackedComboSection({
  trackedLegs,
  trackedStrategy,
  activeSnapshotId,
  onSelectSnapshot,
  onDeleteSnapshot,
  onSaveTracked,
  trackedDirty,
  trackedResult,
  spot,
  activeLegs,
  effectiveTrackedSpot,
  liveSpot,
  activeTrackedLegs,
  effectiveDaysElapsed,
  onToggleImpliedInfo,
  symbol,
  trackedLegPnlById,
  trackedLegRolesById,
  onChangeTrackedLeg,
  onRoll,
  onHedge,
  onProtect,
  onMoveTrackedLeg,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col border-t-2 border-sky-700/40">
      <div className="flex flex-wrap items-center gap-2 bg-sky-950/30 px-2 py-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-sky-400">{t("compare.todayCombo")}</span>
        <span className="text-[9px] text-slate-500">{t("compare.fixed")}</span>
        {(() => {
          const snaps = trackedStrategy?.trackedSnapshots ?? [];
          if (snaps.length === 0) {
            return <span className="text-[9px] tabular-nums text-slate-500">{new Date().toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>;
          }
          const activeSnap = snaps.find((sn) => sn.id === activeSnapshotId) ?? snaps[snaps.length - 1];
          return (
            <div className="flex items-center gap-1">
              <History size={11} className="text-sky-500" />
              <select
                value={activeSnapshotId ?? activeSnap.id}
                onChange={(e) => {
                  const sn = snaps.find((s) => s.id === e.target.value);
                  if (sn) onSelectSnapshot(sn);
                }}
                className="rounded border border-sky-700/50 bg-slate-900 px-1 py-0.5 text-[9px] tabular-nums text-sky-200 outline-none focus:border-sky-500"
              >
                {snaps.map((sn, idx) => (
                  <option key={sn.id} value={sn.id}>
                    #{idx + 1} {new Date(sn.savedAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </option>
                ))}
              </select>
              <span className="text-[9px] text-slate-500">({snaps.length} {t("compare.snapshots")})</span>
              <button
                onClick={() => {
                  if (activeSnap && snaps.length > 1) onDeleteSnapshot(activeSnap.id);
                }}
                disabled={snaps.length <= 1}
                title={snaps.length <= 1 ? t("compare.keepOne") : t("compare.deleteSnap")}
                className="text-slate-500 transition hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })()}
        <button
          onClick={onSaveTracked}
          disabled={!trackedDirty}
          title={t("toolbar.saveTracked")}
          className="ml-auto flex shrink-0 items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-emerald-400 transition hover:border-emerald-500/50 hover:bg-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save size={11} />
          {t("toolbar.saveTracked")}
        </button>
      </div>
      {trackedResult && (() => {
        const openIV = spot > 0 ? weightedAvgIV(activeLegs, spot) : 0;
        const currSpot = effectiveTrackedSpot;
        const currIV = currSpot > 0 ? weightedAvgIV(activeTrackedLegs ?? [], currSpot) : 0;
        // Display-only: shows the real market quote when available, NOT
        // currSpot — IV above still uses currSpot so it stays consistent
        // with the tracked legs' actual entered premiums.
        const displaySpot = liveSpot ?? currSpot;
        const spotChg = displaySpot - spot;
        const ivChg = openIV > 0 && currIV > 0 ? (currIV - openIV) * 100 : 0;
        const trackedNetPremium = trackedResult.netPremium;
        const trackedNetValue = trackedResult.shiftedValue;
        const trackedChange = trackedResult.change;
        return (
          <div className="mb-1 grid grid-cols-4 gap-1.5 rounded-lg border border-sky-800/40 bg-sky-950/20 p-2 text-[10px]">
            <div className="flex flex-col gap-0.5">
              <span className="text-slate-500">{t("compare.spotChange")}</span>
              <span className="tabular-nums text-slate-300">{t("compare.openLabel")} <span className="font-semibold text-emerald-400">{spot.toFixed(2)}</span></span>
              <span className="tabular-nums text-slate-300">{t("compare.currentLabel")} <span className="font-semibold text-sky-400">{displaySpot.toFixed(2)}</span>
                <button
                  onClick={onToggleImpliedInfo}
                  className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-sky-500 text-[8px] font-bold text-white align-middle transition hover:bg-sky-400"
                  title={t("implied.title")}
                >i</button>
              </span>
              <span className={`tabular-nums font-semibold ${spotChg >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{spotChg >= 0 ? "+" : ""}{spotChg.toFixed(2)} ({spot > 0 ? (spotChg / spot * 100).toFixed(2) : "0.00"}%)</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-slate-500">{t("compare.timeDecay")}</span>
              <span className="tabular-nums text-slate-300">{t("compare.openLabel")} <span className="font-semibold text-emerald-400">{activeLegs.length > 0 ? Math.round(Math.max(...activeLegs.map((l) => l.dte))) : "-"}</span> {t("compare.days")}</span>
              <span className="tabular-nums text-slate-300">{t("compare.currentLabel")} <span className="font-semibold text-sky-400">{activeTrackedLegs && activeTrackedLegs.length > 0 ? Math.max(0, Math.round(Math.max(...activeTrackedLegs.map((l) => l.dte)))) : "-"}</span> {t("compare.days")}</span>
              <span className="tabular-nums font-semibold text-amber-400">{t("compare.elapsed")} {Math.round(effectiveDaysElapsed)} {t("compare.days")}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-slate-500">{t("compare.iv")}</span>
              <span className="tabular-nums text-slate-300">{t("compare.openLabel")} <span className="font-semibold text-emerald-400">{openIV > 0 ? (openIV * 100).toFixed(2) : "-"}%</span></span>
              <span className="tabular-nums text-slate-300">{t("compare.currentLabel")} <span className="font-semibold text-sky-400">{currIV > 0 ? (currIV * 100).toFixed(2) : "-"}%</span></span>
              <span className={`tabular-nums font-semibold ${ivChg >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{ivChg >= 0 ? "+" : ""}{ivChg.toFixed(2)}pp</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-slate-500">{t("compare.pnl")}</span>
              <span className="tabular-nums text-slate-300">{t("compare.openLabel")} <span className="font-semibold text-emerald-400">{trackedNetPremium >= 0 ? "+" : ""}{trackedNetPremium.toFixed(2)}</span></span>
              <span className="tabular-nums text-slate-300">{t("compare.currentLabel")} <span className="font-semibold text-sky-400">{trackedNetValue >= 0 ? "+" : ""}{trackedNetValue.toFixed(2)}</span></span>
              <span className={`tabular-nums font-semibold ${trackedChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{trackedChange >= 0 ? "+" : ""}{trackedChange.toFixed(2)}</span>
            </div>
          </div>
        );
      })()}
      <div className="p-2 space-y-1">
        {trackedLegs.map((leg, i) => (
          <LegRow
            key={leg.id}
            leg={leg}
            index={i}
            symbol={symbol}
            legPnl={trackedLegPnlById.get(leg.id)}
            roleInfo={trackedLegRolesById.get(leg.id)}
            onChange={(patch) => onChangeTrackedLeg(leg.id, patch)}
            onToggleDisable={() => {}}
            onDelete={() => {}}
            onAddToPreset={() => {}}
            onRoll={() => onRoll(leg.id)}
            onHedge={() => onHedge()}
            onProtect={() => onProtect(leg.id)}
            onMoveUp={() => onMoveTrackedLeg(i, -1)}
            onMoveDown={() => onMoveTrackedLeg(i, 1)}
            canMoveUp={i > 0}
            canMoveDown={i < trackedLegs.length - 1}
            selectable={false}
          />
        ))}
      </div>
    </div>
  );
}
