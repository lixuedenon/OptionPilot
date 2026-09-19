// src/App.tsx
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Plus, Layers, Settings2, RefreshCw, Trash2, Clock, DollarSign, Wallet, GitCompare, History, Lightbulb } from "lucide-react";
import type { Leg, Shifts } from "@/lib/types";
import PnlAttributionPanel from "@/components/PnlAttributionPanel";
import { matchStrategy } from "@/lib/matchStrategy";
import LegListSection from "@/components/LegListSection";
import ShiftSliders from "@/components/ShiftSliders";
import PayoffChart, { type AlertInfo } from "@/components/PayoffChart";
import { useStockQuote } from "@/lib/useStockQuote";
import { useEpsEstimate } from "@/hooks/useEpsEstimate";
import { loadRecentSymbols, addRecentSymbol } from "@/lib/recentSymbols";
import { serializeStrategyState, computeOpeningSimBasis, type SavedStrategy, type OpeningSimBasis } from "@/lib/savedStrategies";
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
import { estimateRescaledPremium } from "@/lib/pricing";
import { useI18n } from "@/i18n/I18nContext";
import AppHeader from "@/components/AppHeader";
import LegPanelTitleRow from "@/components/LegPanelTitleRow";
import TrackedComboSection from "@/components/TrackedComboSection";
import LegActionDialogs from "@/components/LegActionDialogs";
import StrategyPersistenceDialogs from "@/components/StrategyPersistenceDialogs";
import { AlertCard, ConfirmLockRollDialog, HelpPanel, isGuideDismissed, SituationExplainDialog, ExpiredStrategyDialog, ExpiredTrackPromptDialog } from "@/components/dialogs";
import ErrorBoundary from "@/components/ErrorBoundary";
import { explainAnalysisScenario, explainTrackedPositionAdvice } from "@/lib/situationExplainer";

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
  // 2026-09-12: gates the "保存追踪快照" BUTTON specifically (not
  // handleSaveTracked itself, which useStrategyOrchestration.ts's other
  // callers — save-then-clear/switch-mode/switch-preset/symbol-change — all
  // call directly after their OWN confirm dialog already ran; nesting a
  // second confirmation inside handleSaveTracked would double-prompt those
  // flows for a comparatively rare edge case). See handleSaveTrackedClick
  // below and lib/types.ts's `derivedFrom.locked` comment for why this
  // exists: saving permanently locks any pending roll/protect/hedge against
  // being undone, so this warns before that happens rather than only after,
  // when the person notices "撤销" no longer works.
  const [confirmLockRollOpen, setConfirmLockRollOpen] = useState(false);
  const [openingAt, setOpeningAt] = useState<number>(() => Date.now());
  // 对比模式"开仓组合"标题栏日期字段的临时模拟值——2026-09-14, xue明确要求
  // 这个字段"只是临时让用户模拟不同的日期，而提供的方便"，不写回
  // openingAt/存储。null表示未在模拟，字段显示/使用真实的openingAt；非null
  // 时是用户刚确认要预览的假设日期，只影响这一个字段自己的显示（不重算
  // legs的dte/定价/健康度——那些数字仍然反映真实的开仓日期）。见
  // useStrategyOrchestration.ts里各处的重置调用：切换模式/重新打开策略/
  // 跟踪/任何保存动作都会把它清回null，回到真实日期。
  const [openingAtSimOverride, setOpeningAtSimOverride] = useState<number | null>(null);
  // 打开一条"真实经过天数已经超过它第0天完整周期"的策略时弹出的"已过期，
  // 删除还是保留"确认框——非null即弹出，值是那条过期的策略本身。
  const [expiredStrategyPrompt, setExpiredStrategyPrompt] = useState<SavedStrategy | null>(null);
  // 2026-09-17新增，修复一个刚发现的bug：下面isExpiredReal本来想直接从
  // openingSimBasis（每次渲染都用实时legs重算）派生，但handleOpenStrategy
  // /handleTrack往live legs状态里写dte时会经过Math.max(0, 原始dte-已衰减
  // 天数)——一旦真的已经过期（原始dte-衰减天数<0），这个0下限会把"到底
  // 提前过期了多少天"这个信息永久抹掉。live legs一旦落到dte=0，
  // computeOpeningSimBasis每次重算都会（错误地）把originalMaxDte反推得
  // 很大，导致"已过期"这件事只在handleOpenStrategy/handleTrack那次一次性
  // 检查时（用的是没被钳过的原始s.legs）判断对了、弹了确认框，用户点"保
  // 留"之后这个判断在后续每次渲染里立刻失真变回false——图表变暗提示条、
  // 以及下面LegRow那个"已过期禁止刷新市场价"的保护，实际上都不会生效（用
  // Playwright测过，"保留"之后提示条不出现）。用一个显式state而不是每次
  // 重算，把"这条策略在加载那一刻已经过了真实到期日"这个结论固定下来，
  // 不会随后续渲染丢失——只在真正重新加载/清空时才重置。
  const [expiredConfirmed, setExpiredConfirmed] = useState(false);
  // 2026-09-17新增：对比模式"跟踪"一条已经过了真实到期日的策略时弹出的
  // 提示——非null即弹出，值是那条过期的策略本身。跟上面的
  // expiredStrategyPrompt（分析模式"打开策略"用，删除/保留二选一）是两
  // 个独立的state：对比模式没有"保留"这个选项——没有真实行情可比对，跟
  // 踪这件事本身就没有意义，所以这里只提示信息+一个"确定"按钮，点击后
  // 直接删除这条策略（handleTrack发现过期时会直接return，不做任何状态
  // 变更，所以这个"确定"不需要额外清场，直接调handleDeleteStrategy即
  // 可）。跟xue讨论后确定：分析模式保留"保留"选项（纯本地模拟，不依赖
  // 真实数据，历史复盘仍有意义），对比模式不保留。
  const [expiredTrackPrompt, setExpiredTrackPrompt] = useState<SavedStrategy | null>(null);
  // 2026-09-17新增，最终确认的锁定设计："滑块开始滑动，所有可编辑输入全
  // 部锁定，直到点击重置"（xue原话）——不是为了处理某种语义歧义，是一个
  // 独立、standing的产品要求：只要三个滑块不在静止点(0,0,0)，就不允许再
  // 改任何参数，逼用户要么继续探索、要么点"重置"回到day0再编辑。对比模
  // 式的滑块本来就冻结（disabled），不需要这层锁。声明放在这么靠前，是
  // 因为下面"实时报价"那个effect（rescaleForNewSymbol等）也要用它来拦住
  // 后台路径改写spot/legs——那个effect定义的位置比isCompareModeNow早，
  // 这里直接用trackedLegs!==null代替，避免提前引用后面才声明的
  // isCompareModeNow。
  const isExploring = trackedLegs === null && (shifts.dS !== 0 || shifts.dT !== 0 || shifts.dV !== 0);
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
  const { t, lang } = useI18n();

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
    canUnifyLegs,
    unifyQty,
    unifyStrike,
    unifyDte,
    handleRoll,
    handleRollConfirm,
    handleProtect,
    handleProtectConfirm,
    handleCompare,
    handleHedge,
    handleHedgeConfirm,
    moveLeg,
    moveTrackedLeg,
    toggleTrackedLeg,
    closeTrackedLeg,
  } = useLegEditing({ legs, setLegs, trackedLegs, setTrackedLegs, setTrackedDirty });
  // Which combo's "添加到预设" last opened the shared SavePresetDialog (see
  // LegActionDialogs' `activeLegs` prop below) — "开仓组合" (legs) and
  // "今日组合" (trackedLegs) are different arrays that both need to reach
  // the same dialog. 2026-09-12: added so TrackedComboSection's leg menu
  // can save FROM the tracked combo instead of always saving the opening
  // combo regardless of which row's "..." menu was actually clicked.
  const [presetSaveSource, setPresetSaveSource] = useState<"legs" | "tracked">("legs");
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
  // already has one. When it doesn't, instead of resetting the premium to a
  // hard 0 (which used to make "情景估值"/scenarioValue look frozen — a 0
  // premium back-solves to an artificial near-zero implied vol, so the leg
  // barely responds to the shift sliders at all until the market premium
  // arrives — see estimateRescaledPremium's own comment in pricing.ts), this
  // carries the leg's OWN implied vol (backed out at its old strike/spot/
  // premium) over onto the new strike/spot as an immediate placeholder — the
  // per-leg auto-fill effect still supersedes it with the real market
  // premium shortly after; this just closes the "looks stuck" gap in
  // between (or if that fetch never resolves at all). Applies to both the
  // opening combo (legs) and, in compare mode, the "今日组合" (trackedLegs)
  // — a symbol swap makes the old strikes meaningless for both, not just
  // one side.
  const rescaleForNewSymbol = useCallback((newSymbol: string, newSpot: number) => {
    const sym = newSymbol.trim();
    const oldSpot = legBaseSpot.current;
    const ratio = oldSpot > 0 ? newSpot / oldSpot : 1;
    const rescale = (arr: Leg[]) => arr.map((l) => {
      if (l.kind === "stock") {
        return { ...l, strike: Math.round(newSpot * 100) / 100 };
      }
      const targetStrike = Math.round(l.strike * ratio * 2) / 2;
      const resolved = sym ? resolveFromCache(sym, l.type, targetStrike, l.dte) : null;
      const estimatedPremium = oldSpot > 0 && l.premium > 0
        ? Math.max(0, estimateRescaledPremium(oldSpot, l, newSpot, targetStrike))
        : 0;
      return {
        ...l,
        strike: resolved ? resolved.strike : targetStrike,
        premium: resolved ? resolved.premium : estimatedPremium,
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
  const { estimate: epsEstimate, loading: epsLoading } = useEpsEstimate(symbol);

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
    // 2026-09-17：滑块锁定期间，这个effect本来会在symbol切换/实时报价到
    // 来时静默改写spot/legs（rescaleForNewSymbol等）——光禁用UI输入框挡
    // 不住这些后台路径，得在这里也拦一道，否则"所有输入全部锁定"就不是
    // 真的锁住了。isExploring==false时（静止点/对比模式）行为完全不变。
    if (isExploring) return;
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
  }, [quote, spot, isExploring]);

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
  // this destructure.
  //
  // ⚠️ trackedGreeks IS pulled back in here (2026-09-14, bug fix). It was
  // briefly left out under the assumption that explainTrackedPositionAdvice
  // could read real per-leg delta straight off trackedResult.perLeg — that
  // assumption was wrong. trackedResult (below) is a lightweight
  // premium-difference P&L computation; its perLeg[].change is hardcoded to
  // `{delta:0, gamma:0, theta:0, vega:0, total: <real pnl>}` (see
  // useComboAnalytics.ts's own comment on trackedResult) — only `.total` is
  // real, the Greek fields are deliberately-zero placeholders that were
  // "unused elsewhere" right up until situationExplainer.ts's legDeltaMag()
  // started reading `.change.delta` off of it, silently getting 0.00 for
  // every leg in compare mode regardless of the position's actual delta.
  // trackedGreeks — a real priceCombo() over activeTrackedLegs at zero shift
  // — has genuine per-leg Greeks and was already being computed anyway (it
  // feeds positionHealth's Gamma/Delta factors just below), so this reuses
  // that instead of duplicating the Black-Scholes work.
  // isCompareModeNow本身是useComboAnalytics的输出，这里用trackedLegs!==null
  // 直接算一份等价布尔值，避免循环依赖（这个判断要在调用useComboAnalytics
  // 之前就绪）。
  const isCompareModeNow = trackedLegs !== null;
  // 2026-09-17：day0永远锚定在真实开仓日期(openingAt)，从live的legs/spot/
  // openingAt实时重算——不再是只在保存/加载那几个动作里刷新一次的state
  // （旧bug：useState只在handleSaveStrategy/handleOverwriteStrategy/
  // handleOpenStrategy/handleTrack里被set过，用户之后在分析模式对legs做
  // 的任何实时编辑都不会让它重新计算，导致"情景估值"跟不上刚编辑的权利
  // 金/行权价/数量——见xue用真实持仓截图发现的bug）。legsAsOfTs直接传
  // Date.now()：用户编辑leg.dte时，"到期日-今天"里的"今天"就是这一刻，
  // 对实时数据来说legsAsOf永远等于"现在"。legs为空时没有可算的东西，退
  // 化成null（analyticsLegs下面会回退用原始的legs/spot）。
  const openingSimBasis = useMemo<OpeningSimBasis | null>(() => {
    if (legs.length === 0) return null;
    return computeOpeningSimBasis(openingAt, Date.now(), legs, spot);
  }, [openingAt, legs, spot]);
  // 2026-09-16重新设计：ΔT滑块模拟的是"未来股价/时间/IV变化对组合价值的
  // 影响"——xue原话："以开仓时最初始的数据为基准，不考虑今天这个因素的
  // 影响；只有时间流逝、股价和IV不变时，图形应该从开仓一路平滑变化到到
  // 期，经过'今天'时今天这个日期并不起作用，只是在数轴上打个点而已"；要
  // 对照今天的真实行情就去用对比模式——分析模式是纯模拟，不对照今天的真
  // 实数据（xue原话）。
  //
  // 2026-09-17进一步简化：day0(openingAt)永远是ΔT轴的地板(=0)，不再有
  // "倒回去看真实历史"的负dT功能（原来靠sliderMinDte把滑块下界拉到负
  // 数、analyticsShifts再把它换算回"离开仓天数"——这个功能已经放弃，见
  // ShiftSliders.tsx的注释）。取而代之的是"只要滑块离开(0,0,0)就锁定所
  // 有可编辑输入，点重置才能改参数"（见isExploring），从根上避免了编辑
  // 跟滑块探索的语义冲突，不需要再靠弹窗/回退坐标去处理。所以这里
  // analyticsShifts直接等于shifts（不用再减sliderMinDte），
  // analyticsLegs/analyticsSpot只在openingSimBasis存在时换成开仓那天的
  // 快照（dte已经从"今天"基准修正回openingAt基准）。
  //
  // 这份"图表定价基准"（analyticsLegs/analyticsSpot/analyticsShifts）只
  // 喂给useComboAnalytics.ts里专算图表/归因的那几个memo（result/
  // positionHealth非对比分支/analysisAttribution），不能像上一版那样整
  // 体替换掉hook的`legs`/`spot`/`shifts`主参数——那三个主参数还要驱动
  // `activeLegs`（腿位编辑区渲染、保存按钮可用性、预设策略名称匹配等一
  // 系列跟"滑块打在哪个时间点"完全无关的实时编辑状态），整体替换会导致
  // 载入一条已保存策略后，腿位列表/保存按钮/策略名称一直显示开仓那天的
  // 冻结快照，而不是用户正在编辑的实时数据。
  const analyticsLegs = !isCompareModeNow && openingSimBasis ? openingSimBasis.legs : legs;
  const analyticsSpot = !isCompareModeNow && openingSimBasis ? openingSimBasis.spot : spot;
  const analyticsShifts: Shifts = shifts;
  // 滑块上界：非对比模式下用openingSimBasis的完整周期（开仓到到期），跟
  // 上面的dte修正基准保持一致；没有basis（legs为空）或对比模式下退回旧
  // 的"当前剩余天数"算法。
  const sliderMaxDte = !isCompareModeNow && openingSimBasis
    ? openingSimBasis.originalMaxDte
    : legs.length > 0
      ? Math.max(...legs.filter((l) => l.kind !== "stock").map((l) => l.dte))
      : 30;
  // 这条策略"真实经过天数"已经超过它第0天的完整周期——已过期，但xue的要
  // 求是过期后仍保留时滑块继续能用（只是没有"今天"这个点可打）。
  // 2026-09-17修复：这个判断故意不再从openingSimBasis实时反推（见上面
  // expiredConfirmed state的大段注释——handleOpenStrategy/handleTrack往
  // live legs里写dte时会经过Math.max(0,...)钳到0，一旦真的已经过期，"提
  // 前过期了多少天"这个信息就被永久抹掉，导致实时反推出的originalMaxDte
  // 严重偏大，"已过期"这个结论在第一次弹窗判断对了之后，后续每次渲染都
  // 会立刻变回false）。改成直接读expiredConfirmed这个在加载那一刻用未被
  // 钳过的原始s.legs一次性算好、之后不会丢失的显式state。
  // isExpiredReal对两种模式都成立（供下面LegListSection/
  // TrackedComboSection的expired prop使用：不管在哪个模式，只要真实合约
  // 已经过了到期日，就不该再去发市场价请求——会静默snap到别的合约，见
  // LegRow.tsx的expired prop注释）；isExpiredOpening保留原名/原语义（只
  // 在分析模式为true，驱动图表变暗+提示条）。
  const isExpiredReal = expiredConfirmed;
  const isExpiredOpening = !isCompareModeNow && isExpiredReal;

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
    realizedTrackedPnl,
    trackedLegPnlById,
    trackedLegRolesById,
    trackedStrategy,
    trackedVolShift,
    pnlAttribution,
  } = useComboAnalytics({ legs, analyticsLegs, analyticsSpot, analyticsShifts, trackedLegs, trackedSpot, correctedSpot, trackedDaysElapsed, spot, shifts, trackingStrategyId, savedStrategies, t });
  // situationExplanation（下面）里"解释当前情况"要跟result/positionHealth/
  // analysisAttribution用同一份图表定价基准的腿位，否则文字引用的数字会
  // 跟图形对不上——不能直接用activeLegs（那是实时编辑腿位，见上面大段注
  // 释），单独过滤一份跟hook内部一致的filter。
  const activeAnalyticsLegs = useMemo(() => analyticsLegs.filter((l) => !l.disabled), [analyticsLegs]);

  // "解释当前情况"内容：分析模式（explainAnalysisScenario，情景滑块下的
  // 前瞻式说明）保持不变；对比模式2026-09-14起改用explainTrackedPositionAdvice
  // ——"该怎么办"建议系统，按腿角色（裸卖出/垂直价差/占位）给出优先级排序
  // 的单一结论，取代原来纯状态描述的explainTrackedPosition（见
  // situationExplainer.ts头部注释）。组合健康度徽章是独立UI元素
  // （PayoffChart.tsx标题栏），不受这次替换影响。Placed right after the
  // useComboAnalytics destructure since that's the first point every value
  // it depends on (activeLegs/activeTrackedLegs/result/trackedResult/
  // positionHealth/analysisAttribution/breakevens/effectiveTrackedSpot/
  // effectiveDaysElapsed) is already in scope — see CLAUDE.md's TDZ-risk
  // note on where new memos in this file need to go. Returns null when
  // there's nothing to explain yet (no legs), same "return null" convention
  // positionHealth.computeHealth uses.
  const situationExplanation = useMemo(() => {
    if (isCompareMode) {
      // result: trackedGreeks, NOT trackedResult — see the destructure
      // comment above trackedGreeks for why. trackedResult's perLeg[].change
      // has real `.total` (P&L) but hardcoded-zero Greek fields; legDeltaMag
      // (situationExplainer.ts) needs the real per-leg delta, which only
      // trackedGreeks (a genuine priceCombo() at zero shift) has.
      if (!activeTrackedLegs || !trackedGreeks) return null;
      return explainTrackedPositionAdvice({
        legs: activeTrackedLegs,
        openingLegs: activeLegs,
        openingSpot: spot,
        trackedSpot: effectiveTrackedSpot,
        daysElapsed: effectiveDaysElapsed,
        result: trackedGreeks,
        lang,
        t,
      });
    }
    // legs用activeAnalyticsLegs（图表定价基准的过滤版），不是activeLegs
    // （实时编辑腿位）——否则"解释当前情况"引用的腿位跟result/
    // positionHealth/analysisAttribution用的不是同一份数据，文字和图形
    // 对不上。
    return explainAnalysisScenario({
      legs: activeAnalyticsLegs,
      spot: analyticsSpot,
      shifts: analyticsShifts,
      result,
      health: positionHealth,
      attribution: analysisAttribution,
      breakevens,
      lang,
      t,
    });
  }, [
    isCompareMode, activeTrackedLegs, trackedGreeks, activeLegs, activeAnalyticsLegs, spot, analyticsSpot, effectiveTrackedSpot, effectiveDaysElapsed,
    t, lang, analyticsShifts, result, positionHealth, analysisAttribution, breakevens,
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
    setSymbol, setLegs, setSpot, setShifts, setOpeningAt, setOpeningAtSimOverride,
    setExpiredStrategyPrompt, setExpiredConfirmed, setExpiredTrackPrompt, setCorrectedSpot, setCorrecting,
    isCompareMode, trackedLegs, trackedSpot, trackedDirty, effectiveTrackedSpot,
    setTrackedLegs, setTrackedSpot, setTrackedDaysElapsed, setTrackedDirty, setActiveSnapshotId, setConfirmSaveTrackedOpen,
    savedStrategies, trackingStrategyId, trackedStrategy,
    setSavedStrategies, setTrackingStrategyId, setStrategyBaseline, setSaveStrategyOpen, setManageStrategyOpen,
    setConfirmClearOpen, setConfirmSwitchOpen,
    legBaseSpot, legBaseSymbol, spotManuallySet,
    pendingPreset, pendingPresetReplace, pendingLeaveAfterSave, pendingSaveTrackedAfterStrategy, pendingSwitchSource,
    clearLegSelection, onBackHome, onAddToSimAccount, addCustomPresetToLibrary, quote, t,
  });

  // 2026-09-12: wraps handleSaveTracked ONLY for TrackedComboSection's own
  // "保存追踪快照" button (below) — the hook's other internal callers
  // (save-then-clear/switch-mode/switch-preset/symbol-change) keep calling
  // handleSaveTracked directly, unwrapped, so they're unaffected. See
  // confirmLockRollOpen's comment above for why the warning lives here
  // instead of inside handleSaveTracked itself, and types.ts's
  // `derivedFrom.locked` for what's actually being warned about.
  const hasUnlockedRollForSave = trackedLegs?.some((l) => l.derivedFrom && !l.derivedFrom.locked) ?? false;
  const handleSaveTrackedClick = () => {
    if (hasUnlockedRollForSave) {
      setConfirmLockRollOpen(true);
      return;
    }
    void handleSaveTracked();
  };


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
          disabled={isExploring}
          title={t("leg.switchToCompareHint")}
          className="flex shrink-0 items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] font-semibold text-sky-400 transition hover:border-sky-500/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <GitCompare size={11} />
          {t("leg.switchToCompare")}
        </button>
      )}
      {!simOrigin && isCompareMode && (
        <DropdownMenu label={t("leg.switchToAnalysis")} icon={<GitCompare size={11} />} menuClassName="w-64" disabled={isExploring}>
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
        disabled={legs.length >= 10 || isExploring}
        title={t("leg.addLeg")}
        className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={12} />
      </button>
      <button
        onClick={() => legs.length > 0 && setConfirmClearOpen(true)}
        disabled={legs.length === 0 || isExploring}
        title={t("leg.clearAll")}
        className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-slate-400 transition hover:border-rose-500 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 size={12} />
      </button>
      <DropdownMenu label={t("toolbar.presetLabel")} icon={<Layers size={11} />} disabled={isExploring}>
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
          disabled={activeLegs.length === 0 || spot <= 0 || addingToSim || isExploring}
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
        epsEstimate={epsEstimate}
        epsLoading={epsLoading}
        onOpenHelp={() => setHelpOpen(true)}
        locked={isExploring}
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
                      disabled={isExploring}
                      className="w-20 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] tabular-nums text-emerald-400 outline-none transition focus:border-emerald-500 focus:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
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
                      lang={lang === "en" ? "en" : "zh-CN"}
                      value={formatDateInput(openingAt)}
                      onChange={(e) => {
                        const next = parseDateInput(e.target.value);
                        if (next !== null) setOpeningAt(next);
                      }}
                      disabled={isExploring}
                      className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] tabular-nums text-slate-300 outline-none transition focus:border-sky-500 focus:text-sky-200 [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-40"
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
            openingAtSimOverride={openingAtSimOverride}
            onSetOpeningAtSimOverride={setOpeningAtSimOverride}
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
            canUnifyLegs={canUnifyLegs}
            onUnifyQty={unifyQty}
            onUnifyStrike={unifyStrike}
            onUnifyDte={unifyDte}
            scenarioPriceById={scenarioPriceById}
            symbol={symbol}
            onChangeLeg={updateLeg}
            onToggleLeg={toggleLeg}
            onDeleteLeg={deleteLeg}
            onAddToPreset={() => { setPresetSaveSource("legs"); setSaveDialogOpen(true); }}
            onRoll={handleRoll}
            onHedge={handleHedge}
            onProtect={handleProtect}
            onCompare={handleCompare}
            onMoveLeg={moveLeg}
            onToggleLegSelection={toggleLegSelection}
            simOrigin={simOrigin}
            onConfirmSimOpen={onConfirmSimOpen}
            locked={isExploring}
            contractsExpired={isExpiredReal}
          />
          {/* ── Today's combo section (compare mode only) ── */}
          {isCompareMode && trackedLegs && (
            <TrackedComboSection
              contractsExpired={isExpiredReal}
              trackedLegs={trackedLegs}
              trackedStrategy={trackedStrategy}
              activeSnapshotId={activeSnapshotId}
              onSelectSnapshot={handleSelectSnapshot}
              onDeleteSnapshot={handleDeleteSnapshot}
              onSaveTracked={handleSaveTrackedClick}
              trackedDirty={trackedDirty}
              trackedResult={trackedResult}
              realizedPnl={realizedTrackedPnl}
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
              // 2026-09-12: was `() => {}` for all three — see
              // TrackedComboSection.tsx's prop comments and
              // useLegEditing.ts's toggleTrackedLeg/closeTrackedLeg. A
              // rolled/protected/hedged tracked leg (or the leg it came
              // from) looking permanently frozen was never a bug in
              // handleRoll/handleHedge/handleProtect below — it was that
              // this row's menu had nothing real to call.
              onToggleTrackedLeg={toggleTrackedLeg}
              onCloseTrackedLeg={closeTrackedLeg}
              onAddTrackedLegToPreset={() => { setPresetSaveSource("tracked"); setSaveDialogOpen(true); }}
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
                spot={analyticsSpot}
                shifts={analyticsShifts}
                symbol={symbol}
                positionHealth={positionHealth}
                modeSwitchButton={modeSwitchButton}
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
                expired={isExpiredOpening}
                openingAt={openingAt}
              />
            </ErrorBoundary>
          </div>

          {/* Sliders */}
          <div className="shrink-0 border-t border-slate-800 px-3 py-1.5">
            <ShiftSliders
              shifts={shifts}
              spot={spot}
              maxDte={sliderMaxDte}
              // "今天"参考点现在是"离day0(开仓)过了几天"，不再是0——day0
              // 本身才是0（滑块地板）。
              todayDte={!isCompareMode && openingSimBasis && !isExpiredOpening ? openingSimBasis.daysSinceOpen : undefined}
              onChange={(patch) => setShifts((s) => ({ ...s, ...patch }))}
              // 重置永远回到静止点(0,0,0)——day0本身就在dT=0，不再需要换算。
              onReset={() => setShifts({ dS: 0, dT: 0, dV: 0 })}
              onJumpToday={() => setShifts((s) => ({ ...s, dT: openingSimBasis?.daysSinceOpen ?? 0 }))}
              trackedSpot={isCompareMode ? effectiveTrackedSpot : undefined}
              trackedDays={isCompareMode ? effectiveDaysElapsed : undefined}
              trackedVolShift={trackedVolShift}
              // 2026-09-17新增：分析模式下，加载策略组合之前（手动添加或从预
              // 设选都一样）只要腿位列表是空的，滑块也要锁住——没有腿位就没
              // 什么好模拟的。用activeLegs（跟上面第797行"添加到模拟账户"按
              // 钮禁用条件同一个变量）而不是legs，保持"空组合"判断口径统一。
              // frozen单独传isCompareMode——避免没有腿位时标题被误显示成对
              // 比模式的"情景偏移对比"。
              disabled={isCompareMode || activeLegs.length === 0}
              frozen={isCompareMode}
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

      {confirmLockRollOpen && (
        <ConfirmLockRollDialog
          onCancel={() => setConfirmLockRollOpen(false)}
          onConfirm={async () => {
            setConfirmLockRollOpen(false);
            await handleSaveTracked();
          }}
        />
      )}

      {expiredStrategyPrompt && (
        <ExpiredStrategyDialog
          filename={expiredStrategyPrompt.filename}
          onKeep={() => setExpiredStrategyPrompt(null)}
          onDelete={async () => {
            const id = expiredStrategyPrompt.id;
            setExpiredStrategyPrompt(null);
            await handleDeleteStrategy(id);
            doClearAll();
          }}
        />
      )}

      {expiredTrackPrompt && (
        <ExpiredTrackPromptDialog
          filename={expiredTrackPrompt.filename}
          onConfirm={async () => {
            // handleTrack发现过期时直接return，没有改动任何界面状态（没
            // 有进对比模式、当前分析模式的编辑区原样保留），所以这里不需
            // 要像上面ExpiredStrategyDialog的onDelete那样再调doClearAll
            // 清场——只删这条库里的记录，关掉提示框即可。
            const id = expiredTrackPrompt.id;
            setExpiredTrackPrompt(null);
            await handleDeleteStrategy(id);
          }}
        />
      )}

      <LegActionDialogs
        saveDialogOpen={saveDialogOpen}
        onCloseSaveDialog={() => setSaveDialogOpen(false)}
        onSaveCustomPreset={handleAddCustom}
        activeLegs={presetSaveSource === "tracked" ? (activeTrackedLegs ?? []) : activeLegs}
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
        // Only a TRACKED roll ever needs a P&L to book (see types.ts's
        // `closedPnl` and handleRollConfirm's own comment) — read the
        // source leg's live P&L right here, the instant before confirming,
        // from `trackedLegPnlById` (already computed for the leg list).
        // The opening combo ("legs") has no realized-P&L concept, so its
        // branch inside handleRollConfirm never uses this value.
        onConfirmRoll={(newLeg) =>
          handleRollConfirm(newLeg, rollTargetSource === "tracked" && rollTarget ? trackedLegPnlById.get(rollTarget.id) : undefined)
        }
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