// src/App.tsx
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Plus, Layers, Settings2, RefreshCw, TrendingUp, TrendingDown, ChevronDown, Trash2, Clock, Download, Upload, FileSymlink, Unlink, X, Database, HelpCircle, DollarSign, Ban, Wallet, GitCompare, History, Lightbulb } from "lucide-react";
import type { Leg, Shifts } from "@/lib/types";
import PnlAttributionPanel from "@/components/PnlAttributionPanel";
import { matchStrategy } from "@/lib/matchStrategy";
import LegListSection from "@/components/LegListSection";
import ShiftSliders from "@/components/ShiftSliders";
import PayoffChart, { type AlertInfo } from "@/components/PayoffChart";
import { useStockQuote } from "@/lib/useStockQuote";
import { loadRecentSymbols, addRecentSymbol } from "@/lib/recentSymbols";
import { serializeStrategyState } from "@/lib/savedStrategies";
import DropdownMenu from "@/components/DropdownMenu";
import { useAutoSync } from "@/hooks/useAutoSync";
import { useCustomPresets } from "@/hooks/useCustomPresets";
import { useSavedStrategies } from "@/hooks/useSavedStrategies";
import { useLegEditing } from "@/hooks/useLegEditing";
import { useComboAnalytics } from "@/hooks/useComboAnalytics";
import { useStrategyOrchestration } from "@/hooks/useStrategyOrchestration";
import { nearestFridayDte, formatDateInput, parseDateInput } from "@/lib/dateUtils";
import { uid, PRESET_DTE_SET } from "@/lib/legFactory";
import { getOptionChain, resolveFromCache } from "@/lib/optionChain";
import { useI18n } from "@/i18n/I18nContext";
import AppHeader from "@/components/AppHeader";
import LegPanelTitleRow from "@/components/LegPanelTitleRow";
import TrackedComboSection from "@/components/TrackedComboSection";
import LegActionDialogs from "@/components/LegActionDialogs";
import StrategyPersistenceDialogs from "@/components/StrategyPersistenceDialogs";
import { AlertCard, HelpPanel, isGuideDismissed, SituationExplainDialog } from "@/components/dialogs";
import ErrorBoundary from "@/components/ErrorBoundary";
import { explainAnalysisScenario, explainTrackedPosition } from "@/lib/situationExplainer";

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
  // "解释当前情况" dialog (2026-09-09) — separate open-state from helpOpen,
  // which is the static per-module usage guide; this one is generated content
  // (situationExplainer.ts) describing whatever the sliders/tracked position
  // currently show. See the situationExplanation useMemo below (placed after
  // useComboAnalytics's destructure, since it depends on nearly everything
  // that chain returns) for how the content itself is built.
  const [explainOpen, setExplainOpen] = useState(false);
  // Per-module first-entry guides (2026-09-06; persistent "don't show
  // again" added 2026-09-07 — see HelpPanel.tsx's isGuideDismissed).
  // Analysis guide gates fresh entry into analysis mode (skipped for the
  // auto-open-manage "Tracking" card flow and the simOrigin flow, which
  // have their own onboarding); compare guide gates the first time this
  // component ever flips into compare mode (via handleSwitchToCompare /
  // loading a tracked strategy), guarded by compareGuideShown so it never
  // reappears after being dismissed once, even if the user leaves and
  // re-enters compare mode within the same mount. Both are separate from
  // helpOpen, which is the dismissible "使用说明" button version of the
  // same content. Checking isGuideDismissed() in the initial state (rather
  // than closing it a tick after mount) avoids flashing the gate open for
  // a frame once the user has permanently dismissed it.
  const [showAnalysisGuide, setShowAnalysisGuide] = useState(
    () => !autoOpenManage && !simOrigin && !isGuideDismissed("analysis"),
  );
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

  // Pure-computation chain (activeLegs through pnlAttribution) lives in
  // useComboAnalytics.ts — moved there verbatim, 2026-09-08 file-size pass.
  // See that file's own header comment for why strategyName/canSaveStrategy
  // and the showCompareGuide effect right below stay here instead.
  // impliedSpot is returned by the hook (other future callers might want it)
  // but nothing in App.tsx itself reads it directly — it only ever fed
  // effectiveTrackedSpot inside the hook — so it's intentionally left out of
  // this destructure. trackedGreeks used to be in the same situation
  // ("only used internally", feeding positionHealth) but situationExplainer's
  // compare-mode explainer needs the REAL Greeks (not trackedResult's
  // hardcoded-zero breakdown, see that file's own comment), so it's
  // destructured here now too.
  const {
    activeLegs,
    activeTrackedLegs,
    isCompareMode,
    result,
    scenarioPriceById,
    effectiveTrackedSpot,
    trackedGreeks,
    positionHealth,
    pop,
    breakevens,
    analysisAttribution,
    attributionMaxAbs,
    effectiveDaysElapsed,
    trackedResult,
    trackedLegPnlById,
    trackedLegRolesById,
    trackedStrategy,
    trackedVolShift,
    pnlAttribution,
  } = useComboAnalytics({ legs, trackedLegs, trackedSpot, correctedSpot, trackedDaysElapsed, spot, shifts, trackingStrategyId, savedStrategies, t });

  // "解释当前情况" content (2026-09-09) — rule-based, built from values this
  // chain already computed (no new pricing math, no AI call, see
  // situationExplainer.ts's own header comment). Placed right after the
  // useComboAnalytics destructure since that's the first point every value
  // it depends on (activeLegs/activeTrackedLegs/result/trackedResult/
  // trackedGreeks/positionHealth/analysisAttribution/pnlAttribution/
  // breakevens/effectiveTrackedSpot/effectiveDaysElapsed) is already in
  // scope — see CLAUDE.md's TDZ-risk note on where new memos in this file
  // need to go. Returns null when there's nothing to explain yet (no legs),
  // same "return null" convention positionHealth.computeHealth uses.
  const situationExplanation = useMemo(() => {
    if (isCompareMode) {
      if (!activeTrackedLegs || !trackedResult) return null;
      return explainTrackedPosition({
        legs: activeTrackedLegs,
        openingSpot: spot,
        trackedSpot: effectiveTrackedSpot,
        daysElapsed: effectiveDaysElapsed,
        result: trackedResult,
        greeks: trackedGreeks,
        health: positionHealth,
        attribution: pnlAttribution,
        breakevens,
        t,
      });
    }
    return explainAnalysisScenario({
      legs: activeLegs,
      spot,
      shifts,
      result,
      health: positionHealth,
      attribution: analysisAttribution,
      breakevens,
      t,
    });
  }, [
    isCompareMode, activeTrackedLegs, trackedResult, spot, effectiveTrackedSpot, effectiveDaysElapsed,
    trackedGreeks, positionHealth, pnlAttribution, breakevens, t, activeLegs, shifts, result, analysisAttribution,
  ]);

  useEffect(() => {
    if (isCompareMode && !compareGuideShown.current) {
      compareGuideShown.current = true;
      if (!isGuideDismissed("compare")) setShowCompareGuide(true);
    }
  }, [isCompareMode]);

  const strategyName = useMemo(() => matchStrategy(activeLegs, spot, customPresets), [activeLegs, spot, customPresets]);
  const canSaveStrategy = activeLegs.length > 0 && serializeStrategyState(symbol, legs, shifts, openingAt) !== strategyBaseline;

  // Combo-mutation + strategy-persistence/mode-switch cluster — moved to
  // useStrategyOrchestration.ts verbatim, 2026-09-08 (second file-size pass).
  // CLAUDE.md flags this as the HIGHER-risk of the two "intentionally not
  // yet split" clusters (historically the highest bug-density code in the
  // project) — see that file's header comment for why it was bundled as one
  // big hook rather than split further, and for why every ref below is
  // passed through rather than returned.
  const {
    handleAddCustom,
    addingToSim,
    handleAddToSimAccount,
    addLeg,
    clearAllLegs,
    applyPreset,
    doClearAll,
    updateTrackedLeg,
    handleCorrectSpot,
    comboDirection,
    handleSaveStrategy,
    handleOverwriteStrategy,
    handleTrack,
    handleSaveTracked,
    handleSelectSnapshot,
    handleDeleteSnapshot,
    handleUpdateSnapshotTime,
    handleOpenStrategy,
    handleSwitchToCompare,
    performSwitchToAnalysis,
    handleSwitchToAnalysis,
  } = useStrategyOrchestration({
    symbol, legs, activeLegs, spot, shifts, openingAt,
    setSymbol, setLegs, setSpot, setShifts, setOpeningAt, setCorrectedSpot, setCorrecting,
    isCompareMode, trackedLegs, trackedSpot, trackedDirty, effectiveTrackedSpot,
    setTrackedLegs, setTrackedSpot, setTrackedDaysElapsed, setTrackedDirty, setActiveSnapshotId, setConfirmSaveTrackedOpen,
    savedStrategies, trackingStrategyId, trackedStrategy,
    setSavedStrategies, setTrackingStrategyId, setStrategyBaseline, setSaveStrategyOpen, setManageStrategyOpen,
    setConfirmClearOpen, setConfirmSwitchOpen,
    legBaseSpot, legBaseSymbol, spotManuallySet,
    pendingPreset, pendingPresetReplace, pendingLeaveAfterSave, pendingSaveTrackedAfterStrategy, pendingSwitchSource,
    clearLegSelection, onBackHome, onAddToSimAccount, addCustomPresetToLibrary, quote, t,
  });


  // Analysis ↔ compare mode switch — split out of legToolbar (2026-09-07)
  // and rendered instead next to the ticker symbol in PayoffChart.tsx's
  // header, alongside the health badge — per xue's request: both were easy
  // to miss buried in the crowded left-panel toolbar row, and the ticker
  // symbol next to the chart is what a person's eye actually goes to first.
  // legToolbar itself (+, 清空, 策略库, 加入模拟仓) keeps rendering in the
  // same left-panel row it always has; only the switch button moved.
  const modeSwitchButton = (
    <>
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
    </>
  );

  // "解释当前情况" button — rendered into ShiftSliders' header row via its
  // explainButton prop (same "App.tsx builds the JSX, the child component
  // just renders it" pattern as modeSwitchButton/PayoffChart.tsx above).
  // Disabled (not hidden) when there's nothing to explain yet, same
  // "展示框架+解释原因" convention CLAUDE.md documents elsewhere — an empty
  // combo still shows the button, just inert, rather than the row shifting
  // around as legs are added.
  const explainButton = (
    <button
      onClick={() => setExplainOpen(true)}
      disabled={!situationExplanation}
      title={t("explain.button")}
      aria-label={t("explain.button")}
      className="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-400 transition hover:text-amber-300 disabled:cursor-not-allowed disabled:text-slate-600"
    >
      <Lightbulb size={11} />
      {t("explain.button")}
    </button>
  );

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
            {/* flex-wrap (not nowrap+shrink-0): kept even after the
                net-Greeks readout was removed (2026-09-07) — the pop/
                breakeven block alone can still exceed this column's width
                on a narrow left panel, and with nowrap that silently pushed
                content outside the panel's clipped/auto-scrolling bounds,
                hiding it with no visual sign anything was missing. Fixed
                2026-09-06 — see claude/analysis-compare-mode-review-2026-09-06.md.
                The health badge itself no longer lives in this row. It sat
                beside 保存策略组合/保存追踪快照 (LegListSection.tsx/
                TrackedComboSection.tsx) from 2026-09-06, then moved again
                2026-09-07 to PayoffChart.tsx's header, next to the ticker
                symbol, alongside the mode-switch button (formerly the first
                item in legToolbar) — per xue's request, since that's what
                the eye actually goes to first, more than a spot buried in
                the left panel. */}
            <div className="col-start-2 row-start-1 ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
              {activeLegs.length > 0 && pop > 0 && (
                <div className="flex shrink-0 items-center gap-2">
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
          <LegListSection
            isCompareMode={isCompareMode}
            trackedStrategy={trackedStrategy}
            activeSnapshotId={activeSnapshotId}
            onUpdateSnapshotTime={handleUpdateSnapshotTime}
            legToolbar={legToolbar}
            spot={spot}
            openingAt={openingAt}
            activeLegs={activeLegs}
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
              breakevens={breakevens}
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
                positionHealth={positionHealth}
                modeSwitchButton={modeSwitchButton}
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
              explainButton={explainButton}
            />
          </div>
        </div>
      </div>

      {helpOpen && (
        <HelpPanel moduleId={isCompareMode ? "compare" : "analysis"} variant="info" onClose={() => setHelpOpen(false)} />
      )}

      {explainOpen && situationExplanation && (
        <SituationExplainDialog
          title={t(isCompareMode ? "explain.dialogTitleCompare" : "explain.dialogTitleAnalysis")}
          explanation={situationExplanation}
          onClose={() => setExplainOpen(false)}
        />
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