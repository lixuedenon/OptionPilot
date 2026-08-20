import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Plus, Layers, Save, Settings2, RefreshCw, TrendingUp, TrendingDown, ChevronDown, Trash2, History, Clock, Download, Upload, FileSymlink, Unlink, X, Database, HelpCircle, DollarSign, Ban, Wallet } from "lucide-react";
import type { Leg, Shifts } from "@/lib/types";
import { priceCombo, probabilityOfProfit, weightedAvgIV, impliedSpotFromPremiums } from "@/lib/pricing";
import { PRESET_GROUPS } from "@/lib/presets";
import { matchStrategy } from "@/lib/matchStrategy";
import LegRow from "@/components/LegRow";
import ShiftSliders from "@/components/ShiftSliders";
import PayoffChart, { type AlertInfo } from "@/components/PayoffChart";
import PresetPicker from "@/components/PresetPicker";
import SavePresetDialog from "@/components/SavePresetDialog";
import StrategyBadge from "@/components/StrategyBadge";
import { useStockQuote } from "@/lib/useStockQuote";
import { loadRecentSymbols, addRecentSymbol } from "@/lib/recentSymbols";
import { saveStrategy, overwriteStrategy, addTrackedSnapshot, updateSnapshotTime, deleteTrackedSnapshot, type SavedStrategy, type TrackedSnapshot } from "@/lib/savedStrategies";
import SaveStrategyDialog from "@/components/SaveStrategyDialog";
import ManageStrategiesDialog from "@/components/ManageStrategiesDialog";
import DropdownMenu from "@/components/DropdownMenu";
import RollDialog from "@/components/RollDialog";
import ProtectDialog from "@/components/ProtectDialog";
import HedgeDialog from "@/components/HedgeDialog";
import { exportAllData, importAllData } from "@/lib/dataTransfer";
import { useAutoSync } from "@/hooks/useAutoSync";
import { useCustomPresets } from "@/hooks/useCustomPresets";
import { useSavedStrategies } from "@/hooks/useSavedStrategies";
import { nearestFridayDte } from "@/lib/dateUtils";
import { getOptionChain, peekResolvedChain, nearestStrikeToSpot, resolveFromCache } from "@/lib/optionChain";
import { useI18n } from "@/i18n/I18nContext";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { AlertCard, ConfirmBulkDeleteDialog, ConfirmClearDialog, ConfirmReplacePresetDialog, ConfirmSaveTrackedDialog, ConfirmSnapshotDialog, HelpPanel, ImpliedSpotInfoPanel } from "@/components/dialogs";

let idc = 0;
const uid = () => `leg-${Date.now()}-${idc++}`;

const blankLeg = (strikeHint = 0): Leg => ({
  id: uid(),
  action: "buy",
  type: "call",
  strike: strikeHint,
  dte: nearestFridayDte(30),
  premium: 0,
});

// Every distinct DTE used across all built-in presets (e.g. calendar/diagonal
// spreads mix 14/45-day legs with the usual 30-day default). Computed once so
// the cache-warming effect can pre-fetch a real chain for each — otherwise a
// preset leg whose DTE isn't the common 30-day default would still show a
// placeholder strike/premium until its own async fetch completes.
const PRESET_DTE_SET = Array.from(new Set(
  PRESET_GROUPS.flatMap((g) => g.items.flatMap((item) =>
    item.legs().filter((l) => l.kind !== "stock").map((l) => l.dte)
  ))
));

function daysSince(ts: number): number {
  return (Date.now() - ts) / 86400000;
}

function formatDateInput(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateInput(value: string): number | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.getTime();
}

function serializeStrategyState(sym: string, ls: Leg[], sh: Shifts, oa: number): string {
  const norm = (l: Leg) => `${l.action}-${l.type}-${l.strike}-${l.dte}-${l.premium}-${l.kind ?? "option"}-${l.shares ?? 100}-${l.qty ?? 1}-${l.disabled ?? false}`;
  return `${sym}|${ls.map(norm).join("|")}|${sh.dS}|${sh.dT}|${sh.dV}|${oa}`;
}

interface AppProps {
  onBackHome?: () => void;
  autoOpenManage?: boolean;
  simOrigin?: boolean;
  onConfirmSimOpen?: (payload: { symbol: string; legs: Leg[]; spot: number }) => void;
  onCancelSimOrigin?: () => void;
  // Lets analysis mode push the current combo straight into a new simulated
  // position without first routing through the simulator's "New Position"
  // flow (that flow is the reverse direction: simulator → analysis → back).
  // Returns needsSetup when there's no simulated account yet, so the caller
  // (Shell.tsx) can send the person to set one up instead of silently
  // failing.
  onAddToSimAccount?: (payload: { symbol: string; legs: Leg[]; spot: number }) => Promise<{ ok: boolean; needsSetup?: boolean }>;
}

export default function App({ onBackHome, autoOpenManage, simOrigin, onConfirmSimOpen, onCancelSimOrigin, onAddToSimAccount }: AppProps = {}) {
  const [symbol, setSymbol] = useState("");
  const [spot, setSpot] = useState(0);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [shifts, setShifts] = useState<Shifts>({ dS: 0, dT: 0, dV: 0 });
  const {
    customPresets,
    setCustomPresets,
    saveDialogOpen,
    setSaveDialogOpen,
    reload: reloadCustomPresets,
    addPreset: addCustomPresetToLibrary,
    removePreset: handleDeleteCustom,
  } = useCustomPresets();
  const [recentSymbols, setRecentSymbols] = useState<string[]>([]);
  const [symbolDropdownOpen, setSymbolDropdownOpen] = useState(false);
  const [alert, setAlert] = useState<AlertInfo>({ zone: null, pnl: 0, netCredit: 0, capturedPct: 0, days: 0, stock: false, maxProfit: 0, maxLoss: 0 });
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [showImpliedInfo, setShowImpliedInfo] = useState(false);
  const [correctedSpot, setCorrectedSpot] = useState<number | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const {
    savedStrategies,
    setSavedStrategies,
    saveStrategyOpen,
    setSaveStrategyOpen,
    manageStrategyOpen,
    setManageStrategyOpen,
    manageMode,
    setManageMode,
    strategyBaseline,
    setStrategyBaseline,
    reload: reloadSavedStrategies,
    handleDeleteStrategy,
    handleRenameStrategy,
    handleReorderStrategies,
    handleToggleStar,
  } = useSavedStrategies();
  const [trackedLegs, setTrackedLegs] = useState<Leg[] | null>(null);
  const [trackedSpot, setTrackedSpot] = useState<number | null>(null);
  const [trackedDaysElapsed, setTrackedDaysElapsed] = useState<number>(0);
  const [trackingStrategyId, setTrackingStrategyId] = useState<string | null>(null);
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);
  const [trackedDirty, setTrackedDirty] = useState(false);
  const [confirmSaveTrackedOpen, setConfirmSaveTrackedOpen] = useState(false);
  const [openingAt, setOpeningAt] = useState<number>(() => Date.now());
  const {
    autoSyncName,
    autoSyncSupported,
    autoSyncError,
    setAutoSyncError,
    syncNow,
    unlinkBackup,
    linkBackup,
  } = useAutoSync({ savedStrategies, customPresets, recentSymbols });
  const { t } = useI18n();

  const [helpOpen, setHelpOpen] = useState(false);
  const [rollTarget, setRollTarget] = useState<Leg | null>(null);
  const [protectTarget, setProtectTarget] = useState<Leg | null>(null);
  const [hedgeOpen, setHedgeOpen] = useState(false);
  const [selectedLegIds, setSelectedLegIds] = useState<Set<string>>(new Set());
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);
  const pendingPresetAction = useRef<{ name: string; rawLegs: Leg[] } | null>(null);
  const [confirmPresetOpen, setConfirmPresetOpen] = useState(false);
  const pendingPresetReplace = useRef<Leg[] | null>(null);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const symbolWrapRef = useRef<HTMLDivElement>(null);
  const pendingPreset = useRef<{ name: string; rawLegs: Leg[] } | null>(null);
  const legBaseSpot = useRef(0);
  const legBaseSymbol = useRef("");
  const spotManuallySet = useRef(false);
  const trackedLegsRef = useRef<Leg[] | null>(null);
  trackedLegsRef.current = trackedLegs;



  const { quote, loading: quoteLoading, error: quoteError, refetch } = useStockQuote(symbol);

  const reloadData = useCallback(async () => {
    const [, , r] = await Promise.all([
      reloadCustomPresets(),
      reloadSavedStrategies(),
      loadRecentSymbols(),
    ]);
    setRecentSymbols(r);
  }, [reloadCustomPresets, reloadSavedStrategies]);

  useEffect(() => {
    reloadData();
  }, [reloadData]);

  // Arrived here via the "Tracking" module card on the home page — jump
  // straight into the manage-strategies dialog so the user can pick a saved
  // strategy to track, reusing the existing tracking flow as-is.
  useEffect(() => {
    if (autoOpenManage) {
      setManageStrategyOpen(true);
      setManageMode("track");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (symbolWrapRef.current && !symbolWrapRef.current.contains(e.target as Node)) {
        setSymbolDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (quote && quote.price > 0 && symbol.trim()) {
      addRecentSymbol(symbol).then(setRecentSymbols);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  // Warm the option-chain cache for every expiry a new leg or preset could
  // need, as soon as a symbol is entered — so "+ Add Leg" and applying a
  // preset can both resolve real, listed strikes (and real premiums) the
  // instant they're used, instead of showing a placeholder that gets
  // corrected a moment later.
  useEffect(() => {
    const sym = symbol.trim();
    if (!sym) return;
    const timer = setTimeout(() => {
      const targets = new Set([30, ...PRESET_DTE_SET].map((d) => nearestFridayDte(d)));
      for (const dte of targets) {
        getOptionChain(sym, dte).catch(() => {
          // Silent: callers fall back to a placeholder, and the per-leg
          // auto-fill effect will still try to correct it once a leg exists.
        });
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [symbol]);

  useEffect(() => {
    if (!quote || quote.price <= 0) return;
    if (spot <= 0) { setSpot(quote.price); spotManuallySet.current = false; }
    if (trackedLegsRef.current !== null) {
      setTrackedSpot(quote.price);
      return;
    }
    if (spotManuallySet.current) return;
    if (pendingPreset.current) {
      const scale = quote.price / 100;
      const scaled = pendingPreset.current.rawLegs.map((l) => {
        if (l.kind === "stock") {
          return { ...l, id: uid(), strike: Math.round(quote.price * 100) / 100, shares: l.shares ?? 100 };
        }
        const targetDte = nearestFridayDte(l.dte);
        const targetStrike = Math.round(l.strike * scale * 2) / 2;
        const resolved = symbol.trim() ? resolveFromCache(symbol.trim(), l.type, targetStrike, targetDte) : null;
        return {
          ...l,
          id: uid(),
          strike: resolved ? resolved.strike : targetStrike,
          premium: resolved ? resolved.premium : 0, // falls back to 0; per-leg auto-fill effect corrects it if not yet cached
          dte: resolved ? resolved.dte : targetDte,
        };
      });
      setLegs(scaled);
      setShifts({ dS: 0, dT: 0, dV: 0 });
      pendingPreset.current = null;
      legBaseSpot.current = quote.price;
      legBaseSymbol.current = symbol;
    } else if (legs.length > 0 && symbol !== legBaseSymbol.current && legBaseSpot.current > 0) {
      const ratio = quote.price / legBaseSpot.current;
      const sym = symbol.trim();
      setLegs((prev) => prev.map((l) => {
        if (l.kind === "stock") {
          return { ...l, strike: Math.round(quote.price * 100) / 100 };
        }
        const targetStrike = Math.round(l.strike * ratio * 2) / 2;
        // Ratio-scaling a strike from one underlying's grid rarely lands on a
        // real, listed strike for the NEW symbol — prefer a real chain lookup
        // when it's already warmed, and fall back to the old ratio guess
        // (with premium reset to 0) so the per-leg auto-fill effect corrects
        // it shortly after if the chain isn't cached yet.
        const resolved = sym ? resolveFromCache(sym, l.type, targetStrike, l.dte) : null;
        return {
          ...l,
          strike: resolved ? resolved.strike : targetStrike,
          premium: resolved ? resolved.premium : 0,
        };
      }));
      legBaseSpot.current = quote.price;
      legBaseSymbol.current = symbol;
    }
    setSpot(quote.price);
    legBaseSpot.current = quote.price;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, spot]);

  const priceChange = quote && quote.previousClose > 0
    ? quote.price - quote.previousClose : null;
  const changePct = priceChange !== null && quote!.previousClose > 0
    ? (priceChange / quote!.previousClose) * 100 : null;

  const activeLegs = useMemo(() => legs.filter((l) => !l.disabled), [legs]);
  const strategyName = useMemo(() => matchStrategy(activeLegs, spot, customPresets), [activeLegs, spot, customPresets]);
  const canSaveStrategy = activeLegs.length > 0 && serializeStrategyState(symbol, legs, shifts, openingAt) !== strategyBaseline;
  const result = useMemo(() => priceCombo(activeLegs, shifts, spot), [activeLegs, shifts, spot]);
  const scenarioPriceById = useMemo(() => {
    const m = new Map<string, number>();
    for (const pl of result.perLeg) m.set(pl.leg.id, pl.shifted);
    return m;
  }, [result]);

  const { pop, breakevens } = useMemo(() => probabilityOfProfit(activeLegs, spot), [activeLegs, spot]);

  const activeTrackedLegs = useMemo(() => trackedLegs?.filter((l) => !l.disabled) ?? null, [trackedLegs]);

  const isCompareMode = trackedLegs !== null;

  // In compare mode, back-solve the implied stock price from the premiums the user
  // enters for each tracked leg. Different premiums imply different stock prices —
  // e.g. if a short straddle's call premium drops while put premium rises, the stock
  // has fallen. Falls back to the live quote when back-solve fails (e.g. only stock legs).
  const impliedSpot = useMemo(() => {
    if (!isCompareMode || !activeTrackedLegs || !activeLegs || spot <= 0) return null;
    return impliedSpotFromPremiums(activeLegs, activeTrackedLegs, spot);
  }, [isCompareMode, activeTrackedLegs, activeLegs, spot]);

  const effectiveTrackedSpot = correctedSpot ?? impliedSpot ?? trackedSpot ?? spot;

  // Days elapsed: derived from the DTE difference between opening and tracked legs,
  // so it stays in sync when the user manually adjusts the tracked legs' DTE.
  const effectiveDaysElapsed = useMemo(() => {
    if (!isCompareMode || activeLegs.length === 0 || !activeTrackedLegs || activeTrackedLegs.length === 0) return trackedDaysElapsed;
    const openMaxDte = Math.max(...activeLegs.filter((l) => l.kind !== "stock").map((l) => l.dte));
    const trackedMaxDte = Math.max(...activeTrackedLegs.filter((l) => l.kind !== "stock").map((l) => l.dte));
    const fromDte = Math.max(0, openMaxDte - trackedMaxDte);
    return Math.max(fromDte, trackedDaysElapsed);
  }, [isCompareMode, activeLegs, activeTrackedLegs, trackedDaysElapsed]);

  const trackedResult = useMemo(() => {
    if (!isCompareMode || !activeTrackedLegs) return null;

    const currentSpot = effectiveTrackedSpot;
    let shiftedValue = 0;
    let netPremium = 0;
    const perLeg = activeTrackedLegs.map((leg, index) => {
      const openingLeg = activeLegs[index];
      const sign = leg.action === "buy" ? 1 : -1;
      const openingSign = openingLeg?.action === "buy" ? 1 : -1;
      const shifted = leg.kind === "stock" ? sign * (currentSpot - leg.strike) : sign * leg.premium;
      const base = openingLeg
        ? openingLeg.kind === "stock"
          ? openingSign * (spot - openingLeg.strike)
          : openingSign * openingLeg.premium
        : 0;
      const change = shifted - base;

      shiftedValue += shifted;
      netPremium += base;
      return {
        leg,
        base,
        shifted,
        change: { delta: 0, gamma: 0, theta: 0, vega: 0, total: change },
      };
    });

    return {
      netPremium,
      shiftedValue,
      change: shiftedValue - netPremium,
      breakdown: { delta: 0, gamma: 0, theta: 0, vega: 0, total: shiftedValue - netPremium },
      perLeg,
    };
  }, [isCompareMode, activeTrackedLegs, activeLegs, effectiveTrackedSpot, spot]);
  const trackedStrategy = trackingStrategyId ? savedStrategies.find((s) => s.id === trackingStrategyId) : undefined;

  // Volatility difference between opening and tracked combos (in percentage points).
  // Uses the current tracked legs (with time-adjusted DTE and user-updated premium) to back-solve
  // the current IV, compared against the opening IV from the original legs.
  // If the user updates the tracked premium to reflect the current market price, this shows the
  // real implied vol change. If premium is unchanged, the IV shift reflects time decay's effect.
  const trackedVolShift = useMemo(() => {
    if (!isCompareMode || !activeTrackedLegs || spot <= 0) return undefined;
    const openIV = weightedAvgIV(activeLegs, spot);
    const trackedIV = weightedAvgIV(activeTrackedLegs, effectiveTrackedSpot);
    if (openIV <= 0 || trackedIV <= 0) return undefined;
    return (trackedIV - openIV) * 100;
  }, [isCompareMode, activeTrackedLegs, activeLegs, spot, effectiveTrackedSpot]);

  const handleAddCustom = useCallback(async (data: { name: string; desc: string; market: string; stocks: string; direction: string }) => {
    const base = spot > 0 ? spot : (legs[0]?.strike || 100);
    const norm = base / 100;
    const normalizedLegs = activeLegs.map((l) => {
      if (l.kind === "stock") {
        return { ...l, strike: Math.round((l.strike / norm) * 100) / 100 };
      }
      return {
        ...l,
        strike: Math.round((l.strike / norm) * 100) / 100,
        premium: Math.round((l.premium / norm) * 100) / 100,
      };
    });
    await addCustomPresetToLibrary(data, normalizedLegs);
  }, [legs, spot, activeLegs, addCustomPresetToLibrary]);

  // Push the current analysis-mode combo straight into a new simulated
  // position. Distinct from the simOrigin flow (which starts FROM the
  // simulator and builds a combo here) — this is the reverse shortcut for
  // when someone already has a combo built in ordinary analysis mode and
  // wants to paper-trade it without rebuilding it a second time.
  const [addingToSim, setAddingToSim] = useState(false);
  const handleAddToSimAccount = useCallback(async () => {
    if (!onAddToSimAccount || activeLegs.length === 0 || spot <= 0) return;
    setAddingToSim(true);
    try {
      const result = await onAddToSimAccount({ symbol: symbol.trim(), legs: activeLegs, spot });
      if (!result.ok && result.needsSetup) {
        window.alert(t("sim.needSetupFirst"));
      }
    } finally {
      setAddingToSim(false);
    }
  }, [onAddToSimAccount, activeLegs, spot, symbol, t]);

  const updateLeg = (id: string, patch: Partial<Leg>) =>
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const toggleLeg = (id: string) => {
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, disabled: !l.disabled } : l)));
  };
  const deleteLeg = (id: string) => {
    setLegs((prev) => prev.filter((l) => l.id !== id));
    setSelectedLegIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // ── Batch selection (analysis + tracking's shared open-combo list) ──
  const toggleLegSelection = (id: string) => {
    setSelectedLegIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearLegSelection = () => setSelectedLegIds(new Set());
  const selectAllLegs = () => setSelectedLegIds(new Set(legs.map((l) => l.id)));

  const selectedLegsList = useMemo(
    () => legs.filter((l) => selectedLegIds.has(l.id)),
    [legs, selectedLegIds],
  );
  const selectedCount = selectedLegsList.length;
  const allSelectedDisabled = selectedCount > 0 && selectedLegsList.every((l) => l.disabled);

  // Toggle disable for every currently-selected leg in one go. Mirrors the
  // per-row block/unblock: if every selected leg is already blocked, this
  // unblocks them all; otherwise it blocks them all (so a mixed selection
  // always resolves to "block everything selected" rather than a confusing
  // per-leg flip).
  const bulkToggleDisable = () => {
    if (selectedCount === 0) return;
    setLegs((prev) => prev.map((l) => (selectedLegIds.has(l.id) ? { ...l, disabled: !allSelectedDisabled } : l)));
  };

  const requestBulkDelete = () => {
    if (selectedCount === 0) return;
    setConfirmBulkDeleteOpen(true);
  };
  const confirmBulkDelete = () => {
    setLegs((prev) => prev.filter((l) => !selectedLegIds.has(l.id)));
    setConfirmBulkDeleteOpen(false);
    clearLegSelection();
  };

  const handleRoll = (legId: string) => {
    const leg = legs.find((l) => l.id === legId);
    if (leg) setRollTarget(leg);
  };
  const handleRollConfirm = (newLeg: Leg) => {
    if (!rollTarget) return;
    setLegs((prev) => prev.map((l) => l.id === rollTarget.id ? { ...l, disabled: true } : l));
    setLegs((prev) => [...prev, newLeg]);
    setRollTarget(null);
  };

  const handleProtect = (legId: string) => {
    const leg = legs.find((l) => l.id === legId);
    if (leg) setProtectTarget(leg);
  };
  const handleProtectConfirm = (protectLeg: Leg) => {
    setLegs((prev) => [...prev, protectLeg]);
    setProtectTarget(null);
  };

  const handleHedge = () => setHedgeOpen(true);
  const handleHedgeConfirm = (hedgeLeg: Leg) => {
    setLegs((prev) => [...prev, hedgeLeg]);
    setHedgeOpen(false);
  };

  const moveLeg = (index: number, direction: -1 | 1) => {
    setLegs((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const arr = [...prev];
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr;
    });
  };
  const moveTrackedLeg = (index: number, direction: -1 | 1) => {
    setTrackedLegs((prev) => {
      if (!prev) return prev;
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const arr = [...prev];
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr;
    });
  };
  const addLeg = () => {
    let strikeHint = spot > 0 ? Math.round(spot * 2) / 2 : 0;
    if (spot > 0 && symbol.trim()) {
      const cached = peekResolvedChain(symbol.trim(), nearestFridayDte(30));
      if (cached) {
        const atm = nearestStrikeToSpot(cached.calls, spot);
        if (atm !== null) strikeHint = atm;
      }
    }
    // Legs added purely via "+" (never through a preset) never had these refs
    // set, so a later symbol change had nothing to compare against and the
    // strike silently stayed frozen. Initialize them here the first time.
    if (spot > 0 && legBaseSpot.current === 0) {
      legBaseSpot.current = spot;
      legBaseSymbol.current = symbol;
    }
    setLegs((prev) =>
      prev.length < 10
        ? [...prev, blankLeg(strikeHint)]
        : prev
    );
  };
  const clearAllLegs = () => {
    setConfirmClearOpen(false);
    if (isCompareMode && trackedDirty) {
      setConfirmSaveTrackedOpen(true);
      return;
    }
    doClearAll();
  };

  const applyPreset = (rawLegs: Leg[]) => {
    if (spot > 0) {
      const scale = spot / 100;
      const scaled = rawLegs.map((l) => {
        if (l.kind === "stock") {
          return { ...l, id: uid(), strike: Math.round(spot * 100) / 100, shares: l.shares ?? 100 };
        }
        const targetDte = nearestFridayDte(l.dte);
        const targetStrike = Math.round(l.strike * scale * 2) / 2;
        const resolved = symbol.trim() ? resolveFromCache(symbol.trim(), l.type, targetStrike, targetDte) : null;
        return {
          ...l,
          id: uid(),
          strike: resolved ? resolved.strike : targetStrike,
          premium: resolved ? resolved.premium : 0, // falls back to 0; per-leg auto-fill effect corrects it if not yet cached
          dte: resolved ? resolved.dte : targetDte,
        };
      });
      setLegs(scaled);
      setShifts({ dS: 0, dT: 0, dV: 0 });
      pendingPreset.current = null;
      legBaseSpot.current = spot;
      legBaseSymbol.current = symbol;
      spotManuallySet.current = false;
    } else {
      pendingPreset.current = { name: "", rawLegs };
      setLegs(rawLegs.map((l) => ({ ...l, id: uid(), dte: l.kind === "stock" ? l.dte : nearestFridayDte(l.dte) })));
      setShifts({ dS: 0, dT: 0, dV: 0 });
    }
    setTrackedLegs(null);
    setTrackingStrategyId(null);
    setTrackedSpot(null);
    setActiveSnapshotId(null);
    setTrackedDirty(false);
    setTrackedDaysElapsed(0);
    setOpeningAt(Date.now());
    setStrategyBaseline(null);
    setCorrectedSpot(null);
    clearLegSelection();
  };

  const doClearAll = () => {
    setLegs([]);
    setShifts({ dS: 0, dT: 0, dV: 0 });
    setTrackedLegs(null);
    setTrackingStrategyId(null);
    setTrackedSpot(null);
    setActiveSnapshotId(null);
    setCorrectedSpot(null);
    setTrackedDirty(false);
    setOpeningAt(Date.now());
    legBaseSpot.current = 0;
    legBaseSymbol.current = "";
    setStrategyBaseline(null);
    clearLegSelection();
  };

  const updateTrackedLeg = (id: string, patch: Partial<Leg>) => {
    setTrackedLegs((prev) => prev?.map((l) => (l.id === id ? { ...l, ...patch } : l)) ?? null);
    setTrackedDirty(true);
    if (patch.premium !== undefined) setCorrectedSpot(null);
  }

  const handleCorrectSpot = useCallback(async () => {
    setCorrecting(true);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stock-quote?symbol=${encodeURIComponent(symbol.trim())}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${resp.status})`);
      }
      const data = await resp.json();
      if (typeof data.price !== "number" || isNaN(data.price) || data.price <= 0) {
        throw new Error("Invalid price data");
      }
      setCorrectedSpot(data.price);
    } catch (e) {
      console.error("Failed to fetch quote for correction:", e);
    } finally {
      setCorrecting(false);
    }
  }, [symbol]);

  const comboDirection = activeLegs.length > 0 && activeLegs.every((l) => l.action === "buy") ? "buy" : "sell";

  const handleSaveStrategy = useCallback(async (filename: string) => {
    const updated = await saveStrategy({ filename, symbol, spot, legs: activeLegs, shifts, openingAt });
    setSavedStrategies(updated);
    setSaveStrategyOpen(false);
    setStrategyBaseline(serializeStrategyState(symbol, legs, shifts, openingAt));
    if (pendingPresetReplace.current) {
      const rawLegs = pendingPresetReplace.current;
      pendingPresetReplace.current = null;
      applyPreset(rawLegs);
    }
  }, [symbol, spot, legs, activeLegs, shifts, openingAt, applyPreset]);

  const handleOverwriteStrategy = useCallback(async (id: string, filename: string) => {
    const updated = await overwriteStrategy(id, { filename, symbol, spot, legs: activeLegs, shifts, openingAt });
    setSavedStrategies(updated);
    setSaveStrategyOpen(false);
    setStrategyBaseline(serializeStrategyState(symbol, legs, shifts, openingAt));
    if (pendingPresetReplace.current) {
      const rawLegs = pendingPresetReplace.current;
      pendingPresetReplace.current = null;
      applyPreset(rawLegs);
    }
  }, [symbol, spot, legs, activeLegs, shifts, openingAt, applyPreset]);

  const handleTrack = useCallback(async (s: SavedStrategy) => {
    setSymbol(s.symbol);
    setLegs(s.legs.map((l) => ({ ...l, id: uid() })));
    setShifts({ dS: 0, dT: 0, dV: 0 });
    setSpot(s.spot);
    setOpeningAt(s.openingAt ?? s.createdAt);
    legBaseSpot.current = s.spot;
    legBaseSymbol.current = s.symbol;
    spotManuallySet.current = true;

    const daysElapsed = daysSince(s.openingAt ?? s.createdAt);
    setTrackedDaysElapsed(daysElapsed);
    setTrackedLegs(
      s.legs.map((l) => ({
        ...l,
        id: uid(),
        dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - daysElapsed),
      })),
    );
    setTrackedSpot(s.spot);
    setCorrectedSpot(null);
    setActiveSnapshotId(null);
    setTrackingStrategyId(s.id);
    setTrackedDirty(false);
    setManageStrategyOpen(false);
    setStrategyBaseline(serializeStrategyState(s.symbol, s.legs, { dS: 0, dT: 0, dV: 0 }, s.openingAt ?? s.createdAt));
    clearLegSelection();
  }, []);

  const handleSaveTracked = useCallback(async () => {
    if (!trackingStrategyId || !trackedLegs) return;
    const updated = await addTrackedSnapshot(trackingStrategyId, trackedLegs, trackedSpot ?? spot, Date.now());
    setSavedStrategies(updated);
    const updatedStrategy = updated.find((s) => s.id === trackingStrategyId);
    const newSnaps = updatedStrategy?.trackedSnapshots ?? [];
    if (newSnaps.length > 0) setActiveSnapshotId(newSnaps[newSnaps.length - 1].id);
    setTrackedDirty(false);
  }, [trackingStrategyId, trackedLegs, trackedSpot, spot]);

  const handleSelectSnapshot = useCallback((snap: TrackedSnapshot) => {
    const daysElapsed = daysSince(snap.savedAt);
    setTrackedDaysElapsed(daysElapsed);
    setTrackedLegs(
      snap.legs.map((l) => ({
        ...l,
        id: uid(),
        dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - daysElapsed),
      })),
    );
    setTrackedSpot(snap.spot);
    setCorrectedSpot(null);
    setActiveSnapshotId(snap.id);
    setTrackedDirty(false);
  }, []);

  const handleDeleteSnapshot = useCallback(async (snapshotId: string) => {
    if (!trackingStrategyId) return;
    const updated = await deleteTrackedSnapshot(trackingStrategyId, snapshotId);
    setSavedStrategies(updated);
    const updatedStrategy = updated.find((s) => s.id === trackingStrategyId);
    const remainingSnaps = updatedStrategy?.trackedSnapshots ?? [];
    if (remainingSnaps.length === 0) {
      setActiveSnapshotId(null);
    } else {
      const last = remainingSnaps[remainingSnaps.length - 1];
      handleSelectSnapshot(last);
    }
  }, [trackingStrategyId, handleSelectSnapshot]);

  const handleUpdateSnapshotTime = useCallback(async (snapshotId: string, savedAt: number) => {
    if (!trackingStrategyId) return;
    const updated = await updateSnapshotTime(trackingStrategyId, snapshotId, savedAt);
    setSavedStrategies(updated);
    const daysElapsed = daysSince(savedAt);
    setTrackedDaysElapsed(daysElapsed);
    if (trackedLegs) {
      setTrackedLegs(
        trackedLegs.map((l) => ({
          ...l,
          id: uid(),
          dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - daysElapsed),
        })),
      );
    }
  }, [trackingStrategyId, trackedLegs]);

  const handleOpenStrategy = useCallback((s: SavedStrategy) => {
    setSymbol(s.symbol);
    setLegs(s.legs.map((l) => ({ ...l, id: uid() })));
    setShifts(s.shifts);
    setSpot(s.spot);
    setOpeningAt(s.openingAt ?? s.createdAt);
    legBaseSpot.current = s.spot;
    legBaseSymbol.current = s.symbol;
    spotManuallySet.current = true;
    setTrackedLegs(null);
    setTrackingStrategyId(null);
    setTrackedSpot(null);
    setActiveSnapshotId(null);
    setTrackedDaysElapsed(0);
    setCorrectedSpot(null);
    setManageStrategyOpen(false);
    setStrategyBaseline(serializeStrategyState(s.symbol, s.legs, s.shifts, s.openingAt ?? s.createdAt));
    clearLegSelection();
  }, [quote]);

  const legToolbar = (
    <>
      <button
        onClick={addLeg}
        disabled={legs.length >= 10}
        title={t("leg.addLeg")}
        className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={12} />
      </button>
      <button
        onClick={() => legs.length > 0 && setConfirmClearOpen(true)}
        disabled={legs.length === 0}
        title={t("leg.clearAll")}
        className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-slate-400 transition hover:border-rose-500 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 size={12} />
      </button>
      <DropdownMenu label={t("toolbar.presetLabel")} icon={<Layers size={11} />}>
        {(close) => (
          <>
            <button
              onClick={() => { close(); setSaveStrategyOpen(true); }}
              disabled={!canSaveStrategy}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save size={12} className="text-emerald-400" /> {t("toolbar.saveStrategy")}
            </button>
            <button
              onClick={() => { close(); setManageMode("open"); setManageStrategyOpen(true); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
            >
              <Settings2 size={12} className="text-amber-400" /> {t("toolbar.manageStrategy")}
            </button>
            {isCompareMode && (
              <>
                <div className="my-1 border-t border-slate-800" />
                <button
                  onClick={() => { close(); handleSaveTracked(); }}
                  disabled={!trackedDirty}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-emerald-400 transition hover:bg-emerald-950/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Save size={12} /> {t("toolbar.saveTracked")}
                </button>
              </>
            )}
          </>
        )}
      </DropdownMenu>
      {!isCompareMode && !simOrigin && onAddToSimAccount && (
        <button
          onClick={handleAddToSimAccount}
          disabled={activeLegs.length === 0 || spot <= 0 || addingToSim}
          title={t("toolbar.addToSim")}
          className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] font-semibold text-slate-400 transition hover:border-emerald-500/50 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {addingToSim ? <RefreshCw size={12} className="animate-spin" /> : <Wallet size={12} />}
          {t("toolbar.addToSim")}
        </button>
      )}
    </>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-200">
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={simOrigin ? onCancelSimOrigin : onBackHome}
            disabled={!onBackHome && !onCancelSimOrigin}
            title={simOrigin ? t("sim.cancelOrigin") : t("home.backToHome")}
            className="flex items-center rounded transition enabled:hover:opacity-80 disabled:cursor-default"
          >
            <img
              src="/image copy 2.png"
              alt="OptionPilot"
              className="h-12 w-auto shrink-0 object-contain"
            />
          </button>

          <PresetPicker
            customPresets={customPresets}
            onDeleteCustom={handleDeleteCustom}
            onSelect={(preset) => {
              const rawLegs = preset.legs();
              if (isCompareMode && trackedDirty) {
                pendingPresetAction.current = { name: typeof preset.name === "string" ? preset.name : preset.name.zh, rawLegs };
                setConfirmPresetOpen(true);
                return;
              }
              if (!isCompareMode && legs.length > 0 && canSaveStrategy) {
                pendingPresetReplace.current = rawLegs;
                setConfirmReplaceOpen(true);
                return;
              }
              applyPreset(rawLegs);
            }}
          />

          <div ref={symbolWrapRef} className="relative flex items-center gap-1.5">
            <span className="text-[10px] uppercase text-slate-500">{t("stock.code")}</span>
            <div className="flex items-center">
              <input
                placeholder="SPY"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                className="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              />
              <button
                onClick={() => setSymbolDropdownOpen((v) => !v)}
                className="-ml-px rounded-r border border-l-0 border-slate-700 bg-slate-900 px-1 py-1 text-slate-500 transition hover:text-slate-300"
              >
                <ChevronDown size={12} />
              </button>
            </div>
            {symbolDropdownOpen && recentSymbols.length > 0 && (
              <div className="absolute left-0 top-full z-[90] mt-1 max-h-64 w-28 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
                {[...recentSymbols].sort((a, b) => a.localeCompare(b)).map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setSymbol(s);
                      setSymbolDropdownOpen(false);
                    }}
                    className={`flex w-full items-center px-3 py-1.5 text-xs font-semibold transition ${
                      s === symbol ? "bg-emerald-500/10 text-emerald-300" : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
              onClick={refetch}
              title={quoteError ?? (quote ? `${t("stock.live")} ${quote.source}` : t("stock.fetchHint"))}
              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] transition hover:border-slate-500"
            >
              {quoteLoading ? (
                <RefreshCw size={11} className="animate-spin text-slate-400" />
              ) : quote ? (
                <span className="flex items-center gap-1">
                  {quote.price >= quote.previousClose
                    ? <TrendingUp size={11} className="text-emerald-400" />
                    : <TrendingDown size={11} className="text-rose-400" />
                  }
                  <span className="font-semibold tabular-nums text-slate-200">{quote.price.toFixed(2)}</span>
                </span>
              ) : quoteError ? (
                <span className="text-rose-400">!</span>
              ) : (
                <RefreshCw size={11} className="text-slate-500" />
              )}
            </button>

            {priceChange !== null && changePct !== null ? (
              <div className="flex items-center gap-1 rounded border border-slate-800 bg-slate-900/40 px-2 py-1 text-[10px] tabular-nums">
                <span className={priceChange >= 0 ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                  {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)}
                </span>
                <span className={priceChange >= 0 ? "text-emerald-400/60" : "text-rose-400/60"}>
                  ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
                </span>
              </div>
            ) : (
              <div className="w-[88px]" />
            )}
        </div>

        <div className="flex items-center gap-3">

          <DropdownMenu
            label={t("toolbar.dataLabel")}
            icon={<Database size={11} />}
            menuClassName="w-56"
          >
            {(close) => (
              <>
                {autoSyncSupported && (
                  <>
                    <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("toolbar.fileLink")}
                    </div>
                    {autoSyncName ? (
                      <>
                        <div className="mx-2 mb-1 truncate rounded bg-slate-800 px-2 py-1 text-[10px] text-emerald-400" title={autoSyncName}>
                          <FileSymlink size={10} className="mr-1 inline" />{autoSyncName}
                        </div>
                        <button
                          onClick={syncNow}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
                        >
                          <RefreshCw size={12} className="text-sky-400" /> {t("toolbar.syncNow")}
                        </button>
                        <button
                          onClick={unlinkBackup}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-rose-400 transition hover:bg-rose-950/40"
                        >
                          <Unlink size={12} /> {t("toolbar.unlink")}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={linkBackup}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
                      >
                        <FileSymlink size={12} className="text-emerald-400" /> {t("toolbar.linkBackup")}
                      </button>
                    )}
                    <div className="my-1 border-t border-slate-800" />
                  </>
                )}
                <button
                  onClick={() => { close(); exportAllData(); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
                >
                  <Download size={12} className="text-sky-400" /> {t("toolbar.exportData")}
                </button>
                <label className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800">
                  <Upload size={12} className="text-sky-400" /> {t("toolbar.importData")}
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={async (e) => {
                      close();
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        await importAllData(file);
                        await reloadData();
                      } catch {
                        window.alert(t("toolbar.importFail"));
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
              </>
            )}
          </DropdownMenu>
          <LanguageSwitcher />
          {simOrigin && onConfirmSimOpen && (
            <button
              onClick={() => onConfirmSimOpen({ symbol, legs: activeLegs, spot })}
              disabled={activeLegs.length === 0 || spot <= 0}
              title={t("sim.confirmOpen")}
              className="flex items-center gap-1 rounded border border-emerald-500 bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={12} />
              <span>{t("sim.confirmOpen")}</span>
            </button>
          )}
          <button
            onClick={() => setHelpOpen(true)}
            title={t("toolbar.help")}
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] font-semibold text-slate-400 transition hover:border-emerald-500/50 hover:text-emerald-300"
          >
            <HelpCircle size={12} />
            <span>{t("toolbar.help")}</span>
          </button>
          {autoSyncError && (
            <div className="absolute right-2 top-full mt-1 z-50 max-w-xs rounded-lg border border-rose-700 bg-rose-950/90 px-3 py-2 text-[11px] text-rose-300 shadow-xl">
              {autoSyncError}
              <button
                onClick={() => setAutoSyncError(null)}
                className="ml-2 text-rose-500 hover:text-rose-300"
              >
                <X size={11} className="inline" />
              </button>
            </div>
          )}
        </div>
      </header>

      {simOrigin && (
        <div className="shrink-0 border-b border-emerald-800/40 bg-emerald-950/30 px-4 py-1.5 text-[11px] text-emerald-300">
          {t("sim.simOriginBanner")}
        </div>
      )}

      {/* ── Main two-column layout ── */}
      <div className="flex min-h-0 flex-1 gap-0">
        {/* LEFT: Leg inputs */}
        <div className="flex shrink-0 flex-col border-r border-slate-800" style={{ width: "38%", minWidth: 380 }}>
          <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto] items-center gap-x-2 gap-y-1 border-b border-slate-800/60 px-3 py-1.5">
            <div className="col-start-1 row-start-1 flex min-w-0 shrink-0 items-center gap-2 whitespace-nowrap">
              <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-slate-300">{t("leg.legs")}</span>
              {strategyName && (
                <StrategyBadge name={strategyName} customPresets={customPresets} />
              )}
              <span className="shrink-0 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">
                {legs.length} / 10
              </span>
              {isCompareMode && (
                <span className="rounded bg-sky-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
                  {t("leg.compareMode")}
                </span>
              )}
            </div>
            {!isCompareMode && (
                <div className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 pt-0.5">
                  <label className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] text-slate-500" title={t("stock.openPrice")}>
                    <DollarSign size={10} />
                    <span>{t("stock.openPrice")}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={spot > 0 ? spot : ""}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v >= 0) {
                          spotManuallySet.current = true;
                          setSpot(v);
                        }
                      }}
                      onWheel={(e) => e.currentTarget.blur()}
                      className="w-20 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] tabular-nums text-emerald-400 outline-none transition focus:border-emerald-500 focus:text-emerald-300"
                    />
                    {quote && quote.price > 0 && Math.abs(quote.price - spot) > 0.005 && (
                      <span className="text-[9px] tabular-nums text-slate-600" title={t("stock.live")}>
                        {`${t("stock.live")} ${quote.price.toFixed(2)}`}
                      </span>
                    )}
                  </label>
                      <label className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] text-slate-500" title={t("stock.openDate")}>
                    <Clock size={10} />
                    <span>{t("stock.openDate")}</span>
                    <input
                      type="date"
                      value={formatDateInput(openingAt)}
                      onChange={(e) => {
                        const next = parseDateInput(e.target.value);
                        if (next !== null) setOpeningAt(next);
                      }}
                      className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] tabular-nums text-slate-300 outline-none transition focus:border-sky-500 focus:text-sky-200"
                    />
                  </label>
                  <div className="ml-auto flex items-center gap-2">
                    {legToolbar}
                  </div>
                </div>
              )}
            <div className="col-start-2 row-start-1 ml-auto flex min-w-0 shrink-0 items-center gap-2 whitespace-nowrap">
              {activeLegs.length > 0 && pop > 0 && (
                <div className="flex shrink-0 items-center gap-2 border-r border-slate-800 pr-2">
                  <div className="flex items-baseline gap-1">
                    <span className="whitespace-nowrap text-[10px] text-slate-500">{t("leg.pop")}</span>
                    <span className={`text-base font-bold tabular-nums leading-none ${
                      pop >= 0.55 ? "text-emerald-400" : pop >= 0.45 ? "text-amber-400" : "text-rose-400"
                    }`}>{(pop * 100).toFixed(0)}%</span>
                  </div>
                  {breakevens.length > 0 && (
                    <div className="flex items-baseline gap-1">
                      <span className="whitespace-nowrap text-[10px] text-slate-500">{t("leg.breakeven")}</span>
                      <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-sky-300">
                        {breakevens.map((be) => be.toFixed(2)).join(" / ")}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Original combo section ── */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
            {isCompareMode && (
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-slate-900/80 py-1 backdrop-blur-sm">
                <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400">{t("compare.openCombo")}</span>
                <span className="text-[9px] text-slate-500">{t("compare.compareBase")}</span>
                {(() => {
                  const snaps = trackedStrategy?.trackedSnapshots ?? [];
                  const activeSnap = snaps.find((sn) => sn.id === activeSnapshotId) ?? snaps[snaps.length - 1];
                  const ts = activeSnap?.savedAt ?? trackedStrategy?.createdAt;
                  if (!ts) return null;
                  return (
                    <label className="flex items-center gap-1 text-[9px] tabular-nums text-slate-500" title={t("compare.clickModifyDate")}>
                      <Clock size={9} className="text-slate-500" />
                      <input
                        type="date"
                        value={formatDateInput(ts)}
                        onChange={(e) => {
                          const newTs = parseDateInput(e.target.value);
                          if (newTs !== null && activeSnap) handleUpdateSnapshotTime(activeSnap.id, newTs);
                        }}
                        className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[9px] tabular-nums text-slate-400 outline-none focus:border-sky-500 focus:text-sky-200"
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
              const spotChg = currSpot - spot;
              const ivChg = openIV > 0 && currIV > 0 ? (currIV - openIV) * 100 : 0;
              return (
                <div className="mb-1 grid grid-cols-3 gap-1.5 rounded-lg border border-slate-800 bg-slate-900/40 p-2 text-[10px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500">{t("compare.spot")}</span>
                    <span className="tabular-nums text-slate-300">{t("compare.openLabel")} <span className="font-semibold text-emerald-400">{spot.toFixed(2)}</span></span>
                    <span className="tabular-nums text-slate-300">{t("compare.currentLabel")} <span className="font-semibold text-sky-400">{currSpot.toFixed(2)}</span></span>
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
                    onChange={() => (selectedCount === legs.length ? clearLegSelection() : selectAllLegs())}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500"
                  />
                  {selectedCount > 0 ? t("leg.selectedCount", { count: selectedCount }) : t("leg.selectAll")}
                </label>
                {selectedCount > 0 && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      onClick={bulkToggleDisable}
                      className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-amber-400 transition hover:border-amber-500/50 hover:bg-amber-950/30"
                    >
                      <Ban size={11} />
                      {allSelectedDisabled ? t("leg.bulkUnblock") : t("leg.bulkBlock")}
                    </button>
                    <button
                      onClick={requestBulkDelete}
                      className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-rose-400 transition hover:border-rose-500/50 hover:bg-rose-950/30"
                    >
                      <Trash2 size={11} />
                      {t("leg.bulkDelete")}
                    </button>
                  </div>
                )}
              </div>
            )}
            {legs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-600">
                <span className="text-sm">{t("leg.noLegs")}</span>
                <span className="text-xs">{t("leg.noLegsHint")}</span>
              </div>
            ) : (
              legs.map((leg, i) => (
                <LegRow
                  key={leg.id}
                  leg={leg}
                  index={i}
                  scenarioPrice={scenarioPriceById.get(leg.id)}
                  symbol={symbol}
                  onChange={(patch) => updateLeg(leg.id, patch)}
                  onToggleDisable={() => toggleLeg(leg.id)}
                  onDelete={() => deleteLeg(leg.id)}
                  onAddToPreset={() => setSaveDialogOpen(true)}
                  onRoll={() => handleRoll(leg.id)}
                  onHedge={() => handleHedge()}
                  onProtect={() => handleProtect(leg.id)}
                  onMoveUp={() => moveLeg(i, -1)}
                  onMoveDown={() => moveLeg(i, 1)}
                  canMoveUp={i > 0}
                  canMoveDown={i < legs.length - 1}
                  selected={selectedLegIds.has(leg.id)}
                  onToggleSelect={() => toggleLegSelection(leg.id)}
                />
              ))
            )}
          </div>

          {/* ── Today's combo section (compare mode only) ── */}
          {isCompareMode && trackedLegs && (
            <div className="flex max-h-[40%] flex-col border-t-2 border-sky-700/40 min-h-0">
              <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-sky-950/30 px-2 py-1">
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
                          if (sn) handleSelectSnapshot(sn);
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
                          if (activeSnap && snaps.length > 1) handleDeleteSnapshot(activeSnap.id);
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
              </div>
              {isCompareMode && trackedResult && (() => {
                const openIV = spot > 0 ? weightedAvgIV(activeLegs, spot) : 0;
                const currSpot = effectiveTrackedSpot;
                const currIV = currSpot > 0 ? weightedAvgIV(activeTrackedLegs ?? [], currSpot) : 0;
                const spotChg = currSpot - spot;
                const ivChg = openIV > 0 && currIV > 0 ? (currIV - openIV) * 100 : 0;
                const trackedNetPremium = trackedResult.netPremium;
                const trackedNetValue = trackedResult.shiftedValue;
                const trackedChange = trackedResult.change;
                return (
                  <div className="mb-1 grid grid-cols-4 gap-1.5 rounded-lg border border-sky-800/40 bg-sky-950/20 p-2 text-[10px]">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-slate-500">{t("compare.spotChange")}</span>
                      <span className="tabular-nums text-slate-300">{t("compare.openLabel")} <span className="font-semibold text-emerald-400">{spot.toFixed(2)}</span></span>
                      <span className="tabular-nums text-slate-300">{t("compare.currentLabel")} <span className="font-semibold text-sky-400">{currSpot.toFixed(2)}</span>
                        <button
                          onClick={() => setShowImpliedInfo((v) => !v)}
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
              <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
                {trackedLegs.map((leg, i) => (
                  <LegRow
                    key={leg.id}
                    leg={leg}
                    index={i}
                    symbol={symbol}
                    onChange={(patch) => updateTrackedLeg(leg.id, patch)}
                    onToggleDisable={() => {}}
                    onDelete={() => {}}
                    onAddToPreset={() => {}}
                    onRoll={() => handleRoll(leg.id)}
                    onHedge={() => handleHedge()}
                    onProtect={() => handleProtect(leg.id)}
                    onMoveUp={() => moveTrackedLeg(i, -1)}
                    onMoveDown={() => moveTrackedLeg(i, 1)}
                    canMoveUp={i > 0}
                    canMoveDown={i < trackedLegs.length - 1}
                    selectable={false}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Alert footer */}
          <div className="shrink-0 border-t border-slate-800 px-3 py-2">
            <AlertCard alert={alert} />
          </div>
        </div>

        {/* RIGHT: Chart + sliders */}
        <div className="flex min-w-0 flex-1 flex-col min-h-0">
          <div className="min-h-0 flex-1 px-2 py-1.5">
            <PayoffChart
              legs={activeLegs}
              spot={spot}
              shifts={shifts}
              symbol={symbol}
              pop={pop}
              breakevens={breakevens}
              trackedLegs={activeTrackedLegs ?? undefined}
              openingLegs={isCompareMode ? activeLegs : undefined}
              compareMode={isCompareMode}
              perLegValues={isCompareMode && trackedResult ? trackedResult.perLeg : result.perLeg}
              netValue={isCompareMode && trackedResult ? trackedResult.shiftedValue : result.shiftedValue}
              netChange={isCompareMode && trackedResult ? trackedResult.change : result.change}
              trackedSpot={isCompareMode ? effectiveTrackedSpot : undefined}
              onAlert={setAlert}
              correctedSpot={correctedSpot}
              correcting={correcting}
              onCorrectSpot={handleCorrectSpot}
              symbolForCorrect={symbol}
            />
          </div>

          {/* Sliders */}
          <div className="shrink-0 border-t border-slate-800 px-3 py-1.5">
            <ShiftSliders
              shifts={shifts}
              spot={spot}
              maxDte={activeLegs.length > 0 ? Math.max(...activeLegs.map((l) => l.dte)) : 30}
              onChange={(patch) => setShifts((s) => ({ ...s, ...patch }))}
              onReset={() => setShifts({ dS: 0, dT: 0, dV: 0 })}
              trackedSpot={isCompareMode ? effectiveTrackedSpot : undefined}
              trackedDays={isCompareMode ? effectiveDaysElapsed : undefined}
              trackedVolShift={trackedVolShift}
              disabled={isCompareMode}
            />
          </div>
        </div>
      </div>

      <SavePresetDialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        onSave={handleAddCustom}
        legs={activeLegs}
      />

      {confirmPresetOpen && (
        <ConfirmSnapshotDialog
          onCancel={() => { setConfirmPresetOpen(false); pendingPresetAction.current = null; }}
          onDontSave={() => { setConfirmPresetOpen(false); if (pendingPresetAction.current) { applyPreset(pendingPresetAction.current.rawLegs); pendingPresetAction.current = null; } }}
          onSaveSnapshot={async () => {
            setConfirmPresetOpen(false);
            await handleSaveTracked();
            if (pendingPresetAction.current) { applyPreset(pendingPresetAction.current.rawLegs); pendingPresetAction.current = null; }
          }}
        />
      )}

      {confirmReplaceOpen && (
        <ConfirmReplacePresetDialog
          onCancel={() => { setConfirmReplaceOpen(false); pendingPresetReplace.current = null; }}
          onDontSave={() => {
            setConfirmReplaceOpen(false);
            if (pendingPresetReplace.current) { applyPreset(pendingPresetReplace.current); pendingPresetReplace.current = null; }
          }}
          onSaveFirst={() => {
            setConfirmReplaceOpen(false);
            setSaveStrategyOpen(true);
            // pendingPresetReplace stays set — applied once the save succeeds
          }}
        />
      )}

      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}

      {confirmClearOpen && (
        <ConfirmClearDialog
          onConfirm={clearAllLegs}
          onCancel={() => setConfirmClearOpen(false)}
        />
      )}

      {confirmBulkDeleteOpen && (
        <ConfirmBulkDeleteDialog
          count={selectedCount}
          onConfirm={confirmBulkDelete}
          onCancel={() => setConfirmBulkDeleteOpen(false)}
        />
      )}

      {confirmSaveTrackedOpen && (
        <ConfirmSaveTrackedDialog
          onDontSave={() => { setConfirmSaveTrackedOpen(false); doClearAll(); }}
          onSaveSnapshot={async () => {
            setConfirmSaveTrackedOpen(false);
            await handleSaveTracked();
            doClearAll();
          }}
        />
      )}

      <SaveStrategyDialog
        open={saveStrategyOpen}
        onClose={() => { setSaveStrategyOpen(false); pendingPresetReplace.current = null; }}
        onSave={handleSaveStrategy}
        onOverwrite={handleOverwriteStrategy}
        symbol={symbol}
        direction={comboDirection}
        strategyName={strategyName}
        legs={activeLegs}
        spot={spot}
        shifts={shifts}
        openingAt={openingAt}
        existing={savedStrategies}
      />

      <ManageStrategiesDialog
        open={manageStrategyOpen}
        onClose={() => setManageStrategyOpen(false)}
        mode={manageMode}
        strategies={savedStrategies}
        onOpen={handleOpenStrategy}
        onReorder={handleReorderStrategies}
        onRename={handleRenameStrategy}
        onDelete={handleDeleteStrategy}
        onToggleStar={handleToggleStar}
        onTrack={handleTrack}
      />

      {rollTarget && (
        <RollDialog
          leg={rollTarget}
          spot={spot}
          symbol={symbol}
          onClose={() => setRollTarget(null)}
          onConfirm={handleRollConfirm}
        />
      )}
      {protectTarget && (
        <ProtectDialog
          leg={protectTarget}
          spot={spot}
          symbol={symbol}
          onClose={() => setProtectTarget(null)}
          onConfirm={handleProtectConfirm}
        />
      )}
      {hedgeOpen && (
        <HedgeDialog
          legs={legs}
          spot={spot}
          symbol={symbol}
          onClose={() => setHedgeOpen(false)}
          onConfirm={handleHedgeConfirm}
        />
      )}

      {showImpliedInfo && isCompareMode && (
        <ImpliedSpotInfoPanel
          trackedSpot={effectiveTrackedSpot}
          correctedSpot={correctedSpot}
          correcting={correcting}
          canCorrect={!!symbol.trim()}
          onClose={() => setShowImpliedInfo(false)}
          onCorrect={() => { handleCorrectSpot(); setShowImpliedInfo(false); }}
        />
      )}
    </div>
  );
}