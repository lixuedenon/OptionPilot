// src/lib/winRateSim.ts
// "万次推演"标签（和持仓建议）的计算层：按假设的未来实际波动随机生成股价走势，逐日用现有定价函数重算组合，
// 按止盈/止损/到期前平仓规则决定每条走势在哪天、因为什么出场，再汇总成统计和盈亏平衡波动率。
// 盈亏口径跟priceCombo/地形图一致（legShiftedPrice之和 − 起点净权利金，每股计），另加pnlOffset（对比模式的开仓至今总盈亏）。
import { ncdf } from "@/lib/bs";
import type { Leg } from "@/lib/types";
import { bsPrice } from "@/lib/bs";
import { impliedVol, legShiftedPrice, RATE } from "@/lib/pricing";

export interface SimRules {
  takeProfitPct: number | null; // 0.5 = 赚到基准的50%就平仓；null=不设
  stopMult: number | null; // 1 = 亏到基准的1倍就平仓；null=不设
  // 剩下开仓总期限的多少比例时平仓（0.25=剩1/4时间）；0=持有到期。按比例而不是固定天数：30天和1年期的组合"提前7天"意义完全不同。
  closeFrac: number;
  // 卖出腿的Delta（绝对值）碰到这个数就平仓（第3组，卖方常用的管理规则，比如0.30）；null/不传=不用。买方组合不用。
  deltaExit?: number | null;
}

export type ExitReason = "tp" | "sl" | "delta" | "time" | "expiry";

export interface SimSetup {
  legs: Leg[]; // 模拟起点的腿位（分析模式=开仓腿位；对比模式=今日组合），已去掉屏蔽的腿
  spot: number; // 起点股价
  basis: number; // 止盈止损的基准：开仓组合净权利金的绝对值（每股）
  pnlOffset: number; // 起点时已有的总盈亏（对比模式含已实现部分；分析模式为0）
  rules: SimRules;
  totalTerm?: number; // 开仓时（最早到期的）总期限天数；不传=起点剩余天数（分析模式从开仓日出发时两者相同）
  drift?: number; // 假设的年化涨跌（小数），默认0=不预测方向；买方方向性组合用
  dV?: number; // 持有期间隐含波动率加减的百分点（波动率滑块）：只影响期权定价，不影响股价怎么走
  // 第3组：股价下跌时隐含波动率跟着上升（波动率微笑）。skew = 每条腿的IV随 ln(起点股价/股价) 增加多少（小数/单位对数涨跌），
  // 比如0.4=跌10%时各腿IV大约+4个点、涨10%时−4个点。从期权链的微笑斜率估（lib/atmIv.ts的skewFromChain）；不传=0（IV不随股价变）。
  skew?: number;
  // 第3组：提前平仓的成交损耗——每条期权腿按"买卖价差的一半占价格的比例"（开仓时期权链的实时报价）算，下标跟legs一致；
  // 没有报价的腿按默认 0.01+1%×价格（美元/股）。拿到期（自然到期）不付。
  halfSpread?: (number | undefined)[];
  // 财报这一组（2026-10-07）：第day天（从起点算的日历天，股价在那天收盘时反应）有财报。
  // jump=跳空大小（对数涨跌的标准差，lib/earnings.ts按"市场押多少"算）。随机走势在那天多跳一下；
  // 定价上，跨过财报的腿开仓时的隐含波动率里含着这次跳空，财报前按"平常波动+跳空摊到剩余天数"、财报后只剩平常波动（IV回落）。
  // 历史真实走法不传（真实走势里本来就有过去的财报跳空）。不传=没有财报（跟以前一样）。
  earnings?: { day: number; jump: number } | null;
}

export interface Prepared {
  legs: Leg[];
  spot: number;
  ivs: (number | undefined)[];
  netNow: number;
  horizon: number; // 起点到最早到期日的天数
  endDay: number; // 按规则最晚在第几天出场（到期前平仓时 < horizon；0=现在就该平仓）
  closeAtRemaining: number; // 剩多少天时平仓（0=持有到期）
  drift: number;
  basis: number;
  pnlOffset: number;
  tpLine: number;
  slLine: number;
  optionLegCount: number;
  dV: number;
  skew: number;
  halfSpread: (number | undefined)[];
  deltaExit: number | null;
  earnDay: number | null; // 财报反应在第几天（1..horizon），没有=null
  earnJump: number; // 跳空大小（对数标准差），没有=0
  // 各腿扣掉财报跳空后的"平常"隐含波动率（只有跨过财报的腿有；没跨过/没有财报=undefined，照用ivs）
  baseIvs: (number | undefined)[];
  // 各腿IV里属于这次跳空的那部分方差（年化方差×年数，= (开仓IV² − 平常IV²)×dte/365），保证第0天正好等于开仓IV
  earnVar: number[];
}

export type StartStatus = "normal" | "atTakeProfit" | "atStop" | "inCloseWindow";

export function prepareSim(setup: SimSetup): Prepared | null {
  const legs = setup.legs.filter((l) => !l.disabled);
  const options = legs.filter((l) => l.kind !== "stock");
  if (options.length === 0 || !(setup.spot > 0) || !(setup.basis > 1e-6)) return null;
  const ivs = legs.map((l) => (l.kind === "stock" ? undefined : impliedVol(setup.spot, l.strike, l.dte, l.premium, l.type)));
  const netNow = legs.reduce((sum, l, i) => sum + legShiftedPrice(l, { dS: 0, dT: 0, dV: 0 }, setup.spot, ivs[i]), 0);
  const horizon = Math.max(1, Math.round(Math.min(...options.map((l) => l.dte))));
  const { takeProfitPct, stopMult, closeFrac } = setup.rules;
  const term = Math.max(horizon, Math.round(setup.totalTerm ?? horizon));
  const closeAtRemaining = closeFrac > 0 ? Math.max(1, Math.round(term * closeFrac)) : 0;
  const endDay = closeAtRemaining > 0 ? Math.max(0, horizon - closeAtRemaining) : horizon;
  const e = setup.earnings;
  const earnDay = e && e.jump > 0 && e.day >= 1 && e.day <= horizon ? Math.round(e.day) : null;
  const earnJump = earnDay != null ? e!.jump : 0;
  // 平常波动² = 开仓IV² − 跳空²/剩余年数（至少留开仓IV的一半）；到期在财报之前（或当天之前）的腿不受影响
  const baseIvs = legs.map((l, i) => {
    const iv = ivs[i];
    if (earnDay == null || iv === undefined || !(l.dte > earnDay)) return undefined;
    return Math.sqrt(Math.max((0.5 * iv) ** 2, iv * iv - (earnJump * earnJump * 365) / l.dte));
  });
  const earnVar = legs.map((l, i) => {
    const iv = ivs[i], b = baseIvs[i];
    return iv !== undefined && b !== undefined ? ((iv * iv - b * b) * l.dte) / 365 : 0;
  });
  return {
    legs,
    spot: setup.spot,
    ivs,
    netNow,
    horizon,
    endDay,
    closeAtRemaining,
    drift: setup.drift ?? 0,
    basis: setup.basis,
    pnlOffset: setup.pnlOffset,
    tpLine: takeProfitPct != null ? takeProfitPct * setup.basis : Infinity,
    slLine: stopMult != null ? -stopMult * setup.basis : -Infinity,
    optionLegCount: options.length,
    dV: setup.dV ?? 0,
    skew: Math.max(0, Math.min(2, setup.skew ?? 0)),
    // legs去掉了屏蔽的腿，halfSpread下标跟着setup.legs：按id对回去
    halfSpread: legs.map((l) => setup.halfSpread?.[setup.legs.indexOf(l)]),
    deltaExit: setup.rules.deltaExit != null && setup.rules.deltaExit > 0 ? setup.rules.deltaExit : null,
    earnDay,
    earnJump,
    baseIvs,
    earnVar,
  };
}

// 第i条腿在第day天、股价price时用的隐含波动率：起点IV（跨财报的腿按财报前/后，见prepareSim的baseIvs）
// + 微笑带来的变化（跌了往上、涨了往下）。波动率滑块dV在legShiftedPrice里另加。
function legIvAt(p: Prepared, i: number, day: number, price: number): number | undefined {
  const iv = legTermIv(p, i, day);
  if (iv === undefined || p.skew === 0) return iv;
  return Math.max(0.02, iv + p.skew * Math.log(p.spot / price));
}

// 只看财报前后（不含微笑）：财报前=平常波动 + 跳空摊到剩下的天数（第0天正好等于开仓IV，越靠近财报越高）；财报当天收盘以后=只剩平常波动
function legTermIv(p: Prepared, i: number, day: number): number | undefined {
  const iv = p.ivs[i];
  const b = p.baseIvs[i];
  if (iv === undefined || b === undefined || p.earnDay == null) return iv;
  const left = p.legs[i].dte - day;
  return day < p.earnDay && left > 0 ? Math.sqrt(b * b + (p.earnVar[i] * 365) / left) : b;
}

// 财报这一组：情景点（第day天、股价price）的腿位按财报前后隐含波动率的变化重新定价。
// 盈亏图和滑块不含这个变化（隐含波动率按开仓时不变）；万次推演和持仓建议加了财报跳空时，从情景点出发要用这一份，
// 不然主推演里财报后IV已经回落了、从情景点出发的那团云和建议却还按没回落的价格算。
// p：开仓组合（带earnings）；nowLegs：情景点的腿位（App的scenarioLegs，跟p.legs同顺序同条数）。返回新腿位和盈亏要加多少（每股）。
export function earningsShift(p: Prepared, day: number, price: number, nowLegs: Leg[]): { legs: Leg[]; dPnl: number } | null {
  if (p.earnDay == null || nowLegs.length !== p.legs.length) return null;
  let dPnl = 0;
  const legs = nowLegs.map((l, i) => {
    const iv0 = p.ivs[i];
    const ivT = legTermIv(p, i, day);
    if (l.kind === "stock" || iv0 === undefined || ivT === undefined || !(l.dte > 0) || Math.abs(ivT - iv0) < 1e-9) return l;
    const ivNow = impliedVol(price, l.strike, l.dte, l.premium, l.type);
    const premium = bsPrice(price, l.strike, l.dte, Math.max(0.01, ivNow + ivT - iv0), RATE, l.type);
    dPnl += (l.action === "buy" ? 1 : -1) * (l.qty ?? 1) * (premium - l.premium);
    return { ...l, premium };
  });
  return { legs, dPnl };
}

// 提前平仓的成交损耗（每股、正数）：各期权腿按半个买卖价差
export function exitCost(p: Prepared, day: number, price: number): number {
  let c = 0;
  for (let i = 0; i < p.legs.length; i++) {
    const l = p.legs[i];
    if (l.kind === "stock") continue;
    const px = Math.abs(legShiftedPrice(l, { dS: price - p.spot, dT: day, dV: day > 0 ? p.dV : 0 }, p.spot, legIvAt(p, i, day, price))) / (l.qty ?? 1);
    const half = p.halfSpread[i] != null ? Math.max(0.01, p.halfSpread[i]! * px) : 0.01 + 0.01 * px;
    c += half * (l.qty ?? 1);
  }
  return c;
}

// 卖出腿里Delta绝对值最大的那条（第day天、股价price，IV含微笑）
export function maxShortDelta(p: Prepared, day: number, price: number): number {
  let mx = 0;
  for (let i = 0; i < p.legs.length; i++) {
    const l = p.legs[i];
    if (l.kind === "stock" || l.action !== "sell") continue;
    const dte = l.dte - day;
    if (dte <= 0) continue;
    const iv = Math.max(0.01, (legIvAt(p, i, day, price) ?? 0.3) + p.dV / 100);
    const T = dte / 365;
    const d1 = (Math.log(price / l.strike) + (0.05 + iv * iv / 2) * T) / (iv * Math.sqrt(T));
    const d = l.type === "call" ? ncdf(d1) : 1 - ncdf(d1);
    if (d > mx) mx = d;
  }
  return mx;
}

export function startStatus(p: Prepared): StartStatus {
  if (p.pnlOffset >= p.tpLine) return "atTakeProfit";
  if (p.pnlOffset <= p.slLine) return "atStop";
  if (p.endDay === 0) return "inCloseWindow";
  return "normal";
}

// 第day天（从起点算）、股价price时的总盈亏（每股）。
export function simPnlAt(p: Prepared, day: number, price: number): number {
  const s = { dS: price - p.spot, dT: day, dV: day > 0 ? p.dV ?? 0 : 0 };
  let v = 0;
  for (let i = 0; i < p.legs.length; i++) v += legShiftedPrice(p.legs[i], s, p.spot, legIvAt(p, i, day, price));
  return v - p.netNow + p.pnlOffset;
}

// 可复现的随机数（同一个seed每次得到同一组走势），盈亏平衡波动率的各个试算点共用同一组随机数，结果才平滑可比。
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u <= 1e-12) u = rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

export interface PathOutcome {
  reason: ExitReason;
  day: number;
  pnl: number;
  price: number; // 出场那天的股价
  holdPnl: number; // 同一条走势不管规则、一直拿到最早到期日的盈亏——"规则在换什么"跟它比
  cost?: number; // 这次平仓付的成交损耗（每股；拿到期=0）——pnl已经扣过
}

export interface SamplePath {
  prices: number[]; // 第0天到最早到期日（出场之后也接着走，画成淡色）
  reason: ExitReason;
  exitDay: number;
}

// 每一步回调：第day天、股价price、这条走势此刻是否还按规则拿着（出场后为false）。用来累计密度云。
export type StepFn = (day: number, price: number, holding: boolean) => void;

// 走势按日（日历日，跟定价的dte/365一致）生成。默认零漂移：不预测涨跌方向（跟probabilityOfProfit的POP_DRIFT_RATE=0同一约定）；
// 买方方向性组合可以传入假设的年化涨跌（p.drift）。
// ⚠️ 每条走势都走到最早到期日（出场后不再定价，只为画完整的路和算"一直拿着"的结果）：每条走势消耗的随机数个数固定，
// 换规则不会改变后面各条走势，规则对比和持仓建议卡片才是同一组走势。
function runPath(p: Prepared, vol: number, z: () => number, keep: boolean, onStep?: StepFn): { out: PathOutcome; prices?: number[] } {
  const dt = 1 / 365;
  const drift = (p.drift - 0.5 * vol * vol) * dt;
  const diff = vol * Math.sqrt(dt);
  // 财报那天多跳一下（对数正态，均值修正后不改变期望）：多用一个随机数，只在有财报时，所以没有财报时走势跟以前完全一样
  const J = p.earnJump;
  return walkPath(p, (d) => Math.exp(drift + diff * z() + (d === p.earnDay ? -0.5 * J * J + J * z() : 0)), keep, onStep);
}

// 走一条路：next(d)给出第d天相对前一天的股价倍数（随机走势=对数正态一步；历史走势=那段真实走势当天的涨跌）。
// 规则判断、下车、"一直拿着"的结果都在这里，随机和历史两种走法共用，结果才可比。
function walkPath(p: Prepared, next: (d: number) => number, keep: boolean, onStep?: StepFn): { out: PathOutcome; prices?: number[] } {
  let S = p.spot;
  const prices = keep ? [S] : undefined;
  onStep?.(0, S, p.endDay > 0);
  let out: PathOutcome | null = p.endDay === 0 ? { reason: "time", day: 0, pnl: p.pnlOffset - exitCost(p, 0, S), price: S, holdPnl: 0, cost: exitCost(p, 0, S) } : null;
  for (let d = 1; d <= p.horizon; d++) {
    S *= next(d);
    prices?.push(S);
    if (!out && d <= p.endDay) {
      const pnl = simPnlAt(p, d, S);
      // 最后那天（到期/到点平仓）按"到期/到时间"算，不套止盈止损：到期那天股价只要还在卖出腿外侧，盈利自动就是全部权利金、
      // 一定够得着止盈线，原来会被算成"止盈"，止盈概率虚高、"拿到期"几乎为0（2026-10-06修）。盈亏数字不变，只是归类。
      // 提前平仓（止盈/止损/Delta/到点平仓）扣成交损耗；规则线按中间价的盈亏判断，落袋的是扣掉损耗以后的。
      const early = (reason: ExitReason): PathOutcome => {
        const cost = exitCost(p, d, S);
        return { reason, day: d, pnl: pnl - cost, price: S, holdPnl: 0, cost };
      };
      if (d === p.endDay) out = p.endDay < p.horizon ? early("time") : { reason: "expiry", day: d, pnl, price: S, holdPnl: 0, cost: 0 };
      else if (pnl >= p.tpLine) out = early("tp");
      else if (pnl <= p.slLine) out = early("sl");
      else if (p.deltaExit != null && maxShortDelta(p, d, S) >= p.deltaExit) out = early("delta");
    }
    onStep?.(d, S, !out || out.day >= d);
  }
  const final = out!;
  final.holdPnl = final.reason === "expiry" ? final.pnl : simPnlAt(p, p.horizon, S);
  return { out: final, prices };
}

export function runBatch(p: Prepared, vol: number, n: number, seed: number, sampleCount = 0, onStep?: StepFn): { outcomes: PathOutcome[]; samples: SamplePath[] } {
  const z = gaussian(mulberry32(seed));
  const outcomes: PathOutcome[] = [];
  const samples: SamplePath[] = [];
  for (let i = 0; i < n; i++) {
    const keep = i < sampleCount;
    const { out, prices } = runPath(p, vol, z, keep, onStep);
    outcomes.push(out);
    if (keep && prices) samples.push({ prices, reason: out.reason, exitDay: out.day });
  }
  return { outcomes, samples };
}

// 历史真实走法（第2组）：ratios是 count 段真实走势、每段 days+1 个"第d个日历日收盘价 ÷ 起点收盘价"（见lib/histPaths.ts），
// 按 indices 的顺序一段一段走（套到今天的股价上）。跟runBatch同样的规则判断和输出，只是走势换成真实出现过的。
export interface HistSource {
  ratios: Float32Array;
  days: number;
  indices: number[];
}
export function runBatchPaths(p: Prepared, hist: HistSource, sampleCount = 0, onStep?: StepFn): { outcomes: PathOutcome[]; samples: SamplePath[] } {
  const outcomes: PathOutcome[] = [];
  const samples: SamplePath[] = [];
  const w = hist.days + 1;
  hist.indices.forEach((idx, k) => {
    const base = idx * w;
    const keep = k < sampleCount;
    const next = (d: number) => {
      if (d > hist.days) return 1; // 超出这段真实走势的日子不再动（目前调用方都不会超）
      const prev = hist.ratios[base + d - 1];
      return prev > 0 ? hist.ratios[base + d] / prev : 1;
    };
    const { out, prices } = walkPath(p, next, keep, onStep);
    outcomes.push(out);
    if (keep && prices) samples.push({ prices, reason: out.reason, exitDay: out.day });
  });
  return { outcomes, samples };
}

// "一直拿到期"的结果（同一组走势、不管规则），用来跟按规则的结果对比。
export function holdOutcomes(outcomes: PathOutcome[], horizon: number): PathOutcome[] {
  return outcomes.map((o) => ({ reason: "expiry", day: horizon, pnl: o.holdPnl, price: o.price, holdPnl: o.holdPnl, cost: 0 }));
}

export interface ReasonStat {
  pct: number; // 0..100
  avgPnl: number;
  avgDay: number;
}

export interface SimStats {
  n: number;
  byReason: Record<ExitReason, ReasonStat>;
  avg: number;
  sd: number; // 单次盈亏的标准差——平均值的随机误差约为 sd/√n
  winPct: number;
  worst5: number; // 最差5%的平均
  min: number;
  max: number;
  avgDays: number;
  avgCost: number; // 平均每笔付的成交损耗（拿到期的算0）
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
}

export function computeStats(outcomes: PathOutcome[]): SimStats {
  const n = outcomes.length;
  const reasons: ExitReason[] = ["tp", "sl", "delta", "time", "expiry"];
  const byReason = {} as Record<ExitReason, ReasonStat>;
  for (const r of reasons) {
    const sel = outcomes.filter((o) => o.reason === r);
    byReason[r] = {
      pct: n ? (sel.length / n) * 100 : 0,
      avgPnl: sel.length ? sel.reduce((a, o) => a + o.pnl, 0) / sel.length : 0,
      avgDay: sel.length ? sel.reduce((a, o) => a + o.day, 0) / sel.length : 0,
    };
  }
  const sorted = outcomes.map((o) => o.pnl).sort((a, b) => a - b);
  const q = (f: number) => (n ? sorted[Math.min(n - 1, Math.max(0, Math.floor(f * (n - 1))))] : 0);
  const k = Math.max(1, Math.floor(n / 20));
  const avg = n ? sorted.reduce((a, b) => a + b, 0) / n : 0;
  return {
    n,
    byReason,
    avg,
    sd: n > 1 ? Math.sqrt(sorted.reduce((a, b) => a + (b - avg) ** 2, 0) / (n - 1)) : 0,
    winPct: n ? (outcomes.filter((o) => o.pnl > 0).length / n) * 100 : 0,
    worst5: n ? sorted.slice(0, k).reduce((a, b) => a + b, 0) / k : 0,
    min: n ? sorted[0] : 0,
    max: n ? sorted[n - 1] : 0,
    avgDays: n ? outcomes.reduce((a, o) => a + o.day, 0) / n : 0,
    avgCost: n ? outcomes.reduce((a, o) => a + (o.cost ?? 0), 0) / n : 0,
    percentiles: { p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) },
  };
}

export interface Histogram {
  lo: number;
  hi: number;
  counts: number[];
}

export function histogram(outcomes: PathOutcome[], bins = 30): Histogram {
  const vals = outcomes.map((o) => o.pnl);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (!(hi > lo)) {
    lo -= 1;
    hi += 1;
  }
  const counts = new Array(bins).fill(0);
  const w = (hi - lo) / bins;
  for (const v of vals) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w)))]++;
  return { lo, hi, counts };
}

// ── 批次稳定性 ────────────────────────────────────────────────

export interface Stability {
  similar: boolean;
  first: SimStats;
  all: SimStats;
}

// 第1批（1000条）跟10批合计（1万条）比：止盈比例差不超过4个百分点、止损差不超过3个百分点、
// 平均盈亏差不超过基准的10%，算"相仿"——第1批的结论可信；否则以合计为准。
export function batchStability(first: SimStats, all: SimStats, basis: number): Stability {
  const similar =
    Math.abs(first.byReason.tp.pct - all.byReason.tp.pct) <= 4 &&
    Math.abs(first.byReason.sl.pct - all.byReason.sl.pct) <= 3 &&
    Math.abs(first.avg - all.avg) <= 0.1 * basis;
  return { similar, first, all };
}

// ── 盈亏平衡波动率 ────────────────────────────────────────────

// 同一组随机数下，按实际波动vol走完规则后，相对起点平均多赚/多亏多少（每股，不含pnlOffset）。
export function meanIncrement(p: Prepared, vol: number, n: number, seed: number): number {
  const { outcomes } = runBatch(p, vol, n, seed);
  return outcomes.reduce((a, o) => a + o.pnl - p.pnlOffset, 0) / Math.max(1, n);
}

// 试算路数按计算量自适应：长期期权（每天都要重算）路数少一些，保证一两秒内算完。
export function curvePathCount(p: Prepared, evaluations: number, cap = 3000): number {
  const perPath = Math.max(1, p.endDay) * p.legs.length;
  return Math.max(200, Math.min(cap, Math.floor(1.2e7 / (evaluations * perPath))));
}

export interface CurvePoint {
  vol: number;
  avg: number; // 相对起点的平均盈亏增量（每股）
}

export interface Breakeven {
  vol: number | null; // null=范围内找不到平衡点
  // short：实际波动越低越赚（卖方）；long：越高越赚（买方）
  side: "short" | "long";
  // 找不到平衡点时，整段范围内平均都是赚(true)还是都亏(false)
  alwaysPositive?: boolean;
}

export function volGrid(center: number, assumed: number, count = 10): number[] {
  const lo = Math.max(0.05, Math.min(center, assumed) * 0.45);
  const hi = Math.max(lo + 0.05, Math.max(center, assumed) * 1.8);
  return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
}

export function breakevenCurve(p: Prepared, vols: number[], n: number, seed: number): CurvePoint[] {
  return vols.map((vol) => ({ vol, avg: meanIncrement(p, vol, n, seed) }));
}

export function findBreakeven(p: Prepared, curve: CurvePoint[], n: number, seed: number): Breakeven {
  const first = curve[0];
  const last = curve[curve.length - 1];
  const side: "short" | "long" = last.avg < first.avg ? "short" : "long";
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (a.avg === 0) return { vol: a.vol, side };
    if (Math.sign(a.avg) !== Math.sign(b.avg)) {
      let lo = a;
      let hi = b;
      for (let k = 0; k < 4; k++) {
        const mid = (lo.vol + hi.vol) / 2;
        const m = { vol: mid, avg: meanIncrement(p, mid, n, seed) };
        if (Math.sign(m.avg) === Math.sign(lo.avg)) lo = m;
        else hi = m;
      }
      const vol = lo.avg === hi.avg ? (lo.vol + hi.vol) / 2 : lo.vol + ((hi.vol - lo.vol) * lo.avg) / (lo.avg - hi.avg);
      return { vol, side };
    }
  }
  return { vol: null, side, alwaysPositive: curve.every((c) => c.avg > 0) };
}

export type CushionTier = "ample" | "thin" | "none";

// 开仓组合的净权利金绝对值（每股）——止盈止损的基准。含正股腿的组合没有合适的基准，返回null。
export function openingBasis(openingLegs: Leg[]): number | null {
  const active = openingLegs.filter((l) => !l.disabled);
  if (active.some((l) => l.kind === "stock")) return null;
  const net = active.reduce((s, l) => s + (l.action === "buy" ? 1 : -1) * (l.qty ?? 1) * l.premium, 0);
  return Math.abs(net) > 1e-6 ? Math.abs(net) : null;
}

// 开仓时是收钱（信用）还是付钱（借方）。
export function isCreditCombo(openingLegs: Leg[]): boolean {
  const net = openingLegs
    .filter((l) => !l.disabled && l.kind !== "stock")
    .reduce((s, l) => s + (l.action === "buy" ? 1 : -1) * (l.qty ?? 1) * l.premium, 0);
  return net < 0;
}

// ── 回看（今昔对比）：今天的真实结果排在"开仓那天看到的所有可能"里的哪儿（那团可能由futureSim.worker的retro请求算）──

// 真实结果比多少比例的可能情况好（0..100）。
export function percentileOf(sorted: number[], v: number): number {
  if (!sorted.length) return 50;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sorted.length) * 100;
}

// 开仓至今股价走了几个标准差（按开仓时的隐含波动率）。
export function moveInSigma(openSpot: number, nowSpot: number, vol: number, days: number): number {
  if (!(openSpot > 0) || !(nowSpot > 0) || !(vol > 0) || !(days > 0)) return 0;
  return Math.log(nowSpot / openSpot) / (vol * Math.sqrt(days / 365));
}

// ── 买方：方向性组合的"盈亏平衡年化涨跌" ──────────────────────────

// 起点附近的组合Delta（每股），除以期权腿张数之和得到"每张平均Delta"——判断这个组合主要靠方向还是靠波动赚钱。
export function deltaPerContract(p: Prepared): number {
  const h = p.spot * 0.005;
  const d = (simPnlAt(p, 0, p.spot + h) - simPnlAt(p, 0, p.spot - h)) / (2 * h);
  const contracts = p.legs.filter((l) => l.kind !== "stock").reduce((a, l) => a + (l.qty ?? 1), 0);
  return contracts > 0 ? d / contracts : 0;
}

export function driftGrid(): number[] {
  return [-0.6, -0.45, -0.3, -0.15, 0, 0.15, 0.3, 0.45, 0.6];
}

export interface DriftPoint {
  drift: number;
  avg: number;
}

// 同一组随机数、同样的实际波动，只改年化涨跌，看平均盈亏增量。
export function driftCurve(p: Prepared, vol: number, drifts: number[], n: number, seed: number): DriftPoint[] {
  return drifts.map((drift) => ({ drift, avg: meanIncrement({ ...p, drift }, vol, n, seed) }));
}

// 平均不亏需要的年化涨跌（向上需要涨=正数，向下需要跌=负数）；范围内找不到返回null。
export function findDriftBreakeven(p: Prepared, vol: number, curve: DriftPoint[], n: number, seed: number): number | null {
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (a.avg === 0) return a.drift;
    if (Math.sign(a.avg) !== Math.sign(b.avg)) {
      let lo = a;
      let hi = b;
      for (let k = 0; k < 4; k++) {
        const mid = (lo.drift + hi.drift) / 2;
        const m = { drift: mid, avg: meanIncrement({ ...p, drift: mid }, vol, n, seed) };
        if (Math.sign(m.avg) === Math.sign(lo.avg)) lo = m;
        else hi = m;
      }
      return lo.avg === hi.avg ? (lo.drift + hi.drift) / 2 : lo.drift + ((hi.drift - lo.drift) * lo.avg) / (lo.avg - hi.avg);
    }
  }
  return null;
}

// 方向安全垫：你假设的年化涨跌比"平均不亏需要的"多出多少个百分点（按需要的方向算）。≥10个百分点充足、≥3偏薄，否则没有优势。
export function driftCushion(required: number, assumed: number): { value: number; tier: CushionTier } {
  const value = required >= 0 ? assumed - required : required - assumed;
  const tier: CushionTier = value >= 0.1 ? "ample" : value >= 0.03 ? "thin" : "none";
  return { value, tier };
}

// 跟走势同一个模型（对数正态、按假设的实际波动和年化涨跌）：第days天时股价"走到target或更远"的概率。
// target在起点上方算"在target以上"，在下方算"在target以下"。分析模式用来说明滑块推演的情景点有多常见。
export function probPriceBeyond(spot: number, target: number, vol: number, drift: number, days: number): number {
  if (!(spot > 0) || !(target > 0) || !(vol > 0) || !(days > 0)) return target === spot ? 1 : 0;
  const t = days / 365;
  const z = (Math.log(target / spot) - (drift - 0.5 * vol * vol) * t) / (vol * Math.sqrt(t));
  return target >= spot ? 1 - ncdf(z) : ncdf(z);
}
