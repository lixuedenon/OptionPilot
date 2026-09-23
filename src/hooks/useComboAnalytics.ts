// src/hooks/useComboAnalytics.ts
import { useMemo } from "react";
import type { Leg, Shifts } from "@/lib/types";
import { priceCombo, probabilityOfProfit, weightedAvgIV, impliedSpotFromPremiums, attributePnl, maxProfitLoss, resolveOpeningLeg } from "@/lib/pricing";
import { explainLegRoles } from "@/lib/legRoles";
import type { SavedStrategy } from "@/lib/savedStrategies";

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

// Pure-computation chain moved verbatim out of App.tsx (2026-09-08 file-size
// pass — see CLAUDE.md's "四、8" for why this was picked as the LOWER-risk
// of the two "intentionally not yet split" clusters, ahead of the ~300-line
// strategy-management useCallback cluster which stays in App.tsx for now).
//
// This is a pure relocation, not a rewrite: every useMemo below keeps its
// exact original body, comments and dependency array. The chain has real
// internal ordering dependencies (trackedResult depends on
// effectiveTrackedSpot which depends on impliedSpot, etc. — see CLAUDE.md's
// TDZ-risk note on App.tsx) that a call to this hook preserves automatically
// as long as it's called once, in one place, in App.tsx's render — it does
// NOT need to be called in any particular position relative to App.tsx's
// other hooks, since none of those other hooks feed values into this chain
// except through the params object below.
//
// Two closely-related values were deliberately left OUT of this hook and
// stay in App.tsx: `strategyName` (depends on customPresets/matchStrategy,
// an unrelated concern) and `canSaveStrategy` (depends on strategyBaseline,
// a piece of mutable state set by the strategy-management handlers that
// were NOT moved here) — both happened to be declared in the middle of this
// block in the original file, sitting between activeLegs/isCompareMode and
// result. App.tsx computes them itself, right after calling this hook, using
// this hook's `activeLegs` return value. The `showCompareGuide` useEffect
// that also used to sit in this block stays in App.tsx for the same reason
// (it touches showCompareGuide/compareGuideShown, App.tsx-local state).
export function useComboAnalytics(params: {
  legs: Leg[];
  // 2026-09-16新增：图表/归因的定价基准，跟`legs`分开传——`legs`（连同下
  // 面的`spot`/`shifts`）驱动的是activeLegs等一系列实时编辑状态（腿位列
  // 表渲染、保存按钮、预设名称匹配），永远是用户正在编辑的实时数据；这
  // 三个analytics*才是"ΔT滑块图表"实际用来定价的基准——分析模式下，只要
  // 调用方（App.tsx）能算出openingSimBasis（策略已加载、非对比模式），
  // 就统一传"开仓那天"的legs/spot、以及已经从"离今天几天"换算成"离开仓
  // 几天"的shifts，让整条ΔT轴的反推IV永远只在开仓那天做一次，不会因为
  // 滑块跨过"今天"这个参考点而突然切换基准出现跳变；没有openingSimBasis
  // 时（新建组合、对比模式）调用方直接传跟`legs`/`spot`/`shifts`相同的
  // 值，这几个memo的行为退化回原样。详见App.tsx里对应变量的大段注释。
  analyticsLegs: Leg[];
  analyticsSpot: number;
  analyticsShifts: Shifts;
  trackedLegs: Leg[] | null;
  trackedSpot: number | null;
  correctedSpot: number | null;
  trackedDaysElapsed: number;
  spot: number;
  shifts: Shifts;
  trackingStrategyId: string | null;
  savedStrategies: SavedStrategy[];
  t: TFunc;
}) {
  // params.shifts（实时ΔS/ΔT/ΔV，驱动腿位编辑区之外的旧"整体替换"用
  // 法）2026-09-16起不再被这个hook内部直接使用——图表/归因/健康度全部改
  // 用analyticsShifts（见上面params类型注释），这里故意不解构它，避免
  // 引入一个未使用的局部变量。仍然留在参数类型里，是因为App.tsx调用处
  // 传参对象字面量里两者都要给（historically一起传的一组"当前状态"），
  // 而不是这个hook还需要它。
  // params.t同理：健康度计算（computeHealth）删除后，这个hook内部已经
  // 不再需要t（i18n翻译函数）——不解构它。仍留在参数类型里，原因跟
  // shifts一样：App.tsx调用处历史上就是整组"当前状态"一起传的。
  const { legs, analyticsLegs, analyticsSpot, analyticsShifts, trackedLegs, trackedSpot, correctedSpot, trackedDaysElapsed, spot, trackingStrategyId, savedStrategies } = params;

  const activeLegs = useMemo(() => legs.filter((l) => !l.disabled), [legs]);
  // 图表定价基准的过滤版——见上面params类型里analyticsLegs的注释。跟
  // activeLegs分开是因为两者在strategy已加载、非对比模式时不是同一份
  // 数据（analyticsLegs此时是openingSimBasis.legs，activeLegs是实时编辑
  // 腿位）。
  const activePricingLegs = useMemo(() => analyticsLegs.filter((l) => !l.disabled), [analyticsLegs]);
  const activeTrackedLegs = useMemo(() => trackedLegs?.filter((l) => !l.disabled) ?? null, [trackedLegs]);
  const isCompareMode = trackedLegs !== null;

  const result = useMemo(() => priceCombo(activePricingLegs, analyticsShifts, analyticsSpot), [activePricingLegs, analyticsShifts, analyticsSpot]);

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

  const { pop, breakevens } = useMemo(() => probabilityOfProfit(activeLegs, spot), [activeLegs, spot]);

  // Analysis-mode P/L attribution — same attributePnl() used in tracking
  // mode, just fed the slider's own dS/dT/dV instead of a tracked-vs-
  // opening comparison. The sliders ARE the price/time/IV shift already;
  // result.change is already the combo's total change under exactly those
  // shifts, so this is a direct reuse, not new pricing logic. Only shown
  // once at least one slider has actually moved — at rest all four numbers
  // are zero and there's nothing useful to attribute.
  //
  // 2026-09-16改用activePricingLegs/analyticsSpot/analyticsShifts：这个
  // "全为0就是静止、不归因"的判断本身不用改（真正原地不动、没有任何位
  // 移时确实无可归因）——只是它现在收到的analyticsShifts.dT语义已经是
  // "离开仓过了几天"（不是旧坐标"离今天几天"），所以只有真正落在开仓那
  // 一刻才会命中，"今天"（此时dT=daysSinceOpen，通常不为0）不会再被误
  // 判成静止。见App.tsx里analyticsShifts的大段注释。
  const analysisAttribution = useMemo(() => {
    if (isCompareMode || activePricingLegs.length === 0 || analyticsSpot <= 0) return null;
    if (analyticsShifts.dS === 0 && analyticsShifts.dT === 0 && analyticsShifts.dV === 0) return null;
    return attributePnl(activePricingLegs, analyticsSpot, analyticsShifts.dS, analyticsShifts.dT, analyticsShifts.dV, result.change);
  }, [isCompareMode, activePricingLegs, analyticsSpot, analyticsShifts, result]);

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
      // 2026-09-14 bug fix: this used to compare raw per-contract premiums
      // with no `qty` multiplier at all — correct only for qty=1, and
      // silently understating (or overstating, for a rolled leg whose size
      // changed) every multi-contract position's P&L by a factor of qty.
      // Stayed invisible for a long time because nothing else in the app
      // cross-checked this number against an independently-computed P&L —
      // until situationExplainer.ts's legPnlSinceOpen (which does multiply
      // by qty, same convention as legShiftedPrice/legGreekBreakdown in
      // pricing.ts for option legs) started disagreeing with it for any
      // leg with qty > 1. Uses the CURRENT tracked leg's qty for both sides
      // of the comparison (same convention as legPnlSinceOpen) rather than
      // openingLeg's — they're normally equal, and there's no well-defined
      // meaning for "half of this leg's opening cost" if a roll changed the
      // size. Stock legs stay unscaled (no `shares` multiplier), matching
      // legShiftedPrice's own stock branch and its comment on why.
      const qty = leg.kind === "stock" ? 1 : (leg.qty ?? 1);
      const shifted = leg.kind === "stock" ? sign * (currentSpot - leg.strike) : sign * qty * leg.premium;
      const base = openingLeg
        ? openingLeg.kind === "stock"
          ? openingSign * (spot - openingLeg.strike)
          : openingSign * qty * openingLeg.premium
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

  // Sum of `closedPnl` across ALL trackedLegs (not just activeTrackedLegs —
  // a closed leg is by definition disabled, so it would never show up in
  // that filtered list) — the P&L already booked from legs the person has
  // 平仓'd or rolled away from (see types.ts's `closedPnl` and
  // TrackedComboSection.tsx's realizedPnl prop). Deliberately NOT folded
  // into `trackedResult.change` above: that field also feeds PayoffChart's
  // tracked curve (via App.tsx's `netChange` prop) and pnlAttribution's
  // price/time/IV decomposition, and xue chose to update the P&L summary
  // numbers only, not reshape the chart — see CLAUDE.md's "四、3.6".
  const realizedTrackedPnl = useMemo(() => {
    if (!trackedLegs) return 0;
    return trackedLegs.reduce((sum, l) => sum + (l.closedPnl ?? 0), 0);
  }, [trackedLegs]);

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

  return {
    activeLegs,
    activeTrackedLegs,
    isCompareMode,
    result,
    scenarioPriceById,
    impliedSpot,
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
  };
}