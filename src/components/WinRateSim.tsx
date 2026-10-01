// src/components/WinRateSim.tsx
// "胜率模拟"标签：按假设的未来实际波动随机生成走势，按止盈/止损/到期前平仓规则逐日检查，
// 自动连掷10批（每批1000条）做成动画，最后给出一段结论（给新手）；折叠区是给高手的盈亏平衡波动率曲线、盈亏分布和分位数。
// 分析模式从开仓日出发（"如果开这笔"）；跟踪对比模式从今天出发（"这笔持仓接下来"），盈亏按开仓以来的总账（含已实现）。
// 计算在winRateSim.worker.ts里跑，这里只负责节奏和展示。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nContext";
import type { Leg } from "@/lib/types";
import {
  openingBasis, isCreditCombo, prepareSim, startStatus, batchStability, cushion, percentileOf, moveInSigma,
  driftCushion, type DriftPoint, type CushionTier,
  type SimRules, type SimStats, type SamplePath, type Histogram, type CurvePoint, type Breakeven, type ExitReason,
} from "@/lib/winRateSim";
import type { SimRequest, SimResponse } from "@/lib/winRateSim.worker";
import { comboBaseIv } from "@/lib/stockOptionMap";
import { computeHV, fetchHistoricalSeries, realizedVolSince } from "@/lib/historicalVolatility";

interface Props {
  symbol: string;
  mode: "analysis" | "tracked";
  simLegs: Leg[]; // 模拟起点的腿位（已去掉屏蔽的）
  spot: number; // 起点股价
  openingLegs: Leg[]; // 开仓组合——止盈止损的基准
  pnlOffset: number; // 起点时已有的总盈亏（每股）
  openingAt: number;
  unitMult: number;
  onUnitChange?: (m: number) => void; // 传了就在控制栏显示每股/每张切换（跟踪对比模式没有头部）
  emptyText: string | null;
  // 今昔对比的"回看"：开仓组合（开仓那天的剩余天数）、开仓价、今天是开仓后第几天、中途是否调整过。
  retro?: { openingLegs: Leg[]; openingSpot: number; todayDay: number; adjusted: boolean };
}

const BATCHES = 10;
const PER_BATCH = 1000;
const SAMPLES = 60;
const REVEAL_MS = 330;
const RULES_KEY = "optionpilot.winRateRules2";
const LIMIT_KEY = "optionpilot.winRateLossLimit";
// 卖方（收钱开仓）和买方（付钱开仓）的规则习惯不同，分开记：卖方赚权利金的一半就走、亏到1倍止损；买方赚1倍、亏一半止损。
type Side = "credit" | "debit";
const DEFAULT_RULES: Record<Side, SimRules> = {
  credit: { takeProfitPct: 0.5, stopMult: 1, closeFrac: 0.25 },
  debit: { takeProfitPct: 1, stopMult: 0.5, closeFrac: 0.25 },
};
const TP_OPTIONS: Record<Side, number[]> = { credit: [0.25, 0.5, 0.75], debit: [0.5, 1, 2] };
const SL_OPTIONS: Record<Side, number[]> = { credit: [0.5, 1, 1.5, 2, 3], debit: [0.25, 0.5, 0.75] };
const CLOSE_FRACS = [0.25, 1 / 3, 0.5];
const fracLabel = (f: number) => (Math.abs(f - 0.25) < 1e-6 ? "1/4" : Math.abs(f - 1 / 3) < 1e-6 ? "1/3" : Math.abs(f - 0.5) < 1e-6 ? "1/2" : `${Math.round(f * 100)}%`);
const REASON_COLOR: Record<ExitReason, string> = { tp: "#34d399", sl: "#fb7185", time: "#fbbf24", expiry: "#38bdf8" };

function loadRules(): Record<Side, SimRules> {
  try {
    const r = JSON.parse(localStorage.getItem(RULES_KEY) ?? "null");
    if (r && typeof r.credit?.closeFrac === "number" && typeof r.debit?.closeFrac === "number") return r as Record<Side, SimRules>;
  } catch {
    /* 用默认 */
  }
  return DEFAULT_RULES;
}

function loadLimit(): number {
  try {
    const v = Number(localStorage.getItem(LIMIT_KEY));
    return v > 0 ? v : 1000;
  } catch {
    return 1000;
  }
}

// 画布：跟容器同宽高，尺寸或数据变了就重画。
function CanvasBox({ className, draw, deps, label }: { className: string; draw: (g: CanvasRenderingContext2D, w: number, h: number) => void; deps: unknown[]; label: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv || size.w < 40 || size.h < 40) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    draw(g, size.w, size.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, ...deps]);
  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <canvas ref={cvRef} role="img" aria-label={label} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

interface RunView {
  batches: SimStats[];
  samples: SamplePath[];
  combined: SimStats | null;
  hist: Histogram | null;
  curve: CurvePoint[] | null;
  breakeven: Breakeven | null;
  retroSorted: number[] | null;
  delta: number | null;
  driftCurve: DriftPoint[] | null;
  driftBreakeven: number | null;
  error: string | null;
}

const EMPTY_RUN: RunView = { batches: [], samples: [], combined: null, hist: null, curve: null, breakeven: null, retroSorted: null, delta: null, driftCurve: null, driftBreakeven: null, error: null };

export default function WinRateSim({ symbol, mode, simLegs, spot, openingLegs, pnlOffset, openingAt, unitMult, onUnitChange, emptyText, retro }: Props) {
  const { t } = useI18n();
  const [rulesBySide, setRulesBySide] = useState<Record<Side, SimRules>>(loadRules);
  const [driftPct, setDriftPct] = useState(0); // 买方：假设的年化涨跌（%），默认0=不预测方向
  const [lossLimit, setLossLimit] = useState<number>(loadLimit);
  const [volOverride, setVolOverride] = useState<number | null>(null);
  const [hv, setHv] = useState<{ status: "loading" | "ok" | "error"; hv20?: number; since?: { vol: number; days: number; limited: boolean } | null }>({ status: "loading" });
  const [run, setRun] = useState<RunView>(EMPTY_RUN);
  const [runNonce, setRunNonce] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const queueRef = useRef<SimResponse[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(RULES_KEY, JSON.stringify(rulesBySide));
    } catch {
      /* 存不了就只在本次生效 */
    }
  }, [rulesBySide]);
  useEffect(() => {
    try {
      localStorage.setItem(LIMIT_KEY, String(lossLimit));
    } catch {
      /* 同上 */
    }
  }, [lossLimit]);

  // 历史波动率：最近20个交易日；跟踪对比模式另算开仓以来的实际波动作参考。
  useEffect(() => {
    setVolOverride(null);
    if (!symbol) return;
    let alive = true;
    setHv({ status: "loading" });
    fetchHistoricalSeries(symbol)
      .then((s) => {
        if (!alive) return;
        const hv20 = computeHV(s.closes, 20);
        setHv({ status: hv20 > 0 ? "ok" : "error", hv20, since: mode === "tracked" ? realizedVolSince(s, openingAt) : null });
      })
      .catch(() => alive && setHv({ status: "error" }));
    return () => {
      alive = false;
    };
  }, [symbol, mode, openingAt]);

  const basis = useMemo(() => openingBasis(openingLegs), [openingLegs]);
  const credit = useMemo(() => isCreditCombo(openingLegs), [openingLegs]);
  const side: Side = credit ? "credit" : "debit";
  const rules = rulesBySide[side];
  const setRules = (r: SimRules) => setRulesBySide((all) => ({ ...all, [side]: r }));
  // 开仓时（最早到期的）总期限：到期前平仓的天数按它的比例算。
  const totalTerm = useMemo(() => {
    const d = openingLegs.filter((l) => !l.disabled && l.kind !== "stock").map((l) => l.dte);
    return d.length ? Math.max(1, Math.round(Math.min(...d))) : 0;
  }, [openingLegs]);
  const hasStock = simLegs.some((l) => l.kind === "stock") || openingLegs.some((l) => !l.disabled && l.kind === "stock");
  const ivCenter = useMemo(() => comboBaseIv(simLegs, spot) ?? 0.3, [simLegs, spot]);
  const defaultVol = hv.status === "ok" && hv.hv20 ? hv.hv20 : ivCenter;
  const vol = volOverride != null ? volOverride / 100 : defaultVol;
  const volReady = volOverride != null || hv.status !== "loading";

  const setup = useMemo(
    () => (basis == null || hasStock ? null : { legs: simLegs.filter((l) => !l.disabled), spot, basis, pnlOffset, rules, totalTerm, drift: credit ? 0 : driftPct / 100 }),
    [basis, hasStock, simLegs, spot, pnlOffset, rules, totalTerm, credit, driftPct],
  );
  const prepared = useMemo(() => (setup ? prepareSim(setup) : null), [setup]);
  const status = prepared ? startStatus(prepared) : "normal";
  const retroLegs = useMemo(() => (retro ? retro.openingLegs.filter((l) => !l.disabled) : []), [retro]);
  const retroIv = useMemo(() => (retro ? comboBaseIv(retroLegs, retro.openingSpot) ?? 0.3 : 0.3), [retro, retroLegs]);
  const retroOn = mode === "tracked" && !!retro && retro.todayDay >= 1 && retro.openingSpot > 0 && retroLegs.length > 0;

  const runKey = useMemo(() => {
    if (!setup) return "";
    const legKey = setup.legs.map((l) => [l.action, l.type, l.strike, l.dte, l.premium, l.qty ?? 1].join(":")).join("|");
    return [legKey, spot.toFixed(2), basis?.toFixed(4), pnlOffset.toFixed(4), JSON.stringify(rules), vol.toFixed(4), runNonce, retroOn ? retro!.todayDay : -1, totalTerm, setup.drift].join("#");
  }, [setup, spot, basis, pnlOffset, rules, vol, runNonce, retroOn, retro, totalTerm]);

  // 输入变了（防抖400ms）→ 新开一个后台线程从头算；旧的直接结束，避免算完没人要的结果。
  useEffect(() => {
    if (!setup || !prepared || !volReady || emptyText) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      workerRef.current?.terminate();
      const w = new Worker(new URL("../lib/winRateSim.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = w;
      queueRef.current = [];
      setRun(EMPTY_RUN);
      const runId = Date.now();
      w.onmessage = (e: MessageEvent<SimResponse>) => {
        if (!cancelled && e.data.runId === runId) queueRef.current.push(e.data);
      };
      const req: SimRequest = {
        runId, setup, vol, ivCenter, batches: BATCHES, perBatch: PER_BATCH, sampleCount: SAMPLES,
        seed: Math.floor(Math.random() * 1e9),
        retro: retroOn ? { legs: retroLegs, spot: retro!.openingSpot, day: retro!.todayDay, vol: retroIv } : undefined,
        debit: !credit,
      };
      w.postMessage(req);
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, volReady, emptyText]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  // 动画节奏：每批停留一小会儿；"合计"和"曲线"要等10批都放完再显示。
  useEffect(() => {
    const id = window.setInterval(() => {
      const q = queueRef.current;
      if (q.length === 0) return;
      const head = q[0];
      if (head.type === "batch") {
        q.shift();
        setRun((r) => ({ ...r, batches: [...r.batches, head.stats], samples: head.samples }));
        return;
      }
      // 非批次消息：一次性全部处理
      while (q.length && q[0].type !== "batch") {
        const m = q.shift()!;
        setRun((r) => {
          if (m.type === "done") return { ...r, combined: m.stats, hist: m.hist };
          if (m.type === "curve") return { ...r, curve: m.curve, breakeven: m.breakeven, delta: m.delta, driftCurve: m.driftCurve, driftBreakeven: m.driftBreakeven };
          if (m.type === "error") return { ...r, error: m.message };
          if (m.type === "retro") return { ...r, retroSorted: m.sorted };
          return r;
        });
      }
    }, REVEAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const money = (v: number, mult = unitMult) => {
    const x = v * mult;
    const a = Math.abs(x);
    const s = a >= 100 ? Math.round(a).toLocaleString() : a.toFixed(2);
    return `${x < -0.005 ? "−" : ""}$${s}`;
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  if (emptyText) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-400">{emptyText}</div>;
  }
  if (hasStock || basis == null || !prepared) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">
        {hasStock ? t("winRate.noStock") : t("winRate.noBasis")}
      </div>
    );
  }

  const p = prepared;
  const horizon = p.horizon;
  const revealed = run.batches.length;
  const finished = revealed >= BATCHES && run.combined != null;
  const stability = finished && run.combined ? batchStability(run.batches[0], run.combined, p.basis) : null;
  const be = run.breakeven;
  const cush = be ? cushion(be, vol) : null;
  const sets = Math.max(1, Math.min(...p.legs.filter((l) => l.kind !== "stock").map((l) => l.qty ?? 1)));

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

  const controls = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-400">
      <label className="flex items-center gap-1">
        {t("winRate.tp")}
        <select className={sel} value={String(rules.takeProfitPct)} onChange={(e) => setRules({ ...rules, takeProfitPct: e.target.value === "null" ? null : Number(e.target.value) })}>
          {TP_OPTIONS[side].map((v) => <option key={v} value={v}>{t("winRate.tpOpt", { n: v * 100 })}</option>)}
          <option value="null">{t("winRate.none")}</option>
        </select>
      </label>
      <label className="flex items-center gap-1">
        {t("winRate.sl")}
        <select className={sel} value={String(rules.stopMult)} onChange={(e) => setRules({ ...rules, stopMult: e.target.value === "null" ? null : Number(e.target.value) })}>
          {SL_OPTIONS[side].map((v) => <option key={v} value={v}>{credit ? t("winRate.slOpt", { n: v }) : t("winRate.slOptDebit", { n: v * 100 })}</option>)}
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
        {mode === "tracked" && hv.since && chip(t(hv.since.limited ? "winRate.volSinceOpenLimited" : "winRate.volSinceOpen", { v: (hv.since.vol * 100).toFixed(1) }), hv.since.vol, "since")}
        {chip(t("winRate.volIv", { v: (ivCenter * 100).toFixed(1) }), ivCenter, "iv")}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {onUnitChange && (
          <span className="flex items-center rounded border border-slate-700 p-0.5 text-[9px]">
            {[1, 100].map((m) => (
              <button key={m} onClick={() => onUnitChange(m)} className={`rounded px-1.5 py-0.5 font-semibold ${unitMult === m ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}>
                {t(m === 1 ? "chart.unitShare" : "chart.unitContract")}
              </button>
            ))}
          </span>
        )}
        <button onClick={() => setRunNonce((n) => n + 1)} className="rounded border border-slate-600 px-2 py-0.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-800">
          {t("winRate.rerun")}
        </button>
      </span>
    </div>
  );

  // ── 走势动画 ──
  const lastDay = Math.max(1, horizon);
  const w2 = 2.3 * vol * Math.sqrt(horizon / 365);
  let pLo = spot * Math.exp(-w2);
  let pHi = spot * Math.exp(w2);
  const strikes = [...new Set(p.legs.filter((l) => l.kind !== "stock").map((l) => l.strike))];
  for (const k of strikes) {
    if (k < pLo && k > spot * 0.5) pLo = k - (pHi - pLo) * 0.04;
    if (k > pHi && k < spot * 1.5) pHi = k + (pHi - pLo) * 0.04;
  }
  const drawPaths = (g: CanvasRenderingContext2D, W: number, H: number) => {
    const L = 38, R = 8, T = 8, B = 18;
    const X = (d: number) => L + (d / lastDay) * (W - L - R);
    const Y = (s: number) => T + ((pHi - Math.min(pHi, Math.max(pLo, s))) / (pHi - pLo)) * (H - T - B);
    g.fillStyle = "#020617";
    g.fillRect(L, T, W - L - R, H - T - B);
    g.font = "10px sans-serif";
    for (const k of strikes) {
      if (k < pLo || k > pHi) continue;
      g.strokeStyle = k > spot * 1.005 ? "rgba(52,211,153,0.45)" : k < spot * 0.995 ? "rgba(251,113,133,0.45)" : "rgba(226,232,240,0.45)";
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(L, Y(k));
      g.lineTo(W - R, Y(k));
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#94a3b8";
      g.textAlign = "right";
      g.fillText(String(k), L - 3, Y(k) + 3);
    }
    if (p.endDay < horizon) {
      g.strokeStyle = "rgba(251,191,36,0.5)";
      g.setLineDash([2, 4]);
      g.beginPath();
      g.moveTo(X(p.endDay), T);
      g.lineTo(X(p.endDay), H - B);
      g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = "#64748b";
    g.textAlign = "left";
    g.fillText(t(mode === "tracked" ? "winRate.axisToday" : "winRate.axisOpen"), L, H - 4);
    g.textAlign = "right";
    g.fillText(t("winRate.axisExpiry", { d: horizon }), W - R, H - 4);
    if (p.endDay < horizon && p.endDay > 0) {
      g.textAlign = "center";
      g.fillStyle = "#b45309";
      g.fillText(t("winRate.axisClose"), X(p.endDay), H - 4);
    }
    for (const sp of run.samples) {
      g.strokeStyle = REASON_COLOR[sp.reason];
      g.globalAlpha = 0.45;
      g.lineWidth = 1;
      g.beginPath();
      sp.prices.forEach((s, d) => (d ? g.lineTo(X(d), Y(s)) : g.moveTo(X(d), Y(s))));
      g.stroke();
      g.globalAlpha = 1;
      const d = sp.prices.length - 1;
      g.fillStyle = REASON_COLOR[sp.reason];
      g.beginPath();
      g.arc(X(d), Y(sp.prices[d]), 2.2, 0, Math.PI * 2);
      g.fill();
    }
  };

  // ── 每批结果对比条 ──
  const drawStrip = (g: CanvasRenderingContext2D, W: number, H: number) => {
    const rows: { label: string; get: (s: SimStats) => number; color: string; fmt: (v: number) => string }[] = [
      { label: t("winRate.stripTp"), get: (s) => s.byReason.tp.pct, color: REASON_COLOR.tp, fmt: (v) => `${v.toFixed(0)}%` },
      { label: t("winRate.stripSl"), get: (s) => s.byReason.sl.pct, color: REASON_COLOR.sl, fmt: (v) => `${v.toFixed(0)}%` },
      { label: t("winRate.stripAvg"), get: (s) => s.avg, color: "#93c5fd", fmt: (v) => money(v) },
    ];
    const rh = H / rows.length;
    const L = 44, R = 10;
    g.font = "10px sans-serif";
    rows.forEach((row, i) => {
      const y = i * rh + rh / 2 - 4;
      const vals = run.batches.map(row.get);
      let lo = vals.length ? Math.min(...vals) : 0;
      let hi = vals.length ? Math.max(...vals) : 1;
      const pad = i < 2 ? 10 : Math.max(p.basis * 0.25, (hi - lo) * 0.5);
      lo -= pad;
      hi += pad;
      if (i < 2) {
        lo = Math.max(0, lo);
        hi = Math.min(100, hi);
      }
      const X = (v: number) => L + ((v - lo) / (hi - lo || 1)) * (W - L - R);
      g.fillStyle = "#94a3b8";
      g.textAlign = "left";
      g.fillText(row.label, 0, y + 3);
      g.strokeStyle = "#334155";
      g.beginPath();
      g.moveTo(L, y);
      g.lineTo(W - R, y);
      g.stroke();
      g.fillStyle = "#64748b";
      g.fillText(row.fmt(lo), L, y + 14);
      g.textAlign = "right";
      g.fillText(row.fmt(hi), W - R, y + 14);
      vals.forEach((v, j) => {
        g.fillStyle = j === 0 ? "#f8fafc" : row.color;
        g.globalAlpha = j === 0 ? 1 : 0.8;
        g.beginPath();
        g.arc(X(v), y, j === 0 ? 4.5 : 3.2, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      });
    });
  };

  // ── 结论卡片 ──
  const cardLines: ReactNode[] = [];
  if (finished && run.combined && stability) {
    const s = run.combined;
    const f1 = stability.first;
    cardLines.push(
      <div key="stab" className="text-[11px] text-slate-400">
        <span className="mr-1 text-slate-100">●</span>
        {t(stability.similar ? "winRate.stableYes" : "winRate.stableNo", {
          t1: `${f1.byReason.tp.pct.toFixed(1)}%`, s1: `${f1.byReason.sl.pct.toFixed(1)}%`, a1: money(f1.avg),
          t: `${s.byReason.tp.pct.toFixed(1)}%`, s: `${s.byReason.sl.pct.toFixed(1)}%`, a: money(s.avg),
        })}
      </div>,
    );
    if (status === "atTakeProfit" || status === "atStop" || status === "inCloseWindow") {
      cardLines.push(
        <div key="status" className="font-semibold text-amber-300">
          {status === "inCloseWindow"
            ? t("winRate.decideInClose", { c: p.closeAtRemaining })
            : t(status === "atTakeProfit" ? "winRate.decideAtTp" : "winRate.decideAtSl", { v: money(pnlOffset) })}
        </div>,
      );
    }
    cardLines.push(
      <div key="head" className="text-[13px] font-semibold text-slate-100">
        {mode === "tracked" ? t("winRate.headTracked", { d: horizon }) : t("winRate.headAnalysis")}
        <span className="ml-1 text-[10px] font-normal text-slate-500">({t(unitMult === 100 ? "chart.unitContract" : "chart.unitShare")})</span>
      </div>,
    );
    // 做10次里的次数；不到半次时说"不到1次"，不显示"0次"。
    const count = (r: ExitReason) => (s.byReason[r].pct < 5 ? t("winRate.lessThanOne") : String(Math.round(s.byReason[r].pct / 10)));
    const parts: ReactNode[] = [];
    const part = (r: ExitReason, text: string) =>
      s.byReason[r].pct > 0 &&
      parts.push(
        <span key={r} style={{ color: REASON_COLOR[r] }}>
          {text}
        </span>,
      );
    part("tp", t("winRate.lineTp", { n: count("tp"), v: money(s.byReason.tp.avgPnl), d: Math.round(s.byReason.tp.avgDay) }));
    part("sl", t("winRate.lineSl", { n: count("sl"), v: money(s.byReason.sl.avgPnl), d: Math.round(s.byReason.sl.avgDay) }));
    part("time", t("winRate.lineTime", { n: count("time"), c: p.closeAtRemaining, v: money(s.byReason.time.avgPnl) }));
    part("expiry", t("winRate.lineExpiry", { n: count("expiry"), v: money(s.byReason.expiry.avgPnl) }));
    cardLines.push(
      <div key="parts" className="flex flex-wrap gap-x-3">
        {parts}
      </div>,
    );
    cardLines.push(
      <div key="avg">
        {t(mode === "tracked" ? "winRate.lineAvgTracked" : "winRate.lineAvg", { v: money(s.avg), w: s.winPct.toFixed(0), d: Math.round(s.avgDays) })}
      </div>,
    );
    if (s.worst5 < 0) {
      const perSet = (Math.abs(s.worst5) * 100) / sets;
      const maxSets = Math.floor(lossLimit / perSet);
      cardLines.push(
        <div key="worst" className="flex flex-wrap items-center gap-1">
          <span>{t("winRate.worst", { v: money(s.worst5) })}</span>
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
          <span>{t("winRate.sizingPost", { n: maxSets, m: sets, v: `$${Math.round(perSet).toLocaleString()}` })}</span>
        </div>,
      );
    } else {
      cardLines.push(<div key="worst">{t("winRate.worstPositive", { v: money(s.worst5) })}</div>);
    }
    // 安全垫：卖方/波动型组合看盈亏平衡波动率；买方方向型组合（每张平均|Delta|≥0.3，比如Leap Call）看盈亏平衡年化涨跌。
    const directional = !credit && run.delta != null && Math.abs(run.delta) >= 0.3;
    let tier: CushionTier | null = null;
    const tierCls = (tr: CushionTier) => (tr === "ample" ? "text-emerald-300" : tr === "thin" ? "text-amber-300" : "text-rose-300");
    if (!be) {
      cardLines.push(<div key="cush" className="text-slate-500">{t("winRate.cushionPending")}</div>);
    } else if (directional) {
      const req = run.driftBreakeven;
      if (req == null) {
        const allWin = (run.driftCurve ?? []).every((d) => d.avg > 0);
        cardLines.push(<div key="cush">{t(allWin ? "winRate.noDriftCrossWin" : "winRate.noDriftCrossLose")}</div>);
      } else {
        const dc = driftCushion(req, driftPct / 100);
        tier = dc.tier;
        cardLines.push(
          <div key="cush">
            <span className="font-semibold text-slate-100">{t("winRate.cushionTitle")} </span>
            <span className={`font-semibold ${tierCls(dc.tier)}`}>
              {t("winRate.cushionPp", { v: (dc.value * 100).toFixed(0) })}（{t(`winRate.tier_${dc.tier}`)}）
            </span>
            <span className="ml-1">
              {t("winRate.cushionDrift", {
                dir: t(req >= 0 ? "winRate.dirUp" : "winRate.dirDown"), req: Math.abs(req * 100).toFixed(1), rv: (vol * 100).toFixed(1),
                mu: `${driftPct >= 0 ? "+" : ""}${driftPct}`, note: driftPct === 0 ? t("winRate.noViewNote") : "",
              })}
            </span>
          </div>,
        );
      }
    } else if (be.vol == null || !cush) {
      cardLines.push(
        <div key="cush">
          {t(be.alwaysPositive ? "winRate.noCrossWin" : "winRate.noCrossLose", {
            lo: run.curve ? (run.curve[0].vol * 100).toFixed(0) : "",
            hi: run.curve ? (run.curve[run.curve.length - 1].vol * 100).toFixed(0) : "",
          })}
        </div>,
      );
    } else {
      tier = cush.tier;
      cardLines.push(
        <div key="cush">
          <span className="font-semibold text-slate-100">{t("winRate.cushionTitle")} </span>
          <span className={`font-semibold ${tierCls(cush.tier)}`}>
            {pct(cush.value)}（{t(`winRate.tier_${cush.tier}`)}）
          </span>
          <span className="ml-1">
            {t(be.side === "short" ? "winRate.cushionShort" : "winRate.cushionLong", { bev: (be.vol * 100).toFixed(1), rv: (vol * 100).toFixed(1) })}
          </span>
        </div>,
      );
    }
    if (tier && mode === "tracked" && status === "normal") {
      const key = tier === "none" ? (pnlOffset >= 0 ? "winRate.decideCloseProfit" : "winRate.decideCloseLoss") : "winRate.decideHold";
      cardLines.push(
        <div key="decide" className={tier === "none" ? "font-semibold text-amber-300" : "text-slate-200"}>
          {t(key, { v: money(Math.abs(pnlOffset)) })}
        </div>,
      );
    }
    // 规则检查
    const checks: string[] = [];
    if (rules.stopMult != null && s.byReason.sl.pct === 0 && s.min > p.slLine) {
      checks.push(t("winRate.ruleSlUnreachable", { v: money(p.slLine), m: money(s.min) }));
    } else if (s.byReason.sl.pct > 35) {
      checks.push(t("winRate.ruleSlTight", { p: s.byReason.sl.pct.toFixed(0) }));
    }
    if (rules.takeProfitPct != null && s.byReason.tp.pct === 0 && status === "normal") {
      checks.push(t("winRate.ruleTpUnreachable", { v: money(p.tpLine) }));
    }
    cardLines.push(
      <div key="rules" className={checks.length ? "text-amber-300" : "text-slate-400"}>
        {checks.length ? checks.join(" ") : t("winRate.ruleOk")}
      </div>,
    );
    cardLines.push(
      <div key="assume" className="text-[10px] text-slate-500">
        {t(credit ? "winRate.basisCredit" : "winRate.basisDebit", { v: money(p.basis) })} {t(credit ? "winRate.assumptions" : "winRate.assumptionsDebit")}
      </div>,
    );
  }

  // ── 高级分析：盈亏平衡波动率曲线 + 分布 ──
  const drawCurve = (g: CanvasRenderingContext2D, W: number, H: number) => {
    const c = run.curve;
    if (!c) return;
    const L = 46, R = 10, T = 16, B = 20;
    const vols = c.map((x) => x.vol);
    const vLo = Math.min(...vols), vHi = Math.max(...vols);
    const ys = c.map((x) => x.avg * unitMult);
    let yLo = Math.min(0, ...ys), yHi = Math.max(0, ...ys);
    const pad = (yHi - yLo) * 0.1 || 1;
    yLo -= pad;
    yHi += pad;
    const X = (v: number) => L + ((v - vLo) / (vHi - vLo || 1)) * (W - L - R);
    const Y = (y: number) => T + ((yHi - y) / (yHi - yLo)) * (H - T - B);
    g.font = "10px sans-serif";
    g.strokeStyle = "#475569";
    g.beginPath();
    g.moveTo(L, Y(0));
    g.lineTo(W - R, Y(0));
    g.stroke();
    g.fillStyle = "#64748b";
    g.textAlign = "right";
    g.fillText(money(yHi / unitMult), L - 3, T + 4);
    g.fillText(money(yLo / unitMult), L - 3, H - B);
    g.textAlign = "center";
    for (let i = 0; i < c.length; i += 3) g.fillText(`${(c[i].vol * 100).toFixed(0)}%`, X(c[i].vol), H - 5);
    const mark = (v: number, label: string, color: string, row: number) => {
      if (v < vLo || v > vHi) return;
      g.strokeStyle = color;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(X(v), T);
      g.lineTo(X(v), H - B);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = color;
      g.textAlign = X(v) > W - 80 ? "right" : "left";
      g.fillText(label, X(v) + (X(v) > W - 80 ? -3 : 3), T + 2 + row * 11);
    };
    mark(ivCenter, t("winRate.markIv", { v: (ivCenter * 100).toFixed(0) }), "#a78bfa", 0);
    mark(vol, t("winRate.markRv", { v: (vol * 100).toFixed(0) }), "#fbbf24", 1);
    if (be?.vol != null) mark(be.vol, t("winRate.markBev", { v: (be.vol * 100).toFixed(1) }), "#f8fafc", 2);
    g.strokeStyle = "#60a5fa";
    g.lineWidth = 2;
    g.beginPath();
    c.forEach((x, i) => (i ? g.lineTo(X(x.vol), Y(x.avg * unitMult)) : g.moveTo(X(x.vol), Y(x.avg * unitMult))));
    g.stroke();
    g.lineWidth = 1;
  };
  const drawDrift = (g: CanvasRenderingContext2D, W: number, H: number) => {
    const c = run.driftCurve;
    if (!c) return;
    const L = 46, R = 10, T = 16, B = 20;
    const xs = c.map((x) => x.drift);
    const xLo = Math.min(...xs), xHi = Math.max(...xs);
    const ys = c.map((x) => x.avg * unitMult);
    let yLo = Math.min(0, ...ys), yHi = Math.max(0, ...ys);
    const pad = (yHi - yLo) * 0.1 || 1;
    yLo -= pad;
    yHi += pad;
    const X = (v: number) => L + ((v - xLo) / (xHi - xLo || 1)) * (W - L - R);
    const Y = (y: number) => T + ((yHi - y) / (yHi - yLo)) * (H - T - B);
    g.font = "10px sans-serif";
    g.strokeStyle = "#475569";
    g.beginPath();
    g.moveTo(L, Y(0));
    g.lineTo(W - R, Y(0));
    g.stroke();
    g.fillStyle = "#64748b";
    g.textAlign = "right";
    g.fillText(money(yHi / unitMult), L - 3, T + 4);
    g.fillText(money(yLo / unitMult), L - 3, H - B);
    g.textAlign = "center";
    for (let i = 0; i < c.length; i += 2) g.fillText(`${c[i].drift >= 0 ? "+" : ""}${Math.round(c[i].drift * 100)}%`, X(c[i].drift), H - 5);
    const mark = (v: number, label: string, color: string, row: number) => {
      if (v < xLo || v > xHi) return;
      g.strokeStyle = color;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(X(v), T);
      g.lineTo(X(v), H - B);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = color;
      g.textAlign = X(v) > W - 90 ? "right" : "left";
      g.fillText(label, X(v) + (X(v) > W - 90 ? -3 : 3), T + 2 + row * 11);
    };
    mark(driftPct / 100, t("winRate.markDrift", { v: driftPct }), "#fbbf24", 0);
    if (run.driftBreakeven != null) mark(run.driftBreakeven, t("winRate.markDriftBe", { v: (run.driftBreakeven * 100).toFixed(1) }), "#f8fafc", 1);
    g.strokeStyle = "#60a5fa";
    g.lineWidth = 2;
    g.beginPath();
    c.forEach((x, i) => (i ? g.lineTo(X(x.drift), Y(x.avg * unitMult)) : g.moveTo(X(x.drift), Y(x.avg * unitMult))));
    g.stroke();
    g.lineWidth = 1;
  };
  const drawHist = (g: CanvasRenderingContext2D, W: number, H: number) => {
    const h = run.hist;
    if (!h) return;
    const L = 6, R = 6, T = 6, B = 18;
    const m = Math.max(...h.counts) || 1;
    const bw = (W - L - R) / h.counts.length;
    const w = (h.hi - h.lo) / h.counts.length;
    h.counts.forEach((n, i) => {
      const mid = h.lo + (i + 0.5) * w;
      const bh = (n / m) * (H - T - B);
      g.fillStyle = mid >= 0 ? "#34d399" : "#fb7185";
      g.fillRect(L + i * bw + 1, H - B - bh, Math.max(1, bw - 2), bh);
    });
    g.font = "10px sans-serif";
    g.fillStyle = "#64748b";
    g.textAlign = "left";
    g.fillText(money(h.lo), L, H - 4);
    g.textAlign = "right";
    g.fillText(money(h.hi), W - R, H - 4);
    if (h.lo < 0 && h.hi > 0) {
      const zx = L + ((0 - h.lo) / (h.hi - h.lo)) * (W - L - R);
      g.strokeStyle = "#94a3b8";
      g.beginPath();
      g.moveTo(zx, T);
      g.lineTo(zx, H - B);
      g.stroke();
      g.textAlign = "center";
      g.fillText("0", zx, H - 4);
    }
  };

  // ── 回看：今天为什么是这样（运气 vs 优势）──
  let retroSection: ReactNode = null;
  if (retroOn && retro) {
    const sorted = run.retroSorted;
    const z = moveInSigma(retro.openingSpot, spot, retroIv, retro.todayDay);
    const movePct = (spot / retro.openingSpot - 1) * 100;
    const since = hv.status === "ok" ? hv.since : null;
    const ratio = since ? since.vol / retroIv : null;
    const edge: "good" | "bad" | "even" | null =
      ratio == null ? null : credit ? (ratio < 0.9 ? "good" : ratio > 1.1 ? "bad" : "even") : ratio > 1.1 ? "good" : ratio < 0.9 ? "bad" : "even";
    const level = Math.abs(z) >= 1.5 ? "big" : Math.abs(z) >= 1 ? "mid" : "small";
    let verdict = "";
    let pctile = 50;
    if (sorted && sorted.length) {
      pctile = percentileOf(sorted, pnlOffset);
      if (pctile < 35) verdict = level === "big" ? "verdictLuck" : edge === "bad" ? "verdictEdgeBad" : level === "mid" ? "verdictLuck" : "verdictOther";
      else if (pctile > 65) verdict = edge === "good" ? "verdictGoodEdge" : level !== "small" ? "verdictGoodLuck" : "verdictGood";
      else verdict = "verdictNormal";
    }
    const q = (f: number) => (sorted && sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * (sorted.length - 1)))] : 0);
    const drawRetro = (g: CanvasRenderingContext2D, W: number, H: number) => {
      if (!sorted || !sorted.length) return;
      const lo = Math.min(q(0.01), pnlOffset);
      const hi = Math.max(q(0.99), pnlOffset);
      const bins = 28;
      const counts = new Array(bins).fill(0);
      const w = (hi - lo) / bins || 1;
      for (const v of sorted) if (v >= lo && v <= hi) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
      const m = Math.max(...counts) || 1;
      const L = 4, R = 4, T = 14, B = 14;
      const bw = (W - L - R) / bins;
      counts.forEach((n, i) => {
        const mid = lo + (i + 0.5) * w;
        const h = (n / m) * (H - T - B);
        g.fillStyle = mid >= 0 ? "rgba(52,211,153,0.55)" : "rgba(251,113,133,0.55)";
        g.fillRect(L + i * bw + 0.5, H - B - h, Math.max(1, bw - 1), h);
      });
      const ax = L + ((pnlOffset - lo) / (hi - lo || 1)) * (W - L - R);
      g.strokeStyle = "#f8fafc";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(ax, T - 2);
      g.lineTo(ax, H - B);
      g.stroke();
      g.lineWidth = 1;
      g.font = "10px sans-serif";
      g.fillStyle = "#f8fafc";
      g.textAlign = ax > W - 60 ? "right" : ax < 60 ? "left" : "center";
      g.fillText(t("winRate.retroYou"), ax, 10);
      g.fillStyle = "#64748b";
      g.textAlign = "left";
      g.fillText(money(lo), L, H - 2);
      g.textAlign = "right";
      g.fillText(money(hi), W - R, H - 2);
    };
    retroSection = (
      <div className="rounded-md border border-sky-800/60 bg-slate-900/60 px-3 py-2 leading-relaxed">
        <div className="mb-1 text-[13px] font-bold text-sky-300">{t("winRate.retroTitle")}</div>
        {!sorted ? (
          <div className="text-slate-500">{t("winRate.retroPending")}</div>
        ) : (
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
            <div className="flex flex-col gap-1">
              <div>
                {t("winRate.retroPos", {
                  iv: (retroIv * 100).toFixed(1), d: retro.todayDay, p25: money(q(0.25)), p75: money(q(0.75)), p50: money(q(0.5)),
                  a: money(pnlOffset), pct: pctile.toFixed(0),
                })}
              </div>
              <div>
                <span className="font-semibold text-slate-100">{t("winRate.luckLabel")}</span>
                {t("winRate.retroLuck", {
                  dir: t(movePct >= 0 ? "winRate.dirUp" : "winRate.dirDown"), m: Math.abs(movePct).toFixed(1), z: Math.abs(z).toFixed(1), level: t(`winRate.level_${level}`),
                })}
              </div>
              <div>
                <span className="font-semibold text-slate-100">{t("winRate.edgeLabel")}</span>
                {since && edge
                  ? t("winRate.retroEdge", {
                      iv: (retroIv * 100).toFixed(1), rv: (since.vol * 100).toFixed(1), limited: since.limited ? t("winRate.limitedNote") : "",
                      verdict: t(`winRate.edge_${edge}${credit ? "Short" : "Long"}`),
                    })
                  : t("winRate.retroEdgeNA")}
              </div>
              {verdict && <div className="font-semibold text-amber-200">{t(`winRate.${verdict}`)}</div>}
              {retro.adjusted && <div className="text-[10px] text-slate-500">{t("winRate.retroAdjusted")}</div>}
            </div>
            <div className="min-w-0">
              <CanvasBox className="h-[110px]" draw={drawRetro} deps={[sorted, pnlOffset, unitMult, t]} label={t("winRate.retroTitle")} />
              <div className="text-center text-[10px] text-slate-500">{t("winRate.retroHistHint")}</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const legend = (["tp", "sl", "time", "expiry"] as ExitReason[])
    .filter((r) => (r === "time" ? p.endDay < horizon : r === "expiry" ? p.endDay >= horizon : true))
    .map((r) => (
      <span key={r} className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: REASON_COLOR[r] }} />
        {t(`winRate.lg_${r}`)}
      </span>
    ));

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto pr-1 text-[11px] text-slate-300">
      {retroOn && retroSection}
      {retroOn && <div className="mt-1 text-[13px] font-bold text-sky-300">{t("winRate.forwardTitle")}</div>}
      {controls}
      <div className="grid min-h-[210px] grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
        <div className="flex min-w-0 flex-col">
          <CanvasBox className="h-[200px]" draw={drawPaths} deps={[run.samples, pLo, pHi, horizon, p.endDay, t]} label={t("winRate.pathsAria")} />
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
            <span>{revealed === 0 ? t("winRate.running") : t("winRate.batchLabel", { i: revealed, n: BATCHES, per: PER_BATCH.toLocaleString(), s: SAMPLES })}</span>
            {legend}
          </div>
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="mb-1 text-[10px] text-slate-500">{t("winRate.stripTitle")}</div>
          <CanvasBox className="h-[180px]" draw={drawStrip} deps={[run.batches, unitMult, t]} label={t("winRate.stripTitle")} />
        </div>
      </div>
      <div className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 leading-relaxed">
        {run.error ? (
          <span className="text-rose-300">{t("winRate.error")}</span>
        ) : finished ? (
          <div className="flex flex-col gap-1">{cardLines}</div>
        ) : (
          <span className="text-slate-500">{revealed === 0 ? t("winRate.running") : t("winRate.firstDone", { n: BATCHES - 1 })}</span>
        )}
      </div>
      <details className="rounded-md border border-slate-800 px-3 py-1.5">
        <summary className="cursor-pointer select-none text-slate-400">{t("winRate.advanced")}</summary>
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <div className="min-w-0">
            <div className="mb-1 text-[10px] text-slate-500">{t("winRate.curveTitle")}</div>
            {run.curve ? (
              <CanvasBox className="h-[170px]" draw={drawCurve} deps={[run.curve, be, vol, unitMult, ivCenter, t]} label={t("winRate.curveTitle")} />
            ) : (
              <div className="flex h-[170px] items-center justify-center text-slate-600">{t("winRate.cushionPending")}</div>
            )}
            <div className="mt-1 text-[10px] text-slate-500">{t("winRate.curveHint")}</div>
            {run.driftCurve && (
              <>
                <div className="mb-1 mt-2 text-[10px] text-slate-500">{t("winRate.driftCurveTitle")}</div>
                <CanvasBox className="h-[140px]" draw={drawDrift} deps={[run.driftCurve, run.driftBreakeven, driftPct, unitMult, t]} label={t("winRate.driftCurveTitle")} />
              </>
            )}
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[10px] text-slate-500">{t("winRate.distTitle", { n: (BATCHES * PER_BATCH).toLocaleString() })}</div>
            <CanvasBox className="h-[130px]" draw={drawHist} deps={[run.hist, unitMult]} label={t("winRate.distTitle", { n: BATCHES * PER_BATCH })} />
            {run.combined && (
              <div className="mt-1 grid grid-cols-5 gap-1 text-center text-[10px]">
                {(["p5", "p25", "p50", "p75", "p95"] as const).map((k) => (
                  <div key={k} className="rounded bg-slate-900 px-1 py-0.5">
                    <div className="text-slate-500">{t(`winRate.${k}`)}</div>
                    <div className={`tabular-nums font-semibold ${run.combined!.percentiles[k] >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(run.combined!.percentiles[k])}</div>
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
