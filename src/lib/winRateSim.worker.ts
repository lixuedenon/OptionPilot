// src/lib/winRateSim.worker.ts
// 在后台线程跑胜率模拟，界面动画不卡：先逐批回传10批结果（每批1000条），再回传合计统计，最后回传盈亏平衡波动率曲线。
import {
  prepareSim, runBatch, computeStats, histogram, breakevenCurve, findBreakeven, curvePathCount, volGrid, retroDistribution, deltaPerContract, driftGrid, driftCurve, findDriftBreakeven,
  type DriftPoint, type SimSetup, type RetroInput, type SimStats, type SamplePath, type Histogram, type CurvePoint, type Breakeven, type PathOutcome,
} from "./winRateSim";

export interface SimRequest {
  runId: number;
  setup: SimSetup;
  vol: number;
  ivCenter: number;
  batches: number;
  perBatch: number;
  sampleCount: number;
  seed: number;
  retro?: RetroInput; // 今昔对比的"回看"：先算、先回传
  debit?: boolean; // 开仓付钱（买方）：另算"盈亏平衡年化涨跌"
}

export type SimResponse =
  | { runId: number; type: "batch"; index: number; stats: SimStats; samples: SamplePath[] }
  | { runId: number; type: "done"; stats: SimStats; hist: Histogram }
  | { runId: number; type: "curve"; curve: CurvePoint[]; breakeven: Breakeven; delta: number; driftCurve: DriftPoint[] | null; driftBreakeven: number | null }
  | { runId: number; type: "retro"; sorted: number[] }
  | { runId: number; type: "error"; message: string };

const post = (msg: SimResponse) => (self as unknown as Worker).postMessage(msg);

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const req = e.data;
  try {
    if (req.retro) post({ runId: req.runId, type: "retro", sorted: retroDistribution(req.retro, 5000, req.seed + 3) });
    const p = prepareSim(req.setup);
    if (!p) {
      post({ runId: req.runId, type: "error", message: "unsupported" });
      return;
    }
    const all: PathOutcome[] = [];
    for (let i = 0; i < req.batches; i++) {
      const { outcomes, samples } = runBatch(p, req.vol, req.perBatch, req.seed + i * 7919, req.sampleCount);
      all.push(...outcomes);
      post({ runId: req.runId, type: "batch", index: i, stats: computeStats(outcomes), samples });
    }
    post({ runId: req.runId, type: "done", stats: computeStats(all), hist: histogram(all) });
    const vols = volGrid(req.ivCenter, req.vol);
    const n = curvePathCount(p, vols.length + 4);
    // 波动率曲线按零漂移算（只看波动的影响）；买方（付钱开仓）另算一条"年化涨跌"曲线。
    const p0 = { ...p, drift: 0 };
    const curve = breakevenCurve(p0, vols, n, req.seed + 1);
    const breakeven = findBreakeven(p0, curve, n, req.seed + 1);
    const delta = deltaPerContract(p);
    let dCurve: DriftPoint[] | null = null;
    let dBe: number | null = null;
    if (req.debit) {
      // 涨跌曲线比较平，同样的随机误差会让平衡点晃得更厉害，路数给多一些。
      const m = curvePathCount(p, driftGrid().length + 4, 8000);
      dCurve = driftCurve(p, req.vol, driftGrid(), m, req.seed + 2);
      dBe = findDriftBreakeven(p, req.vol, dCurve, m, req.seed + 2);
    }
    post({ runId: req.runId, type: "curve", curve, breakeven, delta, driftCurve: dCurve, driftBreakeven: dBe });
  } catch (err) {
    post({ runId: req.runId, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
