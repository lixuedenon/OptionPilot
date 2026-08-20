import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Plus, RefreshCw, X, Trash2, History, Search, Undo2, TrendingUp, TrendingDown, ChevronDown, MoreVertical, CalendarClock, Shield, Layers, Ban, Wallet, DollarSign } from "lucide-react";
import type { Leg } from "@/lib/types";
import { dateFromDte } from "@/lib/dateUtils";
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
  loadSnapshotsForPosition,
  adjustSimPosition,
} from "@/lib/simAccount";
import { fetchSpotPrice } from "@/lib/useStockQuote";
import { fetchLegPremium } from "@/lib/optionChain";
import { useI18n } from "@/i18n/I18nContext";
import RollDialog from "@/components/RollDialog";
import ProtectDialog from "@/components/ProtectDialog";
import HedgeDialog from "@/components/HedgeDialog";
import StrategyBadge from "@/components/StrategyBadge";
import { matchStrategy } from "@/lib/matchStrategy";

interface Props {
  onBack: () => void;
  onNewPosition: () => void;
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

function fmt(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

function fmtPct(pnl: number, costBasis: number): string {
  const base = Math.abs(costBasis);
  if (base < 0.01) return "—";
  return `${pnl >= 0 ? "+" : ""}${((pnl / base) * 100).toFixed(1)}%`;
}

function optionCode(symbol: string, dte: number, type: "call" | "put", strike: number): string {
  const iso = dateFromDte(dte);
  const yy = iso.slice(2, 4), mm = iso.slice(5, 7), dd = iso.slice(8, 10);
  return `${symbol.toUpperCase()}${yy}${mm}${dd}${type === "call" ? "C" : "P"}${strike}`;
}

// "Regret mode B" — shows the daily mark-to-market snapshots collected so
// far (see recordSnapshot in simAccount.ts) and highlights the single best
// day to have closed, compared against either the position's current
// unrealized P&L (still open) or its actual realized P&L (already closed).
// Can only ever cover days since snapshotting started for that position —
// there's no way to backfill history from before that.
function TimelinePanel({
  snapshots,
  loading,
  currentPnl,
  currentLabel,
  t,
}: {
  snapshots: PositionSnapshot[] | undefined;
  loading: boolean;
  currentPnl: number | null;
  currentLabel: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  if (loading) {
    return <div className="border-t border-slate-800/60 bg-slate-950/40 px-3 py-2 text-[10px] text-slate-500">{t("sim.loadingTimeline")}</div>;
  }
  if (!snapshots || snapshots.length === 0) {
    return <div className="border-t border-slate-800/60 bg-slate-950/40 px-3 py-2 text-[10px] text-slate-600">{t("sim.noSnapshots")}</div>;
  }

  const best = snapshots.reduce((a, b) => (b.unrealizedPnl > a.unrealizedPnl ? b : a), snapshots[0]);
  const diffFromCurrent = currentPnl !== null ? best.unrealizedPnl - currentPnl : null;

  return (
    <div className="border-t border-slate-800/60 bg-slate-950/40 px-3 py-2">
      <div className="mb-1.5 flex flex-wrap gap-1">
        {snapshots.map((s) => (
          <div
            key={s.dateISO}
            className={`rounded px-1.5 py-1 text-[9px] tabular-nums ${
              s.dateISO === best.dateISO
                ? "border border-amber-500/50 bg-amber-950/30 text-amber-300"
                : "border border-slate-800 bg-slate-900 text-slate-400"
            }`}
          >
            <div>{s.dateISO}</div>
            <div className={s.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}>{fmt(s.unrealizedPnl)}</div>
          </div>
        ))}
      </div>
      {diffFromCurrent !== null && (
        <p className="text-[10px] leading-relaxed text-amber-300">
          {diffFromCurrent > 0.01
            ? t("sim.bestPointWorse", { date: best.dateISO, pnl: fmt(best.unrealizedPnl), label: currentLabel, diff: fmt(diffFromCurrent) })
            : diffFromCurrent < -0.01
            ? t("sim.bestPointBetter", { label: currentLabel })
            : t("sim.bestPointSame")}
        </p>
      )}
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

export default function SimulatorPage({ onBack, onNewPosition }: Props) {
  const { t } = useI18n();
  const [account, setAccount] = useState<SimAccount | null>(null);
  const [positions, setPositions] = useState<SimPosition[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [startingCapitalInput, setStartingCapitalInput] = useState("10000");
  const [marks, setMarks] = useState<Record<string, MarkState>>({});
  const [regrets, setRegrets] = useState<Record<string, RegretState>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [expandedTimeline, setExpandedTimeline] = useState<Record<string, boolean>>({});
  const [timelines, setTimelines] = useState<Record<string, PositionSnapshot[]>>({});
  const [timelineLoading, setTimelineLoading] = useState<Record<string, boolean>>({});
  const [rollTarget, setRollTarget] = useState<{ pos: SimPosition; leg: Leg; spot: number } | null>(null);
  const [protectTarget, setProtectTarget] = useState<{ pos: SimPosition; leg: Leg; spot: number } | null>(null);
  const [hedgeTarget, setHedgeTarget] = useState<{ pos: SimPosition; legs: Leg[]; spot: number } | null>(null);
  const [legActionLoading, setLegActionLoading] = useState<string | null>(null); // leg id currently fetching a live price for a dialog
  const [symbolFilter, setSymbolFilter] = useState("");

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
        recordSnapshot(pos.id, spot, legs, pos.costBasis).catch(() => {});
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
  };

  const toggleTimeline = useCallback(async (posId: string) => {
    setExpandedTimeline((prev) => ({ ...prev, [posId]: !prev[posId] }));
    if (!timelines[posId]) {
      setTimelineLoading((prev) => ({ ...prev, [posId]: true }));
      const snaps = await loadSnapshotsForPosition(posId);
      setTimelines((prev) => ({ ...prev, [posId]: snaps }));
      setTimelineLoading((prev) => ({ ...prev, [posId]: false }));
    }
  }, [timelines]);

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
      const spot = await fetchSpotPrice(pos.symbol);
      const liveLegs = await Promise.all(pos.legs.map(async (l) => {
        if (l.kind === "stock" || l.disabled) return l;
        const currentDte = Math.max(0, Math.round(l.dte - daysSince(pos.openedAt)));
        try {
          const result = await fetchLegPremium(pos.symbol, l.type, l.strike, currentDte, true);
          return { ...l, premium: result.premium, dte: result.actualDte };
        } catch {
          return l;
        }
      }));
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

  if (!loaded) return null;

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-200">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-400 transition hover:border-emerald-500/50 hover:text-emerald-300"
          >
            <ArrowLeft size={14} />
          </button>
          <h1 className="text-sm font-bold text-slate-100">{t("sim.title")}</h1>
        </header>

        {!account ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center">
            <p className="mb-4 text-[12px] text-slate-400">{t("sim.setupPrompt")}</p>
            <div className="mx-auto flex max-w-xs items-center gap-2">
              <input
                type="number"
                value={startingCapitalInput}
                onChange={(e) => setStartingCapitalInput(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
              <button
                onClick={handleCreateAccount}
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
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${unrealizedPnl >= 0 ? "bg-emerald-950 text-emerald-400" : "bg-rose-950 text-rose-400"}`}>
                  {unrealizedPnl >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                </div>
                <div>
                  <div className="text-[9px] text-slate-500">{t("sim.unrealizedPnl")}</div>
                  <div className={`text-sm font-bold ${unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(unrealizedPnl)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${realizedPnlTotal >= 0 ? "bg-emerald-950 text-emerald-400" : "bg-rose-950 text-rose-400"}`}>
                  {realizedPnlTotal >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                </div>
                <div>
                  <div className="text-[9px] text-slate-500">{t("sim.realizedPnl")}</div>
                  <div className={`text-sm font-bold ${realizedPnlTotal >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(realizedPnlTotal)}</div>
                </div>
              </div>
            </div>

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
              </div>
            </div>

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
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-800 text-[9px] font-bold text-slate-400">
                            {symbol.slice(0, 2)}
                          </span>
                          <span className="font-mono text-xs font-bold text-slate-100">{symbol}</span>
                          <span className="text-[9px] text-slate-600">{posList.length} {posList.length === 1 ? t("sim.positionSingular") : t("sim.positionPlural")}</span>
                        </div>
                        <span className={`text-[11px] font-bold ${symbolPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(symbolPnl)}</span>
                      </div>
                      <table className="w-full border-collapse text-[10px]">
                        <thead>
                          <tr className="bg-slate-900/60 text-slate-500">
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
                                  <td className="px-2 py-1 tabular-nums">{l.kind === "stock" ? "—" : dateFromDte(l.dte)}</td>
                                  <td className="px-2 py-1 tabular-nums">{l.kind === "stock" ? t("sim.stockRow") : l.strike}</td>
                                  <td className="px-2 py-1 uppercase text-slate-500">{l.kind === "stock" ? "STK" : l.type}</td>
                                  <td className={`px-2 py-1 text-right tabular-nums ${signedQty < 0 ? "text-rose-400" : "text-slate-300"}`}>{signedQty}</td>
                                  <td className="px-2 py-1 text-right tabular-nums text-slate-400">{(l.kind === "stock" ? l.strike : l.premium).toFixed(2)}</td>
                                  <td className="px-2 py-1 text-right tabular-nums text-slate-200">{currentPrice !== null ? currentPrice.toFixed(2) : "—"}</td>
                                  <td className="px-2 py-1 text-right tabular-nums text-slate-200">
                                    {legMarkValue !== null ? (legMarkValue < 0 ? `(${Math.abs(legMarkValue).toFixed(2)})` : legMarkValue.toFixed(2)) : "—"}
                                  </td>
                                  <td className={`px-2 py-1 text-right tabular-nums font-semibold ${legPnl !== null ? (legPnl >= 0 ? "text-emerald-400" : "text-rose-400") : "text-slate-600"}`}>
                                    {legPnl !== null ? fmt(legPnl) : "—"}
                                  </td>
                                  <td className={`px-2 py-1 text-right tabular-nums ${legPnl !== null ? (legPnl >= 0 ? "text-emerald-400" : "text-rose-400") : "text-slate-600"}`}>
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
                        return (
                          <div key={p.id}>
                            <div className="flex items-center justify-between gap-2 border-t border-slate-800/60 bg-slate-900/40 px-3 py-1.5">
                              <div className="flex items-center gap-2 text-[9px] text-slate-500">
                                {strategyName && <StrategyBadge name={strategyName} customPresets={[]} />}
                                <span>{daysSince(p.openedAt)} {t("compare.days")}</span>
                                <span>{t("sim.costBasis")} {fmt(p.costBasis)}</span>
                                {mark?.loading && (
                                  <span className="flex items-center gap-1 text-sky-400">
                                    <RefreshCw size={9} className="animate-spin" />
                                    {t("sim.refreshing")}
                                  </span>
                                )}
                                {!mark?.loading && unrealized !== null && (
                                  <span className={unrealized >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                    {t("sim.unrealizedPnl")} {fmt(unrealized)}
                                  </span>
                                )}
                                {mark?.error && <span className="text-rose-400">{mark.error}</span>}
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => toggleTimeline(p.id)}
                                  title={t("sim.viewTimeline")}
                                  className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-amber-400 transition hover:border-amber-500/50"
                                >
                                  <TrendingUp size={10} />
                                  <ChevronDown size={9} className={`transition-transform ${expandedTimeline[p.id] ? "rotate-180" : ""}`} />
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
                                snapshots={timelines[p.id]}
                                loading={!!timelineLoading[p.id]}
                                currentPnl={unrealized}
                                currentLabel={t("sim.currentLabel")}
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
                            <span className={`text-[11px] font-bold ${(p.realizedPnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              {fmt(p.realizedPnl ?? 0)}
                            </span>
                            <button
                              onClick={() => toggleTimeline(p.id)}
                              title={t("sim.viewTimeline")}
                              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-amber-400 transition hover:border-amber-500/50"
                            >
                              <TrendingUp size={10} />
                              <ChevronDown size={9} className={`transition-transform ${expandedTimeline[p.id] ? "rotate-180" : ""}`} />
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
                              snapshots={timelines[p.id]}
                              loading={!!timelineLoading[p.id]}
                              currentPnl={p.realizedPnl ?? null}
                              currentLabel={t("sim.actualCloseLabel")}
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
    </div>
  );
}