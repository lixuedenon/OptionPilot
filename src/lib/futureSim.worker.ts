// src/lib/futureSim.worker.ts
// "万次推演"的后台线程。main：从开仓出发跑10批×1000条，逐批回传累计的密度云和下车点（动画），最后回传合计、
// "一直拿到期"的对比、到期落点、换几种规则的对比和盈亏平衡波动率；fork：从情景点出发再跑一团（跟持仓建议卡片同一组走势）。
import {
  prepareSim, simPnlAt, mulberry32, runBatch, computeStats, histogram, holdOutcomes, breakevenCurve, findBreakeven, curvePathCount, volGrid, deltaPerContract, driftGrid, driftCurve, findDriftBreakeven,
  type SimSetup, type SimStats, type Histogram, type CurvePoint, type Breakeven, type DriftPoint, type PathOutcome,
} from "./winRateSim";
import { newDensity, runCloud, suggestRules, PriceStore, priceBands, pickStories, moneyBands, FORK_PATHS, FORK_SEED, type GridSpec, type ExitPoint, type EndDist, type RuleSuggestion, type Band, type Story } from "./futureSim";

// 历史真实走法（第2组）：主线程把收盘价切好（lib/histPaths.ts）传进来；不传=随机走法。
export interface HistInput {
  ratios: Float32Array;
  days: number;
  count: number;
  starts: number[];
  vols: number[];
  to: number; // 数据最后一天（unix秒）
}
// 这个胜率稳不稳：同样的规则放到不同时期 / 最动荡、最平静的几段里，各自赚钱的比例
export type StabKey = "y1" | "y2" | "y5" | "y10" | "hiVol" | "loVol";
export interface StabRow {
  key: StabKey;
  n: number;
  win: number; // 0..100
  avg: number;
}

export type FutureRequest =
  | { kind: "main"; runId: number; setup: SimSetup; vol: number; ivCenter: number; batches: number; perBatch: number; samples: number; seed: number; grid: GridSpec; debit: boolean; hist?: HistInput;
      // 财报这一组：setup里带了财报跳空时，另外按"不加跳空"（波动用noEarnVol）跑一小批，结论卡片说"加了跳空后变了多少"
      noEarnVol?: number }
  | { kind: "fork"; runId: number; setup: SimSetup; vol: number; startDay: number; samples: number; grid: GridSpec; hist?: HistInput }
  // 回看：站在开仓那天，按开仓时的隐含波动率（市场当时的预期），组合不动走到今天（grid.days=今天是第几天）。
  // checkDays：真实路径上存过快照的那几天，回传那几天5000条走势的股价和盈亏（排好序），用来说"那天你在第几位"。
  | { kind: "retro"; runId: number; setup: SimSetup; vol: number; n: number; samples: number; seed: number; grid: GridSpec; checkDays: number[] };

export interface RetroDay {
  day: number;
  prices: number[]; // 这一天5000条走势的股价，从小到大
  pnls: number[]; // 这一天的盈亏（按开仓时的隐含波动率），从小到大
}

export interface Sample {
  prices: number[];
  reason: PathOutcome["reason"];
  exitDay: number;
}

export type FutureResponse =
  // bands：到这一批为止全部走势每天股价的范围（平面图的范围带）
  | { runId: number; type: "batch"; index: number; stats: SimStats; holding: Float32Array; after: Float32Array; exits: ExitPoint[]; samples: Sample[]; bands: Band[] }
  // exitDays：每天有多少条按各规则下车（下标=第几天），用来说"走到情景那天之前已经有多少下车了"
  | { runId: number; type: "done"; stats: SimStats; hold: SimStats; first: SimStats; hist: Histogram; end: EndDist; avgWin: number; avgLoss: number; holdAvgWin: number; holdAvgLoss: number; exitDays: Record<"tp" | "sl" | "delta" | "time", number[]>; stories: Story[]; endPrices: number[]; money: Band[];
      // 跟只买股票比：同一批走势、同样的天数，股价最后涨了的比例和平均涨跌（小数）
      stock: { win: number; avg: number };
      stab: StabRow[] | null }
  | { runId: number; type: "alt"; suggestion: RuleSuggestion | null }
  | { runId: number; type: "earn"; without: SimStats }
  | { runId: number; type: "curve"; curve: CurvePoint[]; breakeven: Breakeven; delta: number; driftCurve: DriftPoint[] | null; driftBreakeven: number | null }
  | { runId: number; type: "fork"; stats: SimStats; holding: Float32Array; samples: Sample[]; end: EndDist }
  | { runId: number; type: "retro"; sorted: number[]; prices: number[]; days: RetroDay[]; holding: Float32Array; samples: Sample[]; end: EndDist; bands: Band[] }
  | { runId: number; type: "error"; message: string };

const ALT_SEED = 20261003;
// 历史走法的分叉云：段数超过FORK_PATHS时在全部段里等间隔挑（段是按日期排的，取前面的会只剩最早那几年的行情）
function forkIndices(count: number): number[] {
  const n = Math.min(count, FORK_PATHS);
  return Array.from({ length: n }, (_, i) => Math.floor((i * count) / n));
}
const post = (msg: FutureResponse) => (self as unknown as Worker).postMessage(msg);

function winLoss(os: PathOutcome[], key: "pnl" | "holdPnl") {
  let w = 0, wn = 0, l = 0, ln = 0;
  for (const o of os) {
    const v = o[key];
    if (v > 0) { w += v; wn++; } else if (v < 0) { l += v; ln++; }
  }
  return { win: wn ? w / wn : 0, loss: ln ? l / ln : 0 };
}

self.onmessage = (e: MessageEvent<FutureRequest>) => {
  const req = e.data;
  try {
    const p = prepareSim(req.setup);
    if (!p) {
      post({ runId: req.runId, type: "error", message: "unsupported" });
      return;
    }
    if (req.kind === "retro") {
      const density = newDensity(req.grid);
      const pe = { ...p, endDay: Math.min(p.horizon, req.grid.days) };
      const check = new Map<number, { prices: number[]; pnls: number[] }>();
      for (const d of req.checkDays) if (d > 0 && d < pe.endDay) check.set(d, { prices: [], pnls: [] });
      const store = new PriceStore(req.n, pe.endDay);
      const extraStep = (day: number, price: number) => {
        store.step(day, price);
        const c = check.get(day);
        if (c) {
          c.prices.push(price);
          c.pnls.push(simPnlAt(pe, day, price));
        }
      };
      const run = runCloud(pe, req.vol, req.n, req.seed, req.grid, density, { samples: req.samples, exitSamples: 0, extraStep });
      const asc = (a: number, b: number) => a - b;
      const days: RetroDay[] = [...check.entries()].map(([day, c]) => ({ day, prices: c.prices.sort(asc), pnls: c.pnls.sort(asc) }));
      post({
        // 回看问的是"一直拿着到今天值多少"：不扣平仓的成交损耗（跟上面checkDays那几天的口径一致）
        runId: req.runId, type: "retro", sorted: run.outcomes.map((o) => o.pnl + (o.cost ?? 0)).sort(asc), prices: run.outcomes.map((o) => o.price).sort(asc), days,
        holding: density.holding, samples: run.samples, end: run.end, bands: priceBands(store),
      });
      return;
    }
    if (req.kind === "fork") {
      const density = newDensity(req.grid);
      const hist = req.hist ? { ratios: req.hist.ratios, days: req.hist.days, indices: forkIndices(req.hist.count) } : undefined;
      const run = runCloud(p, req.vol, FORK_PATHS, FORK_SEED, req.grid, density, { samples: req.samples, exitSamples: 0, dayOffset: req.startDay, hist });
      post({ runId: req.runId, type: "fork", stats: computeStats(run.outcomes), holding: density.holding, samples: run.samples, end: run.end });
      return;
    }
    const density = newDensity(req.grid);
    const all: PathOutcome[] = [];
    const end: EndDist = { counts: new Array(req.grid.rows).fill(0), pnlSum: new Array(req.grid.rows).fill(0) };
    let first: SimStats | null = null;
    // 历史走法：全部真实走势打乱顺序（固定种子）后平均分成几批——按时间顺序分批的话每批都是同一段行情，"各批差不多"就没意义了
    const H = req.hist;
    const order: number[] = H ? Array.from({ length: H.count }, (_, i) => i) : [];
    if (H) {
      const rnd = mulberry32(req.seed);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    const store = new PriceStore(H ? H.count : req.batches * req.perBatch, p.horizon);
    for (let i = 0; i < req.batches; i++) {
      // 平均分：每批 floor(i·count/批数) 到 floor((i+1)·count/批数)，count≥批数时每批都不空，前端照样等满10批
      const chunk = H ? order.slice(Math.floor((i * H.count) / req.batches), Math.floor(((i + 1) * H.count) / req.batches)) : null;
      if (chunk && chunk.length === 0) break;
      const hist = H && chunk ? { ratios: H.ratios, days: H.days, indices: chunk } : undefined;
      const run = runCloud(p, req.vol, req.perBatch, req.seed + i * 7919, req.grid, density, { samples: i === 0 ? req.samples : 0, exitSamples: 60, extraStep: store.step, hist });
      all.push(...run.outcomes);
      run.end.counts.forEach((c, k) => {
        end.counts[k] += c;
        end.pnlSum[k] += run.end.pnlSum[k];
      });
      const stats = computeStats(run.outcomes);
      if (i === 0) first = stats;
      post({ runId: req.runId, type: "batch", index: i, stats, holding: density.holding.slice(), after: density.after.slice(), exits: run.exits, samples: run.samples, bands: priceBands(store) });
    }
    const hold = holdOutcomes(all, p.horizon);
    const exitDays = { tp: new Array(p.horizon + 1).fill(0), sl: new Array(p.horizon + 1).fill(0), delta: new Array(p.horizon + 1).fill(0), time: new Array(p.horizon + 1).fill(0) };
    for (const o of all) if (o.reason !== "expiry") exitDays[o.reason][o.day] += 1;
    // 跟只买股票比（两种走法都算）：每条走势最后一天的股价 vs 开仓价
    let up = 0, chg = 0;
    for (let k = 0; k < store.filled; k++) {
      const end = store.data[k * (store.days + 1) + store.days];
      if (end > p.spot) up++;
      chg += end / p.spot - 1;
    }
    const stock = { win: store.filled ? (up / store.filled) * 100 : 0, avg: store.filled ? chg / store.filled : 0 };
    // 这个胜率稳不稳（只有历史走法有）：all[k]对应第order[k]段
    let stab: StabRow[] | null = null;
    if (H) {
      const rows: StabRow[] = [];
      const add = (key: StabKey, pick: (idx: number) => boolean) => {
        const sel = all.filter((_, k) => pick(order[k]));
        if (sel.length < 20) return;
        const st = computeStats(sel);
        rows.push({ key, n: sel.length, win: st.winPct, avg: st.avg });
      };
      const span = H.to - Math.min(...H.starts);
      for (const [key, years] of [["y1", 1], ["y2", 2], ["y5", 5], ["y10", 10]] as const) {
        if (years * 365 * 86400 <= span + 30 * 86400) add(key, (idx) => H.starts[idx] >= H.to - years * 365 * 86400);
      }
      const sorted = [...H.vols].sort((a, b) => a - b);
      const q75 = sorted[Math.floor(sorted.length * 0.75)], q25 = sorted[Math.floor(sorted.length * 0.25)];
      add("hiVol", (idx) => H.vols[idx] >= q75);
      add("loVol", (idx) => H.vols[idx] <= q25);
      stab = rows;
    }
    const wl = winLoss(all, "pnl");
    const hwl = winLoss(all, "holdPnl");
    post({
      runId: req.runId, type: "done", stats: computeStats(all), hold: computeStats(hold), first: first!, hist: histogram(all), end,
      avgWin: wl.win, avgLoss: wl.loss, holdAvgWin: hwl.win, holdAvgLoss: hwl.loss, exitDays,
      stock, stab,
      // 历史真实走法：每条典型结局是哪一段真实走势（all[k]对应第order[k]段），界面上举例"某年某月某日起的那几天"
      stories: pickStories(all, store, 4, p).map((st) => (H ? { ...st, start: H.starts[order[st.index]] } : st)), money: moneyBands(store, all, p), endPrices: Array.from({ length: store.filled }, (_, k) => store.data[k * (store.days + 1) + store.days]),
    });
    // 不加财报跳空的对照（4000条；带跳空的那组是上面的1万条）
    if (req.setup.earnings && req.noEarnVol != null && !H) {
      const p0 = prepareSim({ ...req.setup, earnings: null });
      if (p0) post({ runId: req.runId, type: "earn", without: computeStats(runBatch(p0, req.noEarnVol, 4000, req.seed + 3).outcomes) });
    }
    // 换个规则试试，在曲线之前算：它直接出现在结论卡片里。用固定种子：点"换一组随机走势"时建议不该忽有忽无。
    const altN = curvePathCount(p, 7, 3000);
    const altHist = H ? { ratios: H.ratios, days: H.days, indices: Array.from({ length: H.count }, (_, i) => i) } : undefined;
    post({ runId: req.runId, type: "alt", suggestion: suggestRules({ ...req.setup, pnlOffset: 0 }, req.vol, altN, ALT_SEED, req.debit ? "debit" : "credit", altHist) });
    const vols = volGrid(req.ivCenter, req.vol);
    const n = curvePathCount(p, vols.length + 4);
    // 波动率曲线按零漂移算（只看波动的影响）；买方另算一条"年化涨跌"曲线。
    const p0 = { ...p, drift: 0 };
    const curve = breakevenCurve(p0, vols, n, req.seed + 1);
    const breakeven = findBreakeven(p0, curve, n, req.seed + 1);
    let dCurve: DriftPoint[] | null = null;
    let dBe: number | null = null;
    if (req.debit) {
      const m = curvePathCount(p, driftGrid().length + 4, 8000);
      dCurve = driftCurve(p, req.vol, driftGrid(), m, req.seed + 2);
      dBe = findDriftBreakeven(p, req.vol, dCurve, m, req.seed + 2);
    }
    post({ runId: req.runId, type: "curve", curve, breakeven, delta: deltaPerContract(p), driftCurve: dCurve, driftBreakeven: dBe });
  } catch (err) {
    post({ runId: req.runId, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
