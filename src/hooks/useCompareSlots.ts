// src/hooks/useCompareSlots.ts
// "多方案对比"功能的独立state — 2026-09-21新增。分析模式下，除了既有的
// 主combo（`App.tsx`的`legs`，本功能里称"方案A"）之外，再挂最多2份完全
// 独立的候选combo（"方案B"/"方案C"），方便"同一个标的，该Buy Call还是
// Bull Call Spread还是Sell Put"这种决策场景——三条到期损益曲线叠加在
// PayoffChart上直接对比。
//
// 刻意的设计决定（跟xue确认过）：
// 1. 完全独立编辑，不是"以A为基础派生"——B/C各自一份从空白开始的legs，
//    不联动A的行权价/到期日变化。
// 2. 不接入isCompareMode（跟踪一个真实仓位）——两者是完全不同的场景，
//    App.tsx只在分析模式下渲染这套UI，见App.tsx里ComboCompareSlots的
//    调用点。
// 3. 不持久化进SavedStrategy——这是分析阶段"选哪个方案"的临时对比工具，
//    选定后照常把想要的那个方案的legs整个搬进主combo（A）走现有的保存
//    流程，B/C本身不单独存盘。
//
// 完全不碰`legs`/`trackedLegs`等既有state和它们背后的useLegEditing/
// useStrategyOrchestration——B/C是纯新增的、跟主流程解耦的state，不引入
// 额外的TDZ/时序风险。
import { useCallback, useState, type SetStateAction } from "react";
import type { Leg } from "@/lib/types";
import { uid, blankLeg } from "@/lib/legFactory";
import { nearestFridayDte } from "@/lib/dateUtils";
import { resolveFromCache } from "@/lib/optionChain";
import { estimateRescaledPremium } from "@/lib/pricing";

export interface CompareSlot {
  id: string;
  legs: Leg[];
  // 2026-09-24新增，配合"退出时按每个组合是否有未保存改动逐一提示"这轮改
  // 动——记录这个槽位"上一次被认为是干净状态"时的legs序列化快照：新建时
  // 是空数组的序列化结果，套用预设(applyPresetToSlot)/打开策略库
  // (applyStrategyToSlot)/成功保存(markSlotSaved)时都会刷新成当时的legs，
  // 跟A的`strategyBaseline`（App.tsx/useSavedStrategies.ts）是同一个思路，
  // 只是B/C没有独立的symbol/shifts/openingAt，只需要序列化legs本身。
  baseline: string;
}

// 跟savedStrategies.ts里`serializeStrategyState`用的是同一套字段/同一种
// 拼接方式，只是不包含symbol/shifts/openingAt——B/C槽位没有这几个独立的
// 概念（跟主combo共用同一个全局symbol/spot），"这个槽位是否被改动过"只取
// 决于legs本身有没有变化。刻意不直接复用`serializeStrategyState`（塞几个
// 占位参数进去凑参数表）：那样两处的"是否等价"判断就会隐式绑死在一起，以
// 后如果`serializeStrategyState`的字段列表变了，这里也要跟着改，但两者的
// 语义其实是独立的（一个包含symbol，一个不包含）。
export function serializeSlotLegs(legs: Leg[]): string {
  const norm = (l: Leg) => `${l.action}-${l.type}-${l.strike}-${l.dte}-${l.premium}-${l.kind ?? "option"}-${l.shares ?? 100}-${l.qty ?? 1}-${l.disabled ?? false}`;
  return legs.map(norm).join("|");
}

// 供App.tsx算"退出前要不要逐一提示保存"用：跟`serializeStrategyState`+
// `strategyBaseline`比较（A用的那一套）是同一个判断思路，这里是B/C专用
// 的等价版本。
export function isSlotDirty(slot: CompareSlot): boolean {
  return serializeSlotLegs(slot.legs) !== slot.baseline;
}

// A（主combo）之外最多再加2个——B/C。多了对比意义反而下降（曲线叠在一起
// 看不清），也是xue确认的"最多允许3份组合"里刨去A剩下的数量。
export const MAX_COMPARE_SLOTS = 2;
// 每个对比槽位最多4条腿——对比槽位设计给"一个干净的候选结构"用（单腿到
// 铁鹰这个量级），不是给它也堆到10条腿的主combo上限，避免误用成第二个
// 主combo。
export const MAX_COMPARE_SLOT_LEGS = 4;
// 跟PayoffChart.tsx里的compareCurves渲染一一对应的颜色，集中定义在这里
// 避免两处分别写死颜色值、以后改颜色要改两个地方。
export const COMPARE_SLOT_COLORS = ["#38bdf8", "#a78bfa"];

export function useCompareSlots() {
  const [compareSlots, setCompareSlots] = useState<CompareSlot[]>([]);

  const addCompareSlot = useCallback(() => {
    setCompareSlots((prev) => (prev.length >= MAX_COMPARE_SLOTS ? prev : [...prev, { id: uid(), legs: [], baseline: serializeSlotLegs([]) }]));
  }, []);

  const removeCompareSlot = useCallback((slotId: string) => {
    setCompareSlots((prev) => prev.filter((s) => s.id !== slotId));
  }, []);

  const addCompareSlotLeg = useCallback((slotId: string, strikeHint = 0) => {
    setCompareSlots((prev) => prev.map((s) =>
      s.id === slotId && s.legs.length < MAX_COMPARE_SLOT_LEGS ? { ...s, legs: [...s.legs, blankLeg(strikeHint)] } : s
    ));
  }, []);

  const updateCompareSlotLeg = useCallback((slotId: string, legId: string, patch: Partial<Leg>) => {
    setCompareSlots((prev) => prev.map((s) =>
      s.id === slotId ? { ...s, legs: s.legs.map((l) => (l.id === legId ? { ...l, ...patch } : l)) } : s
    ));
  }, []);

  const deleteCompareSlotLeg = useCallback((slotId: string, legId: string) => {
    setCompareSlots((prev) => prev.map((s) =>
      s.id === slotId ? { ...s, legs: s.legs.filter((l) => l.id !== legId) } : s
    ));
  }, []);

  const toggleCompareSlotLeg = useCallback((slotId: string, legId: string) => {
    setCompareSlots((prev) => prev.map((s) =>
      s.id === slotId ? { ...s, legs: s.legs.map((l) => (l.id === legId ? { ...l, disabled: !l.disabled } : l)) } : s
    ));
  }, []);

  // 清空所有对比槽位——换标的代码时用（跟主combo一样，换了symbol旧行权
  // 价就没意义了），见App.tsx的symbol-change effect。
  const clearCompareSlots = useCallback(() => {
    setCompareSlots([]);
  }, []);

  // 2026-09-22新增，配合"批量选择/全选/统一数量-行权价-到期日对A/B/C完
  // 全对等生效"这轮改动：一个跟`useState`的setter同形状的原始setter
  // （接受一个新值，或者一个`(prev) => next`的更新函数），喂给
  // `useLegBatchOps.ts`——那个hook是照着`useState`的`Dispatch<
  // SetStateAction<Leg[]>>`签名写的通用逻辑，不知道也不需要知道自己在
  // 操作的是哪个槽位，App.tsx用这个函数包一层「绑定到某个slotId」之后
  // 传给它，实现方式和`applyPresetToSlot`一样、不碰任何槽位以外的状态。
  const setCompareSlotLegs = useCallback((slotId: string, action: SetStateAction<Leg[]>) => {
    setCompareSlots((prev) => prev.map((s) =>
      s.id === slotId
        ? { ...s, legs: typeof action === "function" ? (action as (prev: Leg[]) => Leg[])(s.legs) : action }
        : s
    ));
  }, []);

  // 2026-09-22新增，配合"A/B/C完全对等"这一轮改动：点击容器把某个槽位
  // "激活"之后，策略库预设也要能直接填进B/C（xue的明确选择，见
  // AskUserQuestion确认记录），不用先"转正"成A。
  //
  // 没有直接复用App.tsx里`applyPreset`（useStrategyOrchestration.ts）——
  // 那个函数深度耦合"主combo正在持有的策略生命周期"（重置
  // trackedLegs/trackingStrategyId/activeSnapshotId/expiredConfirmed/
  // strategyBaseline等一整串state，还改legBaseSpot/legBaseSymbol/
  // spotManuallySet几个ref），这些语义只对"这是我正在分析/持有的那一个
  // 主combo"成立——B/C是临时候选方案，套用这些副作用是错的（比如应用一
  // 个预设到C，不该把用户正在追踪的真实持仓trackedLegs清空）。这里只借
  // `applyPreset`里"按当前现价缩放行权价/优先命中期权链缓存"那部分纯计
  // 算逻辑（applyPreset第221-249行），不碰任何跟主combo生命周期相关的
  // state，见CLAUDE.md/交接摘要里这轮讨论的记录。
  const applyPresetToSlot = useCallback((slotId: string, rawLegs: Leg[], spot: number, symbol: string) => {
    setCompareSlots((prev) => prev.map((s) => {
      if (s.id !== slotId) return s;
      const capped = rawLegs.slice(0, MAX_COMPARE_SLOT_LEGS);
      if (spot > 0) {
        const scale = spot / 100;
        const scaled = capped.map((l) => {
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
            premium: resolved ? resolved.premium : 0,
            dte: resolved ? resolved.dte : targetDte,
          };
        });
        return { ...s, legs: scaled, baseline: serializeSlotLegs(scaled) };
      }
      const finalLegs = capped.map((l) => ({ ...l, id: uid(), dte: l.kind === "stock" ? l.dte : nearestFridayDte(l.dte) }));
      return { ...s, legs: finalLegs, baseline: serializeSlotLegs(finalLegs) };
    }));
  }, []);

  // 2026-09-22新增：xue实测发现"策略库→打开"这个入口没有跟着"A/B/C完全
  // 对等"这轮一起改——不管当前激活的是不是B/C，"打开"永远写死操作A，行
  // 为跟之前修过的顶部工具栏"+"/清空是同一类bug（见App.tsx里
  // handleToolbarAddLeg/handleToolbarClear旁边的注释）。
  //
  // 这里没有直接复用上面的`applyPresetToSlot`——虽然表面都是"把一组腿位
  // 填进某个槽位"，但两者的缩放基准完全不同：`applyPresetToSlot`喂的是
  // `presets.ts`里的预设模板，那些腿位的行权价是按"现价=100"这个约定写
  // 死的相对值，所以用`spot/100`当缩放比例；而一条已保存的策略
  // （`SavedStrategy.legs`）是当初真实开仓时的绝对行权价，对应的基准现
  // 价是它自己的`s.spot`，不是100。缩放比例必须是`当前现价/s.spot`，跟
  // `App.tsx`里`rescaleForNewSymbol`换标的时用的是同一个比例算法（包括
  // 用`estimateRescaledPremium`给一个权利金占位估算值，命中不了期权链缓
  // 存时不像`applyPresetToSlot`那样直接置0）——两个函数如果硬共用一份实
  // 现，其中一个的语义就会被另一个的约定悄悄污染，所以保持独立。
  const applyStrategyToSlot = useCallback((slotId: string, rawLegs: Leg[], fromSpot: number, toSpot: number, symbol: string) => {
    setCompareSlots((prev) => prev.map((s) => {
      if (s.id !== slotId) return s;
      const capped = rawLegs.slice(0, MAX_COMPARE_SLOT_LEGS);
      const ratio = fromSpot > 0 ? toSpot / fromSpot : 1;
      const scaled = capped.map((l) => {
        if (l.kind === "stock") {
          return { ...l, id: uid(), strike: Math.round(toSpot * 100) / 100, shares: l.shares ?? 100 };
        }
        const targetDte = nearestFridayDte(l.dte);
        const targetStrike = Math.round(l.strike * ratio * 2) / 2;
        const resolved = symbol.trim() ? resolveFromCache(symbol.trim(), l.type, targetStrike, targetDte) : null;
        const estimatedPremium = fromSpot > 0 && l.premium > 0
          ? Math.max(0, estimateRescaledPremium(fromSpot, l, toSpot, targetStrike))
          : 0;
        return {
          ...l,
          id: uid(),
          strike: resolved ? resolved.strike : targetStrike,
          premium: resolved ? resolved.premium : estimatedPremium,
          dte: resolved ? resolved.dte : targetDte,
        };
      });
      return { ...s, legs: scaled, baseline: serializeSlotLegs(scaled) };
    }));
  }, []);

  // 2026-09-24新增，配合"退出时逐一提示"这轮改动：B/C的"保存策略组合"按
  // 钮（ComboCompareSlots.tsx，走App.tsx的handleSaveStrategyForActive）保
  // 存成功后调这个，把该槽位的baseline刷新成当前legs——不然保存完之后这
  // 个槽位仍然会被判定为"跟baseline不一致"（因为baseline还停在加载/新建
  // 那一刻），退出时明明刚保存过还会被当成未保存改动逐一提示。
  const markSlotSaved = useCallback((slotId: string) => {
    setCompareSlots((prev) => prev.map((s) =>
      s.id === slotId ? { ...s, baseline: serializeSlotLegs(s.legs) } : s
    ));
  }, []);

  return {
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
  };
}