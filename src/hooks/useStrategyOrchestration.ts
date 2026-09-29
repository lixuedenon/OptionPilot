// src/hooks/useStrategyOrchestration.ts
import { useCallback, useState } from "react";
import type { Leg, Shifts } from "@/lib/types";
import {
  saveStrategy,
  overwriteStrategy,
  addTrackedSnapshot,
  updateSnapshotTime,
  deleteTrackedSnapshot,
  backfillTrackedSnapshots,
  serializeStrategyState,
  serializeTrackedLegs,
  findDuplicate,
  computeOpeningSimBasis,
  type SavedStrategy,
  type TrackedSnapshot,
} from "@/lib/savedStrategies";
import { uid, blankLeg, asOpeningLeg } from "@/lib/legFactory";
import { calendarDaysSince, nearestFridayDte } from "@/lib/dateUtils";
import { peekResolvedChain, nearestStrikeToSpot, resolveFromCache } from "@/lib/optionChain";
import type { StockQuote } from "@/lib/useStockQuote";

// App.tsx的"策略管理"逻辑：组合修改（addLeg/applyPreset/clearAllLegs…）+策略保存/模式切换，按原顺序放在一个hook里，
// 它们之间互相调用。所有ref在App.tsx创建、原样传进来，App.tsx和这里读写的是同一个对象。
// ⚠️ 全项目bug最多的一块，改动要小心。

export function useStrategyOrchestration(params: {
  // Opening combo
  symbol: string;
  legs: Leg[];
  activeLegs: Leg[];
  spot: number;
  shifts: Shifts;
  openingAt: number;
  setSymbol: React.Dispatch<React.SetStateAction<string>>;
  setLegs: React.Dispatch<React.SetStateAction<Leg[]>>;
  setSpot: React.Dispatch<React.SetStateAction<number>>;
  setShifts: React.Dispatch<React.SetStateAction<Shifts>>;
  setOpeningAt: React.Dispatch<React.SetStateAction<number>>;
  // 对比模式开仓日期的临时预览值，不写回openingAt。每次模式切换/加载/保存都必须清回null。
  setOpeningAtSimOverride: React.Dispatch<React.SetStateAction<number | null>>;
  // 打开一条策略时，如果发现"真实经过天数"已经超过它第0天的完整周期
  // （说明这条策略现实中已经过了真正的到期日），App.tsx据此弹一个"已过
  // 期，删除还是保留"的确认框。null=不弹。
  setExpiredStrategyPrompt: React.Dispatch<React.SetStateAction<SavedStrategy | null>>;
  // "已过期"结论：handleOpenStrategy/handleTrack加载时用未被钳过的原始s.legs算好存进来。
  // 不能靠渲染时从live legs反推（dte被钳到0后会失真）。清空/加载未过期策略/重新以当下为基准时清回false。
  setExpiredConfirmed: React.Dispatch<React.SetStateAction<boolean>>;
  // 跟踪一条已过期策略时的提示：对比模式没有"保留"，只有"确定"（删除该策略）。null=不弹。
  setExpiredTrackPrompt: React.Dispatch<React.SetStateAction<SavedStrategy | null>>;
  setCorrectedSpot: React.Dispatch<React.SetStateAction<number | null>>;
  setCorrecting: React.Dispatch<React.SetStateAction<boolean>>;
  // Tracked combo
  isCompareMode: boolean;
  trackedLegs: Leg[] | null;
  trackedSpot: number | null;
  // trackedDirty是App.tsx派生出来的只读值（指纹比较），这里只读不写。
  trackedDirty: boolean;
  effectiveTrackedSpot: number;
  setTrackedLegs: React.Dispatch<React.SetStateAction<Leg[] | null>>;
  setTrackedSpot: React.Dispatch<React.SetStateAction<number | null>>;
  setTrackedDaysElapsed: React.Dispatch<React.SetStateAction<number>>;
  // "此刻视为已保存"时调用，记下trackedLegs的指纹；null=不在对比模式。
  setTrackedBaseline: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveSnapshotId: React.Dispatch<React.SetStateAction<string | null>>;
  setConfirmSaveTrackedOpen: React.Dispatch<React.SetStateAction<boolean>>;
  // Saved-strategy library
  savedStrategies: SavedStrategy[];
  trackingStrategyId: string | null;
  trackedStrategy: SavedStrategy | undefined;
  setSavedStrategies: React.Dispatch<React.SetStateAction<SavedStrategy[]>>;
  setTrackingStrategyId: React.Dispatch<React.SetStateAction<string | null>>;
  setStrategyBaseline: React.Dispatch<React.SetStateAction<string | null>>;
  setSaveStrategyOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setManageStrategyOpen: React.Dispatch<React.SetStateAction<boolean>>;
  // Misc UI state this cluster also flips
  setConfirmClearOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setConfirmSwitchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  // Refs shared with App.tsx's own effects (rescaleForNewSymbol / the
  // symbol-change effect) and its confirm-dialog wiring — created in
  // App.tsx, passed straight through, never returned (see file header).
  legBaseSpot: React.MutableRefObject<number>;
  legBaseSymbol: React.MutableRefObject<string>;
  spotManuallySet: React.MutableRefObject<boolean>;
  pendingPreset: React.MutableRefObject<{ name: string; rawLegs: Leg[] } | null>;
  pendingPresetReplace: React.MutableRefObject<Leg[] | null>;
  pendingLeaveAfterSave: React.MutableRefObject<boolean>;
  pendingSaveTrackedAfterStrategy: React.MutableRefObject<boolean>;
  pendingSwitchSource: React.MutableRefObject<string | null>;
  // Cross-feature
  clearLegSelection: () => void;
  onBackHome?: () => void;
  onAddToSimAccount?: (payload: { symbol: string; legs: Leg[]; spot: number; openingAt?: number }) => Promise<{ ok: boolean; needsSetup?: boolean }>;
  addCustomPresetToLibrary: (data: { name: string; desc: string; market: string; stocks: string; direction: string }, legs: Leg[]) => Promise<void>;
  quote: StockQuote | null;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const {
    symbol, legs, activeLegs, spot, shifts, openingAt,
    setSymbol, setLegs, setSpot, setShifts, setOpeningAt, setOpeningAtSimOverride,
    setExpiredStrategyPrompt, setExpiredConfirmed, setExpiredTrackPrompt, setCorrectedSpot, setCorrecting,
    isCompareMode, trackedLegs, trackedSpot, trackedDirty, effectiveTrackedSpot,
    setTrackedLegs, setTrackedSpot, setTrackedDaysElapsed, setTrackedBaseline, setActiveSnapshotId, setConfirmSaveTrackedOpen,
    savedStrategies, trackingStrategyId, trackedStrategy,
    setSavedStrategies, setTrackingStrategyId, setStrategyBaseline, setSaveStrategyOpen, setManageStrategyOpen,
    setConfirmClearOpen, setConfirmSwitchOpen,
    legBaseSpot, legBaseSymbol, spotManuallySet,
    pendingPreset, pendingPresetReplace, pendingLeaveAfterSave, pendingSaveTrackedAfterStrategy, pendingSwitchSource,
    clearLegSelection, onBackHome, onAddToSimAccount, addCustomPresetToLibrary, quote, t,
  } = params;

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
  // override：B/C槽位激活时由App.tsx传入该槽位的legs/spot/symbol/openingAt；不传时用A的数据。
  const handleAddToSimAccount = useCallback(async (override?: { legs: Leg[]; spot: number; symbol: string; openingAt?: number }) => {
    const effectiveLegs = override ? override.legs : activeLegs;
    const effectiveSpot = override ? override.spot : spot;
    const effectiveSymbol = override ? override.symbol : symbol;
    const effectiveOpeningAt = override ? override.openingAt : openingAt;
    if (!onAddToSimAccount || effectiveLegs.length === 0 || effectiveSpot <= 0) return;
    setAddingToSim(true);
    try {
      // openingAt carries over the combo's real opening date (e.g. restored
      // from a saved strategy that was actually opened days/weeks ago) so
      // the resulting sim position's clock starts from when the position
      // was truly opened, not from the moment this button was clicked —
      // otherwise every DTE/P&L figure downstream in the simulator is
      // computed against the wrong elapsed time. See simAccount.ts's
      // openSimPosition for the other half of this.
      const result = await onAddToSimAccount({ symbol: effectiveSymbol.trim(), legs: effectiveLegs, spot: effectiveSpot, openingAt: effectiveOpeningAt });
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
    setTrackedBaseline(null);
    setTrackedDaysElapsed(0);
    setOpeningAt(Date.now());
    setExpiredStrategyPrompt(null);
    // 应用预设=从"现在"开始一条全新的第0天组合，不可能一开始就过期，见
    // App.tsx里expiredConfirmed state的注释。
    setExpiredConfirmed(false);
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
    setTrackedBaseline(null);
    setOpeningAt(Date.now());
    setExpiredStrategyPrompt(null);
    setExpiredConfirmed(false);
    legBaseSpot.current = 0;
    legBaseSymbol.current = "";
    setStrategyBaseline(null);
    clearLegSelection();
  };

  const updateTrackedLeg = (id: string, patch: Partial<Leg>) => {
    setTrackedLegs((prev) => prev?.map((l) => (l.id === id ? { ...l, ...patch } : l)) ?? null);
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
  }, [symbol, setCorrectedSpot, setCorrecting]);

  const comboDirection: "buy" | "sell" = activeLegs.length > 0 && activeLegs.every((l) => l.action === "buy") ? "buy" : "sell";

  // handleSaveTracked的两条路径共用：把trackedLegs作为新快照追加到已保存的策略上。
  // ⚠️ 同时永久锁定本次保存里所有展期/保护/对冲派生的腿（derivedFrom.locked）。锁定必须加在交给
  // addTrackedSnapshot的同一个数组上，而不是事后再改trackedLegs——否则快照里存的是未锁定的腿，
  // 以后重新打开那个快照又能撤销了。
  const saveTrackedSnapshotTo = useCallback(async (strategyId: string) => {
    if (!trackedLegs) return;
    // Any "开仓组合" date simulation in progress gets discarded on save —
    // it was never meant to persist. See setOpeningAtSimOverride's doc
    // comment above.
    setOpeningAtSimOverride(null);
    const lockedLegs = trackedLegs.map((l) =>
      l.derivedFrom && !l.derivedFrom.locked ? { ...l, derivedFrom: { ...l.derivedFrom, locked: true } } : l,
    );
    const updated = await addTrackedSnapshot(strategyId, lockedLegs, trackedSpot ?? spot, Date.now());
    setSavedStrategies(updated);
    const updatedStrategy = updated.find((s) => s.id === strategyId);
    const newSnaps = updatedStrategy?.trackedSnapshots ?? [];
    if (newSnaps.length > 0) setActiveSnapshotId(newSnaps[newSnaps.length - 1].id);
    setTrackedLegs(lockedLegs);
    // 保存成功：这份lockedLegs就是新的已保存基准。
    setTrackedBaseline(serializeTrackedLegs(lockedLegs));
  }, [trackedLegs, trackedSpot, spot, setActiveSnapshotId, setSavedStrategies, setTrackedBaseline, setTrackedLegs, setOpeningAtSimOverride]);

  const handleSaveStrategy = useCallback(async (filename: string) => {
    setOpeningAtSimOverride(null);
    const updated = await saveStrategy({ filename, symbol, spot, legs: activeLegs, shifts, openingAt });
    setSavedStrategies(updated);
    setSaveStrategyOpen(false);
    setStrategyBaseline(serializeStrategyState(symbol, legs, shifts, openingAt));
    setExpiredStrategyPrompt(null);
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
  }, [symbol, spot, legs, activeLegs, shifts, openingAt, applyPreset, onBackHome, saveTrackedSnapshotTo, pendingLeaveAfterSave, pendingPresetReplace, pendingSaveTrackedAfterStrategy, setSaveStrategyOpen, setSavedStrategies, setStrategyBaseline, setTrackingStrategyId, setOpeningAtSimOverride, setExpiredStrategyPrompt]);

  const handleOverwriteStrategy = useCallback(async (id: string, filename: string) => {
    setOpeningAtSimOverride(null);
    const updated = await overwriteStrategy(id, { filename, symbol, spot, legs: activeLegs, shifts, openingAt });
    setSavedStrategies(updated);
    setSaveStrategyOpen(false);
    setStrategyBaseline(serializeStrategyState(symbol, legs, shifts, openingAt));
    setExpiredStrategyPrompt(null);
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
  }, [symbol, spot, legs, activeLegs, shifts, openingAt, applyPreset, onBackHome, saveTrackedSnapshotTo, pendingLeaveAfterSave, pendingPresetReplace, pendingSaveTrackedAfterStrategy, setSaveStrategyOpen, setSavedStrategies, setStrategyBaseline, setTrackingStrategyId, setOpeningAtSimOverride, setExpiredStrategyPrompt]);

  const handleTrack = useCallback(async (s: SavedStrategy) => {
    // 对比模式需要真实行情，已过期的策略无法跟踪：用原始、未衰减的s.legs先判断，过期就弹提示并直接return，不改任何状态。
    {
      const legsAsOfTs = s.legsAsOf ?? s.openingAt ?? s.createdAt;
      const basis = computeOpeningSimBasis(s.openingAt ?? s.createdAt, legsAsOfTs, s.legs, s.spot);
      if (basis.daysSinceOpen > basis.originalMaxDte) {
        // ⚠️ return前必须先关"管理策略"弹窗，否则两个全屏弹窗叠在一起，过期提示点不到。
        setManageStrategyOpen(false);
        setExpiredTrackPrompt(s);
        return;
      }
    }
    // dte是相对"保存那一刻的今天"存的，界面按"今天+dte"显示到期日，所以要减去之后经过的日历天数，否则到期日会往后漂。
    // ⚠️ 衰减基准是legsAsOf（legs上次保存时间），不是openingAt——用openingAt会重复扣掉以前已扣过的天数。
    // openDaysElapsed（距真实开仓）只用于"已过X天"统计。
    const legsDecayDays = calendarDaysSince(s.legsAsOf ?? s.openingAt ?? s.createdAt);
    const openDaysElapsed = calendarDaysSince(s.openingAt ?? s.createdAt);
    setOpeningAtSimOverride(null);
    setSymbol(s.symbol);
    setLegs(s.legs.map((l) => ({
      ...l,
      id: uid(),
      dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - legsDecayDays),
    })));
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
    // 两条分支算出的trackedLegs就是这次新的已保存基准，统一在分支后算一次指纹。
    let newTrackedLegsForBaseline: Leg[];
    if (latestSnap) {
      // 两种"天数"别混：快照的腿只需再衰减"快照保存至今"的天数；"已过X天"统计始终按真实开仓日期算。
      // 都用日历天数（calendarDaysSince），不用24小时周期数（daysSince），否则09-01开仓、09-04查看会显示"已过2天"。
      const snapshotDecay = calendarDaysSince(latestSnap.savedAt);
      setTrackedDaysElapsed(calendarDaysSince(s.openingAt ?? s.createdAt));
      newTrackedLegsForBaseline = latestSnap.legs.map((l) => ({
        ...l,
        id: uid(),
        dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - snapshotDecay),
      }));
      setTrackedLegs(newTrackedLegsForBaseline);
      setTrackedSpot(latestSnap.spot);
      setActiveSnapshotId(latestSnap.id);
    } else {
      // "已过X天" still uses openDaysElapsed (real opening date) — see the
      // comment above legsDecayDays's definition. Only the dte decay below
      // uses legsDecayDays, same basis as the `legs` assignment above (this
      // is a fresh copy of legs with no snapshot yet, so it needs the
      // identical decay).
      setTrackedDaysElapsed(openDaysElapsed);
      newTrackedLegsForBaseline = s.legs.map((l) => ({
        ...l,
        id: uid(),
        // Record which opening leg (s.legs, about to become `legs`) this
        // tracked leg was derived from — see types.ts's comment on
        // openLegId. Must be captured before `id` above overwrites it.
        openLegId: l.id,
        dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - legsDecayDays),
      }));
      setTrackedLegs(newTrackedLegsForBaseline);
      setTrackedSpot(s.spot);
      setActiveSnapshotId(null);
    }
    setCorrectedSpot(null);
    setTrackingStrategyId(s.id);
    setTrackedBaseline(serializeTrackedLegs(newTrackedLegsForBaseline));
    setManageStrategyOpen(false);
    setStrategyBaseline(serializeStrategyState(s.symbol, s.legs, { dS: 0, dT: 0, dV: 0 }, s.openingAt ?? s.createdAt));
    clearLegSelection();

    // 走到这里说明上面开头那次判断已经确认没过期——显式清掉这两个state，
    // 防止上一次在分析模式"打开策略"时对另一条已过期策略点了"保留"留下
    // 的expiredConfirmed=true被这条全新、未过期的策略继续带着（这条本身
    // 真实、干净的仓位不该被误判成"已过期"）。
    setExpiredStrategyPrompt(null);
    setExpiredConfirmed(false);
  }, [clearLegSelection, legBaseSpot, legBaseSymbol, setActiveSnapshotId, setCorrectedSpot, setExpiredConfirmed, setExpiredStrategyPrompt, setExpiredTrackPrompt, setLegs, setManageStrategyOpen, setOpeningAt, setOpeningAtSimOverride, setSavedStrategies, setShifts, setSpot, setStrategyBaseline, setSymbol, setTrackedDaysElapsed, setTrackedBaseline, setTrackedLegs, setTrackedSpot, setTrackingStrategyId, spotManuallySet]);

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
  }, [trackingStrategyId, trackedLegs, saveTrackedSnapshotTo, symbol, spot, activeLegs, shifts, savedStrategies, pendingSaveTrackedAfterStrategy, setSaveStrategyOpen, setTrackingStrategyId]);

  const handleSelectSnapshot = useCallback((snap: TrackedSnapshot) => {
    // Same distinction as handleTrack's snapshot branch above: the snapshot's
    // legs only need decaying by the time since IT was saved (snapshotDecay)
    // to be current as of today, but "已过X天" should stay pinned to the
    // real opening date (`openingAt`, unaffected by which snapshot happens
    // to be selected) — not reset to ~0 just because the snapshot picked
    // was saved recently.
    const snapshotDecay = calendarDaysSince(snap.savedAt);
    setTrackedDaysElapsed(calendarDaysSince(openingAt));
    const newTrackedLegs = snap.legs.map((l) => ({
      ...l,
      id: uid(),
      dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - snapshotDecay),
    }));
    setTrackedLegs(newTrackedLegs);
    setTrackedSpot(snap.spot);
    setCorrectedSpot(null);
    setActiveSnapshotId(snap.id);
    setTrackedBaseline(serializeTrackedLegs(newTrackedLegs));
  }, [openingAt, setActiveSnapshotId, setCorrectedSpot, setTrackedDaysElapsed, setTrackedBaseline, setTrackedLegs, setTrackedSpot]);

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
  }, [trackingStrategyId, handleSelectSnapshot, setActiveSnapshotId, setSavedStrategies]);

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
  }, [trackingStrategyId, trackedLegs, openingAt, setSavedStrategies, setTrackedDaysElapsed, setTrackedLegs]);


  const handleOpenStrategy = useCallback((s: SavedStrategy) => {
    // 同handleTrack：dte按legsAsOf衰减，否则重新打开后显示的到期日会往后漂。
    const daysElapsed = calendarDaysSince(s.legsAsOf ?? s.openingAt ?? s.createdAt);
    setSymbol(s.symbol);
    // ⚠️ 每条腿的新id只生成一次（freshIds）：setLegs和computeOpeningSimBasis必须用同一份id，
    // 否则按id查的情景估值会全部查不到。
    const freshIds = s.legs.map(() => uid());
    setLegs(s.legs.map((l, i) => ({
      ...l,
      id: freshIds[i],
      dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - daysElapsed),
    })));
    setShifts(s.shifts);
    setSpot(s.spot);
    setOpeningAt(s.openingAt ?? s.createdAt);
    setOpeningAtSimOverride(null);
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

    // ⚠️ 必须在这里用未被钳过的原始s.legs算出"已过期"并存进expiredConfirmed，不能依赖App.tsx之后用live legs重算
    // （dte被钳到0后会失真，点"保留"后结论立刻变回false）。
    const legsAsOfTs = s.legsAsOf ?? s.openingAt ?? s.createdAt;
    const basisLegs = s.legs.map((l, i) => ({ ...l, id: freshIds[i] }));
    const basis = computeOpeningSimBasis(s.openingAt ?? s.createdAt, legsAsOfTs, basisLegs, s.spot);
    // 真实经过天数(按openingAt算)已经超过完整周期——这条策略现实中已经过
    // 了真正的到期日，交给App.tsx弹"删除还是保留"的确认框。
    const expired = basis.daysSinceOpen > basis.originalMaxDte;
    setExpiredStrategyPrompt(expired ? s : null);
    setExpiredConfirmed(expired);
  }, [quote, clearLegSelection, legBaseSpot, legBaseSymbol, setActiveSnapshotId, setCorrectedSpot, setExpiredConfirmed, setExpiredStrategyPrompt, setLegs, setManageStrategyOpen, setOpeningAt, setOpeningAtSimOverride, setShifts, setSpot, setStrategyBaseline, setSymbol, setTrackedDaysElapsed, setTrackedLegs, setTrackedSpot, setTrackingStrategyId, spotManuallySet]);

  // Direct switch from plain analysis mode into compare mode, carrying the
  // legs/spot/openingAt currently being edited — the "live" equivalent of
  // handleTrack() above, which does the same thing but reads from a
  // persisted SavedStrategy instead of the in-editor state. No days have
  // elapsed yet (we're switching right now), so trackedLegs starts as an
  // exact copy of legs with no DTE reduction — "today" and "opening" are
  // the same combo until the person edits the tracked side or time passes.
  const handleSwitchToCompare = useCallback(async () => {
    if (isCompareMode || legs.length === 0) return;
    setOpeningAtSimOverride(null);
    // 正在编辑的开仓组合可能正好是库里某条已保存策略（findDuplicate完全一致），是的话关联回去，
    // 这样快照选择器能显示/加载它已有的快照。
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
    // 同handleTrack：两条分支算出的trackedLegs就是新的已保存基准。
    let newTrackedLegsForBaseline: Leg[];
    if (latestSnap) {
      // 关联的策略已有快照：直接加载最新快照（按快照保存至今衰减dte），并设置activeSnapshotId，
      // 让快照选择器显示的"当前选中"和实际加载的一致。"已过X天"仍按真实开仓日期算。
      const snapshotDecay = calendarDaysSince(latestSnap.savedAt);
      setTrackedDaysElapsed(calendarDaysSince(openingAt));
      newTrackedLegsForBaseline = latestSnap.legs.map((l) => ({
        ...l,
        id: uid(),
        dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - snapshotDecay),
      }));
      setTrackedLegs(newTrackedLegsForBaseline);
      setTrackedSpot(latestSnap.spot);
      setActiveSnapshotId(latestSnap.id);
    } else {
      // 还没有快照：trackedLegs直接复制legs，dte不要再减——legs的dte已经是相对今天的，再减会重复衰减。
      // daysElapsed只用于"已过X天"统计（openingAt可能在过去）。
      const daysElapsed = calendarDaysSince(openingAt);
      setTrackedDaysElapsed(daysElapsed);
      newTrackedLegsForBaseline = legs.map((l) => ({
        ...l,
        id: uid(),
        // See types.ts's comment on openLegId — same reasoning as
        // handleTrack's no-snapshot branch above, just deriving directly
        // from the in-editor `legs` instead of a persisted SavedStrategy.
        openLegId: l.id,
        dte: l.dte,
      }));
      setTrackedLegs(newTrackedLegsForBaseline);
      setTrackedSpot(spot);
      setActiveSnapshotId(null);
    }
    setCorrectedSpot(null);
    setTrackingStrategyId(existing ? existing.id : null);
    setTrackedBaseline(serializeTrackedLegs(newTrackedLegsForBaseline));
    clearLegSelection();
  }, [isCompareMode, legs, spot, symbol, shifts, savedStrategies, openingAt, clearLegSelection, setActiveSnapshotId, setCorrectedSpot, setOpeningAtSimOverride, setSavedStrategies, setTrackedDaysElapsed, setTrackedBaseline, setTrackedLegs, setTrackedSpot, setTrackingStrategyId]);

  // 从对比模式切回分析模式，新的基准取决于source：
  // - "baseline"：开仓组合原样；
  // - "current"：今日组合升级为新基准；
  // - 快照id：该快照的腿/现价。
  // 后两种openingAt重置为那份数据的时间（现在或快照保存时刻），否则以后再跟踪会重复扣天数。
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
    // source为current或快照时开仓基准是"从现在重新开始"，不可能已过期，清掉expiredConfirmed；baseline时保持不变。
    if (source !== "baseline") setExpiredConfirmed(false);
    setLegs(newLegs);
    setSpot(newSpot);
    setOpeningAt(newOpeningAt);
    setOpeningAtSimOverride(null);
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
    setExpiredStrategyPrompt(null);
    clearLegSelection();
  }, [isCompareMode, legs, spot, openingAt, trackedLegs, effectiveTrackedSpot, trackedStrategy, symbol, clearLegSelection, legBaseSpot, legBaseSymbol, setActiveSnapshotId, setCorrectedSpot, setExpiredConfirmed, setLegs, setOpeningAt, setOpeningAtSimOverride, setExpiredStrategyPrompt, setShifts, setSpot, setStrategyBaseline, setTrackedDaysElapsed, setTrackedLegs, setTrackedSpot, setTrackingStrategyId, spotManuallySet]);

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
  }, [isCompareMode, trackedDirty, performSwitchToAnalysis, pendingSwitchSource, setConfirmSwitchOpen]);

  return {
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
  };
}