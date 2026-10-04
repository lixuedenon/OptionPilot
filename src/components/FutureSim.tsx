// src/components/FutureSim.tsx
// "万次推演"标签（推演未来）：按假设的实际波动随机走1万次，按你的止盈/止损/平仓规则逐日检查。
// 画面跟"股价 vs 期权价"同一张地形图（平面）或把它立起来的曲面（立体）：走得多的地方发亮、下车点、到期落点、
// 情景点和从情景点往后的蓝色云。结论卡片按"判断→（隐含波动率远高于实际时的提醒）→为什么→胜率和赔率→最坏→你的规则→换个规则→情景点"给大白话。
// 三个情景滑块都生效：股价/时间定情景点（从那里分出第二团云，跟左边持仓建议同一组走势），波动率改变期权定价、整张图重算。
// 计算在futureSim.worker.ts，这里管节奏和展示。今昔对比的回看在RetroSim（同一个worker的retro请求）。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nContext";
import type { Leg } from "@/lib/types";
import {
  openingBasis, isCreditCombo, prepareSim, simPnlAt, probPriceBeyond, batchStability, driftCushion,
  type SimRules, type SimStats, type Histogram, type CurvePoint, type Breakeven, type DriftPoint, type ExitReason,
} from "@/lib/winRateSim";
import type { ExitPoint, EndDist, GridSpec, RuleSuggestion } from "@/lib/futureSim";
import type { FutureRequest, FutureResponse, Sample } from "@/lib/futureSim.worker";
import { buildMapModel, comboBaseIv, attributeSegment } from "@/lib/stockOptionMap";
import { priceStance } from "@/lib/retroStory";
import { NowCells, JourneyBlock } from "@/components/ValueJourney";
import { expiryScan } from "@/lib/positionAdvisor";
import { useSimSettings, setSideRules, setVolOverride as setVolOverrideFor, setDriftPct as setDriftPctFor, fracLabel, type Side } from "@/lib/simSettings";
import { computeHV, fetchHistoricalSeries } from "@/lib/historicalVolatility";
import CanvasBox from "@/components/simCharts";
import SimSurface3D from "@/components/SimSurface3D";
import { drawVolCurve, drawDriftCurve, drawPnlHist } from "@/lib/simChartDraw";

interface Props {
  symbol: string;
  legs: Leg[]; // 开仓组合（已去掉屏蔽的），dte按开仓那天算
  spot: number; // 开仓价
  dV: number; // 波动率滑块（百分点）
  scenario: { day: number; price: number } | null; // 股价/时间滑块定的情景点（都为0时null）
  // 情景点那一刻的腿位（理论价）和开仓以来盈亏，跟左边持仓建议卡片的输入完全一样；null=情景日期已过最早到期日
  fork: { legs: Leg[]; spot: number; day: number; pnl: number } | null;
  ivBase: number; // 开仓时的平均隐含波动率（跟波动率滑块小字同一个数，小数）
  emptyText: string | null;
}

const BATCHES = 10;
const PER_BATCH = 1000;
const SAMPLES = 60;
const ROWS = 80;
const REVEAL_MS = 330;
const LIMIT_KEY = "optionpilot.winRateLossLimit";
const VIEW_KEY = "optionpilot.simView";
const TP_OPTIONS: Record<Side, number[]> = { credit: [0.25, 0.5, 0.75], debit: [0.5, 1, 2] };
const SL_OPTIONS: Record<Side, number[]> = { credit: [0.5, 1, 1.5, 2, 3], debit: [0.25, 0.5, 0.75] };
const CLOSE_FRACS = [0.25, 1 / 3, 0.5];
// 隐含波动率是最近20天实际波动的1.4倍以上才提醒（平时两者差两三成很常见）。
const IV_HV_WARN = 1.4;
const REASON_COLOR: Record<ExitReason, string> = { tp: "#34d399", sl: "#fb7185", time: "#fbbf24", expiry: "#38bdf8" };

function loadNumber(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}
function loadView(): "plane" | "3d" {
  try {
    return localStorage.getItem(VIEW_KEY) === "plane" ? "plane" : "3d";
  } catch {
    return "3d";
  }
}

interface MainRun {
  batches: SimStats[];
  holding: Float32Array | null;
  after: Float32Array | null;
  exits: ExitPoint[];
  samples: Sample[];
  done: Extract<FutureResponse, { type: "done" }> | null;
  curve: Extract<FutureResponse, { type: "curve" }> | null;
  alt: RuleSuggestion | null | undefined; // undefined=还没算完
  error: string | null;
}
const EMPTY_RUN: MainRun = { batches: [], holding: null, after: null, exits: [], samples: [], done: null, curve: null, alt: undefined, error: null };

// 地形图同款配色：盈利按最大盈利、亏损按最大亏损各自换算深浅。
function cellRgb(v: number, maxProfit: number, maxLoss: number): [number, number, number] {
  const k = Math.sqrt(Math.min(1, v >= 0 ? v / maxProfit : -v / maxLoss));
  const base = [22, 30, 46];
  const to = v >= 0 ? [16, 185, 129] : [244, 63, 94];
  return [0, 1, 2].map((i) => Math.round(base[i] + (to[i] - base[i]) * k)) as [number, number, number];
}

function niceStep(span: number, target: number) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

export default function FutureSim({ symbol, legs, spot, dV, scenario, fork, ivBase, emptyText }: Props) {
  const { t } = useI18n();
  const { rules: rulesBySide, volOverride, driftPct } = useSimSettings(symbol);
  const setVolOverride = (v: number | null) => setVolOverrideFor(symbol, v);
  const setDriftPct = (v: number) => setDriftPctFor(symbol, v);
  const [lossLimit, setLossLimit] = useState<number>(() => loadNumber(LIMIT_KEY, 1000));
  const [view, setView] = useState<"plane" | "3d">(loadView);
  const [hv, setHv] = useState<{ status: "loading" | "ok" | "error"; hv20?: number }>({ status: "loading" });
  const [run, setRun] = useState<MainRun>(EMPTY_RUN);
  const [forkRun, setForkRun] = useState<{ key: string; stats: SimStats; holding: Float32Array; samples: Sample[] } | null>(null);
  const [runNonce, setRunNonce] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const forkWorkerRef = useRef<Worker | null>(null);
  const queueRef = useRef<FutureResponse[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(LIMIT_KEY, String(lossLimit));
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* 浏览器禁止存储时只是不记住 */
    }
  }, [lossLimit, view]);

  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    setHv({ status: "loading" });
    fetchHistoricalSeries(symbol)
      .then((s) => {
        if (!alive) return;
        const hv20 = computeHV(s.closes, 20);
        setHv({ status: hv20 > 0 ? "ok" : "error", hv20 });
      })
      .catch(() => alive && setHv({ status: "error" }));
    return () => {
      alive = false;
    };
  }, [symbol]);

  const basis = useMemo(() => openingBasis(legs), [legs]);
  const credit = useMemo(() => isCreditCombo(legs), [legs]);
  const side: Side = credit ? "credit" : "debit";
  const rules = rulesBySide[side];
  const setRules = (r: SimRules) => setSideRules(side, r);
  const describeRules = (r: SimRules) =>
    [
      `${t("winRate.tp")} ${r.takeProfitPct == null ? t("winRate.none") : t("winRate.tpOpt", { n: r.takeProfitPct * 100 })}`,
      `${t("winRate.sl")} ${r.stopMult == null ? t("winRate.none") : credit ? t("winRate.slOpt", { n: r.stopMult }) : t("winRate.slOptDebit", { n: r.stopMult * 100 })}`,
      r.closeFrac > 0 ? t("winRate.closeOptFrac", { f: fracLabel(r.closeFrac), d: Math.max(1, Math.round(totalTerm * r.closeFrac)) }) : t("winRate.holdToExpiry"),
    ].join(" · ");
  const totalTerm = useMemo(() => {
    const d = legs.filter((l) => l.kind !== "stock").map((l) => l.dte);
    return d.length ? Math.max(1, Math.round(Math.min(...d))) : 0;
  }, [legs]);
  const hasStock = legs.some((l) => l.kind === "stock");
  const stance = useMemo(() => (basis != null ? priceStance(legs, spot, basis) : "neutral"), [legs, spot, basis]);
  const ivCenter = useMemo(() => comboBaseIv(legs, spot) ?? 0.3, [legs, spot]);
  const vol = volOverride != null ? volOverride / 100 : hv.status === "ok" && hv.hv20 ? hv.hv20 : ivCenter;
  const volReady = volOverride != null || hv.status !== "loading";
  const drift = credit ? 0 : driftPct / 100;

  const setup = useMemo(
    () => (basis == null || hasStock ? null : { legs, spot, basis, pnlOffset: 0, rules, totalTerm, drift, dV }),
    [basis, hasStock, legs, spot, rules, totalTerm, drift, dV],
  );
  const prepared = useMemo(() => (setup ? prepareSim(setup) : null), [setup]);
  const days = prepared?.horizon ?? 1;
  const model = useMemo(
    () => (setup ? buildMapModel(legs, spot, dV, { extraPrices: scenario ? [scenario.price] : [] }, 120, ROWS) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setup, legs, spot, dV, scenario?.price],
  );
  const grid: GridSpec | null = useMemo(() => (model ? { sMin: model.sMin, sMax: model.sMax, rows: ROWS, days } : null), [model, days]);
  // 到期时最多赚/亏多少：用来判断止盈止损线碰不碰得到。
  const scan = useMemo(() => (prepared ? expiryScan(prepared, spot) : null), [prepared, spot]);

  const runKey = useMemo(() => {
    if (!setup || !grid) return "";
    const lk = setup.legs.map((l) => [l.action, l.type, l.strike, l.dte, l.premium, l.qty ?? 1].join(":")).join("|");
    return [lk, spot.toFixed(3), JSON.stringify(rules), vol.toFixed(4), drift, dV, totalTerm, grid.sMin.toFixed(3), grid.sMax.toFixed(3), runNonce].join("#");
  }, [setup, grid, spot, rules, vol, drift, dV, totalTerm, runNonce]);

  // 主推演：输入变了（防抖400ms）就换一个后台线程从头算。
  useEffect(() => {
    if (!setup || !prepared || !grid || !volReady || emptyText) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      workerRef.current?.terminate();
      const w = new Worker(new URL("../lib/futureSim.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = w;
      queueRef.current = [];
      setRun(EMPTY_RUN);
      const runId = Date.now();
      w.onmessage = (e: MessageEvent<FutureResponse>) => {
        if (!cancelled && e.data.runId === runId) queueRef.current.push(e.data);
      };
      const req: FutureRequest = {
        kind: "main", runId, setup, vol, ivCenter: Math.max(0.05, ivCenter + dV / 100), batches: BATCHES, perBatch: PER_BATCH, samples: SAMPLES,
        seed: Math.floor(Math.random() * 1e9), grid, debit: !credit,
      };
      w.postMessage(req);
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, volReady, emptyText]);

  // 情景点：按规则还走得到那里时，从那一点往后再推演一团（跟持仓建议同一组走势）。
  const scenState = useMemo(() => {
    if (!scenario || !prepared) return null;
    if (scenario.day >= prepared.horizon) return { kind: "expired" as const };
    if (prepared.closeAtRemaining > 0 && scenario.day > prepared.endDay) return { kind: "afterClose" as const };
    if (scenario.day > 0) {
      const pnl = simPnlAt(prepared, scenario.day, scenario.price);
      if (pnl >= prepared.tpLine) return { kind: "hitTp" as const, pnl };
      if (pnl <= prepared.slLine) return { kind: "hitSl" as const, pnl };
    }
    return { kind: "ok" as const };
  }, [scenario, prepared]);
  const forkKey = useMemo(() => {
    if (!fork || scenState?.kind !== "ok" || !grid || basis == null || !(scenario && (scenario.day > 0 || Math.abs(scenario.price - spot) > 0.005))) return "";
    const lk = fork.legs.map((l) => [l.strike, l.dte.toFixed(2), l.premium.toFixed(4), l.qty ?? 1].join(":")).join("|");
    return [lk, fork.spot.toFixed(3), fork.pnl.toFixed(4), fork.day, runKey].join("#");
  }, [fork, scenState, grid, basis, scenario, spot, runKey]);
  useEffect(() => {
    if (!forkKey || !fork || !grid || basis == null || !volReady) {
      setForkRun(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      forkWorkerRef.current?.terminate();
      const w = new Worker(new URL("../lib/futureSim.worker.ts", import.meta.url), { type: "module" });
      forkWorkerRef.current = w;
      const runId = Date.now();
      w.onmessage = (e: MessageEvent<FutureResponse>) => {
        const m = e.data;
        if (cancelled || m.runId !== runId || m.type !== "fork") return;
        setForkRun({ key: forkKey, stats: m.stats, holding: m.holding, samples: m.samples });
      };
      const req: FutureRequest = {
        kind: "fork", runId, vol, startDay: Math.round(fork.day), samples: 30, grid,
        setup: { legs: fork.legs, spot: fork.spot, basis, pnlOffset: fork.pnl, rules, totalTerm, drift },
      };
      w.postMessage(req);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forkKey, volReady]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    forkWorkerRef.current?.terminate();
  }, []);

  // 动画节奏：每批停一小会儿，云一波一波长出来；合计和曲线等10批放完再显示。
  useEffect(() => {
    const id = window.setInterval(() => {
      const q = queueRef.current;
      if (q.length === 0) return;
      const head = q[0];
      if (head.type === "batch") {
        q.shift();
        setRun((r) => ({ ...r, batches: [...r.batches, head.stats], holding: head.holding, after: head.after, exits: [...r.exits, ...head.exits], samples: head.samples.length ? head.samples : r.samples }));
        return;
      }
      while (q.length && q[0].type !== "batch") {
        const m = q.shift()!;
        setRun((r) => (m.type === "done" ? { ...r, done: m } : m.type === "alt" ? { ...r, alt: m.suggestion } : m.type === "curve" ? { ...r, curve: m } : m.type === "error" ? { ...r, error: m.message } : r));
      }
    }, REVEAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const money = (v: number) => `${v < -0.005 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
  const usd = (v: number) => `$${Math.abs(v).toFixed(2)}`;

  if (emptyText) return <div className="flex h-full items-center justify-center text-sm text-slate-400">{emptyText}</div>;
  if (hasStock || basis == null || !prepared || !model || !grid) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">
        {hasStock ? t("winRate.noStock") : t("winRate.noBasis")}
      </div>
    );
  }

  const p = prepared;
  const revealed = run.batches.length;
  const finished = revealed >= BATCHES && run.done != null;
  const forkShown = forkRun && forkRun.key === forkKey ? forkRun : null;
  const scen = scenario && scenState && scenState.kind !== "expired" ? scenario : null;
  const slUnreachable = (mult: number) => scan?.maxLoss != null && scan.maxLoss > -mult * p.basis + 1e-9;

  // ── 控制栏 ──
  const sel = "rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200";
  const chip = (label: string, v: number | undefined, key: string) =>
    v != null && v > 0 ? (
      <button
        key={key}
        onClick={() => setVolOverride(Math.round(v * 1000) / 10)}
        className={`rounded border px-1.5 py-0.5 text-[10px] ${Math.abs(vol - v) < 0.0006 ? "border-sky-500 text-sky-300" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}
      >
        {label}
      </button>
    ) : null;
  const viewBtn = (v: "plane" | "3d", label: string) => (
    <button
      onClick={() => setView(v)}
      className={`px-2 py-0.5 text-[11px] font-semibold ${view === v ? "bg-sky-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
    >
      {label}
    </button>
  );
  const controls = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-400">
      <span className="flex overflow-hidden rounded border border-slate-600">
        {viewBtn("3d", t("future.view3d"))}
        {viewBtn("plane", t("future.viewPlane"))}
      </span>
      <label className="flex items-center gap-1">
        {t("winRate.tp")}
        <select className={sel} value={String(rules.takeProfitPct)} onChange={(e) => setRules({ ...rules, takeProfitPct: e.target.value === "null" ? null : Number(e.target.value) })}>
          {TP_OPTIONS[side].map((v) => (
            <option key={v} value={v}>
              {t("winRate.tpOpt", { n: v * 100 })}
              {scan?.maxProfit != null && scan.maxProfit < v * p.basis - 1e-9 ? t("future.unreachableOpt") : ""}
            </option>
          ))}
          <option value="null">{t("winRate.none")}</option>
        </select>
      </label>
      <label className="flex items-center gap-1">
        {t("winRate.sl")}
        <select className={sel} value={String(rules.stopMult)} onChange={(e) => setRules({ ...rules, stopMult: e.target.value === "null" ? null : Number(e.target.value) })}>
          {SL_OPTIONS[side].map((v) => (
            <option key={v} value={v}>
              {credit ? t("winRate.slOpt", { n: v }) : t("winRate.slOptDebit", { n: v * 100 })}
              {slUnreachable(v) ? t("future.unreachableOpt") : ""}
            </option>
          ))}
          <option value="null">{t("winRate.none")}</option>
        </select>
      </label>
      <label className="flex items-center gap-1">
        <select className={sel} value={String(rules.closeFrac)} onChange={(e) => setRules({ ...rules, closeFrac: Number(e.target.value) })}>
          <option value="0">{t("winRate.holdToExpiry")}</option>
          {CLOSE_FRACS.map((f) => (
            <option key={f} value={String(f)}>{t("winRate.closeOptFrac", { f: fracLabel(f), d: Math.max(1, Math.round(totalTerm * f)) })}</option>
          ))}
        </select>
      </label>
      {!credit && (
        <label className="flex items-center gap-1" title={t("winRate.driftHint")}>
          {t("winRate.drift")}
          <input
            type="number"
            inputMode="decimal"
            min={-90}
            max={300}
            step={1}
            value={driftPct}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= -90 && v <= 300) setDriftPct(v);
            }}
            className="w-14 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-right text-[11px] tabular-nums text-slate-100"
          />
          %
        </label>
      )}
      <span className="flex flex-wrap items-center gap-1">
        {t("winRate.vol")}
        <input
          type="number"
          inputMode="decimal"
          min={5}
          max={200}
          step={1}
          value={Math.round(vol * 1000) / 10}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v >= 5 && v <= 200) setVolOverride(v);
          }}
          className="w-14 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-right text-[11px] tabular-nums text-slate-100"
        />
        %
        {hv.status === "loading" && <span className="text-slate-500">{t("winRate.volLoading")}</span>}
        {chip(t("winRate.volHv", { v: hv.hv20 ? (hv.hv20 * 100).toFixed(1) : "" }), hv.hv20, "hv")}
        {chip(t("winRate.volIv", { v: (ivCenter * 100).toFixed(1) }), ivCenter, "iv")}
      </span>
      <button onClick={() => setRunNonce((n) => n + 1)} className="ml-auto rounded border border-slate-600 px-2 py-0.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-800">
        {t("future.reroll")}
      </button>
    </div>
  );

  // ── 平面视图：地形图做底色，上面是密度云、下车点、到期落点、情景点和蓝色的分叉云 ──
  const end: EndDist | undefined = run.done?.end;
  const drawPlane = (g: CanvasRenderingContext2D, W: number, H: number) => {
    const M = { l: 56, r: 74, t: 22, b: 34 };
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const X = (d: number) => M.l + (d / days) * pw;
    const Y = (s: number) => M.t + ((model.sMax - s) / (model.sMax - model.sMin)) * ph;
    const cw = pw / (model.cols - 1), ch = ph / (model.rows - 1);
    g.save();
    g.beginPath();
    g.rect(M.l, M.t, pw, ph);
    g.clip();
    for (let r = 0; r < model.rows; r++)
      for (let c = 0; c < model.cols; c++) {
        const [R, G, B] = cellRgb(model.grid[r * model.cols + c], model.maxProfit, model.maxLoss);
        g.fillStyle = `rgb(${R},${G},${B})`;
        g.fillRect(M.l + c * cw - cw / 2, M.t + r * ch - ch / 2, cw + 1, ch + 1);
      }
    g.fillStyle = "rgba(2,6,23,0.5)";
    g.fillRect(M.l, M.t, pw, ph);
    const cellW = pw / days, cellH = ph / ROWS;
    const paint = (dens: Float32Array | null, rgb: string, k: number) => {
      if (!dens) return;
      for (let d = 0; d <= days; d++) {
        let mx = 0;
        for (let r = 0; r < ROWS; r++) mx = Math.max(mx, dens[d * ROWS + r]);
        if (mx <= 0) continue;
        for (let r = 0; r < ROWS; r++) {
          const v = dens[d * ROWS + r];
          if (v <= 0) continue;
          g.fillStyle = `rgba(${rgb},${(k * Math.sqrt(v / mx)).toFixed(3)})`;
          g.fillRect(M.l + (d - 0.5) * cellW, M.t + r * cellH, cellW + 0.6, cellH + 0.6);
        }
      }
    };
    paint(run.after, "148,163,184", 0.22);
    paint(run.holding, "226,240,255", 0.8);
    paint(forkShown?.holding ?? null, "56,189,248", 0.85);
    for (const e of run.exits) {
      g.fillStyle = REASON_COLOR[e.reason];
      g.beginPath();
      g.arc(X(e.day), Y(e.price), 2.1, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // 行权价、平仓日
    g.font = "10px sans-serif";
    for (const k of model.strikes) {
      if (k < model.sMin || k > model.sMax) continue;
      g.strokeStyle = "rgba(226,232,240,0.4)";
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(M.l, Y(k));
      g.lineTo(M.l + pw, Y(k));
      g.stroke();
      g.setLineDash([]);
    }
    if (p.endDay < days) {
      g.strokeStyle = "rgba(251,191,36,0.6)";
      g.setLineDash([2, 4]);
      g.beginPath();
      g.moveTo(X(p.endDay), M.t);
      g.lineTo(X(p.endDay), M.t + ph);
      g.stroke();
      g.setLineDash([]);
    }
    // 纵轴刻度
    const step = niceStep(model.sMax - model.sMin, 6);
    g.fillStyle = "#94a3b8";
    g.textAlign = "right";
    for (let v = Math.ceil(model.sMin / step) * step; v <= model.sMax; v += step) g.fillText(String(Math.round(v * 100) / 100), M.l - 4, Y(v) + 3);
    // 右侧：到期（或平仓那天）还拿着的走势落在哪
    if (end) {
      const mx = Math.max(...end.counts) || 1;
      const x0 = M.l + pw + 6;
      end.counts.forEach((c, r) => {
        if (!c) return;
        g.fillStyle = end.pnlSum[r] >= 0 ? "rgba(52,211,153,0.8)" : "rgba(251,113,133,0.8)";
        g.fillRect(x0, M.t + r * cellH, (c / mx) * (M.r - 14), Math.max(1, cellH - 0.5));
      });
      g.fillStyle = "#64748b";
      g.textAlign = "left";
      g.fillText(t(p.endDay < days ? "future.endClose" : "future.endExpiry"), x0, M.t + ph + 14);
    }
    // 情景点
    if (scen) {
      const sx = X(scen.day), sy = Y(scen.price);
      g.fillStyle = "#0ea5e9";
      g.strokeStyle = "#f8fafc";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(sx, sy - 6);
      g.lineTo(sx + 6, sy);
      g.lineTo(sx, sy + 6);
      g.lineTo(sx - 6, sy);
      g.closePath();
      g.fill();
      g.stroke();
      g.lineWidth = 1;
      const label = t("winRate.scenMark", { d: Math.round(scen.day), s: scen.price.toFixed(2) });
      g.font = "bold 11px sans-serif";
      const tw = g.measureText(label).width;
      const lx = sx + 10 + tw > M.l + pw ? sx - 10 - tw : sx + 10;
      const ly = Math.max(M.t + 12, Math.min(M.t + ph - 6, sy - 8));
      g.fillStyle = "rgba(2,6,23,0.85)";
      g.fillRect(lx - 3, ly - 11, tw + 6, 15);
      g.fillStyle = "#7dd3fc";
      g.textAlign = "left";
      g.fillText(label, lx, ly);
    }
    // 坐标轴说明和标题
    g.font = "10px sans-serif";
    g.fillStyle = "#64748b";
    g.textAlign = "left";
    g.fillText(t("future.axOpen"), M.l, H - M.b + 13);
    g.textAlign = "right";
    g.fillText(t("future.axExpiry", { d: days }), M.l + pw, H - M.b + 13);
    if (p.endDay < days && p.endDay > 0) {
      g.textAlign = "center";
      g.fillStyle = "#d97706";
      g.fillText(t("future.axClose"), X(p.endDay), H - M.b + 13);
    }
    g.font = "bold 11px sans-serif";
    g.fillStyle = "#e2e8f0";
    g.textAlign = "center";
    g.fillText(`${t("winRate.axisTimeOpen")} →`, M.l + pw / 2, H - 4);
    const yLabel = t("som.axisPrice");
    const midY = M.t + ph / 2;
    if (/[一-鿿]/.test(yLabel)) {
      ["↑", ...yLabel].forEach((ch, i, a) => g.fillText(ch, 9, midY - ((a.length - 1) * 14) / 2 + i * 14 + 4));
    } else {
      g.save();
      g.translate(10, midY);
      g.rotate(-Math.PI / 2);
      g.fillText(`${yLabel} →`, 0, 4);
      g.restore();
    }
    g.font = "bold 12px sans-serif";
    g.fillStyle = "#f8fafc";
    g.fillText(t("future.title", { s: symbol.trim().toUpperCase() }), M.l + pw / 2, 15);
  };

  const labels3d = {
    open: t("future.axOpen"),
    expiry: t("future.axExpiry", { d: days }),
    close: t("future.axClose"),
    price: t("som.axisPrice"),
    pnl: t("future.axPnl"),
    hint: t("future.hint3d"),
    time: `${t("winRate.axisTimeOpen")} →`,
    legend: [t("future.lg3dZ"), t("future.lg3dX", { a: t("future.axOpen"), b: t("future.axExpiry", { d: days }) }), t("future.lg3dY", { lo: model.sMin.toFixed(0), hi: model.sMax.toFixed(0) })],
  };

  // ── 结论卡片 ──
  const s = run.done?.stats ?? null;
  const hold = run.done?.hold ?? null;
  const curve = run.curve;
  const be: Breakeven | null = curve?.breakeven ?? null;
  const directional = !credit && curve != null && Math.abs(curve.delta) >= 0.3;
  // 假设波动从哪来：手填的 / 最近20天历史 / 取不到历史时暂按隐含波动率——说法必须跟真实来源一致。
  const volSrc: "assumed" | "recent" | "iv" = volOverride != null ? "assumed" : hv.status === "ok" && hv.hv20 ? "recent" : "iv";
  const srcLabel = t(volSrc === "assumed" ? "future.srcAssumed" : volSrc === "recent" ? "future.srcRecent" : "future.srcIv");
  const srcBar = t(volSrc === "assumed" ? "future.barAssumed" : volSrc === "recent" ? "future.barRecent" : "future.barIv");
  const marketIv = Math.max(0.01, ivCenter + dV / 100);
  type Verdict = "good" | "slight" | "flat" | "bad";
  // 判断直接看1万次的结果：平均盈亏要明显离开0（超过随机误差的2倍，且至少是基准的3%）才算有优势/吃亏。
  // 不用"盈亏平衡波动率"下结论：带止盈止损时平均盈亏随波动变化很平，平衡点会随每次随机走势大幅跳动（那条曲线留在高级分析里）。
  let verdict: Verdict | null = null;
  if (s) {
    const noise = Math.max((2 * s.sd) / Math.sqrt(Math.max(1, s.n)), 0.03 * p.basis);
    verdict = Math.abs(s.avg) < noise ? "flat" : s.avg < 0 ? "bad" : s.avg >= 0.1 * p.basis ? "good" : "slight";
  }
  let why: ReactNode = null;
  if (s && directional && curve) {
    const req = curve.driftBreakeven;
    if (req == null) {
      why = t((curve.driftCurve ?? []).every((d: DriftPoint) => d.avg > 0) ? "winRate.noDriftCrossWin" : "winRate.noDriftCrossLose");
    } else {
      const dc = driftCushion(req, drift);
      why = t("future.whyDrift", {
        dir: t(req >= 0 ? "winRate.dirUp" : "winRate.dirDown"), req: Math.abs(req * 100).toFixed(1),
        mu: `${driftPct >= 0 ? "+" : ""}${driftPct}`, note: driftPct === 0 ? t("winRate.noViewNote") : "",
        cmp: t(dc.tier === "none" ? "future.cmpDriftBad" : dc.tier === "thin" ? "future.cmpDriftThin" : "future.cmpDriftGood", { pp: Math.abs(dc.value * 100).toFixed(0) }),
      });
    }
  } else if (s) {
    // 卖方（以及买入跨式这类靠波动的买方）：开仓时市场定价的隐含波动率 vs 实际波动，差10%以内算差不多。
    // ⚠️ 必须跟开仓时的隐含波动率比（权利金是按它收/付的）；波动率滑块是开仓后隐含波动率的变化，另外单独说。
    const openIv = ivCenter;
    const ratio = vol / openIv;
    const cmpKey = ratio < 0.9 ? (credit ? "future.cmpCalmSeller" : "future.cmpCalmBuyer") : ratio > 1.1 ? (credit ? "future.cmpWildSeller" : "future.cmpWildBuyer") : "future.cmpEven";
    const mx = Math.max(openIv, vol) * 1.1;
    const bar = (label: string, v: number, color: string) => (
      <div className="flex items-center gap-2 text-[10px] text-slate-400">
        <span className="w-24 shrink-0">{label}</span>
        <span className="h-2 rounded-sm" style={{ width: `${(v / mx) * 160}px`, background: color }} />
        <span className="tabular-nums text-slate-200">{(v * 100).toFixed(1)}%</span>
      </div>
    );
    why = (
      <>
        {t("future.whyVol", { iv: (openIv * 100).toFixed(1) })} {srcLabel} {(vol * 100).toFixed(1)}%{t("future.comma")}{t(cmpKey)}
        {dV !== 0 && <> {t(`future.dv${dV < 0 ? "Crush" : "Spike"}${credit ? "Seller" : "Buyer"}`, { n: Math.abs(dV) })}</>}
        <div className="mt-1 flex flex-col gap-0.5">
          {bar(t("future.barMarket"), openIv, "#a78bfa")}
          {dV !== 0 && bar(t("future.barAfterDv"), marketIv, "#c4b5fd")}
          {bar(srcBar, vol, "#fbbf24")}
        </div>
      </>
    );
  }
  const VERDICT_CLS: Record<Verdict, string> = {
    good: "bg-emerald-500/20 text-emerald-300",
    slight: "bg-emerald-500/10 text-emerald-200",
    flat: "bg-amber-500/15 text-amber-200",
    bad: "bg-rose-500/20 text-rose-300",
  };
  const row = (key: string, label: string, body: ReactNode, cls = "") => (
    <div key={key} className={`flex gap-2 ${cls}`}>
      <span className="w-16 shrink-0 text-slate-500">{label}</span>
      <div className="min-w-0 flex-1">{body}</div>
    </div>
  );
  const card: ReactNode[] = [];
  if (s && hold && run.done) {
    const n10 = Math.round(s.winPct / 10);
    card.push(
      <div key="head" className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-[12px] font-bold ${verdict ? VERDICT_CLS[verdict] : "bg-slate-800 text-slate-400"}`}>
          {t(verdict ? `future.verdict_${verdict}` : "future.verdict_pending")}
        </span>
        <span className="text-[13px] font-semibold text-slate-100">
          {t("future.head", { n: n10, gl: t(s.avg >= 0 ? "future.gain" : "future.loss"), v: usd(s.avg) })}
        </span>
      </div>,
    );
    // 隐含波动率远高于最近实际波动：常见于财报等大事件前，市场在为跳空定价，而这里的随机走势不含跳空。
    if (hv.status === "ok" && hv.hv20 && ivCenter / hv.hv20 >= IV_HV_WARN) {
      card.push(
        row("ivhv", t("future.ivhvLabel"), t(credit ? "future.ivhvSeller" : "future.ivhvBuyer", { iv: (ivCenter * 100).toFixed(1), hv: (hv.hv20 * 100).toFixed(1), k: (ivCenter / hv.hv20).toFixed(1) }), "text-amber-300"),
      );
    }
    if (why) card.push(row("why", t("future.whyLabel"), <>{why}{verdict === "flat" && <> {t("future.noEdgeNote")}</>}</>));
    const { avgWin, avgLoss } = run.done;
    const truth: string[] = [t("future.truth", { w: usd(avgWin), l: usd(avgLoss) })];
    if (s.winPct >= 60 && avgWin > 0 && -avgLoss >= 1.5 * avgWin) truth.push(t("future.truthHighWin", { k: Math.round(-avgLoss / avgWin) }));
    else if (s.winPct < 40 && avgLoss < 0 && avgWin >= -1.5 * avgLoss) truth.push(t("future.truthLowWin"));
    card.push(row("truth", t("future.truthLabel"), truth.join(" ")));
    const sets = Math.max(1, Math.min(...p.legs.filter((l) => l.kind !== "stock").map((l) => l.qty ?? 1)));
    if (s.worst5 < 0) {
      const perSet = (Math.abs(s.worst5) * 100) / sets;
      card.push(
        row(
          "worst",
          t("future.worstLabel"),
          <span className="flex flex-wrap items-center gap-1">
            <span>{t("winRate.worst", { v: usd(s.worst5) })}</span>
            <span>{t("winRate.sizingPre")}</span>
            <span>$</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={lossLimit}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) setLossLimit(v);
              }}
              className="w-16 rounded border border-slate-700 bg-slate-900 px-1 py-0 text-right text-[11px] tabular-nums text-slate-100"
            />
            <span>{t("winRate.sizingPost", { n: Math.floor(lossLimit / perSet), m: sets, v: `$${Math.round(perSet).toLocaleString()}` })}</span>
          </span>,
        ),
      );
    } else {
      card.push(row("worst", t("future.worstLabel"), t("winRate.worstPositive", { v: usd(s.worst5) })));
    }
    // 你的规则：只说打开了的规则；跟同一组走势"一直拿到期"比，看规则在换什么。
    const ruleOn = rules.takeProfitPct != null || rules.stopMult != null || rules.closeFrac > 0;
    const ruleBits: ReactNode[] = [];
    if (!ruleOn) {
      ruleBits.push(t("future.rulesNone"));
    } else {
      const parts: string[] = [];
      if (rules.takeProfitPct != null) parts.push(t("future.partTp", { p: s.byReason.tp.pct.toFixed(0) }));
      if (rules.stopMult != null) parts.push(t("future.partSl", { p: s.byReason.sl.pct.toFixed(0) }));
      if (rules.closeFrac > 0) parts.push(t("future.partTime", { p: s.byReason.time.pct.toFixed(0) }));
      if (s.byReason.expiry.pct > 0) parts.push(t("future.partExpiry", { p: s.byReason.expiry.pct.toFixed(0) }));
      ruleBits.push(`${parts.join(t("future.sep"))}${t("future.period")}`);
      ruleBits.push(
        ` ${t("future.rulesVsHold", {
          h: Math.round(hold.winPct / 10), n: n10, ha: money(hold.avg), a: money(s.avg), hw: money(hold.worst5), w: money(s.worst5),
        })}`,
      );
    }
    const warn: string[] = [];
    if (rules.stopMult != null && scan?.maxLoss != null && slUnreachable(rules.stopMult)) warn.push(t("future.slUnreach", { m: usd(scan.maxLoss), s: usd(p.slLine) }));
    else if (s.byReason.sl.pct > 35) warn.push(t("winRate.ruleSlTight", { p: s.byReason.sl.pct.toFixed(0) }));
    if (rules.takeProfitPct != null && scan?.maxProfit != null && scan.maxProfit < p.tpLine - 1e-9) warn.push(t("future.tpUnreach", { m: usd(scan.maxProfit), s: usd(p.tpLine) }));
    else if (rules.takeProfitPct != null && s.byReason.tp.pct === 0) warn.push(t("winRate.ruleTpUnreachable", { v: usd(p.tpLine) }));
    card.push(
      row("rules", t("future.rulesLabel"), <>{ruleBits}{warn.length > 0 && <div className="text-amber-300">{warn.join(" ")}</div>}</>),
    );
    // 换个规则试试：同一组走势下几种常见规则，明显更好才建议，一键套用（持仓建议跟着一起变）。
    const alt = run.alt;
    let altBody: ReactNode;
    if (alt === undefined) altBody = <span className="text-slate-500">{t("future.altPending")}</span>;
    else if (!alt) altBody = null;
    else if (!alt.best) altBody = t("future.altNone", { n: alt.tried });
    else {
      const b = alt.best;
      altBody = (
        <span>
          {t(b.why === "avg" ? "future.altAvg" : "future.altWorst", {
            // 试规则用的是另一组（较少的）走势：起点用上面1万次的数字，再加上同一组走势里两种规则的差，前后数字才对得上。
            n: alt.tried, r: describeRules(b.rules), a0: money(s.avg), a1: money(s.avg + b.avg - alt.current.avg),
            w0: money(s.worst5), w1: money(s.worst5 + b.worst5 - alt.current.worst5),
            p0: s.winPct.toFixed(0), p1: Math.max(0, Math.min(100, s.winPct + b.winPct - alt.current.winPct)).toFixed(0),
          })}{" "}
          <button onClick={() => setRules(b.rules)} className="rounded border border-sky-500 px-1.5 py-0 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/20">
            {t("future.altApply")}
          </button>
        </span>
      );
    }
    if (altBody) card.push(row("alt", t("future.altLabel"), altBody));
  }
  // 情景点（不用等主推演算完）
  const scenLines: string[] = [];
  if (scenario && scenState) {
    const d = Math.round(scenario.day);
    if (scenState.kind === "expired") scenLines.push(t("winRate.scenExpired"));
    else {
      if (scenario.day > 0 && Math.abs(scenario.price - spot) > 0.005) {
        const prob = probPriceBeyond(spot, scenario.price, vol, drift, scenario.day);
        const chg = scenario.price / spot - 1;
        scenLines.push(
          t("future.scenWhere", {
            d, dir: t(scenario.price >= spot ? "future.dirUpTo" : "future.dirDownTo"), s: scenario.price.toFixed(2),
            chg: `${chg >= 0 ? "+" : "−"}${Math.abs(chg * 100).toFixed(1)}%`, p: prob < 0.01 ? "<1" : String(Math.round(prob * 100)),
            lvl: t(prob < 0.1 ? "future.lvlRare" : prob < 0.3 ? "future.lvlSome" : "future.lvlCommon"),
          }),
        );
      } else if (scenario.day > 0) {
        scenLines.push(t("future.scenFlat", { d }));
      }
      // 万次推演里，走到情景那天之前已经按规则下车了多少：情景点说的只是还拿着的那部分
      const ed = run.done?.exitDays;
      if (ed && d > 0) {
        const n = run.done!.stats.n || 1;
        const before = (arr: number[]) => (arr.slice(0, Math.min(arr.length, d)).reduce((a, b) => a + b, 0) / n) * 100;
        const tp = before(ed.tp), sl = before(ed.sl), tm = before(ed.time);
        scenLines.push(
          t("future.scenBefore", {
            d, tp: tp.toFixed(0), sl: sl.toFixed(0), time: tm >= 0.5 ? t("future.scenBeforeTime", { p: tm.toFixed(0) }) : "", hold: Math.max(0, 100 - tp - sl - tm).toFixed(0),
          }),
        );
      }
      if (scenState.kind === "afterClose") scenLines.push(t("winRate.scenAfterClose", { d: p.endDay }));
      else if (scenState.kind === "hitTp") scenLines.push(t("winRate.scenHitTp", { v: usd(scenState.pnl) }));
      else if (scenState.kind === "hitSl") scenLines.push(t("winRate.scenHitSl", { v: usd(scenState.pnl) }));
      else if (forkKey) {
        scenLines.push(
          forkShown
            ? t("future.scenFork", {
                tp: forkShown.stats.byReason.tp.pct.toFixed(0), sl: forkShown.stats.byReason.sl.pct.toFixed(0), w: forkShown.stats.winPct.toFixed(0),
                a: money(forkShown.stats.avg), w5: money(forkShown.stats.worst5),
                cmp: s ? t("future.scenForkCmp", { w: s.winPct.toFixed(0), a: money(s.avg), w5: money(s.worst5) }) : "",
              })
            : t("future.forkPending"),
        );
      }
    }
  }
  if (dV !== 0) scenLines.push(t("future.scenIv", { dv: `${dV > 0 ? "+" : "−"}${Math.abs(dV)}` }));

  // ── 卡片开头：滑块动过时，先说滑块的位置 → 走到这个情景期权的价值经历了什么 → 放到万次推演里看这个情景 ──
  const moved = scenario != null || dV !== 0;
  const sDay = scenario?.day ?? 0;
  const sPrice = scenario?.price ?? spot;
  const ivA = ivBase * 100;
  const ivB = Math.max(0, ivA + dV);
  let scenTop: ReactNode = null;
  if (moved) {
    const sec = (key: string, title: string, body: ReactNode) => (
      <div key={key} className="border-t border-slate-800 pt-2 first:border-t-0 first:pt-0">
        <div className="mb-1 text-[12px] font-bold text-slate-100">{title}</div>
        {body}
      </div>
    );
    const parts: ReactNode[] = [sec("now", t("future.nowTitleScen"), <NowCells spot0={spot} spot1={sPrice} day={sDay} horizon={days} ivA={ivA} ivB={ivB} />)];
    if (fork && scenState?.kind !== "expired") {
      const tot = attributeSegment({ legs, spot, day: 0, pnl: 0 }, { legs: fork.legs, spot: fork.spot, day: fork.day, pnl: fork.pnl });
      parts.push(
        sec("journey", Math.round(sDay) > 0 ? t("future.jTitleScen", { d: Math.round(sDay) }) : t("future.jTitleScen0"), (
          <JourneyBlock
            mode="scenario" totals={{ ...tot, total: fork.pnl }} pnl={fork.pnl} credit={credit} basis={p.basis} stance={stance}
            spot0={spot} spot1={sPrice} day={sDay} ivA={ivA} ivB={dV !== 0 ? ivB : null}
          />
        )),
      );
    }
    parts.push(sec("sim", t("future.scenSimTitle", { n: (BATCHES * PER_BATCH).toLocaleString() }), <div className="flex flex-col gap-1 text-sky-100">{scenLines.map((l, i) => <div key={i}>{l}</div>)}</div>));
    scenTop = <div className="flex flex-col gap-2">{parts}</div>;
  }

  const stability = finished && run.done ? batchStability(run.done.first, run.done.stats, p.basis) : null;
  const legend = (
    <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
      <span>
        {revealed === 0
          ? t("future.running")
          : !finished
            ? t("future.batch", { i: revealed, n: BATCHES, per: PER_BATCH.toLocaleString() })
            : t(stability?.similar ? "future.stableYes" : "future.stableNo")}
      </span>
      <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-slate-100/80" />{t("future.lgHold")}</span>
      {rules.takeProfitPct != null && <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: REASON_COLOR.tp }} />{t("winRate.lg_tp")}</span>}
      {rules.stopMult != null && <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: REASON_COLOR.sl }} />{t("winRate.lg_sl")}</span>}
      {forkKey && <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-sky-400/80" />{t("future.lgFork")}</span>}
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto pr-1 text-[11px] text-slate-300">
      {controls}
      <div className="h-[340px] shrink-0 overflow-hidden rounded-md border border-slate-800">
        {view === "3d" ? (
          <SimSurface3D
            model={model}
            days={days}
            rows={ROWS}
            density={run.holding}
            forkDensity={forkShown?.holding ?? null}
            forkStartDay={fork ? Math.round(fork.day) : 0}
            samples={run.samples}
            forkSamples={forkShown?.samples ?? []}
            exits={run.exits}
            scenario={scen}
            endDay={p.endDay}
            labels={labels3d}
            money={(v) => `$${v.toFixed(2)}`}
          />
        ) : (
          <CanvasBox
            className="h-full w-full"
            draw={drawPlane}
            deps={[model, run.holding, run.after, run.exits, end, forkShown, scen?.day, scen?.price, p.endDay, symbol, t]}
            label={t("future.title", { s: symbol })}
          />
        )}
      </div>
      {legend}
      <div className="shrink-0 rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 leading-relaxed">
        {scenTop}
        {moved && <div className="mb-1 mt-2 border-t border-slate-800 pt-2 text-[12px] font-bold text-slate-100">{t("future.tradeTitle", { n: (BATCHES * PER_BATCH).toLocaleString() })}</div>}
        {run.error ? (
          <span className="text-rose-300">{t("winRate.error")}</span>
        ) : card.length ? (
          <div className="flex flex-col gap-1.5">{card}</div>
        ) : (
          <span className="text-slate-500">{t("future.running")}</span>
        )}
        {!moved && <div className="mt-1.5 border-t border-slate-800 pt-1.5 text-sky-100">{t("future.scenNone")}</div>}
        <div className="mt-1.5 text-[10px] text-slate-500">
          {t(credit ? "winRate.basisCredit" : "winRate.basisDebit", { v: usd(p.basis) })} {t("future.model")}
        </div>
      </div>
      <details className="shrink-0 rounded-md border border-slate-800 px-3 py-1.5">
        <summary className="cursor-pointer select-none text-slate-400">{t("winRate.advanced")}</summary>
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <div className="min-w-0">
            <div className="mb-1 text-[10px] text-slate-500">{t("winRate.curveTitle")}</div>
            {curve ? (
              <CanvasBox
                className="h-[170px]"
                draw={(g, W, H) => drawVolCurve(g, W, H, { curve: curve.curve as CurvePoint[], ivCenter: marketIv, vol, breakevenVol: be?.vol ?? null, money, t })}
                deps={[curve, vol, marketIv, t]}
                label={t("winRate.curveTitle")}
              />
            ) : (
              <div className="flex h-[170px] items-center justify-center text-slate-600">{t("winRate.cushionPending")}</div>
            )}
            <div className="mt-1 text-[10px] text-slate-500">{t("winRate.curveHint")}</div>
            {curve?.driftCurve && (
              <>
                <div className="mb-1 mt-2 text-[10px] text-slate-500">{t("winRate.driftCurveTitle")}</div>
                <CanvasBox
                  className="h-[140px]"
                  draw={(g, W, H) => drawDriftCurve(g, W, H, { curve: curve.driftCurve!, driftPct, breakeven: curve.driftBreakeven, money, t })}
                  deps={[curve, driftPct, t]}
                  label={t("winRate.driftCurveTitle")}
                />
              </>
            )}
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[10px] text-slate-500">{t("winRate.distTitle", { n: (BATCHES * PER_BATCH).toLocaleString() })}</div>
            {run.done && (
              <CanvasBox className="h-[130px]" draw={(g, W, H) => drawPnlHist(g, W, H, run.done!.hist as Histogram, money)} deps={[run.done]} label={t("winRate.distTitle", { n: BATCHES * PER_BATCH })} />
            )}
            {s && (
              <div className="mt-1 grid grid-cols-5 gap-1 text-center text-[10px]">
                {(["p5", "p25", "p50", "p75", "p95"] as const).map((k) => (
                  <div key={k} className="rounded bg-slate-900 px-1 py-0.5">
                    <div className="text-slate-500">{t(`winRate.${k}`)}</div>
                    <div className={`tabular-nums font-semibold ${s.percentiles[k] >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(s.percentiles[k])}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

