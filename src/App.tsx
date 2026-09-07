// src/App.tsx
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Plus, Layers, Settings2, RefreshCw, TrendingUp, TrendingDown, ChevronDown, Trash2, Clock, Download, Upload, FileSymlink, Unlink, X, Database, HelpCircle, DollarSign, Ban, Wallet, GitCompare, History } from "lucide-react";
import type { Leg, Shifts } from "@/lib/types";
import { priceCombo, probabilityOfProfit, weightedAvgIV, impliedSpotFromPremiums, attributePnl, maxProfitLoss, resolveOpeningLeg } from "@/lib/pricing";
import { explainLegRoles } from "@/lib/legRoles";
import PnlAttributionPanel from "@/components/PnlAttributionPanel";
import { computeHealth } from "@/lib/positionHealth";
import { matchStrategy } from "@/lib/matchStrategy";
import LegListSection from "@/components/LegListSection";
import ShiftSliders from "@/components/ShiftSliders";
import PayoffChart, { type AlertInfo } from "@/components/PayoffChart";
import { useStockQuote } from "@/lib/useStockQuote";
import { loadRecentSymbols, addRecentSymbol } from "@/lib/recentSymbols";
import { saveStrategy, overwriteStrategy, addTrackedSnapshot, updateSnapshotTime, deleteTrackedSnapshot, backfillTrackedSnapshots, serializeStrategyState, findDuplicate, type SavedStrategy, type TrackedSnapshot } from "@/lib/savedStrategies";
import DropdownMenu from "@/components/DropdownMenu";
import Term from "@/components/Term";
import { useAutoSync } from "@/hooks/useAutoSync";
import { useCustomPresets } from "@/hooks/useCustomPresets";
import { useSavedStrategies } from "@/hooks/useSavedStrategies";
import { useLegEditing } from "@/hooks/useLegEditing";
import { nearestFridayDte, formatDateInput, parseDateInput, calendarDaysSince } from "@/lib/dateUtils";
import { uid, blankLeg, PRESET_DTE_SET, asOpeningLeg } from "@/lib/legFactory";
import { getOptionChain, peekResolvedChain, nearestStrikeToSpot, resolveFromCache } from "@/lib/optionChain";
import { useI18n } from "@/i18n/I18nContext";
import AppHeader from "@/components/AppHeader";
import LegPanelTitleRow from "@/components/LegPanelTitleRow";
import TrackedComboSection from "@/components/TrackedComboSection";
import LegActionDialogs from "@/components/LegActionDialogs";
import StrategyPersistenceDialogs from "@/components/StrategyPersistenceDialogs";
import { AlertCard, HelpPanel } from "@/components/dialogs";
import ErrorBoundary from "@/components/ErrorBoundary";

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
  onAddToSimAccount?: (payload: { symbol: string; legs: Leg[]; spot: number; openingAt?: number }) => Promise<{ ok: boolean; needsSetup?: boolean }>;
  // Pre-fills the simOrigin leg builder — used when arriving here from the
  // scenario selector's "use this" button, so the person reviews/adjusts a
  // real candidate instead of starting from a blank combo. Only applied
  // once on mount (see the effect right after state declarations below);
  // editing after that point is just normal leg editing, same as always.
  simOriginInitial?: { symbol: string; legs: Leg[]; spot: number };
}

export default function App({ onBackHome, autoOpenManage, simOrigin, onConfirmSimOpen, onCancelSimOrigin, onAddToSimAccount, simOriginInitial }: AppProps = {}) {
  const [symbol, setSymbol] = useState(() => simOriginInitial?.symbol ?? "");
  const [spot, setSpot] = useState(() => simOriginInitial?.spot ?? 0);
  const [legs, setLegs] = useState<Leg[]>(() => simOriginInitial?.legs ?? []);
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
  // The "数据" button/dropdown (export/import/link/unlink) moved to
  // HomePage.tsx, next to the language switcher (2026-09-06, xue's request).
  // This call is kept here on purpose, with its return value unused: it's
  // what keeps writing to the linked backup file in the background while
  // the user is actively editing in analysis/compare mode, so a long
  // editing session still gets backed up without having to return to the
  // home screen first. HomePage.tsx has its own independent instance of
  // this hook powering the relocated button — safe because the underlying
  // file handle is a module-level singleton (see lib/autoSync.ts) and the
  // two components are never mounted at the same time (Shell.tsx routing).
  useAutoSync({ savedStrategies, customPresets, recentSymbols });
  const { t } = useI18n();

  const [helpOpen, setHelpOpen] = useState(false);
  // Per-module first-entry guides (2026-09-06). Analysis guide gates fresh
  // entry into analysis mode (skipped for the auto-open-manage "Tracking"
  // card flow and the simOrigin flow, which have their own onboarding);
  // compare guide gates the first time this component ever flips into
  // compare mode (via handleSwitchToCompare / loading a tracked strategy),
  // guarded by compareGuideShown so it never reappears after being
  // dismissed once, even if the user leaves and re-enters compare mode
  // within the same mount. Both are separate from helpOpen, which is the
  // dismissible "使用说明" button version of the same content.
  const [showAnalysisGuide, setShowAnalysisGuide] = useState(() => !autoOpenManage && !simOrigin);
  const [showCompareGuide, setShowCompareGuide] = useState(false);
  const compareGuideShown = useRef(false);
  const {
    rollTarget, setRollTarget, rollTargetSource,
    protectTarget, setProtectTarget, protectTargetSource,
    hedgeOpen, setHedgeOpen, hedgeTargetSource,
    compareTargetId, setCompareTargetId,
    selectedLegIds,
    confirmBulkDeleteOpen, setConfirmBulkDeleteOpen,
    updateLeg,
    toggleLeg,
    deleteLeg,
    toggleLegSelection,
    clearLegSelection,
    selectAllLegs,
    selectedCount,
    allSelectedDisabled,
    bulkToggleDisable,
    requestBulkDelete,
    confirmBulkDelete,
    handleRoll,
    handleRollConfirm,
    handleProtect,
    handleProtectConfirm,
    handleCompare,
    handleHedge,
    handleHedgeConfirm,
    moveLeg,
    moveTrackedLeg,
  } = useLegEditing({ legs, setLegs, trackedLegs, setTrackedLegs });
  const pendingPresetAction = useRef<{ name: string; rawLegs: Leg[] } | null>(null);
  const [confirmPresetOpen, setConfirmPresetOpen] = useState(false);
  const pendingPresetReplace = useRef<Leg[] | null>(null);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  // Guards handleSwitchToAnalysis: switching to "baseline" or a snapshot
  // discards whatever unsaved edits are sitting in trackedLegs (switching
  // to "current" instead promotes those edits into the new baseline, so
  // nothing is lost there — see performSwitchToAnalysis below).
  const pendingSwitchSource = useRef<string | null>(null);
  const [confirmSwitchOpen, setConfirmSwitchOpen] = useState(false);
  // Set when "保存追踪快照" is clicked but the opening combo isn't backed by
  // a saved strategy yet (trackingStrategyId is null — e.g. compare mode
  // was entered via handleSwitchToCompare rather than by tracking an
  // existing SavedStrategy). There's nowhere to attach a snapshot until the
  // combo itself is saved, so this defers the snapshot save until
  // handleSaveStrategy/handleOverwriteStrategy report success.
  const pendingSaveTrackedAfterStrategy = useRef(false);
  // Set when the person clicks "save first, then leave" in ConfirmLeaveDialog
  // — checked inside handleSaveStrategy/handleOverwriteStrategy so the
  // actual navigation only fires once the save has genuinely succeeded,
  // same lifecycle as pendingPresetReplace above.
  const pendingLeaveAfterSave = useRef(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const symbolWrapRef = useRef<HTMLDivElement>(null);
  const pendingPreset = useRef<{ name: string; rawLegs: Leg[] } | null>(null);
  const legBaseSpot = useRef(simOriginInitial?.spot ?? 0);
  const legBaseSymbol = useRef(simOriginInitial?.symbol ?? "");
  const spotManuallySet = useRef(!!simOriginInitial);
  const trackedLegsRef = useRef<Leg[] | null>(null);
  trackedLegsRef.current = trackedLegs;
  // Mirrors trackedDirty for the symbol-change effect below, which can't
  // just add trackedDirty to its own dependency array (that would make it
  // re-run — and re-derive symbolChanged off a stale quote — on every dirty
  // toggle, not just when a new quote actually arrives).
  const trackedDirtyRef = useRef(false);
  trackedDirtyRef.current = trackedDirty;
  // Stashes the {symbol, spot} a real symbol swap resolved to while
  // confirmSymbolChangeOpen waits on the person's answer — see the
  // symbol-change guard in the effect below and its three resolutions
  // (cancel / don't save / save snapshot first) further down.
  const pendingSymbolChange = useRef<{ symbol: string; spot: number } | null>(null);
  const [confirmSymbolChangeOpen, setConfirmSymbolChangeOpen] = useState(false);

  // Re-bases every strike onto a new underlying: ratio-scales each leg's
  // strike off the ratio between the old and new spot, then prefers a real
  // listed strike/premium for the new symbol when the option-chain cache
  // already has one (falls back to the ratio guess with premium reset to 0,
  // which the per-leg auto-fill effect corrects shortly after). Applies to
  // both the opening combo (legs) and, in compare mode, the "今日组合"
  // (trackedLegs) — a symbol swap makes the old strikes meaningless for
  // both, not just one side.
  const rescaleForNewSymbol = useCallback((newSymbol: string, newSpot: number) => {
    const sym = newSymbol.trim();
    const ratio = legBaseSpot.current > 0 ? newSpot / legBaseSpot.current : 1;
    const rescale = (arr: Leg[]) => arr.map((l) => {
      if (l.kind === "stock") {
        return { ...l, strike: Math.round(newSpot * 100) / 100 };
      }
      const targetStrike = Math.round(l.strike * ratio * 2) / 2;
      const resolved = sym ? resolveFromCache(sym, l.type, targetStrike, l.dte) : null;
      return {
        ...l,
        strike: resolved ? resolved.strike : targetStrike,
        premium: resolved ? resolved.premium : 0,
      };
    });
    setLegs((prev) => (prev.length > 0 ? rescale(prev) : prev));
    if (trackedLegsRef.current) {
      setTrackedLegs((prev) => (prev ? rescale(prev) : prev));
      setTrackedSpot(newSpot);
      setTrackedDirty(true);
    }
    setSpot(newSpot);
    legBaseSpot.current = newSpot;
    legBaseSymbol.current = newSymbol;
    spotManuallySet.current = false;
  }, []);


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

    // A genuine symbol swap under an existing combo — as opposed to the
    // ordinary "quote refreshed for the same symbol" case that runs this
    // effect on every poll/refetch. spotManuallySet only means "don't let a
    // live quote silently overwrite a spot number the person typed by hand
    // FOR THE CURRENT SYMBOL" — it says nothing about switching to a
    // different underlying entirely, where the old strikes/spot are
    // meaningless regardless of whether spot was ever hand-edited. So this
    // check bypasses spotManuallySet on purpose.
    const comboNotEmpty = legs.length > 0 || (trackedLegsRef.current !== null && trackedLegsRef.current.length > 0);
    const symbolChanged = legBaseSpot.current > 0 && comboNotEmpty && symbol !== legBaseSymbol.current;

    if (trackedLegsRef.current !== null) {
      if (!symbolChanged) {
        setTrackedSpot(quote.price);
        return;
      }
      if (trackedDirtyRef.current) {
        // "今日组合" has unsaved edits — same data-loss guard used for
        // preset switching and mode switching, reusing ConfirmSnapshotDialog.
        // The rescale itself is deferred until the person answers (see the
        // three onXxxSymbolChange handlers passed to StrategyPersistenceDialogs).
        pendingSymbolChange.current = { symbol, spot: quote.price };
        setConfirmSymbolChangeOpen(true);
        return;
      }
      rescaleForNewSymbol(symbol, quote.price);
      return;
    }

    if (symbolChanged) {
      rescaleForNewSymbol(symbol, quote.price);
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
    }
    setSpot(quote.price);
    legBaseSpot.current = quote.price;
    legBaseSymbol.current = symbol;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, spot]);

  const priceChange = quote && quote.previousClose > 0
    ? quote.price - quote.previousClose : null;
  const changePct = priceChange !== null && quote!.previousClose > 0
    ? (priceChange / quote!.previousClose) * 100 : null;

  // The real, live market price — used ONLY for display in compare mode
  // (the "当前" spot number in LegListSection/TrackedComboSection's stats
  // grids, and PayoffChart's optional reference line). Deliberately NOT fed
  // into effectiveTrackedSpot or anything that computes P&L/IV/attribution —
  // those stay on the back-solved/manually-tracked value so they remain
  // internally consistent with whatever premium the person actually typed
  // in (see the 2026-09-04 discussion in CLAUDE.md's "3.x" section on why
  // swapping that value wholesale would misalign the payoff curve and the
  // P&L attribution's 交叉项).
  const liveTrackedSpot = quote && quote.price > 0 ? quote.price : null;

  const activeLegs = useMemo(() => legs.filter((l) => !l.disabled), [legs]);
  const activeTrackedLegs = useMemo(() => trackedLegs?.filter((l) => !l.disabled) ?? null, [trackedLegs]);
  const isCompareMode = trackedLegs !== null;

  useEffect(() => {
    if (isCompareMode && !compareGuideShown.current) {
      compareGuideShown.current = true;
      setShowCompareGuide(true);
    }
  }, [isCompareMode]);

  const strategyName = useMemo(() => matchStrategy(activeLegs, spot, customPresets), [activeLegs, spot, customPresets]);
  const canSaveStrategy = activeLegs.length > 0 && serializeStrategyState(symbol, legs, shifts, openingAt) !== strategyBaseline;
  const result = useMemo(() => priceCombo(activeLegs, shifts, spot), [activeLegs, shifts, spot]);

  const scenarioPriceById = useMemo(() => {
    const m = new Map<string, number>();
    for (const pl of result.perLeg) m.set(pl.leg.id, pl.shifted);
    return m;
  }, [result]);

  // In compare mode, back-solve the implied stock price from the premiums the user
  // enters for each tracked leg. Different premiums imply different stock prices —
  // e.g. if a short straddle's call premium drops while put premium rises, the stock
  // has fallen. Falls back to the live quote when back-solve fails (e.g. only stock legs).
  const impliedSpot = useMemo(() => {
    if (!isCompareMode || !activeTrackedLegs || !activeLegs || spot <= 0) return null;
    return impliedSpotFromPremiums(activeLegs, activeTrackedLegs, spot);
  }, [isCompareMode, activeTrackedLegs, activeLegs, spot]);

  const effectiveTrackedSpot = correctedSpot ?? impliedSpot ?? trackedSpot ?? spot;

  // Real Black-Scholes combo Greeks (delta/gamma/theta/vega) for "今日组合"
  // at ITS OWN current spot/premiums, zero shift — compare mode's sliders
  // are frozen read-only telemetry, not a scenario to rehearse (see
  // ShiftSliders.tsx), so there's no "shifted" version of this to compute.
  // Deliberately a separate memo from trackedResult below (which only does
  // raw premium-difference P&L — no Black-Scholes needed for that — and
  // still carries its own hardcoded-zero breakdown, unused elsewhere) so
  // this doesn't disturb that already-working P&L math. Feeds both Position
  // Health's delta factor and the net-Greeks readout, in compare mode.
  const trackedGreeks = useMemo(() => {
    if (!isCompareMode || !activeTrackedLegs || activeTrackedLegs.length === 0 || effectiveTrackedSpot <= 0) return null;
    return priceCombo(activeTrackedLegs, { dS: 0, dT: 0, dV: 0 }, effectiveTrackedSpot);
  }, [isCompareMode, activeTrackedLegs, effectiveTrackedSpot]);

  // Position Health follows whichever combo is actually on screen: analysis
  // mode's shifted opening combo (rehearsing the sliders — result.breakdown
  // is itself computed at the live shifts, so all four factors, delta
  // included, move together as the sliders move), or compare mode's real
  // CURRENT tracked combo at zero shift — never the stale opening combo
  // once something is actually being tracked. (Previously this always read
  // the opening combo/`result` even in compare mode; fixed 2026-09-06 —
  // see claude/analysis-compare-mode-review-2026-09-06.md.) Because this
  // now keys off `activeTrackedLegs`/`effectiveTrackedSpot` — which change
  // with whichever snapshot is selected — switching snapshots naturally
  // gives each one its own health score, with no separate per-snapshot
  // storage needed.
  const positionHealth = useMemo(() => {
    if (isCompareMode) {
      if (!activeTrackedLegs || activeTrackedLegs.length === 0 || effectiveTrackedSpot <= 0 || !trackedGreeks) return null;
      return computeHealth(activeTrackedLegs, effectiveTrackedSpot, { dS: 0, dT: 0, dV: 0 }, trackedGreeks.breakdown, t);
    }
    if (activeLegs.length === 0 || spot <= 0) return null;
    return computeHealth(activeLegs, spot, shifts, result.breakdown, t);
  }, [isCompareMode, activeTrackedLegs, effectiveTrackedSpot, trackedGreeks, activeLegs, spot, shifts, result, t]);

  // Net combo Greeks actually shown to the user (see the small Greeks
  // readout next to the Health badge below) — same source data
  // positionHealth's delta factor already reads, just also surfacing
  // gamma/theta/vega, which until now were computed by priceCombo but never
  // displayed anywhere in either mode.
  const displayGreeks = isCompareMode ? trackedGreeks?.breakdown ?? null : result.breakdown;
  const fmtGreek = (v: number | undefined, decimals = 2) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}`);

  const { pop, breakevens } = useMemo(() => probabilityOfProfit(activeLegs, spot), [activeLegs, spot]);

  // Analysis-mode P/L attribution — same attributePnl() used in tracking
  // mode, just fed the slider's own dS/dT/dV instead of a tracked-vs-
  // opening comparison. The sliders ARE the price/time/IV shift already;
  // result.change is already the combo's total change under exactly those
  // shifts, so this is a direct reuse, not new pricing logic. Only shown
  // once at least one slider has actually moved — at rest all four numbers
  // are zero and there's nothing useful to attribute.
  const analysisAttribution = useMemo(() => {
    if (isCompareMode || activeLegs.length === 0 || spot <= 0) return null;
    if (shifts.dS === 0 && shifts.dT === 0 && shifts.dV === 0) return null;
    return attributePnl(activeLegs, spot, shifts.dS, shifts.dT, shifts.dV, result.change);
  }, [isCompareMode, activeLegs, spot, shifts, result]);

  // Fixed reference scale for the attribution bars in both modes — see
  // PnlAttributionPanel's own comments on why this needs to be something
  // that doesn't move with the slider. Both analysisAttribution and
  // pnlAttribution are built from activeLegs/spot (the opening combo), so
  // one shared scale computed the same way covers both panels.
  const attributionMaxAbs = useMemo(() => {
    if (activeLegs.length === 0 || spot <= 0) return 0.01;
    const { maxProfit, maxLoss } = maxProfitLoss(activeLegs, spot);
    return Math.max(Math.abs(maxProfit), Math.abs(maxLoss), 0.01);
  }, [activeLegs, spot]);

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
    // Pair each tracked leg with its opening counterpart via
    // resolveOpeningLeg (id-based, with fallbacks for pre-existing data —
    // see its own comment in pricing.ts), not by raw array position —
    // trackedLegs can be reordered (moveTrackedLeg) or grown independently
    // of legs (a roll/hedge/protect added straight to the tracked side, see
    // useLegEditing.ts), at which point
    // `activeTrackedLegs[index]`/`activeLegs[index]` silently stop being
    // "the same leg". A tracked leg with no resolvable opening leg falls
    // through to `base = 0` below, same as the old "no opening leg at this
    // index" fallback.
    const openingById = new Map(activeLegs.map((l) => [l.id, l]));
    let shiftedValue = 0;
    let netPremium = 0;
    const perLeg = activeTrackedLegs.map((leg, index) => {
      const openingLeg = resolveOpeningLeg(leg, index, activeLegs, openingById);
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

  // Per-leg P&L for the tracked ("今日组合") list — trackedResult.perLeg
  // already computes each tracked leg's change vs. its opening counterpart,
  // this just re-keys it by id so LegRow can look its own value up the
  // same way scenarioPriceById already works for the opening combo list.
  const trackedLegPnlById = useMemo(() => {
    const m = new Map<string, number>();
    if (!trackedResult) return m;
    for (const pl of trackedResult.perLeg) m.set(pl.leg.id, pl.change.total);
    return m;
  }, [trackedResult]);

  // Same per-leg role explanation the analysis-mode leg list gets (see
  // LegListSection.tsx), computed here separately for "today's combo"
  // since that list is still rendered directly in App.tsx rather than
  // through LegListSection — a role like "anchor leg" is relative to the
  // CURRENT tracked strikes/premiums, which can differ from the opening
  // combo's roles if the person has edited a tracked leg's premium.
  const trackedLegRolesById = useMemo(() => {
    const map = new Map<string, { label: string; explanation: string }>();
    if (!trackedLegs) return map;
    for (const r of explainLegRoles(trackedLegs)) map.set(r.legId, { label: r.label, explanation: r.explanation });
    return map;
  }, [trackedLegs]);

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

  // P/L attribution — decomposes trackedResult.change (the real observed
  // P&L move) into price/time/IV contributions. See attributePnl's own
  // comments in pricing.ts for why the three don't sum exactly to the
  // total and what the residual represents.
  const pnlAttribution = useMemo(() => {
    if (!isCompareMode || !trackedResult || activeLegs.length === 0 || spot <= 0) return null;
    const dSpot = effectiveTrackedSpot - spot;
    const dDays = effectiveDaysElapsed;
    const dVolPct = trackedVolShift ?? 0;
    return attributePnl(activeLegs, spot, dSpot, dDays, dVolPct, trackedResult.change);
  }, [isCompareMode, trackedResult, activeLegs, spot, effectiveTrackedSpot, effectiveDaysElapsed, trackedVolShift]);

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
      // openingAt carries over the combo's real opening date (e.g. restored
      // from a saved strategy that was actually opened days/weeks ago) so
      // the resulting sim position's clock starts from when the position
      // was truly opened, not from the moment this button was clicked —
      // otherwise every DTE/P&L figure downstream in the simulator is
      // computed against the wrong elapsed time. See simAccount.ts's
      // openSimPosition for the other half of this.
      const result = await onAddToSimAccount({ symbol: symbol.trim(), legs: activeLegs, spot, openingAt });
      if (!result.ok && result.needsSetup) {
        window.alert(t("sim.needSetupFirst"));
      }
    } finally {
      setAddingToSim(false);
    }
  }, [onAddToSimAccount, activeLegs, spot, symbol, openingAt, t]);

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

  // Shared by handleSaveTracked's normal path and its "save the strategy
  // first, then attach the snapshot" fallback below — appends trackedLegs
  // as a new TrackedSnapshot on the given (already-saved) strategy id.
  const saveTrackedSnapshotTo = useCallback(async (strategyId: string) => {
    if (!trackedLegs) return;
    const updated = await addTrackedSnapshot(strategyId, trackedLegs, trackedSpot ?? spot, Date.now());
    setSavedStrategies(updated);
    const updatedStrategy = updated.find((s) => s.id === strategyId);
    const newSnaps = updatedStrategy?.trackedSnapshots ?? [];
    if (newSnaps.length > 0) setActiveSnapshotId(newSnaps[newSnaps.length - 1].id);
    setTrackedDirty(false);
  }, [trackedLegs, trackedSpot, spot]);

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
    if (pendingLeaveAfterSave.current) {
      pendingLeaveAfterSave.current = false;
      onBackHome?.();
    }
    if (pendingSaveTrackedAfterStrategy.current) {
      pendingSaveTrackedAfterStrategy.current = false;
      // saveStrategy() unshifts the new record, so it's always updated[0].
      const newId = updated[0]?.id;
      if (newId) {
        setTrackingStrategyId(newId);
        await saveTrackedSnapshotTo(newId);
      }
    }
  }, [symbol, spot, legs, activeLegs, shifts, openingAt, applyPreset, onBackHome, saveTrackedSnapshotTo]);

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
    if (pendingLeaveAfterSave.current) {
      pendingLeaveAfterSave.current = false;
      onBackHome?.();
    }
    if (pendingSaveTrackedAfterStrategy.current) {
      pendingSaveTrackedAfterStrategy.current = false;
      setTrackingStrategyId(id);
      await saveTrackedSnapshotTo(id);
    }
  }, [symbol, spot, legs, activeLegs, shifts, openingAt, applyPreset, onBackHome, saveTrackedSnapshotTo]);

  const handleTrack = useCallback(async (s: SavedStrategy) => {
    setSymbol(s.symbol);
    setLegs(s.legs.map((l) => ({ ...l, id: uid() })));
    setShifts({ dS: 0, dT: 0, dV: 0 });
    setSpot(s.spot);
    setOpeningAt(s.openingAt ?? s.createdAt);
    legBaseSpot.current = s.spot;
    legBaseSymbol.current = s.symbol;
    spotManuallySet.current = true;

    // Fill in any missed trading days since this strategy was last tracked
    // before deciding what "最新快照" even means — reuses the Simulator
    // Timeline's theoretical-backfill approach (historicalBackfill.ts) so
    // "今日组合" doesn't default to a snapshot from days or weeks ago just
    // because nobody happened to have the app open in between. Backfilled
    // days are marked `estimated` and never overwrite a real, manually-saved
    // snapshot for the same day (see backfillTrackedSnapshots).
    const refreshedStrategies = await backfillTrackedSnapshots(s.id);
    setSavedStrategies(refreshedStrategies);
    const refreshed = refreshedStrategies.find((st) => st.id === s.id) ?? s;

    // "今日组合" should open on whatever the person actually saw and saved
    // last time (the newest real OR backfilled trackedSnapshot), not a
    // fresh copy of the opening combo with the DTE merely decremented —
    // that "recompute from opening" fallback is only correct when NO
    // snapshot exists at all. Loading the opening combo here when a
    // snapshot already exists would silently discard whatever the person
    // had edited/recorded into that snapshot, which is exactly what this
    // branch exists to avoid (see handleSelectSnapshot below, whose decay
    // logic this mirrors).
    const snaps = refreshed.trackedSnapshots ?? [];
    const latestSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
    if (latestSnap) {
      // Two different "days" here, easy to conflate (2026-09-04 bug): the
      // snapshot's own legs were already decayed once, up to whatever
      // moment it was saved — `calendarDaysSince(latestSnap.savedAt)` is
      // exactly the ADDITIONAL decay needed to bring that dte current to
      // right now, and nothing else should use it. The "已过X天" stat, by
      // contrast, is meant to read as "how long ago did this position
      // actually open" — that's `calendarDaysSince(s.openingAt ??
      // s.createdAt)` regardless of when the snapshot happened to be saved.
      // Reusing the snapshot-relative number for both meant reloading a
      // same-day snapshot always showed "已过0天" even when the real
      // opening date was days in the past.
      //
      // Both use calendarDaysBetween/calendarDaysSince (whole calendar
      // days, e.g. via `Math.round` on local-midnight-to-local-midnight)
      // rather than `daysSince` (a continuous count of 24h periods since
      // the exact opening TIMESTAMP) — 2026-09-05 bug: a strategy opened
      // 09-01 and checked on 09-04 showed "已过2天" instead of 3, because
      // fewer than 3 full 24-hour periods had passed since the opening
      // moment's time-of-day, even though 3 calendar days separate the two
      // dates the way a person reads "开仓日 09-01" vs "今天 09-04". See
      // dateUtils.ts's comment on daysBetweenLocalDates for the full story.
      const snapshotDecay = calendarDaysSince(latestSnap.savedAt);
      setTrackedDaysElapsed(calendarDaysSince(s.openingAt ?? s.createdAt));
      setTrackedLegs(
        latestSnap.legs.map((l) => ({
          ...l,
          id: uid(),
          dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - snapshotDecay),
        })),
      );
      setTrackedSpot(latestSnap.spot);
      setActiveSnapshotId(latestSnap.id);
    } else {
      const daysElapsed = calendarDaysSince(s.openingAt ?? s.createdAt);
      setTrackedDaysElapsed(daysElapsed);
      setTrackedLegs(
        s.legs.map((l) => ({
          ...l,
          id: uid(),
          // Record which opening leg (s.legs, about to become `legs`) this
          // tracked leg was derived from — see types.ts's comment on
          // openLegId. Must be captured before `id` above overwrites it.
          openLegId: l.id,
          dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - daysElapsed),
        })),
      );
      setTrackedSpot(s.spot);
      setActiveSnapshotId(null);
    }
    setCorrectedSpot(null);
    setTrackingStrategyId(s.id);
    setTrackedDirty(false);
    setManageStrategyOpen(false);
    setStrategyBaseline(serializeStrategyState(s.symbol, s.legs, { dS: 0, dT: 0, dV: 0 }, s.openingAt ?? s.createdAt));
    clearLegSelection();
  }, []);

  const handleSaveTracked = useCallback(async () => {
    if (!trackedLegs) return;
    if (!trackingStrategyId) {
      // No backing SavedStrategy yet (e.g. entered compare mode directly via
      // "切换到对比模式", or opened an existing strategy then switched
      // straight into compare mode instead of going through "跟踪") —
      // normally there's nowhere to attach a snapshot yet. But if the
      // opening combo already matches an existing saved strategy exactly
      // (same symbol/legs/shifts — findDuplicate is the same check
      // SaveStrategyDialog itself runs before saving), there's no need to
      // make the person re-save or "overwrite" anything just to get an id
      // to attach a snapshot to — that strategy already exists untouched,
      // silently adopt it and attach the snapshot straight to it. Only
      // prompt to name/save a brand-new strategy when no match exists.
      const existing = findDuplicate({ symbol, spot, legs: activeLegs, shifts }, savedStrategies);
      if (existing) {
        setTrackingStrategyId(existing.id);
        await saveTrackedSnapshotTo(existing.id);
        return;
      }
      pendingSaveTrackedAfterStrategy.current = true;
      setSaveStrategyOpen(true);
      return;
    }
    await saveTrackedSnapshotTo(trackingStrategyId);
  }, [trackingStrategyId, trackedLegs, saveTrackedSnapshotTo, symbol, spot, activeLegs, shifts, savedStrategies]);

  const handleSelectSnapshot = useCallback((snap: TrackedSnapshot) => {
    // Same distinction as handleTrack's snapshot branch above: the snapshot's
    // legs only need decaying by the time since IT was saved (snapshotDecay)
    // to be current as of today, but "已过X天" should stay pinned to the
    // real opening date (`openingAt`, unaffected by which snapshot happens
    // to be selected) — not reset to ~0 just because the snapshot picked
    // was saved recently.
    const snapshotDecay = calendarDaysSince(snap.savedAt);
    setTrackedDaysElapsed(calendarDaysSince(openingAt));
    setTrackedLegs(
      snap.legs.map((l) => ({
        ...l,
        id: uid(),
        dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - snapshotDecay),
      })),
    );
    setTrackedSpot(snap.spot);
    setCorrectedSpot(null);
    setActiveSnapshotId(snap.id);
    setTrackedDirty(false);
  }, [openingAt]);

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
    const daysElapsed = calendarDaysSince(savedAt);
    // Same open-vs-snapshot distinction as handleTrack/handleSelectSnapshot
    // above — "已过X天" tracks the real opening date, not this snapshot's
    // (just-edited) saved time.
    setTrackedDaysElapsed(calendarDaysSince(openingAt));
    if (trackedLegs) {
      setTrackedLegs(
        trackedLegs.map((l) => ({
          ...l,
          id: uid(),
          dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - daysElapsed),
        })),
      );
    }
  }, [trackingStrategyId, trackedLegs, openingAt]);

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

  // Direct switch from plain analysis mode into compare mode, carrying the
  // legs/spot/openingAt currently being edited — the "live" equivalent of
  // handleTrack() above, which does the same thing but reads from a
  // persisted SavedStrategy instead of the in-editor state. No days have
  // elapsed yet (we're switching right now), so trackedLegs starts as an
  // exact copy of legs with no DTE reduction — "today" and "opening" are
  // the same combo until the person edits the tracked side or time passes.
  const handleSwitchToCompare = useCallback(async () => {
    if (isCompareMode || legs.length === 0) return;
    // The opening combo being edited right now might already BE an existing
    // saved strategy — e.g. it was opened via "打开策略" (handleOpenStrategy
    // deliberately leaves trackingStrategyId null, same as this function
    // used to unconditionally do) or it was tracked earlier this session and
    // then switched back to analysis mode (performSwitchToAnalysis also
    // resets trackingStrategyId to null by design). Either way, if the combo
    // still matches that strategy exactly, this compare-mode session should
    // link back up to it — same findDuplicate check handleSaveTracked runs —
    // so the "持仓组合" header's snapshot picker can show/reload whatever was
    // already saved for it, instead of looking like a brand-new untracked
    // combo just because compare mode was entered via this direct-switch
    // button instead of "跟踪" from the strategy library.
    let existing = findDuplicate({ symbol, spot, legs, shifts }, savedStrategies);
    if (existing) {
      // Same missed-trading-days backfill as handleTrack — see its comment
      // for why this needs to happen before "latest snapshot" is decided.
      const refreshedStrategies = await backfillTrackedSnapshots(existing.id);
      setSavedStrategies(refreshedStrategies);
      existing = refreshedStrategies.find((st) => st.id === existing!.id) ?? existing;
    }
    const snaps = existing?.trackedSnapshots ?? [];
    const latestSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
    if (latestSnap) {
      // The matched strategy already has real tracked history — open on
      // THAT (same decay-from-savedAt logic handleTrack/handleSelectSnapshot
      // use), not a fresh "today == opening" copy of legs. 2026-09-04 bug:
      // linking trackingStrategyId here without also loading the snapshot
      // left trackedLegs as a plain copy of legs while the snapshot picker
      // still rendered (it only depends on trackingStrategyId) — and its
      // <select> falls back to displaying the LATEST snapshot as "selected"
      // whenever activeSnapshotId is null, so the newest snapshot LOOKED
      // selected without actually being loaded. Picking a different entry
      // then this one again only "fixed" it because that was the first time
      // the <select>'s value genuinely changed and fired onChange — the real
      // bug was the initial state not matching the picker's own displayed
      // selection.
      // Same open-vs-snapshot distinction as handleTrack/handleSelectSnapshot
      // (2026-09-05 bug — this branch got missed in the first pass at that
      // fix): the snapshot's legs only need decaying by the time since IT
      // was saved, but "已过X天" belongs to the real opening date.
      const snapshotDecay = calendarDaysSince(latestSnap.savedAt);
      setTrackedDaysElapsed(calendarDaysSince(openingAt));
      setTrackedLegs(
        latestSnap.legs.map((l) => ({
          ...l,
          id: uid(),
          dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - snapshotDecay),
        })),
      );
      setTrackedSpot(latestSnap.spot);
      setActiveSnapshotId(latestSnap.id);
    } else {
      // No tracked history yet (brand-new combo, or matched a strategy that
      // was only ever "saved", never tracked). This does NOT mean zero days
      // have elapsed — `openingAt` can genuinely be in the past (a saved
      // strategy opened days ago via "打开策略", or a hand-edited 开仓日期),
      // and switching to compare mode "right now" should reflect that real
      // gap, same as handleTrack's own no-snapshot fallback does via
      // `calendarDaysSince(s.openingAt ?? s.createdAt)`. The old code here
      // hardcoded 0 regardless of `openingAt`, so both stat boxes
      // (LegListSection's 开仓组合 summary and TrackedComboSection's
      // 持仓组合 grid — they share this same `effectiveDaysElapsed`) always
      // showed "已过0天" and left the tracked legs' DTE identical to the
      // opening legs', even when the opening date was days in the past —
      // 2026-09-04 bug.
      const daysElapsed = calendarDaysSince(openingAt);
      setTrackedDaysElapsed(daysElapsed);
      setTrackedLegs(
        legs.map((l) => ({
          ...l,
          id: uid(),
          // See types.ts's comment on openLegId — same reasoning as
          // handleTrack's no-snapshot branch above, just deriving directly
          // from the in-editor `legs` instead of a persisted SavedStrategy.
          openLegId: l.id,
          dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - daysElapsed),
        })),
      );
      setTrackedSpot(spot);
      setActiveSnapshotId(null);
    }
    setCorrectedSpot(null);
    setTrackingStrategyId(existing ? existing.id : null);
    setTrackedDirty(false);
    clearLegSelection();
  }, [isCompareMode, legs, spot, symbol, shifts, savedStrategies, openingAt]);

  // Direct switch from compare mode back into plain analysis mode. Which
  // data becomes the new (single) analysis-mode baseline depends on
  // `source`:
  // - "baseline": the opening combo as-is (legs/spot/openingAt already ARE
  //   this — same as handleOpenStrategy's "just drop the tracked half").
  // - "current": whatever the "今日组合" side currently shows
  //   (trackedLegs/effectiveTrackedSpot), promoted to be the new baseline.
  // - a snapshot id: that specific saved snapshot's legs/spot.
  // For "current" and a snapshot, openingAt resets to when THAT data was
  // true (now, or the snapshot's savedAt) rather than staying on the
  // original real opening date — otherwise a later re-track would use
  // calendarDaysSince(openingAt) to reduce DTE a second time on top of legs whose
  // DTE already reflects that elapsed time once (see
  // claude/wiring-check-2026-09-03.md for the fuller design discussion).
  const performSwitchToAnalysis = useCallback((source: "baseline" | "current" | string) => {
    if (!isCompareMode) return;
    let newLegs: Leg[];
    let newSpot: number;
    let newOpeningAt: number;
    if (source === "baseline") {
      newLegs = legs;
      newSpot = spot;
      newOpeningAt = openingAt;
    } else if (source === "current") {
      // These legs are becoming the new OPENING combo — strip openLegId
      // (it referenced a now-irrelevant prior opening leg; see types.ts)
      // rather than carrying a stale cross-reference forward. A fresh
      // trackedLegs derived from this new baseline later gets its own
      // correct openLegId pointing back to these ids, same as any other
      // switch-to-compare.
      newLegs = (trackedLegs ?? legs).map((l) => asOpeningLeg(l, uid()));
      newSpot = effectiveTrackedSpot;
      newOpeningAt = Date.now();
    } else {
      const snap = trackedStrategy?.trackedSnapshots?.find((sn) => sn.id === source);
      if (!snap) return;
      newLegs = snap.legs.map((l) => asOpeningLeg(l, uid()));
      newSpot = snap.spot;
      newOpeningAt = snap.savedAt;
    }
    setLegs(newLegs);
    setSpot(newSpot);
    setOpeningAt(newOpeningAt);
    setShifts({ dS: 0, dT: 0, dV: 0 });
    legBaseSpot.current = newSpot;
    legBaseSymbol.current = symbol;
    spotManuallySet.current = true;
    setTrackedLegs(null);
    setTrackingStrategyId(null);
    setTrackedSpot(null);
    setActiveSnapshotId(null);
    setTrackedDaysElapsed(0);
    setCorrectedSpot(null);
    setStrategyBaseline(serializeStrategyState(symbol, newLegs, { dS: 0, dT: 0, dV: 0 }, newOpeningAt));
    clearLegSelection();
  }, [isCompareMode, legs, spot, openingAt, trackedLegs, effectiveTrackedSpot, trackedStrategy, symbol]);

  // Public entry point used by the UI. Switching to "current" carries the
  // dirty edits themselves into analysis mode, so it never loses anything
  // and skips the confirmation. Switching to "baseline" or a snapshot would
  // silently drop them, so — same protection as the existing preset-switch
  // and clear-all flows — ask first via ConfirmSnapshotDialog.
  const handleSwitchToAnalysis = useCallback((source: "baseline" | "current" | string) => {
    if (!isCompareMode) return;
    if (trackedDirty && source !== "current") {
      pendingSwitchSource.current = source;
      setConfirmSwitchOpen(true);
      return;
    }
    performSwitchToAnalysis(source);
  }, [isCompareMode, trackedDirty, performSwitchToAnalysis]);

  const legToolbar = (
    <>
      {/* Analysis ↔ compare mode switch — lives here, first in the toolbar
          (left of "+"), per xue's request 2026-09-06: 切换按钮, +, 删除, 策略库.
          Previously sat in AppHeader.tsx between the preset picker and the
          symbol field; moved into legToolbar so it renders in whichever row
          this toolbar itself renders in (the 开仓价/开仓日期 row in analysis
          mode, the "开仓组合" header row in compare mode — see
          LegListSection.tsx). LegPanelTitleRow.tsx no longer owns any of
          this, including the "对比模式" text badge (removed per xue's
          request) — it now only shows the strategy badge and leg count. */}
      {!simOrigin && !isCompareMode && legs.length > 0 && (
        <button
          onClick={handleSwitchToCompare}
          title={t("leg.switchToCompareHint")}
          className="flex shrink-0 items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] font-semibold text-sky-400 transition hover:border-sky-500/50"
        >
          <GitCompare size={11} />
          {t("leg.switchToCompare")}
        </button>
      )}
      {!simOrigin && isCompareMode && (
        <DropdownMenu label={t("leg.switchToAnalysis")} icon={<GitCompare size={11} />} menuClassName="w-64">
          {(close) => (
            <>
              <button
                onClick={() => { close(); handleSwitchToAnalysis("baseline"); }}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-[11px] text-slate-300 transition hover:bg-slate-800"
              >
                <span className="font-semibold">{t("leg.switchSourceBaseline")}</span>
                <span className="text-[9px] text-slate-500">{t("leg.switchSourceBaselineHint")}</span>
              </button>
              <button
                onClick={() => { close(); handleSwitchToAnalysis("current"); }}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-[11px] text-slate-300 transition hover:bg-slate-800"
              >
                <span className="font-semibold">{t("leg.switchSourceCurrent")}</span>
                <span className="text-[9px] text-slate-500">{t("leg.switchSourceCurrentHint")}</span>
              </button>
              {(trackedStrategy?.trackedSnapshots?.length ?? 0) > 0 && (
                <>
                  <div className="my-1 border-t border-slate-800" />
                  <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-600">{t("leg.switchSourceSnapshot")}</div>
                  {trackedStrategy!.trackedSnapshots!.map((sn, idx) => (
                    <button
                      key={sn.id}
                      onClick={() => { close(); handleSwitchToAnalysis(sn.id); }}
                      className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-slate-300 transition hover:bg-slate-800"
                    >
                      <History size={11} className="text-sky-500" />
                      #{idx + 1} {new Date(sn.savedAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </DropdownMenu>
      )}
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
          <button
            onClick={() => { close(); setManageMode("open"); setManageStrategyOpen(true); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
          >
            <Settings2 size={12} className="text-amber-400" /> {t("toolbar.manageStrategy")}
          </button>
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
      <AppHeader
        simOrigin={simOrigin}
        onCancelSimOrigin={onCancelSimOrigin}
        onBackHome={onBackHome}
        isCompareMode={isCompareMode}
        canSaveStrategy={canSaveStrategy}
        onRequestLeave={() => setConfirmLeaveOpen(true)}
        customPresets={customPresets}
        onDeleteCustomPreset={handleDeleteCustom}
        onSelectPreset={(preset) => {
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
        symbolWrapRef={symbolWrapRef}
        symbol={symbol}
        onSymbolChange={setSymbol}
        symbolDropdownOpen={symbolDropdownOpen}
        onToggleSymbolDropdown={() => setSymbolDropdownOpen((v) => !v)}
        recentSymbols={recentSymbols}
        onPickRecentSymbol={(s) => { setSymbol(s); setSymbolDropdownOpen(false); }}
        quote={quote}
        quoteLoading={quoteLoading}
        quoteError={quoteError}
        onRefetchQuote={refetch}
        priceChange={priceChange}
        changePct={changePct}
        onOpenHelp={() => setHelpOpen(true)}
      />

      {showAnalysisGuide && !isCompareMode && (
        <HelpPanel moduleId="analysis" variant="gate" onClose={() => setShowAnalysisGuide(false)} />
      )}
      {showCompareGuide && isCompareMode && (
        <HelpPanel moduleId="compare" variant="gate" onClose={() => setShowCompareGuide(false)} />
      )}

      {simOrigin && (
        <div className="shrink-0 border-b border-emerald-800/40 bg-emerald-950/30 px-4 py-1.5 text-[11px] text-emerald-300">
          {t("sim.simOriginBanner")}
        </div>
      )}

      {/* ── Main two-column layout ── */}
      <div className="flex min-h-0 flex-1 gap-0">
        {/* LEFT: Leg inputs */}
        <div className="flex shrink-0 flex-col overflow-y-auto border-r border-slate-800" style={{ width: "38%", minWidth: 380 }}>
          <div className="sticky top-0 z-20 grid shrink-0 grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto] items-center gap-x-2 gap-y-1 border-b border-slate-800/60 bg-slate-950 px-3 py-1.5">
            <LegPanelTitleRow
              strategyName={strategyName}
              customPresets={customPresets}
              legsCount={legs.length}
            />
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
                      className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] tabular-nums text-slate-300 outline-none transition focus:border-sky-500 focus:text-sky-200 [color-scheme:dark]"
                    />
                  </label>
                  <div className="ml-auto flex items-center gap-2">
                    {legToolbar}
                  </div>
                </div>
              )}
            {/* flex-wrap (not nowrap+shrink-0): once the net-Greeks readout
                was added alongside pop/breakeven, the row's min-content
                width could exceed this column's width — with nowrap that
                silently pushed content outside the panel's
                clipped/auto-scrolling bounds, hiding it with no visual sign
                anything was missing. Wrapping keeps every item visible, just
                on a second line when the column is too narrow. Fixed
                2026-09-06 — see claude/analysis-compare-mode-review-2026-09-06.md.
                The health badge itself no longer lives in this row — moved
                2026-09-06 down to sit beside 保存策略组合/保存追踪快照 (see
                LegListSection.tsx/TrackedComboSection.tsx) per xue's
                request, since that's a calmer landing spot than this
                already-crowded header row. */}
            <div className="col-start-2 row-start-1 ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
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
              {displayGreeks && (activeLegs.length > 0 || activeTrackedLegs) && (
                // flex-wrap (not shrink-0): on a narrow left panel these 4
                // stats plus the pop/breakeven block and the health badge
                // no longer fit on one line — letting this group itself
                // break into two rows keeps everything visible instead of
                // this one block alone forcing the whole row past the
                // panel's right edge (see the wrap note above).
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-r border-slate-800 pr-2" title={t("greeks.hint")}>
                  <div className="flex items-baseline gap-1">
                    <Term titleKey="glossary.delta" descKey="glossary.deltaDesc" className="whitespace-nowrap text-[10px] text-slate-500">{t("greeks.netDelta")}</Term>
                    <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-sky-300">{fmtGreek(displayGreeks.delta)}</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <Term titleKey="glossary.theta" descKey="glossary.thetaDesc" className="whitespace-nowrap text-[10px] text-slate-500">{t("greeks.netTheta")}</Term>
                    <span className={`whitespace-nowrap text-xs font-semibold tabular-nums ${displayGreeks.theta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtGreek(displayGreeks.theta)}</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <Term titleKey="glossary.vega" descKey="glossary.vegaDesc" className="whitespace-nowrap text-[10px] text-slate-500">{t("greeks.netVega")}</Term>
                    <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-sky-300">{fmtGreek(displayGreeks.vega)}</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <Term titleKey="glossary.gamma" descKey="glossary.gammaDesc" className="whitespace-nowrap text-[10px] text-slate-500">{t("greeks.netGamma")}</Term>
                    <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-sky-300">{fmtGreek(displayGreeks.gamma, 3)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Original combo section ── */}
          <LegListSection
            isCompareMode={isCompareMode}
            trackedStrategy={trackedStrategy}
            activeSnapshotId={activeSnapshotId}
            onUpdateSnapshotTime={handleUpdateSnapshotTime}
            legToolbar={legToolbar}
            positionHealth={positionHealth}
            spot={spot}
            openingAt={openingAt}
            activeLegs={activeLegs}
            effectiveTrackedSpot={effectiveTrackedSpot}
            liveSpot={liveTrackedSpot}
            activeTrackedLegs={activeTrackedLegs}
            effectiveDaysElapsed={effectiveDaysElapsed}
            legs={legs}
            selectedCount={selectedCount}
            selectedLegIds={selectedLegIds}
            onClearLegSelection={clearLegSelection}
            onSelectAllLegs={selectAllLegs}
            canSaveStrategy={canSaveStrategy}
            onSaveStrategy={() => setSaveStrategyOpen(true)}
            allSelectedDisabled={allSelectedDisabled}
            onBulkToggleDisable={bulkToggleDisable}
            onRequestBulkDelete={requestBulkDelete}
            scenarioPriceById={scenarioPriceById}
            symbol={symbol}
            onChangeLeg={updateLeg}
            onToggleLeg={toggleLeg}
            onDeleteLeg={deleteLeg}
            onAddToPreset={() => setSaveDialogOpen(true)}
            onRoll={handleRoll}
            onHedge={handleHedge}
            onProtect={handleProtect}
            onCompare={handleCompare}
            onMoveLeg={moveLeg}
            onToggleLegSelection={toggleLegSelection}
            simOrigin={simOrigin}
            onConfirmSimOpen={onConfirmSimOpen}
          />
          {/* ── Today's combo section (compare mode only) ── */}
          {isCompareMode && trackedLegs && (
            <TrackedComboSection
              trackedLegs={trackedLegs}
              trackedStrategy={trackedStrategy}
              activeSnapshotId={activeSnapshotId}
              onSelectSnapshot={handleSelectSnapshot}
              onDeleteSnapshot={handleDeleteSnapshot}
              onSaveTracked={handleSaveTracked}
              trackedDirty={trackedDirty}
              positionHealth={positionHealth}
              trackedResult={trackedResult}
              spot={spot}
              activeLegs={activeLegs}
              effectiveTrackedSpot={effectiveTrackedSpot}
              liveSpot={liveTrackedSpot}
              activeTrackedLegs={activeTrackedLegs}
              effectiveDaysElapsed={effectiveDaysElapsed}
              onToggleImpliedInfo={() => setShowImpliedInfo((v) => !v)}
              symbol={symbol}
              trackedLegPnlById={trackedLegPnlById}
              trackedLegRolesById={trackedLegRolesById}
              onChangeTrackedLeg={updateTrackedLeg}
              // Explicitly tag these as targeting the TRACKED combo — see
              // useLegEditing.ts's handleRoll/handleHedge/handleProtect,
              // which default to the opening combo ("legs") otherwise.
              // Before this, a Roll/Hedge/Protect clicked from a "今日组合"
              // row silently mutated the opening combo instead of the row
              // the person actually clicked on.
              onRoll={(legId: string) => handleRoll(legId, "tracked")}
              onHedge={() => handleHedge("tracked")}
              onProtect={(legId: string) => handleProtect(legId, "tracked")}
              onMoveTrackedLeg={moveTrackedLeg}
            />
          )}

          {isCompareMode && pnlAttribution && (
            <div className="shrink-0 border-t border-slate-800 px-3 py-2">
              <PnlAttributionPanel attribution={pnlAttribution} maxAbs={attributionMaxAbs} />
            </div>
          )}

          {!isCompareMode && analysisAttribution && (
            <div className="shrink-0 border-t border-slate-800 px-3 py-2">
              <PnlAttributionPanel attribution={analysisAttribution} maxAbs={attributionMaxAbs} />
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
            <ErrorBoundary>
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
                liveSpot={isCompareMode && liveTrackedSpot !== null ? liveTrackedSpot : undefined}
                onAlert={setAlert}
                correctedSpot={correctedSpot}
                correcting={correcting}
                onCorrectSpot={handleCorrectSpot}
                symbolForCorrect={symbol}
              />
            </ErrorBoundary>
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

      {helpOpen && (
        <HelpPanel moduleId={isCompareMode ? "compare" : "analysis"} variant="info" onClose={() => setHelpOpen(false)} />
      )}

      <LegActionDialogs
        saveDialogOpen={saveDialogOpen}
        onCloseSaveDialog={() => setSaveDialogOpen(false)}
        onSaveCustomPreset={handleAddCustom}
        activeLegs={activeLegs}
        confirmClearOpen={confirmClearOpen}
        onConfirmClear={clearAllLegs}
        onCancelClear={() => setConfirmClearOpen(false)}
        confirmBulkDeleteOpen={confirmBulkDeleteOpen}
        selectedCount={selectedCount}
        onConfirmBulkDelete={confirmBulkDelete}
        onCancelBulkDelete={() => setConfirmBulkDeleteOpen(false)}
        confirmSaveTrackedOpen={confirmSaveTrackedOpen}
        onDontSaveTracked={() => { setConfirmSaveTrackedOpen(false); doClearAll(); }}
        onSaveTrackedThenClear={async () => {
          setConfirmSaveTrackedOpen(false);
          await handleSaveTracked();
          doClearAll();
        }}
        rollTarget={rollTarget}
        rollTargetSource={rollTargetSource}
        onCloseRoll={() => setRollTarget(null)}
        onConfirmRoll={handleRollConfirm}
        protectTarget={protectTarget}
        protectTargetSource={protectTargetSource}
        onCloseProtect={() => setProtectTarget(null)}
        onConfirmProtect={handleProtectConfirm}
        hedgeOpen={hedgeOpen}
        hedgeTargetSource={hedgeTargetSource}
        legs={legs}
        trackedLegsForDialogs={activeTrackedLegs ?? []}
        trackedSpotForDialogs={effectiveTrackedSpot}
        onCloseHedge={() => setHedgeOpen(false)}
        onConfirmHedge={handleHedgeConfirm}
        compareTargetId={compareTargetId}
        shifts={shifts}
        onCloseCompare={() => setCompareTargetId(null)}
        showImpliedInfo={showImpliedInfo}
        isCompareMode={isCompareMode}
        effectiveTrackedSpot={effectiveTrackedSpot}
        correctedSpot={correctedSpot}
        correcting={correcting}
        onCloseImplied={() => setShowImpliedInfo(false)}
        onCorrectSpot={() => { handleCorrectSpot(); setShowImpliedInfo(false); }}
        spot={spot}
        symbol={symbol}
      />

      <StrategyPersistenceDialogs
        confirmPresetOpen={confirmPresetOpen}
        onCancelPresetSwitch={() => { setConfirmPresetOpen(false); pendingPresetAction.current = null; }}
        onDontSavePresetSwitch={() => { setConfirmPresetOpen(false); if (pendingPresetAction.current) { applyPreset(pendingPresetAction.current.rawLegs); pendingPresetAction.current = null; } }}
        onSaveSnapshotThenPresetSwitch={async () => {
          setConfirmPresetOpen(false);
          await handleSaveTracked();
          if (pendingPresetAction.current) { applyPreset(pendingPresetAction.current.rawLegs); pendingPresetAction.current = null; }
        }}
        confirmReplaceOpen={confirmReplaceOpen}
        onCancelReplace={() => { setConfirmReplaceOpen(false); pendingPresetReplace.current = null; }}
        onDontSaveReplace={() => {
          setConfirmReplaceOpen(false);
          if (pendingPresetReplace.current) { applyPreset(pendingPresetReplace.current); pendingPresetReplace.current = null; }
        }}
        onSaveFirstReplace={() => {
          setConfirmReplaceOpen(false);
          setSaveStrategyOpen(true);
          // pendingPresetReplace stays set — applied once the save succeeds
        }}
        confirmLeaveOpen={confirmLeaveOpen}
        onCancelLeave={() => setConfirmLeaveOpen(false)}
        onDontSaveLeave={() => { setConfirmLeaveOpen(false); onBackHome?.(); }}
        onSaveFirstLeave={() => {
          setConfirmLeaveOpen(false);
          pendingLeaveAfterSave.current = true;
          setSaveStrategyOpen(true);
          // navigation fires from inside handleSaveStrategy/handleOverwriteStrategy once the save succeeds
        }}
        confirmSwitchOpen={confirmSwitchOpen}
        onCancelSwitch={() => { setConfirmSwitchOpen(false); pendingSwitchSource.current = null; }}
        onDontSaveSwitch={() => {
          setConfirmSwitchOpen(false);
          if (pendingSwitchSource.current) { performSwitchToAnalysis(pendingSwitchSource.current); pendingSwitchSource.current = null; }
        }}
        onSaveSnapshotThenSwitch={async () => {
          setConfirmSwitchOpen(false);
          await handleSaveTracked();
          if (pendingSwitchSource.current) { performSwitchToAnalysis(pendingSwitchSource.current); pendingSwitchSource.current = null; }
        }}
        confirmSymbolChangeOpen={confirmSymbolChangeOpen}
        onCancelSymbolChange={() => {
          setConfirmSymbolChangeOpen(false);
          // Revert the input back to the old symbol — the person typed a new
          // one, saw the "unsaved changes" prompt, and backed out, so the
          // combo and the symbol box should agree again rather than leaving
          // a new symbol showing over strikes that never got rescaled.
          setSymbol(legBaseSymbol.current);
          pendingSymbolChange.current = null;
        }}
        onDontSaveSymbolChange={() => {
          setConfirmSymbolChangeOpen(false);
          if (pendingSymbolChange.current) {
            rescaleForNewSymbol(pendingSymbolChange.current.symbol, pendingSymbolChange.current.spot);
            pendingSymbolChange.current = null;
          }
        }}
        onSaveSnapshotThenSymbolChange={async () => {
          setConfirmSymbolChangeOpen(false);
          await handleSaveTracked();
          if (pendingSymbolChange.current) {
            rescaleForNewSymbol(pendingSymbolChange.current.symbol, pendingSymbolChange.current.spot);
            pendingSymbolChange.current = null;
          }
        }}
        saveStrategyOpen={saveStrategyOpen}
        onCloseSaveStrategy={() => { setSaveStrategyOpen(false); pendingPresetReplace.current = null; pendingLeaveAfterSave.current = false; pendingSaveTrackedAfterStrategy.current = false; }}
        onSaveStrategy={handleSaveStrategy}
        onOverwriteStrategy={handleOverwriteStrategy}
        symbol={symbol}
        comboDirection={comboDirection}
        strategyName={strategyName}
        activeLegs={activeLegs}
        spot={spot}
        shifts={shifts}
        openingAt={openingAt}
        savedStrategies={savedStrategies}
        manageStrategyOpen={manageStrategyOpen}
        onCloseManage={() => setManageStrategyOpen(false)}
        manageMode={manageMode}
        onOpenStrategy={handleOpenStrategy}
        onReorderStrategies={handleReorderStrategies}
        onRenameStrategy={handleRenameStrategy}
        onDeleteStrategy={handleDeleteStrategy}
        onToggleStarStrategy={handleToggleStar}
        onTrackStrategy={handleTrack}
      />
    </div>
  );
}