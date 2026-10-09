// src/components/FutureSim.tsx
// "万次推演"标签（推演未来）：按假设的实际波动随机走1万次，按你的止盈/止损/平仓规则逐日检查。
// 画面跟"股价 vs 期权价"同一张地形图（平面）或把它立起来的曲面（立体）：走得多的地方发亮、下车点、到期落点、
// 情景点和从情景点往后的蓝色云。结论卡片按"判断→（隐含波动率远高于实际时的提醒）→为什么→胜率和赔率→最坏→你的规则→换个规则→情景点"给大白话。
// 三个情景滑块都生效：股价/时间定情景点（从那里分出第二团云，跟左边持仓建议同一组走势），波动率改变期权定价、整张图重算。
// 计算在futureSim.worker.ts，这里管节奏和展示。今昔对比的回看在RetroSim（同一个worker的retro请求）。
import { formatDateInput } from "@/lib/dateUtils";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nContext";
import type { Leg } from "@/lib/types";
import {
  openingBasis, isCreditCombo, prepareSim, simPnlAt, earningsShift, exitCost, maxShortDelta, probPriceBeyond, batchStability, driftCushion, capJump,
  type SimRules, type SimStats, type Histogram, type CurvePoint, type Breakeven, type DriftPoint,
} from "@/lib/winRateSim";
import type { ExitPoint, GridSpec, RuleSuggestion, Band, Story } from "@/lib/futureSim";
import { drawZones, drawBands, labelBands, tagBox, type PlaneFrame, type Placed } from "@/lib/planeChart";
import type { FutureRequest, FutureResponse, Sample } from "@/lib/futureSim.worker";
import { buildMapModel, comboBaseIv, attributeSegment } from "@/lib/stockOptionMap";
import { priceStance } from "@/lib/retroStory";
import { NowCells, JourneyBlock } from "@/components/ValueJourney";
import { expiryScan, type ScenarioAdviceSummary } from "@/lib/positionAdvisor";
import { earningsDayFrom, exEarningsVol, type EarningsCtx } from "@/lib/earnings";
import { useSimSettings, setEarnJumpOn, setIvSkewOn, setSideRules, setVolOverride as setVolOverrideFor, setDriftPct as setDriftPctFor, fracLabel, type Side } from "@/lib/simSettings";
import { computeHV, fetchHistoricalSeries, type HistoryRange } from "@/lib/historicalVolatility";
import { buildHistPaths, histProbBeyond, MIN_HIST_PATHS } from "@/lib/histPaths";
import CanvasBox from "@/components/simCharts";
import SimSurface3D from "@/components/SimSurface3D";
import HowToRead from "@/components/HowToRead";
import InfoTip from "@/components/InfoTip";
import MoneyPanel from "@/components/MoneyPanel";
import { drawVolCurve, drawDriftCurve, drawPnlHist } from "@/lib/simChartDraw";

interface Props {
  symbol: string;
  legs: Leg[]; // 开仓组合（已去掉屏蔽的），dte按开仓那天算
  spot: number; // 开仓价
  dV: number; // 波动率滑块（百分点）
  scenario: { day: number; price: number } | null; // 股价/时间滑块定的情景点（都为0时null）
  // 情景点那一刻的腿位（理论价）和开仓以来盈亏，跟左边持仓建议卡片的输入完全一样；null=情景日期已过最早到期日
  fork: { legs: Leg[]; spot: number; day: number; pnl: number } | null;
  // 市场预期波动（小数）：最近到期日平值期权的隐含波动率（见lib/atmIv.ts），取不到期权链时是各腿平均。
  // 跟波动率滑块小字、地形图喇叭口、持仓建议同一个数。
  marketIv: number;
  ivSource: "atm" | "legs";
  // 第3组：微笑斜率（下跌时IV上升）和各腿半个买卖价差（成交损耗），下标跟legs一致
  skew?: number;
  halfSpread?: (number | undefined)[];
  // 财报这一组：下一次财报（lib/earnings.ts），持仓期间有财报时可以在那天加一次跳空
  earnings?: EarningsCtx | null;
  // 左边持仓建议在同一个情景点算出的建议：情景结论的"建议"直接用它，平均钱数只当作理由之一
  leftAdvice?: ScenarioAdviceSummary | null;
  emptyText: string | null;
}

const BATCHES = 10;
// 平面图左右边距：下面"你的钱会怎么变"用同样的边距，两张图的时间轴才竖着对齐
const PLANE_ML = 56;
const PLANE_MR = 96;
const PER_BATCH = 1000;
const SAMPLES = 60;
const ROWS = 80;
const REVEAL_MS = 330;
const LIMIT_KEY = "optionpilot.winRateLossLimit";
const VIEW_KEY = "optionpilot.simView";
// 第2组：股价怎么走——随机（按假设波动）/ 这只股票历史上的真实走法（用过去几年）
const PATH_KEY = "optionpilot.simPathMode";
const YEARS_KEY = "optionpilot.simHistYears";
const HIST_YEARS = [1, 2, 5, 10] as const;
type HistYears = (typeof HIST_YEARS)[number];
const TP_OPTIONS: Record<Side, number[]> = { credit: [0.25, 0.5, 0.75], debit: [0.5, 1, 2] };
const SL_OPTIONS: Record<Side, number[]> = { credit: [0.5, 1, 1.5, 2, 3], debit: [0.25, 0.5, 0.75] };
const CLOSE_FRACS = [0.25, 1 / 3, 0.5];
// 第3组：卖出腿Delta到多少就平仓
const DELTA_EXITS = [0.3, 0.4, 0.5];
// 隐含波动率是最近20天实际波动的1.4倍以上才提醒（平时两者差两三成很常见）。
const IV_HV_WARN = 1.4;

function loadNumber(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}
function loadPathMode(): "random" | "hist" {
  try {
    return localStorage.getItem(PATH_KEY) === "hist" ? "hist" : "random";
  } catch {
    return "random";
  }
}
function loadYears(): HistYears {
  const v = loadNumber(YEARS_KEY, 2);
  return (HIST_YEARS as readonly number[]).includes(v) ? (v as HistYears) : 2;
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
  bands: Band[]; // 平面图的股价范围带（到这一批为止的全部走势）
  done: Extract<FutureResponse, { type: "done" }> | null;
  curve: Extract<FutureResponse, { type: "curve" }> | null;
  alt: RuleSuggestion | null | undefined; // undefined=还没算完
  earn: SimStats | null; // 加了财报跳空时，"不加跳空"那一组的结果
  error: string | null;
  key: string; // 这批结果是哪组输入算的（runKey）；输入变了、新的还没开始算时，不拿旧结果当新的说
}
const EMPTY_RUN: MainRun = { key: "", batches: [], holding: null, after: null, exits: [], samples: [], bands: [], done: null, curve: null, alt: undefined, earn: null, error: null };

const fmtYmd = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

function niceStep(span: number, target: number) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

export default function FutureSim({ symbol, legs, spot, dV, scenario, fork: forkProp, marketIv: marketIvProp, ivSource, skew = 0, halfSpread, earnings = null, leftAdvice = null, emptyText }: Props) {
  const { t, lang } = useI18n();
  const { rules: rulesBySide, volOverride, driftPct, ivSkewOn, earnJumpOn } = useSimSettings(symbol);
  // 悬停说明（InfoTip）：标题/说明/例子都在 tip.<id>.t/b/e
  const tip = (id: string) => ({ title: t(`tip.${id}.t`), body: t(`tip.${id}.b`), example: t(`tip.${id}.e`) });
  const effSkew = ivSkewOn ? skew : 0;
  const hsKey = (halfSpread ?? []).map((h) => (h == null ? "-" : h.toFixed(3))).join(",");
  const setVolOverride = (v: number | null) => setVolOverrideFor(symbol, v);
  const setDriftPct = (v: number) => setDriftPctFor(symbol, v);
  const [lossLimit, setLossLimit] = useState<number>(() => loadNumber(LIMIT_KEY, 1000));
  const [view, setView] = useState<"plane" | "3d">(loadView);
  const [hv, setHv] = useState<{ status: "loading" | "ok" | "error"; hv20?: number }>({ status: "loading" });
  const [rawRun, setRun] = useState<MainRun>(EMPTY_RUN);
  const [forkRun, setForkRun] = useState<{ key: string; stats: SimStats; holding: Float32Array; samples: Sample[] } | null>(null);
  const [runNonce, setRunNonce] = useState(0);
  // 看哪一种典型结局：按种类记（重新推演后每种结局的顺序、有没有都可能变，按位置记会换成别的结局）
  const [storyKind, setStoryKind] = useState<string | null>(null);
  const [pathHelp, setPathHelp] = useState(false); // "两种走法有什么区别"对照表展开
  const [ruleSort, setRuleSort] = useState<"trade" | "per30">("per30"); // 第3组：规则对比表按什么排
  const [pathMode, setPathMode] = useState<"random" | "hist">(loadPathMode);
  const [histYears, setHistYears] = useState<HistYears>(loadYears);
  const [histSeries, setHistSeries] = useState<{ key: string; status: "loading" | "ok" | "error"; series?: { closes: number[]; timestamps: number[] } }>({ key: "", status: "loading" });
  const workerRef = useRef<Worker | null>(null);
  const forkWorkerRef = useRef<Worker | null>(null);
  const queueRef = useRef<FutureResponse[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(LIMIT_KEY, String(lossLimit));
      localStorage.setItem(VIEW_KEY, view);
      localStorage.setItem(PATH_KEY, pathMode);
      localStorage.setItem(YEARS_KEY, String(histYears));
    } catch {
      /* 浏览器禁止存储时只是不记住 */
    }
  }, [lossLimit, view, pathMode, histYears]);

  // 历史真实走法：按选的年数拉日线（historical-prices的5y/10y要重新部署函数才有；没部署时会拿到较短的数据，界面照实说拿到了多久）
  const histKey = pathMode === "hist" && symbol ? `${symbol}|${histYears}` : "";
  useEffect(() => {
    if (!histKey) return;
    let alive = true;
    setHistSeries({ key: histKey, status: "loading" });
    fetchHistoricalSeries(symbol, `${histYears}y` as HistoryRange)
      .then((s) => alive && setHistSeries({ key: histKey, status: s.timestamps.length === s.closes.length && s.closes.length > 10 ? "ok" : "error", series: s }))
      .catch(() => alive && setHistSeries({ key: histKey, status: "error" }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histKey]);

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
      ...(r.deltaExit != null ? [t("future.deltaRuleShort", { d: r.deltaExit.toFixed(2) })] : []),
      r.closeFrac > 0 ? t("winRate.closeOptFrac", { f: fracLabel(r.closeFrac), d: Math.max(1, Math.round(totalTerm * r.closeFrac)) }) : t("winRate.holdToExpiry"),
    ].join(" · ");
  const totalTerm = useMemo(() => {
    const d = legs.filter((l) => l.kind !== "stock").map((l) => l.dte);
    return d.length ? Math.max(1, Math.round(Math.min(...d))) : 0;
  }, [legs]);
  const hasStock = legs.some((l) => l.kind === "stock");
  const stance = useMemo(() => (basis != null ? priceStance(legs, spot, basis) : "neutral"), [legs, spot, basis]);
  const ivCenter = marketIvProp > 0.01 ? marketIvProp : comboBaseIv(legs, spot) ?? 0.3;
  const vol = volOverride != null ? volOverride / 100 : hv.status === "ok" && hv.hv20 ? hv.hv20 : ivCenter;
  const volReady = volOverride != null || hv.status !== "loading";
  const drift = credit ? 0 : driftPct / 100;

  const setup = useMemo(
    () => (basis == null || hasStock ? null : { legs, spot, basis, pnlOffset: 0, rules, totalTerm, drift, dV, skew: effSkew, halfSpread: halfSpread && halfSpread.length === legs.length ? halfSpread : undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [basis, hasStock, legs, spot, rules, totalTerm, drift, dV, effSkew, hsKey],
  );
  const preparedBase = useMemo(() => (setup ? prepareSim(setup) : null), [setup]);
  const days = preparedBase?.horizon ?? 1;
  const histPaths = useMemo(
    () => (histKey && histSeries.key === histKey && histSeries.status === "ok" && histSeries.series ? buildHistPaths(histSeries.series, days) : null),
    [histKey, histSeries, days],
  );
  // 真正用历史走法：选了、拉到了、段数够（太少的话统计没意义，退回随机并说明）
  const histWaiting = pathMode === "hist" && !!symbol && (histSeries.key !== histKey || histSeries.status === "loading");
  const histActive = pathMode === "hist" && !!histPaths && histPaths.count >= MIN_HIST_PATHS;
  const histProblem: "short" | "error" | null =
    pathMode !== "hist" || histWaiting || histActive ? null : histSeries.status === "error" || !histPaths ? "error" : "short";
  const histInput = useMemo(
    () => (histActive && histPaths ? { ratios: histPaths.ratios, days: histPaths.days, count: histPaths.count, starts: histPaths.starts, vols: histPaths.vols, to: histPaths.to } : undefined),
    [histActive, histPaths],
  );
  // 财报这一组：财报落在推演期间里（第1天～最早到期日）时，打开开关就在那天加一次跳空（只在随机走法里加：历史真实走势本来就有过去的财报跳空）
  const earnDay = earningsDayFrom(earnings, 0, days);
  // 跳空不超过市场预期波动在这段时间里装得下的（跟引擎、"市场押"同一个下限，见winRateSim.capJump）
  const earnJump = earnDay != null && earnings?.jump != null && earnings.jump > 0 ? capJump(earnings.jump, ivCenter, days) : null;
  const useJump = earnJumpOn && earnJump != null && !histActive && !histWaiting;
  // 按隐含波动率推演时（没有手填、拿不到最近20天的实际波动），隐含波动率里已经含着这次财报，加跳空要先扣掉，不然算两遍
  const volFromIv = volOverride == null && !(hv.status === "ok" && hv.hv20);
  const runVol = useJump && volFromIv ? exEarningsVol(vol, earnJump!, days) : vol;
  const runSetup = useMemo(() => (setup && useJump ? { ...setup, earnings: { day: earnDay!, jump: earnJump! } } : setup), [setup, useJump, earnDay, earnJump]);
  const prepared = useMemo(() => (runSetup ? prepareSim(runSetup) : null), [runSetup]);
  // 加了财报跳空时，情景点的腿位和盈亏按财报前后隐含波动率的变化重算（盈亏图/滑块不含这个变化，见winRateSim.earningsShift）
  const fork = useMemo(() => {
    if (!forkProp || !useJump || !prepared) return forkProp;
    const sh = earningsShift(prepared, forkProp.day, forkProp.spot, forkProp.legs);
    return sh ? { ...forkProp, legs: sh.legs, pnl: forkProp.pnl + sh.dPnl } : forkProp;
  }, [forkProp, useJump, prepared]);
  // 加了跳空时，"市场报价"里含着这次财报：跟实际波动比、画波动率曲线时用扣掉财报以后的
  const ivCmp = useJump ? exEarningsVol(ivCenter, earnJump!, days) : ivCenter;
  const histAvgVol = useMemo(() => (histPaths && histPaths.vols.length ? histPaths.vols.reduce((a, b) => a + b, 0) / histPaths.vols.length : null), [histPaths]);
  // 图的股价范围（也是后台推演的网格）：情景点在范围里时不管它——拖滑块只是换个点画，不该让一万次推演从头再算；
  // 拖到范围外才放宽，而且按现价5%一档放宽，档内再拖也不重算
  const baseModel = useMemo(
    () => (setup ? buildMapModel(legs, spot, dV, { baseIv: ivCenter }, 120, ROWS) : null),
    [setup, legs, spot, dV, ivCenter],
  );
  const scenStep = spot * 0.05;
  const scenExt = !baseModel || !scenario || (scenario.price >= baseModel.sMin && scenario.price <= baseModel.sMax)
    ? null
    : scenario.price < baseModel.sMin ? Math.max(0.01, Math.floor(scenario.price / scenStep) * scenStep) : Math.ceil(scenario.price / scenStep) * scenStep;
  const model = useMemo(
    () => (scenExt == null || !setup ? baseModel : buildMapModel(legs, spot, dV, { extraPrices: [scenExt], baseIv: ivCenter }, 120, ROWS)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseModel, scenExt],
  );
  const grid: GridSpec | null = useMemo(() => (model ? { sMin: model.sMin, sMax: model.sMax, rows: ROWS, days } : null), [model, days]);
  // 到期时最多赚/亏多少：用来判断止盈止损线碰不碰得到。
  const scan = useMemo(() => (prepared ? expiryScan(prepared, spot) : null), [prepared, spot]);
  // 开仓时卖出腿里最大的Delta：Delta平仓线比它还低就等于开仓就该平
  const startShortDelta = useMemo(() => (prepared ? maxShortDelta(prepared, 0, spot) : 0), [prepared, spot]);

  const runKey = useMemo(() => {
    if (!runSetup || !grid) return "";
    const lk = runSetup.legs.map((l) => [l.action, l.type, l.strike, l.dte, l.premium, l.qty ?? 1].join(":")).join("|");
    return [lk, spot.toFixed(3), JSON.stringify(rules), runVol.toFixed(4), ivCenter.toFixed(4), drift, dV, totalTerm, grid.sMin.toFixed(3), grid.sMax.toFixed(3), runNonce,
      histInput ? `hist:${histKey}:${histInput.count}` : histWaiting ? "histWait" : "random", effSkew.toFixed(3), hsKey, useJump ? `earn:${earnDay}:${earnJump!.toFixed(4)}` : "noEarn"].join("#");
  }, [runSetup, grid, spot, rules, runVol, ivCenter, drift, dV, totalTerm, runNonce, histInput, histKey, histWaiting, effSkew, hsKey, useJump, earnDay, earnJump]);

  const run = rawRun.key === runKey ? rawRun : EMPTY_RUN;

  // 主推演：输入变了（防抖400ms）就换一个后台线程从头算。
  useEffect(() => {
    if (!runSetup || !prepared || !grid || !volReady || emptyText || histWaiting) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      workerRef.current?.terminate();
      const w = new Worker(new URL("../lib/futureSim.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = w;
      queueRef.current = [];
      setRun({ ...EMPTY_RUN, key: runKey });
      const runId = Date.now();
      w.onmessage = (e: MessageEvent<FutureResponse>) => {
        if (!cancelled && e.data.runId === runId) queueRef.current.push(e.data);
      };
      // 线程本身起不来/崩了（不是推演里抛的错）也要说出错了，不然界面一直等着
      w.onerror = (ev) => {
        if (!cancelled) queueRef.current.push({ runId, type: "error", message: ev.message || "worker" });
      };
      const req: FutureRequest = {
        kind: "main", runId, setup: runSetup, vol: runVol, ivCenter: Math.max(0.05, ivCmp + dV / 100), batches: BATCHES, perBatch: PER_BATCH, samples: SAMPLES,
        seed: Math.floor(Math.random() * 1e9), grid, debit: !credit, hist: histInput, noEarnVol: useJump ? vol : undefined,
      };
      w.postMessage(req);
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, volReady, emptyText, histWaiting]);

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
    if (!fork || scenState?.kind !== "ok" || !grid || basis == null || !(scenario && (scenario.day >= 1 || Math.abs(scenario.price / spot - 1) >= 0.01))) return "";
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
        kind: "fork", runId, vol: runVol, startDay: Math.round(fork.day), samples: 30, grid, hist: histInput,
        setup: {
          legs: fork.legs, spot: fork.spot, basis, pnlOffset: fork.pnl, rules, totalTerm, drift, skew: effSkew, halfSpread: halfSpread && halfSpread.length === fork.legs.length ? halfSpread : undefined,
          // 从情景那天出发：财报还在后面才加（天数从情景那天算）
          earnings: useJump && earnDay! > Math.round(fork.day) ? { day: earnDay! - Math.round(fork.day), jump: earnJump! } : null,
        },
      };
      w.postMessage(req);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      forkWorkerRef.current?.terminate();
      forkWorkerRef.current = null;
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
        setRun((r) => ({ ...r, batches: [...r.batches, head.stats], holding: head.holding, after: head.after, exits: [...r.exits, ...head.exits], samples: head.samples.length ? head.samples : r.samples, bands: head.bands }));
        return;
      }
      while (q.length && q[0].type !== "batch") {
        const m = q.shift()!;
        setRun((r) => (m.type === "done" ? { ...r, done: m } : m.type === "earn" ? { ...r, earn: m.without } : m.type === "alt" ? { ...r, alt: m.suggestion } : m.type === "curve" ? { ...r, curve: m } : m.type === "error" ? { ...r, error: m.message } : r));
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
  // 走势条数：随机=10批×1000；历史走法=真实切出来的段数（"1万次"的说法在历史走法下都指这些段）
  const totalN = run.done?.stats.n ?? (histInput ? histInput.count : BATCHES * PER_BATCH);
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
      {credit && (
        <label className="flex items-center gap-1" title={t("future.deltaRuleHint")}>
          {t("future.deltaRuleLabel")}
          <select className={sel} value={String(rules.deltaExit ?? "null")} onChange={(e) => setRules({ ...rules, deltaExit: e.target.value === "null" ? null : Number(e.target.value) })}>
            <option value="null">{t("winRate.none")}</option>
            {DELTA_EXITS.map((d) => <option key={d} value={String(d)}>{d.toFixed(2)}{d <= startShortDelta + 0.02 ? t("future.deltaAlreadyOpt") : ""}</option>)}
          </select>
        </label>
      )}
      <label className={`flex items-center gap-1 ${skew > 0 ? "" : "opacity-40"}`} title={skew > 0 ? t("future.skewHint", { k: (skew * 10).toFixed(1) }) : t("future.skewNone")}>
        <input type="checkbox" className="accent-sky-500" checked={ivSkewOn && skew > 0} disabled={!(skew > 0)} onChange={(e) => setIvSkewOn(e.target.checked)} />
        {t("future.skewLabel")}
      </label>
      {earnDay != null && (
        <label
          className={`flex items-center gap-1 rounded border border-amber-600/70 px-1.5 py-0.5 text-amber-300 ${earnJump != null && !histActive ? "" : "opacity-50"}`}
          title={histActive ? t("future.earnHistHint") : earnJump == null ? t("future.earnNoMove") : t("future.earnHint")}
        >
          <input type="checkbox" className="accent-amber-500" checked={earnJumpOn && earnJump != null && !histActive} disabled={earnJump == null || histActive} onChange={(e) => setEarnJumpOn(e.target.checked)} />
          {earnings?.move != null
            ? t(earnings.moveSource === "past" ? "future.earnLabelPast" : "future.earnLabel", { m: (earnings.move * 100).toFixed(1) })
            : t("future.earnLabelNoMove")}
        </label>
      )}
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
        <InfoTip {...tip("path")}>{t("future.pathLabel")}</InfoTip>
        <button type="button" onClick={() => setPathHelp((v) => !v)} className="text-[10.5px] text-sky-400 underline-offset-2 hover:underline">
          {t(pathHelp ? "future.pathCmpClose" : "future.pathCmpOpen")}
        </button>
        <span className="flex overflow-hidden rounded border border-slate-600">
          {(["random", "hist"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setPathMode(m)}
              className={`px-2 py-0.5 text-[11px] font-semibold ${pathMode === m ? "bg-sky-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
            >
              {t(m === "random" ? "future.pathRandom" : "future.pathHist")}
            </button>
          ))}
        </span>
        {pathMode === "hist" && (
          <>
            <span className="ml-1">{t("future.histYearsLabel")}</span>
            {HIST_YEARS.map((y) => (
              <button
                key={y}
                onClick={() => setHistYears(y)}
                className={`rounded border px-1.5 py-0.5 text-[10px] ${histYears === y ? "border-sky-500 text-sky-300" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}
              >
                {t("future.histYearsOpt", { y })}
              </button>
            ))}
            {histWaiting && <span className="text-slate-500">{t("future.histLoading")}</span>}
            {histProblem && <span className="text-amber-300">{t(histProblem === "short" ? "future.histTooShort" : "future.histError", { n: histPaths?.count ?? 0 })}</span>}
          </>
        )}
      </span>
      <span className={`flex flex-wrap items-center gap-1 ${histActive ? "opacity-40" : ""}`} title={histActive ? t("future.volUnusedHist") : undefined}>
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
        {chip(t(ivSource === "atm" ? "winRate.volIvAtm" : "winRate.volIv", { v: (ivCenter * 100).toFixed(1) }), ivCenter, "iv")}
      </span>
      {/* 历史走法每次都是同一批真实走势，"换一组"没有意义 */}
      {!histActive && (
        <button onClick={() => setRunNonce((n) => n + 1)} className="ml-auto rounded border border-slate-600 px-2 py-0.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-800">
          {t("future.reroll")}
        </button>
      )}
    </div>
  );

  // ── 平面视图：赚/亏两区做底色，上面是全部走势的股价范围带、几种典型结局、上方每天下车多少、右侧全拿到期停在哪 ──
  const STORY_COLOR: Record<Story["kind"], string> = { tp: "#34d399", sl: "#f43f5e", delta: "#a78bfa", time: "#fbbf24", win: "#fde68a", loss: "#fb7185" };
  const shareText = (v: number) => (v > 0 && v < 1 ? t("future.shareLt1") : t("future.shareAbout", { p: Math.round(v) }));
  const stories = run.done?.stories ?? [];
  const storyIdx = Math.max(0, stories.findIndex((x) => x.kind === storyKind));
  const drawPlane = (g: CanvasRenderingContext2D, W: number, H: number) => {
    const ed = run.done?.exitDays;
    const M = { l: PLANE_ML, r: PLANE_MR, t: ed ? 66 : 22, b: 34 };
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const X = (d: number) => M.l + (d / days) * pw;
    const Y = (s: number) => M.t + ((model.sMax - s) / (model.sMax - model.sMin)) * ph;
    const f: PlaneFrame = { X, Y, left: M.l, top: M.t, width: pw, height: ph };
    g.save();
    g.beginPath();
    g.rect(M.l, M.t, pw, ph);
    g.clip();
    drawZones(g, model, days, f);
    drawBands(g, run.bands, f);
    // 情景点往后：蓝色的分叉云（还拿着的走势密度）
    if (forkShown) {
      const cellW = pw / days, cellH = ph / ROWS;
      for (let d = 0; d <= days; d++) {
        let mx = 0;
        for (let r = 0; r < ROWS; r++) mx = Math.max(mx, forkShown.holding[d * ROWS + r]);
        if (mx <= 0) continue;
        for (let r = 0; r < ROWS; r++) {
          const v = forkShown.holding[d * ROWS + r];
          if (v <= 0) continue;
          g.fillStyle = `rgba(56,189,248,${(0.75 * Math.sqrt(v / mx)).toFixed(3)})`;
          g.fillRect(M.l + (d - 0.5) * cellW, M.t + r * cellH, cellW + 0.6, cellH + 0.6);
        }
      }
    }
    // 典型结局：下车前实线，下车后接着画成淡色虚线（已经不算数，只是看股价后来去了哪）。
    // 选中的那条（上方按钮，跟下面"你的钱会怎么变"、立体图是同一条）画粗、贴说明，其余的淡淡画一下；选中的最后画，压在最上面。
    const selIdx = storyIdx;
    const order = stories.map((_, i) => i).filter((i) => i !== selIdx).concat(stories.length ? [selIdx] : []);
    for (const si of order) {
      const st = stories[si];
      const sel = si === selIdx;
      const c = STORY_COLOR[st.kind];
      g.globalAlpha = sel ? 1 : 0.3;
      g.strokeStyle = c;
      g.lineWidth = sel ? 2.4 : 1.2;
      g.beginPath();
      st.prices.slice(0, st.day + 1).forEach((v, d) => (d ? g.lineTo(X(d), Y(v)) : g.moveTo(X(d), Y(v))));
      g.stroke();
      if (st.day < days) {
        g.globalAlpha = sel ? 0.5 : 0.15;
        g.setLineDash([3, 4]);
        g.beginPath();
        st.prices.slice(st.day).forEach((v, i) => (i ? g.lineTo(X(st.day + i), Y(v)) : g.moveTo(X(st.day), Y(v))));
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = sel ? 1 : 0.3;
        g.fillStyle = c;
        g.beginPath();
        g.arc(X(st.day), Y(st.prices[st.day]), sel ? 4.5 : 3, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      g.lineWidth = 1;
    }
    g.restore();
    // 行权价、平仓日
    g.font = "10px sans-serif";
    for (const k of model.strikes) {
      if (k < model.sMin || k > model.sMax) continue;
      g.strokeStyle = "rgba(226,232,240,0.3)";
      g.setLineDash([2, 4]);
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
    // 财报那天：竖线+标签（不管开没开跳空都画，让人知道持仓期间有财报）
    if (earnDay != null && earnings) {
      // 橙色（2026-10-08：黄色留给盈亏平衡线，紫色是Delta下车）
      g.strokeStyle = "rgba(251,146,60,0.9)";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(X(earnDay), M.t);
      g.lineTo(X(earnDay), M.t + ph);
      g.stroke();
      g.lineWidth = 1;
      g.font = "bold 10px sans-serif";
      g.fillStyle = "#fb923c";
      g.textAlign = earnDay > days * 0.75 ? "right" : "left";
      g.fillText(t("future.earnTag", { date: earnings.next.slice(5).replace("-", "/"), d: earnDay }), X(earnDay) + (earnDay > days * 0.75 ? -4 : 4), M.t + 12);
    }
    labelBands(g, run.bands, f, { mid: t("future.bandMid"), dark: t("future.bandDark"), light: t("future.bandLight") });
    // 纵轴刻度
    const step = niceStep(model.sMax - model.sMin, 6);
    g.fillStyle = "#94a3b8";
    g.textAlign = "right";
    g.font = "10px sans-serif";
    for (let v = Math.ceil(model.sMin / step) * step; v <= model.sMax; v += step) g.fillText(String(Math.round(v * 100) / 100), M.l - 4, Y(v) + 3);
    // 上方：每天按规则下车多少（止盈绿、止损红、到时间平仓黄），加几个累计数
    if (ed && run.done) {
      const n = run.done.stats.n || 1;
      const top = 4, hh = 24;
      const tot = ed.tp.map((v, d) => v + ed.sl[d] + ed.delta[d] + ed.time[d]);
      const mx = Math.max(1, ...tot);
      const bw = Math.max(1, pw / days - 1);
      // 跟"看哪一种结局"联动：选中的那种颜色亮，其它淡（选的是拿到期的结局时，全部淡一些——拿到期的不在这些柱子里）
      const selKind = stories.length ? stories[storyIdx].kind : null;
      for (let d = 1; d <= days && d < tot.length; d++) {
        let y = top + 32 + hh;
        for (const [k, col] of [["tp", "rgba(52,211,153,0.85)"], ["sl", "rgba(244,63,94,0.9)"], ["delta", "rgba(167,139,250,0.9)"], ["time", "rgba(251,191,36,0.85)"]] as const) {
          const hgt = (ed[k][d] / mx) * hh;
          if (hgt <= 0) continue;
          g.globalAlpha = selKind == null || selKind === k ? 1 : selKind === "win" || selKind === "loss" ? 0.45 : 0.2;
          g.fillStyle = col;
          g.fillRect(X(d) - bw / 2, y - hgt, bw, hgt);
          y -= hgt;
        }
      }
      g.globalAlpha = 1;
      g.font = "10px sans-serif";
      g.fillStyle = "#94a3b8";
      g.textAlign = "left";
      // 左边让出位置给图上的"小柱子是什么ⓘ"（HTML叠在画布上）
      g.fillText(t("future.exitBarTitle"), M.l + 92, top + 9);
      let cum = 0;
      const marks = [Math.max(1, Math.round(days * 0.15)), Math.round(days * 0.5), days];
      for (let d = 0; d <= days && d < tot.length; d++) {
        cum += tot[d];
        if (marks.includes(d)) {
          g.fillStyle = "#6ee7b7";
          g.textAlign = d === days ? "right" : "center";
          g.fillText(t("future.exitCum", { d, p: Math.round((cum / n) * 100) }), d === days ? M.l + pw : X(d), top + 22);
        }
      }
    }
    // 右侧：不管规则、全部拿到期时停在哪（按到期那天那个价位是赚是亏上色）
    const endPrices = run.done?.endPrices;
    if (endPrices && run.done) {
      const BIN = 40, cnt = new Array(BIN).fill(0);
      for (const v of endPrices) if (v >= model.sMin && v <= model.sMax) cnt[Math.min(BIN - 1, Math.floor(((model.sMax - v) / (model.sMax - model.sMin)) * BIN))]++;
      const mx = Math.max(1, ...cnt), x0 = M.l + pw + 6, bh = ph / BIN;
      cnt.forEach((c, i) => {
        if (!c) return;
        const mid = model.sMax - ((i + 0.5) / BIN) * (model.sMax - model.sMin);
        g.fillStyle = model.pnlAt(days, mid) >= 0 ? "rgba(52,211,153,0.8)" : "rgba(251,113,133,0.85)";
        g.fillRect(x0, M.t + i * bh + 0.5, (c / mx) * (M.r - 30), Math.max(1, bh - 1));
      });
      g.font = "10px sans-serif";
      g.fillStyle = "#94a3b8";
      g.textAlign = "left";
      const win = run.done.hold.winPct;
      // 上面：一直拿到期赚的比例 vs 按条件赚的比例（规则帮了还是拖了）
      const ruleWin = run.done.stats.winPct;
      const dw = Math.round(ruleWin) - Math.round(win);
      // 右边距窄，英文放不下时往左挪，不出画布
      const fit = (txt: string, x: number) => Math.max(M.l + pw - 40, Math.min(x, W - 2 - g.measureText(txt).width));
      const put = (txt: string, y: number) => g.fillText(txt, fit(txt, x0), y);
      put(t("future.endAllTitle"), M.t - (ed ? 30 : 4));
      if (ed) {
        g.font = "bold 10px sans-serif";
        g.fillStyle = "#6ee7b7";
        put(t("future.endAllWin", { p: Math.round(win) }), M.t - 17);
        g.fillStyle = "#fbbf24";
        put(`${t("future.endRule", { p: Math.round(ruleWin) })}${dw !== 0 ? t("future.endRuleDiff", { d: `${dw > 0 ? "+" : "−"}${Math.abs(dw)}` }) : ""}`, M.t - 4);
      }
      g.font = "bold 10px sans-serif";
      g.fillStyle = "#6ee7b7";
      put(t("future.endAllWin", { p: Math.round(win) }), M.t + ph + 12);
      g.fillStyle = "#fda4af";
      put(t("future.endAllLoss", { p: Math.round(100 - win) }), M.t + ph + 24);
      // 选中那条走势到期停在哪：三角
      const sel = stories.length ? stories[storyIdx] : null;
      const endP = sel ? sel.prices[sel.prices.length - 1] : null;
      if (endP != null && endP >= model.sMin && endP <= model.sMax) {
        const yy = Y(endP);
        g.fillStyle = STORY_COLOR[sel!.kind];
        g.beginPath();
        g.moveTo(x0 - 1, yy);
        g.lineTo(x0 - 7, yy - 5);
        g.lineTo(x0 - 7, yy + 5);
        g.closePath();
        g.fill();
        g.font = "9px sans-serif";
        g.fillStyle = "#e2e8f0";
        // 贴近顶上时写在三角下面，不跟上面"按条件赚X%"那几行叠在一起
        const pickTxt = t("future.endPick");
        g.fillText(pickTxt, fit(pickTxt, x0 + 2), yy - 7 < M.t + 9 ? yy + 15 : yy - 7);
      }
    }
    // 典型结局的故事：只给选中的那条贴说明（贴在下车或到期的那一点）
    const placed: Placed[] = [];
    stories.forEach((st, i) => {
      if (i !== storyIdx) return;
      const c = STORY_COLOR[st.kind];
      const v = st.prices[Math.min(st.day, st.prices.length - 1)];
      const anchor = { x: X(st.day), y: Y(Math.min(model.sMax, Math.max(model.sMin, v))) };
      tagBox(
        g, anchor,
        [
          { text: `${i === 0 && st.share >= Math.max(...stories.map((x) => x.share)) ? t("future.storyFirst") : ""}${t(`future.story_${st.kind}`)}${shareText(st.share)}`, color: c, bold: true },
          { text: t(`future.story_${st.kind}D`, { d: st.day, v: `${st.pnl >= 0 ? "+" : "−"}$${Math.abs(st.pnl).toFixed(2)}` }), color: "#e2e8f0" },
          // 历史真实走法：这条是哪一段真实走势
          ...(st.start != null ? [{ text: t("future.storyFrom", { date: fmtYmd(st.start), d: days }), color: "#94a3b8" }] : []),
        ],
        c, placed, { left: M.l + 2, right: M.l + pw - 2, top: M.t + 2, bottom: M.t + ph - 2 }, st.day >= days * 0.6,
      );
    });
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
      tagBox(g, { x: sx, y: sy }, [{ text: t("winRate.scenMark", { d: Math.round(scen.day), s: scen.price.toFixed(2) }), color: "#7dd3fc", bold: true }], "#38bdf8", placed,
        { left: M.l + 2, right: M.l + pw - 2, top: M.t + 2, bottom: M.t + ph - 2 });
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
  };

  const notes3d = {
    top: (r: string, v: string) => t("future.noteTopEnd", { r, v }),
    bottom: (r: string, v: string) => t("future.noteBottomEnd", { r, v }),
    breakeven: t("future.noteBe"),
    above: (a: string) => t("future.noteAbove", { a }),
    below: (b: string) => t("future.noteBelow", { b }),
    between: (a: string, b: string) => t("future.noteBetween", { a, b }),
    outside: (a: string, b: string) => t("future.noteOutside", { a, b }),
  };
  const labels3d = {
    open: t("future.axOpen"),
    expiry: t("future.axExpiry", { d: days }),
    close: t("future.axClose"),
    price: t("som.axisPrice"),
    pnl: t("future.axPnl"),
    hint: t("future.hint3d"),
    intro: t("future.intro3d"),
    time: `${t("winRate.axisTimeOpen")} →`,
    floor: t("future.floorTag"),
    curtain: t("future.curtainTag"),
    zero: t("future.zeroTag"),
    band: t("future.bandTag3d", { n: totalN.toLocaleString() }),
    dayTick: (d: number) => t("future.dayTick", { d }),
    scen: (d: number, price: string, v: string) => t("future.scenTag3d", { d, p: price, v }),
  };
  const story3d = stories.length ? stories[storyIdx] : null;
  const money3d = (v: number) => `${v < -0.005 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
  const path3d = story3d
    ? {
        points: story3d.prices.map((price, d) => ({ day: d, price })),
        exitDay: story3d.day,
        color: STORY_COLOR[story3d.kind],
        label: `${t(`future.story_${story3d.kind}`)}${shareText(story3d.share)} ${story3d.pnl >= 0 ? "+" : ""}${money3d(story3d.pnl)}`,
      }
    : null;

  // ── 结论卡片 ──
  const s = run.done?.stats ?? null;
  const hold = run.done?.hold ?? null;
  const curve = run.curve;
  const be: Breakeven | null = curve?.breakeven ?? null;
  const directional = !credit && curve != null && Math.abs(curve.delta) >= 0.3;
  // 假设波动从哪来：手填的 / 最近20天历史 / 取不到历史时暂按隐含波动率——说法必须跟真实来源一致。
  // 历史走法时，"实际波动"是那些真实走势自己的平均波动
  const volSrc: "assumed" | "recent" | "iv" | "hist" = histActive && histAvgVol ? "hist" : volOverride != null ? "assumed" : hv.status === "ok" && hv.hv20 ? "recent" : "iv";
  const srcLabel = volSrc === "hist" ? t("future.srcHist", { y: histYears }) : t(volSrc === "assumed" ? "future.srcAssumed" : volSrc === "recent" ? "future.srcRecent" : "future.srcIv");
  const srcBar = volSrc === "hist" ? t("future.barHist") : t(volSrc === "assumed" ? "future.barAssumed" : volSrc === "recent" ? "future.barRecent" : "future.barIv");
  const effVol = volSrc === "hist" ? histAvgVol! : vol;
  const marketIv = Math.max(0.01, ivCenter + dV / 100);
  type Verdict = "good" | "slight" | "flat" | "bad";
  // 判断直接看1万次的结果：平均盈亏要明显离开0（超过随机误差的2倍，且至少是基准的3%）才算有优势/吃亏。
  // 不用"盈亏平衡波动率"下结论：带止盈止损时平均盈亏随波动变化很平，平衡点会随每次随机走势大幅跳动（那条曲线留在高级分析里）。
  let verdict: Verdict | null = null;
  // 历史真实走法：相邻两段大部分重叠，不是独立的样本，随机误差要按"不重叠的段数"算，否则太容易下结论
  const effN = (n: number) => (histActive ? Math.max(2, n / Math.max(1, (days * 252) / 365)) : n);
  if (s) {
    const noise = Math.max((2 * s.sd) / Math.sqrt(Math.max(1, effN(s.n))), 0.03 * p.basis);
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
    // 加了财报跳空时：跳空单独算了，实际波动要跟扣掉财报以后的市场报价比（不然财报前隐含波动率偏高，会把卖方优势看大）
    const ratio = effVol / ivCmp;
    const cmpKey = ratio < 0.9 ? (credit ? "future.cmpCalmSeller" : "future.cmpCalmBuyer") : ratio > 1.1 ? (credit ? "future.cmpWildSeller" : "future.cmpWildBuyer") : "future.cmpEven";
    const mx = Math.max(openIv, effVol) * 1.1;
    const bar = (label: string, v: number, color: string) => (
      <div className="flex items-center gap-2 text-[10px] text-slate-400">
        <span className="w-24 shrink-0">{label}</span>
        <span className="h-2 rounded-sm" style={{ width: `${(v / mx) * 160}px`, background: color }} />
        <span className="tabular-nums text-slate-200">{(v * 100).toFixed(1)}%</span>
      </div>
    );
    why = (
      <>
        {t(ivSource === "atm" ? "future.whyVolAtm" : "future.whyVol", { iv: (openIv * 100).toFixed(1) })}
        {useJump && ivCmp < openIv - 1e-4 && <>{t("future.whyExEarn", { v: (ivCmp * 100).toFixed(1) })}</>} {srcLabel} {(effVol * 100).toFixed(1)}%{t("future.comma")}{t(cmpKey)}
        {dV !== 0 && <> {t(`future.dv${dV < 0 ? "Crush" : "Spike"}${credit ? "Seller" : "Buyer"}`, { n: Math.abs(dV) })}</>}
        {effSkew > 0 && <> {t(credit ? "future.whySkewSeller" : "future.whySkewBuyer", { k: (effSkew * 10).toFixed(1) })}</>}
        <div className="mt-1 flex flex-col gap-0.5">
          {bar(t("future.barMarket"), openIv, "#a78bfa")}
          {useJump && ivCmp < openIv - 1e-4 && bar(t("future.barExEarn"), ivCmp, "#c4b5fd")}
          {dV !== 0 && bar(t("future.barAfterDv"), marketIv, "#c4b5fd")}
          {bar(srcBar, effVol, "#fbbf24")}
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
    // 历史真实走法：先说清楚这次用的是哪些数据、多少段（相邻两段大部分重叠）
    if (histActive && histPaths) {
      const fmtD = (sec: number) => formatDateInput(sec * 1000); // 按固定格式，不跟浏览器语言走
      const gotYears = (histPaths.to - histPaths.from) / (365 * 86400);
      card.push(
        row("hdata", t("future.histDataLabel"), (
          <>
            {t("future.histData", { s: symbol, from: fmtD(histPaths.from), to: fmtD(histPaths.to), n: histPaths.count.toLocaleString(), d: days })}
            {gotYears < histYears * 0.8 && <span className="text-amber-300"> {t("future.histShortRange", { y: histYears, g: gotYears.toFixed(1) })}</span>}
          </>
        ), "text-sky-100"),
      );
    }
    // 隐含波动率远高于最近实际波动：常见于财报等大事件前，市场在为跳空定价，而这里的随机走势不含跳空。
    if (hv.status === "ok" && hv.hv20 && ivCenter / hv.hv20 >= IV_HV_WARN) {
      card.push(
        row("ivhv", t("future.ivhvLabel"), t(credit ? "future.ivhvSeller" : "future.ivhvBuyer", { iv: (ivCenter * 100).toFixed(1), hv: (hv.hv20 * 100).toFixed(1), k: (ivCenter / hv.hv20).toFixed(1) }), "text-amber-300"),
      );
    }
    // 财报这一组：持仓期间有财报时，说清楚算没算跳空、算了差多少
    if (earnings) {
      const date = earnings.next.slice(5).replace("-", "/");
      let body: ReactNode;
      if (earnDay == null) body = <span className="text-slate-400">{t(earnings.dayFromOpen <= 0 ? "future.earnPassed" : "future.earnNone", { date })}</span>;
      else if (histActive) body = t("future.earnHistRow", { d: earnDay, date });
      else if (earnJump == null) body = t("future.earnNoMoveRow", { d: earnDay, date });
      else if (!earnJumpOn) body = t("future.earnOffRow", { d: earnDay, date });
      else {
        const w = run.earn;
        body = (
          <>
            {w
              ? t("future.earnOnRow", {
                  d: earnDay, date, a: Math.round(w.winPct), b: Math.round(s.winPct),
                  wa: w.worst5 < 0 ? `−$${Math.abs(w.worst5).toFixed(2)}` : `$${w.worst5.toFixed(2)}`,
                  wb: s.worst5 < 0 ? `−$${Math.abs(s.worst5).toFixed(2)}` : `$${s.worst5.toFixed(2)}`,
                })
              : t("future.earnOnRowPending", { d: earnDay, date })}{" "}
            <span className="text-slate-400">{t(credit ? "future.earnWhySeller" : "future.earnWhyBuyer")}</span>
            {volFromIv && runVol < vol - 1e-4 && <span className="text-slate-400"> {t("future.earnVolNote", { a: (vol * 100).toFixed(1), b: (runVol * 100).toFixed(1) })}</span>}
          </>
        );
      }
      card.push(row("earn", t("future.earnRowLabel"), body, earnDay != null ? "text-amber-100" : ""));
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
            <span>{histActive ? t("future.worstHist", { k: Math.max(1, Math.round(s.n * 0.05)), n: s.n.toLocaleString(), v: usd(s.worst5) }) : t("winRate.worst", { v: usd(s.worst5) })}</span>
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
      card.push(row("worst", t("future.worstLabel"), histActive ? t("future.worstPositiveHist", { k: Math.max(1, Math.round(s.n * 0.05)), v: usd(s.worst5) }) : t("winRate.worstPositive", { v: usd(s.worst5) })));
    }
    // 你的规则：只说打开了的规则；跟同一组走势"一直拿到期"比，看规则在换什么。
    const ruleOn = rules.takeProfitPct != null || rules.stopMult != null || rules.closeFrac > 0 || rules.deltaExit != null;
    const ruleBits: ReactNode[] = [];
    if (!ruleOn) {
      ruleBits.push(t("future.rulesNone"));
    } else {
      const parts: string[] = [];
      if (rules.takeProfitPct != null) parts.push(t("future.partTp", { p: s.byReason.tp.pct.toFixed(0) }));
      if (rules.stopMult != null) parts.push(t("future.partSl", { p: s.byReason.sl.pct.toFixed(0) }));
      if (rules.deltaExit != null) parts.push(t("future.partDelta", { p: s.byReason.delta.pct.toFixed(0), d: rules.deltaExit.toFixed(2) }));
      if (rules.closeFrac > 0) parts.push(t("future.partTime", { p: s.byReason.time.pct.toFixed(0) }));
      if (s.byReason.expiry.pct > 0) parts.push(t("future.partExpiry", { p: s.byReason.expiry.pct.toFixed(0) }));
      ruleBits.push(`${parts.join(t("future.sep"))}${t("future.period")}`);
      if (s.avgCost > 0.0005) ruleBits.push(` ${t("future.rulesCost", { c: usd(s.avgCost) })}`);
      ruleBits.push(
        ` ${t("future.rulesVsHold", {
          h: Math.round(hold.winPct / 10), n: n10, ha: money(hold.avg), a: money(s.avg), hw: money(hold.worst5), w: money(s.worst5),
        })}`,
      );
    }
    const warn: string[] = [];
    if (rules.deltaExit != null && rules.deltaExit <= startShortDelta + 0.02) warn.push(t("future.deltaAlready", { d: rules.deltaExit.toFixed(2), s: startShortDelta.toFixed(2) }));
    if (rules.stopMult != null && scan?.maxLoss != null && slUnreachable(rules.stopMult)) warn.push(t("future.slUnreach", { m: usd(scan.maxLoss), s: usd(p.slLine) }));
    else if (s.byReason.sl.pct > 35) warn.push(t("winRate.ruleSlTight", { p: s.byReason.sl.pct.toFixed(0) }));
    if (rules.takeProfitPct != null && scan?.maxProfit != null && scan.maxProfit < p.tpLine - 1e-9) warn.push(t("future.tpUnreach", { m: usd(scan.maxProfit), s: usd(p.tpLine) }));
    else if (rules.takeProfitPct != null && s.byReason.tp.pct === 0) warn.push(t("winRate.ruleTpUnreachable", { v: usd(p.tpLine) }));
    card.push(
      row("rules", t("future.rulesLabel"), <>{ruleBits}{warn.length > 0 && <div className="text-amber-300">{warn.join(" ")}</div>}</>),
    );
    // 这个胜率稳不稳（历史走法）：同样的规则放到最近1/2/5/10年、最动荡/最平静的几段里各算一遍
    const stab = run.done.stab;
    if (histActive && stab && stab.length > 1) {
      const wins = stab.map((r) => r.win);
      const spread = Math.max(...wins) - Math.min(...wins);
      card.push(
        row("stab", t("future.stabLabel"), (
          <div className="flex flex-col gap-0.5">
            {stab.map((r) => (
              <div key={r.key} className="grid grid-cols-[110px_minmax(0,1fr)_88px] items-center gap-2 text-[10px]">
                <span className="text-slate-400">{t(`future.stab_${r.key}`)}</span>
                <span className="h-2 overflow-hidden rounded bg-slate-800"><span className="block h-2" style={{ width: `${Math.max(0, Math.min(100, r.win))}%`, background: r.win < s.winPct - 10 ? "#f59e0b" : "#10b981" }} /></span>
                <span className="tabular-nums text-slate-200">{t("future.stabWin", { p: r.win.toFixed(0), n: r.n })}</span>
              </div>
            ))}
            <div className={spread >= 15 ? "text-amber-300" : "text-slate-300"}>
              {spread >= 15 ? t("future.stabShaky", { pp: spread.toFixed(0) }) : t("future.stabSteady", { pp: spread.toFixed(0) })}
            </div>
          </div>
        )),
      );
    }
    // 这笔值不值：同一组走势"一直拿到期"平均每笔多少 → 折算成这组期权理论上值多少，跟你实际收/付的比
    {
      const avgHold = hold.avg;
      const fair = credit ? p.basis - avgHold : p.basis + avgHold;
      const src = histActive ? t("future.theoSrcHist", { s: symbol, y: histYears }) : t("future.theoSrcRandom", { v: (vol * 100).toFixed(1) });
      const edgePct = credit ? (fair > 0.005 ? (avgHold / fair) * 100 : null) : p.basis > 0 ? (avgHold / p.basis) * 100 : null;
      const body = t(credit ? "future.theoCredit" : "future.theoDebit", {
        src, a: money(avgHold), f: usd(Math.max(0, fair)), b: usd(p.basis),
        cmp: t(`future.theo${avgHold >= 0 ? "Good" : "Bad"}${credit ? "Credit" : "Debit"}`, { d: usd(avgHold), p: edgePct == null ? "—" : `${avgHold >= 0 ? "+" : "−"}${Math.abs(edgePct).toFixed(0)}` }),
      });
      card.push(row("theo", t("future.theoLabel"), <>{body}{!histActive && <span className="text-slate-500"> {t("future.theoRandomNote")}</span>}</>));
    }
    // 跟只买股票比：同一批走势、同样的天数
    {
      const st = run.done.stock;
      const sAvg = `${st.avg >= 0 ? "+" : "−"}${Math.abs(st.avg * 100).toFixed(1)}%`;
      card.push(
        row("stock", t("future.stockLabel"),
          histActive
            ? t(credit ? "future.stockHistCredit" : "future.stockHistDebit", { d: days, w: st.win.toFixed(0), a: sAvg, mine: s.winPct.toFixed(0) })
            : t("future.stockRandom", { w: st.win.toFixed(0), a: sAvg })),
      );
    }
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
    // 第3组：规则对比表——同一组走势、扣掉成交损耗；可以按"每笔"或"折算每30天"排
    if (alt && alt.rows.length > 1) {
      const sorted = [...alt.rows].sort((a, b) => (ruleSort === "trade" ? b.avg - a.avg : b.per30 - a.per30));
      const top = sorted[0];
      const cur = alt.rows.find((r) => r.current)!;
      const noise = (r: typeof top) => Math.abs(r.diff) < Math.max(2 * r.se, 0.01 * p.basis);
      let verdict: string;
      if (top.avg < 0) verdict = t("future.rtAllLose");
      else if (top.current) verdict = t(ruleSort === "trade" ? "future.rtTopCurrentTrade" : "future.rtTopCurrentPer30");
      else if (ruleSort === "trade" && noise(top)) verdict = t("future.rtNoise", { r: describeRules(top.rules) });
      else {
        verdict = t(ruleSort === "trade" ? "future.rtTopTrade" : "future.rtTopPer30", {
          r: describeRules(top.rules), a: money(top.avg), p30: money(top.per30), d: top.avgDays.toFixed(0), a0: money(cur.avg), p0: money(cur.per30),
        });
        if (top.worst5 < cur.worst5 * 1.1 && cur.worst5 < 0) verdict += t("future.rtWorseTail", { w: money(top.worst5), w0: money(cur.worst5) });
        if (top.avg > 0 && top.avgCost > top.avg * 0.3) verdict += t("future.rtCostEats", { c: money(top.avgCost), k: Math.round((top.avgCost / (top.avg + top.avgCost)) * 100) });
        if (ruleSort === "per30") verdict += t("future.rtPer30Caveat");
      }
      const th = "px-1.5 py-1 text-left font-normal text-slate-500";
      const td = "px-1.5 py-1 tabular-nums";
      card.push(
        row("rtable", t("future.rtLabel"), (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
              <span>{t("future.rtSortBy")}</span>
              <span className="flex overflow-hidden rounded border border-slate-700">
                {(["trade", "per30"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setRuleSort(k)}
                    className={`px-1.5 py-0.5 font-semibold ${ruleSort === k ? "bg-sky-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>
                    {t(k === "trade" ? "future.rtSortTrade" : "future.rtSortPer30")}
                  </button>
                ))}
              </span>
              <span>{t("future.rtNote", { n: alt.rows.length })}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[10.5px]">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className={th}>{t("future.rtRule")}</th>
                    <th className={th}>{t("future.rtWin")}</th>
                    <th className={th}>{t("future.rtDays")}</th>
                    <th className={th}>{t("future.rtCost")}</th>
                    <th className={th}>{t("future.rtAvg")}</th>
                    <th className={th}>{t("future.rtPer30")}</th>
                    <th className={th}>{t("future.rtWorst")}</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr key={i} className={`border-b border-slate-800/60 ${i === 0 ? "bg-sky-950/40" : ""}`}>
                      <td className={`px-1.5 py-1 ${r.current ? "font-semibold text-slate-100" : "text-slate-300"}`}>
                        {r.current && <span className="mr-1 text-sky-300">{t("future.rtCurrent")}</span>}
                        {describeRules(r.rules)}
                      </td>
                      <td className={td}>{r.winPct.toFixed(0)}%</td>
                      <td className={td}>{t("future.rtDaysVal", { d: r.avgDays.toFixed(0) })}</td>
                      <td className={td}>{usd(r.avgCost)}</td>
                      <td className={`${td} ${ruleSort === "trade" ? "font-bold" : ""} ${r.avg >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(r.avg)}</td>
                      <td className={`${td} ${ruleSort === "per30" ? "font-bold" : ""} ${r.per30 >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(r.per30)}</td>
                      <td className={`${td} text-rose-300`}>{money(r.worst5)}</td>
                      <td className="px-1.5 py-1">
                        {!r.current && (
                          <button onClick={() => setRules(r.rules)} className="rounded border border-sky-600 px-1 py-0 text-[10px] text-sky-300 hover:bg-sky-500/20">
                            {t("future.altApply")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-slate-200">{verdict}</div>
            <div className="text-[10px] text-slate-500">{t("future.rtCostNote")}</div>
          </div>
        )),
      );
    }
  }
  // 情景点（不用等主推演算完）
  const scenLines: string[] = [];
  if (scenario && scenState) {
    const d = Math.round(scenario.day);
    if (scenState.kind === "expired") scenLines.push(t("winRate.scenExpired"));
    else {
      if (scenario.day > 0 && Math.abs(scenario.price - spot) > 0.005) {
        const prob = histActive && histPaths ? histProbBeyond(histPaths, scenario.day, scenario.price / spot) : probPriceBeyond(spot, scenario.price, vol, drift, scenario.day);
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
      // 万次推演里，到情景那天为止（含那天，跟下面"钱会怎么变"的累计同一口径）已经按规则下车了多少：情景点说的只是还拿着的那部分
      const ed = run.done?.exitDays;
      if (ed && d > 0) {
        const n = run.done!.stats.n || 1;
        const before = (arr: number[]) => (arr.slice(0, Math.min(arr.length, d + 1)).reduce((a, b) => a + b, 0) / n) * 100;
        const tp = before(ed.tp), sl = before(ed.sl), dl = before(ed.delta), tm = before(ed.time);
        scenLines.push(
          t("future.scenBefore", {
            d, tp: tp.toFixed(0), sl: sl.toFixed(0), time: `${dl >= 0.5 ? t("future.scenBeforeDelta", { p: dl.toFixed(0) }) : ""}${tm >= 0.5 ? t("future.scenBeforeTime", { p: tm.toFixed(0) }) : ""}`, hold: Math.max(0, 100 - tp - sl - dl - tm).toFixed(0),
          }),
        );
      }
      if (scenState.kind === "afterClose") scenLines.push(t("winRate.scenAfterClose", { d: p.endDay }));
      else if (scenState.kind === "hitTp") scenLines.push(t("winRate.scenHitTp", { v: usd(scenState.pnl) }));
      else if (scenState.kind === "hitSl") scenLines.push(t("winRate.scenHitSl", { v: usd(scenState.pnl) }));
      else if (forkKey) {
        scenLines.push(
          forkShown
            ? t(histActive ? "future.scenForkHist" : "future.scenFork", {
                n: forkShown.stats.n.toLocaleString(),
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
  const ivA = ivCenter * 100;
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
    parts.push(sec("sim", t("future.scenSimTitle", { n: totalN.toLocaleString() }), <div className="flex flex-col gap-1 text-sky-100">{scenLines.map((l, i) => <div key={i}>{l}</div>)}</div>));
    scenTop = <div className="flex flex-col gap-2">{parts}</div>;
  }

  // ── 结论框（图上方，2026-10-08 xue：先给结论和接下来怎么做）──
  // 没拖滑块（或拖得很小）：开仓建议，依据就是这张图同一批走势；拖了滑块：情景建议，从那一点接着按条件走 vs 现在平仓。
  const scenActive = !!(scenario && scenState && scenState.kind !== "expired" && (scenario.day >= 1 || Math.abs(scenario.price / spot - 1) >= 0.01));
  let conclBox: ReactNode = null;
  {
    const cell = (key: string, label: string, tipId: string, body: ReactNode, cls = "") => (
      <div key={key} className={`min-w-0 px-3 py-1.5 ${cls}`}>
        <InfoTip {...tip(tipId)}><span className="text-[10.5px] text-slate-400">{label}</span></InfoTip>
        <div className="mt-0.5 text-[11.5px] leading-snug text-slate-100">{body}</div>
      </div>
    );
    const VCLS: Record<string, string> = { good: "text-emerald-300", slight: "text-emerald-200", flat: "text-amber-200", bad: "text-rose-300", hold: "text-emerald-300", close: "text-amber-200", even: "text-slate-200", tp: "text-emerald-300", sl: "text-rose-300", time: "text-amber-200" };
    const BORDER: Record<string, string> = { good: "border-emerald-600", slight: "border-emerald-700", flat: "border-amber-600", bad: "border-rose-600" };
    const box = (tone: string, cells: ReactNode[]) => (
      <div className="concl shrink-0"><div className={`concl-grid overflow-hidden rounded-md border bg-slate-900/70 ${BORDER[tone] ?? "border-slate-700"}`} style={{ ["--concl-cols" as string]: "minmax(110px,0.8fr) 1fr 1fr 1.2fr" }}>{cells}</div></div>
    );
    const sm = run.done?.stats;
    if (!scenActive) {
      // 期限太短：按"剩多少时间平仓"的条件，开仓当天就到了平仓时间——每条走势都在第0天平掉，只亏成交损耗，不能据此说"不值得开"
      if (p.endDay === 0) {
        conclBox = box("flat", [
          cell("v", t("future.concl.open"), "verdict", <span className="block text-[15px] font-bold leading-tight text-amber-200">{t("future.concl.closeDay0")}</span>, "bg-slate-950/40"),
          cell("w", t("future.concl.why"), "why", t("future.concl.closeDay0Why", { h: p.horizon, c: p.closeAtRemaining })),
          cell("n", t("future.concl.next"), "next", t("future.concl.closeDay0Next")),
        ]);
      } else if (!sm || !run.done || !verdict) {
        conclBox = box("", [cell("v", t("future.concl.open"), "verdict", <span className="text-slate-400">{t("future.concl.pending")}</span>)]);
      } else {
        const hd = run.done.hold;
        const fair = credit ? p.basis - hd.avg : p.basis + hd.avg;
        const edgePct = credit ? (fair > 0.005 ? (hd.avg / fair) * 100 : 0) : p.basis > 0 ? (hd.avg / p.basis) * 100 : 0;
        const sl = sm.byReason.sl;
        const alt = run.alt;
        const altBest = alt && alt.best ? alt.best : null;
        conclBox = box(verdict, [
          cell("v", t("future.concl.open"), "verdict", (
            <>
              <span className={`block text-[17px] font-bold leading-tight ${VCLS[verdict]}`}>{t(`future.concl.v_${verdict}`)}</span>
              <span className="text-[10.5px] text-slate-400">{t("future.concl.avg", { v: money(sm.avg) })}</span>
            </>
          ), "bg-slate-950/40"),
          cell("w", t("future.concl.why"), "why", t("future.concl.whyOpen", {
            n: sm.n.toLocaleString(), unit: t(histActive ? "future.concl.unitHist" : "future.concl.unitRand"), w: Math.round(sm.winPct),
            f: usd(Math.max(0, fair)), side: t(credit ? "future.concl.sideCredit" : "future.concl.sideDebit"), b: usd(p.basis),
            cmp: t(`future.concl.cmp${hd.avg >= 0 ? "Good" : "Bad"}${credit ? "Credit" : "Debit"}`, { p: Math.abs(edgePct).toFixed(0) }),
          })),
          cell("r", t("future.concl.risk"), "risk", (
            <>
              {rules.stopMult != null && sl.pct > 0
                ? t("future.concl.riskOpen", { k: sl.pct < 1 ? t("future.concl.lt1") : `${Math.round(sl.pct)}%`, l: usd(sl.avgPnl), w: money(sm.worst5) })
                : t("future.concl.riskNoSl", { w: money(sm.worst5) })}
              {earnDay != null && <> {t("future.concl.riskEarn", { d: earnDay })}</>}
            </>
          )),
          cell("n", t("future.concl.next"), "next", (
            <>
              {t(`future.concl.next_${verdict}`)}
              {altBest && (
                <>
                  {" "}
                  {t("future.concl.alt", {
                    r: describeRules(altBest.rules),
                    d: altBest.why === "avg" ? t("future.concl.altMore", { v: usd(altBest.avg - alt!.current.avg) }) : t("future.concl.altLessRisk", { v: usd(altBest.worst5 - alt!.current.worst5) }),
                  })}{" "}
                  <button onClick={() => setRules(altBest.rules)} className="rounded border border-emerald-500 bg-emerald-600/20 px-1.5 py-0 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-600/40">
                    {t("future.concl.apply")}
                  </button>
                </>
              )}
            </>
          )),
        ]);
      }
    } else if (scenario && scenState) {
      const title = t("future.concl.scen", { d: Math.round(scenario.day), s: scenario.price.toFixed(2) });
      const nowPnl = fork ? fork.pnl : scenState.kind === "hitTp" || scenState.kind === "hitSl" ? scenState.pnl : 0;
      if (scenState.kind === "hitTp" || scenState.kind === "hitSl" || scenState.kind === "afterClose") {
        const k = scenState.kind === "hitTp" ? "tp" : scenState.kind === "hitSl" ? "sl" : "time";
        conclBox = box(k === "sl" ? "bad" : "good", [
          cell("v", title, "verdict", <span className={`block text-[17px] font-bold ${VCLS[k]}`}>{t(`future.concl.s_${k}`)}</span>, "bg-slate-950/40"),
          cell("w", t("future.concl.why"), "why", t("future.concl.whyScenHit", { now: money(nowPnl), line: t(k === "tp" ? "future.concl.lineTp" : k === "sl" ? "future.concl.lineSl" : "future.concl.lineTime") })),
          cell("r", t("future.concl.risk"), "risk", <span className="text-slate-400">—</span>),
          cell("n", t("future.concl.next"), "next", t("future.concl.next_s_hit")),
        ]);
      } else if (forkShown && fork && leftAdvice && Math.abs(leftAdvice.day - fork.day) < 0.01 && Math.abs(leftAdvice.spot - fork.spot) < 0.005 && Math.abs(leftAdvice.dV - dV) < 0.01) {
        // 建议跟左边持仓建议一致；平均钱数（拿着 vs 现在平）只是理由的第一步——期权价格公道时两者几乎总是差不多，
        // 真正决定怎么做的是风险（回本机会、离盈亏平衡点多远、还可能亏多少），这部分用左边同一句理由
        const fs = forkShown.stats;
        const cost = exitCost(p, fork.day, fork.spot);
        const closeNow = fork.pnl - cost;
        const noise = Math.max((2 * fs.sd) / Math.sqrt(Math.max(1, effN(fs.n))), 0.03 * p.basis);
        const k = fs.avg > closeNow + noise ? "hold" : fs.avg < closeNow - noise ? "close" : "even";
        const a = leftAdvice.action;
        const tone = a === "stopLoss" ? "bad" : a === "holdOrStopLoss" ? "flat" : a === "hold" ? "" : "good";
        const ACLS: Record<string, string> = { stopLoss: "text-rose-300", holdOrStopLoss: "text-amber-300", hold: "text-slate-200", holdOrTakeProfit: "text-emerald-200", takeProfit: "text-emerald-300" };
        const unl = (v: number | null) => (v == null ? t("advice.unlimited") : usd(v));
        const nv = { n: fs.n.toLocaleString(), avg: money(fs.avg), close: money(closeNow), c: usd(cost), d: usd(Math.abs(fs.avg - closeNow)), w: Math.round(leftAdvice.pWin * 100), sl: Math.round(leftAdvice.pSl * 100), w5: money(fs.worst5), g: unl(leftAdvice.remainingGain), r: unl(leftAdvice.remainingRisk), why: lang === "en" ? leftAdvice.why.charAt(0).toLowerCase() + leftAdvice.why.slice(1) : leftAdvice.why };
        const stopish = a === "stopLoss" || a === "holdOrStopLoss";
        const conflict = k === "hold" && stopish ? "future.concl.sConflictHold" : k === "close" && (a === "hold" || a === "holdOrTakeProfit") ? "future.concl.sConflictClose" : null;
        conclBox = box(tone, [
          cell("v", title, "verdict", (
            <>
              <span className={`block text-[17px] font-bold ${ACLS[a]}`}>{t(`advice.act.${a}`)}</span>
              <span className="text-[10.5px] text-slate-400">{t("future.concl.sameAsLeft")}</span>
            </>
          ), "bg-slate-950/40"),
          cell("w", t("future.concl.why"), "why", (
            <>
              <span className="block">{t("future.concl.sAvg", nv)} {t(k === "even" ? "future.concl.sAvgEven" : k === "hold" ? "future.concl.sAvgHold" : "future.concl.sAvgClose", nv)}</span>
              <span className="mt-1 block">{t(k === "even" ? "future.concl.sRiskEven" : "future.concl.sRisk", nv)}</span>
            </>
          )),
          cell("r", t("future.concl.risk"), "risk", t("future.concl.sRiskCell", nv)),
          cell("n", t("future.concl.next"), "next", (
            <>
              {t(`future.concl.sNext_${a}`, nv)}
              {conflict && <span className="mt-1 block text-amber-200/90">{t(conflict)}</span>}
            </>
          )),
        ]);
      } else if (forkShown && fork && leftAdvice) {
        // 左边还在按新的情景点算（约四分之一秒），先等它，免得先说一套再改口
        conclBox = box("", [cell("v", title, "verdict", <span className="text-slate-400">{t("future.concl.pending")}</span>)]);
      } else if (forkShown && fork) {
        const fs = forkShown.stats;
        const cost = exitCost(p, fork.day, fork.spot);
        const closeNow = fork.pnl - cost;
        const noise = Math.max((2 * fs.sd) / Math.sqrt(Math.max(1, effN(fs.n))), 0.03 * p.basis);
        const k = fs.avg > closeNow + noise ? "hold" : fs.avg < closeNow - noise ? "close" : "even";
        conclBox = box(k === "close" ? "flat" : k === "hold" ? "good" : "", [
          cell("v", title, "verdict", <span className={`block text-[17px] font-bold ${VCLS[k]}`}>{t(`future.concl.s_${k}`)}</span>, "bg-slate-950/40"),
          cell("w", t("future.concl.why"), "why", t("future.concl.whyScen", { now: money(fork.pnl), c: usd(cost), avg: money(fs.avg), w: Math.round(fs.winPct) })),
          cell("r", t("future.concl.risk"), "risk", t("future.concl.riskScen", { sl: Math.round(fs.byReason.sl.pct), w: money(fs.worst5) })),
          cell("n", t("future.concl.next"), "next", t(`future.concl.next_s_${k}`)),
        ]);
      } else {
        conclBox = box("", [cell("v", title, "verdict", <span className="text-slate-400">{t("future.concl.pending")}</span>)]);
      }
    }
  }

  // 彩色线举个例子：选中的那条是什么（历史真实走法=哪一段真实行情；随机=那一类里排在正中间的一条），为什么有的线很短
  const selStory = stories.length ? stories[storyIdx] : null;
  const storyExample = selStory
    ? t(selStory.start != null ? "future.howPlaneEgHist" : "future.howPlaneEgRand", {
        name: t(`future.story_${selStory.kind}`), date: fmtYmd(selStory.start ?? 0), d: days, s: spot.toFixed(2), e: selStory.day,
        v: `${selStory.pnl >= 0 ? "+" : "−"}$${Math.abs(selStory.pnl).toFixed(2)}`, n: totalN.toLocaleString(),
      })
    : null;
  // "怎么看这张图"：平面图的几条带上这一次推演的真实数字（典型结局占比、全拿到期赚亏），立体图是固定说明
  const howLines =
    view === "3d"
      ? [t("future.how3d1"), t("future.how3d2"), t("future.how3d3"), t("future.how3d4"), t("future.how3d5")]
      : [
          t("future.howPlane1"),
          t("future.howPlane2"),
          stories.length
            ? t("future.howPlane3", { list: stories.map((st) => `${t(`future.story_${st.kind}`)}${shareText(st.share)}`).join(t("future.sep")) })
            : t("future.howPlane3Pending"),
          ...(storyExample ? [storyExample] : []),
          t("future.howPlane4"),
          run.done ? t("future.howPlane5", { w: Math.round(run.done.hold.winPct), l: Math.round(100 - run.done.hold.winPct) }) : t("future.howPlane5Pending"),
          t("future.howPlane6"),
        ];
  const stability = finished && run.done ? batchStability(run.done.first, run.done.stats, p.basis) : null;
  const legend = (
    <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
      <span>
        {revealed === 0
          ? t("future.running")
          : !finished
            ? t("future.batch", { i: revealed, n: BATCHES, per: (histInput ? Math.round(histInput.count / BATCHES) : PER_BATCH).toLocaleString() })
            : t(stability?.similar ? "future.stableYes" : "future.stableNo", { n: totalN.toLocaleString() })}
      </span>
      {view === "3d" ? (
        <>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 rounded" style={{ background: path3d?.color ?? "#fde68a" }} />{t("future.lgPath3d")}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: `${path3d?.color ?? "#fde68a"}55` }} />{t("future.lgCurtain3d")}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 rounded bg-amber-100" />{t("future.lgTop3d")}</span>
        </>
      ) : (
        <>
          <InfoTip {...tip("zones")}><span className="inline-block h-2 w-3 rounded-sm bg-emerald-500/40" />{t("future.lgZoneGain")}<span className="inline-block h-2 w-3 rounded-sm bg-rose-500/50" />{t("future.lgZoneLoss")}</InfoTip>
          <InfoTip {...tip("be")}><span className="inline-block w-4 border-t-2 border-dashed border-amber-400" />{t("future.lgBeY")}</InfoTip>
          <InfoTip {...tip("median")}><span className="inline-block w-4 border-t-2 border-slate-100" />{t("future.lgMedian")}</InfoTip>
          <InfoTip {...tip("bands")}><span className="inline-block h-2 w-3 rounded-sm bg-slate-400/50" />{t("future.lgBands")}</InfoTip>
          <InfoTip {...tip("story")}><span className="inline-block w-4 border-t-2 border-emerald-400" />{t("future.lgStory")}</InfoTip>
          <InfoTip {...tip("after")}><span className="inline-block w-4 border-t-2 border-dotted border-emerald-400" />{t("future.lgAfter")}</InfoTip>
          <InfoTip {...tip("strikes")}><span className="inline-block w-4 border-t border-dotted border-slate-300" />{t("future.lgStrikes")}</InfoTip>
          {earnDay != null && <InfoTip {...tip("earn")}><span className="inline-block h-3 w-0.5 bg-orange-400" />{t("future.lgEarn")}</InfoTip>}
        </>
      )}
      {forkKey && <InfoTip {...tip("scen")}><span className="inline-block h-2 w-3 rounded-sm bg-sky-400/80" />{t("future.lgFork")}</InfoTip>}
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto pr-1 text-[11px] text-slate-300">
      {controls}
      {/* 图的高度跟着窗口走（窗口高度的70%，至少420、最多760像素）：立体图太矮看不清；下面的卡片在右栏里往下滚 */}
      {/* 随机 vs 历史真实走法：对图里每样东西的影响（2026-10-08 xue要的对照表） */}
      {pathHelp && (
        <div className="shrink-0 overflow-x-auto rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2">
          <div className="mb-1 text-[12px] font-bold text-slate-100">{t("future.pathCmpTitle")}</div>
          <table className="w-full min-w-[560px] border-collapse text-[11px]">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="w-[26%] border-b border-slate-700 py-1 pr-2 font-normal">{t("future.pathCmpH0")}</th>
                <th className="border-b border-slate-700 py-1 pr-2 font-normal">{t("future.pathRandom")}</th>
                <th className="border-b border-slate-700 py-1 font-normal">{t("future.pathHist")}</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <tr key={i} className="align-top">
                  <td className="border-b border-slate-800 py-1 pr-2 font-semibold text-slate-200">{t(`future.pathCmp${i}a`)}</td>
                  <td className="border-b border-slate-800 py-1 pr-2 text-slate-300">{t(`future.pathCmp${i}b`)}</td>
                  <td className="border-b border-slate-800 py-1 text-slate-300">{t(`future.pathCmp${i}c`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 text-[11px] text-sky-100">{t("future.pathCmpSum")}</div>
        </div>
      )}
      {conclBox}
      {stories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <InfoTip {...tip("pick")}><span className="text-slate-400">{t("future.pickStory")}</span></InfoTip>
          {stories.map((st, i) => (
            <button
              key={st.kind}
              onClick={() => setStoryKind(st.kind)}
              className={`rounded border px-2 py-0.5 ${i === storyIdx ? "font-semibold text-slate-100" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}
              style={i === storyIdx ? { borderColor: STORY_COLOR[st.kind], background: `${STORY_COLOR[st.kind]}22` } : undefined}
            >
              {t(`future.story_${st.kind}`)}{shareText(st.share)}
            </button>
          ))}
        </div>
      )}
      {/* 平面图矮一些（窗口高度的55%，340～560像素）：整张图连同上下的小柱子能一屏看全；立体图还是高一点才看得清 */}
      {/* 平面图上两处不好在图例里说的：上面的小柱子、右边的横条。放在图上方一行（放在图里会压住图上的标题） */}
      {view === "plane" && run.done && (
        <div className="-mb-0.5 flex shrink-0 justify-between px-1 text-[10px] text-sky-300/80" style={{ paddingLeft: PLANE_ML }}>
          <InfoTip {...tip("exits")}><span>{t("future.tipExitsLbl")}</span></InfoTip>
          <InfoTip {...tip("endAll")}><span>{t("future.tipEndLbl")}</span></InfoTip>
        </div>
      )}
      <div className={`relative ${view === "3d" ? "h-[clamp(420px,70vh,760px)]" : "h-[clamp(340px,55vh,560px)]"} shrink-0 overflow-hidden rounded-md border border-slate-800`}>
        {view === "3d" ? (
          <SimSurface3D
            model={model}
            days={days}
            path={path3d}
            bands={run.bands}
            scenario={scen}
            endDay={p.endDay}
            labels={labels3d}
            money={money3d}
            notes={notes3d}
            slices={[
              ...(scen && scen.day > 0.5 && scen.day < days - 0.5 ? [{ day: scen.day, label: t("future.sliceDay", { d: Math.round(scen.day) }), color: "#38bdf8" }] : []),
              { day: days, label: t("future.sliceEnd"), color: "#fde68a" },
            ]}
          />
        ) : (
          <CanvasBox
            className="h-full w-full"
            draw={drawPlane}
            deps={[model, run.bands, run.done, forkShown, scen?.day, scen?.price, p.endDay, symbol, storyIdx, earnDay, earnings?.next, t]}
            label={histActive ? t("future.titleHist", { s: symbol, n: totalN.toLocaleString() }) : t("future.title", { s: symbol })}
          />
        )}
      </div>
      {legend}
      {/* 怎么看这张图：紧跟在图下面（2026-10-07 xue：原来隔着"你的钱会怎么变"，找不到） */}
      <HowToRead lines={howLines} />
      {/* ⑤ 你的钱会怎么变：平面图正下方，同一批走势、同一条时间轴（左右边距跟平面图一样） */}
      {view === "plane" && run.done?.money && run.done.money.length > 0 && (
        <MoneyPanel
          days={days}
          endDay={p.endDay}
          spot={spot}
          stories={stories}
          storyIdx={storyIdx}
          colors={STORY_COLOR}
          money={run.done.money}
          exitDays={run.done.exitDays}
          stats={run.done.stats}
          tpLine={p.tpLine}
          slLine={p.slLine}
          scen={scen}
          scenPnl={scen && fork ? fork.pnl : null}
          margin={{ l: PLANE_ML, r: PLANE_MR }}
          n={run.done.stats.n}
        />
      )}
      <div className="shrink-0 rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 leading-relaxed">
        {scenTop}
        {moved && <div className="mb-1 mt-2 border-t border-slate-800 pt-2 text-[12px] font-bold text-slate-100">{t("future.tradeTitle", { n: totalN.toLocaleString() })}</div>}
        {run.error ? (
          <span className="text-rose-300">{t("winRate.error")}</span>
        ) : card.length ? (
          <div className="flex flex-col gap-1.5">{card}</div>
        ) : (
          <span className="text-slate-500">{t("future.running")}</span>
        )}
        {!moved && <div className="mt-1.5 border-t border-slate-800 pt-1.5 text-sky-100">{t("future.scenNone")}</div>}
        <div className="mt-1.5 text-[10px] text-slate-500">
          {t(credit ? "winRate.basisCredit" : "winRate.basisDebit", { v: usd(p.basis) })} {t(histActive ? "future.modelHist" : "future.model")}{effSkew > 0 && ` ${t("future.modelSkew", { k: (effSkew * 10).toFixed(1) })}`}
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
                draw={(g, W, H) => drawVolCurve(g, W, H, { curve: curve.curve as CurvePoint[], ivCenter: Math.max(0.01, ivCmp + dV / 100), vol: runVol, breakevenVol: be?.vol ?? null, money, t })}
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
            <div className="mb-1 text-[10px] text-slate-500">{t("winRate.distTitle", { n: totalN.toLocaleString() })}</div>
            {run.done && (
              <CanvasBox className="h-[130px]" draw={(g, W, H) => drawPnlHist(g, W, H, run.done!.hist as Histogram, money)} deps={[run.done]} label={t("winRate.distTitle", { n: totalN })} />
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

