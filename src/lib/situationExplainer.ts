// src/lib/situationExplainer.ts
import type { Leg, Shifts } from "./types";
import type { ComboResult } from "./pricing";
import { maxProfitLoss, impliedVol, resolveOpeningLeg } from "./pricing";
import type { HealthResult } from "./positionHealth";
import { bearCallSpreadTable, type SupportedLang, type BearCallAction } from "./bearCallSpreadTable";
import { bullPutSpreadTable } from "./bullPutSpreadTable";

// Local alias instead of importing useI18n's type from I18nContext.tsx — same
// convention as positionHealth.ts: this file has no React/JSX in it and
// shouldn't pull a component module in just for a function type.
type TFunc = (key: string, vars?: Record<string, string | number>) => string;

// 图表上的提示条/当前盈亏点颜色用的信号（2026-09-19，取代PayoffChart.tsx
// 里那套按净收权利金比例算的旧getZone——那套东西跟这里的540格表各算各
// 的，同一个仓位能给出两个不一样的判断。只有走到540格表的两个信用价差
// 函数（bearCallSpreadAdvice/bullPutSpreadAdvice）会给出这个信号：危险
// 覆盖分支（zone0/1且亏损≥70%最大亏损）算stopLoss；查表分支按表里本来
// 就有、之前一直被`[, cellDesc, cellAdvice]`这个解构丢掉的action字段
// 换算——CLOSE按当前盈亏正负分成takeProfit/stopLoss，MONITOR算monitor，
// HOLD/WAIT不给信号（不提示）。裸卖单腿/借方价差/跨式/占位这些形状目前
// 没有专属表，不产出这个信号——图表那边对应的提示/色带就不显示，不用旧
// 公式硬凑一个。
export type AlertSeverity = "takeProfit" | "stopLoss" | "monitor";

function severityFromAction(action: BearCallAction, pnl: number): AlertSeverity | undefined {
  if (action === "CLOSE") return pnl >= 0 ? "takeProfit" : "stopLoss";
  if (action === "MONITOR") return "monitor";
  return undefined;
}

export interface ExplainSection {
  title: string;
  body: string;
  // 只给图表提示条用的精简文案+信号——跟body（弹窗里给人读的完整解释，包
  // 含"开仓到现在过了几天/目前盈亏多少"这段描述）分开存，避免弹窗文案变
  // 长后banner跟着变长。两者都没有时，这条section不驱动任何图表提示。
  severity?: AlertSeverity;
  alertBody?: string;
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

const HIGH_DELTA_THRESHOLD = 0.7; // matches positionHealth.ts's own "bad" boundary for avg delta per contract
const LOW_DELTA_THRESHOLD = 0.3; // matches positionHealth.ts's own "good" boundary for avg delta per contract

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
const VERTICAL_DANGER_LOSS_PCT = 70; // 信用价差：亏损占最大亏损的比例达到此值，判"危险"（call/put的540格表和这里的借方价差分支共用同一个数）
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

// Analysis mode: builds the "shifted" (scenario) leg clone the leg-role
// advice functions (below) expect as their current-state leg argument —
// same premium/dte convention explainTrackedPositionAdvice's tracked legs
// already use, just repriced under the slider's shift instead of real
// elapsed calendar time. Reuses result.perLeg (already computed by the
// caller via priceCombo — see this file's "no new pricing math" note up
// top) instead of calling blackScholes again: perLeg[].shifted is
// legShiftedPrice's sign/qty-adjusted output (newPrice * sign * qty — see
// pricing.ts), so dividing back out by (sign*qty) recovers the plain
// per-contract price this file's advice functions all expect in
// `.premium`. The clone deliberately keeps the SAME `id` as the entered
// leg — buildLegAdviceSections' resolveOpen looks the "opening" leg up by
// that id (see explainAnalysisScenario below).
function shiftLegForAdvice(leg: Leg, shifts: Shifts, spot: number, result: ComboResult): Leg {
  if (leg.kind === "stock") return { ...leg }; // stock legs only ever hit placeholderSection below, shape doesn't matter
  const entry = result.perLeg.find((p) => p.leg.id === leg.id);
  const sign = leg.action === "buy" ? 1 : -1;
  const qty = leg.qty ?? 1;
  const newDte = Math.max(0, leg.dte - shifts.dT);
  const shiftedPremium = entry ? entry.shifted / (sign * qty) : leg.premium;
  return { ...leg, dte: newDte, premium: shiftedPremium };
}

// Analysis mode: explains what the CURRENT SLIDER POSITION means — a
// forward-looking scenario rehearsal, same framing as help.moduleAnalysisIntro.
export function explainAnalysisScenario(params: {
  legs: Leg[];
  spot: number;
  shifts: Shifts;
  result: ComboResult;
  health: HealthResult | null;
  lang: SupportedLang;
  t: TFunc;
}): SituationExplanation | null {
  const { legs, spot, shifts, result, health, lang, t } = params;
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

  sections.push({ title: t("explain.deltaTitle"), body: deltaBody(t, avgDelta) });
  sections.push(...healthSections(t, health));

  // "怎么办"：完全复用对比模式的buildLegAdviceSections（定义见下方）——
  // 2026-09-18 xue明确要求"两套解释内容不需要老版本了，只保留现在最新的
  // 多情况样板版本"：分析模式原来自己那套通用阈值提示（dte/delta/距盈亏
  // 平衡点距离/是否接近最大盈亏——旧的actionHints函数，已整个删除，连同
  // 只给它用的DTE_HINT_THRESHOLD/BREAKEVEN_HINT_THRESHOLD/minShiftedDte/
  // nearestBreakevenPct一起）现在完全换成跟对比模式一模一样的按腿角色分类
  // 建议：能配对成裸卖单腿/信用价差(540格)/借方价差/卖出跨式的，给对应的
  // 具体建议；配不成的形状（3条腿以上、日历/对角、纯买方单腿等）用
  // buildLegAdviceSections自己的占位文案（posAdvice.notImplementedBody），
  // 不再退回旧版通用提示——跟对比模式完全一致，不存在两套并行的解释内容。
  //
  // 分析模式没有真实的"开仓腿"/"当前腿"两份独立数据——只有滑块位移前的
  // entered legs和位移后的情景——所以这里把entered legs当"开仓"
  // （resolveOpen按id查回原始leg），再用shiftLegForAdvice（上面）算出情景
  // 位移后的"当前腿"克隆去跑同一套分类逻辑。
  const openingById = new Map(active.map((l) => [l.id, l]));
  const shiftedLegs = active.map((l) => shiftLegForAdvice(l, shifts, spot, result));
  const resolveOpen = (leg: Leg): Leg | undefined => openingById.get(leg.id);
  sections.push(...buildLegAdviceSections({
    active: shiftedLegs,
    resolveOpen,
    trackedSpot: shiftedSpot,
    openSpot: spot,
    daysElapsed: shifts.dT,
    result,
    lang,
    t,
  }));
  sections.push({ title: t("posAdvice.caveatTitle"), body: t("posAdvice.caveatBody") });

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
// 2026-09-14修复：descClause显示的pnl是0位小数（fmtSigned(pnl,0)），但这
// 里算百分比用的是未取整的原始pnl——pnl是+0.42这种小额浮盈时，会读成
// "目前盈亏+0（占最大盈利的16%）"，两个数字各自没错，放一起却像自相矛
// 盾。pnl取整后等于0时（Math.round与toFixed(0)取整口径一致），直接不给
// 百分比标签，只留金额，避免这种读起来矛盾的措辞（见CLAUDE.md"六、25"）。
function pctLabelFor(t: TFunc, pnl: number, maxProfit: number, maxLoss: number | null): string | null {
  if (Math.round(pnl) === 0) return null;
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

// ── 信用价差（熊市Call价差 + 牛市Put价差）专用，540行审查表（2026-09-18）──
//
// 原本信用价差是"按腿角色不分策略名"共用一套5态逻辑（不分call/put）。
// xue针对熊市Call价差（卖100call/买110call）逐条审查了540种（5个价格区×
// 9个时间段×12个盈亏档）组合并给出了具体建议文案，颗粒度远细于原来的5态
// 判断。牛市Put价差（卖100put/买90put）的540格内容是从熊市Call价差那份
// 审查过的内容程序化镜像过去的（见bullPutSpreadTable.ts开头注释）——除了
// 5个价格区的标题数字/大小关系按新的行权价重新算过、以及1处提到"裸空正
// 股仓位"的措辞按put的指派机制改成"裸多"之外，540格里逐条的desc/advice
// 原文没有改动（原文本来就是用"短腿/长腿"这种相对措辞写的，没有硬编码
// call还是put、也没有硬编码具体点位数字，可以直接复用）。**牛市Put价差
// 这份内容没有像熊市Call价差那样经过xue的逐条人工复核**，只跑过下面这条
// 已知问题的同一套修复逻辑，如果之后发现新的具体问题，用xue审查熊市Call
// 价差时同样的方式（分组交叉核对）来查。
//
// 已知且刻意绕开的表内缺陷（两个方向共有）：540格里"深盈区"和"近盈利区"
// （两腿虚值/短腿刚触及平值，两个结构上最安全的价格区）的浮亏格，除了
// "刚开仓"那一档，其余8个时间段一律是"止损离场"，不看亏损到底多大——跟
// 这两个区自己的"结构安全"描述矛盾（详见bearCallSpreadTable.ts开头注
// 释）。下面这两个区的亏损分支不走表格，改成统一的70%止损线
// （VERTICAL_DANGER_LOSS_PCT，call/put共用同一个阈值）。其余格子（两个
// 安全区的盈利格、以及中间偏空/中间偏多/深亏区这三个短腿已经被测试或实
// 值的区）照表格原文，因为问题只出在这两个安全区的止损判断上。

const BEAR_CALL_PERIOD_BOUNDARIES = [15, 25, 35, 45, 55, 65, 75, 85, 100]; // 与periodLabels的9档一一对应，elapsedPct落进第一个>=它的档

function classifyBearCallPeriod(elapsedPct: number): number {
  for (let i = 0; i < BEAR_CALL_PERIOD_BOUNDARIES.length; i++) {
    if (elapsedPct <= BEAR_CALL_PERIOD_BOUNDARIES[i]) return i;
  }
  return BEAR_CALL_PERIOD_BOUNDARIES.length - 1;
}

// zone1"近盈利区"的边界宽度：540行原文档举的例子是卖100/买110（价差宽度
// 10），"≈100"这个近盈利区紧贴着100、"中间偏空"才是100-105那一大段。如果
// 直接套用nakedShortAdvice那套按标的价格算的NEAR_MONEY_PCT（5%×100=5），
// 近盈利区的带宽会跟"中间偏空"整个撞在一起（100±5=95-105，比中间偏空自己
// 的100-105还宽）。近盈利区的带宽改成按价差宽度（|buyStrike-sellStrike|）
// 的固定比例算，不跟标的价格挂钩——这样价差越宽，近盈利区这个"贴着短腿"
// 的窄带才会跟着等比例放宽，不会被中间偏空/偏多两个区吞掉。call/put共用
// 这一个常量。
const VERTICAL_NEAR_MONEY_WIDTH_PCT = 10; // 近盈利区带宽 = 价差宽度的这个比例，左右各一半

// 熊市Call价差：卖的行权价更低（sellStrike < buyStrike），危险方向是股价
// 上涨——"深盈区"在低价一侧，"深亏区"在高价一侧。
function classifyBearCallZone(spot: number, sellStrike: number, buyStrike: number): number {
  const width = buyStrike - sellStrike;
  const nearBand = (width * VERTICAL_NEAR_MONEY_WIDTH_PCT) / 100 / 2;
  const mid = (sellStrike + buyStrike) / 2;
  if (spot < sellStrike - nearBand) return 0; // 深盈区
  if (spot <= sellStrike + nearBand) return 1; // 近盈利区
  if (spot < mid) return 2; // 中间偏空（贴短腿）
  if (spot < buyStrike) return 3; // 中间偏多（贴长腿）
  return 4; // 深亏区
}

// 牛市Put价差：卖的行权价更高（sellStrike > buyStrike），危险方向反过来是
// 股价下跌——跟熊市Call价差左右镜像，"深盈区"在高价一侧，"深亏区"在低价
// 一侧。"中间偏空/中间偏多"这两个名字不是指标的涨跌方向，是指现价更贴近
// 卖出的那条腿（"空头"）还是买入的那条腿（"多头"）——所以两个策略这两个
// 名字不用换，只是价格区间镜像了过去。
function classifyBullPutZone(spot: number, sellStrike: number, buyStrike: number): number {
  const width = sellStrike - buyStrike;
  const nearBand = (width * VERTICAL_NEAR_MONEY_WIDTH_PCT) / 100 / 2;
  const mid = (sellStrike + buyStrike) / 2;
  if (spot > sellStrike + nearBand) return 0; // 深盈区
  if (spot >= sellStrike - nearBand) return 1; // 近盈利区
  if (spot > mid) return 2; // 中间偏空（贴短腿）
  if (spot > buyStrike) return 3; // 中间偏多（贴长腿）
  return 4; // 深亏区
}

// bracket区间跟540行原文档的档位标签保持一致（含"微盈0-15%"跟"赚10-20%"
// 之间、"微亏0-15%"跟"亏10-20%"之间的一点重叠——这是原文档档位标签本身
// 的写法，不是这里引入的新误差，这里只是找一个非重叠的判定门槛落在同一
// 档标签下）。
function classifyBearCallBracket(pnl: number, maxProfit: number, maxLoss: number): number {
  if (pnl >= 0) {
    const pct = maxProfit > 0 ? (pnl / maxProfit) * 100 : 0;
    if (pct >= 50) return 0; // 赚50%+
    if (pct >= 40) return 1; // 赚40-50%
    if (pct >= 30) return 2; // 赚30-40%
    if (pct >= 20) return 3; // 赚20-30%
    if (pct >= 10) return 4; // 赚10-20%
    return 5; // 微盈0-15%
  }
  const pct = maxLoss !== 0 ? (pnl / maxLoss) * 100 : 0; // maxLoss本身是负数，同号相除得正数
  if (pct < 10) return 6; // 微亏0-15%
  if (pct < 20) return 7; // 亏10-20%
  if (pct < 30) return 8; // 亏20-30%
  if (pct < 40) return 9; // 亏30-40%
  if (pct < 50) return 10; // 亏40-50%
  return 11; // 亏50%+
}

function bearCallSpreadAdvice(params: {
  sellLeg: Leg;
  buyLeg: Leg;
  openSellLeg: Leg | undefined;
  openBuyLeg: Leg | undefined;
  trackedSpot: number;
  openSpot: number;
  daysElapsed: number;
  lang: SupportedLang;
  t: TFunc;
}): ExplainSection {
  const { sellLeg, buyLeg, openSellLeg, openBuyLeg, trackedSpot, openSpot, daysElapsed, lang, t } = params;
  const label = t("posAdvice.legLabelVertical", {
    type: t("posAdvice.call"),
    sellStrike: sellLeg.strike,
    buyStrike: buyLeg.strike,
  });
  if (!openSellLeg || !openBuyLeg) return placeholderSection(t, label);

  const qty = sellLeg.qty ?? 1;
  const openCredit = openSellLeg.premium - openBuyLeg.premium;
  const currentValue = sellLeg.premium - buyLeg.premium;
  const pnl = qty * (openCredit - currentValue);

  const { maxProfit, maxLoss } = maxProfitLoss([openSellLeg, openBuyLeg], openSpot);
  const remainingDte = sellLeg.dte;
  const totalDte = daysElapsed + remainingDte;
  const elapsedPct = totalDte > 0 ? (daysElapsed / totalDte) * 100 : 0;
  const desc = descClause(t, daysElapsed, elapsedPct, pnl, pctLabelFor(t, pnl, maxProfit, maxLoss));

  const zone = classifyBearCallZone(trackedSpot, sellLeg.strike, buyLeg.strike);

  if (pnl < 0 && zone <= 1) {
    const lossPct = maxLoss !== 0 ? (pnl / maxLoss) * 100 : 0;
    if (lossPct >= VERTICAL_DANGER_LOSS_PCT) {
      const dangerBody = t("posAdvice.verticalCreditDangerBody", { pct: lossPct.toFixed(0) });
      return { title: label, body: `${desc} ${dangerBody}`, severity: "stopLoss", alertBody: dangerBody };
    }
    const holdKey = zone === 0 ? "posAdvice.verticalCreditSafeHoldDeep" : "posAdvice.verticalCreditSafeHoldNearMoney";
    return { title: label, body: `${desc} ${t(holdKey, { pct: lossPct.toFixed(0) })}` };
  }

  const periodIdx = classifyBearCallPeriod(elapsedPct);
  const bracketIdx = classifyBearCallBracket(pnl, maxProfit, maxLoss);
  const [action, cellDesc, cellAdvice] = bearCallSpreadTable[lang][zone][periodIdx][bracketIdx];

  return { title: label, body: `${desc} ${cellDesc} ${cellAdvice}`, severity: severityFromAction(action, pnl), alertBody: cellAdvice };
}

// 牛市Put价差版——跟bearCallSpreadAdvice结构完全一样，只是zone分类换成
// classifyBullPutZone、查表换成bullPutSpreadTable。period/bracket的分类
// 函数（classifyBearCallPeriod/classifyBearCallBracket）跟call/put方向无
// 关，直接复用，没有另写一份。
function bullPutSpreadAdvice(params: {
  sellLeg: Leg;
  buyLeg: Leg;
  openSellLeg: Leg | undefined;
  openBuyLeg: Leg | undefined;
  trackedSpot: number;
  openSpot: number;
  daysElapsed: number;
  lang: SupportedLang;
  t: TFunc;
}): ExplainSection {
  const { sellLeg, buyLeg, openSellLeg, openBuyLeg, trackedSpot, openSpot, daysElapsed, lang, t } = params;
  const label = t("posAdvice.legLabelVertical", {
    type: t("posAdvice.put"),
    sellStrike: sellLeg.strike,
    buyStrike: buyLeg.strike,
  });
  if (!openSellLeg || !openBuyLeg) return placeholderSection(t, label);

  const qty = sellLeg.qty ?? 1;
  const openCredit = openSellLeg.premium - openBuyLeg.premium;
  const currentValue = sellLeg.premium - buyLeg.premium;
  const pnl = qty * (openCredit - currentValue);

  const { maxProfit, maxLoss } = maxProfitLoss([openSellLeg, openBuyLeg], openSpot);
  const remainingDte = sellLeg.dte;
  const totalDte = daysElapsed + remainingDte;
  const elapsedPct = totalDte > 0 ? (daysElapsed / totalDte) * 100 : 0;
  const desc = descClause(t, daysElapsed, elapsedPct, pnl, pctLabelFor(t, pnl, maxProfit, maxLoss));

  const zone = classifyBullPutZone(trackedSpot, sellLeg.strike, buyLeg.strike);

  if (pnl < 0 && zone <= 1) {
    const lossPct = maxLoss !== 0 ? (pnl / maxLoss) * 100 : 0;
    if (lossPct >= VERTICAL_DANGER_LOSS_PCT) {
      const dangerBody = t("posAdvice.verticalCreditDangerBody", { pct: lossPct.toFixed(0) });
      return { title: label, body: `${desc} ${dangerBody}`, severity: "stopLoss", alertBody: dangerBody };
    }
    const holdKey = zone === 0 ? "posAdvice.verticalCreditSafeHoldDeep" : "posAdvice.verticalCreditSafeHoldNearMoney";
    return { title: label, body: `${desc} ${t(holdKey, { pct: lossPct.toFixed(0) })}` };
  }

  const periodIdx = classifyBearCallPeriod(elapsedPct);
  const bracketIdx = classifyBearCallBracket(pnl, maxProfit, maxLoss);
  const [action, cellDesc, cellAdvice] = bullPutSpreadTable[lang][zone][periodIdx][bracketIdx];

  return { title: label, body: `${desc} ${cellDesc} ${cellAdvice}`, severity: severityFromAction(action, pnl), alertBody: cellAdvice };
}

// 垂直价差（1条卖出+1条买入，同类型同到期日，行权价不同）——现在只剩借
// 方价差（买方为主）会走到这个函数体的主逻辑；信用价差（call/put两个方
// 向）都在函数一开始就分叉去了专属的540格表，见上面bearCallSpreadAdvice/
// bullPutSpreadAdvice的说明。
function verticalSpreadAdvice(params: {
  sellLeg: Leg;
  buyLeg: Leg;
  openSellLeg: Leg | undefined;
  openBuyLeg: Leg | undefined;
  trackedSpot: number;
  openSpot: number;
  daysElapsed: number;
  lang: SupportedLang;
  t: TFunc;
}): ExplainSection {
  const { sellLeg, buyLeg, openSellLeg, openBuyLeg, trackedSpot, openSpot, daysElapsed, lang, t } = params;
  const label = t("posAdvice.legLabelVertical", {
    type: t(sellLeg.type === "call" ? "posAdvice.call" : "posAdvice.put"),
    sellStrike: sellLeg.strike,
    buyStrike: buyLeg.strike,
  });
  if (!openSellLeg || !openBuyLeg) return placeholderSection(t, label);

  const qty = sellLeg.qty ?? 1;
  const openCredit = openSellLeg.premium - openBuyLeg.premium;
  const isCredit = openCredit >= 0;

  // 信用价差（收net credit）从这里单独分叉，走各自的540格审查表，不再共用
  // 下面这套逻辑——call走熊市Call价差表，put走牛市Put价差表。分叉之后，
  // 下面剩下的函数体只会在isCredit为false（借方价差）时执行到。见上面
  // bearCallSpreadAdvice/bullPutSpreadAdvice的说明。
  if (isCredit && sellLeg.type === "call") {
    return bearCallSpreadAdvice({ sellLeg, buyLeg, openSellLeg, openBuyLeg, trackedSpot, openSpot, daysElapsed, lang, t });
  }
  if (isCredit && sellLeg.type === "put") {
    return bullPutSpreadAdvice({ sellLeg, buyLeg, openSellLeg, openBuyLeg, trackedSpot, openSpot, daysElapsed, lang, t });
  }

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

// 按"腿角色"分类给出"该怎么办"建议——compare mode（explainTrackedPositionAdvice，
// 下面）和analysis mode（explainAnalysisScenario，上面）共用同一套分类逻辑
// （2026-09-18抽出来的共享函数，原先只有compare mode在用）。每条active
// option leg按"同类型(call/put)腿数"分组——1条且是卖出→裸卖出单腿表；2条
// 且同到期日/不同方向/不同行权价→干净的垂直价差配对（信用/借方内部再分
// 流，铁鹰/铁蝶的两条价差会各自独立地在这里配对成功，不需要专门写"铁鹰"
// 逻辑）；其余形状（3条以上、日历/对角、跨式/宽跨式、蝶式等）本轮还没有
// 专属表，退化成占位文案，不瞎猜规则。正股腿同样占位。健康度徽章是独立UI
// 元素，不在这里重复展示。1条卖call+1条卖put（数量相等）优先按"卖出跨式/
// 宽跨式"组合级处理，不走下面按类型分组、各自独立配对的逻辑——这条判断
// 必须在分call/put处理之前做，否则两条腿会先被各自的类型分组各自识别成
// "1条裸卖单腿"，永远轮不到组合级表。
//
// `resolveOpen`把调用方对"开仓腿对应关系"的理解抽象成一个函数：compare
// mode传入基于resolveOpeningLeg（openLegId/id/位置兜底三层）的版本；
// analysis mode（见上面explainAnalysisScenario）没有真实的历史开仓记
// 录，直接按id去entered legs里查——两种"开仓从哪来"的语义完全不同，但对
// 这个函数来说都只是"给一条当前腿，返回它的开仓腿（或undefined）"。
// 两个模式现在都无条件用这个函数的结果作为"怎么办"整块内容——不再有旧版
// 通用阈值提示（actionHints，2026-09-18已删除）当兜底，配不成任何专属表
// 的形状就用下面自己的占位文案（posAdvice.notImplementedBody），跟对比
// 模式完全一致。
function buildLegAdviceSections(params: {
  active: Leg[];
  resolveOpen: (leg: Leg) => Leg | undefined;
  trackedSpot: number;
  openSpot: number;
  daysElapsed: number;
  result: ComboResult;
  lang: SupportedLang;
  t: TFunc;
}): ExplainSection[] {
  const { active, resolveOpen, trackedSpot, openSpot, daysElapsed, result, lang, t } = params;
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
      trackedSpot, openSpot, daysElapsed, result, t,
    }));
  } else {
    for (const type of ["call", "put"] as const) {
      const group = type === "call" ? callGroup : putGroup;
      if (group.length === 0) continue;

      if (group.length === 1) {
        const leg = group[0];
        if (leg.action === "sell") {
          sections.push(nakedShortAdvice({ leg, openLeg: resolveOpen(leg), trackedSpot, openSpot, daysElapsed, result, t }));
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
            trackedSpot, openSpot, daysElapsed, lang, t,
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

  return sections;
}

// Compare mode: "该怎么办"——取代原来的explainTrackedPosition（纯状态
// 描述）。分类逻辑见上面buildLegAdviceSections的说明。
export function explainTrackedPositionAdvice(params: {
  legs: Leg[];
  openingLegs: Leg[] | null;
  trackedSpot: number;
  openingSpot: number;
  daysElapsed: number;
  result: ComboResult;
  lang: SupportedLang;
  t: TFunc;
}): SituationExplanation | null {
  const { legs, openingLegs, trackedSpot, openingSpot, daysElapsed, result, lang, t } = params;
  const active = legs.filter((l) => !l.disabled);
  if (active.length === 0 || trackedSpot <= 0) return null;

  const openingById = new Map((openingLegs ?? []).map((l) => [l.id, l]));
  const resolveOpen = (leg: Leg): Leg | undefined =>
    openingLegs ? resolveOpeningLeg(leg, active.indexOf(leg), openingLegs, openingById) : undefined;

  const sections = buildLegAdviceSections({
    active, resolveOpen, trackedSpot, openSpot: openingSpot, daysElapsed, result, lang, t,
  });

  // 通用免责说明，不分策略、固定放在最后一条（xue 2026-09-18明确选择：一条
  // 通用提醒，不在每条模板文案里各自重复）——这套规则只看价格/时间/盈亏比
  // 例，不看财报、重大事件、支撑压力位，这三项永远留给用户自己判断（见本
  // 文件顶部"明确排除在这套规则判断范围之外"的说明）。
  sections.push({ title: t("posAdvice.caveatTitle"), body: t("posAdvice.caveatBody") });

  return {
    headline: t("explain.headlineCompare", { days: daysElapsed.toFixed(0) }),
    sections,
  };
}