// src/SimulatorPage.tsx
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Plus, RefreshCw, X, Trash2, History, Search, Undo2, TrendingUp, TrendingDown, Minus, ChevronDown, MoreVertical, CalendarClock, Shield, Layers, Ban, Wallet, DollarSign, Compass, RotateCcw, Target, LineChart, HelpCircle, AlertTriangle } from "lucide-react";
import type { Leg } from "@/lib/types";
import type { CurvePosition } from "@/lib/pricing";
import { probabilityOfProfit, legGreekBreakdown } from "@/lib/pricing";
import { dateFromDte, formatDateInput, parseDateInput } from "@/lib/dateUtils";
import PayoffChart from "@/components/PayoffChart";
import ErrorBoundary from "@/components/ErrorBoundary";
import {
  type SimAccount,
  type SimPosition,
  type PositionSnapshot,
  loadSimAccount,
  initSimAccount,
  loadSimPositions,
  closeSimPosition,
  deleteSimPosition,
  computeMarkValue,
  recordSnapshot,
  backfillSnapshots,
  analyzeBestExit,
  type ExitAnalysis,
  daysBetweenLocalDates,
  adjustSimPosition,
  resetSimAccount,
} from "@/lib/simAccount";
import { fetchSpotPrice } from "@/lib/useStockQuote";
import { fetchLegPremium } from "@/lib/optionChain";
import { useI18n } from "@/i18n/I18nContext";
import RollDialog from "@/components/RollDialog";
import ProtectDialog from "@/components/ProtectDialog";
import HedgeDialog from "@/components/HedgeDialog";
import StrategyBadge from "@/components/StrategyBadge";
import { matchStrategy } from "@/lib/matchStrategy";
import { ConfirmResetAccountDialog, HelpPanel, isGuideDismissed } from "@/components/dialogs";
import SimStatsPanel from "@/components/SimStatsPanel";
import { computeSimStats } from "@/lib/simStats";

interface Props {
  onBack: () => void;
  onNewPosition: () => void;
  onStartFromScenario: () => void;
}

interface MarkState {
  loading: boolean;
  error: string | null;
  spot: number | null;
  legs: Leg[] | null;
}

interface RegretState {
  loading: boolean;
  error: string | null;
  spot: number | null;
  legs: Leg[] | null;
}

function daysSince(ts: number): number {
  return Math.floor((Date.now() - ts) / 86400000);
}

// A position's legs store `dte` as it was AT OPENING (frozen — same
// convention analysis mode itself uses, see App.tsx's handleOpenStrategy),
// so "days left today" has to subtract however many days have elapsed
// since this position actually opened. Uses the nearest (smallest) leg
// DTE among active, non-stock legs — the leg closest to expiry is the one
// that matters for "how much runway does this combo have left."
function nearestDteRemaining(p: SimPosition): number | null {
  const elapsed = daysSince(p.openedAt);
  const candidates = p.legs
    .filter((l) => l.kind !== "stock" && !l.disabled)
    .map((l) => Math.max(0, Math.round(l.dte - elapsed)));
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

// Position management alerts (2026-09, xue's proposal #7): a lightweight
// "this position might be worth looking at" signal, not a push notification
// — just a badge in the position row. Two independent triggers:
// - DTE alert: nearestDteRemaining(p) at or below the classic "21 DTE"
//   management convention.
// - Delta alert: the worst (largest-magnitude) short leg's current Delta
//   has drifted past a threshold, meaning that leg has moved closer to
//   ITM/assignment than it was when opened. Only computable once the
//   position has a live mark (mark.legs/mark.spot from refreshLegs) — those
//   legs already carry LIVE current dte/premium (see refreshLegs above), so
//   legGreekBreakdown on them with a neutral (zero) Shifts gives today's
//   actual Delta, not the frozen opening-day Delta. No mark yet → no data →
//   no alert, same "can't compute yet" convention the unrealized-P&L
//   display already follows a few lines down.
// Thresholds are conventional defaults (tastytrade-style "manage around 21
// DTE / 30 delta"), not derived from xue's own rules — she may want to
// tune these later, ideally as a setting rather than a hardcoded constant.
const DTE_ALERT_THRESHOLD = 21;
const DELTA_ALERT_THRESHOLD = 0.30;

interface PositionAlerts {
  dte: boolean;
  dteLeft: number | null;
  delta: boolean;
  deltaValue: number | null;
}

function computePositionAlerts(dteLeft: number | null, mark: MarkState | undefined): PositionAlerts {
  let deltaValue: number | null = null;
  if (mark?.legs && mark.spot !== null) {
    const spot = mark.spot;
    for (const l of mark.legs) {
      if (l.kind === "stock" || l.disabled || l.action !== "sell") continue;
      const d = legGreekBreakdown(l, { dS: 0, dT: 0, dV: 0 }, spot).delta;
      if (deltaValue === null || Math.abs(d) > Math.abs(deltaValue)) deltaValue = d;
    }
  }
  return {
    dte: dteLeft !== null && dteLeft <= DTE_ALERT_THRESHOLD,
    dteLeft,
    delta: deltaValue !== null && Math.abs(deltaValue) > DELTA_ALERT_THRESHOLD,
    deltaValue,
  };
}

// The Timeline chart's full x-axis span, in days: for a closed position,
// its actual open→close lifespan (fixed, known); for a still-open one, its
// nearest-to-expiry leg's ORIGINAL dte at opening (frozen — same value
// nearestDteRemaining above measures elapsed time against), since that's
// the natural horizon this trade is heading toward. Scaling the x-axis
// against this rather than "one slot per snapshot so far" is what makes the
// line actually grow day by day instead of always stretching edge-to-edge
// on however few points happen to exist right now.
function plannedSpanDays(p: SimPosition): number {
  if (p.status === "closed" && p.closedAt) {
    return Math.max(1, daysBetweenLocalDates(formatDateInput(p.openedAt), formatDateInput(p.closedAt)));
  }
  const dtes = p.legs.filter((l) => l.kind !== "stock" && !l.disabled).map((l) => l.dte);
  return dtes.length > 0 ? Math.max(1, Math.round(Math.min(...dtes))) : 1;
}

// Local calendar date `days` (possibly fractional — always rounded) after
// `iso` — used to label the Timeline chart's x-axis ticks with an actual
// date rather than just a day count, without needing a snapshot to exist
// exactly on that day.
function isoPlusDays(iso: string, days: number): string {
  const base = parseDateInput(iso);
  if (base == null) return iso;
  return formatDateInput(base + Math.round(days) * 86400000);
}

function fmt(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

function fmtPct(pnl: number, costBasis: number): string {
  const base = Math.abs(costBasis);
  if (base < 0.01) return "—";
  return `${pnl >= 0 ? "+" : ""}${((pnl / base) * 100).toFixed(1)}%`;
}

// Every P&L figure in this page used a plain ">= 0 ? green : red" split —
// which colors an exact $0.00 green, misleadingly implying a (nonexistent)
// gain. A real three-way split (profit/loss/exactly flat) reads correctly
// at a glance instead of quietly lying about a break-even position, and
// having ONE helper for it means every P&L number on this page — cost
// basis, unrealized, realized, per-leg — stays consistent instead of each
// callsite re-deriving its own version of the same three-way check.
function pnlColorClass(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-rose-400";
  return "text-slate-400";
}

function optionCode(symbol: string, dte: number, type: "call" | "put", strike: number): string {
  const iso = dateFromDte(dte);
  const yy = iso.slice(2, 4), mm = iso.slice(5, 7), dd = iso.slice(8, 10);
  return `${symbol.toUpperCase()}${yy}${mm}${dd}${type === "call" ? "C" : "P"}${strike}`;
}

// "复盘" (post-trade review, formerly an unlabeled "trend" icon that didn't
// say what it did) — shows the daily mark-to-market snapshots collected so
// far (see recordSnapshot in simAccount.ts) and highlights the single best
// day to have closed, compared against either the position's current
// unrealized P&L (still open) or its actual realized P&L (already closed).
// Days the person never actually refreshed on are filled in by
// backfillSnapshots() from that day's historical (open+close)/2 average
// instead of being left blank — those entries carry `estimated: true` and
// are rendered with a dashed border + "(估)" tag below so they read as a
// reconstruction, not an observed price (see simAccount.ts for why this
// can only ever ESTIMATE, never show a real historical option fill).
// Layout: the one-line verdict ("you're near/above/below the best point on
// record") is the headline — that's the actual insight this feature exists
// to deliver. Right under it, a second line explains WHY when there's a
// structural (curve-shape) reason to point to — see analyzeBestExit /
// classifySpotOnCurve — since a bare "this day was better" number doesn't
// tell the person whether that day was a fluke or a genuinely well-timed
// exit. Below that, a small line chart (not a wall of day-boxes — those
// stopped scaling once backfill could put 40+ days on screen for an older
// position) plots every day's P&L; hovering anywhere on it reads off the
// nearest day's date and value, so full detail stays reachable without the
// panel's footprint growing with the position's age.
function structuralReasonKey(structural: CurvePosition | null): string | null {
  if (structural === "near-peak") return "sim.reasonNearPeak";
  if (structural === "beyond-breakeven") return "sim.reasonBeyondBreakeven";
  return null; // "in-zone" — no strong structural signal worth calling out
}

const CHART_W = 280;
const CHART_H = 56; // plotted line/dot area only — axis labels live below this, in TICK_AREA_H
const CHART_PAD = 4;
const TICK_AREA_H = 11; // extra viewBox height reserved for the x-axis date labels
const MIN_TICK_PX = 34; // minimum horizontal gap between tick labels before one gets dropped

function TimelineChart({
  position,
  snapshots,
  bestDateISO,
  t,
}: {
  position: SimPosition;
  snapshots: PositionSnapshot[]; // must already be sorted chronologically
  bestDateISO: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const n = snapshots.length;
  const values = snapshots.map((s) => s.unrealizedPnl);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  const span = maxV - minV || 1;

  // x-axis is scaled by real elapsed CALENDAR days against the position's
  // full planned span (see plannedSpanDays), not one evenly-spaced slot per
  // snapshot — so the line only reaches as far as time actually has, and
  // fills in the rest of the width day by day as more snapshots accumulate,
  // instead of always stretching to fill the chart on whatever few points
  // exist so far.
  const openedISO = formatDateInput(position.openedAt);
  const totalSpan = plannedSpanDays(position);
  const xAtElapsed = (elapsed: number) => {
    const ratio = Math.max(0, Math.min(1, elapsed / totalSpan));
    return CHART_PAD + ratio * (CHART_W - CHART_PAD * 2);
  };
  const xAt = (i: number) => xAtElapsed(daysBetweenLocalDates(openedISO, snapshots[i].dateISO));
  const yAt = (v: number) => CHART_H - CHART_PAD - ((v - minV) / span) * (CHART_H - CHART_PAD * 2);
  const zeroY = yAt(0);

  const pathD = snapshots.map((s, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(s.unrealizedPnl).toFixed(1)}`).join(" ");
  const hovered = hoverIdx !== null ? snapshots[hoverIdx] : null;

  // x-axis date ticks: always the opening date, plus (when there's enough
  // real span to show it without crowding) the latest day on record and a
  // midpoint between them. Anchored to the SAME elapsed/totalSpan mapping
  // as the data points (xAtElapsed), so a tick's label is exactly the
  // calendar date sitting under it — this is what lets someone confirm the
  // curve actually reached "today" rather than a day it got stuck on.
  const lastElapsed = n > 0 ? daysBetweenLocalDates(openedISO, snapshots[n - 1].dateISO) : 0;
  const midElapsed = lastElapsed / 2;
  const startX = xAtElapsed(0);
  const midX = xAtElapsed(midElapsed);
  const endX = xAtElapsed(lastElapsed);
  const includeMid = lastElapsed > 0 && midX - startX > MIN_TICK_PX && endX - midX > MIN_TICK_PX;
  const tickElapsed = lastElapsed <= 0 ? [0] : includeMid ? [0, midElapsed, lastElapsed] : [0, lastElapsed];
  const ticks = tickElapsed.map((elapsed) => ({
    x: xAtElapsed(elapsed),
    label: isoPlusDays(openedISO, elapsed).slice(5), // "MM-DD" — full year would crowd this small a chart
  }));

  return (
    <div className="relative mt-1.5">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${CHART_H + TICK_AREA_H}`}
        className="w-full cursor-crosshair"
        onMouseMove={(e) => {
          if (!svgRef.current || n === 0) return;
          const rect = svgRef.current.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * CHART_W;
          let nearest = 0;
          let bestDist = Infinity;
          for (let i = 0; i < n; i++) {
            const d = Math.abs(xAt(i) - relX);
            if (d < bestDist) { bestDist = d; nearest = i; }
          }
          setHoverIdx(nearest);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <line x1={0} y1={zeroY} x2={CHART_W} y2={zeroY} className="stroke-slate-700" strokeDasharray="2,2" strokeWidth={1} />
        <path d={pathD} fill="none" className="stroke-sky-500" strokeWidth={1.2} />
        {hoverIdx !== null && (
          <line x1={xAt(hoverIdx)} y1={0} x2={xAt(hoverIdx)} y2={CHART_H} className="stroke-slate-600" strokeWidth={0.5} />
        )}
        {snapshots.map((s, i) => (
          <circle
            key={s.dateISO}
            cx={xAt(i)}
            cy={yAt(s.unrealizedPnl)}
            r={s.dateISO === bestDateISO ? 2.6 : hoverIdx === i ? 2.2 : 1.2}
            className={s.dateISO === bestDateISO ? "fill-amber-400" : "fill-sky-400"}
            fillOpacity={s.estimated && s.dateISO !== bestDateISO ? 0.5 : 1}
          />
        ))}
        {ticks.map((tk, i) => (
          <g key={i}>
            <line x1={tk.x} y1={CHART_H} x2={tk.x} y2={CHART_H + 2} className="stroke-slate-600" strokeWidth={0.5} />
            <text
              x={tk.x}
              y={CHART_H + TICK_AREA_H - 1}
              textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
              fontSize="5.5"
              className="fill-slate-500"
            >
              {tk.label}
            </text>
          </g>
        ))}
      </svg>
      {hovered && hoverIdx !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[9px] text-slate-300 shadow-2xl"
          style={{ left: `${(xAt(hoverIdx) / CHART_W) * 100}%` }}
        >
          <div className="font-mono">{hovered.dateISO}{hovered.estimated ? <span className="text-slate-600"> {t("sim.estimatedTag")}</span> : null}</div>
          <div className={pnlColorClass(hovered.unrealizedPnl)}>{fmt(hovered.unrealizedPnl)}</div>
        </div>
      )}
    </div>
  );
}

function TimelinePanel({
  position,
  snapshots,
  loading,
  currentPnl,
  currentSpot,
  currentLabel,
  t,
}: {
  position: SimPosition;
  snapshots: PositionSnapshot[] | undefined;
  loading: boolean;
  currentPnl: number | null;
  currentSpot: number | null;
  currentLabel: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  if (loading) {
    return <div className="border-t border-slate-800/60 bg-slate-950/40 px-3 py-2 text-[10px] text-slate-500">{t("sim.loadingTimeline")}</div>;
  }
  if (!snapshots || snapshots.length === 0) {
    return <div className="border-t border-slate-800/60 bg-slate-950/40 px-3 py-2 text-[10px] text-slate-600">{t("sim.noSnapshots")}</div>;
  }

  const analysis = analyzeBestExit(position, snapshots, currentSpot) as ExitAnalysis;
  const best = analysis.bestSnapshot;
  const diffFromCurrent = currentPnl !== null ? best.unrealizedPnl - currentPnl : null;
  // Explain whichever point the verdict is actually pointing at: the
  // historical best day when it beat the comparison point, otherwise the
  // comparison point (now, or the actual close) itself.
  const reasonKey = diffFromCurrent !== null && diffFromCurrent > 0.01
    ? structuralReasonKey(analysis.bestStructural)
    : structuralReasonKey(analysis.compareStructural);

  return (
    <div className="border-t border-slate-800/60 bg-slate-950/40 px-3 py-2">
      {diffFromCurrent !== null && (
        <>
          <p className="text-[10px] font-medium leading-relaxed text-amber-300">
            {diffFromCurrent > 0.01
              ? t("sim.bestPointWorse", { date: best.dateISO, pnl: fmt(best.unrealizedPnl), label: currentLabel, diff: fmt(diffFromCurrent) })
              : diffFromCurrent < -0.01
              ? t("sim.bestPointBetter", { label: currentLabel })
              : t("sim.bestPointSame")}
            {best.estimated ? <span className="font-normal text-slate-500"> {t("sim.estimatedBestHint")}</span> : null}
          </p>
          {reasonKey && <p className="mt-0.5 text-[9px] leading-relaxed text-slate-500">{t(reasonKey)}</p>}
        </>
      )}
      <TimelineChart position={position} snapshots={snapshots} bestDateISO={best.dateISO} t={t} />
    </div>
  );
}

// "对比" — the SAME PayoffChart component analysis mode's own tracking/
// compare view uses (see App.tsx's handleTrack), fed directly from this
// SimPosition's own fields instead of routing through SavedStrategy (which
// has no closed-state fields, so it isn't actually the right shape for a
// sim position — see the design discussion this was built from). `legs`/
// `openingLegs` are always the position's OPENING legs (the strategy's
// shape never changes, only where spot/time sit on it does); `trackedLegs`/
// `trackedSpot` are "now" for an open position or "at close" for a closed
// one — the caller resolves which before this renders, so this component
// only draws, it doesn't decide.
function ComparePanel({
  position,
  trackedLegs,
  trackedSpot,
  t,
}: {
  position: SimPosition;
  trackedLegs: Leg[] | null; // null = not enough data yet (open position, no live refresh this session)
  trackedSpot: number | null;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const openingLegs = useMemo(() => position.legs.filter((l) => !l.disabled), [position.legs]);
  const { pop, breakevens } = useMemo(() => probabilityOfProfit(openingLegs, position.spot), [openingLegs, position.spot]);

  if (!trackedLegs || trackedSpot === null) {
    return (
      <div className="border-t border-slate-800/60 bg-slate-950/40 px-3 py-4 text-center text-[10px] text-slate-600">
        {t("sim.compareNeedsRefresh")}
      </div>
    );
  }

  const activeTracked = trackedLegs.filter((l) => !l.disabled);
  const markValue = computeMarkValue(activeTracked, trackedSpot);
  const netChange = markValue - position.costBasis;

  return (
    <div className="border-t border-slate-800/60 bg-slate-950/40 px-3 py-2">
      <div className="h-64">
        <ErrorBoundary>
          <PayoffChart
            legs={openingLegs}
            spot={position.spot}
            shifts={{ dS: 0, dT: 0, dV: 0 }}
            symbol={position.symbol}
            pop={pop}
            breakevens={breakevens}
            trackedLegs={activeTracked}
            trackedSpot={trackedSpot}
            openingLegs={openingLegs}
            compareMode
            netValue={markValue}
            netChange={netChange}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}


// Same three-dot menu the analysis workspace uses per leg (LegRow.tsx), but
// scoped to what makes sense on a live simulated position: roll/protect
// operate on this one leg, hedge operates on the whole position, and
// "close this leg" partially unwinds it — all with real cash accounting via
// adjustSimPosition, unlike the workspace's purely theoretical versions.
function LegActionMenu({
  onRoll,
  onProtect,
  onHedge,
  onCloseLeg,
  disabled,
}: {
  onRoll: () => void;
  onProtect: () => void;
  onHedge: () => void;
  onCloseLeg: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const menuWidth = 128; // w-32
      setCoords({
        top: rect.bottom + 4,
        left: Math.max(4, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 4)),
      });
    }
    setOpen((v) => !v);
  };

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        disabled={disabled}
        className="rounded p-0.5 text-slate-600 transition hover:bg-slate-800 hover:text-slate-300 disabled:opacity-30"
      >
        <MoreVertical size={12} />
      </button>
      {open && coords && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: coords.top, left: coords.left }}
          className="z-[999] w-32 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl"
        >
          <button onClick={() => run(onRoll)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[10px] text-sky-400 transition hover:bg-sky-950/40">
            <CalendarClock size={11} /> {t("leg.roll")}
          </button>
          <button onClick={() => run(onProtect)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[10px] text-sky-400 transition hover:bg-sky-950/40">
            <Shield size={11} /> {t("leg.protect")}
          </button>
          <button onClick={() => run(onHedge)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[10px] text-violet-400 transition hover:bg-violet-950/40">
            <Layers size={11} /> {t("leg.hedge")}
          </button>
          <div className="my-0.5 border-t border-slate-800" />
          <button onClick={() => run(onCloseLeg)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[10px] text-rose-400 transition hover:bg-rose-950/40">
            <Ban size={11} /> {t("sim.closeThisLeg")}
          </button>
        </div>,
        document.body
      )}
    </>
  );
}

async function refreshLegs(symbol: string, legs: Leg[], openedAt: number): Promise<{ spot: number; legs: Leg[] }> {
  const spot = await fetchSpotPrice(symbol);
  const refreshed: Leg[] = [];
  for (const l of legs) {
    if (l.kind === "stock" || l.disabled) {
      refreshed.push(l);
      continue;
    }
    const currentDte = Math.max(0, Math.round(l.dte - daysSince(openedAt)));
    try {
      const result = await fetchLegPremium(symbol, l.type, l.strike, currentDte, true);
      refreshed.push({ ...l, premium: result.premium, dte: result.actualDte });
    } catch {
      refreshed.push(l);
    }
  }
  return { spot, legs: refreshed };
}

export default function SimulatorPage({ onBack, onNewPosition, onStartFromScenario }: Props) {
  const { t } = useI18n();
  const [account, setAccount] = useState<SimAccount | null>(null);
  const [positions, setPositions] = useState<SimPosition[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [startingCapitalInput, setStartingCapitalInput] = useState("10000");
  const [marks, setMarks] = useState<Record<string, MarkState>>({});
  const [regrets, setRegrets] = useState<Record<string, RegretState>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [expandedTimeline, setExpandedTimeline] = useState<Record<string, boolean>>({});
  const [expandedCompare, setExpandedCompare] = useState<Record<string, boolean>>({});
  const [timelines, setTimelines] = useState<Record<string, PositionSnapshot[]>>({});
  // Calendar day (local, yyyy-mm-dd) each entry in `timelines` was fetched
  // on — lets toggleTimeline tell "still fresh" apart from "loaded a while
  // ago and the position has aged since." Without this, a position whose
  // Timeline panel got expanded once (e.g. the day it was opened) would
  // show that same frozen slice of history forever: `timelines[pos.id]`
  // being merely *present* was previously treated as "nothing to do,"
  // so the curve never grew past whatever day it happened to load on.
  const [timelinesDate, setTimelinesDate] = useState<Record<string, string>>({});
  const [timelineLoading, setTimelineLoading] = useState<Record<string, boolean>>({});
  const [rollTarget, setRollTarget] = useState<{ pos: SimPosition; leg: Leg; spot: number } | null>(null);
  const [protectTarget, setProtectTarget] = useState<{ pos: SimPosition; leg: Leg; spot: number } | null>(null);
  const [hedgeTarget, setHedgeTarget] = useState<{ pos: SimPosition; legs: Leg[]; spot: number } | null>(null);
  const [legActionLoading, setLegActionLoading] = useState<string | null>(null); // leg id currently fetching a live price for a dialog
  const [symbolFilter, setSymbolFilter] = useState("");
  const [selectedLegKeys, setSelectedLegKeys] = useState<Set<string>>(new Set());
  const [confirmBulkCloseOpen, setConfirmBulkCloseOpen] = useState(false);
  const [bulkCloseLoading, setBulkCloseLoading] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [justReset, setJustReset] = useState(false);
  // Module guide (2026-09-06): shown once as a blocking gate on first entry
  // into the simulator, mirroring analysis/compare mode's showAnalysisGuide/
  // showCompareGuide in App.tsx; helpOpen is the dismissible re-open via the
  // header's new "使用说明" button (this module had no such button before).
  const [showGuide, setShowGuide] = useState(() => !isGuideDismissed("simulator"));
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [a, p] = await Promise.all([loadSimAccount(), loadSimPositions()]);
      setAccount(a);
      setPositions(p);
      setLoaded(true);
    })();
  }, []);

  const handleCreateAccount = async () => {
    const v = parseFloat(startingCapitalInput);
    if (!Number.isFinite(v) || v <= 0) return;
    const a = await initSimAccount(v);
    setAccount(a);
  };

  const handleResetAccount = async () => {
    await resetSimAccount();
    setAccount(null);
    setPositions([]);
    setMarks({});
    setRegrets({});
    setConfirmResetOpen(false);
    // The person explicitly asked for feedback here — landing back on the
    // onboarding screen (which looks the same whether it's a first-ever
    // visit or a just-reset account) gave no visible confirmation that
    // anything actually happened, easy to read as "the button didn't do
    // anything" even though the reset itself worked correctly.
    setJustReset(true);
  };

  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<{ done: number; total: number } | null>(null);

  const refreshAllPositions = useCallback(async (posList: SimPosition[]) => {
    if (posList.length === 0) return;
    setRefreshingAll(true);
    setRefreshProgress({ done: 0, total: posList.length });
    for (let i = 0; i < posList.length; i++) {
      const pos = posList[i];
      setMarks((prev) => ({ ...prev, [pos.id]: { loading: true, error: null, spot: null, legs: null } }));
      try {
        const { spot, legs } = await refreshLegs(pos.symbol, pos.legs, pos.openedAt);
        setMarks((prev) => ({ ...prev, [pos.id]: { loading: false, error: null, spot, legs } }));
        recordSnapshot(pos.id, spot, legs, pos.costBasis)
          .then(() => {
            // A new REAL snapshot for today just landed in storage. Any
            // cached Timeline for this position was built before it
            // existed (see timelinesDate above), so drop it; if the panel
            // happens to already be open, reload right away instead of
            // waiting for a collapse/re-expand that may never happen.
            setTimelines((prev) => {
              if (!(pos.id in prev)) return prev;
              const next = { ...prev };
              delete next[pos.id];
              return next;
            });
            setTimelinesDate((prev) => {
              if (!(pos.id in prev)) return prev;
              const next = { ...prev };
              delete next[pos.id];
              return next;
            });
            setExpandedTimeline((prevExpanded) => {
              if (prevExpanded[pos.id]) {
                backfillSnapshots(pos).then((snaps) => {
                  setTimelines((prev) => ({ ...prev, [pos.id]: snaps }));
                  setTimelinesDate((prev) => ({ ...prev, [pos.id]: formatDateInput(Date.now()) }));
                });
              }
              return prevExpanded;
            });
          })
          .catch(() => {});
      } catch (e) {
        setMarks((prev) => ({
          ...prev,
          [pos.id]: { loading: false, error: e instanceof Error ? e.message : t("sim.refreshFailed"), spot: null, legs: null },
        }));
      }
      setRefreshProgress({ done: i + 1, total: posList.length });
    }
    setRefreshingAll(false);
    setRefreshProgress(null);
  }, [t]);

  const refreshRegret = useCallback(async (pos: SimPosition) => {
    setRegrets((prev) => ({ ...prev, [pos.id]: { loading: true, error: null, spot: null, legs: null } }));
    try {
      const { spot, legs } = await refreshLegs(pos.symbol, pos.legs, pos.openedAt);
      setRegrets((prev) => ({ ...prev, [pos.id]: { loading: false, error: null, spot, legs } }));
    } catch (e) {
      setRegrets((prev) => ({
        ...prev,
        [pos.id]: { loading: false, error: e instanceof Error ? e.message : t("sim.refreshFailed"), spot: null, legs: null },
      }));
    }
  }, [t]);

  const handleClose = async (pos: SimPosition) => {
    const mark = marks[pos.id];
    if (!mark || !mark.legs || mark.spot === null) return;
    const { account: a, positions: p } = await closeSimPosition(pos.id, mark.legs, mark.spot);
    setAccount(a);
    setPositions(p);
    setMarks((prev) => {
      const next = { ...prev };
      delete next[pos.id];
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    setPositions(await deleteSimPosition(id));
    setSelectedLegKeys((prev) => {
      const prefix = `${id}:`;
      const next = new Set([...prev].filter((k) => !k.startsWith(prefix)));
      return next;
    });
  };

  // Loads (and, the first time a position's panel is opened, backfills)
  // the Timeline. backfillSnapshots needs the full position — not just its
  // id — to know its symbol/legs/opening date/status for reconstructing
  // estimated days from historical (open+close)/2 averages; see
  // simAccount.ts for what "estimated" means and why today (or a closed
  // position's close date) is deliberately left out of that reconstruction.
  const toggleTimeline = useCallback(async (pos: SimPosition) => {
    setExpandedTimeline((prev) => ({ ...prev, [pos.id]: !prev[pos.id] }));
    const todayISO = formatDateInput(Date.now());
    // Refetch whenever there's no cache yet, OR the cache we have was built
    // on an earlier calendar day — a same-day refresh already invalidates
    // this cache itself (see refreshAllPositions above), so this second
    // check only matters for a tab left open across midnight, where the
    // cache is still "present" but has aged out without ever being cleared.
    if (!timelines[pos.id] || timelinesDate[pos.id] !== todayISO) {
      setTimelineLoading((prev) => ({ ...prev, [pos.id]: true }));
      const snaps = await backfillSnapshots(pos);
      setTimelines((prev) => ({ ...prev, [pos.id]: snaps }));
      setTimelinesDate((prev) => ({ ...prev, [pos.id]: todayISO }));
      setTimelineLoading((prev) => ({ ...prev, [pos.id]: false }));
    }
  }, [timelines, timelinesDate]);

  // No async work here (unlike toggleTimeline) — ComparePanel reads
  // straight off whatever's already in `marks`/the position's own closed-
  // state fields, it doesn't fetch or backfill anything new.
  const toggleCompare = (id: string) => {
    setExpandedCompare((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Fetch a live price for one leg before opening Roll/Protect (they need a
  // realistic current premium to base their suggestions on).
  const fetchLiveLeg = async (pos: SimPosition, leg: Leg): Promise<{ leg: Leg; spot: number }> => {
    const spot = await fetchSpotPrice(pos.symbol);
    if (leg.kind === "stock") return { leg, spot };
    const currentDte = Math.max(0, Math.round(leg.dte - daysSince(pos.openedAt)));
    const result = await fetchLegPremium(pos.symbol, leg.type, leg.strike, currentDte, true);
    return { leg: { ...leg, premium: result.premium, dte: result.actualDte }, spot };
  };

  const openRoll = async (pos: SimPosition, leg: Leg) => {
    setLegActionLoading(leg.id);
    try {
      const { leg: liveLeg, spot } = await fetchLiveLeg(pos, leg);
      setRollTarget({ pos, leg: liveLeg, spot });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t("sim.refreshFailed"));
    } finally {
      setLegActionLoading(null);
    }
  };

  const openProtect = async (pos: SimPosition, leg: Leg) => {
    setLegActionLoading(leg.id);
    try {
      const { leg: liveLeg, spot } = await fetchLiveLeg(pos, leg);
      setProtectTarget({ pos, leg: liveLeg, spot });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t("sim.refreshFailed"));
    } finally {
      setLegActionLoading(null);
    }
  };

  const openHedge = async (pos: SimPosition, triggeringLegId: string) => {
    setLegActionLoading(triggeringLegId);
    try {
      // Was a hand-rolled Promise.all duplicating refreshLegs's own fetch
      // loop (same skip-stock/skip-disabled logic) — reuse the shared
      // helper instead of maintaining a second copy of it.
      const { spot, legs: liveLegs } = await refreshLegs(pos.symbol, pos.legs, pos.openedAt);
      setHedgeTarget({ pos, legs: liveLegs, spot });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t("sim.refreshFailed"));
    } finally {
      setLegActionLoading(null);
    }
  };

  const closeSingleLeg = async (pos: SimPosition, leg: Leg) => {
    setLegActionLoading(leg.id);
    try {
      const { leg: liveLeg, spot } = await fetchLiveLeg(pos, leg);
      const { account: a, positions: p } = await adjustSimPosition(pos.id, {
        removeLegIds: [leg.id],
        removedLegsMarket: [liveLeg],
        addLegs: [],
        currentSpot: spot,
      });
      setAccount(a);
      setPositions(p);
      setMarks((prev) => { const next = { ...prev }; delete next[pos.id]; return next; });
      setSelectedLegKeys((prev) => {
        const key = legKey(pos.id, leg.id);
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t("sim.refreshFailed"));
    } finally {
      setLegActionLoading(null);
    }
  };

  const handleRollConfirm = async (newLeg: Leg) => {
    if (!rollTarget) return;
    const { pos, leg, spot } = rollTarget;
    const { account: a, positions: p } = await adjustSimPosition(pos.id, {
      removeLegIds: [leg.id],
      removedLegsMarket: [leg],
      addLegs: [{ ...newLeg, id: `leg-${Date.now()}` }],
      currentSpot: spot,
    });
    setAccount(a);
    setPositions(p);
    setMarks((prev) => { const next = { ...prev }; delete next[pos.id]; return next; });
    setRollTarget(null);
  };

  const handleProtectConfirm = async (protectLeg: Leg) => {
    if (!protectTarget) return;
    const { pos, spot } = protectTarget;
    const { account: a, positions: p } = await adjustSimPosition(pos.id, {
      removeLegIds: [],
      removedLegsMarket: [],
      addLegs: [{ ...protectLeg, id: `leg-${Date.now()}` }],
      currentSpot: spot,
    });
    setAccount(a);
    setPositions(p);
    setMarks((prev) => { const next = { ...prev }; delete next[pos.id]; return next; });
    setProtectTarget(null);
  };

  const handleHedgeConfirm = async (hedgeLeg: Leg) => {
    if (!hedgeTarget) return;
    const { pos, spot } = hedgeTarget;
    const { account: a, positions: p } = await adjustSimPosition(pos.id, {
      removeLegIds: [],
      removedLegsMarket: [],
      addLegs: [{ ...hedgeLeg, id: `leg-${Date.now()}` }],
      currentSpot: spot,
    });
    setAccount(a);
    setPositions(p);
    setMarks((prev) => { const next = { ...prev }; delete next[pos.id]; return next; });
    setHedgeTarget(null);
  };

  const openPositions = useMemo(() => {
    const list = positions.filter((p) => p.status === "open");
    const f = symbolFilter.trim().toUpperCase();
    return f ? list.filter((p) => p.symbol.toUpperCase().includes(f)) : list;
  }, [positions, symbolFilter]);

  const closedPositions = useMemo(() => {
    const list = positions.filter((p) => p.status === "closed");
    const f = symbolFilter.trim().toUpperCase();
    return f ? list.filter((p) => p.symbol.toUpperCase().includes(f)) : list;
  }, [positions, symbolFilter]);

  const groupedOpen = useMemo(() => {
    const groups = new Map<string, SimPosition[]>();
    for (const p of openPositions) {
      const arr = groups.get(p.symbol) ?? [];
      arr.push(p);
      groups.set(p.symbol, arr);
    }
    return Array.from(groups.entries());
  }, [openPositions]);

  // ── Batch selection across leg tables ──
  // Keyed by "positionId:legId" rather than just legId, since the table
  // groups by symbol and can show legs from several different open
  // positions side by side — a bare legId could theoretically collide
  // across positions.
  const legKey = (positionId: string, legId: string) => `${positionId}:${legId}`;

  const toggleLegSelection = (positionId: string, legId: string) => {
    const key = legKey(positionId, legId);
    setSelectedLegKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const clearLegSelection = () => setSelectedLegKeys(new Set());

  // Only option legs are individually closable (stock legs have no per-leg
  // menu today — see the `l.kind !== "stock"` guard in the table below), so
  // "select all" only picks those up.
  const allClosableLegKeys = useMemo(() => {
    const keys: string[] = [];
    for (const p of openPositions) {
      for (const l of p.legs) {
        if (l.kind !== "stock" && !l.disabled) keys.push(legKey(p.id, l.id));
      }
    }
    return keys;
  }, [openPositions]);
  const selectedCount = selectedLegKeys.size;
  const allSelected = selectedCount > 0 && allClosableLegKeys.every((k) => selectedLegKeys.has(k));
  const toggleSelectAll = () => {
    setSelectedLegKeys(allSelected ? new Set() : new Set(allClosableLegKeys));
  };

  // ── Bulk-close WHOLE positions ──
  // Separate from the leg-level selection above (which partially adjusts
  // a position — removes specific legs without necessarily fully closing
  // it) — this closes each selected position completely, through the
  // same closeSimPosition path handleClose already uses for one position
  // at a time, just looped so several positions can be closed in one
  // action instead of clicking "close" once per position.
  const [selectedPositionIds, setSelectedPositionIds] = useState<Set<string>>(new Set());
  const togglePositionGroupSelection = (posList: SimPosition[]) => {
    const ids = posList.map((p) => p.id);
    const allIn = ids.every((id) => selectedPositionIds.has(id));
    setSelectedPositionIds((prev) => {
      const next = new Set(prev);
      if (allIn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };
  const allPositionIds = useMemo(() => openPositions.map((p) => p.id), [openPositions]);
  const selectedPositionCount = selectedPositionIds.size;
  const allPositionsSelected = selectedPositionCount > 0 && allPositionIds.every((id) => selectedPositionIds.has(id));
  const toggleSelectAllPositions = () => {
    setSelectedPositionIds(allPositionsSelected ? new Set() : new Set(allPositionIds));
  };

  const [bulkClosePositionsLoading, setBulkClosePositionsLoading] = useState(false);
  const [confirmBulkClosePositionsOpen, setConfirmBulkClosePositionsOpen] = useState(false);

  const bulkClosePositions = async () => {
    if (selectedPositionIds.size === 0) return;
    setBulkClosePositionsLoading(true);
    try {
      for (const posId of selectedPositionIds) {
        const pos = positions.find((p) => p.id === posId);
        if (!pos || pos.status !== "open") continue;
        // Was a hand-rolled loop that dropped disabled legs entirely
        // instead of passing them through unrefreshed — inconsistent with
        // handleClose (single-position close), which stores whatever
        // refreshLegs last put in `marks[pos.id].legs`, disabled legs
        // included (computeMarkValue/ComparePanel already filter them back
        // out wherever it matters). Reusing refreshLegs here fixes that
        // inconsistency along with the duplication.
        const { spot, legs: liveLegs } = await refreshLegs(pos.symbol, pos.legs, pos.openedAt);
        const { account: a, positions: p } = await closeSimPosition(posId, liveLegs, spot);
        setAccount(a);
        setPositions(p);
        setMarks((prev) => { const next = { ...prev }; delete next[posId]; return next; });
      }
    } finally {
      setBulkClosePositionsLoading(false);
      setSelectedPositionIds(new Set());
      setConfirmBulkClosePositionsOpen(false);
    }
  };

  // Batch version of closeSingleLeg: groups the selection by position (a
  // single adjustSimPosition call can close several legs from the same
  // position at once), fetches each leg's live price, then applies one
  // adjustSimPosition call per affected position — sequentially, since each
  // call reads/writes localStorage and running them in parallel could race.
  const bulkCloseSelected = async () => {
    if (selectedLegKeys.size === 0) return;
    setBulkCloseLoading(true);
    try {
      const byPosition = new Map<string, string[]>();
      for (const key of selectedLegKeys) {
        const sep = key.indexOf(":");
        const posId = key.slice(0, sep);
        const legId = key.slice(sep + 1);
        const arr = byPosition.get(posId) ?? [];
        arr.push(legId);
        byPosition.set(posId, arr);
      }

      for (const [posId, legIds] of byPosition) {
        const pos = positions.find((p) => p.id === posId);
        if (!pos) continue;
        const legsToClose = pos.legs.filter((l) => legIds.includes(l.id));
        if (legsToClose.length === 0) continue;

        // legsToClose can never include a disabled leg — the checkbox that
        // populates selectedLegKeys only renders for `!l.disabled` legs —
        // so refreshLegs's disabled-skip branch is simply never exercised
        // here; safe to reuse instead of hand-rolling the same fetch loop.
        const { spot, legs: liveLegs } = await refreshLegs(pos.symbol, legsToClose, pos.openedAt);

        const { account: a, positions: p } = await adjustSimPosition(posId, {
          removeLegIds: legIds,
          removedLegsMarket: liveLegs,
          addLegs: [],
          currentSpot: spot,
        });
        setAccount(a);
        setPositions(p);
        setMarks((prev) => {
          const next = { ...prev };
          delete next[posId];
          return next;
        });
      }
      clearLegSelection();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t("sim.refreshFailed"));
    } finally {
      setBulkCloseLoading(false);
      setConfirmBulkCloseOpen(false);
    }
  };

  const allOpenForTotals = positions.filter((p) => p.status === "open");
  const totalMarkValue = allOpenForTotals.reduce((acc, p) => {
    const mark = marks[p.id];
    if (!mark || !mark.legs || mark.spot === null) return acc;
    return acc + computeMarkValue(mark.legs, mark.spot);
  }, 0);
  const totalCostBasis = allOpenForTotals.reduce((acc, p) => acc + p.costBasis, 0);
  const unrealizedPnl = totalMarkValue - totalCostBasis;
  const realizedPnlTotal = positions
    .filter((p) => p.status === "closed")
    .reduce((acc, p) => acc + (p.realizedPnl ?? 0), 0);
  const totalEquity = (account?.cash ?? 0) + totalMarkValue;
  // Trade-quality stats (胜率/盈亏比/最大回撤/连胜连亏) — see simStats.ts and
  // SimStatsPanel.tsx for scope notes (2026-09, xue's proposal #6).
  const simStats = useMemo(() => computeSimStats(positions), [positions]);

  if (!loaded) return null;

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-200">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center gap-3">
          <button
            onClick={onBack}
            title={t("home.backToHome")}
            className="flex items-center rounded transition hover:opacity-80"
          >
            <img
              src="/image copy 2.png"
              alt="OptionPilot"
              className="h-10 w-auto shrink-0 object-contain"
            />
          </button>
          <h1 className="text-sm font-bold text-slate-100">{t("sim.title")}</h1>
          <button
            onClick={() => setHelpOpen(true)}
            title={t("toolbar.help")}
            className={`flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] font-semibold text-slate-500 transition hover:border-slate-500 hover:text-slate-300 ${account ? "" : "ml-auto"}`}
          >
            <HelpCircle size={11} />
            {t("toolbar.help")}
          </button>
          {account && (
            <button
              onClick={() => setConfirmResetOpen(true)}
              title={t("sim.resetAccount")}
              className="ml-auto flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-500 transition hover:border-rose-500/60 hover:text-rose-400"
            >
              <RotateCcw size={11} />
              {t("sim.resetAccount")}
            </button>
          )}
        </header>

        {!account ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center">
            {justReset && (
              <div className="mb-4 rounded-lg border border-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-[11px] font-semibold text-emerald-300">
                {t("sim.resetDone")}
              </div>
            )}
            <p className="mb-4 text-[12px] text-slate-400">{t("sim.setupPrompt")}</p>
            <div className="mx-auto flex max-w-xs items-center gap-2">
              <input
                type="number"
                value={startingCapitalInput}
                onChange={(e) => setStartingCapitalInput(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
              <button
                onClick={() => { setJustReset(false); handleCreateAccount(); }}
                className="shrink-0 rounded bg-emerald-600 px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-emerald-500"
              >
                {t("sim.createAccount")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-950 text-emerald-400">
                  <Wallet size={15} />
                </div>
                <div>
                  <div className="text-[9px] text-slate-500">{t("sim.totalEquity")}</div>
                  <div className="text-sm font-bold text-slate-100">${totalEquity.toFixed(2)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-950 text-sky-400">
                  <DollarSign size={15} />
                </div>
                <div>
                  <div className="text-[9px] text-slate-500">{t("sim.cash")}</div>
                  <div className="text-sm font-bold text-slate-100">${account.cash.toFixed(2)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${unrealizedPnl > 0 ? "bg-emerald-950 text-emerald-400" : unrealizedPnl < 0 ? "bg-rose-950 text-rose-400" : "bg-slate-800 text-slate-400"}`}>
                  {unrealizedPnl > 0 ? <TrendingUp size={15} /> : unrealizedPnl < 0 ? <TrendingDown size={15} /> : <Minus size={15} />}
                </div>
                <div>
                  <div className="text-[9px] text-slate-500">{t("sim.unrealizedPnl")}</div>
                  <div className={`text-sm font-bold ${pnlColorClass(unrealizedPnl)}`}>{fmt(unrealizedPnl)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${realizedPnlTotal > 0 ? "bg-emerald-950 text-emerald-400" : realizedPnlTotal < 0 ? "bg-rose-950 text-rose-400" : "bg-slate-800 text-slate-400"}`}>
                  {realizedPnlTotal > 0 ? <TrendingUp size={15} /> : realizedPnlTotal < 0 ? <TrendingDown size={15} /> : <Minus size={15} />}
                </div>
                <div>
                  <div className="text-[9px] text-slate-500">{t("sim.realizedPnl")}</div>
                  <div className={`text-sm font-bold ${pnlColorClass(realizedPnlTotal)}`}>{fmt(realizedPnlTotal)}</div>
                </div>
              </div>
            </div>

            <SimStatsPanel stats={simStats} />

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[12px] font-bold text-slate-300">{t("sim.openPositions")} ({openPositions.length})</h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
                  <input
                    value={symbolFilter}
                    onChange={(e) => setSymbolFilter(e.target.value)}
                    placeholder={t("sim.filterSymbol")}
                    className="w-28 rounded border border-slate-700 bg-slate-900 py-1 pl-6 pr-2 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => refreshAllPositions(allOpenForTotals)}
                  disabled={refreshingAll || allOpenForTotals.length === 0}
                  className="flex items-center gap-1 rounded border border-sky-600/60 bg-sky-950/30 px-2.5 py-1.5 text-[11px] font-semibold text-sky-300 transition hover:border-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RefreshCw size={12} className={refreshingAll ? "animate-spin" : ""} />
                  {refreshingAll && refreshProgress
                    ? `${t("sim.refreshAll")} (${refreshProgress.done}/${refreshProgress.total})`
                    : t("sim.refreshAll")}
                </button>
                <button
                  onClick={onNewPosition}
                  className="flex items-center gap-1 rounded border border-emerald-600/60 bg-emerald-950/30 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 transition hover:border-emerald-500"
                >
                  <Plus size={12} />
                  {t("sim.newPosition")}
                </button>
                <button
                  onClick={onStartFromScenario}
                  title={t("sim.templateEntryDesc")}
                  className="flex items-center gap-1 rounded border border-violet-600/60 bg-violet-950/30 px-2.5 py-1.5 text-[11px] font-semibold text-violet-300 transition hover:border-violet-500"
                >
                  <Compass size={12} />
                  {t("sim.templateEntryTitle")}
                </button>
              </div>
            </div>

            {openPositions.length > 0 && (
              <div className="mb-2 flex items-center gap-2 rounded border border-slate-800 bg-slate-900/40 px-2 py-1.5">
                <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={allPositionsSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedPositionCount > 0 && !allPositionsSelected;
                    }}
                    onChange={toggleSelectAllPositions}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500"
                  />
                  {selectedPositionCount > 0 ? t("sim.selectedPositionsCount", { count: selectedPositionCount }) : t("sim.selectAllPositions")}
                </label>
                {selectedPositionCount > 0 && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      onClick={() => setConfirmBulkClosePositionsOpen(true)}
                      disabled={bulkClosePositionsLoading}
                      className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-rose-400 transition hover:border-rose-500/50 hover:bg-rose-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {bulkClosePositionsLoading ? <RefreshCw size={11} className="animate-spin" /> : <Ban size={11} />}
                      {t("sim.bulkClosePosition")}
                    </button>
                  </div>
                )}
              </div>
            )}

            {allClosableLegKeys.length > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded border border-slate-800 bg-slate-900/40 px-2 py-1.5">
                <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedCount > 0 && !allSelected;
                    }}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500"
                  />
                  {selectedCount > 0 ? t("leg.selectedCount", { count: selectedCount }) : t("leg.selectAll")}
                </label>
                {selectedCount > 0 && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      onClick={() => setConfirmBulkCloseOpen(true)}
                      disabled={bulkCloseLoading}
                      className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-rose-400 transition hover:border-rose-500/50 hover:bg-rose-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {bulkCloseLoading ? <RefreshCw size={11} className="animate-spin" /> : <Ban size={11} />}
                      {t("sim.bulkCloseLeg")}
                    </button>
                  </div>
                )}
              </div>
            )}

            {groupedOpen.length === 0 ? (
              <div className="mb-6 rounded-lg border border-dashed border-slate-800 p-6 text-center text-[11px] text-slate-600">
                {t("sim.noOpenPositions")}
              </div>
            ) : (
              <div className="mb-6 space-y-4">
                {groupedOpen.map(([symbol, posList]) => {
                  const symbolMarkTotal = posList.reduce((acc, p) => {
                    const mark = marks[p.id];
                    if (!mark?.legs || mark.spot === null) return acc;
                    return acc + computeMarkValue(mark.legs, mark.spot);
                  }, 0);
                  const symbolCostTotal = posList.reduce((acc, p) => acc + p.costBasis, 0);
                  const symbolPnl = symbolMarkTotal - symbolCostTotal;
                  return (
                    <div key={symbol} className="overflow-hidden rounded-lg border border-slate-800">
                      <div className="flex items-center justify-between bg-slate-900 px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={posList.every((p) => selectedPositionIds.has(p.id))}
                            onChange={() => togglePositionGroupSelection(posList)}
                            title={t("sim.selectPosition")}
                            className="h-3.5 w-3.5 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500"
                          />
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-800 text-[9px] font-bold text-slate-400">
                            {symbol.slice(0, 2)}
                          </span>
                          <span className="font-mono text-xs font-bold text-slate-100">{symbol}</span>
                          <span className="text-[9px] text-slate-600">{posList.length} {posList.length === 1 ? t("sim.positionSingular") : t("sim.positionPlural")}</span>
                        </div>
                        <span className={`text-[11px] font-bold ${symbolPnl > 0 ? "text-emerald-400" : symbolPnl < 0 ? "text-rose-400" : "text-slate-400"}`}>{fmt(symbolPnl)}</span>
                      </div>
                      <table className="w-full border-collapse text-[10px]">
                        <thead>
                          <tr className="bg-slate-900/60 text-slate-500">
                            <th className="px-1 py-1"></th>
                            <th className="px-2 py-1 text-left font-medium">{t("sim.colExp")}</th>
                            <th className="px-2 py-1 text-left font-medium">{t("sim.colStrike")}</th>
                            <th className="px-2 py-1 text-left font-medium">{t("sim.colType")}</th>
                            <th className="px-2 py-1 text-right font-medium">{t("sim.colQty")}</th>
                            <th className="px-2 py-1 text-right font-medium">{t("sim.colOpenPrice")}</th>
                            <th className="px-2 py-1 text-right font-medium">{t("sim.colMark")}</th>
                            <th className="px-2 py-1 text-right font-medium">{t("sim.colMarkValue")}</th>
                            <th className="px-2 py-1 text-right font-medium">{t("sim.colPnl")}</th>
                            <th className="px-2 py-1 text-right font-medium">{t("sim.colPnlPct")}</th>
                            <th className="px-2 py-1 text-left font-medium">{t("sim.colCode")}</th>
                            <th className="px-1 py-1"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {posList.map((p) => {
                            const mark = marks[p.id];
                            return p.legs.map((l, i) => {
                              const signedQty = l.kind === "stock" ? 1 : (l.action === "sell" ? -(l.qty ?? 1) : (l.qty ?? 1));
                              const currentLeg = mark?.legs?.[i];
                              const currentPrice = currentLeg ? (l.kind === "stock" ? mark?.spot ?? null : currentLeg.premium) : null;
                              const legSign = l.action === "buy" ? 1 : -1;
                              const legQty = l.kind === "stock" ? 1 : (l.qty ?? 1);
                              const legCost = legSign * legQty * (l.kind === "stock" ? l.strike : l.premium);
                              const legMarkValue = currentPrice !== null ? legSign * legQty * currentPrice : null;
                              const legPnl = legMarkValue !== null ? legMarkValue - legCost : null;
                              return (
                                <tr key={l.id} className="border-t border-slate-800/60 text-slate-300 hover:bg-slate-900/40">
                                  <td className="px-1 py-1 text-center">
                                    {l.kind !== "stock" && !l.disabled && (
                                      <input
                                        type="checkbox"
                                        checked={selectedLegKeys.has(legKey(p.id, l.id))}
                                        onChange={() => toggleLegSelection(p.id, l.id)}
                                        className="h-3 w-3 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500"
                                      />
                                    )}
                                  </td>
                                  <td className="px-2 py-1 tabular-nums">{l.kind === "stock" ? "—" : dateFromDte(l.dte)}</td>
                                  <td className="px-2 py-1 tabular-nums">{l.kind === "stock" ? t("sim.stockRow") : l.strike}</td>
                                  <td className="px-2 py-1 uppercase text-slate-500">{l.kind === "stock" ? "STK" : l.type}</td>
                                  <td className={`px-2 py-1 text-right tabular-nums ${signedQty < 0 ? "text-rose-400" : "text-slate-300"}`}>{signedQty}</td>
                                  <td className="px-2 py-1 text-right tabular-nums text-slate-400">{(l.kind === "stock" ? l.strike : l.premium).toFixed(2)}</td>
                                  <td className="px-2 py-1 text-right tabular-nums text-slate-200">{currentPrice !== null ? currentPrice.toFixed(2) : "—"}</td>
                                  <td className="px-2 py-1 text-right tabular-nums text-slate-200">
                                    {legMarkValue !== null ? (legMarkValue < 0 ? `(${Math.abs(legMarkValue).toFixed(2)})` : legMarkValue.toFixed(2)) : "—"}
                                  </td>
                                  <td className={`px-2 py-1 text-right tabular-nums font-semibold ${legPnl !== null ? pnlColorClass(legPnl) : "text-slate-600"}`}>
                                    {legPnl !== null ? fmt(legPnl) : "—"}
                                  </td>
                                  <td className={`px-2 py-1 text-right tabular-nums ${legPnl !== null ? pnlColorClass(legPnl) : "text-slate-600"}`}>
                                    {legPnl !== null ? fmtPct(legPnl, legCost) : "—"}
                                  </td>
                                  <td className="px-2 py-1 font-mono text-[9px] text-slate-600">
                                    {l.kind === "stock" ? t("sim.stockRow") : optionCode(p.symbol, l.dte, l.type, l.strike)}
                                  </td>
                                  <td className="px-1 py-1 text-right">
                                    {l.kind !== "stock" && (
                                      legActionLoading === l.id ? (
                                        <RefreshCw size={11} className="mx-auto animate-spin text-slate-600" />
                                      ) : (
                                        <LegActionMenu
                                          onRoll={() => openRoll(p, l)}
                                          onProtect={() => openProtect(p, l)}
                                          onHedge={() => openHedge(p, l.id)}
                                          onCloseLeg={() => closeSingleLeg(p, l)}
                                          disabled={legActionLoading !== null}
                                        />
                                      )
                                    )}
                                  </td>
                                </tr>
                              );
                            });
                          })}
                        </tbody>
                      </table>
                      {posList.map((p) => {
                        const mark = marks[p.id];
                        const markValue = mark?.legs && mark.spot !== null ? computeMarkValue(mark.legs, mark.spot) : null;
                        const unrealized = markValue !== null ? markValue - p.costBasis : null;
                        const strategyName = matchStrategy(p.legs, p.spot, []);
                        const dteLeft = nearestDteRemaining(p);
                        const alerts = computePositionAlerts(dteLeft, mark);
                        return (
                          <div key={p.id}>
                            <div className="flex items-center justify-between gap-2 border-t border-slate-800/60 bg-slate-900/40 px-3 py-1.5">
                              <div className="flex flex-wrap items-center gap-2 text-[9px] text-slate-500">
                                {strategyName && <StrategyBadge name={strategyName} customPresets={[]} />}
                                <span title={`${daysSince(p.openedAt)} ${t("compare.days")}`}>{t("sim.openedOn", { date: formatDateInput(p.openedAt) })}</span>
                                {dteLeft !== null && <span>{t("sim.dteLeft", { days: dteLeft })}</span>}
                                <span className="text-slate-500">{t("sim.costBasis")} {fmt(p.costBasis)}</span>
                                {mark?.loading && (
                                  <span className="flex items-center gap-1 text-sky-400">
                                    <RefreshCw size={9} className="animate-spin" />
                                    {t("sim.refreshing")}
                                  </span>
                                )}
                                {!mark?.loading && unrealized !== null && (
                                  <span className={pnlColorClass(unrealized)}>
                                    {t("sim.unrealizedPnl")} {fmt(unrealized)}
                                  </span>
                                )}
                                {mark?.error && <span className="text-rose-400">{mark.error}</span>}
                                {alerts.dte && (
                                  <span
                                    title={t("sim.alertDteHint", { days: alerts.dteLeft ?? 0 })}
                                    className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-950/30 px-1.5 py-0.5 font-semibold text-amber-400"
                                  >
                                    <AlertTriangle size={9} />
                                    {t("sim.alertDteBadge", { days: alerts.dteLeft ?? 0 })}
                                  </span>
                                )}
                                {alerts.delta && (
                                  <span
                                    title={t("sim.alertDeltaHint", { value: alerts.deltaValue!.toFixed(2) })}
                                    className="flex items-center gap-1 rounded border border-rose-500/40 bg-rose-950/30 px-1.5 py-0.5 font-semibold text-rose-400"
                                  >
                                    <AlertTriangle size={9} />
                                    {t("sim.alertDeltaBadge", { value: alerts.deltaValue!.toFixed(2) })}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => toggleTimeline(p)}
                                  title={t("sim.reviewHint")}
                                  className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-amber-400 transition hover:border-amber-500/50"
                                >
                                  <Target size={10} />
                                  <span>{t("sim.reviewLabel")}</span>
                                  <ChevronDown size={9} className={`transition-transform ${expandedTimeline[p.id] ? "rotate-180" : ""}`} />
                                </button>
                                <button
                                  onClick={() => toggleCompare(p.id)}
                                  title={t("sim.compareHint")}
                                  className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-sky-400 transition hover:border-sky-500/50"
                                >
                                  <LineChart size={10} />
                                  <span>{t("sim.compareLabel")}</span>
                                  <ChevronDown size={9} className={`transition-transform ${expandedCompare[p.id] ? "rotate-180" : ""}`} />
                                </button>
                                <button
                                  onClick={() => handleClose(p)}
                                  disabled={!mark?.legs || mark.spot === null}
                                  title={!mark?.legs ? t("sim.refreshFirst") : undefined}
                                  className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-400 transition hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-40"
                                >
                                  {t("sim.close")}
                                </button>
                                <button
                                  onClick={() => handleDelete(p.id)}
                                  title={t("sim.deletePosition")}
                                  className="rounded p-1 text-slate-600 transition hover:bg-rose-950/40 hover:text-rose-400"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            </div>
                            {expandedTimeline[p.id] && (
                              <TimelinePanel
                                position={p}
                                snapshots={timelines[p.id]}
                                loading={!!timelineLoading[p.id]}
                                currentPnl={unrealized}
                                currentSpot={mark?.spot ?? null}
                                currentLabel={t("sim.currentLabel")}
                                t={t}
                              />
                            )}
                            {expandedCompare[p.id] && (
                              <ComparePanel
                                position={p}
                                trackedLegs={mark?.legs ?? null}
                                trackedSpot={mark?.spot ?? null}
                                t={t}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => setShowHistory((v) => !v)}
              className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 transition hover:text-slate-200"
            >
              <History size={12} />
              {t("sim.history")} ({closedPositions.length})
              <ArrowLeft size={10} className={`transition-transform ${showHistory ? "-rotate-90" : "rotate-180"}`} />
            </button>

            {showHistory && (
              closedPositions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-800 p-4 text-center text-[11px] text-slate-600">
                  {t("sim.noHistory")}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {closedPositions.map((p) => {
                    const regret = regrets[p.id];
                    const regretMarkValue = regret?.legs && regret.spot !== null ? computeMarkValue(regret.legs, regret.spot) : null;
                    const regretPnl = regretMarkValue !== null ? regretMarkValue - p.costBasis : null;
                    const diffVsActual = regretPnl !== null ? regretPnl - (p.realizedPnl ?? 0) : null;
                    return (
                      <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-slate-300">{p.symbol}</span>
                            <span className="text-[10px] text-slate-600">
                              {new Date(p.openedAt).toLocaleDateString()} → {p.closedAt ? new Date(p.closedAt).toLocaleDateString() : "—"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-bold ${pnlColorClass(p.realizedPnl ?? 0)}`}>
                              {fmt(p.realizedPnl ?? 0)}
                            </span>
                            <button
                              onClick={() => toggleTimeline(p)}
                              title={t("sim.reviewHint")}
                              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-amber-400 transition hover:border-amber-500/50"
                            >
                              <Target size={10} />
                              <span>{t("sim.reviewLabel")}</span>
                              <ChevronDown size={9} className={`transition-transform ${expandedTimeline[p.id] ? "rotate-180" : ""}`} />
                            </button>
                            <button
                              onClick={() => toggleCompare(p.id)}
                              title={t("sim.compareHint")}
                              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-sky-400 transition hover:border-sky-500/50"
                            >
                              <LineChart size={10} />
                              <span>{t("sim.compareLabel")}</span>
                              <ChevronDown size={9} className={`transition-transform ${expandedCompare[p.id] ? "rotate-180" : ""}`} />
                            </button>
                            <button
                              onClick={() => refreshRegret(p)}
                              disabled={regret?.loading}
                              title={t("sim.regretCheck")}
                              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-violet-400 transition hover:border-violet-500/50 disabled:opacity-40"
                            >
                              <Undo2 size={10} className={regret?.loading ? "animate-spin" : ""} />
                              {t("sim.regretCheck")}
                            </button>
                            <button
                              onClick={() => handleDelete(p.id)}
                              className="rounded p-1 text-slate-600 transition hover:bg-rose-950/40 hover:text-rose-400"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                        {regret?.error && <p className="mt-1 text-[10px] text-rose-400">{regret.error}</p>}
                        {regretPnl !== null && diffVsActual !== null && (
                          <div className="mt-1.5 rounded border border-violet-800/40 bg-violet-950/20 px-2 py-1.5 text-[10px] text-violet-300">
                            {t("sim.regretResult", {
                              pnl: fmt(regretPnl),
                              diff: fmt(diffVsActual),
                              verdict: diffVsActual >= 0 ? t("sim.regretWorse") : t("sim.regretBetter"),
                            })}
                          </div>
                        )}
                        {expandedTimeline[p.id] && (
                          <div className="-mx-3 -mb-2 mt-2">
                            <TimelinePanel
                              position={p}
                              snapshots={timelines[p.id]}
                              loading={!!timelineLoading[p.id]}
                              currentPnl={p.realizedPnl ?? null}
                              currentSpot={p.closedSpot ?? null}
                              currentLabel={t("sim.actualCloseLabel")}
                              t={t}
                            />
                          </div>
                        )}
                        {expandedCompare[p.id] && (
                          <div className="-mx-3 -mb-2 mt-2">
                            <ComparePanel
                              position={p}
                              trackedLegs={p.closedLegs ?? null}
                              trackedSpot={p.closedSpot ?? null}
                              t={t}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </>
        )}
      </div>

      {rollTarget && (
        <RollDialog
          leg={rollTarget.leg}
          spot={rollTarget.spot}
          symbol={rollTarget.pos.symbol}
          allLegs={rollTarget.pos.legs}
          onClose={() => setRollTarget(null)}
          onConfirm={handleRollConfirm}
        />
      )}
      {protectTarget && (
        <ProtectDialog
          leg={protectTarget.leg}
          spot={protectTarget.spot}
          symbol={protectTarget.pos.symbol}
          onClose={() => setProtectTarget(null)}
          onConfirm={handleProtectConfirm}
        />
      )}
      {hedgeTarget && (
        <HedgeDialog
          legs={hedgeTarget.legs}
          spot={hedgeTarget.spot}
          symbol={hedgeTarget.pos.symbol}
          onClose={() => setHedgeTarget(null)}
          onConfirm={handleHedgeConfirm}
        />
      )}
      {confirmBulkClosePositionsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-72 rounded-xl border border-rose-500/30 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-2">
              <Ban size={18} className="text-rose-400" />
              <h3 className="text-sm font-bold text-rose-200">{t("sim.bulkClosePositionConfirmTitle")}</h3>
            </div>
            <p className="mb-5 text-[12px] leading-relaxed text-slate-300">
              {t("sim.bulkClosePositionConfirmDesc", { count: selectedPositionCount })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmBulkClosePositionsOpen(false)}
                disabled={bulkClosePositionsLoading}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={bulkClosePositions}
                disabled={bulkClosePositionsLoading}
                className="flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {bulkClosePositionsLoading && <RefreshCw size={11} className="animate-spin" />}
                {t("sim.bulkClosePosition")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmBulkCloseOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-72 rounded-xl border border-rose-500/30 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-2">
              <Ban size={18} className="text-rose-400" />
              <h3 className="text-sm font-bold text-rose-200">{t("sim.bulkCloseConfirmTitle")}</h3>
            </div>
            <p className="mb-5 text-[12px] leading-relaxed text-slate-300">
              {t("sim.bulkCloseConfirmDesc", { count: selectedCount })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmBulkCloseOpen(false)}
                disabled={bulkCloseLoading}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={bulkCloseSelected}
                disabled={bulkCloseLoading}
                className="flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {bulkCloseLoading && <RefreshCw size={11} className="animate-spin" />}
                {t("sim.bulkCloseLeg")}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmResetOpen && (
        <ConfirmResetAccountDialog
          onConfirm={handleResetAccount}
          onCancel={() => setConfirmResetOpen(false)}
        />
      )}
      {showGuide && <HelpPanel moduleId="simulator" variant="gate" onClose={() => setShowGuide(false)} />}
      {helpOpen && <HelpPanel moduleId="simulator" variant="info" onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
