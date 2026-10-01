// src/lib/stockOptionMap.ts
// "股价 vs 期权价"标签的计算层：盈亏地形图网格（时间×股价→组合盈亏）+ 9种典型股价走势路径。
// 盈亏口径跟priceCombo完全一致（legShiftedPrice之和 − 开仓净权利金，每股计），
// 保证跟"盈亏图"标签同一个时间/股价/波动率下的数字相同。
import type { Leg } from "@/lib/types";
import { impliedVol, legShiftedPrice, resolveOpeningLeg } from "@/lib/pricing";
import { bsPrice } from "@/lib/bs";
import { calendarDaysBetween } from "@/lib/dateUtils";

export type PathId =
  | "up" | "down" | "flat"
  | "downUp" | "upDown"
  | "flatUp" | "flatDown"
  | "upFlat" | "downFlat";

// 子标签分组：对立的两条走势放在同一张图里（喇叭口）。
export const PATH_GROUPS: { id: string; paths: PathId[] }[] = [
  { id: "trend", paths: ["up", "down"] },
  { id: "flat", paths: ["flat"] },
  { id: "reversal", paths: ["downUp", "upDown"] },
  { id: "breakout", paths: ["flatUp", "flatDown"] },
  { id: "settle", paths: ["upFlat", "downFlat"] },
];

// 0→1的平滑过渡（两端斜率为0），让走势线看起来像行情而不是折线。
const ease = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

// 走势在"开仓价 + k × 一个标准差幅度"上的形状，u为时间进度0..1。
const SHAPES: Record<PathId, (u: number) => number> = {
  up: (u) => ease(u),
  down: (u) => -ease(u),
  flat: () => 0,
  // 反转：回头后冲过起点、一直走到另一侧更远处（±1.3），覆盖"回头后走出区间"的情况，而不是回到盈利区附近收尾。
  downUp: (u) => (u < 0.45 ? -0.8 * ease(u / 0.45) : -0.8 + 2.1 * ease((u - 0.45) / 0.55)),
  upDown: (u) => (u < 0.45 ? 0.8 * ease(u / 0.45) : 0.8 - 2.1 * ease((u - 0.45) / 0.55)),
  flatUp: (u) => (u < 0.5 ? 0 : ease((u - 0.5) / 0.5)),
  flatDown: (u) => (u < 0.5 ? 0 : -ease((u - 0.5) / 0.5)),
  upFlat: (u) => (u < 0.5 ? ease(u / 0.5) : 1),
  downFlat: (u) => (u < 0.5 ? -ease(u / 0.5) : -1),
};

// 权利金还没填好（0或极小）时反推出的IV接近下限，不可信——这种腿不参与平均，全都不可信就按30%。
function averageIv(ivs: (number | undefined)[]): number {
  const ok = ivs.filter((v): v is number => v !== undefined && Number.isFinite(v) && v > 0.03);
  return ok.length > 0 ? ok.reduce((a, b) => a + b, 0) / ok.length : 0.3;
}

// IV滑块显示的基准值：开仓时各期权腿隐含波动率的平均值。
export function comboBaseIv(legs: Leg[], spot: number): number | null {
  const options = legs.filter((l) => l.kind !== "stock");
  if (options.length === 0 || spot <= 0) return null;
  return averageIv(options.map((l) => impliedVol(spot, l.strike, l.dte, l.premium, l.type)));
}

export interface MapModel {
  horizon: number; // 天数：开仓(第0天)到最近到期日
  sMin: number;
  sMax: number;
  move: number; // 走势线的一个标准差幅度（按开仓时隐含波动率、从起点到到期的天数）
  baseIv: number; // 开仓时各期权腿隐含波动率的平均值（小数）
  cols: number;
  rows: number;
  grid: Float64Array; // rows×cols，row 0 = sMax（顶部）
  maxAbs: number;
  // 盈利、亏损各自的最大幅度——上色时分开换算深浅，避免"最大亏损远大于最大盈利"的组合盈利区颜色太淡。
  maxProfit: number;
  maxLoss: number;
  // 走势线/概率范围的起点：默认开仓日+开仓价；"从今天看"时是今天+现价。
  start: { day: number; price: number };
  strikes: number[];
  pnlAt: (day: number, price: number) => number;
  // 某一天、某个股价下每条腿的价值（带买卖方向符号，每股计），和组合净值 = 各腿之和。
  legValuesAt: (day: number, price: number) => number[];
  path: (id: PathId, day: number) => number; // day < start.day 时返回NaN（不画）
  // 按隐含波动率的k个标准差范围（对数正态），从起点算起：[下沿, 上沿]
  cone: (k: number, day: number) => [number, number];
}

export interface MapOptions {
  start?: { day: number; price: number };
  // 跟踪对比模式：legs是"今日组合"、spot是现价，推演从第timeOffset天（今天）开始；
  // 之前的日子没有推演（pnlAt返回NaN），盈亏统一加上pnlOffset（开仓至今的总盈亏），显示的是总账。
  timeOffset?: number;
  pnlOffset?: number;
  // 需要包进价格区间的额外价格（比如真实走过的历史股价）
  extraPrices?: number[];
}

export function buildMapModel(legs: Leg[], spot: number, dV: number, opts: MapOptions = {}, cols = 120, rows = 80): MapModel | null {
  if (legs.length === 0 || spot <= 0) return null;
  const options = legs.filter((l) => l.kind !== "stock");
  const t0 = Math.max(0, opts.timeOffset ?? 0);
  const pnlOffset = opts.pnlOffset ?? 0;
  const innerHorizon = options.length > 0 ? Math.max(1, Math.min(...options.map((l) => l.dte))) : 30;
  const horizon = t0 + innerHorizon;

  const ivs = legs.map((l) => (l.kind === "stock" ? undefined : impliedVol(spot, l.strike, l.dte, l.premium, l.type)));
  const netPremium = legs.reduce((sum, l) => {
    if (l.kind === "stock") return sum;
    const sign = l.action === "buy" ? 1 : -1;
    return sum + l.premium * sign * (l.qty ?? 1);
  }, 0);

  // 走势幅度只按开仓时的隐含波动率（不跟IV滑块），否则拖IV会同时改变"市场怎么走"和"期权怎么定价"两件事。
  const baseIv = averageIv(ivs);
  const move = spot * baseIv * Math.sqrt(innerHorizon / 365);
  const start = t0 > 0
    ? { day: t0, price: spot }
    : opts.start && opts.start.day > 0 && opts.start.day < horizon && opts.start.price > 0
      ? opts.start
      : { day: 0, price: spot };
  const remaining = horizon - start.day;
  const pathMove = start.price * baseIv * Math.sqrt(remaining / 365);

  const strikes = [...new Set(options.map((l) => l.strike))].sort((a, b) => a - b);
  let sMin = Math.min(spot - 1.6 * move, start.price - 1.6 * pathMove);
  let sMax = Math.max(spot + 1.6 * move, start.price + 1.6 * pathMove);
  // 让价格区间把行权价都包进来（留一点边），但不无限拉宽，避免远端行权价把图压扁。
  for (const k of strikes) {
    if (k < sMin && k > spot * 0.4) sMin = k - 0.15 * move;
    if (k > sMax && k < spot * 1.6) sMax = k + 0.15 * move;
  }
  for (const p of opts.extraPrices ?? []) {
    if (!(p > 0)) continue;
    if (p < sMin) sMin = p - 0.1 * move;
    if (p > sMax) sMax = p + 0.1 * move;
  }
  sMin = Math.max(0.01, sMin);

  const legValuesAt = (day: number, price: number) => {
    if (day < t0 - 1e-9) return legs.map(() => NaN);
    const s = { dS: price - spot, dT: day - t0, dV };
    return legs.map((l, i) => legShiftedPrice(l, s, spot, ivs[i]));
  };
  const pnlAt = (day: number, price: number) => {
    if (day < t0 - 1e-9) return NaN;
    const s = { dS: price - spot, dT: day - t0, dV };
    let v = 0;
    for (let i = 0; i < legs.length; i++) v += legShiftedPrice(legs[i], s, spot, ivs[i]);
    return v - netPremium + pnlOffset;
  };

  const grid = new Float64Array(rows * cols);
  let maxAbs = 0;
  let maxProfit = 0;
  let maxLoss = 0;
  for (let r = 0; r < rows; r++) {
    const price = sMax - (r / (rows - 1)) * (sMax - sMin);
    for (let c = 0; c < cols; c++) {
      const day = (c / (cols - 1)) * horizon;
      const v = pnlAt(day, price);
      grid[r * cols + c] = v;
      if (!Number.isFinite(v)) continue;
      if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
      if (v > maxProfit) maxProfit = v;
      if (-v > maxLoss) maxLoss = -v;
    }
  }

  const path = (id: PathId, day: number) =>
    day < start.day - 1e-9 ? NaN : start.price + SHAPES[id]((day - start.day) / remaining) * pathMove;
  const cone = (k: number, day: number): [number, number] => {
    const t = Math.max(0, day - start.day) / 365;
    const w = k * baseIv * Math.sqrt(t);
    return [start.price * Math.exp(-w), start.price * Math.exp(w)];
  };

  return {
    horizon, sMin, sMax, move: pathMove, baseIv, cols, rows, grid,
    maxAbs: maxAbs || 1, maxProfit: maxProfit || 1, maxLoss: maxLoss || 1,
    start, strikes, pnlAt, legValuesAt, path, cone,
  };
}

export interface PathSummary {
  end: number;
  best: number;
  worst: number;
}

export function summarizePath(model: MapModel, id: PathId, steps = 60): PathSummary {
  let best = -Infinity;
  let worst = Infinity;
  let end = 0;
  for (let i = 0; i <= steps; i++) {
    const day = model.start.day + (i / steps) * (model.horizon - model.start.day);
    const v = model.pnlAt(day, model.path(id, day));
    if (v > best) best = v;
    if (v < worst) worst = v;
    if (i === steps) end = v;
  }
  return { end, best, worst };
}

// ── 跟踪对比模式 ──────────────────────────────────────────────

// 某个时刻"今日组合"相对开仓组合的总盈亏（每股计）：未平仓腿按当时权利金对比开仓权利金，
// 再加上已平仓/展期掉的腿已实现的closedPnl。跟useComboAnalytics的trackedResult.change + realizedTrackedPnl同一口径。
export function trackedTotalPnl(openingLegs: Leg[], legsNow: Leg[], spotNow: number, openingSpot: number): number {
  const openActive = openingLegs.filter((l) => !l.disabled);
  const openingById = new Map(openActive.map((l) => [l.id, l]));
  let total = 0;
  legsNow.filter((l) => !l.disabled).forEach((leg, index) => {
    const o = resolveOpeningLeg(leg, index, openActive, openingById);
    const sign = leg.action === "buy" ? 1 : -1;
    const qty = leg.kind === "stock" ? 1 : (leg.qty ?? 1);
    const shifted = leg.kind === "stock" ? sign * (spotNow - leg.strike) : sign * qty * leg.premium;
    const oSign = o?.action === "buy" ? 1 : -1;
    const base = o ? (o.kind === "stock" ? oSign * (openingSpot - o.strike) : oSign * qty * o.premium) : 0;
    total += shifted - base;
  });
  for (const l of legsNow) total += l.closedPnl ?? 0;
  return total;
}

export interface HistoryPoint {
  day: number; // 开仓后第几天
  price: number;
  pnl: number; // 当时的总盈亏
  estimated?: boolean; // 自动回填的估算快照
}

export interface AdjustMarker {
  day: number;
  via: "roll" | "protect" | "hedge";
}

// 从开仓到今天真实走过的路：开仓点 + 每条快照（按时间排序）；以及每次展期/保护/对冲第一次出现的那天。
export function buildTrackedHistory(
  snapshots: { legs: Leg[]; spot: number; savedAt: number; estimated?: boolean }[],
  openingLegs: Leg[],
  openingSpot: number,
  openingAt: number,
): { points: HistoryPoint[]; markers: AdjustMarker[] } {
  const points: HistoryPoint[] = [{ day: 0, price: openingSpot, pnl: 0 }];
  const markers: AdjustMarker[] = [];
  const seen = new Set<string>();
  for (const l of openingLegs) if (l.derivedFrom) seen.add(l.id);
  const sorted = [...snapshots].sort((a, b) => a.savedAt - b.savedAt);
  for (const sn of sorted) {
    const day = Math.max(0, calendarDaysBetween(openingAt, sn.savedAt));
    if (sn.spot > 0) {
      points.push({ day, price: sn.spot, pnl: trackedTotalPnl(openingLegs, sn.legs, sn.spot, openingSpot), estimated: sn.estimated });
    }
    for (const l of sn.legs) {
      if (l.derivedFrom && !seen.has(l.id)) {
        seen.add(l.id);
        markers.push({ day, via: l.derivedFrom.via });
      }
    }
  }
  return { points, markers };
}

// ── 今昔对比：把开仓至今的总盈亏逐段拆回股价/时间/波动率/调整 ──────────────

export interface PnlParts {
  price: number; // 股价变化带来的
  time: number; // 时间流逝带来的
  iv: number; // 隐含波动率变化带来的
  adjust: number; // 展期/平仓/保护/对冲等调整（已实现部分、新增或去掉的腿）
}

export interface TrackedState {
  legs: Leg[];
  spot: number;
  day: number; // 开仓后第几天
  pnl: number; // 这个时刻开仓以来的总盈亏（含已实现）
  estimated?: boolean;
}

export interface SegmentAttribution extends PnlParts {
  fromDay: number;
  toDay: number;
  total: number;
  estimated: boolean;
}

const RATE = 0.05; // 跟pricing.ts的定价利率一致

function legPriceAt(l: Leg, S: number, dte: number, iv: number): number {
  if (l.kind === "stock") return S;
  if (dte <= 0) return l.type === "call" ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S);
  return bsPrice(Math.max(0.01, S), l.strike, dte, Math.max(0.01, iv), RATE, l.type);
}

// 两个时刻之间"同一条腿"的配对：先按id/openLegId，再按(买卖、类型、行权价、到期那天、张数)。
function matchLegs(a: TrackedState, b: TrackedState): [Leg, Leg][] {
  const aLegs = a.legs.filter((l) => !l.disabled);
  const bLegs = b.legs.filter((l) => !l.disabled);
  const used = new Set<Leg>();
  const pairs: [Leg, Leg][] = [];
  const key = (l: Leg) => `${l.kind ?? "opt"}|${l.action}|${l.type}|${l.strike}|${l.qty ?? 1}`;
  const expiry = (l: Leg, day: number) => day + l.dte;
  for (const la of aLegs) {
    let hit = bLegs.find((lb) => !used.has(lb) && (lb.id === la.id || lb.openLegId === la.id || (la.openLegId && lb.openLegId === la.openLegId)));
    if (!hit) {
      hit = bLegs.find(
        (lb) => !used.has(lb) && key(lb) === key(la) && (la.kind === "stock" || Math.abs(expiry(lb, b.day) - expiry(la, a.day)) <= 2),
      );
    }
    if (hit) {
      used.add(hit);
      pairs.push([la, hit]);
    }
  }
  return pairs;
}

// 逐段、按顺序拆：先只动股价（沿用前一时刻的剩余天数和隐含波动率），再加上时间，剩下的就是隐含波动率——三部分加起来正好等于这条腿的价值变化。
// 两个时刻都有的腿按这个办法拆；其余（新开/平掉/展期）的变化都算"调整"，所以四部分之和=总盈亏变化。
export function attributeSegment(a: TrackedState, b: TrackedState): PnlParts {
  let price = 0;
  let time = 0;
  let iv = 0;
  for (const [la, lb] of matchLegs(a, b)) {
    const sign = la.action === "buy" ? 1 : -1;
    if (la.kind === "stock") {
      price += sign * (b.spot - a.spot);
      continue;
    }
    const q = sign * (la.qty ?? 1);
    const ivA = impliedVol(a.spot, la.strike, la.dte, la.premium, la.type);
    const p1 = legPriceAt(la, b.spot, la.dte, ivA);
    const p2 = legPriceAt(la, b.spot, lb.dte, ivA);
    price += q * (p1 - la.premium);
    time += q * (p2 - p1);
    iv += q * (lb.premium - p2);
  }
  const total = b.pnl - a.pnl;
  return { price, time, iv, adjust: total - price - time - iv };
}

export function buildAttributionTimeline(states: TrackedState[]): { segments: SegmentAttribution[]; totals: PnlParts & { total: number } } {
  const sorted = [...states].sort((x, y) => x.day - y.day);
  const segments: SegmentAttribution[] = [];
  const totals = { price: 0, time: 0, iv: 0, adjust: 0, total: 0 };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const parts = attributeSegment(a, b);
    const total = b.pnl - a.pnl;
    // 终点是估算快照时，它沿用前一个真实状态的隐含波动率，这一段只有股价和时间；终点是真实快照时，波动率变化是真的（从上一个真实状态累积过来）。
    segments.push({ ...parts, fromDay: a.day, toDay: b.day, total, estimated: !!b.estimated });
    totals.price += parts.price;
    totals.time += parts.time;
    totals.iv += parts.iv;
    totals.adjust += parts.adjust;
    totals.total += total;
  }
  return { segments, totals };
}
