// src/lib/futureSim.ts
// "万次推演"（分析模式）的统计层：在winRateSim的逐日走势上，累计画图要用的密度云、下车点、到期落点。
// 走势、定价、规则判断全部沿用winRateSim（同一个runBatch），这里只做"看得见"的汇总。
import { runBatch, runBatchPaths, prepareSim, computeStats, simPnlAt, maxShortDelta, type HistSource, type Prepared, type PathOutcome, type ExitReason, type SimRules, type SimSetup } from "@/lib/winRateSim";

// 密度网格：横轴按天（第0天..horizon），纵轴按股价分rows格（row 0 = sMax，跟地形图一致）。
export interface GridSpec {
  sMin: number;
  sMax: number;
  rows: number;
  days: number; // 横轴总天数（从开仓算）
}

export interface Density {
  holding: Float32Array; // 还按规则拿着的走势经过的次数，(days+1)×rows，下标 day*rows+row
  after: Float32Array; // 已经下车、只是接着画完的走势
}

export function newDensity(spec: GridSpec): Density {
  const n = (spec.days + 1) * spec.rows;
  return { holding: new Float32Array(n), after: new Float32Array(n) };
}

export function rowOf(spec: GridSpec, price: number): number {
  const f = (spec.sMax - price) / (spec.sMax - spec.sMin);
  return Math.min(spec.rows - 1, Math.max(0, Math.floor(f * spec.rows)));
}

export interface ExitPoint {
  day: number;
  price: number;
  reason: ExitReason;
}

// 到期（或按规则提前平仓那天）还拿着的走势落在哪个价位：每格的次数和平均盈亏（用来上色）。
export interface EndDist {
  counts: number[];
  pnlSum: number[];
}

export interface CloudRun {
  outcomes: PathOutcome[];
  samples: { prices: number[]; reason: ExitReason; exitDay: number }[];
  exits: ExitPoint[];
  end: EndDist;
}

// 跑一批走势，同时把密度累计进density（dayOffset：分叉云从情景点那天开始，横轴要往后挪）。
export function runCloud(
  p: Prepared, vol: number, n: number, seed: number, spec: GridSpec, density: Density,
  opts: { samples?: number; exitSamples?: number; dayOffset?: number; extraStep?: (day: number, price: number) => void; hist?: HistSource } = {},
): CloudRun {
  const off = opts.dayOffset ?? 0;
  const onStep = (day: number, price: number, holding: boolean) => {
    opts.extraStep?.(day, price);
    const d = day + off;
    if (d > spec.days || price < spec.sMin || price > spec.sMax) return;
    (holding ? density.holding : density.after)[d * spec.rows + rowOf(spec, price)] += 1;
  };
  // 传了hist就走真实出现过的走势（n、seed、vol不用）
  const { outcomes, samples } = opts.hist ? runBatchPaths(p, opts.hist, opts.samples ?? 0, onStep) : runBatch(p, vol, n, seed, opts.samples ?? 0, onStep);
  const exits: ExitPoint[] = [];
  const end: EndDist = { counts: new Array(spec.rows).fill(0), pnlSum: new Array(spec.rows).fill(0) };
  const maxExits = opts.exitSamples ?? 80;
  for (const o of outcomes) {
    if ((o.reason === "tp" || o.reason === "sl" || o.reason === "delta") && exits.length < maxExits) exits.push({ day: o.day + off, price: o.price, reason: o.reason });
    // 落在图的价格范围外的不计入（否则全堆在最上/最下一格，画出来像一根假的长条）
    if ((o.reason === "time" || o.reason === "expiry") && o.price >= spec.sMin && o.price <= spec.sMax) {
      const r = rowOf(spec, o.price);
      end.counts[r] += 1;
      end.pnlSum[r] += o.pnl;
    }
  }
  return { outcomes, samples, exits, end };
}

// 分叉云的起点：跟持仓建议卡片完全同一组输入（同样的腿位/股价/盈亏/种子/条数），两边的概率才一致。
export const FORK_SEED = 20261001;
export const FORK_PATHS = 1500;

// 今昔对比"规则复盘"：沿真实走过的路（开仓点→各快照→今天，盈亏是当时的总账），按你的规则第一次该下车的那一点。
// 止盈止损线和"到期前平仓"的那一天用p（开仓组合按规则准备好的Prepared）。地形图和万次推演回看共用，两边说的是同一天。
export interface RuleExit {
  day: number;
  price: number;
  pnl: number;
  kind: "tp" | "sl" | "delta" | "time";
}
// 跟万次推演walkPath同一顺序：过了"到点平仓"那天就按到点平仓算（真实操作里那天就平了，后面的快照碰不碰线已经无关）；
// 否则止盈 → 止损 → 卖出腿Delta碰线。
export function replayRules(points: { day: number; price: number; pnl: number }[], p: Prepared): RuleExit | null {
  const pts = [...points].filter((x) => x.day > 0).sort((a, b) => a.day - b.day);
  for (const x of pts) {
    if (p.closeAtRemaining > 0 && x.day >= p.endDay) return { ...x, kind: "time" };
    if (x.pnl >= p.tpLine) return { ...x, kind: "tp" };
    if (x.pnl <= p.slLine) return { ...x, kind: "sl" };
    if (p.deltaExit != null && x.day < p.horizon && maxShortDelta(p, x.day, x.price) >= p.deltaExit) return { ...x, kind: "delta" };
  }
  return null;
}

// ── 换个规则试试：同一组走势（同一个种子、同样条数）下，几种常见的止盈/止损/平仓规则跟你现在的比 ──
// 只有"明显更好"才建议：平均每次多赚超过随机误差的2倍且至少是基准的2%（最坏5%不能差10%以上），
// 或最坏5%少亏两成以上而平均不比现在差（超出随机误差）。逐条走势配对相减算误差：同一组走势，规则之间的差别比两次独立模拟稳得多。
export const RULE_CANDIDATES: Record<"credit" | "debit", SimRules[]> = {
  credit: [
    // 第3组：卖出腿Delta到0.30/0.40就平仓（卖方常用的管理规则）
    { takeProfitPct: 0.5, stopMult: null, closeFrac: 0.25, deltaExit: 0.3 },
    { takeProfitPct: 0.5, stopMult: 2, closeFrac: 0, deltaExit: 0.4 },
    { takeProfitPct: 0.5, stopMult: 2, closeFrac: 0.25 },
    { takeProfitPct: 0.5, stopMult: null, closeFrac: 0.25 },
    { takeProfitPct: 0.5, stopMult: 1, closeFrac: 0 },
    { takeProfitPct: 0.75, stopMult: 2, closeFrac: 0 },
    { takeProfitPct: 0.25, stopMult: 1, closeFrac: 0 },
    { takeProfitPct: null, stopMult: null, closeFrac: 0 },
  ],
  debit: [
    { takeProfitPct: 1, stopMult: 0.5, closeFrac: 1 / 3 },
    { takeProfitPct: 2, stopMult: 0.5, closeFrac: 0 },
    { takeProfitPct: 0.5, stopMult: 0.25, closeFrac: 0 },
    { takeProfitPct: 1, stopMult: null, closeFrac: 1 / 3 },
    { takeProfitPct: null, stopMult: 0.5, closeFrac: 0 },
    { takeProfitPct: null, stopMult: null, closeFrac: 0 },
  ],
};

const sameRules = (a: SimRules, b: SimRules) =>
  a.takeProfitPct === b.takeProfitPct && a.stopMult === b.stopMult && Math.abs(a.closeFrac - b.closeFrac) < 1e-9 && (a.deltaExit ?? null) === (b.deltaExit ?? null);

export interface RuleScore {
  rules: SimRules;
  avg: number; // 每笔平均（已扣成交损耗）
  worst5: number;
  winPct: number;
  avgDays: number; // 平均拿几天
  avgCost: number; // 平均每笔成交损耗
  per30: number; // 折算每30天：每笔平均 ÷ 平均拿的天数 × 30（平仓后马上能再开一笔差不多的前提下）
}
// 第3组：规则对比表的一行（同一组走势，跟现在的规则逐条配对相减算差别的随机误差）
export interface RuleRow extends RuleScore {
  current: boolean;
  diff: number; // 每笔平均比现在的规则多/少多少
  se: number; // diff的随机误差（配对）
}
export interface RuleSuggestion {
  tried: number; // 试了几种（不含现在的）
  current: RuleScore;
  best: (RuleScore & { why: "avg" | "worst" }) | null;
  rows: RuleRow[]; // 现在的规则 + 试过的几种，表格用
}
const scoreOf = (rules: SimRules, st: ReturnType<typeof computeStats>): RuleScore => ({
  rules, avg: st.avg, worst5: st.worst5, winPct: st.winPct, avgDays: st.avgDays, avgCost: st.avgCost, per30: (st.avg / Math.max(1, st.avgDays)) * 30,
});

export function suggestRules(setup: SimSetup, vol: number, n: number, seed: number, side: "credit" | "debit", hist?: HistSource): RuleSuggestion | null {
  const run = (rules: SimRules) => {
    const p = prepareSim({ ...setup, rules });
    return p ? { p, outcomes: hist ? runBatchPaths(p, hist).outcomes : runBatch(p, vol, n, seed).outcomes } : null;
  };
  if (hist) n = hist.indices.length;
  const cur = run(setup.rules);
  if (!cur) return null;
  const cs = computeStats(cur.outcomes);
  const current: RuleScore = scoreOf(setup.rules, cs);
  const rows: RuleRow[] = [{ ...current, current: true, diff: 0, se: 0 }];
  const basis = cur.p.basis;
  // Delta规则的线要比开仓时卖出腿的Delta高出一截才有意义（平值卖出腿开仓Delta就有0.45，"到0.40就走"等于第二天就平）
  const startDelta = maxShortDelta(cur.p, 0, cur.p.spot);
  const list = RULE_CANDIDATES[side].filter((r) => !sameRules(r, setup.rules) && (r.deltaExit == null || r.deltaExit > startDelta + 0.05));
  let best: RuleSuggestion["best"] = null;
  let bestScore = -Infinity;
  for (const rules of list) {
    const alt = run(rules);
    if (!alt) continue;
    const st = computeStats(alt.outcomes);
    let sum = 0, sq = 0;
    for (let i = 0; i < n; i++) {
      const d = alt.outcomes[i].pnl - cur.outcomes[i].pnl;
      sum += d;
      sq += d * d;
    }
    const mean = sum / n;
    const se = Math.sqrt(Math.max(0, sq / n - mean * mean) / Math.max(1, n - 1));
    rows.push({ ...scoreOf(rules, st), current: false, diff: mean, se });
    const noise = Math.max(2 * se, 0.01 * basis);
    const worseTail = cs.worst5 < 0 && st.worst5 < cs.worst5 * 1.1;
    const avgBetter = mean > Math.max(2 * se, 0.02 * basis) && !worseTail;
    const tailBetter = cs.worst5 < 0 && st.worst5 >= cs.worst5 * 0.8 && mean >= -noise;
    if (!avgBetter && !tailBetter) continue;
    const score = mean / basis + 0.5 * ((st.worst5 - cs.worst5) / basis);
    if (score > bestScore) {
      bestScore = score;
      best = { ...scoreOf(rules, st), why: avgBetter ? "avg" : "worst" };
    }
  }
  return { tried: list.length, current, best, rows };
}

// ── 平面图：股价范围带 + 典型结局 ──────────────────────────────────────
// 每条走势每天的股价都记下来（不管有没有下车）：画"股价可能在哪"的范围带要用全部走势——只用还拿着的会有偏差
// （涨上去的早早止盈走了，剩下的偏低，范围带看起来会一天比一天往下沉）。
export class PriceStore {
  readonly days: number;
  readonly data: Float32Array;
  private idx = -1;
  filled = 0;
  constructor(n: number, days: number) {
    this.days = days;
    this.data = new Float32Array(n * (days + 1));
  }
  // runCloud的extraStep：每条走势按第0天、第1天…依次调用，第0天就是换到下一条
  step = (day: number, price: number) => {
    if (day === 0) {
      this.idx++;
      this.filled = this.idx + 1;
    }
    if (day <= this.days && this.idx * (this.days + 1) + day < this.data.length) this.data[this.idx * (this.days + 1) + day] = price;
  };
  path(i: number): number[] {
    return Array.from(this.data.subarray(i * (this.days + 1), (i + 1) * (this.days + 1)));
  }
}

export interface Band {
  day: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

// 范围带：最多取maxCols个日子（长期期权每天都排序太慢，画图也用不着那么细），其余日子画的时候连线。
export function priceBands(store: PriceStore, maxCols = 60): Band[] {
  const n = store.filled;
  if (n === 0) return [];
  const step = Math.max(1, Math.ceil(store.days / maxCols));
  const days: number[] = [];
  for (let d = 0; d <= store.days; d += step) days.push(d);
  if (days[days.length - 1] !== store.days) days.push(store.days);
  const col = new Float32Array(n);
  const q = (f: number) => col[Math.min(n - 1, Math.floor(f * (n - 1)))];
  return days.map((day) => {
    for (let i = 0; i < n; i++) col[i] = store.data[i * (store.days + 1) + day];
    col.sort();
    return { day, p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) };
  });
}

// 典型结局：按你的规则把1万条走势分成几类（加起来=100%），每类挑一条最典型的给图上画。
// 止盈/止损/到时间平仓这几类取下车天数居中的那条；拿到期的取到期盈亏居中的那条。
export type StoryKind = "tp" | "sl" | "delta" | "time" | "win" | "loss";
export interface Story {
  kind: StoryKind;
  share: number; // 0..100
  day: number; // 下车（或到期）那天
  pnl: number;
  prices: number[]; // 这条走势从第0天到最早到期日的股价（下车后也接着记）
  // 这条走势每天"一直拿着"的盈亏（第0天..最早到期日，含pnlOffset）：下车前就是真实走过的钱，下车后是"要是还拿着会怎样"（画虚线）。
  // 传了p才有。
  pnls?: number[];
  index: number; // 这条走势在全部走势里的下标（历史真实走法时用来找它是哪一段）
  start?: number; // 历史真实走法：这一段在历史上从哪天开始（unix秒），worker填
}
export function pickStories(outcomes: PathOutcome[], store: PriceStore, max = 4, p?: Prepared): Story[] {
  const groups = new Map<StoryKind, number[]>();
  outcomes.forEach((o, i) => {
    const k: StoryKind = o.reason === "expiry" ? (o.pnl >= 0 ? "win" : "loss") : o.reason;
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });
  const n = outcomes.length || 1;
  const all = [...groups.entries()].map(([kind, idx]) => {
    const byDay = kind === "win" || kind === "loss" ? (i: number) => outcomes[i].pnl : (i: number) => outcomes[i].day;
    const sorted = [...idx].sort((a, b) => byDay(a) - byDay(b));
    const pick = sorted[Math.floor(sorted.length / 2)];
    const o = outcomes[pick];
    const prices = store.path(pick);
    const pnls = p ? prices.map((price, d) => (d === 0 ? p.pnlOffset : simPnlAt(p, d, price))) : undefined;
    return { kind, share: (idx.length / n) * 100, day: o.day, pnl: o.pnl, prices, pnls, index: pick };
  });
  all.sort((a, b) => b.share - a.share);
  const out = all.slice(0, Math.min(max, 3));
  // 亏钱的那一类哪怕很少也要画出来——这正是用户最该看到的
  for (const k of ["sl", "loss"] as StoryKind[]) {
    const s = all.find((x) => x.kind === k);
    if (s && !out.includes(s) && out.length < max) out.push(s);
  }
  return out;
}

// ── ⑤ 你的钱会怎么变：同一批走势每天的盈亏范围 ──────────────────────────
// 每条走势：下车之前是那天的盈亏（simPnlAt），下车之后停在下车时的盈亏（钱已经落袋/认亏，不再变）。
// 跟股价范围带用同一批走势（PriceStore + outcomes，下标一一对应）。长期期权每天每条都重新定价太慢：
// 日子最多取maxCols个，走势最多取maxPaths条（等间隔抽，固定种子下结果可复现）。
export function moneyBands(store: PriceStore, outcomes: PathOutcome[], p: Prepared, maxCols = 60, maxPaths = 4000): Band[] {
  const n = Math.min(store.filled, outcomes.length);
  if (n === 0) return [];
  const stride = Math.max(1, Math.ceil(n / maxPaths));
  const ids: number[] = [];
  for (let i = 0; i < n; i += stride) ids.push(i);
  const step = Math.max(1, Math.ceil(store.days / maxCols));
  const days: number[] = [];
  for (let d = 0; d <= store.days; d += step) days.push(d);
  if (days[days.length - 1] !== store.days) days.push(store.days);
  const m = ids.length;
  const col = new Float32Array(m);
  const q = (f: number) => col[Math.min(m - 1, Math.floor(f * (m - 1)))];
  return days.map((day) => {
    for (let k = 0; k < m; k++) {
      const i = ids[k];
      const o = outcomes[i];
      col[k] = day === 0 ? p.pnlOffset : day >= o.day ? o.pnl : simPnlAt(p, day, store.data[i * (store.days + 1) + day]);
    }
    col.sort();
    return { day, p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) };
  });
}
