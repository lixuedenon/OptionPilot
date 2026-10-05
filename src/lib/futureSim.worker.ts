// src/lib/futureSim.worker.ts
// "万次推演"的后台线程。main：从开仓出发跑10批×1000条，逐批回传累计的密度云和下车点（动画），最后回传合计、
// "一直拿到期"的对比、到期落点、换几种规则的对比和盈亏平衡波动率；fork：从情景点出发再跑一团（跟持仓建议卡片同一组走势）。
import {
  prepareSim, simPnlAt, computeStats, histogram, holdOutcomes, breakevenCurve, findBreakeven, curvePathCount, volGrid, deltaPerContract, driftGrid, driftCurve, findDriftBreakeven,
  type SimSetup, type SimStats, type Histogram, type CurvePoint, type Breakeven, type DriftPoint, type PathOutcome,
} from "./winRateSim";
import { newDensity, runCloud, suggestRules, PriceStore, priceBands, pickStories, FORK_PATHS, FORK_SEED, type GridSpec, type ExitPoint, type EndDist, type RuleSuggestion, type Band, type Story } from "./futureSim";

export type FutureRequest =
  | { kind: "main"; runId: number; setup: SimSetup; vol: number; ivCenter: number; batches: number; perBatch: number; samples: number; seed: number; grid: GridSpec; debit: boolean }
  | { kind: "fork"; runId: number; setup: SimSetup; vol: number; startDay: number; samples: number; grid: GridSpec }
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
  | { runId: number; type: "done"; stats: SimStats; hold: SimStats; first: SimStats; hist: Histogram; end: EndDist; avgWin: number; avgLoss: number; holdAvgWin: number; holdAvgLoss: number; exitDays: Record<"tp" | "sl" | "time", number[]>; stories: Story[]; endPrices: number[] }
  | { runId: number; type: "alt"; suggestion: RuleSuggestion | null }
  | { runId: number; type: "curve"; curve: CurvePoint[]; breakeven: Breakeven; delta: number; driftCurve: DriftPoint[] | null; driftBreakeven: number | null }
  | { runId: number; type: "fork"; stats: SimStats; holding: Float32Array; samples: Sample[]; end: EndDist }
  | { runId: number; type: "retro"; sorted: number[]; prices: number[]; days: RetroDay[]; holding: Float32Array; samples: Sample[]; end: EndDist; bands: Band[] }
  | { runId: number; type: "error"; message: string };

const ALT_SEED = 20261003;
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
        runId: req.runId, type: "retro", sorted: run.outcomes.map((o) => o.pnl).sort(asc), prices: run.outcomes.map((o) => o.price).sort(asc), days,
        holding: density.holding, samples: run.samples, end: run.end, bands: priceBands(store),
      });
      return;
    }
    if (req.kind === "fork") {
      const density = newDensity(req.grid);
      const run = runCloud(p, req.vol, FORK_PATHS, FORK_SEED, req.grid, density, { samples: req.samples, exitSamples: 0, dayOffset: req.startDay });
      post({ runId: req.runId, type: "fork", stats: computeStats(run.outcomes), holding: density.holding, samples: run.samples, end: run.end });
      return;
    }
    const density = newDensity(req.grid);
    const all: PathOutcome[] = [];
    const end: EndDist = { counts: new Array(req.grid.rows).fill(0), pnlSum: new Array(req.grid.rows).fill(0) };
    let first: SimStats | null = null;
    const store = new PriceStore(req.batches * req.perBatch, p.horizon);
    for (let i = 0; i < req.batches; i++) {
      const run = runCloud(p, req.vol, req.perBatch, req.seed + i * 7919, req.grid, density, { samples: i === 0 ? req.samples : 0, exitSamples: 60, extraStep: store.step });
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
    const exitDays = { tp: new Array(p.horizon + 1).fill(0), sl: new Array(p.horizon + 1).fill(0), time: new Array(p.horizon + 1).fill(0) };
    for (const o of all) if (o.reason !== "expiry") exitDays[o.reason][o.day] += 1;
    const wl = winLoss(all, "pnl");
    const hwl = winLoss(all, "holdPnl");
    post({
      runId: req.runId, type: "done", stats: computeStats(all), hold: computeStats(hold), first: first!, hist: histogram(all), end,
      avgWin: wl.win, avgLoss: wl.loss, holdAvgWin: hwl.win, holdAvgLoss: hwl.loss, exitDays,
      stories: pickStories(all, store), endPrices: Array.from({ length: store.filled }, (_, k) => store.data[k * (store.days + 1) + store.days]),
    });
    // 换个规则试试，在曲线之前算：它直接出现在结论卡片里。用固定种子：点"换一组随机走势"时建议不该忽有忽无。
    const altN = curvePathCount(p, 7, 3000);
    post({ runId: req.runId, type: "alt", suggestion: suggestRules({ ...req.setup, pnlOffset: 0 }, req.vol, altN, ALT_SEED, req.debit ? "debit" : "credit") });
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
