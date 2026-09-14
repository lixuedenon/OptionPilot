// src/lib/situationExplainer.ts
import type { Leg, Shifts } from "./types";
import type { ComboResult, PnlAttribution } from "./pricing";
import { maxProfitLoss, impliedVol, resolveOpeningLeg } from "./pricing";
import type { HealthResult } from "./positionHealth";

// Local alias instead of importing useI18n's type from I18nContext.tsx — same
// convention as positionHealth.ts: this file has no React/JSX in it and
// shouldn't pull a component module in just for a function type.
type TFunc = (key: string, vars?: Record<string, string | number>) => string;

export interface ExplainSection {
  title: string;
  body: string;
}

export interface SituationExplanation {
  headline: string;
  sections: ExplainSection[];
}

// Everything here is rule-based/local — no AI call, no network request (xue's
// explicit choice, 2026-09-09: "规则模板，本地即时生成"). It's built entirely
// out of numbers this app already computes elsewhere (priceCombo/positionHealth/
// attributePnl/maxProfitLoss), the same "no new pricing math" approach
// positionHealth.ts itself documents — this module only adds lightweight
// classification (which zone a P&L sits in, whether delta/DTE/breakeven
// distance crosses a threshold worth flagging) on top of already-computed
// values. Suggestions in the "可以怎么处理" section only ever point at
// features that already exist in the app (Roll/Hedge/Protect/Compare) — never
// a specific buy/sell/direction call (xue's other explicit choice: "只指向
//已有功能"). All display text goes through `t` — nothing here is a hardcoded
// literal in either language.

const DTE_HINT_THRESHOLD = 21; // same tastytrade-style convention SimulatorPage.tsx's DTE_ALERT_THRESHOLD uses
const HIGH_DELTA_THRESHOLD = 0.7; // matches positionHealth.ts's own "bad" boundary for avg delta per contract
const LOW_DELTA_THRESHOLD = 0.3; // matches positionHealth.ts's own "good" boundary for avg delta per contract
const BREAKEVEN_HINT_THRESHOLD = 3; // percent — a supplementary trigger for the action-hint section, deliberately a bit looser than positionHealth's own 2%/8% good/bad band since this is "worth a mention", not itself a score

// ── "怎么办"建议系统（2026-09-13/14 对话定稿，取代对比模式下的
// explainTrackedPosition）──
//
// 按"腿角色"而不是策略名分类：同一张表覆盖所有同形状的命名策略——比如
// "信用价差"这张表同时覆盖Bull Put Spread/Bear Call Spread，也覆盖铁鹰/
// 铁蝶拆开后的每一条独立价差（铁鹰=两条互不相关的信用价差，不需要专门的
// 铁鹰表）。裸卖出单腿 + 信用价差 + 借方价差 + 卖出跨式/宽跨式是目前完整
// 设计并测试过的四张表；日历/对角价差、买入跨式/宽跨式、蝶式、比率价差
// 等还没有专属表，遇到这些形状退化成"posAdvice.notImplementedBody"占位
// 文案，不瞎猜规则。
//
// 明确排除在这套规则判断范围之外（xue的明确要求，不是遗漏）：支撑/压力位
// 判断、财报等已知事件择时、账户保证金、跨持仓组合的相关性风险——这四项
// 永远留给用户自己判断。
//
// 每条判断依据的具体数值门槛，都是这几轮对话里用真实场景手工验证过的
// 初始值，不是精确计算出来的，将来有真实历史数据回测后应该重新校准：
const NEAR_EXPIRY_MAX_DTE = 7; // "临近到期"的绝对天数上限
const NEAR_EXPIRY_PCT = 0.15; // 同时看总时长的15%，两者取较小值——避免短线/周度交易开仓还没过一半就被误判"临近到期"
const NEAR_MONEY_PCT = 5; // 现价距行权价的百分比，在这个范围内算"贴着行权价"
const PROFIT_AHEAD_MIN_PCT = 50; // "50%法则"：利润达到最大利润的这个比例……
const PROFIT_AHEAD_MARGIN_PCT = 20; // ……而且比已流逝时间的比例领先这么多百分点，才算"跑得比时间快"，避免临近到期时单纯因为时间流逝到位而误报
const VERTICAL_DANGER_LOSS_PCT = 70; // 信用价差：亏损占最大亏损的比例达到此值，判"危险"
const VERTICAL_DANGER_LOSS_PCT_BOTH_BREACHED = 40; // 两个行权价都被突破时危险阈值降到这里——不能单看"突破"，窄价差稍微碰一下两边就会触发误报，必须搭配这道次要门槛
const DEBIT_STOP_LOSS_PCT = 50; // 借方价差：亏损占已付权利金（最大亏损）的比例达到此值，判"止损"
const DEBIT_NEAR_EXPIRY_PROFIT_PCT = 80; // 借方价差临近到期时，利润占最大利润的比例达到此值才算"已接近满仓盈利"，否则判"空间没打开"
const DEBIT_PROFIT_TAKE_PCT = 70; // 借方价差未临近到期时，利润提前达到这个比例，建议止盈了结
const DEBIT_EARLY_PROFIT_PCT = 40; // 借方价差"早期利润超前"提示的利润门槛……
const DEBIT_EARLY_PROFIT_ELAPSED_PCT = 20; // ……且时间只过了这么多，才算"涨/跌得比时间快"
const VELOCITY_ABNORMAL_RATIO = 1.5; // 实际波动幅度 ÷ 开仓IV隐含的预期波动幅度，达到此比值判"速度异常"，需要提醒用户自行判断是持续/反转/横盘

function fmtSigned(n: number, digits = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

type PnlZone = "nearMaxProfit" | "profit" | "nearMaxLoss" | "loss" | "flat";

function classifyPnl(change: number, maxProfit: number, maxLoss: number): { zone: PnlZone; pct: number } {
  if (Math.abs(change) < 0.01) return { zone: "flat", pct: 0 };
  if (change > 0) {
    const pct = maxProfit > 0 ? (change / maxProfit) * 100 : 0;
    return { zone: pct >= 70 ? "nearMaxProfit" : "profit", pct };
  }
  // maxLoss is itself negative (it's a PnL value), so change/maxLoss is positive when both are negative
  const pct = maxLoss < 0 ? (change / maxLoss) * 100 : 0;
  return { zone: pct >= 70 ? "nearMaxLoss" : "loss", pct };
}

function pnlBody(t: TFunc, zone: PnlZone, change: number, pct: number): string {
  const changeStr = fmtSigned(change, 0);
  switch (zone) {
    case "nearMaxProfit":
      return t("explain.pnlBodyNearMaxProfit", { change: changeStr, pct: pct.toFixed(0) });
    case "profit":
      return t("explain.pnlBodyProfit", { change: changeStr, pct: pct.toFixed(0) });
    case "nearMaxLoss":
      return t("explain.pnlBodyNearMaxLoss", { change: changeStr, pct: pct.toFixed(0) });
    case "loss":
      return t("explain.pnlBodyLoss", { change: changeStr, pct: pct.toFixed(0) });
    default:
      return t("explain.pnlBodyFlat", { change: changeStr });
  }
}

function deltaBody(t: TFunc, avgDelta: number): string {
  const a = Math.abs(avgDelta);
  const deltaStr = fmtSigned(avgDelta);
  const key = a >= HIGH_DELTA_THRESHOLD ? "explain.deltaBodyHigh" : a >= LOW_DELTA_THRESHOLD ? "explain.deltaBodyModerate" : "explain.deltaBodyLow";
  return t(key, { delta: deltaStr });
}

function avgDeltaPerContract(legs: Leg[], netDelta: number): number {
  const totalQty = legs.reduce((sum, l) => sum + (l.kind === "stock" ? 1 : (l.qty ?? 1)), 0);
  return totalQty > 0 ? netDelta / totalQty : netDelta;
}

// Nearest breakeven distance as a % of the given spot — breakevens themselves
// are shift-invariant (structural property of strikes/premiums only, see
// findBreakevens in pricing.ts), only which spot we measure distance from
// changes between analysis mode (shifted spot) and compare mode (today's spot).
function nearestBreakevenPct(breakevens: number[], atSpot: number): number | null {
  if (breakevens.length === 0 || atSpot <= 0) return null;
  return (Math.min(...breakevens.map((be) => Math.abs(atSpot - be))) / atSpot) * 100;
}

// Analysis mode: DTE remaining AFTER the slider's time shift — mirrors
// positionHealth.ts's buildShiftedLegs dte adjustment (that function itself
// is private/non-exported, so this is a minimal standalone re-derivation of
// just the dte part, not a duplicate of its premium-repricing logic).
function minShiftedDte(legs: Leg[], dT: number): number | null {
  const optionLegs = legs.filter((l) => l.kind !== "stock");
  if (optionLegs.length === 0) return null;
  return Math.min(...optionLegs.map((l) => Math.max(0, Math.round(l.dte - dT))));
}

function minDte(legs: Leg[]): number | null {
  const optionLegs = legs.filter((l) => l.kind !== "stock");
  if (optionLegs.length === 0) return null;
  return Math.min(...optionLegs.map((l) => l.dte));
}

// Deliberately NOT re-listing each of health.factors here (xue's explicit
// call, 2026-09-09: this used to copy PositionHealthBadge.tsx's popover
// content verbatim — POP/breakeven-distance/DTE/delta shown twice, word for
// word, in two different UI surfaces). This section now carries only the
// score plus health's own synthesized one-line summary (already rolls up
// which factors are bad/warning — see positionHealth.ts's buildSummary) and
// a pointer back to the badge for the four-factor breakdown, which stays
// the single source of truth for that detail. The standalone "方向暴露"
// section built by deltaBody() below is NOT redundant with this any more —
// it's the only delta-specific content left in this dialog.
function healthSections(t: TFunc, health: HealthResult | null): ExplainSection[] {
  if (!health) return [];
  return [
    {
      title: t("explain.healthTitle"),
      body: t("explain.healthSummaryBody", { score: String(health.score), summary: health.summary }),
    },
  ];
}

// Shared tail of both explainers: Roll/Hedge/Protect are available from both
// the opening combo (analysis mode) and today's combo (compare mode, see
// TrackedComboSection.tsx's onRoll/onHedge/onProtect), so those three hints
// are worded identically either way. Decision Compare ("决策对比") is
// analysis-mode only (see CLAUDE.md's "五、2" — TrackedComboSection.tsx
// never gets an onCompare prop), so the near-max-profit/loss hints — the
// only ones that would naturally reach for it — get a mode-specific pair of
// keys instead.
function actionHints(t: TFunc, params: {
  isCompareMode: boolean;
  dte: number | null;
  avgDelta: number;
  breakevenPct: number | null;
  zone: PnlZone;
  pct: number;
}): string {
  const { isCompareMode, dte, avgDelta, breakevenPct, zone, pct } = params;
  const hints: string[] = [];

  if (dte !== null && dte <= DTE_HINT_THRESHOLD) {
    hints.push(t("explain.actionDte", { dte: dte.toFixed(0) }));
  }
  if (Math.abs(avgDelta) >= HIGH_DELTA_THRESHOLD) {
    hints.push(t("explain.actionDelta", { delta: fmtSigned(avgDelta) }));
  }
  if (breakevenPct !== null && breakevenPct < BREAKEVEN_HINT_THRESHOLD) {
    hints.push(t("explain.actionBreakeven", { pct: breakevenPct.toFixed(1) }));
  }
  if (zone === "nearMaxProfit") {
    hints.push(t(isCompareMode ? "explain.actionNearMaxProfitCompare" : "explain.actionNearMaxProfitAnalysis", { pct: pct.toFixed(0) }));
  }
  if (zone === "nearMaxLoss") {
    hints.push(t(isCompareMode ? "explain.actionNearMaxLossCompare" : "explain.actionNearMaxLossAnalysis", { pct: pct.toFixed(0) }));
  }

  return hints.length > 0 ? hints.join(" ") : t("explain.actionNone");
}

// Analysis mode: explains what the CURRENT SLIDER POSITION means — a
// forward-looking scenario rehearsal, same framing as help.moduleAnalysisIntro.
export function explainAnalysisScenario(params: {
  legs: Leg[];
  spot: number;
  shifts: Shifts;
  result: ComboResult;
  health: HealthResult | null;
  attribution: PnlAttribution | null;
  breakevens: number[];
  t: TFunc;
}): SituationExplanation | null {
  const { legs, spot, shifts, result, health, attribution, breakevens, t } = params;
  const active = legs.filter((l) => !l.disabled);
  if (active.length === 0 || spot <= 0) return null;

  const shiftedSpot = Math.max(0.01, spot + shifts.dS);
  const spotPct = spot > 0 ? (shifts.dS / spot) * 100 : 0;
  const { maxProfit, maxLoss } = maxProfitLoss(active, spot);
  const { zone, pct } = classifyPnl(result.change, maxProfit, maxLoss);
  const avgDelta = avgDeltaPerContract(active, result.breakdown.delta);

  const sections: ExplainSection[] = [
    {
      title: t("explain.scenarioTitle"),
      body: t("explain.scenarioBody", {
        spot: shiftedSpot.toFixed(2),
        spotChange: fmtSigned(shifts.dS),
        spotPct: fmtSigned(spotPct, 1) + "%",
        days: shifts.dT.toFixed(0),
        vol: fmtSigned(shifts.dV, 0) + "%",
      }),
    },
    { title: t("explain.pnlTitle"), body: pnlBody(t, zone, result.change, pct) },
  ];

  if (attribution) {
    sections.push({
      title: t("explain.attributionTitle"),
      body: t("explain.attributionBody", {
        price: fmtSigned(attribution.priceEffect, 0),
        time: fmtSigned(attribution.timeEffect, 0),
        iv: fmtSigned(attribution.ivEffect, 0),
      }),
    });
  }

  sections.push({ title: t("explain.deltaTitle"), body: deltaBody(t, avgDelta) });
  sections.push(...healthSections(t, health));
  sections.push({
    title: t("explain.actionsTitle"),
    body: actionHints(t, {
      isCompareMode: false,
      dte: minShiftedDte(active, shifts.dT),
      avgDelta,
      breakevenPct: nearestBreakevenPct(breakevens, shiftedSpot),
      zone,
      pct,
    }),
  });

  return {
    headline: t("explain.headlineAnalysis", { spot: shiftedSpot.toFixed(2), days: shifts.dT.toFixed(0) }),
    sections,
  };
}

// ── 建议系统的计算helper ──

function nearExpiryThreshold(totalDte: number): number {
  return Math.min(NEAR_EXPIRY_MAX_DTE, totalDte * NEAR_EXPIRY_PCT);
}

// 一条腿从开仓到现在的浮动/已实现盈亏，只做"当前权利金 - 开仓权利金"的
// 直接相减——回答的是"从开仓到现在已经发生了什么"，不是legGreekBreakdown/
// priceCombo那套"如果情景再变化会怎样"的推演机制，两者是不同的问题，不能
// 混用（这也是为什么这里不复用result.perLeg[i].change.total）。
function legPnlSinceOpen(leg: Leg, openLeg: Leg): number {
  const sign = leg.action === "buy" ? 1 : -1;
  const qty = leg.qty ?? 1;
  return sign * qty * (leg.premium - openLeg.premium);
}

// 现价相对开仓价的位移，跟这条腿开仓时的隐含波动率算出的"1个标准差预期
// 位移"相比——用来判断这段位移是不是"异常速度"（消息/跳空驱动），而不是
// 正常的时间流逝。返回null表示条件不足以判断（刚开仓当天，或开仓价缺失）。
function velocityRatio(openLeg: Leg, openSpot: number, currentSpot: number, daysElapsed: number): number | null {
  if (daysElapsed <= 0 || openSpot <= 0) return null;
  const openIV = impliedVol(openSpot, openLeg.strike, openLeg.dte, openLeg.premium, openLeg.type);
  const expectedMovePct = openIV * Math.sqrt(daysElapsed / 365) * 100;
  if (expectedMovePct <= 0) return null;
  const actualMovePct = (Math.abs(currentSpot - openSpot) / openSpot) * 100;
  return actualMovePct / expectedMovePct;
}

function velocityNote(t: TFunc, ratio: number | null): string {
  if (ratio === null || ratio < VELOCITY_ABNORMAL_RATIO) return "";
  return " " + t("posAdvice.velocityAbnormal", { ratio: ratio.toFixed(1) });
}

// 从result.perLeg里读取这条腿"现在"的每张合约delta——这是合法复用（读的是
// 零情景偏移下的真实当前希腊字母，不是拿"情景推演"机制去算"从开仓到现在
// 变化了多少"，见legPnlSinceOpen的注释）。找不到时返回0，调用方据此会落到
// "正常持有"分支而不是误判危险，是刻意选择的保守方向。
function legDeltaMag(leg: Leg, result: ComboResult): number {
  const entry = result.perLeg.find((p) => p.leg.id === leg.id);
  if (!entry) return 0;
  const qty = leg.qty ?? 1;
  return Math.abs(entry.change.delta) / qty;
}

// 盈亏占最大盈利/最大亏损的百分比标签，找不到对应分母（比如裸卖出没有
// maxLoss——风险无限）时返回null，调用方就只显示金额、不硬凑一个百分比。
function pctLabelFor(t: TFunc, pnl: number, maxProfit: number, maxLoss: number | null): string | null {
  if (pnl > 0 && maxProfit > 0) return t("posAdvice.pctOfMaxProfit", { pct: ((pnl / maxProfit) * 100).toFixed(0) });
  if (pnl < 0 && maxLoss !== null && maxLoss !== 0) return t("posAdvice.pctOfMaxLoss", { pct: ((pnl / maxLoss) * 100).toFixed(0) });
  return null;
}

// "描述"分句——大白话说清楚过了多久、现在盈亏多少，中性措辞（"目前盈亏
// {pnl}"配合fmtSigned自带的+/-号），不预设是盈是亏，避免像早期设计草稿
// 里发现的那个bug：模板文字硬编码"浮盈"，遇到实际浮亏的场景就读不通。
function descClause(t: TFunc, days: number, elapsedPct: number, pnl: number, pctLabel: string | null): string {
  const vars = { days: days.toFixed(0), elapsedPct: elapsedPct.toFixed(0), pnl: fmtSigned(pnl, 0) };
  return pctLabel !== null
    ? t("posAdvice.descWithPct", { ...vars, pctLabel })
    : t("posAdvice.descNoPct", vars);
}

// "正常持有"分支专用的子句——2026-09-14 xue反馈原来共用的posAdvice.holdBody
// ("目前没有需要特别处理的信号")太糊弄，四张表各自的"正常持有"落点改成
// 引用实际算出的数字（delta/亏损占比/利润占比/距到期天数）对照各自的判断
// 门槛，而不是一句空泛套话。这个子句只处理"利润进度"这一部分（有没有浮
// 盈、离提前止盈线还差多少），因为这是唯一一个"没有浮盈时提都不该提"的
// 分支——其余（delta/亏损占比/距到期天数）在四张表里数值本来就总是有意义
// 的，直接嵌进各自的holdBodyXxx模板里，不需要单独抽子句。
function profitProgressClause(t: TFunc, pnl: number, profitPct: number): string {
  return pnl > 0
    ? t("posAdvice.profitProgressClause", { pct: profitPct.toFixed(0) })
    : t("posAdvice.profitProgressClauseNone");
}

function placeholderSection(t: TFunc, label: string): ExplainSection {
  return { title: label, body: t("posAdvice.notImplementedBody") };
}

// 裸卖出单腿（没有配对保护腿的卖出Call/Put）——5态优先级表：危险 > 临近
// 到期贴着行权价 > 利润提前 > 被测试(+速度异常叠加) > 正常持有。
function nakedShortAdvice(params: {
  leg: Leg;
  openLeg: Leg | undefined;
  trackedSpot: number;
  openSpot: number;
  daysElapsed: number;
  result: ComboResult;
  t: TFunc;
}): ExplainSection {
  const { leg, openLeg, trackedSpot, openSpot, daysElapsed, result, t } = params;
  const label = t(leg.type === "call" ? "posAdvice.legLabelShortCall" : "posAdvice.legLabelShortPut", { strike: leg.strike });
  if (!openLeg) return placeholderSection(t, label);

  const qty = leg.qty ?? 1;
  const pnl = legPnlSinceOpen(leg, openLeg);
  const maxProfit = qty * openLeg.premium; // 裸卖出的最大盈利就是收到的全部权利金；最大亏损无限，不设分母
  const totalDte = daysElapsed + leg.dte;
  const elapsedPct = totalDte > 0 ? (daysElapsed / totalDte) * 100 : 0;
  const threshold = nearExpiryThreshold(totalDte);
  const deltaMag = legDeltaMag(leg, result);
  const nearMoney = trackedSpot > 0 && (Math.abs(trackedSpot - leg.strike) / trackedSpot) * 100 <= NEAR_MONEY_PCT;
  const profitPct = pnl > 0 && maxProfit > 0 ? (pnl / maxProfit) * 100 : 0;
  const dirKey = leg.type === "call" ? "Call" : "Put";
  const desc = descClause(t, daysElapsed, elapsedPct, pnl, pctLabelFor(t, pnl, maxProfit, null));

  if (deltaMag >= HIGH_DELTA_THRESHOLD) {
    return { title: label, body: `${desc} ${t(`posAdvice.dangerBody${dirKey}`, { delta: deltaMag.toFixed(2) })}` };
  }
  if (leg.dte <= threshold && nearMoney) {
    return { title: label, body: `${desc} ${t(`posAdvice.nearExpiryBody${dirKey}`, { dte: leg.dte.toFixed(0) })}` };
  }
  if (profitPct >= PROFIT_AHEAD_MIN_PCT && profitPct - elapsedPct >= PROFIT_AHEAD_MARGIN_PCT) {
    return { title: label, body: `${desc} ${t("posAdvice.profitAheadBody", { pct: profitPct.toFixed(0) })}` };
  }
  if (deltaMag >= LOW_DELTA_THRESHOLD) {
    const ratio = velocityRatio(openLeg, openSpot, trackedSpot, daysElapsed);
    return { title: label, body: `${desc} ${t("posAdvice.testedBody", { delta: deltaMag.toFixed(2) })}${velocityNote(t, ratio)}` };
  }
  return {
    title: label,
    body: `${desc} ${t("posAdvice.holdBodyNaked", {
      delta: deltaMag.toFixed(2),
      profitClause: profitProgressClause(t, pnl, profitPct),
      dte: leg.dte.toFixed(0),
    })}`,
  };
}

// 垂直价差（1条卖出+1条买入，同类型同到期日，行权价不同）——信用/借方
// 两条分支共用一个入口，靠开仓时两条腿的权利金比较来分流（哪条收得多）。
function verticalSpreadAdvice(params: {
  sellLeg: Leg;
  buyLeg: Leg;
  openSellLeg: Leg | undefined;
  openBuyLeg: Leg | undefined;
  trackedSpot: number;
  openSpot: number;
  daysElapsed: number;
  t: TFunc;
}): ExplainSection {
  const { sellLeg, buyLeg, openSellLeg, openBuyLeg, trackedSpot, openSpot, daysElapsed, t } = params;
  const label = t("posAdvice.legLabelVertical", {
    type: t(sellLeg.type === "call" ? "posAdvice.call" : "posAdvice.put"),
    sellStrike: sellLeg.strike,
    buyStrike: buyLeg.strike,
  });
  if (!openSellLeg || !openBuyLeg) return placeholderSection(t, label);

  const qty = sellLeg.qty ?? 1;
  const openCredit = openSellLeg.premium - openBuyLeg.premium;
  const isCredit = openCredit >= 0;
  const currentValue = sellLeg.premium - buyLeg.premium;
  const pnl = qty * (openCredit - currentValue);

  const { maxProfit, maxLoss } = maxProfitLoss([openSellLeg, openBuyLeg], openSpot);
  const totalDte = daysElapsed + sellLeg.dte;
  const elapsedPct = totalDte > 0 ? (daysElapsed / totalDte) * 100 : 0;
  const threshold = nearExpiryThreshold(totalDte);
  const remainingDte = sellLeg.dte;
  const lossPct = pnl < 0 && maxLoss !== 0 ? (pnl / maxLoss) * 100 : 0;
  const profitPct = pnl > 0 && maxProfit !== 0 ? (pnl / maxProfit) * 100 : 0;
  const desc = descClause(t, daysElapsed, elapsedPct, pnl, pctLabelFor(t, pnl, maxProfit, maxLoss));

  if (isCredit) {
    const lo = Math.min(sellLeg.strike, buyLeg.strike);
    const hi = Math.max(sellLeg.strike, buyLeg.strike);
    const bothBreached = sellLeg.type === "call" ? trackedSpot > hi : trackedSpot < lo;
    const tested = sellLeg.type === "call" ? trackedSpot > sellLeg.strike : trackedSpot < sellLeg.strike;
    const nearMoney = trackedSpot > 0 && (Math.abs(trackedSpot - sellLeg.strike) / trackedSpot) * 100 <= NEAR_MONEY_PCT;

    if (lossPct >= VERTICAL_DANGER_LOSS_PCT || (bothBreached && lossPct >= VERTICAL_DANGER_LOSS_PCT_BOTH_BREACHED)) {
      return { title: label, body: `${desc} ${t("posAdvice.verticalCreditDangerBody", { pct: lossPct.toFixed(0) })}` };
    }
    if (remainingDte <= threshold && nearMoney) {
      return { title: label, body: `${desc} ${t("posAdvice.verticalNearExpiryBody", { dte: remainingDte.toFixed(0) })}` };
    }
    if (profitPct >= PROFIT_AHEAD_MIN_PCT && profitPct - elapsedPct >= PROFIT_AHEAD_MARGIN_PCT) {
      return { title: label, body: `${desc} ${t("posAdvice.profitAheadBody", { pct: profitPct.toFixed(0) })}` };
    }
    if (tested) {
      const ratio = velocityRatio(openSellLeg, openSpot, trackedSpot, daysElapsed);
      return { title: label, body: `${desc} ${t("posAdvice.verticalCreditTestedBody")}${velocityNote(t, ratio)}` };
    }
    return {
      title: label,
      body: `${desc} ${t("posAdvice.holdBodyVerticalCredit", {
        lossPct: lossPct.toFixed(0),
        spot: trackedSpot.toFixed(2),
        strike: sellLeg.strike,
        profitClause: profitProgressClause(t, pnl, profitPct),
        dte: remainingDte.toFixed(0),
      })}`,
    };
  }

  // 借方价差：止损 > 临近到期(已近满仓盈利 / 空间没打开) > 利润提前达标
  // (终值70% > 早期40%+时间≤20%) > 正常持有
  if (lossPct >= DEBIT_STOP_LOSS_PCT) {
    return { title: label, body: `${desc} ${t("posAdvice.debitStopLossBody", { pct: lossPct.toFixed(0) })}` };
  }
  if (remainingDte <= threshold) {
    return profitPct >= DEBIT_NEAR_EXPIRY_PROFIT_PCT
      ? { title: label, body: `${desc} ${t("posAdvice.debitNearExpiryProfitBody", { dte: remainingDte.toFixed(0) })}` }
      : { title: label, body: `${desc} ${t("posAdvice.debitNearExpiryOpenBody", { dte: remainingDte.toFixed(0) })}` };
  }
  if (profitPct >= DEBIT_PROFIT_TAKE_PCT) {
    return { title: label, body: `${desc} ${t("posAdvice.debitProfitTakeBody", { pct: profitPct.toFixed(0) })}` };
  }
  if (profitPct >= DEBIT_EARLY_PROFIT_PCT && elapsedPct <= DEBIT_EARLY_PROFIT_ELAPSED_PCT) {
    return { title: label, body: `${desc} ${t("posAdvice.debitEarlyProfitBody", { pct: profitPct.toFixed(0) })}` };
  }
  return {
    title: label,
    body: `${desc} ${t("posAdvice.holdBodyVerticalDebit", {
      lossPct: lossPct.toFixed(0),
      profitPct: profitPct.toFixed(0),
      dte: remainingDte.toFixed(0),
    })}`,
  };
}

// 卖出跨式/宽跨式（1条卖call + 1条卖put，数量相等）——组合级处理，不拆成
// 两条独立的裸卖单腿。5态优先级表跟信用价差同一个骨架，但危险判断沿用
// 裸卖单腿的delta阈值而不是价差那种"亏损占比"——两条腿都是裸卖，风险
// 无限，没有真实的maxLoss分母可用。两条腿允许到期日不同（比如后来只
// 展期了其中一条腿）：用两条腿里较早到期的那个驱动"临近到期"判断；每条
// 腿各自独立解析自己的开仓数据（resolveOpeningLeg），被展期过的那条腿
// 自动用它展期那一刻记录的新开仓价，不需要额外写"展期未测试腿"的特殊
// 逻辑——这一点手工测试过（原call未动+put展期到新行权价/新到期日后，
// 盈亏和状态判断都正确）。
function shortStrangleAdvice(params: {
  callLeg: Leg;
  putLeg: Leg;
  openCallLeg: Leg | undefined;
  openPutLeg: Leg | undefined;
  trackedSpot: number;
  openSpot: number;
  daysElapsed: number;
  result: ComboResult;
  t: TFunc;
}): ExplainSection {
  const { callLeg, putLeg, openCallLeg, openPutLeg, trackedSpot, openSpot, daysElapsed, result, t } = params;
  const label = t("posAdvice.legLabelShortStrangle", { callStrike: callLeg.strike, putStrike: putLeg.strike });
  if (!openCallLeg || !openPutLeg) return placeholderSection(t, label);

  const qty = callLeg.qty ?? 1;
  const pnl = legPnlSinceOpen(callLeg, openCallLeg) + legPnlSinceOpen(putLeg, openPutLeg);
  // 最大盈利=两条腿开仓时收到的权利金之和（两条腿各自按自己的开仓数据
  // 算，展期过的那条腿自然反映展期那一刻的新净收权利金）；最大亏损无限
  // （两侧都是裸卖），不设分母。
  const maxProfit = qty * (openCallLeg.premium + openPutLeg.premium);
  const remainingDte = Math.min(callLeg.dte, putLeg.dte);
  const totalDte = daysElapsed + remainingDte;
  const elapsedPct = totalDte > 0 ? (daysElapsed / totalDte) * 100 : 0;
  const threshold = nearExpiryThreshold(totalDte);
  const profitPct = pnl > 0 && maxProfit > 0 ? (pnl / maxProfit) * 100 : 0;
  const desc = descClause(t, daysElapsed, elapsedPct, pnl, pctLabelFor(t, pnl, maxProfit, null));

  const callDeltaMag = legDeltaMag(callLeg, result);
  const putDeltaMag = legDeltaMag(putLeg, result);
  const callNearMoney = trackedSpot > 0 && (Math.abs(trackedSpot - callLeg.strike) / trackedSpot) * 100 <= NEAR_MONEY_PCT;
  const putNearMoney = trackedSpot > 0 && (Math.abs(trackedSpot - putLeg.strike) / trackedSpot) * 100 <= NEAR_MONEY_PCT;
  const callBreached = trackedSpot > callLeg.strike;
  const putBreached = trackedSpot < putLeg.strike;

  if (callDeltaMag >= HIGH_DELTA_THRESHOLD || putDeltaMag >= HIGH_DELTA_THRESHOLD) {
    const dirKey = callDeltaMag >= putDeltaMag ? "Call" : "Put";
    const delta = dirKey === "Call" ? callDeltaMag : putDeltaMag;
    return { title: label, body: `${desc} ${t(`posAdvice.strangleDangerBody${dirKey}`, { delta: delta.toFixed(2) })}` };
  }
  if (remainingDte <= threshold && (callNearMoney || putNearMoney)) {
    return { title: label, body: `${desc} ${t("posAdvice.strangleNearExpiryBody", { dte: remainingDte.toFixed(0) })}` };
  }
  if (profitPct >= PROFIT_AHEAD_MIN_PCT && profitPct - elapsedPct >= PROFIT_AHEAD_MARGIN_PCT) {
    return { title: label, body: `${desc} ${t("posAdvice.profitAheadBody", { pct: profitPct.toFixed(0) })}` };
  }
  if (callBreached || putBreached) {
    const dirKey = callBreached ? "Call" : "Put";
    const testedLeg = callBreached ? callLeg : putLeg;
    const openTestedLeg = callBreached ? openCallLeg : openPutLeg;
    const ratio = velocityRatio(openTestedLeg, openSpot, trackedSpot, daysElapsed);
    return { title: label, body: `${desc} ${t(`posAdvice.strangleTestedBody${dirKey}`, { strike: testedLeg.strike })}${velocityNote(t, ratio)}` };
  }
  return {
    title: label,
    body: `${desc} ${t("posAdvice.holdBodyStrangle", {
      callDelta: callDeltaMag.toFixed(2),
      putDelta: putDeltaMag.toFixed(2),
      spot: trackedSpot.toFixed(2),
      callStrike: callLeg.strike,
      putStrike: putLeg.strike,
      profitClause: profitProgressClause(t, pnl, profitPct),
      dte: remainingDte.toFixed(0),
    })}`,
  };
}

// Compare mode: "该怎么办"——取代原来的explainTrackedPosition（纯状态
// 描述）。按腿角色分类而不是策略名：每条active option leg按"同类型
// (call/put)腿数"分组——1条且是卖出→裸卖出单腿表；2条且同到期日/不同
// 方向/不同行权价→干净的垂直价差配对（信用/借方内部再分流，铁鹰/铁蝶的
// 两条价差会各自独立地在这里配对成功，不需要专门写"铁鹰"逻辑）；其余
// 形状（3条以上、日历/对角、跨式/宽跨式、蝶式等）本轮还没有专属表，退化
// 成占位文案，不瞎猜规则。正股腿同样占位。健康度徽章是独立UI元素，不在
// 这里重复展示。1条卖call+1条卖put（数量相等）优先按"卖出跨式/宽跨式"
// 组合级处理，不走下面按类型分组、各自独立配对的逻辑——这条判断必须在
// 分call/put处理之前做，否则两条腿会先被各自的类型分组各自识别成"1条
// 裸卖单腿"，永远轮不到组合级表。
export function explainTrackedPositionAdvice(params: {
  legs: Leg[];
  openingLegs: Leg[] | null;
  trackedSpot: number;
  openingSpot: number;
  daysElapsed: number;
  result: ComboResult;
  t: TFunc;
}): SituationExplanation | null {
  const { legs, openingLegs, trackedSpot, openingSpot, daysElapsed, result, t } = params;
  const active = legs.filter((l) => !l.disabled);
  if (active.length === 0 || trackedSpot <= 0) return null;

  const openingById = new Map((openingLegs ?? []).map((l) => [l.id, l]));
  const resolveOpen = (leg: Leg): Leg | undefined =>
    openingLegs ? resolveOpeningLeg(leg, active.indexOf(leg), openingLegs, openingById) : undefined;

  const sections: ExplainSection[] = [];
  const stockLegCount = active.filter((l) => l.kind === "stock").length;
  for (let i = 0; i < stockLegCount; i++) {
    sections.push(placeholderSection(t, t("posAdvice.legLabelStock")));
  }

  const callGroup = active.filter((l) => l.kind !== "stock" && l.type === "call");
  const putGroup = active.filter((l) => l.kind !== "stock" && l.type === "put");
  const isShortStrangleShape =
    callGroup.length === 1 && putGroup.length === 1 &&
    callGroup[0].action === "sell" && putGroup[0].action === "sell" &&
    (callGroup[0].qty ?? 1) === (putGroup[0].qty ?? 1);

  if (isShortStrangleShape) {
    const callLeg = callGroup[0];
    const putLeg = putGroup[0];
    sections.push(shortStrangleAdvice({
      callLeg, putLeg,
      openCallLeg: resolveOpen(callLeg), openPutLeg: resolveOpen(putLeg),
      trackedSpot, openSpot: openingSpot, daysElapsed, result, t,
    }));
  } else {
    for (const type of ["call", "put"] as const) {
      const group = type === "call" ? callGroup : putGroup;
      if (group.length === 0) continue;

      if (group.length === 1) {
        const leg = group[0];
        if (leg.action === "sell") {
          sections.push(nakedShortAdvice({ leg, openLeg: resolveOpen(leg), trackedSpot, openSpot: openingSpot, daysElapsed, result, t }));
        } else {
          const key = leg.type === "call" ? "posAdvice.legLabelLongCall" : "posAdvice.legLabelLongPut";
          sections.push(placeholderSection(t, t(key, { strike: leg.strike })));
        }
        continue;
      }

      if (group.length === 2) {
        const [a, b] = group;
        if (a.dte === b.dte && a.action !== b.action && a.strike !== b.strike) {
          const sellLeg = a.action === "sell" ? a : b;
          const buyLeg = a.action === "sell" ? b : a;
          sections.push(verticalSpreadAdvice({
            sellLeg, buyLeg,
            openSellLeg: resolveOpen(sellLeg), openBuyLeg: resolveOpen(buyLeg),
            trackedSpot, openSpot: openingSpot, daysElapsed, t,
          }));
          continue;
        }
      }

      // 3条及以上、或2条但配不成干净的垂直价差（比如日历/对角、蝶式）——
      // 本轮还没有各自的表，逐条占位。
      for (const leg of group) {
        const key = leg.action === "sell"
          ? (leg.type === "call" ? "posAdvice.legLabelShortCall" : "posAdvice.legLabelShortPut")
          : (leg.type === "call" ? "posAdvice.legLabelLongCall" : "posAdvice.legLabelLongPut");
        sections.push(placeholderSection(t, t(key, { strike: leg.strike })));
      }
    }
  }

  return {
    headline: t("explain.headlineCompare", { days: daysElapsed.toFixed(0) }),
    sections,
  };
}