// src/App.tsx
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Plus, Layers, Settings2, RefreshCw, Trash2, Wallet, GitCompare, History } from "lucide-react";
import type { Leg, Shifts } from "@/lib/types";
import PnlAttributionPanel from "@/components/PnlAttributionPanel";
import PopBreakevenBadge from "@/components/PopBreakevenBadge";
import { matchStrategy } from "@/lib/matchStrategy";
import LegListSection from "@/components/LegListSection";
import ShiftSliders from "@/components/ShiftSliders";
import PayoffChart from "@/components/PayoffChart";
import { useStockQuote } from "@/lib/useStockQuote";
import { useEpsEstimate } from "@/hooks/useEpsEstimate";
import { loadRecentSymbols, addRecentSymbol } from "@/lib/recentSymbols";
import { serializeStrategyState, serializeTrackedLegs, computeOpeningSimBasis, saveStrategy, overwriteStrategy, STORAGE_FAIL_EVENT, type SavedStrategy, type OpeningSimBasis } from "@/lib/savedStrategies";
import DropdownMenu from "@/components/DropdownMenu";
import { useAutoSync } from "@/hooks/useAutoSync";
import { useCustomPresets } from "@/hooks/useCustomPresets";
import { useSavedStrategies } from "@/hooks/useSavedStrategies";
import { useLegEditing } from "@/hooks/useLegEditing";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLegBatchOps } from "@/hooks/useLegBatchOps";
import { useComboAnalytics } from "@/hooks/useComboAnalytics";
import { useCompareSlots, COMPARE_SLOT_COLORS, MAX_COMPARE_SLOT_LEGS, MAX_COMPARE_SLOTS, isSlotDirty } from "@/hooks/useCompareSlots";
import ComboCompareSlots from "@/components/ComboCompareSlots";
import PositionAdviceCard from "@/components/PositionAdviceCard";
import { scenarioLegs, prepareQuickAdvice } from "@/lib/positionAdvisor";
import { useMarketIv, useLegSpreads } from "@/lib/atmIv";
import { useEarningsContext } from "@/lib/earnings";
import { useStrategyOrchestration } from "@/hooks/useStrategyOrchestration";
import { nearestFridayDte, formatDateInput, parseDateInput, addCalendarDays, calendarDaysBetween, calendarDaysSince } from "@/lib/dateUtils";
import { uid, PRESET_DTE_SET } from "@/lib/legFactory";
import { getOptionChain, resolveFromCache, refreshContractPremiums, mergeFreshPremiums } from "@/lib/optionChain";
import { estimateRescaledPremium, premiumSanityIssues, type PremiumIssue, weightedAvgIV } from "@/lib/pricing";
import { NUMBER_RULES, clampToRule, blockInvalidNumberKey } from "@/lib/numberInput";
import { useI18n } from "@/i18n/I18nContext";
import AppHeader from "@/components/AppHeader";
import LockedOverlay, { type LockReason } from "@/components/LockedOverlay";
import StepBadge from "@/components/StepBadge";
import PnlHeadline from "@/components/PnlHeadline";
import StockOptionMap from "@/components/StockOptionMap";
import RetroSim from "@/components/RetroSim";
import FutureSim from "@/components/FutureSim";
import { useSimSettings } from "@/lib/simSettings";
import { openingBasis, isCreditCombo, prepareSim } from "@/lib/winRateSim";
import { replayRules } from "@/lib/futureSim";
import { buildTrackedHistory, buildAttributionTimeline, trackedTotalPnl, type TrackedState } from "@/lib/stockOptionMap";
import { STEP_GUIDE_ENABLED } from "@/lib/featureFlags";
import LegPanelTitleRow from "@/components/LegPanelTitleRow";
import TrackedComboSection from "@/components/TrackedComboSection";
import LegActionDialogs from "@/components/LegActionDialogs";
import StrategyPersistenceDialogs from "@/components/StrategyPersistenceDialogs";
import { ConfirmLockRollDialog, ConfirmPremiumCheckDialog, HelpPanel, isGuideDismissed, ExpiredStrategyDialog, ExpiredTrackPromptDialog, ConfirmReplacePresetDialog, ConfirmSnapshotDialog } from "@/components/dialogs";
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
  // 手机布局开关。不依赖其它state，放在最前面，避免TDZ。
  const isMobile = useIsMobile();
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
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [showImpliedInfo, setShowImpliedInfo] = useState(false);
  // 今日组合的权利金和股价是哪个时刻的（快照保存时间/开仓时间）；null=实时，股价跟随实时报价。
  // ⚠️ 两者必须是同一时刻的，反推出来的隐含波动率才对：权利金是旧的，股价就用当时存的股价。
  const [trackedAsOf, setTrackedAsOf] = useState<number | null>(null);
  const trackedAsOfRef = useRef<number | null>(null);
  trackedAsOfRef.current = trackedAsOf;
  const [trackedPriceError, setTrackedPriceError] = useState<string | null>(null);
  const trackedAsOfDays = trackedAsOf === null ? 0 : calendarDaysSince(trackedAsOf);
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
  // trackedDirty由指纹比较派生：trackedBaseline是上次保存/加载时trackedLegs的指纹。
  // 故意不比较trackedSpot，否则股价自然波动也会被当成改动。
  const [trackedBaseline, setTrackedBaseline] = useState<string | null>(null);
  const trackedDirty = trackedLegs !== null && serializeTrackedLegs(trackedLegs) !== trackedBaseline;
  const [confirmSaveTrackedOpen, setConfirmSaveTrackedOpen] = useState(false);
  // 多方案对比（方案B/C）的state，分析模式才显示。
  // ⚠️ 必须声明在rescaleForNewSymbol之前（它用到clearCompareSlots），否则TDZ。
  const {
    compareSlots,
    addCompareSlot,
    removeCompareSlot,
    addCompareSlotLeg,
    updateCompareSlotLeg,
    deleteCompareSlotLeg,
    toggleCompareSlotLeg,
    applyPresetToSlot,
    applyStrategyToSlot,
    setCompareSlotLegs,
    clearCompareSlots,
    markSlotSaved,
  } = useCompareSlots();
  // 当前激活的combo：0=A(legs)，1/2=compareSlots[0]/[1]。点容器切换；
  // 预设、+、清空、保存、打开策略、加入模拟账户都作用于激活的combo。
  const [activeComboIndex, setActiveComboIndex] = useState(0);
  // 退出分析模式、清空对比槽位、或某个被激活的槽位被删除时，把激活对象
  // 收回主combo——避免留着一个指向不存在槽位的激活状态。
  useEffect(() => {
    if (activeComboIndex > compareSlots.length) setActiveComboIndex(0);
  }, [activeComboIndex, compareSlots.length]);
  // 新建B/C后直接激活它。到达上限时addCompareSlot不生效，所以先判上限。
  const handleAddCompareSlotAndActivate = () => {
    if (compareSlots.length >= MAX_COMPARE_SLOTS) return;
    const newIndex = compareSlots.length + 1;
    addCompareSlot();
    setActiveComboIndex(newIndex);
  };
  // ⚠️ 这里故意用trackedLegs!==null而不是下面才声明的isCompareMode（来自
  // useComboAnalytics()的返回值，声明在这个state之后）——引用晚声明的变
  // 量会触发App.tsx这个文件已知的TDZ风险（CLAUDE.md"五、5"），语义上跟
  // isCompareModeNow（同样出于这个原因手写的等价判断）一致。
  useEffect(() => {
    if (trackedLegs !== null || simOrigin) setActiveComboIndex(0);
  }, [trackedLegs, simOrigin]);
  // B/C的批量操作复用useLegBatchOps，固定调用两次（hooks不能在循环里调用）；B/C批量删除不弹确认。
  const compareSlotB = compareSlots[0];
  const compareSlotC = compareSlots[1];
  const batchOpsB = useLegBatchOps(
    compareSlotB?.legs ?? [],
    (action) => { if (compareSlotB) setCompareSlotLegs(compareSlotB.id, action); },
    { confirmBeforeBulkDelete: false },
  );
  const batchOpsC = useLegBatchOps(
    compareSlotC?.legs ?? [],
    (action) => { if (compareSlotC) setCompareSlotLegs(compareSlotC.id, action); },
    { confirmBeforeBulkDelete: false },
  );
  // 保存追踪快照会永久锁定未完成的展期/保护/对冲（之后无法撤销），所以只在这个按钮上先确认一次；
  // 其它内部调用handleSaveTracked的流程已经有各自的确认框，不能再套一层。
  const [confirmLockRollOpen, setConfirmLockRollOpen] = useState(false);
  // 保存追踪快照前的权利金合理性检查（见premiumSanityIssues）；非null时弹确认框。
  const [premiumIssues, setPremiumIssues] = useState<PremiumIssue[] | null>(null);
  const [openingAt, setOpeningAt] = useState<number>(() => Date.now());
  // 对比模式开仓日期的临时预览值，只影响该字段显示，不写回openingAt；null=用真实开仓日期。
  const [openingAtSimOverride, setOpeningAtSimOverride] = useState<number | null>(null);
  // 打开一条"真实经过天数已经超过它第0天完整周期"的策略时弹出的"已过期，
  // 删除还是保留"确认框——非null即弹出，值是那条过期的策略本身。
  const [expiredStrategyPrompt, setExpiredStrategyPrompt] = useState<SavedStrategy | null>(null);
  // 加载那一刻用未被钳过的原始dte算好的"已过期"结论，只在重新加载/清空时重置。
  // ⚠️ 不能每次从live legs重算：dte被Math.max(0,…)钳到0后过期天数丢失，结论会变回false。
  const [expiredConfirmed, setExpiredConfirmed] = useState(false);
  // 对比模式跟踪一条已过期策略时的提示（只有"确定"，点了删除该策略）；分析模式的expiredStrategyPrompt可以选保留。
  const [expiredTrackPrompt, setExpiredTrackPrompt] = useState<SavedStrategy | null>(null);
  // 滑块离开原点(0,0,0)时锁定左侧所有编辑，直到点"重置"（xue的产品要求）。对比模式滑块本来就冻结。
  // 用trackedLegs!==null而不是isCompareModeNow，因为下面的报价effect比它声明得早。
  const isExploring = trackedLegs === null && (shifts.dS !== 0 || shifts.dT !== 0 || shifts.dV !== 0);
  // 返回值不用：保持编辑期间后台自动同步到已链接的备份文件。
  // HomePage有自己的实例；文件句柄是模块级单例，两个页面不会同时挂载。
  useAutoSync({ savedStrategies, customPresets, recentSymbols });
  const { t, lang } = useI18n();

  const [helpOpen, setHelpOpen] = useState(false);
  // 各模块首次进入引导。初始state直接读isGuideDismissed，避免已永久关闭的引导闪一下。
  // 对比模式引导每次挂载只出现一次（compareGuideShown）。
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
  } = useLegEditing({ legs, setLegs, trackedLegs, setTrackedLegs });
  // 最近一次打开共享SavePresetDialog的是哪个组合（开仓组合legs或今日组合trackedLegs）。
  const [presetSaveSource, setPresetSaveSource] = useState<"legs" | "tracked">("legs");
  const pendingPresetAction = useRef<{ name: string; rawLegs: Leg[] } | null>(null);
  const [confirmPresetOpen, setConfirmPresetOpen] = useState(false);
  const pendingPresetReplace = useRef<Leg[] | null>(null);
  // 策略库里打开/跟踪一条策略会替换当前组合：当前组合有未保存改动时先问（跟选预设同一个确认框）。
  // strategy=分析模式（先保存策略组合），snapshot=对比模式（先存追踪快照）。
  const pendingLibraryAction = useRef<(() => void) | null>(null);
  const [confirmLibrary, setConfirmLibrary] = useState<"strategy" | "snapshot" | null>(null);
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
  // 标记这次confirmSaveTrackedOpen来自requestLeave（答完走onBackHome，而不是doClearAll）。
  const pendingTrackedLeaveHome = useRef(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  // 退出时待逐一确认保存的combo队列（0=A，1/2=B/C），空了才真正onBackHome。
  const [leaveQueue, setLeaveQueue] = useState<number[]>([]);
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

  // 换标的时按新旧现价比例重算行权价，优先用期权链缓存里的真实行权价/权利金；
  // 没有时用该腿自己的隐含波动率估一个临时权利金（置0会让情景估值看起来卡住），之后由自动拉价覆盖。
  // 开仓组合和今日组合都要重算。
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
    }
    setSpot(newSpot);
    legBaseSpot.current = newSpot;
    legBaseSymbol.current = newSymbol;
    spotManuallySet.current = false;
    // 换标的后旧行权价没有意义了（跟主combo/今日组合一样），对比槽位
    // （方案B/C）直接清空，而不是尝试按比例重映射——那套重映射逻辑是为
    // 已经过审的、有真实持仓语义的legs设计的，对比槽位只是临时候选方
    // 案，换标的时清空重来更简单也更不容易踩坑。
    clearCompareSlots();
  }, [clearCompareSlots]);


  const { quote, loading: quoteLoading, error: quoteError, refetch } = useStockQuote(symbol);
  // 使用顺序第一步：分析模式下必须先有有效股票代码（有现价），左栏其余输入、预设策略、情景滑块才可用。
  // 代码无效（报价失败）也算没有——否则左边会留着上一个代码的组合、却显示新代码。策略库例外（见LockedOverlay）。
  const symbolInvalid = !!quoteError && symbol.trim() !== "";
  const needSymbol = trackedLegs === null && (symbol.trim() === "" || spot <= 0 || symbolInvalid);
  const leftLockReason: LockReason | null = isExploring ? "explore" : needSymbol ? (symbolInvalid ? "symbolInvalid" : "symbol") : null;
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
    // 滑块锁定期间也要拦住后台改写spot/legs的路径（换标的、实时报价），光禁用输入框挡不住。
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
        // 只有权利金是"现在的"时，股价才跟随实时报价；看的是某天的快照时，股价保持当天存的那个。
        if (trackedAsOfRef.current === null) setTrackedSpot(quote.price);
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

  // 实时市价：盈亏图里可选的"实时价参考线"。参与计算的是trackedSpot（跟权利金同一时刻的股价，见trackedAsOf）。
  const liveTrackedSpot = quote && quote.price > 0 ? quote.price : null;

  // ⚠️ trackedGreeks必须从这里取：trackedResult.perLeg的Greek字段是占位的0，只有total是真的。
  // isCompareModeNow用trackedLegs!==null直接算，避免循环依赖。
  const isCompareModeNow = trackedLegs !== null;
  // day0锚定真实开仓日期，每次用live legs/spot/openingAt重算，编辑后情景估值立即跟上；legs为空时为null。
  const openingSimBasis = useMemo<OpeningSimBasis | null>(() => {
    if (legs.length === 0) return null;
    return computeOpeningSimBasis(openingAt, Date.now(), legs, spot);
  }, [openingAt, legs, spot]);
  // 分析模式是纯模拟：以开仓那天为基准，dT=0就是开仓日，今天只是数轴上的一个点。
  // ⚠️ analyticsLegs/analyticsSpot/analyticsShifts只喂给图表/归因的计算，不能替换hook的legs/spot/shifts主参数——
  // 那些驱动腿位编辑区、保存按钮、策略名称等实时状态。
  const analyticsLegs = !isCompareModeNow && openingSimBasis ? openingSimBasis.legs : legs;
  const analyticsSpot = !isCompareModeNow && openingSimBasis ? openingSimBasis.spot : spot;
  // 右侧图表标签：盈亏图 / 股价 vs 期权价（地形图）/ 万次推演，推演未来时三个标签共用三个情景滑块。
  // 地形图上鼠标指向（或钉住）的点临时代替股价/时间滑块，只喂给图表头部盈亏/归因/持仓建议这些显示（波动率仍按滑块）；
  // 不写进shifts——保存策略时存的是真实shifts，绝不能用mapPoint。滑块一动，地形图会清掉这个点（见StockOptionMap的scenario）。
  const [chartView, setChartView] = useState<"payoff" | "stockVsOption" | "winRate">("payoff");
  const [mapPoint, setMapPoint] = useState<{ day: number; price: number } | null>(null);
  const mapActive = chartView === "stockVsOption" && !isCompareModeNow && !isMobile;
  const analyticsShifts: Shifts = useMemo(
    () => (mapActive && mapPoint ? { dS: mapPoint.price - analyticsSpot, dT: mapPoint.day, dV: shifts.dV } : shifts),
    [mapActive, mapPoint, analyticsSpot, shifts],
  );
  // 滑块上界=开仓到到期的完整周期（两种模式都是）。⚠️ 对比模式下legs的dte是从今天算的剩余天数，不能用来当上界。
  const sliderMaxDte = openingSimBasis
    ? openingSimBasis.originalMaxDte
    : legs.length > 0
      ? Math.max(...legs.filter((l) => l.kind !== "stock").map((l) => l.dte))
      : 30;
  // 过期后滑块仍可用（只是没有"今天"这个点）。⚠️ 过期判断读expiredConfirmed，不能从openingSimBasis实时反推（见其声明处）。
  // isExpiredReal两种模式通用（过期合约不再请求市场价）；isExpiredOpening只在分析模式为true（图表变暗+提示条）。
  const isExpiredReal = expiredConfirmed;
  const isExpiredOpening = !isCompareModeNow && isExpiredReal;

  const {
    activeLegs,
    activeTrackedLegs,
    isCompareMode,
    result,
    scenarioPriceById,
    effectiveTrackedSpot,
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
  } = useComboAnalytics({ legs, analyticsLegs, analyticsSpot, analyticsShifts, trackedLegs, trackedSpot, trackedAsOfDays, trackedDaysElapsed, spot, shifts, trackingStrategyId, savedStrategies, openingLegs: openingSimBasis?.legs, t });

  // 权利金变成"现在的"（改了权利金/刷新成功）时，股价立刻换成实时报价。
  useEffect(() => {
    if (trackedAsOf === null && trackedLegsRef.current !== null && quote && quote.price > 0) setTrackedSpot(quote.price);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedAsOf]);

  // 进入跟踪/选中最新快照时，如果它不是今天的，按原合约自动拉今天的权利金、配实时股价（算作未保存的改动）。
  // 更早的历史快照不刷新，按当天的样子看。拉不到就提示，权利金和股价保持当天那一对。
  // 策略库写不进浏览器存储（存满了）：提示一次，别让用户以为存上了。
  useEffect(() => {
    let last = 0;
    const onFail = () => {
      if (Date.now() - last < 10000) return;
      last = Date.now();
      window.alert(t("storage.writeFailed"));
    };
    window.addEventListener(STORAGE_FAIL_EVENT, onFail);
    return () => window.removeEventListener(STORAGE_FAIL_EVENT, onFail);
  }, [t]);
  const quoteRef = useRef(quote);
  quoteRef.current = quote;
  const quoteReady = !!quote && quote.price > 0;
  const autoRefreshKey = useRef<string | null>(null);
  useEffect(() => {
    setTrackedPriceError(null);
    if (!isCompareMode || trackedAsOf === null || calendarDaysSince(trackedAsOf) <= 0) return;
    const snaps = trackedStrategy?.trackedSnapshots ?? [];
    const latestId = snaps.length > 0 ? snaps[snaps.length - 1].id : null;
    if (activeSnapshotId !== latestId) return;
    // 等这只股票的实时报价到了再刷（刚换代码时报价还没回来）。
    if (!quoteReady) return;
    const key = `${trackingStrategyId}|${activeSnapshotId}|${trackedAsOf}`;
    const legsNow = trackedLegsRef.current;
    if (!legsNow || autoRefreshKey.current === key) return;
    autoRefreshKey.current = key;
    let cancelled = false;
    void refreshContractPremiums(symbol, legsNow).then((fresh) => {
      if (cancelled) return;
      const live = quoteRef.current?.price ?? 0;
      const cur = trackedLegsRef.current;
      if (fresh && live > 0 && cur) {
        // 刷新期间可能已经展期/平仓/改了价：只更新没动过的腿。
        const merged = mergeFreshPremiums(cur, legsNow, fresh);
        setTrackedLegs(merged);
        // 手机上今昔对比只能看、不能存快照，刷新后不算未保存改动，免得每次离开都问。
        if (isMobile) setTrackedBaseline(serializeTrackedLegs(merged));
        setTrackedSpot(live);
        setTrackedAsOf(null);
      } else {
        setTrackedPriceError(t("tracked.autoRefreshFailed", { date: formatDateInput(trackedAsOf) }));
      }
    });
    return () => {
      cancelled = true;
      autoRefreshKey.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompareMode, trackedAsOf, activeSnapshotId, trackingStrategyId, trackedStrategy, quoteReady]);

  // 图表用的B/C曲线（需要t，所以放在这里）。
  const compareCurves = useMemo(
    () => compareSlots.map((s, i) => ({
      id: s.id,
      label: i === 0 ? t("compare.slotB") : t("compare.slotC"),
      color: COMPARE_SLOT_COLORS[i],
      legs: s.legs.filter((l) => !l.disabled),
    })),
    [compareSlots, t],
  );

  useEffect(() => {
    if (isCompareMode && !compareGuideShown.current) {
      compareGuideShown.current = true;
      if (!isGuideDismissed("compare")) setShowCompareGuide(true);
    }
  }, [isCompareMode]);

  const strategyName = useMemo(() => matchStrategy(activeLegs, spot, customPresets), [activeLegs, spot, customPresets]);
  const canSaveStrategy = activeLegs.length > 0 && serializeStrategyState(symbol, legs, shifts, openingAt) !== strategyBaseline;
  // 对比模式下"有没保存的东西"：今日组合改过、开仓组合改过（修正开仓时输错的数）、或者这个组合还没存成策略。
  const openingDirty = isCompareMode && !!trackingStrategyId && serializeStrategyState(symbol, legs, shifts, openingAt) !== strategyBaseline;
  const compareUnsaved = isCompareMode && (trackedDirty || openingDirty || (!trackingStrategyId && legs.length > 0));
  const pendingAfterTrackedSave = useRef<{ then?: () => void; onAbort?: () => void } | null>(null);
  // 确认完要不要保存之后真正要做的事（回首页 / 加入模拟账户）。
  const leaveActionRef = useRef<() => void>(() => {});
  const finishLeave = () => {
    const a = leaveActionRef.current;
    leaveActionRef.current = () => {};
    a();
  };

  // 退出前的保存确认：对比模式看compareUnsaved；分析模式把有改动的A/B/C（0=A，1/2=B/C）排成队列逐一提示，全都没改直接走。
  // action=确认完要做的事，默认回首页。
  const requestLeave = (action?: () => void) => {
    leaveActionRef.current = action ?? (() => onBackHome?.());
    if (isCompareMode) {
      if (compareUnsaved) {
        pendingTrackedLeaveHome.current = true;
        setConfirmSaveTrackedOpen(true);
      } else {
        finishLeave();
      }
      return;
    }
    const dirty: number[] = [];
    if (canSaveStrategy) dirty.push(0);
    compareSlots.forEach((s, i) => { if (isSlotDirty(s)) dirty.push(i + 1); });
    if (dirty.length === 0) { finishLeave(); return; }
    setLeaveQueue(dirty);
    setConfirmLeaveOpen(true);
  };
  // 队首那个combo处理完（跳过或保存成功）后调用：还有剩的就问下一个，队列空了才真的走。
  const advanceLeaveQueue = () => {
    const rest = leaveQueue.slice(1);
    setLeaveQueue(rest);
    if (rest.length === 0) finishLeave();
    else setConfirmLeaveOpen(true);
  };

  // 组合修改+策略保存/模式切换相关逻辑在useStrategyOrchestration.ts（全项目bug最多的一块，改动要小心）。
  const {
    handleAddCustom,
    addingToSim,
    handleAddToSimAccount,
    addLeg,
    clearAllLegs,
    applyPreset,
    doClearAll,
    updateTrackedLeg,
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
    setExpiredStrategyPrompt, setExpiredConfirmed, setExpiredTrackPrompt, setTrackedAsOf, trackedAsOf, setTrackedPriceError,
    isCompareMode, trackedLegs, trackedSpot, trackedDirty, compareUnsaved, openingDirty, trackedLegsRef, pendingAfterTrackedSave, effectiveTrackedSpot,
    setTrackedLegs, setTrackedSpot, setTrackedDaysElapsed, setTrackedBaseline, setActiveSnapshotId, setConfirmSaveTrackedOpen,
    savedStrategies, trackingStrategyId, trackedStrategy,
    setSavedStrategies, setTrackingStrategyId, setStrategyBaseline, setSaveStrategyOpen, setManageStrategyOpen,
    setConfirmClearOpen, setConfirmSwitchOpen,
    legBaseSpot, legBaseSymbol, spotManuallySet,
    pendingPreset, pendingPresetReplace, pendingLeaveAfterSave, pendingSaveTrackedAfterStrategy, pendingSwitchSource,
    clearLegSelection, onBackHome, onAddToSimAccount, addCustomPresetToLibrary, quote, t,
  });

  // 工具栏的"+"和清空按当前激活的combo分流：B/C时直接改该槽位（不弹确认），A时走原逻辑。
  // 必须写在useStrategyOrchestration()调用之后（addLeg/clearAllLegs在那里才有）。
  const activeSlot = activeComboIndex > 0 ? compareSlots[activeComboIndex - 1] : undefined;
  const activeToolbarLegsCount = activeSlot ? activeSlot.legs.length : legs.length;
  const activeToolbarLegCap = activeSlot ? MAX_COMPARE_SLOT_LEGS : 10;
  const handleToolbarAddLeg = () => {
    if (activeSlot) { addCompareSlotLeg(activeSlot.id); return; }
    addLeg();
  };
  const handleToolbarClear = () => {
    if (activeSlot) { setCompareSlotLegs(activeSlot.id, []); return; }
    if (legs.length > 0) setConfirmClearOpen(true);
  };
  // "加入模拟账户"同样按激活的combo分流：B/C时用该槽位的腿、全局spot/symbol、以今天为开仓日。
  // 加入模拟账户后会跳到模拟账户页：有没保存的组合先按退出流程问一遍。
  const handleToolbarAddToSim = () => {
    const slot = activeSlot;
    requestLeave(() => {
      if (slot) void handleAddToSimAccount({ legs: slot.legs, spot, symbol, openingAt: Date.now() });
      else void handleAddToSimAccount();
    });
  };

  // 保存B/C：直接写入同一个策略库。不复用handleSaveStrategy（它带着A专属的保存后联动）。
  // B/C没有真实开仓日期，openingAt用现在；shifts用零位移。
  const activeSlotDirection: "buy" | "sell" =
    activeSlot && activeSlot.legs.length > 0 && activeSlot.legs.every((l) => l.action === "buy") ? "buy" : "sell";
  const activeSlotStrategyName = activeSlot ? matchStrategy(activeSlot.legs, spot, customPresets) : "";
  // 引导第3、4步：本轮组合已保存（或打开的是已存策略）后隐藏；组合清空时复位。
  const [guideSaved, setGuideSaved] = useState(false);
  // 引导第5步（情景滑块）：滑块动过一次后隐藏；组合清空时复位。
  const [guideSlid, setGuideSlid] = useState(false);
  // 切到过"股价 vs 期权价"标签也算看过第5步（情景模拟），跟滑动滑块一样让第5步消失；组合清空时复位。
  const [guideMapSeen, setGuideMapSeen] = useState(false);
  useEffect(() => {
    if (legs.length === 0) {
      setGuideSaved(false);
      setGuideSlid(false);
      setGuideMapSeen(false);
    }
  }, [legs.length]);
  useEffect(() => {
    if (chartView !== "payoff") setGuideMapSeen(true);
  }, [chartView]);
  useEffect(() => {
    if (isExploring) setGuideSlid(true);
  }, [isExploring]);

  const runPendingLibrary = () => {
    const a = pendingLibraryAction.current;
    pendingLibraryAction.current = null;
    a?.();
  };
  // 有未保存改动就先关策略库、弹确认框；没有就直接执行。
  // replacesA：这个操作一定替换A（"跟踪"），不管现在激活的是哪个方案，都要看A有没有改动。
  const guardLibrary = (action: () => void, replacesA = false) => {
    const slot = activeComboIndex > 0 ? compareSlots[activeComboIndex - 1] : undefined;
    let kind: "strategy" | "snapshot" | null;
    if (isCompareMode) kind = compareUnsaved ? "snapshot" : null;
    else if (replacesA) {
      kind = canSaveStrategy ? "strategy" : null;
      // "先保存"要存的是A：把激活焦点切回A，保存对话框才读A。
      if (kind && activeComboIndex > 0) setActiveComboIndex(0);
    } else kind = slot ? (isSlotDirty(slot) ? "strategy" : null) : (canSaveStrategy ? "strategy" : null);
    if (!kind) {
      action();
      return;
    }
    pendingLibraryAction.current = action;
    setManageStrategyOpen(false);
    setConfirmLibrary(kind);
  };
  // 切换/删除快照会换掉今日组合：今日组合有没存的改动就先问。
  const guardSnapshot = (action: () => void) => {
    if (!trackedDirty) { action(); return; }
    pendingLibraryAction.current = action;
    setConfirmLibrary("snapshot");
  };
  const handleSaveStrategyForActive = async (filename: string) => {
    if (activeSlot) {
      const updated = await saveStrategy({ filename, symbol, spot, legs: activeSlot.legs, shifts: { dS: 0, dT: 0, dV: 0 }, openingAt: Date.now() });
      setSavedStrategies(updated);
      setSaveStrategyOpen(false);
      // 保存后刷新该槽位baseline；如果是退出流程里的"先保存"，推进确认队列。
      markSlotSaved(activeSlot.id);
      if (leaveQueue.length > 0) advanceLeaveQueue();
      runPendingLibrary();
      return;
    }
    await handleSaveStrategy(filename);
    setGuideSaved(true);
    if (leaveQueue.length > 0) advanceLeaveQueue();
    runPendingLibrary();
  };
  const handleOverwriteStrategyForActive = async (id: string, filename: string) => {
    if (activeSlot) {
      const updated = await overwriteStrategy(id, { filename, symbol, spot, legs: activeSlot.legs, shifts: { dS: 0, dT: 0, dV: 0 }, openingAt: Date.now() });
      setSavedStrategies(updated);
      setSaveStrategyOpen(false);
      markSlotSaved(activeSlot.id);
      if (leaveQueue.length > 0) advanceLeaveQueue();
      runPendingLibrary();
      return;
    }
    await handleOverwriteStrategy(id, filename);
    setGuideSaved(true);
    if (leaveQueue.length > 0) advanceLeaveQueue();
    runPendingLibrary();
  };

  // 只包装"保存追踪快照"按钮本身，原因见confirmLockRollOpen的注释。
  const hasUnlockedRollForSave = trackedLegs?.some((l) => l.derivedFrom && !l.derivedFrom.locked) ?? false;
  const proceedSaveTracked = () => {
    if (hasUnlockedRollForSave) {
      setConfirmLockRollOpen(true);
      return;
    }
    void handleSaveTracked();
  };
  // 检查用的股价跟快照里存的是同一个（saveTrackedSnapshotTo存trackedSpot ?? spot）。
  const handleSaveTrackedClick = () => {
    const checkLegs = trackedLegs && trackedAsOfDays > 0 ? trackedLegs.map((l) => (l.kind === "stock" ? l : { ...l, dte: l.dte + trackedAsOfDays })) : trackedLegs;
    const issues = checkLegs ? premiumSanityIssues(checkLegs, trackedSpot ?? spot, { legs: openingDayLegs, spot }) : [];
    if (issues.length > 0) {
      setPremiumIssues(issues);
      return;
    }
    proceedSaveTracked();
  };


  // 分析↔对比模式切换按钮，渲染在图表标签行最右端（电脑版；手机版不显示）。
  const modeSwitchButton = (
    <>
      {!simOrigin && !isCompareMode && legs.length > 0 && (
        <button
          onClick={handleSwitchToCompare}
          disabled={isExploring}
          title={t("leg.switchToCompareHint")}
          className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] font-semibold text-sky-400 transition hover:border-sky-500/50 disabled:cursor-not-allowed disabled:opacity-40"
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

  // 新用户引导步骤编号（每次都当新用户）：1（代码）、2（预设/+/策略库）在组合空着时显示；
  // 3（开仓价/日期）、4（保存）从组合空着开始显示，保存或打开已存策略后消失，
  // 组合再次清空时重新显示（手机上没有这两步）。总开关见featureFlags.ts。
  const showGuide12 = STEP_GUIDE_ENABLED && !isCompareMode && legs.length === 0;
  const showGuide34 = STEP_GUIDE_ENABLED && !isCompareMode && !isMobile && !guideSaved;
  const showGuide5 = STEP_GUIDE_ENABLED && !isCompareMode && !isMobile && legs.length > 0 && !guideSlid && !guideMapSeen;
  const showChartTabs = !isMobile;
  const showStockOptionMap = showChartTabs && chartView === "stockVsOption";
  const showWinRate = showChartTabs && chartView === "winRate";
  // 地形图用开仓基准的腿位（第0天=开仓日），跟图表头部盈亏/归因用的是同一份数据。
  const mapLegs = useMemo(() => analyticsLegs.filter((l) => !l.disabled), [analyticsLegs]);
  // 第1组「波动率口径统一」：推演未来时，地形图喇叭口、万次推演的"隐含"选项、持仓建议、波动率滑块小字都用同一个数——
  // 最近到期日平值期权的隐含波动率（lib/atmIv.ts）。只在开仓日是今天时用（期权链是今天的报价，开仓在过去时对不上），
  // 取不到就退回各腿隐含波动率平均。今昔对比不变：拿不到开仓那天的期权链，仍按各腿加权平均（跟trackedVolShift同一种平均法）。
  const marketIvInfo = useMarketIv({
    symbol,
    legs: mapLegs,
    spot: analyticsSpot,
    chainSpot: quote && quote.price > 0 ? quote.price : undefined,
    enabled: !isCompareMode && !!openingSimBasis && openingSimBasis.daysSinceOpen === 0,
  });
  const analysisIv = marketIvInfo.iv ?? 0;
  // 第4组：开仓日在过去时，地形图"从今天出发"用今天期权链的平值IV（腿位按今天的剩余天数找最近到期日）
  const todayMarket = useMarketIv({
    symbol,
    legs: activeLegs,
    spot: quote && quote.price > 0 ? quote.price : spot,
    chainSpot: quote && quote.price > 0 ? quote.price : undefined,
    enabled: !isCompareMode && !!openingSimBasis && openingSimBasis.daysSinceOpen > 0,
  });
  // 第3组：各腿半个买卖价差（成交损耗）和微笑斜率（下跌时IV上升），万次推演和持仓建议共用
  const legSpreads = useLegSpreads(symbol, mapLegs, !isCompareMode, openingSimBasis ? openingSimBasis.daysSinceOpen : 0);
  // 财报这一组：下一次财报日、市场押多少、过去几次的真实反应（持仓建议卡和万次推演用；两种模式都看今天的期权链和日期）
  const earnState = useEarningsContext({ symbol, spot: quote && quote.price > 0 ? quote.price : spot, openingAt, enabled: !needSymbol });
  // 地形图"风险分区"/走势节点用的快速版持仓建议（规则跟万次推演、持仓建议共用simSettings）。
  const { rules: simRulesBySide } = useSimSettings(symbol);
  const mapZoneCtx = useMemo(() => {
    const opts = mapLegs.filter((l) => l.kind !== "stock");
    const basis = openingBasis(mapLegs);
    if (basis == null || opts.length === 0 || opts.length !== mapLegs.length || !(analyticsSpot > 0)) return null;
    const credit = isCreditCombo(mapLegs);
    return prepareQuickAdvice({
      legs: mapLegs, spot: analyticsSpot, basis, credit, rules: simRulesBySide[credit ? "credit" : "debit"],
      totalTerm: Math.max(1, Math.round(Math.min(...opts.map((l) => l.dte)))), iv: analysisIv || undefined,
    });
  }, [mapLegs, analyticsSpot, simRulesBySide, analysisIv]);
  // 开仓那天的开仓组合（dte按开仓日算）。对比模式下legs/activeLegs的dte是按今天算的剩余天数，
  // 胜率模拟和持仓建议的"总期限"、回看都要用开仓那天的版本。
  const openingDayLegs = useMemo(
    () => (openingSimBasis ? openingSimBasis.legs.filter((l) => !l.disabled) : activeLegs),
    [openingSimBasis, activeLegs],
  );
  // 持仓建议卡片：推演未来时从情景点（滑块或地形图上指的点）出发，腿位换成那一刻的理论价。
  const adviceScenarioLegs = useMemo(
    () => (isCompareMode ? null : scenarioLegs(mapLegs, analyticsShifts, analyticsSpot)),
    [isCompareMode, mapLegs, analyticsShifts, analyticsSpot],
  );
  // 波动率滑块小字的基准：开仓时的平均隐含波动率（对比模式按开仓那天的腿位；跟trackedVolShift同一种平均法，加上变化量就是统计格的"当前"）。
  const sliderBaseIv = useMemo(
    () => (isCompareMode ? weightedAvgIV(openingDayLegs, spot) : analysisIv),
    [isCompareMode, openingDayLegs, spot, analysisIv],
  );

  // 今昔对比：真实走过的路（开仓点→各快照→今天），地形图和万次推演回看共用。
  const trackedHistory = useMemo(() => {
    if (!isCompareMode || !trackedResult) return null;
    const { points, markers } = buildTrackedHistory(trackedStrategy?.trackedSnapshots ?? [], legs, spot, openingAt);
    const todayDay = Math.max(0, effectiveDaysElapsed);
    const pnlNow = trackedResult.change + realizedTrackedPnl;
    const past = points.filter((p) => p.day <= todayDay);
    // 只有权利金是今天的才补"今天"这一点；看某天的快照时那一天已经在快照里，旧权利金不能当成今天的。
    const withToday = todayDay > 0 && trackedAsOfDays === 0 ? [...past.filter((p) => p.day < todayDay), { day: todayDay, price: effectiveTrackedSpot, pnl: pnlNow }] : past;
    return { todayDay, pnlNow, points: past, withToday, markers: markers.filter((m) => m.day <= todayDay) };
  }, [isCompareMode, trackedResult, trackedStrategy, legs, spot, openingAt, effectiveDaysElapsed, realizedTrackedPnl, trackedAsOfDays, effectiveTrackedSpot]);
  // 规则复盘：按你现在的止盈止损/平仓规则（跟万次推演、持仓建议同一份），沿真实的路第一次该下车的那一点。
  const ruleExit = useMemo(() => {
    if (!trackedHistory) return null;
    const basis = openingBasis(openingDayLegs);
    const opts = openingDayLegs.filter((l) => l.kind !== "stock");
    if (basis == null || opts.length === 0 || opts.length !== openingDayLegs.length || !(spot > 0)) return null;
    const credit = isCreditCombo(openingDayLegs);
    const p = prepareSim({
      legs: openingDayLegs, spot, basis, pnlOffset: 0, rules: simRulesBySide[credit ? "credit" : "debit"],
      totalTerm: Math.max(1, Math.round(Math.min(...opts.map((l) => l.dte)))),
    });
    return p ? replayRules(trackedHistory.withToday, p) : null;
  }, [trackedHistory, openingDayLegs, spot, simRulesBySide]);
  // 今昔对比：开仓点 → 每条快照 → 今天（今日组合+现价），逐段把盈亏变化拆成股价/时间/波动率/调整。
  // 地形图左半边的逐段柱和万次推演回看的"经历了什么"共用这一份。
  // 开仓点用开仓那天的腿位（dte按开仓日）；legs的dte是今天剩余天数，用它反推开仓隐含波动率会错。
  const trackedTimeline = useMemo(() => {
    if (!trackedHistory) return null;
    const { todayDay, pnlNow } = trackedHistory;
    const byDay = new Map<number, TrackedState>([[0, { legs: openingDayLegs, spot, day: 0, pnl: 0 }]]);
    for (const sn of [...(trackedStrategy?.trackedSnapshots ?? [])].sort((x, y) => x.savedAt - y.savedAt)) {
      const day = Math.max(0, calendarDaysBetween(openingAt, sn.savedAt));
      if (sn.spot > 0 && day > 0 && day < todayDay) byDay.set(day, { legs: sn.legs, spot: sn.spot, day, pnl: trackedTotalPnl(legs, sn.legs, sn.spot, spot), estimated: sn.estimated });
    }
    // 只有权利金是今天的才补"今天"这一点（同trackedHistory）。
    if (trackedLegs && todayDay > 0 && trackedAsOfDays === 0) byDay.set(todayDay, { legs: trackedLegs, spot: effectiveTrackedSpot, day: todayDay, pnl: pnlNow });
    const states = [...byDay.values()].sort((x, y) => x.day - y.day);
    return { states, ...buildAttributionTimeline(states) };
  }, [trackedHistory, trackedStrategy, legs, openingDayLegs, spot, openingAt, trackedLegs, effectiveTrackedSpot, trackedAsOfDays]);
  // 跟踪对比模式的地形图：左边真实走过的路（开仓点+快照），右边从今天推演、全部按开仓至今的总账显示。
  const trackedMap = useMemo(() => {
    if (!showStockOptionMap || !trackedHistory || !trackedTimeline) return undefined;
    const { segments, totals } = trackedTimeline;
    return {
      todayDay: trackedHistory.todayDay, pnlOffset: trackedHistory.pnlNow, opening: { legs: openingDayLegs, spot },
      history: trackedHistory.points, markers: trackedHistory.markers, segments, totals, ruleExit, asOfDays: trackedAsOfDays,
    };
  }, [showStockOptionMap, trackedHistory, trackedTimeline, ruleExit, openingDayLegs, spot, trackedAsOfDays]);

  const legToolbar = (
    <>
      <span className="relative flex">
      {showGuide12 && <StepBadge n={2} title={t("guide.step2")} />}
      <button
        data-guide="add-leg"
        onClick={handleToolbarAddLeg}
        // 对比模式下开仓组合的结构是定的（只能修正输错的数），不能再加腿。
        disabled={isCompareMode || activeToolbarLegsCount >= activeToolbarLegCap}
        title={t("leg.addLeg")}
        className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={12} />
      </button>
      </span>
      <button
        onClick={handleToolbarClear}
        disabled={activeToolbarLegsCount === 0}
        title={t("leg.clearAll")}
        className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-slate-400 transition hover:border-rose-500 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 size={12} />
      </button>
      {/* 策略库在缺股票代码时也能用：打开已存策略会带上它自己的代码（见LockedOverlay）。 */}
      <div data-lock-exempt-symbol className="contents">
      <DropdownMenu
        label={t("toolbar.presetLabel")}
        icon={<Layers size={11} />}
        guideId="library"
        badge={showGuide12 ? <StepBadge n={2} title={t("guide.step2")} /> : undefined}
      >
        {(close) => (
          <button
            onClick={() => { close(); setManageMode("open"); setManageStrategyOpen(true); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
          >
            <Settings2 size={12} className="text-amber-400" /> {t("toolbar.manageStrategy")}
          </button>
        )}
      </DropdownMenu>
      </div>
      {!isCompareMode && !simOrigin && onAddToSimAccount && (
        // 纯图标（文字在title里），给这一行腾宽度。
        <button
          onClick={handleToolbarAddToSim}
          disabled={activeToolbarLegsCount === 0 || spot <= 0 || addingToSim}
          title={t("toolbar.addToSim")}
          className="flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-slate-400 transition hover:border-emerald-500/50 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {addingToSim ? <RefreshCw size={12} className="animate-spin" /> : <Wallet size={12} />}
        </button>
      )}
    </>
  );

  return (
    // 手机（useIsMobile）：左右两栏改上下排列、整页滚动；电脑/iPad布局不变。
    <div className={isMobile ? "op-mobile flex min-h-screen flex-col bg-slate-950 text-slate-200" : "flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-200"}>
      {/* ── Header ── */}
      <AppHeader
        simOrigin={simOrigin}
        onCancelSimOrigin={onCancelSimOrigin}
        onBackHome={onBackHome}
        isCompareMode={isCompareMode}
        onRequestLeave={() => requestLeave()}
        customPresets={customPresets}
        onDeleteCustomPreset={handleDeleteCustom}
        onSelectPreset={(preset) => {
          const rawLegs = preset.legs();
          // 激活B/C时预设直接填进该槽位，不走A的未保存确认。
          if (activeComboIndex > 0) {
            const slot = compareSlots[activeComboIndex - 1];
            if (slot) applyPresetToSlot(slot.id, rawLegs, spot, symbol);
            return;
          }
          if (compareUnsaved) {
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
        needSymbol={needSymbol}
        showGuideSteps={showGuide12}
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
      <div className={isMobile ? "flex flex-col" : "flex min-h-0 flex-1 gap-0"}>
        {/* LEFT: 腿位（手机上在上面） */}
        <div
          className={isMobile ? "flex flex-col border-b border-slate-800" : "flex shrink-0 flex-col overflow-y-auto border-r border-slate-800"}
          style={isMobile ? undefined : { width: "38%", minWidth: 380 }}
        >
          <LockedOverlay reason={leftLockReason} className="flex flex-col">
          <div className={`${isMobile ? "" : "sticky top-0 z-20 "}grid shrink-0 grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto] items-center gap-x-2 gap-y-1 border-b border-slate-800/60 bg-slate-950 px-3 py-1.5`}>
            <LegPanelTitleRow
              legsCount={legs.length}
            />
            {!isCompareMode && (
                // 电脑版这一行必须一行放下、不能横向滚动（xue的要求）；放不下时继续简化元素（如改纯图标），不要加滚动。
                <div className={`col-span-2 row-start-2 flex min-w-0 ${isMobile ? "flex-wrap" : "flex-nowrap"} items-center gap-x-3 gap-y-1 pt-0.5`}>{/* 手机上允许换行 */}
                  {/* 手机精简版不显示开仓价/开仓日期：开仓价跟随实时报价，开仓日期为今天。 */}
                  {!isMobile && (<>
                  <label className="relative flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] text-slate-500" title={t("stock.openPrice")}>
                    {showGuide34 && <StepBadge n={3} title={t("guide.step3")} />}
                    <span>{t("stock.openPrice")}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min={NUMBER_RULES.price.min}
                      max={NUMBER_RULES.price.max}
                      value={spot > 0 ? spot : ""}
                      onChange={(e) => {
                        // 空字符串和末尾小数点先放行（否则没法正常打字），完整数字才clamp。
                        if (e.target.value === "" || /[.-]$/.test(e.target.value)) return;
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v)) {
                          spotManuallySet.current = true;
                          setSpot(clampToRule(v, NUMBER_RULES.price));
                        }
                      }}
                      onKeyDown={(e) => blockInvalidNumberKey(e, NUMBER_RULES.price)}
                      onWheel={(e) => e.currentTarget.blur()}
                      className="w-20 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] tabular-nums text-emerald-400 outline-none transition focus:border-emerald-500 focus:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </label>
                      <label className="relative flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] text-slate-500" title={t("stock.openDate")}>
                    {showGuide34 && <StepBadge n={3} title={t("guide.step3")} />}
                    <span>{t("stock.openDate")}</span>
                    <input
                      type="date"
                      lang={lang === "en" ? "en" : "zh-CN"}
                      value={formatDateInput(openingAt)}
                      onChange={(e) => {
                        const next = parseDateInput(e.target.value);
                        if (next !== null) setOpeningAt(next);
                      }}
                      className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] tabular-nums text-slate-300 outline-none transition focus:border-sky-500 focus:text-sky-200 [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </label>
                  </>)}
                  <div className="ml-auto flex items-center gap-2">
                    {legToolbar}
                  </div>
                </div>
              )}
            {/* flex-wrap：到期盈利/盈亏平衡在窄面板上可能放不下，nowrap会把内容挤到面板外看不见。 */}
            {/* 有B/C时，到期盈利+盈亏平衡移到各方案自己的全选行旁显示，这里不再显示。 */}
            <div className="col-start-2 row-start-1 ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
              {compareSlots.length === 0 && activeLegs.length > 0 && (
                <PopBreakevenBadge pop={pop} breakevens={breakevens} />
              )}
            </div>
          </div>

          {/* ── Original combo section ── */}
          {/* 主combo的激活容器（点击任意区域激活），只在存在B/C时显示高亮/手型。 */}
          {/* 手机上跟踪对比不显示开仓组合的腿（今日组合区的统计网格里已有开仓vs当前的对比）。 */}
          {!(isMobile && isCompareMode) && (
          <div
            onClick={() => setActiveComboIndex(0)}
            className={
              !isCompareMode && !simOrigin && compareSlots.length > 0
                ? `cursor-pointer rounded transition ${activeComboIndex === 0 ? "ring-1 ring-emerald-500/40" : ""}`
                : ""
            }
          >
          <LegListSection
            isCompareMode={isCompareMode}
            strategyName={strategyName}
            customPresets={customPresets}
            inlinePopBreakeven={compareSlots.length > 0 ? { pop, breakevens } : null}
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
            showSaveGuide={showGuide34}
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
          </div>
          )}
          {/* ── Today's combo section (compare mode only) ── */}
          {isCompareMode && trackedLegs && (
            <TrackedComboSection
              contractsExpired={isExpiredReal}
              trackedLegs={trackedLegs}
              trackedStrategy={trackedStrategy}
              activeSnapshotId={activeSnapshotId}
              onSelectSnapshot={(snap) => guardSnapshot(() => handleSelectSnapshot(snap))}
              onDeleteSnapshot={(id) => guardSnapshot(() => void handleDeleteSnapshot(id))}
              onSaveTracked={handleSaveTrackedClick}
              trackedDirty={compareUnsaved}
              trackedResult={trackedResult}
              realizedPnl={realizedTrackedPnl}
              spot={spot}
              activeLegs={openingDayLegs}
              effectiveTrackedSpot={effectiveTrackedSpot}
              trackedAsOf={trackedAsOf}
              priceError={trackedPriceError}
              activeTrackedLegs={activeTrackedLegs}
              effectiveDaysElapsed={effectiveDaysElapsed}
              onToggleImpliedInfo={() => setShowImpliedInfo((v) => !v)}
              symbol={symbol}
              trackedLegPnlById={trackedLegPnlById}
              trackedLegRolesById={trackedLegRolesById}
              onChangeTrackedLeg={updateTrackedLeg}
              onToggleTrackedLeg={toggleTrackedLeg}
              onCloseTrackedLeg={closeTrackedLeg}
              onAddTrackedLegToPreset={() => { setPresetSaveSource("tracked"); setSaveDialogOpen(true); }}
              // 明确指定作用于今日组合（这几个handler默认作用于开仓组合）。
              onRoll={(legId: string) => handleRoll(legId, "tracked")}
              onHedge={() => handleHedge("tracked")}
              onProtect={(legId: string) => handleProtect(legId, "tracked")}
              onMoveTrackedLeg={moveTrackedLeg}
            />
          )}

          {/* 手机精简版不显示：盈亏归因、多方案对比（B/C）。 */}
          {isCompareMode && pnlAttribution && !isMobile && (
            <div className="shrink-0 border-t border-slate-800 px-3 py-2">
              <PnlAttributionPanel attribution={pnlAttribution} maxAbs={attributionMaxAbs} endLabel={t("future.wfNow")} />
            </div>
          )}

          {!isCompareMode && analysisAttribution && !isMobile && (
            <div className="shrink-0 border-t border-slate-800 px-3 py-2">
              <PnlAttributionPanel attribution={analysisAttribution} maxAbs={attributionMaxAbs} endLabel={t("future.wfScen")} />
            </div>
          )}

          {/* 持仓建议：只读，滑块锁定左栏时也能看、能点"去修改"。 */}
          {!isMobile && !needSymbol && activeLegs.length > 0 && (isCompareMode ? !!activeTrackedLegs : true) && (
            <div className="shrink-0 border-t border-slate-800 px-3 py-2" data-lock-exempt>
              <PositionAdviceCard
                mode={isCompareMode ? "tracked" : "analysis"}
                symbol={symbol}
                openingLegs={isCompareMode ? openingDayLegs : mapLegs}
                openingSpot={isCompareMode ? spot : analyticsSpot}
                openingAt={openingAt}
                nowLegs={isCompareMode ? activeTrackedLegs : adviceScenarioLegs}
                nowSpot={isCompareMode ? effectiveTrackedSpot : analyticsSpot + analyticsShifts.dS}
                nowDay={isCompareMode ? Math.max(0, effectiveDaysElapsed) : analyticsShifts.dT}
                pnl={isCompareMode ? (trackedResult ? trackedResult.change + realizedTrackedPnl : 0) : result.change}
                adjusted={isCompareMode && (trackedLegs ?? []).some((l) => l.derivedFrom || l.closedPnl != null)}
                customPresets={customPresets}
                marketIv={isCompareMode ? null : analysisIv || null}
                skew={isCompareMode ? 0 : marketIvInfo.skew}
                halfSpread={isCompareMode ? undefined : legSpreads}
                earnings={earnState.ctx}
                liveSpot={quote && quote.price > 0 ? quote.price : spot}
                waitScenario={!isCompareMode && analyticsShifts.dS === 0 && analyticsShifts.dT === 0 && analyticsShifts.dV === 0}
                onOpenSettings={() => {
                  setShifts({ dS: 0, dT: 0, dV: 0 });
                  setChartView("winRate");
                }}
              />
            </div>
          )}

          {/* 多方案对比（方案B/C）——只在分析模式下渲染，见App.tsx顶部
              useCompareSlots()调用处的注释和ComboCompareSlots.tsx。 */}
          {!isCompareMode && !simOrigin && !isMobile && (
            <ComboCompareSlots
              spot={spot}
              symbol={symbol}
              customPresets={customPresets}
              mainLegs={legs}
              slots={compareSlots}
              locked={isExploring}
              analyticsSpot={analyticsSpot}
              analyticsShifts={analyticsShifts}
              activeComboIndex={activeComboIndex}
              onActivate={setActiveComboIndex}
              slotBatchOps={[batchOpsB, batchOpsC]}
              onSaveSlot={() => setSaveStrategyOpen(true)}
              onAddSlot={handleAddCompareSlotAndActivate}
              onRemoveSlot={removeCompareSlot}
              onUpdateLeg={updateCompareSlotLeg}
              onDeleteLeg={deleteCompareSlotLeg}
              onToggleLeg={toggleCompareSlotLeg}
            />
          )}
          </LockedOverlay>
        </div>

        {/* RIGHT: 图表+滑块（手机上在下面；图表要给固定高度，否则整页滚动时高度为0） */}
        <div className={isMobile ? "flex flex-col" : "flex min-w-0 flex-1 flex-col min-h-0"}>
          <div
            // 标签行高度不固定（窄窗口/英文会换行），图表区用flex占满剩下的，不再假设标签行30px（原来会溢出压到滑块）
            className={isMobile ? "flex flex-col px-1 py-1.5" : "flex min-h-0 flex-1 flex-col px-2 py-1.5"}
            style={isMobile ? { height: "min(62vh, 560px)", minHeight: 320 } : undefined}
          >
            {showChartTabs && (
              <div className="mb-1.5 flex shrink-0 items-end gap-1 border-b border-slate-700">
                {/* 盈亏图和地形图都属于"未来情景模拟"：标题+代码在左边，后面是真正的文件夹式标签（下沿跟图表区连在一起），
                    避免看起来像三个并列的功能按钮。没有有效股票代码时整块不可用。 */}
                <span className={`flex shrink-0 items-baseline gap-2 self-center whitespace-nowrap border-r border-slate-700 pb-1 pr-3 mr-2 ${needSymbol ? "opacity-40" : ""}`}>
                  <span className="relative pr-1 text-[13px] font-bold text-sky-400">
                    {showGuide5 && <StepBadge n={5} title={t("guide.step5")} />}
                      {isCompareMode ? t("shift.scenarioFrozen") : t("shift.scenario")}
                  </span>
                </span>
                {(["payoff", "stockVsOption", "winRate"] as const).map((v) => (
                  <button
                    key={v}
                    disabled={needSymbol}
                    onClick={() => {
                      // 三个标签共用同一组情景滑块，切换时不归零。
                      setChartView(v);
                    }}
                    className={`relative -mb-px shrink-0 whitespace-nowrap rounded-t-md border px-3 py-1 text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      chartView === v
                        ? "border-slate-600 border-b-slate-950 bg-slate-950 text-sky-300"
                        : "border-transparent text-slate-500 hover:bg-slate-800/50 hover:text-slate-300"
                    }`}
                  >
                    {t(isCompareMode
                      ? (v === "payoff" ? "chart.tabPayoffCompare" : v === "stockVsOption" ? "chart.tabPathCompare" : "chart.tabReview")
                      : (v === "payoff" ? "chart.tabPayoff" : v === "stockVsOption" ? "chart.tabStockVsOption" : "chart.tabWinRate"))}
                  </button>
                ))}
                {/* 右端：分析模式的盈亏头部 + 分析↔对比模式切换（两种模式、三个标签下都在这里）。 */}
                {/* 窄窗口/英文放不下时，头部和切换按钮在这一格里换行，不被裁掉 */}
                <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-0.5 self-center pb-1">
                {!isCompareMode && activeLegs.length > 0 && (
                  <PnlHeadline
                    dateTs={addCalendarDays(openingAt, analyticsShifts.dT)}
                    pnl={result.change}
                    netValue={result.shiftedValue}
                    netChange={result.change}
                    hasStock={activeLegs.some((l) => l.kind === "stock")}
                  />
                )}
                {modeSwitchButton}
                </div>
              </div>
            )}
            <ErrorBoundary>
              {showWinRate && !isCompareMode ? (
              <div className="min-h-0 flex-1">
                <FutureSim
                  symbol={symbol}
                  legs={mapLegs}
                  spot={analyticsSpot}
                  dV={shifts.dV}
                  scenario={shifts.dS !== 0 || shifts.dT !== 0 ? { day: shifts.dT, price: analyticsSpot + shifts.dS } : null}
                  fork={adviceScenarioLegs ? { legs: adviceScenarioLegs, spot: analyticsSpot + analyticsShifts.dS, day: analyticsShifts.dT, pnl: result.change } : null}
                  marketIv={analysisIv}
                  ivSource={marketIvInfo.source}
                  skew={marketIvInfo.skew}
                  halfSpread={legSpreads}
                  earnings={earnState.ctx}
                  emptyText={needSymbol ? t("chart.noSpot") : activeLegs.length === 0 ? t("chart.addLegs") : null}
                />
              </div>
              ) : showWinRate ? (
              <div className="min-h-0 flex-1">
                <RetroSim
                  symbol={symbol}
                  legs={openingDayLegs}
                  spot={spot}
                  openingAt={openingAt}
                  todayDay={Math.max(0, effectiveDaysElapsed)}
                  nowSpot={effectiveTrackedSpot}
                  pnlNow={trackedHistory?.pnlNow ?? 0}
                  history={trackedHistory?.withToday ?? []}
                  ruleExit={ruleExit}
                  ivChange={trackedVolShift}
                  ivOpen={sliderBaseIv}
                  journey={trackedTimeline}
                  todayLegs={activeTrackedLegs ?? []}
                  adjusted={(trackedLegs ?? []).some((l) => l.derivedFrom || l.closedPnl != null)}
                  markers={trackedHistory?.markers ?? []}
                  emptyText={needSymbol ? t("chart.noSpot") : activeLegs.length === 0 ? t("chart.addLegs") : null}
                />
              </div>
              ) : showStockOptionMap ? (
              <div className="min-h-0 flex-1">
                <StockOptionMap
                  symbol={symbol}
                  liveSpot={quote?.price}
                  legs={isCompareMode ? activeTrackedLegs ?? [] : mapLegs}
                  onPointChange={setMapPoint}
                  tracked={trackedMap}
                  spot={isCompareMode ? effectiveTrackedSpot : analyticsSpot}
                  dV={isCompareMode ? 0 : shifts.dV}
                  scenario={!isCompareMode && (shifts.dS !== 0 || shifts.dT !== 0) ? { day: shifts.dT, price: analyticsSpot + shifts.dS } : null}
                  zoneCtx={isCompareMode ? null : mapZoneCtx}
                  marketIv={isCompareMode ? null : analysisIv || null}
                  todayIv={isCompareMode || todayMarket.source !== "atm" ? null : todayMarket.iv}
                  openingAt={openingAt}
                  daysSinceOpen={openingSimBasis && !isExpiredOpening ? openingSimBasis.daysSinceOpen : undefined}
                  emptyText={needSymbol ? t("chart.noSpot") : t("chart.addLegs")}
                />
              </div>
              ) : (
              <div className="min-h-0 flex-1">
              <PayoffChart
                // 分析模式用开仓基准腿位（第0天=开仓日），跟滑块的dT、头部盈亏、归因、地形图同一份数据；
                // 用实时腿位的话，开仓日在过去时"已过去的天数"会被重复扣一次。
                legs={isCompareMode ? activeLegs : mapLegs}
                spot={analyticsSpot}
                shifts={analyticsShifts}
                symbol={symbol}
                compact={isMobile}
                breakevens={breakevens}
                trackedLegs={activeTrackedLegs ?? undefined}
                openingLegs={isCompareMode ? activeLegs : undefined}
                compareMode={isCompareMode}
                perLegValues={isCompareMode && trackedResult ? trackedResult.perLeg : result.perLeg}
                netValue={isCompareMode && trackedResult ? trackedResult.shiftedValue : result.shiftedValue}
                netChange={isCompareMode && trackedResult ? trackedResult.change : result.change}
                trackedSpot={isCompareMode ? effectiveTrackedSpot : undefined}
                liveSpot={isCompareMode && liveTrackedSpot !== null ? liveTrackedSpot : undefined}
                expired={isExpiredOpening}
                openingAt={openingAt}
                compareCurves={!isCompareMode ? compareCurves : undefined}
                hideHeadline={showChartTabs && !isCompareMode}
              />
              </div>
              )}
            </ErrorBoundary>
          </div>

          {/* Sliders（手机上的跟踪对比不显示：对比模式滑块是冻结的，内容跟统计网格重复） */}
          {/* 胜率模拟：推演未来时保留滑块（拖动只移动走势图上的情景点，不重新模拟）；今昔对比的滑块是冻结的，这个标签下不显示 */}
          {!(isMobile && isCompareMode) && !(showWinRate && isCompareMode) && (
          <div className="shrink-0 border-t border-slate-800 px-3 py-1.5">
            <ShiftSliders
              shifts={shifts}
              spot={spot}
              maxDte={sliderMaxDte}
              // "今天"参考点=离开仓(day0)过了几天。
              todayDte={!isCompareMode && openingSimBasis && !isExpiredOpening ? openingSimBasis.daysSinceOpen : undefined}
              onChange={(patch) => setShifts((s) => ({ ...s, ...patch }))}
              onReset={() => setShifts({ dS: 0, dT: 0, dV: 0 })}
              onJumpToday={() => setShifts((s) => ({ ...s, dT: openingSimBasis?.daysSinceOpen ?? 0 }))}
              trackedSpot={isCompareMode ? effectiveTrackedSpot : undefined}
              trackedDays={isCompareMode ? effectiveDaysElapsed : undefined}
              trackedVolShift={trackedVolShift}
              baseIv={sliderBaseIv > 0 ? sliderBaseIv : undefined}
              // 分析模式下没有腿位时滑块也锁住；frozen只看isCompareMode，避免标题误显示成"情景偏移对比"。
              disabled={isCompareMode || activeLegs.length === 0 || needSymbol}
              frozen={isCompareMode}
              guideBadge={showGuide5 && !showChartTabs ? <StepBadge n={5} title={t("guide.step5")} /> : undefined}
              hideTitle={showChartTabs}
            />
          </div>
          )}
        </div>
      </div>

      {isMobile && (
        <div className="px-3 py-4 text-center text-[11px] text-slate-500">{t("mobile.fullFeaturesHint")}</div>
      )}

      {helpOpen && (
        <HelpPanel moduleId={isCompareMode ? "compare" : "analysis"} variant="info" onClose={() => setHelpOpen(false)} />
      )}

      {premiumIssues && (
        <ConfirmPremiumCheckDialog
          issues={premiumIssues}
          spot={trackedSpot ?? spot}
          onCancel={() => setPremiumIssues(null)}
          onConfirm={() => {
            setPremiumIssues(null);
            proceedSaveTracked();
          }}
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
        // 这个对话框来自clearAllLegs或requestLeave（点logo），pendingTrackedLeaveHome区分答完后的动作。
        onDontSaveTracked={() => {
          setConfirmSaveTrackedOpen(false);
          if (pendingTrackedLeaveHome.current) { pendingTrackedLeaveHome.current = false; finishLeave(); return; }
          doClearAll();
        }}
        // 快照真正存好才继续；取消保存对话框或存失败就停下。
        onSaveTrackedThenClear={() => {
          setConfirmSaveTrackedOpen(false);
          void handleSaveTracked(
            () => {
              if (pendingTrackedLeaveHome.current) { pendingTrackedLeaveHome.current = false; finishLeave(); return; }
              doClearAll();
            },
            () => { pendingTrackedLeaveHome.current = false; },
          );
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
        trackedAsOf={trackedAsOf}
        onCloseImplied={() => setShowImpliedInfo(false)}
        spot={spot}
        symbol={symbol}
      />

      <StrategyPersistenceDialogs
        confirmPresetOpen={confirmPresetOpen}
        onCancelPresetSwitch={() => { setConfirmPresetOpen(false); pendingPresetAction.current = null; }}
        onDontSavePresetSwitch={() => { setConfirmPresetOpen(false); if (pendingPresetAction.current) { applyPreset(pendingPresetAction.current.rawLegs); pendingPresetAction.current = null; } }}
        onSaveSnapshotThenPresetSwitch={() => {
          setConfirmPresetOpen(false);
          void handleSaveTracked(
            () => { if (pendingPresetAction.current) { applyPreset(pendingPresetAction.current.rawLegs); pendingPresetAction.current = null; } },
            () => { pendingPresetAction.current = null; },
          );
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
        // 显示是哪个方案、还剩几个待确认，避免看起来像同一个提示重复弹出。
        leaveComboLabel={
          leaveQueue.length > 0
            ? [t("compare.slotA"), t("compare.slotB"), t("compare.slotC")][leaveQueue[0]]
            : undefined
        }
        leaveRemainingCount={Math.max(0, leaveQueue.length - 1)}
        onCancelLeave={() => { setConfirmLeaveOpen(false); setLeaveQueue([]); }}
        onDontSaveLeave={() => { setConfirmLeaveOpen(false); advanceLeaveQueue(); }}
        onSaveFirstLeave={() => {
          // 队首如果是B/C，先把激活焦点切过去，保存对话框才会读到正确的
          // 那个槽位（activeSlot由activeComboIndex决定，见下面
          // handleSaveStrategyForActive/onSaveStrategy的接线）。
          const target = leaveQueue[0];
          if (target !== undefined && target > 0) setActiveComboIndex(target);
          setConfirmLeaveOpen(false);
          setSaveStrategyOpen(true);
          // 保存成功后的队列推进在handleSaveStrategyForActive/handleOverwriteStrategyForActive里；
          // 这里不置pendingLeaveAfterSave，避免跟队列逻辑重复导航。
        }}
        confirmSwitchOpen={confirmSwitchOpen}
        onCancelSwitch={() => { setConfirmSwitchOpen(false); pendingSwitchSource.current = null; }}
        onDontSaveSwitch={() => {
          setConfirmSwitchOpen(false);
          if (pendingSwitchSource.current) { performSwitchToAnalysis(pendingSwitchSource.current); pendingSwitchSource.current = null; }
        }}
        onSaveSnapshotThenSwitch={() => {
          setConfirmSwitchOpen(false);
          void handleSaveTracked(
            () => { if (pendingSwitchSource.current) { performSwitchToAnalysis(pendingSwitchSource.current); pendingSwitchSource.current = null; } },
            () => { pendingSwitchSource.current = null; },
          );
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
        onSaveSnapshotThenSymbolChange={() => {
          setConfirmSymbolChangeOpen(false);
          void handleSaveTracked(
            () => {
              if (pendingSymbolChange.current) {
                rescaleForNewSymbol(pendingSymbolChange.current.symbol, pendingSymbolChange.current.spot);
                pendingSymbolChange.current = null;
              }
            },
            () => { setSymbol(legBaseSymbol.current); pendingSymbolChange.current = null; },
          );
        }}
        saveStrategyOpen={saveStrategyOpen}
        onCloseSaveStrategy={() => {
          setSaveStrategyOpen(false);
          pendingPresetReplace.current = null;
          pendingLibraryAction.current = null;
          pendingLeaveAfterSave.current = false;
          pendingSaveTrackedAfterStrategy.current = false;
          // "先存快照再做X"时取消了保存：X不做。
          const cont = pendingAfterTrackedSave.current;
          pendingAfterTrackedSave.current = null;
          cont?.onAbort?.();
          // 退出流程中"先保存"后又取消：整体放弃退出。
          setLeaveQueue([]);
        }}
        onSaveStrategy={handleSaveStrategyForActive}
        onOverwriteStrategy={handleOverwriteStrategyForActive}
        symbol={symbol}
        comboDirection={activeSlot ? activeSlotDirection : comboDirection}
        strategyName={activeSlot ? activeSlotStrategyName : strategyName}
        activeLegs={activeSlot ? activeSlot.legs : activeLegs}
        spot={spot}
        shifts={activeSlot ? { dS: 0, dT: 0, dV: 0 } : shifts}
        openingAt={activeSlot ? Date.now() : openingAt}
        savedStrategies={savedStrategies}
        manageStrategyOpen={manageStrategyOpen}
        onCloseManage={() => setManageStrategyOpen(false)}
        manageMode={manageMode}
        // 打开策略时激活B/C则用applyStrategyToSlot（按s.spot→当前现价缩放），不碰A的策略生命周期state；激活A时不变。
        onOpenStrategy={(s) => guardLibrary(() => {
          if (activeComboIndex > 0) {
            const slot = compareSlots[activeComboIndex - 1];
            if (slot) applyStrategyToSlot(slot.id, s.legs, s.spot, spot, symbol);
            setManageStrategyOpen(false);
            return;
          }
          handleOpenStrategy(s);
          setGuideSaved(true);
        })}
        onReorderStrategies={handleReorderStrategies}
        onRenameStrategy={handleRenameStrategy}
        onDeleteStrategy={handleDeleteStrategy}
        onToggleStarStrategy={handleToggleStar}
        onTrackStrategy={(s) => guardLibrary(() => void handleTrack(s), true)}
      />
      {confirmLibrary === "strategy" && (
        <ConfirmReplacePresetDialog
          descKey="confirm.replaceDescLibrary"
          onCancel={() => { setConfirmLibrary(null); pendingLibraryAction.current = null; }}
          onDontSave={() => { setConfirmLibrary(null); runPendingLibrary(); }}
          onSaveFirst={() => { setConfirmLibrary(null); setSaveStrategyOpen(true); }}
        />
      )}
      {confirmLibrary === "snapshot" && (
        <ConfirmSnapshotDialog
          onCancel={() => { setConfirmLibrary(null); pendingLibraryAction.current = null; }}
          onDontSave={() => { setConfirmLibrary(null); runPendingLibrary(); }}
          onSaveSnapshot={() => {
            setConfirmLibrary(null);
            void handleSaveTracked(runPendingLibrary, () => { pendingLibraryAction.current = null; });
          }}
        />
      )}
    </div>
  );
}