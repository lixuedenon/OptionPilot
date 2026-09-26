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

// Everything App.tsx used to call the "策略管理" cluster — moved here
// verbatim, 2026-09-08 (second file-size pass, after useComboAnalytics.ts).
// CLAUDE.md flags this as the HIGHER-risk of the two "intentionally not yet
// split" clusters (historically the highest bug-density code in the whole
// project — handlers calling each other, sharing a dozen+ refs/setters, and
// several of them reaching forward into applyPreset/doClearAll/
// saveTrackedSnapshotTo/performSwitchToAnalysis, which used to be declared
// later in the same file). Bundling ALL of it — the combo-mutation helpers
// (addLeg/applyPreset/clearAllLegs/doClearAll/updateTrackedLeg/
// handleCorrectSpot/comboDirection/handleAddCustom/handleAddToSimAccount)
// together with the strategy-persistence/mode-switch handlers
// (handleSaveStrategy...handleSwitchToAnalysis) into ONE hook, in their
// original relative order, is what makes this a pure relocation rather than
// a re-architecture: every forward reference between them (e.g.
// handleSaveStrategy calling applyPreset) still resolves the exact same way
// it did as sibling consts in App.tsx, because they're still sibling consts
// — just in this file instead. Every ref (legBaseSpot/legBaseSymbol/
// spotManuallySet/pendingPreset/pendingPresetReplace/pendingLeaveAfterSave/
// pendingSaveTrackedAfterStrategy/pendingSwitchSource) is created in App.tsx
// and passed straight through by reference — since a ref is the same mutable
// object wherever it's held, App.tsx's own JSX and effects keep reading/
// writing the identical object this hook mutates, with nothing to sync.
// 2026-09-17：computeOpeningSimBasis本身搬去savedStrategies.ts导出了（见
// 那边的完整注释）——App.tsx现在用它做一个实时useMemo，每次渲染都用当前
// legs/spot/openingAt重算，不再是只在保存/加载时刷新一次的state，修复了
// "情景估值跟不上实时编辑"的bug。这个hook里剩下的几个调用点
// （handleOpenStrategy）只是用它检查"这条策略是否已过期"
// （expiredStrategyPrompt），不再需要`setOpeningSimBasis`这个state setter。

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
  // Compare mode's "开仓组合" date field lets the user preview a
  // hypothetical opening date without touching the real, persisted
  // `openingAt` — see LegListSection.tsx's date field and CLAUDE.md's bug
  // notes (2026-09-14, xue: "只是临时让用户模拟不同的日期...不要保存这些
  // 信息"). Reset to null (falls back to the real openingAt) at every mode
  // switch / (re)load / save below — a stray non-null value surviving past
  // one of those points would be a bug, not a feature.
  setOpeningAtSimOverride: React.Dispatch<React.SetStateAction<number | null>>;
  // 打开一条策略时，如果发现"真实经过天数"已经超过它第0天的完整周期
  // （说明这条策略现实中已经过了真正的到期日），App.tsx据此弹一个"已过
  // 期，删除还是保留"的确认框。null=不弹。
  setExpiredStrategyPrompt: React.Dispatch<React.SetStateAction<SavedStrategy | null>>;
  // 2026-09-17新增，配合上面的setExpiredStrategyPrompt：真正长期驱动"是
  // 否已过期"这个结论的显式state（见App.tsx里的大段注释——不能靠每次渲
  // 染从live legs反推，那个反推一旦legs.dte被钳到0就会失真）。
  // handleOpenStrategy/handleTrack在加载那一刻用未被钳过的原始s.legs算
  // 一次并存进来，此后"保留"这条策略不会再丢失这个结论；doClearAll/加
  // 载一条未过期的新策略/重新以当下为基准进入分析模式时清回false。
  setExpiredConfirmed: React.Dispatch<React.SetStateAction<boolean>>;
  // 2026-09-17新增：跟踪一条已经过了真实到期日的策略时弹出的提示——对比
  // 模式没有"保留"这个选项（没有真实行情可比对，跟踪这个动作本身就没意
  // 义），只提示+一个"确定"按钮，点击后直接删除这条策略，不像
  // expiredStrategyPrompt（分析模式"打开策略"用）那样还有keep分支。
  // null=不弹。
  setExpiredTrackPrompt: React.Dispatch<React.SetStateAction<SavedStrategy | null>>;
  setCorrectedSpot: React.Dispatch<React.SetStateAction<number | null>>;
  setCorrecting: React.Dispatch<React.SetStateAction<boolean>>;
  // Tracked combo
  isCompareMode: boolean;
  trackedLegs: Leg[] | null;
  trackedSpot: number | null;
  // 2026-09-25起，trackedDirty不再是一个手动维护的state——App.tsx用
  // serializeTrackedLegs(trackedLegs) !== trackedBaseline现算，这里仍然
  // 当一个普通只读boolean接进来用（handleSwitchToAnalysis/clearAllLegs的
  // 判断逻辑不用变），但"标脏"这半件事不再需要任何人显式调用，"标干净"
  // 那半件事改成调用下面的setTrackedBaseline，见它自己的注释。
  trackedDirty: boolean;
  effectiveTrackedSpot: number;
  setTrackedLegs: React.Dispatch<React.SetStateAction<Leg[] | null>>;
  setTrackedSpot: React.Dispatch<React.SetStateAction<number | null>>;
  setTrackedDaysElapsed: React.Dispatch<React.SetStateAction<number>>;
  // 取代原来的setTrackedDirty(false)——把"此刻视为已保存"那一份
  // trackedLegs的指纹存起来（null表示尚未进入/已经离开对比模式，此时无
  // 论trackedLegs是什么，App.tsx那边的派生判断都直接短路成false，不看这
  // 个值）。见savedStrategies.ts的serializeTrackedLegs。
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
  // 2026-09-23修复：override参数——App.tsx的handleToolbarAddToSim（B/C对比槽
  // 位激活时）需要把该槽位自己的legs/spot/symbol/openingAt喂进来，而不是
  // 无条件用这个hook自己作用域里的activeLegs/spot/symbol/openingAt（那些
  // 永远是A容器的数据）。之前这个函数签名是`async () => {...}`，不接受任
  // 何参数，App.tsx那边传参会被TypeScript报"Expected 0 arguments"、运行
  // 时又被JS静默丢弃——B/C槽位点"加入模拟账户"实际加的还是A的内容，是一
  // 个typecheck能抓、但build/eslint都抓不出来的真实bug（vite build不做类
  // 型检查，见CLAUDE.md"一、验证手段"）。override不传时（A容器）行为完
  // 全不变。
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
    // trackedDirty不再在这里手动置true——App.tsx现在用serializeTrackedLegs
    // 现算trackedLegs跟trackedBaseline的差异，这次setTrackedLegs调用本身
    // 已经足够让派生判断自动感知到。见savedStrategies.ts的
    // serializeTrackedLegs注释。
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

  // Shared by handleSaveTracked's normal path and its "save the strategy
  // first, then attach the snapshot" fallback below — appends trackedLegs
  // as a new TrackedSnapshot on the given (already-saved) strategy id.
  //
  // 2026-09-12: also PERMANENTLY LOCKS every roll/protect/hedge-derived leg
  // (`derivedFrom` set) that's part of this save — see types.ts's comment on
  // `derivedFrom.locked`. Locking has to happen HERE, on the exact array
  // handed to addTrackedSnapshot, not as a separate follow-up setTrackedLegs
  // call afterward: the snapshot stores whatever leg objects it's given, so
  // if the lock were only applied to the live trackedLegs post-hoc, a
  // snapshot saved a moment earlier would still contain unlocked
  // derivedFrom legs — and reopening THAT snapshot later (handleTrack/
  // handleSelectSnapshot copy a past snapshot's legs back into trackedLegs
  // verbatim aside from id/dte) would resurrect an undo option for an
  // action that was supposedly already locked in. Baking the lock into the
  // same array that both gets saved AND becomes the new live trackedLegs
  // keeps the two in sync by construction, not by remembering to update
  // both. Already-locked legs are left alone (no-op) rather than
  // re-spread, purely to avoid a pointless new object identity on every
  // save for legs that didn't change.
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
    // 保存成功=这份lockedLegs现在就是"已保存"的基准，记下它的指纹而不是
    // 简单置一个布尔值——2026-09-25修复见savedStrategies.ts的
    // serializeTrackedLegs注释。
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
    // 2026-09-17新增：对比模式的核心就是"开仓组合 vs 今日组合"这两份真实
    // 数据的比较——如果这条策略的真实到期日已经过去，压根就没有"今日真
    // 实行情"可言（合约在市场上已经不存在了），"跟踪"这个动作本身就没
    // 有意义。所以这里先用原始、未做任何dte衰减/钳0处理的s.legs判断一
    // 次，过期就直接弹"无法追踪，将删除"的单按钮提示框、不做任何状态变
    // 更就return——不像分析模式的"打开策略"那样还有"保留"选项（那边是纯
    // 本地模拟，不依赖真实数据，历史复盘仍有意义，见App.tsx里
    // expiredTrackPrompt的注释）。只有真的没过期，才往下走原来那一整套
    // 进入对比模式的逻辑。
    {
      const legsAsOfTs = s.legsAsOf ?? s.openingAt ?? s.createdAt;
      const basis = computeOpeningSimBasis(s.openingAt ?? s.createdAt, legsAsOfTs, s.legs, s.spot);
      if (basis.daysSinceOpen > basis.originalMaxDte) {
        // "跟踪"这个按钮就在"管理策略"弹窗里点的，这个弹窗本来要到下面
        // （未过期）分支最后才会关——这里提前return之前必须自己关掉，否
        // 则两个fixed inset-0的弹窗会叠在一起，"管理策略"挡在上面，新弹
        // 出的过期提示点不到（Playwright实测发现的）。
        setManageStrategyOpen(false);
        setExpiredTrackPrompt(s);
        return;
      }
    }
    // 2026-09-08 bug: dte is stored relative to "today" at whatever moment
    // it was last set, and LegRow's date column (dateFromDte) always reads
    // it as "today + dte" — so a leg's dte must be decayed by however many
    // calendar days have passed since it was recorded, or its DISPLAYED
    // absolute expiry date silently drifts forward by that many days every
    // time it's reopened later (the actual contract's expiry never moves).
    // trackedLegs already got this treatment everywhere it's derived
    // (below, and in handleSelectSnapshot/handleUpdateSnapshotTime) — this
    // `legs` (opening combo) assignment was the one place that copied
    // s.legs's dte verbatim with no decay, which is what made "打开策略"/
    // 跟踪's "开仓组合" row show the wrong expiry date days after saving.
    //
    // 2026-09-14: decay basis switched from `s.openingAt` to `s.legsAsOf ??
    // s.openingAt` (legsDecayDays) — see SavedStrategy.legsAsOf's doc
    // comment and CLAUDE.md"六、24". `s.legs` is only accurate "as of"
    // legsAsOf (when it was last saved); decaying it by days-since-the-
    // TRUE-opening (openingAt, which never advances) double-counted
    // whatever had already been decayed into `s.legs` on a prior save,
    // compounding worse with every save→reopen cycle. `openDaysElapsed`
    // (days since the real opening) is kept as its own variable, used only
    // for `setTrackedDaysElapsed`'s "已过X天" stat below — that one SHOULD
    // stay tied to the real opening date, not to when legs were last saved.
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
    // 2026-09-25新增：两条分支各自算出的trackedLegs也是这次新的"已保存"
    // 基准（handleTrack一进对比模式，trackedLegs跟这条基准天然一致，不
    // 该被判定成"有未保存改动"）——用一个函数体内的局部变量接住两条分支
    // 各自算出的数组，分支结束后统一往下算一次指纹，不在每条分支里重复
    // 这行。
    let newTrackedLegsForBaseline: Leg[];
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

  // 2026-09-12 added a handleUpdateOpeningAt here to let "开仓组合 (对比
  // 基准)"'s date field (LegListSection.tsx) persist a correction to the
  // strategy's real openingAt. Removed 2026-09-14: xue clarified that
  // field should NOT persist any edit at all — it's a temporary "what if
  // this had opened on a different date" preview, local to the current
  // session only, discarded on mode switch or save (see
  // App.tsx/LegListSection.tsx's openingAtSimOverride). The real, persisted
  // `openingAt` is only ever set at handleSaveStrategy/handleOverwriteStrategy
  // time now (from analysis mode), same as before this 2026-09-12 detour.

  const handleOpenStrategy = useCallback((s: SavedStrategy) => {
    // Same dte-decay fix as handleTrack above — without this, "打开策略"
    // re-loads s.legs's dte verbatim, and since LegRow always renders the
    // expiry date as "today + dte", the displayed date silently drifts
    // forward by however many days have passed since this strategy was
    // saved (the real contract's expiry doesn't move; only "days left"
    // should shrink). 2026-09-14: basis is `legsAsOf` (when legs were last
    // saved), not `openingAt` (when the position truly opened) — see
    // SavedStrategy.legsAsOf's doc comment and CLAUDE.md"六、24".
    const daysElapsed = calendarDaysSince(s.legsAsOf ?? s.openingAt ?? s.createdAt);
    setSymbol(s.symbol);
    // 2026-09-17修复：每条腿的新id只生成一次（`freshIds`），`setLegs`和下
    // 面喂给`computeOpeningSimBasis`的快照必须用同一份id——之前两边各自
    // 调用`uid()`，`openingSimBasis.legs`（喂给`analyticsLegs`→图表定价基
    // 准，见"四、1.9"）的id和live `legs`状态的id永远对不上，导致
    // `scenarioPriceById.get(leg.id)`（`LegListSection.tsx`按id查每条腿的
    // "情景估值"）查不到任何东西，每条腿的情景估值方块整体消失（xue用真
    // 实持仓发现）。
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

    // 2026-09-17修正：这里原来的注释说"App.tsx会用实时legs重算
    // openingSimBasis，不用把结果存起来"——这个假设是错的，是个刚发现的
    // bug：上面setLegs写进去的dte经过了Math.max(0, 原始dte-已衰减天数)钳
    // 到0，一旦这条策略真的已经过期（钳到了0），"到底提前过期了多少天"
    // 这个信息就被永久抹掉了，之后App.tsx每次渲染用live（已被钳过的）
    // legs反推originalMaxDte都会得到严重偏大的结果，"已过期"这个结论在
    // 这次一次性判断对了、弹了确认框之后，用户点"保留"的下一次渲染就会
    // 立刻变回false——图表变暗提示条、以及LegRow"已过期禁止刷新市场价"
    // 的保护，实际上都不会生效（Playwright测出来的，见App.tsx里
    // expiredConfirmed state的大段注释）。所以现在必须把这次用未被钳过
    // 的原始s.legs算出的结论存进expiredConfirmed这个显式state，不能再依
    // 赖之后的实时重算。
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
    // 见handleTrack里同名变量的注释——两条分支各自算出的trackedLegs就是
    // 这次新的"已保存"基准。
    let newTrackedLegsForBaseline: Leg[];
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
      newTrackedLegsForBaseline = latestSnap.legs.map((l) => ({
        ...l,
        id: uid(),
        dte: l.kind === "stock" ? l.dte : Math.max(0, l.dte - snapshotDecay),
      }));
      setTrackedLegs(newTrackedLegsForBaseline);
      setTrackedSpot(latestSnap.spot);
      setActiveSnapshotId(latestSnap.id);
    } else {
      // No tracked history yet (brand-new combo, or matched a strategy that
      // was only ever "saved", never tracked). This does NOT mean zero days
      // have elapsed for the "已过X天" STAT — `openingAt` can genuinely be
      // in the past (a saved strategy opened days ago via "打开策略", or a
      // hand-edited 开仓日期) — so `daysElapsed` below is still needed for
      // `setTrackedDaysElapsed`.
      //
      // 2026-09-13 bug (regression of the 2026-09-04 one described below):
      // `legs` here is the live analysis-mode array — whatever populated it
      // (handleOpenStrategy/handleTrack's own `s.legs.dte - daysElapsed`
      // decay, or a leg freshly typed in analysis mode) already leaves
      // `l.dte` correct AS OF TODAY, because that's exactly what analysis
      // mode's date column (dateFromDte = today + dte) is showing on screen
      // right now. Subtracting `daysElapsed` again here decayed it a SECOND
      // time — e.g. handleOpenStrategy sets legs.dte = s.legs.dte -
      // daysElapsed, then this line computed legs.dte - daysElapsed AGAIN,
      // i.e. s.legs.dte - 2*daysElapsed — silently undercounting the
      // tracked leg's remaining days (sometimes clamped all the way to 0,
      // making "持仓组合" show today's date as a bogus 到期日) while the
      // untouched `legs`/开仓组合 row kept showing the correct expiry. This
      // is exactly what the top-of-function comment above already promised
      // ("trackedLegs starts as an exact copy of legs with no DTE
      // reduction") — the code just didn't match that comment. Fixed by
      // actually doing what the comment says: copy `l.dte` as-is.
      //
      // (Old 2026-09-04 bug, still relevant context: before that fix this
      // branch hardcoded daysElapsed-independent zero, so both stat boxes —
      // LegListSection's 开仓组合 summary and TrackedComboSection's 持仓组合
      // grid, which share this same `effectiveDaysElapsed` — always showed
      // "已过0天" even when the opening date was days in the past. That part
      // of the fix (deriving `daysElapsed` from `openingAt` for the STAT)
      // was correct and is kept; only the dte-math reuse of the same number
      // was wrong.)
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
    // 2026-09-17新增：source==="current"或某个快照时，newOpeningAt变成了
    // "现在"或"那个快照的保存时刻"——相当于从这一刻起重新定义了一个全新
    // 的开仓基准，它自己的到期周期从这一刻才开始算，不可能"还没开始就已
    // 经过期"，所以要把expiredConfirmed清掉；source==="baseline"时开仓
    // 组合/openingAt完全没变，还是原来那条真实持仓，是否真的过期这个结
    // 论不该受切换模式本身影响，保持不变。
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