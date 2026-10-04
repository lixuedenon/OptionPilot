// src/lib/positionAdvisor.ts
// 通用持仓建议：不按策略形状写表，而是从任何组合都能算出的几个读数——股价（在盈利区内/外、离盈亏平衡点几个标准差）、
// 时间（开仓总期限过了多少）、盈利（占开仓权利金/成本、占最大可赚）、往后看（按规则继续拿的止盈/止损/最后赚钱概率，
// 以及"剩下还能赚多少 vs 可能亏多少"）——再用少数几条阈值给出五种建议之一。
// 止盈/止损线和到期前平仓直接用胜率模拟里的同一套规则，两处结论不会互相矛盾。
import type { Leg, Shifts } from "@/lib/types";
import { impliedVol, RATE } from "@/lib/pricing";
import { bsPrice } from "@/lib/bs";
import { prepareSim, simPnlAt, runBatch, startStatus, type Prepared, type SimRules, type StartStatus } from "@/lib/winRateSim";
import { comboBaseIv } from "@/lib/stockOptionMap";

export type AdviceAction = "takeProfit" | "stopLoss" | "hold" | "holdOrTakeProfit" | "holdOrStopLoss";

// 第一版阈值（给xue审查用，以后按抽查结果调）。
export const ADVICE_THRESHOLDS = {
  flatPct: 0.05, // 盈亏在开仓权利金/成本的±5%以内算"基本持平"
  captureTakeProfit: 0.75, // 已赚到最大可赚的75%以上 → 止盈
  // "剩下还能赚的 ÷ 可能再亏的"跟开仓时比（不同结构天生的收益风险比差很多，铁鹰开仓时就只有0.2左右，不能用绝对值）：
  rrRelTakeProfit: 0.35, // 只剩开仓时的35%以下 → 止盈
  rrRelWatch: 0.6, // 只剩60%以下 → 持有或止盈
  nearEdgeSigma: 0.5, // 卖方盈利中，但股价离最近的盈亏平衡点不到0.5个标准差（贴着卖出腿）→ 持有或止盈
  pStopWatch: 0.25, // 盈利中，但按规则继续拿有25%以上会止损出场 → 持有或止盈
  debitLateElapsed: 0.75, // 买方盈利中、时间已过75%（时间损耗加速）→ 持有或止盈
  recoverStop: 0.2, // 卖方亏损中，最后回到盈利的概率 < 20% → 止损
  recoverWatch: 0.4, // < 40% → 持有或止损
  sigmaOutStop: 1, // 股价已在盈利区外超过1个标准差（按剩余天数）……
  elapsedStop: 0.5, // ……且时间已过一半 → 止损
  debitLossWatch: 0.6, // 买方亏损达到止损线的60% → 持有或止损
  assignDays: 5, // 卖出腿实值、剩余≤5天 → 提示提前指派风险
  pinDays: 7, // 卖出腿离行权价2%以内、剩余≤7天 → 提示贴着行权价到期
};
export type AdviceThresholds = typeof ADVICE_THRESHOLDS;

export interface AdviceInput {
  legs: Leg[]; // 现在的腿位（已去掉屏蔽/平掉的）
  spot: number;
  basis: number; // 开仓组合净权利金的绝对值（每股）
  credit: boolean; // 开仓收钱=卖方
  pnl: number; // 开仓以来总盈亏（每股，含已实现）
  totalTerm: number; // 开仓时（最早到期）总期限天数
  rules: SimRules;
  vol: number; // 假设的未来实际波动
  drift?: number;
  n?: number;
  seed?: number;
  thresholds?: AdviceThresholds;
}

export type AdviceRule =
  | "hitTp" | "hitSl" | "closeTime"
  | "capture" | "rr" | "rrWatch" | "nearEdge" | "pStop" | "debitLate"
  | "outside" | "recover" | "recoverWatch" | "outsideWatch" | "debitLoss"
  | "ok";

export interface AdviceSignals {
  pnl: number;
  pnlPct: number; // 占开仓权利金/成本
  maxProfit: number | null; // 到期（最早到期日）时最多赚到多少（总账）；null=上方不封顶
  maxLoss: number | null; // 最多亏到多少（负数，总账）；null=不封顶
  capture: number | null; // 已赚到最大可赚的比例
  remainingGain: number | null;
  remainingRisk: number | null;
  rr: number | null; // remainingGain / remainingRisk（任一边不封顶时为null）
  rrRel: number | null; // rr ÷ 开仓时的收益风险比
  breakevens: number[];
  inProfitZone: boolean; // 按现价，到期时是否在盈利区
  sigmaToEdge: number | null; // 区内=离最近盈亏平衡点几个标准差（正）；区外=回到盈利区要走几个标准差（负）；null=范围内没有盈亏平衡点
  nearestBe: number | null;
  elapsed: number; // 开仓总期限已过的比例
  remainingDays: number;
  pTp: number;
  pSl: number;
  pTime: number; // 到你设的"到期前平仓"时间才出场
  pExpiry: number; // 拿到最早到期日
  pWin: number; // 按规则继续拿，最后（出场时）盈利的概率
  tpLine: number; // 止盈线/止损线（开仓以来总盈亏，每股）；没设=±Infinity
  slLine: number;
  flags: ("assignment" | "pin")[];
  status: StartStatus;
}

// 每条规则主要看的是哪一项（卡片上在那一行前面加▶）。
export type AdviceDriver = "price" | "time" | "pnl" | "forward" | null;
export const ADVICE_DRIVER: Record<AdviceRule, AdviceDriver> = {
  hitTp: "pnl", hitSl: "pnl", closeTime: "time",
  capture: "pnl", rr: "forward", rrWatch: "forward", nearEdge: "price", pStop: "forward", debitLate: "time",
  outside: "price", recover: "forward", recoverWatch: "forward", outsideWatch: "price", debitLoss: "pnl",
  ok: null,
};

// 分析模式的情景点：把开仓腿位挪到"第dT天、股价+dS、隐含波动率+dV"，权利金换成那一刻的理论价（每股、不带正负），
// 这样后面的模拟就从情景点出发。跟priceCombo/legShiftedPrice同一套定价。到期的腿返回null（没法再往后推）。
export function scenarioLegs(legs: Leg[], s: Shifts, spot: number): Leg[] | null {
  const S = Math.max(0.01, spot + s.dS);
  const out: Leg[] = [];
  for (const l of legs) {
    if (l.kind === "stock") {
      out.push(l);
      continue;
    }
    const dte = l.dte - s.dT;
    if (dte <= 0) return null;
    const iv = Math.max(0.01, impliedVol(spot, l.strike, l.dte, l.premium, l.type) + s.dV / 100);
    out.push({ ...l, dte, premium: bsPrice(S, l.strike, dte, iv, RATE, l.type) });
  }
  return out;
}

export interface Advice {
  action: AdviceAction;
  rule: AdviceRule;
  signals: AdviceSignals;
}

// 到期（最早到期日）时的盈亏范围：0.02~5倍现价宽范围扫描，端点还在走就算不封顶（maxProfit/maxLoss为null）。
export function expiryScan(p: Prepared, spot: number) {
  const h = p.horizon;
  const prices: number[] = [];
  for (let i = 0; i <= 480; i++) prices.push(spot * Math.exp(Math.log(0.02) + (Math.log(5 / 0.02) * i) / 480));
  for (const l of p.legs) if (l.kind !== "stock") prices.push(l.strike);
  prices.sort((a, b) => a - b);
  const vals = prices.map((x) => simPnlAt(p, h, x));
  let maxV = -Infinity;
  let minV = Infinity;
  for (const v of vals) {
    if (v > maxV) maxV = v;
    if (v < minV) minV = v;
  }
  const n = vals.length;
  // 最高价那一端还在往上（或往下）走，就当作不封顶。
  const topRising = vals[n - 1] >= maxV - 1e-9 && vals[n - 1] - vals[n - 2] > 1e-6;
  const topFalling = vals[n - 1] <= minV + 1e-9 && vals[n - 1] - vals[n - 2] < -1e-6;
  return { prices, vals, maxProfit: topRising ? null : maxV, maxLoss: topFalling ? null : minV };
}

export function adviseCombo(input: AdviceInput): Advice | null {
  const th = input.thresholds ?? ADVICE_THRESHOLDS;
  const legs = input.legs.filter((l) => !l.disabled);
  const p = prepareSim({ legs, spot: input.spot, basis: input.basis, pnlOffset: input.pnl, rules: input.rules, totalTerm: input.totalTerm, drift: input.drift });
  if (!p) return null;
  const S = input.spot;
  const status = startStatus(p);
  const elapsed = input.totalTerm > 0 ? Math.min(1, Math.max(0, 1 - p.horizon / input.totalTerm)) : 0;

  const scan = expiryScan(p, S);
  const iv = comboBaseIv(legs, S) ?? 0.3;
  const sig = Math.max(1e-6, iv * Math.sqrt(Math.max(1, p.horizon) / 365));
  const breakevens: number[] = [];
  for (let i = 0; i < scan.vals.length - 1; i++) {
    const a = scan.vals[i];
    const b = scan.vals[i + 1];
    if ((a > 0) !== (b > 0) && Math.abs(Math.log(scan.prices[i] / S)) < 5 * sig) {
      const f = a / (a - b);
      breakevens.push(scan.prices[i] + (scan.prices[i + 1] - scan.prices[i]) * f);
    }
  }
  const inProfitZone = simPnlAt(p, p.horizon, S) > 0;
  let nearestBe: number | null = null;
  let best = Infinity;
  for (const be of breakevens) {
    const d = Math.abs(Math.log(be / S)) / sig;
    if (d < best) {
      best = d;
      nearestBe = be;
    }
  }
  const sigmaToEdge = nearestBe == null ? null : inProfitZone ? best : -best;

  const pnl = input.pnl;
  const remainingGain = scan.maxProfit == null ? null : Math.max(0, scan.maxProfit - pnl);
  const remainingRisk = scan.maxLoss == null ? null : Math.max(0, pnl - scan.maxLoss);
  const rr = remainingGain == null || remainingRisk == null || remainingRisk < 1e-9 ? null : remainingGain / remainingRisk;
  // 结构不变时，到期盈亏的上下限就是开仓那一刻的上下限，所以开仓时的收益风险比 = 最大可赚 ÷ 最大可亏。
  const rr0 = scan.maxProfit != null && scan.maxLoss != null && scan.maxLoss < -1e-9 ? scan.maxProfit / -scan.maxLoss : null;
  const rrRel = rr != null && rr0 != null && rr0 > 1e-9 ? rr / rr0 : null;
  const capture = scan.maxProfit != null && scan.maxProfit > 1e-9 ? pnl / scan.maxProfit : null;

  const n = input.n ?? 2000;
  const { outcomes } = runBatch(p, input.vol, n, input.seed ?? 12345);
  const pTp = outcomes.filter((o) => o.reason === "tp").length / n;
  const pSl = outcomes.filter((o) => o.reason === "sl").length / n;
  const pWin = outcomes.filter((o) => o.pnl > 0).length / n;
  const pTime = outcomes.filter((o) => o.reason === "time").length / n;
  const pExpiry = outcomes.filter((o) => o.reason === "expiry").length / n;

  const flags: AdviceSignals["flags"] = [];
  for (const l of legs) {
    if (l.kind === "stock" || l.action !== "sell") continue;
    const itm = l.type === "call" ? S > l.strike : S < l.strike;
    if (itm && l.dte <= th.assignDays && !flags.includes("assignment")) flags.push("assignment");
    if (Math.abs(S - l.strike) / S < 0.02 && l.dte <= th.pinDays && !flags.includes("pin")) flags.push("pin");
  }

  const signals: AdviceSignals = {
    pnl, pnlPct: pnl / input.basis, maxProfit: scan.maxProfit, maxLoss: scan.maxLoss, capture, remainingGain, remainingRisk, rr, rrRel,
    breakevens, inProfitZone, sigmaToEdge, nearestBe, elapsed, remainingDays: p.horizon, pTp, pSl, pTime, pExpiry, pWin,
    tpLine: p.tpLine, slLine: p.slLine, flags, status,
  };
  const out = (action: AdviceAction, rule: AdviceRule): Advice => ({ action, rule, signals });

  if (status === "atTakeProfit") return out("takeProfit", "hitTp");
  if (status === "atStop") return out("stopLoss", "hitSl");
  if (status === "inCloseWindow") return out(pnl >= 0 ? "takeProfit" : "stopLoss", "closeTime");

  const flat = Math.abs(signals.pnlPct) < th.flatPct;
  if (pnl > 0 && !flat) {
    if (capture != null && capture >= th.captureTakeProfit) return out("takeProfit", "capture");
    if (rrRel != null && rrRel < th.rrRelTakeProfit) return out("takeProfit", "rr");
    if (rrRel != null && rrRel < th.rrRelWatch) return out("holdOrTakeProfit", "rrWatch");
    if (input.credit && inProfitZone && sigmaToEdge != null && sigmaToEdge < th.nearEdgeSigma) return out("holdOrTakeProfit", "nearEdge");
    if (pSl >= th.pStopWatch) return out("holdOrTakeProfit", "pStop");
    if (!input.credit && elapsed >= th.debitLateElapsed) return out("holdOrTakeProfit", "debitLate");
    return out("hold", "ok");
  }
  // 亏损或基本持平
  const outsideFar = !inProfitZone && sigmaToEdge != null && -sigmaToEdge >= th.sigmaOutStop;
  if (input.credit) {
    if (outsideFar && elapsed >= th.elapsedStop && !flat) return out("stopLoss", "outside");
    if (!flat && pWin < th.recoverStop) return out("stopLoss", "recover");
    if (!flat && pWin < th.recoverWatch) return out("holdOrStopLoss", "recoverWatch");
    if (!inProfitZone && !flat) return out("holdOrStopLoss", "outsideWatch");
    return out("hold", "ok");
  }
  const slFrac = input.rules.stopMult ?? 1;
  if (!flat && -signals.pnlPct >= th.debitLossWatch * slFrac) return out("holdOrStopLoss", "debitLoss");
  if (outsideFar && elapsed >= th.elapsedStop) return out("holdOrStopLoss", "outsideWatch");
  return out("hold", "ok");
}

// ── 不用模拟的快速版：地形图"风险分区"逐格上色、走势上的节点用 ──
// 跟adviseCombo同一套阈值和判断顺序，只是去掉了要靠随机模拟的几条（pStop、recover、recoverWatch），
// 所以图上的颜色=左边持仓建议在这一点"不看往后概率"时会给的建议。盈亏都从开仓算（分析模式）。
export interface QuickAdviceCtx {
  p: Prepared;
  credit: boolean;
  basis: number;
  totalTerm: number;
  iv: number;
  maxProfit: number | null;
  maxLoss: number | null;
  rr0: number | null;
  breakevens: number[];
  th: AdviceThresholds;
}

export function prepareQuickAdvice(input: { legs: Leg[]; spot: number; basis: number; credit: boolean; rules: SimRules; totalTerm: number; thresholds?: AdviceThresholds }): QuickAdviceCtx | null {
  const legs = input.legs.filter((l) => !l.disabled);
  const p = prepareSim({ legs, spot: input.spot, basis: input.basis, pnlOffset: 0, rules: input.rules, totalTerm: input.totalTerm });
  if (!p) return null;
  const scan = expiryScan(p, input.spot);
  const breakevens: number[] = [];
  for (let i = 0; i < scan.vals.length - 1; i++) {
    const a = scan.vals[i];
    const b = scan.vals[i + 1];
    if ((a > 0) !== (b > 0)) breakevens.push(scan.prices[i] + ((scan.prices[i + 1] - scan.prices[i]) * a) / (a - b));
  }
  return {
    p, credit: input.credit, basis: input.basis, totalTerm: input.totalTerm, iv: comboBaseIv(legs, input.spot) ?? 0.3,
    maxProfit: scan.maxProfit, maxLoss: scan.maxLoss,
    rr0: scan.maxProfit != null && scan.maxLoss != null && scan.maxLoss < -1e-9 ? scan.maxProfit / -scan.maxLoss : null,
    breakevens, th: input.thresholds ?? ADVICE_THRESHOLDS,
  };
}

// 第day天（从开仓算）、股价price、开仓以来盈亏pnl时的建议。expiryPnl可传入（同一价格反复用时省一次计算）。
export function quickAdvice(ctx: QuickAdviceCtx, day: number, price: number, pnl: number, expiryPnl?: number): AdviceAction {
  const { p, th } = ctx;
  const remaining = p.horizon - day;
  if (pnl >= p.tpLine) return "takeProfit";
  if (pnl <= p.slLine) return "stopLoss";
  if (remaining <= 0 || (p.closeAtRemaining > 0 && remaining <= p.closeAtRemaining)) return pnl >= 0 ? "takeProfit" : "stopLoss";
  const elapsed = ctx.totalTerm > 0 ? Math.min(1, Math.max(0, day / ctx.totalTerm)) : 0;
  const sig = Math.max(1e-6, ctx.iv * Math.sqrt(Math.max(1, remaining) / 365));
  const inProfitZone = (expiryPnl ?? simPnlAt(p, p.horizon, price)) > 0;
  let best = Infinity;
  for (const be of ctx.breakevens) {
    const d = Math.abs(Math.log(be / price)) / sig;
    if (d < 5 && d < best) best = d;
  }
  const sigmaToEdge = best === Infinity ? null : inProfitZone ? best : -best;
  const flat = Math.abs(pnl / ctx.basis) < th.flatPct;
  if (pnl > 0 && !flat) {
    const capture = ctx.maxProfit != null && ctx.maxProfit > 1e-9 ? pnl / ctx.maxProfit : null;
    const gain = ctx.maxProfit == null ? null : Math.max(0, ctx.maxProfit - pnl);
    const risk = ctx.maxLoss == null ? null : Math.max(0, pnl - ctx.maxLoss);
    const rr = gain == null || risk == null || risk < 1e-9 ? null : gain / risk;
    const rrRel = rr != null && ctx.rr0 != null && ctx.rr0 > 1e-9 ? rr / ctx.rr0 : null;
    if (capture != null && capture >= th.captureTakeProfit) return "takeProfit";
    if (rrRel != null && rrRel < th.rrRelTakeProfit) return "takeProfit";
    if (rrRel != null && rrRel < th.rrRelWatch) return "holdOrTakeProfit";
    if (ctx.credit && inProfitZone && sigmaToEdge != null && sigmaToEdge < th.nearEdgeSigma) return "holdOrTakeProfit";
    if (!ctx.credit && elapsed >= th.debitLateElapsed) return "holdOrTakeProfit";
    return "hold";
  }
  const outsideFar = !inProfitZone && sigmaToEdge != null && -sigmaToEdge >= th.sigmaOutStop;
  if (ctx.credit) {
    if (outsideFar && elapsed >= th.elapsedStop && !flat) return "stopLoss";
    if (!inProfitZone && !flat) return "holdOrStopLoss";
    return "hold";
  }
  const slFrac = p.slLine === -Infinity ? 1 : -p.slLine / ctx.basis;
  if (!flat && -pnl / ctx.basis >= th.debitLossWatch * slFrac) return "holdOrStopLoss";
  if (outsideFar && elapsed >= th.elapsedStop) return "holdOrStopLoss";
  return "hold";
}
