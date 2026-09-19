// src/components/TrackedComboSection.tsx
import { useMemo } from "react";
import { History, Save, Trash2 } from "lucide-react";
import type { Leg } from "@/lib/types";
import type { ComboResult } from "@/lib/pricing";
import { weightedAvgIV } from "@/lib/pricing";
import type { SavedStrategy, TrackedSnapshot } from "@/lib/savedStrategies";
import { computeLegLinks } from "@/lib/legLinks";
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
  // Sum of `closedPnl` across all trackedLegs (see types.ts and
  // useComboAnalytics.ts's realizedTrackedPnl) — the P&L already booked
  // from legs that have been 平仓'd or rolled away from. Added to
  // `trackedResult.change` only for the DISPLAYED total below, never fed
  // back into `trackedResult` itself, so PayoffChart's tracked curve (which
  // reads `trackedResult.change` via App.tsx's `netChange` prop) keeps
  // reflecting only the still-open legs — xue chose "update the summary
  // numbers only" over reshaping that curve.
  realizedPnl: number;
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
  // 2026-09-12: "今日组合"'s three-dot menu used to wire these three to
  // `() => {}` no-ops — a rolled/protected/hedged tracked leg (or the leg
  // it came from) looked permanently frozen not because Roll/Protect/Hedge
  // themselves lock anything, but because there was simply nothing real to
  // call. Now backed by useLegEditing.ts's toggleTrackedLeg/closeTrackedLeg
  // and App.tsx's tracked-source preset dialog wiring. `onCloseTrackedLeg`
  // takes the leg's own live P&L (read from `trackedLegPnlById` right here,
  // since that map is already a prop) so useLegEditing.ts can freeze it
  // into `closedPnl` instead of just deleting the leg outright.
  onToggleTrackedLeg: (id: string) => void;
  onCloseTrackedLeg: (id: string, pnl: number) => void;
  onAddTrackedLegToPreset: () => void;
  onRoll: (id: string) => void;
  onHedge: () => void;
  onProtect: (id: string) => void;
  onMoveTrackedLeg: (index: number, direction: -1 | 1) => void;
  // 2026-09-17新增：这条策略的真实到期日已经过去（App.tsx的
  // isExpiredReal）。跟"开仓组合"那份历史快照不同，"今日组合"这个列表本
  // 来就是给"恢复市场价"用的（对着真实行情刷新），如果背后合约已经真实
  // 到期，这个刷新按钮点了会静默snap到今天附近某个完全不同的合约上重新
  // 定价——所以这里必须把这个信号传给每条LegRow挡住，不像"开仓组合"那边
  // 可以直接整体hidePriceRefresh了事（这个列表在未过期时是需要刷新功能
  // 的，不能整体关掉）。见LegRow.tsx的expired prop注释。
  contractsExpired?: boolean;
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
  realizedPnl,
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
  onToggleTrackedLeg,
  onCloseTrackedLeg,
  onAddTrackedLegToPreset,
  onRoll,
  onHedge,
  onProtect,
  onMoveTrackedLeg,
  contractsExpired = false,
}: Props) {
  const { t } = useI18n();

  // Roll/Protect pairing badges (see lib/legLinks.ts), scoped to the
  // tracked-combo leg list — same helper LegListSection.tsx uses for the
  // opening combo, kept as two separate calls since the two arrays' leg
  // ids are independent (see types.ts's openLegId comment).
  const trackedLegLinksById = useMemo(() => computeLegLinks(trackedLegs), [trackedLegs]);
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
                title={t("compare.estimatedHint")}
                className="rounded border border-sky-700/50 bg-slate-900 px-1 py-0.5 text-[9px] tabular-nums text-sky-200 outline-none focus:border-sky-500"
              >
                {snaps.map((sn, idx) => (
                  <option key={sn.id} value={sn.id}>
                    #{idx + 1} {new Date(sn.savedAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    {sn.estimated ? ` ${t("compare.estimatedTag")}` : ""}
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
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            onClick={onSaveTracked}
            disabled={!trackedDirty}
            title={t("toolbar.saveTracked")}
            className="flex shrink-0 items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-emerald-400 transition hover:border-emerald-500/50 hover:bg-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save size={11} />
            {t("toolbar.saveTracked")}
          </button>
        </div>
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
        // Unrealized (still-open legs, from trackedResult.change) plus
        // realized (closed/rolled-away legs' frozen closedPnl, summed in
        // App.tsx as realizedPnl) — see this component's realizedPnl prop
        // comment for why this combined number is display-only and never
        // feeds back into trackedResult/the chart.
        const totalChange = trackedChange + realizedPnl;
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
              <span className={`tabular-nums font-semibold ${totalChange >= 0 ? "text-emerald-400" : "text-rose-400"}`} title={realizedPnl !== 0 ? t("compare.pnlIncludesRealized", { realized: `${realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}` }) : undefined}>
                {totalChange >= 0 ? "+" : ""}{totalChange.toFixed(2)}
              </span>
              {realizedPnl !== 0 && (
                <span className="text-[9px] tabular-nums text-slate-500">
                  {t("compare.realizedLabel")} <span className={realizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}>{realizedPnl >= 0 ? "+" : ""}{realizedPnl.toFixed(2)}</span>
                </span>
              )}
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
            spot={effectiveTrackedSpot}
            legPnl={trackedLegPnlById.get(leg.id)}
            roleInfo={trackedLegRolesById.get(leg.id)}
            linkInfo={trackedLegLinksById.get(leg.id)}
            deleteVariant="close"
            expired={contractsExpired}
            onChange={(patch) => onChangeTrackedLeg(leg.id, patch)}
            onToggleDisable={() => onToggleTrackedLeg(leg.id)}
            onDelete={() => onCloseTrackedLeg(leg.id, trackedLegPnlById.get(leg.id) ?? 0)}
            onAddToPreset={onAddTrackedLegToPreset}
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
