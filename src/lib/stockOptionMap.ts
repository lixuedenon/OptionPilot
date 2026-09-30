// src/lib/stockOptionMap.ts
// "股价 vs 期权价"标签的计算层：盈亏地形图网格（时间×股价→组合盈亏）+ 9种典型股价走势路径。
// 盈亏口径跟priceCombo完全一致（legShiftedPrice之和 − 开仓净权利金，每股计），
// 保证跟"盈亏图"标签同一个时间/股价/波动率下的数字相同。
import type { Leg } from "@/lib/types";
import { impliedVol, legShiftedPrice } from "@/lib/pricing";

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
}

export function buildMapModel(legs: Leg[], spot: number, dV: number, opts: MapOptions = {}, cols = 120, rows = 80): MapModel | null {
  if (legs.length === 0 || spot <= 0) return null;
  const options = legs.filter((l) => l.kind !== "stock");
  const horizon = options.length > 0 ? Math.max(1, Math.min(...options.map((l) => l.dte))) : 30;

  const ivs = legs.map((l) => (l.kind === "stock" ? undefined : impliedVol(spot, l.strike, l.dte, l.premium, l.type)));
  const netPremium = legs.reduce((sum, l) => {
    if (l.kind === "stock") return sum;
    const sign = l.action === "buy" ? 1 : -1;
    return sum + l.premium * sign * (l.qty ?? 1);
  }, 0);

  // 走势幅度只按开仓时的隐含波动率（不跟IV滑块），否则拖IV会同时改变"市场怎么走"和"期权怎么定价"两件事。
  const baseIv = averageIv(ivs);
  const move = spot * baseIv * Math.sqrt(horizon / 365);
  const start = opts.start && opts.start.day > 0 && opts.start.day < horizon && opts.start.price > 0
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
  sMin = Math.max(0.01, sMin);

  const legValuesAt = (day: number, price: number) => {
    const s = { dS: price - spot, dT: day, dV };
    return legs.map((l, i) => legShiftedPrice(l, s, spot, ivs[i]));
  };
  const pnlAt = (day: number, price: number) => {
    const s = { dS: price - spot, dT: day, dV };
    let v = 0;
    for (let i = 0; i < legs.length; i++) v += legShiftedPrice(legs[i], s, spot, ivs[i]);
    return v - netPremium;
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
