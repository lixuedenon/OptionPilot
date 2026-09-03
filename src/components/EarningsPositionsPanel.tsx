// src/components/EarningsPositionsPanel.tsx
import { useEffect, useState } from "react";
import { Clock, TrendingUp, ArrowRight, CheckCircle2, RefreshCw } from "lucide-react";
import type { Leg } from "@/lib/types";
import type { SimPosition } from "@/lib/simAccount";
import { groupEarningsPositions, computeClosingGuidance, isNearGroupPastWindow, nearGroupHoursElapsed, type EarningsBatch } from "@/lib/earningsClosing";
import { EARNINGS_GROUPS, type EarningsGroup } from "@/lib/earningsStrategy";
import { fetchSpotPrice } from "@/lib/useStockQuote";
import { dateFromDte } from "@/lib/dateUtils";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  positions: SimPosition[];
  onCloseGroup: (position: SimPosition) => void;
  onCloseLegsOnly: (position: SimPosition, legIds: string[]) => void;
  onAnalyze: (position: SimPosition) => void;
  // Reuses SimulatorPage's own already-built live-quote fetcher rather
  // than this panel duplicating that fetch logic — same function that
  // backs the close actions, so the Mark/P&L shown here is guaranteed to
  // be computed the same way the actual close would price it.
  onFetchLive: (position: SimPosition) => Promise<{ spot: number; legs: Leg[] }>;
}

const GROUP_COLOR: Record<EarningsGroup, string> = { near: "text-sky-300", mid: "text-violet-300", far: "text-amber-300" };

export default function EarningsPositionsPanel({ positions, onCloseGroup, onCloseLegsOnly, onAnalyze, onFetchLive }: Props) {
  const { t } = useI18n();
  const [spots, setSpots] = useState<Record<string, number>>({});
  const [liveLegs, setLiveLegs] = useState<Record<string, Leg[]>>({});
  const [liveLoading, setLiveLoading] = useState<Record<string, boolean>>({});

  const batches = groupEarningsPositions(positions);

  useEffect(() => {
    const symbols = [...new Set(batches.map((b) => b.symbol))];
    symbols.forEach(async (sym) => {
      try {
        const p = await fetchSpotPrice(sym);
        if (p > 0) setSpots((prev) => ({ ...prev, [sym]: p }));
      } catch {
        // silent — a missing live spot just leaves that batch's cards
        // showing "..." for movePct instead of blocking the whole panel
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches.map((b) => b.symbol).join(",")]);

  useEffect(() => {
    const allPositions = batches.flatMap((b) => Object.values(b.positions).filter((p): p is SimPosition => !!p));
    allPositions.forEach(async (pos) => {
      if (liveLegs[pos.id] || liveLoading[pos.id]) return;
      setLiveLoading((prev) => ({ ...prev, [pos.id]: true }));
      try {
        const { legs } = await onFetchLive(pos);
        setLiveLegs((prev) => ({ ...prev, [pos.id]: legs }));
      } catch {
        // silent — the leg table falls back to opening-day premiums (see
        // LegTable's markPremium fallback) rather than the whole card
        // breaking over one failed quote fetch
      } finally {
        setLiveLoading((prev) => ({ ...prev, [pos.id]: false }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches.map((b) => Object.values(b.positions).map((p) => p?.id).join(",")).join(",")]);

  if (batches.length === 0) return null;

  return (
    <div className="mb-4 space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("earnings.panelTitle")}</div>
      {batches.map((batch) => (
        <EarningsBatchCard
          key={batch.batchId}
          batch={batch}
          liveSpot={spots[batch.symbol] ?? null}
          liveLegsByPosition={liveLegs}
          liveLoadingByPosition={liveLoading}
          onCloseGroup={onCloseGroup}
          onCloseLegsOnly={onCloseLegsOnly}
          onAnalyze={onAnalyze}
        />
      ))}
    </div>
  );
}

function EarningsBatchCard({
  batch,
  liveSpot,
  liveLegsByPosition,
  liveLoadingByPosition,
  onCloseGroup,
  onCloseLegsOnly,
  onAnalyze,
}: {
  batch: EarningsBatch;
  liveSpot: number | null;
  liveLegsByPosition: Record<string, Leg[]>;
  liveLoadingByPosition: Record<string, boolean>;
  onCloseGroup: (position: SimPosition) => void;
  onCloseLegsOnly: (position: SimPosition, legIds: string[]) => void;
  onAnalyze: (position: SimPosition) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-xs font-bold text-slate-100">{batch.symbol}</span>
        <span className="text-[10px] text-slate-500">{t("earnings.panelBatchLabel")}</span>
        {liveSpot !== null && <span className="ml-auto text-[10px] tabular-nums text-emerald-400">${liveSpot.toFixed(2)}</span>}
      </div>
      <div className="space-y-2">
        {EARNINGS_GROUPS.map((spec) => {
          const pos = batch.positions[spec.group];
          if (!pos) return null;
          return (
            <GroupRow
              key={spec.group}
              group={spec.group}
              label={spec.label}
              position={pos}
              liveSpot={liveSpot}
              liveLegs={liveLegsByPosition[pos.id]}
              liveLoading={!!liveLoadingByPosition[pos.id]}
              onCloseGroup={onCloseGroup}
              onCloseLegsOnly={onCloseLegsOnly}
              onAnalyze={onAnalyze}
            />
          );
        })}
      </div>
    </div>
  );
}

// Occ-style option code (simplified — no root-symbol/strike zero-padding
// the way the real 21-char OCC format does, matching the shorter form
// brokers actually display in a positions table, e.g. "AMD260918P400").
function occCode(symbol: string, expiryISO: string, type: "call" | "put", strike: number): string {
  const [y, m, d] = expiryISO.split("-");
  const strikeStr = Number.isInteger(strike) ? String(strike) : String(strike);
  return `${symbol}${y.slice(2)}${m}${d}${type === "call" ? "C" : "P"}${strikeStr}`;
}

function LegTable({ symbol, openingLegs, liveLegs, loading }: { symbol: string; openingLegs: Leg[]; liveLegs: Leg[] | undefined; loading: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mb-2 overflow-x-auto rounded border border-slate-800">
      <table className="w-full min-w-[560px] text-[9px]">
        <thead>
          <tr className="bg-slate-900/60 text-slate-500">
            <th className="px-1.5 py-1 text-left font-normal">{t("earnings.col.exp")}</th>
            <th className="px-1.5 py-1 text-left font-normal">{t("earnings.col.strike")}</th>
            <th className="px-1.5 py-1 text-left font-normal">{t("earnings.col.type")}</th>
            <th className="px-1.5 py-1 text-right font-normal">{t("earnings.col.qty")}</th>
            <th className="px-1.5 py-1 text-right font-normal">{t("earnings.col.tradePrice")}</th>
            <th className="px-1.5 py-1 text-right font-normal">{t("earnings.col.mark")}</th>
            <th className="px-1.5 py-1 text-right font-normal">{t("earnings.col.markValue")}</th>
            <th className="px-1.5 py-1 text-right font-normal">{t("earnings.col.plOpen")}</th>
            <th className="px-1.5 py-1 text-right font-normal">{t("earnings.col.plPct")}</th>
            <th className="px-1.5 py-1 text-left font-normal">{t("earnings.col.code")}</th>
          </tr>
        </thead>
        <tbody>
          {openingLegs.map((openLeg, i) => {
            // Matched by array position, not id — liveLegs comes from a
            // fresh onFetchLive() call each time, which rebuilds Leg
            // objects with NEW ids (see SimulatorPage's fetchLiveLegsAndSpot),
            // so id-matching against the opening legs would never hit.
            // Position-matching is safe here because both arrays always
            // come from the SAME position's legs in the SAME stored order.
            const live = liveLegs?.[i];
            const expiry = live ? dateFromDte(live.dte) : dateFromDte(openLeg.dte);
            const tradePrice = openLeg.premium;
            const mark = live?.premium;
            const qty = openLeg.action === "sell" ? -(openLeg.qty ?? 1) : (openLeg.qty ?? 1);
            const markValue = mark !== undefined ? mark * Math.abs(qty) * 100 * (qty < 0 ? -1 : 1) : null;
            // P/L Open sign convention: a SOLD leg profits as the mark
            // FALLS (tradePrice - mark), a BOUGHT leg profits as the mark
            // RISES (mark - tradePrice) — matching how a real broker
            // ledger signs per-leg P/L, not a naive "mark minus trade"
            // that would show a short leg's decay as a loss.
            const plOpen = mark !== undefined ? (openLeg.action === "sell" ? tradePrice - mark : mark - tradePrice) * Math.abs(qty) * 100 : null;
            const plPct = mark !== undefined && tradePrice > 0 ? (plOpen! / (tradePrice * Math.abs(qty) * 100)) * 100 : null;
            return (
              <tr key={i} className="border-t border-slate-800/60">
                <td className="px-1.5 py-1 tabular-nums text-slate-400">{expiry}</td>
                <td className="px-1.5 py-1 text-right tabular-nums text-slate-300">{openLeg.strike}</td>
                <td className="px-1.5 py-1 text-slate-300">{openLeg.type === "call" ? "CALL" : "PUT"}</td>
                <td className={`px-1.5 py-1 text-right tabular-nums ${qty < 0 ? "text-rose-400" : "text-emerald-400"}`}>{qty}</td>
                <td className="px-1.5 py-1 text-right tabular-nums text-slate-300">{tradePrice.toFixed(2)}</td>
                <td className="px-1.5 py-1 text-right tabular-nums text-slate-300">
                  {loading ? <RefreshCw size={9} className="ml-auto animate-spin text-slate-600" /> : mark !== undefined ? mark.toFixed(3) : "—"}
                </td>
                <td className="px-1.5 py-1 text-right tabular-nums text-slate-300">{markValue !== null ? `$${markValue.toFixed(2)}` : "—"}</td>
                <td className={`px-1.5 py-1 text-right tabular-nums ${plOpen !== null ? (plOpen >= 0 ? "text-emerald-400" : "text-rose-400") : "text-slate-600"}`}>
                  {plOpen !== null ? `${plOpen >= 0 ? "+" : ""}$${plOpen.toFixed(2)}` : "—"}
                </td>
                <td className={`px-1.5 py-1 text-right tabular-nums ${plPct !== null ? (plPct >= 0 ? "text-emerald-400" : "text-rose-400") : "text-slate-600"}`}>
                  {plPct !== null ? `${plPct >= 0 ? "+" : ""}${plPct.toFixed(1)}%` : "—"}
                </td>
                <td className="px-1.5 py-1 font-mono text-[8px] text-slate-500">{occCode(symbol, expiry, openLeg.type as "call" | "put", openLeg.strike)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupRow({
  group,
  label,
  position,
  liveSpot,
  liveLegs,
  liveLoading,
  onCloseGroup,
  onCloseLegsOnly,
  onAnalyze,
}: {
  group: EarningsGroup;
  label: string;
  position: SimPosition;
  liveSpot: number | null;
  liveLegs: Leg[] | undefined;
  liveLoading: boolean;
  onCloseGroup: (position: SimPosition) => void;
  onCloseLegsOnly: (position: SimPosition, legIds: string[]) => void;
  onAnalyze: (position: SimPosition) => void;
}) {
  const { t } = useI18n();

  if (group === "near") {
    const pastWindow = isNearGroupPastWindow(position);
    const hoursLeft = Math.max(0, 2 - nearGroupHoursElapsed(position));
    const protectionLegs = position.legs.filter((l) => l.action === "buy").map((l) => l.id);
    const atmLegs = position.legs.filter((l) => l.action === "sell").map((l) => l.id);
    return (
      <div className="rounded border border-sky-800/40 bg-sky-950/10 p-2.5">
        <div className="mb-1 flex items-center justify-between">
          <span className={`text-[11px] font-bold ${GROUP_COLOR.near}`}>{label}</span>
          {pastWindow ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-rose-400">
              <Clock size={10} /> {t("earnings.nearWindowPassed")}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400">
              <Clock size={10} /> {t("earnings.nearWindowRemaining", { hours: hoursLeft.toFixed(1) })}
            </span>
          )}
        </div>
        <p className="mb-2 text-[10px] leading-relaxed text-slate-400">{t("earnings.nearGuidance")}</p>
        <LegTable symbol={position.symbol} openingLegs={position.legs} liveLegs={liveLegs} loading={liveLoading} />
        <div className="flex gap-1.5">
          <button
            onClick={() => onCloseLegsOnly(position, protectionLegs)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-300 transition hover:border-sky-500/50"
          >
            {t("earnings.closeProtectionOnly")}
          </button>
          <button
            onClick={() => onCloseLegsOnly(position, atmLegs)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-300 transition hover:border-rose-500/50"
          >
            {t("earnings.closeAtmOnly")}
          </button>
          <button
            onClick={() => onCloseGroup(position)}
            className="ml-auto rounded bg-rose-600 px-2.5 py-1 text-[10px] font-semibold text-white transition hover:bg-rose-500"
          >
            {t("earnings.closeAll")}
          </button>
        </div>
      </div>
    );
  }

  const guidance = liveSpot !== null ? computeClosingGuidance(position, liveSpot, group) : null;
  const branchColor = guidance?.branch === "small" ? "text-emerald-400" : guidance?.branch === "medium" ? "text-amber-400" : "text-slate-400";
  const branchBorder = guidance?.branch === "small" ? "border-emerald-800/40 bg-emerald-950/10" : guidance?.branch === "medium" ? "border-amber-800/40 bg-amber-950/10" : "border-slate-800 bg-slate-900/20";

  // Never hide the leg table or the close action while waiting on
  // guidance to resolve — a person shouldn't have to wonder whether a
  // feature exists just because one input (the live spot) hasn't loaded
  // yet. The BRANCH-specific button/wording only appears once guidance is
  // available; a plain, always-available "平仓" stays clickable the whole
  // time so there's never a moment with legs visible but nothing to do
  // about them.
  return (
    <div className={`rounded border p-2.5 ${branchBorder}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className={`text-[11px] font-bold ${GROUP_COLOR[group]}`}>{label}</span>
        {guidance ? (
          <span className={`text-[10px] font-semibold ${branchColor}`}>
            {t("earnings.movePct", { pct: (guidance.movePct * 100).toFixed(1) })}
          </span>
        ) : (
          <span className="text-[10px] text-slate-600">{t("earnings.loadingSpot")}</span>
        )}
      </div>
      <p className="mb-2 text-[10px] leading-relaxed text-slate-400">
        {guidance
          ? t(`earnings.branch.${guidance.branch}`, { pct: (guidance.protectionPct * 100).toFixed(0) })
          : t("earnings.guidancePending")}
      </p>
      <LegTable symbol={position.symbol} openingLegs={position.legs} liveLegs={liveLegs} loading={liveLoading} />
      <div className="flex gap-1.5">
        {guidance?.branch === "small" && (
          <button
            onClick={() => onCloseGroup(position)}
            className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white transition hover:bg-emerald-500"
          >
            <CheckCircle2 size={11} /> {t("earnings.closeAndBank")}
          </button>
        )}
        {guidance?.branch === "medium" && (
          <button
            onClick={() => onAnalyze(position)}
            className="flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-[10px] font-semibold text-white transition hover:bg-violet-500"
          >
            <ArrowRight size={11} /> {t("earnings.goAnalyze")}
          </button>
        )}
        {guidance?.branch === "large" && (
          <button
            onClick={() => onAnalyze(position)}
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-300 transition hover:border-violet-500/50"
          >
            <TrendingUp size={11} /> {t("earnings.goAnalyzeOptional")}
          </button>
        )}
        <button
          onClick={() => onCloseGroup(position)}
          className="ml-auto rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-300 transition hover:border-rose-500/50"
        >
          {t("earnings.closeAll")}
        </button>
      </div>
    </div>
  );
}
