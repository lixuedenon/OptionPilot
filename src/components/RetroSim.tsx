// src/components/RetroSim.tsx
// "万次推演"标签（今昔对比）：站在开仓那天，按当时市场的预期（开仓时的隐含波动率）、组合一直不动，随机走到今天，
// 看真实走过的路（金色）落在这团可能里的哪儿——今天的结果是运气、优势还是隐含波动率变化造成的，按你的规则本该哪天下车。
// 只回看、不往后推演：往后怎么办交给左边的持仓建议（右边不重复"往后看"）。
// 画面跟分析模式的万次推演同一套（平面=地形图+密度云；立体=SimSurface3D），横轴只到今天。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nContext";
import type { Leg } from "@/lib/types";
import { openingBasis, isCreditCombo, percentileOf, moveInSigma } from "@/lib/winRateSim";
import type { EndDist, GridSpec, RuleExit, Band } from "@/lib/futureSim";
import { drawZones, drawBands, labelBands, type PlaneFrame } from "@/lib/planeChart";
import type { FutureRequest, FutureResponse, Sample, RetroDay } from "@/lib/futureSim.worker";
import { buildMapModel, comboBaseIv, type PnlParts, type SegmentAttribution } from "@/lib/stockOptionMap";
import { priceStance, journeyRows, keyLevels } from "@/lib/retroStory";
import { NowCells, JourneyBlock } from "@/components/ValueJourney";
import { fetchHistoricalSeries, realizedVolSince, rangeSince } from "@/lib/historicalVolatility";
import { useSimSettings } from "@/lib/simSettings";
import CanvasBox from "@/components/simCharts";
import SimSurface3D from "@/components/SimSurface3D";
import HowToRead from "@/components/HowToRead";
import { getOptionChain, premiumFromQuote } from "@/lib/optionChain";
import { holdLegPrice, holdPnl, priceNearDay } from "@/lib/adjustReview";
import RetroHistoryPanel, { type RetroHistSummary } from "@/components/RetroHistoryPanel";
import InfoTip from "@/components/InfoTip";

interface Props {
  symbol: string;
  legs: Leg[]; // 开仓那天的组合（已去掉屏蔽的），dte按开仓日算
  spot: number; // 开仓价
  openingAt: number;
  todayDay: number; // 今天是开仓后第几天
  nowSpot: number;
  pnlNow: number; // 开仓至今总盈亏（含已实现）
  history: { day: number; price: number; pnl: number }[]; // 真实走过的路：开仓点、各快照、今天
  ruleExit: RuleExit | null;
  ivChange: number | undefined; // 开仓以来隐含波动率变化（百分点）
  ivOpen: number; // 开仓时的平均隐含波动率（跟滑块小字同一个数）
  journey: { states: { day: number; spot: number; pnl: number }[]; segments: SegmentAttribution[]; totals: PnlParts & { total: number } } | null;
  todayLegs: Leg[]; // 今日组合（算到期关键价位）
  adjusted: boolean; // 中途做过调整（换合约/平掉部分腿）
  // 第5组：每次展期/保护/对冲第一次出现的那天（buildTrackedHistory的markers）
  markers?: { day: number; via: "roll" | "protect" | "hedge" }[];
  emptyText: string | null;
}

const PATHS = 5000;
// 固定种子：同一笔持仓每次打开排名都一样，不会因为重新渲染跳来跳去。
const RETRO_SEED = 20261002;
const ROWS = 80;
const SAMPLES = 40;
const VIEW_KEY = "optionpilot.simView";
const EXIT_RGB: Record<RuleExit["kind"], string> = { tp: "#34d399", sl: "#fb7185", delta: "#a78bfa", time: "#fbbf24" };

function loadView(): "plane" | "3d" {
  try {
    return localStorage.getItem(VIEW_KEY) === "plane" ? "plane" : "3d";
  } catch {
    return "3d";
  }
}

function niceStep(span: number, target: number) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

interface RetroRun {
  key: string;
  sorted: number[];
  prices: number[]; // 今天5000条走势的股价，从小到大
  days: RetroDay[]; // 各快照那天的股价/盈亏分布
  holding: Float32Array;
  samples: Sample[];
  end: EndDist;
  bands: Band[]; // 平面图的股价范围带（开仓到今天，全部走势）
}

export default function RetroSim({ symbol, legs, spot, openingAt, todayDay, nowSpot, pnlNow, history, ruleExit, ivChange, ivOpen, journey, todayLegs, adjusted, markers = [], emptyText }: Props) {
  const { t } = useI18n();
  const { rules: rulesBySide } = useSimSettings(symbol);
  const [view, setView] = useState<"plane" | "3d">(loadView);
  const [since, setSince] = useState<{ status: "loading" | "ok" | "error"; vol?: number; limited?: boolean }>({ status: "loading" });
  const [run, setRun] = useState<RetroRun | null>(null);
  const [error, setError] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  // 第5组：开仓那组原封不动拿到今天——各腿今天的期权链中间价（查不到为null）
  const [histSum, setHistSum] = useState<RetroHistSummary | null>(null); // ⑦的几样结论，给图上方的复盘结论框
  const [holdMids, setHoldMids] = useState<{ key: string; mids: (number | null)[] } | null>(null);
  const holdKey = adjusted ? `${symbol}|${todayDay}|${legs.map((l) => `${l.type}:${l.strike}:${l.dte}`).join(",")}` : "";
  useEffect(() => {
    if (!holdKey || !symbol) return;
    let alive = true;
    Promise.all(
      legs.map(async (l) => {
        const dteNow = l.dte - todayDay;
        if (l.kind === "stock" || dteNow < 1) return null;
        try {
          const c = await getOptionChain(symbol, dteNow);
          // 只认同一张合约：到期日差1天以内、行权价相同
          if (c.usedExpiryDate && Math.abs(new Date(c.usedExpiryDate + "T00:00:00").getTime() - (Date.now() + dteNow * 86400000)) > 1.5 * 86400000) return null;
          const q = (l.type === "call" ? c.calls : c.puts).find((r) => r.strike === l.strike);
          const m = q ? premiumFromQuote(q) : 0;
          return m > 0 ? m : null;
        } catch {
          return null;
        }
      }),
    ).then((mids) => alive && setHoldMids({ key: holdKey, mids }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdKey]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* 浏览器禁止存储时只是不记住 */
    }
  }, [view]);

  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    setSince({ status: "loading" });
    fetchHistoricalSeries(symbol, rangeSince(openingAt))
      .then((s) => {
        if (!alive) return;
        const r = realizedVolSince(s, openingAt);
        setSince(r ? { status: "ok", vol: r.vol, limited: r.limited } : { status: "error" });
      })
      .catch(() => alive && setSince({ status: "error" }));
    return () => {
      alive = false;
    };
  }, [symbol, openingAt]);

  const basis = useMemo(() => openingBasis(legs), [legs]);
  const credit = useMemo(() => isCreditCombo(legs), [legs]);
  const rules = rulesBySide[credit ? "credit" : "debit"];
  const hasStock = legs.some((l) => l.kind === "stock");
  const horizon = useMemo(() => {
    const d = legs.filter((l) => l.kind !== "stock").map((l) => l.dte);
    return d.length ? Math.max(1, Math.round(Math.min(...d))) : 0;
  }, [legs]);
  const days = Math.max(1, Math.min(horizon, Math.round(todayDay)));
  const openIv = useMemo(() => comboBaseIv(legs, spot) ?? 0.3, [legs, spot]);
  const stance = useMemo(() => (basis != null ? priceStance(legs, spot, basis) : "neutral"), [legs, spot, basis]);
  const levels = useMemo(() => keyLevels(todayLegs, nowSpot, pnlNow), [todayLegs, nowSpot, pnlNow]);
  const pathPrices = useMemo(() => history.map((h) => h.price), [history]);
  const model = useMemo(
    () => (basis == null || hasStock ? null : buildMapModel(legs, spot, 0, { extraPrices: [nowSpot, ...pathPrices] }, 120, ROWS)),
    [basis, hasStock, legs, spot, nowSpot, pathPrices],
  );
  const grid: GridSpec | null = useMemo(() => (model ? { sMin: model.sMin, sMax: model.sMax, rows: ROWS, days } : null), [model, days]);
  const ready = !emptyText && !!model && !!grid && basis != null && todayDay >= 1;
  const checkDays = useMemo(() => [...new Set(history.map((h) => h.day))].filter((d) => d > 0).sort((a, b) => a - b), [history]);

  const runKey = useMemo(() => {
    if (!ready || !grid) return "";
    const lk = legs.map((l) => [l.action, l.type, l.strike, l.dte, l.premium, l.qty ?? 1].join(":")).join("|");
    return [lk, spot.toFixed(3), openIv.toFixed(4), days, grid.sMin.toFixed(3), grid.sMax.toFixed(3), checkDays.join(",")].join("#");
  }, [ready, grid, legs, spot, openIv, days, checkDays]);

  useEffect(() => {
    if (!runKey || !grid || basis == null) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      workerRef.current?.terminate();
      const w = new Worker(new URL("../lib/futureSim.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = w;
      setError(false);
      const runId = Date.now();
      w.onmessage = (e: MessageEvent<FutureResponse>) => {
        const m = e.data;
        if (cancelled || m.runId !== runId) return;
        if (m.type === "retro") setRun({ key: runKey, sorted: m.sorted, prices: m.prices, days: m.days, holding: m.holding, samples: m.samples, end: m.end, bands: m.bands });
        else if (m.type === "error") setError(true);
      };
      // 回看不套规则：问的是"组合一直不动，到今天会在哪"，跟真实总账（含已实现）比；规则复盘另外沿真实的路做。
      const req: FutureRequest = {
        kind: "retro", runId, vol: openIv, n: PATHS, samples: SAMPLES, seed: RETRO_SEED, grid, checkDays,
        setup: { legs, spot, basis, pnlOffset: 0, rules: { takeProfitPct: null, stopMult: null, closeFrac: 0 }, totalTerm: horizon },
      };
      w.postMessage(req);
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const money = (v: number) => `${v < -0.005 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
  const usd = (v: number) => `$${Math.abs(v).toFixed(2)}`;

  if (emptyText) return <div className="flex h-full items-center justify-center text-sm text-slate-400">{emptyText}</div>;
  if (hasStock || basis == null || !model || !grid) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">
        {hasStock ? t("winRate.noStock") : t("winRate.noBasis")}
      </div>
    );
  }
  if (todayDay < 1) return <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">{t("future.retroDay0")}</div>;

  const shown = run && run.key === runKey ? run : null;
  const sorted = shown?.sorted ?? null;
  // 真实的路：只取今天以前（含今天），按天排好；超出价格范围的点也保留（画的时候裁掉）。
  const actual = [...history].filter((h) => h.day <= days).sort((a, b) => a.day - b.day);
  const exitShown = ruleExit && ruleExit.day <= days ? ruleExit : null;

  // ── 平面：开仓→今天的地形图做底色，可能走过的地方发亮，金色是真实走的路 ──
  const drawPlane = (g: CanvasRenderingContext2D, W: number, H: number) => {
    const M = { l: 56, r: 96, t: 22, b: 34 };
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const X = (d: number) => M.l + (d / days) * pw;
    const Y = (s: number) => M.t + ((model.sMax - s) / (model.sMax - model.sMin)) * ph;
    const ch = ph / ROWS;
    const f: PlaneFrame = { X, Y, left: M.l, top: M.t, width: pw, height: ph };
    g.save();
    g.beginPath();
    g.rect(M.l, M.t, pw, ph);
    g.clip();
    // 赚/亏两区（按开仓时的隐含波动率，那一天、那个股价平仓是赚是亏）+ 开仓那天看到今天的股价范围带
    drawZones(g, model, days, f, "rgba(248,250,252,0.85)");
    if (shown) drawBands(g, shown.bands, f);
    // 真实的路
    if (actual.length > 1) {
      g.strokeStyle = "rgba(2,6,23,0.9)";
      g.lineWidth = 5;
      g.beginPath();
      actual.forEach((a, i) => (i ? g.lineTo(X(a.day), Y(a.price)) : g.moveTo(X(a.day), Y(a.price))));
      g.stroke();
      g.strokeStyle = "#fbbf24";
      g.lineWidth = 2.4;
      g.stroke();
      g.lineWidth = 1;
    }
    for (const a of actual) {
      g.fillStyle = "#fbbf24";
      g.beginPath();
      g.arc(X(a.day), Y(a.price), 3, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // 每个点标上当时的总盈亏（太挤时跳过），图上就能直接看到盈亏是怎么一步步变过来的
    g.font = "bold 10px sans-serif";
    g.textAlign = "center";
    let lastX = -Infinity;
    actual.forEach((a, i) => {
      const x = X(a.day), y = Y(a.price);
      if (i === 0 || x - lastX < 44 || y < M.t || y > M.t + ph) return;
      lastX = x;
      const label = money(a.pnl);
      const tw = g.measureText(label).width;
      const lx = Math.min(M.l + pw - tw / 2 - 2, x);
      g.fillStyle = "rgba(2,6,23,0.8)";
      g.fillRect(lx - tw / 2 - 2, y - 19, tw + 4, 13);
      g.fillStyle = a.pnl >= 0 ? "#6ee7b7" : "#fda4af";
      g.fillText(label, lx, y - 9);
    });
    g.font = "10px sans-serif";
    // 今天的点
    const tx = X(days), ty = Y(Math.min(model.sMax, Math.max(model.sMin, nowSpot)));
    g.fillStyle = "#fbbf24";
    g.strokeStyle = "#020617";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(tx, ty, 5.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.lineWidth = 1;
    // 行权价
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
    // 按规则本该下车的那一点
    if (exitShown) {
      const x = X(exitShown.day), y = Y(exitShown.price);
      g.strokeStyle = EXIT_RGB[exitShown.kind];
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 8, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 1;
    }
    const step = niceStep(model.sMax - model.sMin, 6);
    g.fillStyle = "#94a3b8";
    g.textAlign = "right";
    for (let v = Math.ceil(model.sMin / step) * step; v <= model.sMax; v += step) g.fillText(String(Math.round(v * 100) / 100), M.l - 4, Y(v) + 3);
    // 右侧：今天这团可能落在哪个价位（按平均盈亏上色），三角标出你实际的价格
    if (shown) {
      const mx = Math.max(...shown.end.counts) || 1;
      const x0 = M.l + pw + 6;
      shown.end.counts.forEach((c, r) => {
        if (!c) return;
        g.fillStyle = shown.end.pnlSum[r] >= 0 ? "rgba(52,211,153,0.8)" : "rgba(251,113,133,0.8)";
        g.fillRect(x0, M.t + r * ch, (c / mx) * (M.r - 14), Math.max(1, ch - 0.5));
      });
      g.fillStyle = "#fbbf24";
      g.beginPath();
      g.moveTo(x0 - 1, ty);
      g.lineTo(x0 - 7, ty - 4);
      g.lineTo(x0 - 7, ty + 4);
      g.closePath();
      g.fill();
      g.fillStyle = "#94a3b8";
      g.textAlign = "left";
      g.fillText(t("future.todayAllTitle"), x0, M.t - 4);
      const win = 100 - percentileOf(shown.sorted, 1e-9);
      g.font = "bold 10px sans-serif";
      g.fillStyle = "#6ee7b7";
      g.fillText(t("future.todayAllWin", { p: Math.round(win) }), x0, M.t + ph + 12);
      g.fillStyle = "#fda4af";
      g.fillText(t("future.todayAllLoss", { p: Math.round(100 - win) }), x0, M.t + ph + 24);
      g.font = "10px sans-serif";
    }
    if (shown) labelBands(g, shown.bands, f, { mid: t("future.bandMid"), dark: t("future.bandDark"), light: t("future.bandLight") });
    g.font = "10px sans-serif";
    g.fillStyle = "#64748b";
    g.textAlign = "left";
    g.fillText(t("future.axOpen"), M.l, H - M.b + 13);
    g.textAlign = "right";
    g.fillStyle = "#fbbf24";
    g.fillText(t("future.axToday", { d: days }), M.l + pw, H - M.b + 13);
    g.font = "bold 11px sans-serif";
    g.fillStyle = "#e2e8f0";
    g.textAlign = "center";
    g.fillText(`${t("future.axisRetro")} →`, M.l + pw / 2, H - 4);
    const yLabel = t("som.axisPrice");
    const midY = M.t + ph / 2;
    if (/[一-鿿]/.test(yLabel)) {
      ["↑", ...yLabel].forEach((c, i, a) => g.fillText(c, 9, midY - ((a.length - 1) * 14) / 2 + i * 14 + 4));
    } else {
      g.save();
      g.translate(10, midY);
      g.rotate(-Math.PI / 2);
      g.fillText(`${yLabel} →`, 0, 4);
      g.restore();
    }
    g.font = "bold 12px sans-serif";
    g.fillStyle = "#f8fafc";
    g.fillText(t("future.retroTitle", { s: symbol.trim().toUpperCase() }), M.l + pw / 2, 15);
  };

  const notes3d = {
    top: (r: string, v: string) => t("future.noteTopToday", { r, v }),
    bottom: (r: string, v: string) => t("future.noteBottomToday", { r, v }),
    breakeven: t("future.noteBe"),
    above: (a: string) => t("future.noteAbove", { a }),
    below: (b: string) => t("future.noteBelow", { b }),
    between: (a: string, b: string) => t("future.noteBetween", { a, b }),
    outside: (a: string, b: string) => t("future.noteOutside", { a, b }),
  };
  const labels3d = {
    open: t("future.axOpen"),
    expiry: t("future.axToday", { d: days }),
    close: "",
    price: t("som.axisPrice"),
    pnl: t("future.axPnl"),
    hint: t("future.hint3d"),
    intro: t("future.intro3d"),
    time: `${t("future.axisRetro")} →`,
    floor: t("future.floorTagRetro"),
    curtain: t("future.curtainTagRetro"),
    zero: t("future.zeroTag"),
    band: t("future.bandTag3d", { n: PATHS.toLocaleString() }),
    dayTick: (d: number) => t("future.dayTick", { d }),
    scen: () => "",
  };

  // ── 卡片：先说"现在跟开仓时比"（就是左边滑块的位置），再说组合的价值一路经历了什么、正不正常、现在的处境 ──
  // 每一节标题旁边一个ⓘ（悬停说明：这一节回答什么、举个例子），内容在 rtip.<key>.t/b/e
  const tip = (id: string) => ({ title: t(`rtip.${id}.t`), body: t(`rtip.${id}.b`), example: t(`rtip.${id}.e`) });
  const SEC_TIPS = new Set(["now", "sim", "journey", "path", "replay", "adj", "rh", "rh8", "levels"]);
  const sec = (key: string, title: string, body: ReactNode) => (
    <div key={key} className="border-t border-slate-800 pt-2 first:border-t-0 first:pt-0">
      <div className="mb-1 text-[12px] font-bold text-slate-100">{SEC_TIPS.has(key) ? <InfoTip {...tip(key)}>{title}</InfoTip> : title}</div>
      {body}
    </div>
  );
  // 复盘结论框要用的数：在下面各节里算出来时顺手记下
  let rankPct: number | null = null; // 你现在的盈亏在5000次里比百分之几好
  let adjInfo: { diff: number; via: string; day: number } | null = null; // 调整让你多/少了多少
  const sections: ReactNode[] = [];
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;

  // ① 现在跟开仓时比（就是左边冻结的滑块）
  const chg = nowSpot - spot;
  const chgPct = (nowSpot / spot - 1) * 100;
  const ivA = (ivOpen ?? openIv) * 100;
  const ivB = ivChange != null ? Math.max(0, ivA + ivChange) : null;
  sections.push(sec("now", t("future.nowTitle"), <NowCells spot0={spot} spot1={nowSpot} day={days} horizon={horizon} ivA={ivA} ivB={ivB} />));

  // ② 这几天，组合的价值经历了什么（股价/时间/隐含波动率/调整各让你赚亏多少）
  const totals = journey?.totals ?? null;
  if (totals) {
    sections.push(
      sec("journey", t("future.jTitle", { d: days }), (
        <JourneyBlock mode="retro" totals={totals} pnl={pnlNow} credit={credit} basis={basis} stance={stance} spot0={spot} spot1={nowSpot} day={days} ivA={ivA} ivB={ivB} />
      )),
    );
  }

  // 万次推演假设隐含波动率一直是开仓时的、组合不做调整，所以拿真实盈亏跟它比之前，先拿掉这两项（"公平比较"）。
  const exclIv = totals ? totals.iv : 0;
  const exclAdj = totals ? totals.adjust : 0;
  const hasExcl = Math.abs(exclIv) >= 0.005 || Math.abs(exclAdj) >= 0.005;
  const pnlFair = pnlNow - exclIv - exclAdj;
  const dayStat = new Map((shown?.days ?? []).map((d) => [d.day, d]));
  const pct = (sortedArr: number[], v: number) => Math.round(percentileOf(sortedArr, v));

  // ③ 一路是怎么走过来的（每段：日子、股价、盈亏、主要原因，以及那一天在推演里排第几）
  const rows = journey ? journeyRows(journey.states, journey.segments) : [];
  if (rows.length >= 2) {
    let cumIv = 0, cumAdj = 0;
    const rankCells = rows.map((r) => {
      cumIv += r.parts.iv;
      cumAdj += r.parts.adjust;
      if (!shown) return null;
      const fair = r.toPnl - cumIv - cumAdj;
      if (r.toDay >= days) return { p: pct(shown.prices, r.toSpot), v: pct(shown.sorted, fair) };
      const ds = dayStat.get(r.toDay);
      return ds ? { p: pct(ds.prices, r.toSpot), v: pct(ds.pnls, fair) } : null;
    });
    sections.push(
      sec("path", t("future.pathTitle"), (
        <>
          <table className="w-full text-[11px] tabular-nums">
            <thead>
              <tr className="text-left text-[10px] text-slate-500">
                <th className="font-normal">{t("future.pathDays")}</th>
                <th className="font-normal">{t("future.pathPrice")}</th>
                <th className="font-normal">{t("future.pathPnl")}</th>
                <th className="font-normal">{t("future.pathMain")}</th>
                <th className="font-normal">{t("future.pathRank", { n: PATHS.toLocaleString() })}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const d = r.toPnl - r.fromPnl;
                const rc = rankCells[i];
                return (
                  <tr key={`${r.fromDay}-${r.toDay}`} className="border-t border-slate-800/60">
                    <td className="py-0.5 text-slate-400">{t("future.pathDayRange", { a: r.fromDay, b: r.toDay })}{r.estimated ? t("future.pathEst") : ""}</td>
                    <td>{r.fromSpot.toFixed(2)} → {r.toSpot.toFixed(2)}</td>
                    <td>
                      {money(r.fromPnl)} → {money(r.toPnl)}{" "}
                      <span className={d >= 0 ? "text-emerald-300" : "text-rose-300"}>({signed(d)})</span>
                    </td>
                    <td className="text-slate-300">{t(`future.f_${r.main}`)} {signed(r.parts[r.main])}</td>
                    <td className="text-sky-200">{rc ? t("future.pathRankCell", { p: rc.p, v: rc.v }) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-1 text-[10px] text-slate-500">{t(hasExcl ? "future.pathRankNoteExcl" : "future.pathRankNote")}</div>
        </>
      )),
    );
  }

  // ④ 万次推演：站在开仓那天看，你走的这条路常见吗？
  const q = (f: number) => (sorted && sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * (sorted.length - 1)))] : 0);
  const sigmaPct = openIv * Math.sqrt(days / 365) * 100;
  const how = t(view === "3d" ? "future.simHow3d" : "future.simHow", {
    iv: (openIv * 100).toFixed(1), d: days, p: sigmaPct.toFixed(1), lo: (spot * Math.exp(-sigmaPct / 100)).toFixed(2), hi: (spot * Math.exp(sigmaPct / 100)).toFixed(2),
    n: PATHS.toLocaleString(),
  });
  if (sorted && sorted.length && shown) {
    const pctile = percentileOf(sorted, pnlNow);
    rankPct = pctile;
    const pctFair = percentileOf(sorted, pnlFair);
    const z = moveInSigma(spot, nowSpot, openIv, days);
    const ratio = since.status === "ok" && since.vol ? since.vol / openIv : null;
    const calm = ratio == null ? null : ratio < 0.9 ? "calm" : ratio > 1.1 ? "wild" : "even";
    const edgeGood = calm == null || calm === "even" ? null : credit ? calm === "calm" : calm === "wild";
    const ivHelped = ivB == null || Math.abs(ivB - ivA) < 1 || !totals ? null : totals.iv > 0;
    const pricePct = percentileOf(shown.prices, nowSpot);
    const further = Math.round(chg >= 0 ? 100 - pricePct : pricePct);
    const winPct = Math.round(100 - percentileOf(sorted, 1e-9));
    const verdict =
      pctile < 35
        ? Math.abs(z) >= 1.5 ? "v_badBig" : edgeGood === false ? "v_badEdge" : ivHelped === false ? "v_badIv" : edgeGood ? "v_badDirection" : "v_badNormal"
        : pctile > 65
          ? edgeGood ? "v_goodEdge" : ivHelped ? "v_goodIv" : Math.abs(z) >= 1 ? "v_goodLuck" : "v_good"
          : "v_normal";
    const what = [Math.abs(exclIv) >= 0.005 ? t("future.exIv") : "", Math.abs(exclAdj) >= 0.005 ? t("future.exAdj") : ""].filter(Boolean).join(t("future.and"));
    const sub = (label: string, body: ReactNode) => (
      <div className="flex gap-2">
        <span className="w-10 shrink-0 font-semibold text-sky-300">{label}</span>
        <div className="min-w-0 flex-1">{body}</div>
      </div>
    );
    sections.push(
      sec("sim", t("future.simTitle"), (
        <div className="flex flex-col gap-1.5">
          <div className="text-slate-400">{how}</div>
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
            <div className="flex flex-col gap-1.5">
              {sub(t("future.simPriceLabel"), (
                <>
                  {t(chg >= 0 ? "future.simPriceUp" : "future.simPriceDown", { s: nowSpot.toFixed(2), n: PATHS.toLocaleString(), pct: further })}{" "}
                  {t(Math.abs(z) <= 1 ? "future.luckInside" : Math.abs(z) < 1.5 ? "future.luckEdge" : "future.luckOutside", {
                    dir: t(chg >= 0 ? "winRate.dirUp" : "winRate.dirDown"), p: Math.abs(chgPct).toFixed(1),
                  })}{" "}
                  {since.status === "ok" && ratio != null && since.vol != null && (
                    <>
                      {t("future.luckReal", { rv: (since.vol * 100).toFixed(1), d: days, limited: since.limited ? t("winRate.limitedNote") : "" })}
                      {t(`future.luckReal_${calm}_${credit ? "seller" : "buyer"}`)}
                    </>
                  )}
                </>
              ))}
              {sub(t("future.simPnlLabel"), (
                <>
                  {t("future.simPnlCloud", { iv: (openIv * 100).toFixed(1), d: days, p25: money(q(0.25)), p75: money(q(0.75)), p50: money(q(0.5)), win: winPct })}{" "}
                  {hasExcl
                    ? <>
                        {t("future.simPnlFair", { what, ex: money(pnlFair), pct: Math.round(pctFair) })}{" "}
                        {t("future.simPnlBack", { what, gl: t(pnlNow - pnlFair >= 0 ? "future.glHelp" : "future.glHurt"), v: usd(pnlNow - pnlFair), a: money(pnlNow), pct: Math.round(pctile) })}
                      </>
                    : t("future.simPnlPlain", { a: money(pnlNow), pct: Math.round(pctile) })}
                </>
              ))}
              {sub(t("future.simRankLabel"), t("future.luckRank", { d: days, better: 100 - Math.round(pctile), worseN: Math.round(pctile) }))}
              <div className="mt-1 font-semibold text-amber-200">{t(`future.${verdict}`)}</div>
            </div>
            <div className="min-w-0">
              <CanvasBox className="h-[130px]" draw={drawRetro} deps={[sorted, pnlNow, pnlFair, hasExcl, t]} label={t("winRate.retroHistHint")} />
              <div className="text-center text-[10px] text-slate-500">{t("future.simHistHint", { n: PATHS.toLocaleString(), d: days })}</div>
            </div>
          </div>
        </div>
      )),
    );
  } else {
    sections.push(sec("sim", t("future.simTitle"), <><div className="text-slate-400">{how}</div><span className="text-slate-500">{t("winRate.retroPending")}</span></>));
  }

  // ⑤ 按你的规则
  const ruleOn = rules.takeProfitPct != null || rules.stopMult != null || rules.closeFrac > 0 || rules.deltaExit != null;
  let ruleBody: string;
  if (!ruleOn) ruleBody = t("future.replayNone");
  else if (exitShown) {
    const diff = pnlNow - exitShown.pnl;
    ruleBody = t(`future.replay_${exitShown.kind}`, { d: exitShown.day, s: exitShown.price.toFixed(2), v: money(exitShown.pnl) });
    if (exitShown.day < days) ruleBody += ` ${t(diff >= 0 ? "future.replayBetter" : "future.replayWorse", { v: usd(diff) })}`;
  } else ruleBody = t("future.replayNotYet");
  sections.push(sec("replay", t("future.replayLabel"), <>{ruleBody} <span className="text-slate-500">{t("future.replayNote")}</span></>));
  // ⑦⑧：用过去2年评价这笔 + 规则复盘（这一次 vs 过去2年）
  sections.push(
    <RetroHistoryPanel
      key="rh"
      symbol={symbol} legs={legs} spot={spot} openingAt={openingAt} todayDay={todayDay} nowSpot={nowSpot} pnlNow={pnlNow}
      history={history} markers={markers} adjusted={adjusted} rules={rules} credit={credit} basis={basis} horizon={horizon} sec={sec}
      onSummary={setHistSum}
    />,
  );

  // ⑥ 现在的处境（按今天的组合，到期时的关键价位）
  if (levels) {
    const parts: string[] = [];
    const be = levels.breakevens;
    if (levels.profitSide === "below") parts.push(t("future.lvBelow", { a: be[0].toFixed(2) }));
    else if (levels.profitSide === "above") parts.push(t("future.lvAbove", { a: be[0].toFixed(2) }));
    else if (levels.profitSide === "between") parts.push(t("future.lvBetween", { a: be[0].toFixed(2), b: be[1].toFixed(2) }));
    else if (levels.profitSide === "outside") parts.push(t("future.lvOutside", { a: be[0].toFixed(2), b: be[1].toFixed(2) }));
    if (levels.maxProfit != null) parts.push(t("future.lvMaxProfit", { v: money(levels.maxProfit) }));
    parts.push(levels.maxLoss != null ? t("future.lvMaxLoss", { v: money(levels.maxLoss) }) : t("future.lvNoCap"));
    sections.push(
      sec("levels", t("future.lvTitle", { r: Math.max(0, horizon - days), s: nowSpot.toFixed(2) }), (
        <>
          <div>{parts.join(t("future.sep"))}{t("future.period")}</div>
          <div className="mt-1 text-sky-200">{t("future.retroNext")}</div>
        </>
      )),
    );
  } else {
    sections.push(<div key="next" className="border-t border-slate-800 pt-2 text-sky-200">{t("future.retroNext")}</div>);
  }
  // 第5组：你的调整值不值——原组合不调整拿到今天 vs 真实总账
  if (adjusted) {
    const mids = holdMids && holdMids.key === holdKey ? holdMids.mids : null;
    if (mids) {
      const prices = legs.map((l, i) => holdLegPrice(l, spot, nowSpot, todayDay, mids[i], priceNearDay(history, l.dte, nowSpot)));
      const hold = holdPnl(legs, prices);
      const diff = pnlNow - hold.pnl;
      const firstAdj = markers.length ? markers.reduce((a, b) => (a.day <= b.day ? a : b)) : null;
      const adjPrice = firstAdj ? priceNearDay(history, firstAdj.day, nowSpot) : null;
      const helped = diff >= 0.005;
      const same = Math.abs(diff) < 0.005;
      const box = (label: string, v: number, est = false, tone?: "good" | "bad") => (
        <div className={`flex min-w-0 flex-col gap-0.5 rounded border px-2 py-1.5 ${tone === "good" ? "border-emerald-800 bg-emerald-950/30" : tone === "bad" ? "border-rose-800 bg-rose-950/30" : "border-slate-800 bg-slate-900/50"}`}>
          <span className="text-[10px] text-slate-400">{label}</span>
          <span className={`text-[16px] font-extrabold tabular-nums ${v >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{signed(v)}{est && <span className="ml-1 text-[10px] font-normal text-amber-300">{t("future.adjEst")}</span>}</span>
        </div>
      );
      const via = firstAdj ? t(`future.adjVia_${firstAdj.via}`) : t("future.adjVia_generic");
      adjInfo = { diff, via, day: firstAdj?.day ?? 0 };
      sections.push(
        sec("adj", t("future.adjTitle"), (
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-3 gap-2">
              {box(t("future.adjReal"), pnlNow)}
              {box(t("future.adjHold"), hold.pnl, hold.estimated)}
              {box(same ? t("future.adjDiffSame") : helped ? t("future.adjDiffHelped") : t("future.adjDiffHurt"), diff, false, same ? undefined : helped ? "good" : "bad")}
            </div>
            <div><span className="text-[11px] font-bold text-sky-300">{t("future.adjWhatLbl")}</span> {t(same ? "future.adjWhatSame" : helped ? "future.adjWhatHelped" : "future.adjWhatHurt", { via, h: signed(hold.pnl), r: signed(pnlNow), d: `$${Math.abs(diff).toFixed(2)}`, day: firstAdj?.day ?? 0 })}</div>
            {!same && adjPrice != null && (
              <div><span className="text-[11px] font-bold text-sky-300">{t("future.adjWhyLbl")}</span> {t(helped ? "future.adjWhyHelped" : "future.adjWhyHurt", { a: adjPrice.toFixed(2), n: nowSpot.toFixed(2) })}</div>
            )}
            <div><span className="text-[11px] font-bold text-sky-300">{t("future.adjHowLbl")}</span> {t(helped || same ? "future.adjHowHelped" : "future.adjHowHurt")}</div>
            <div className="text-[10px] text-slate-500">{t(hold.estimated ? "future.adjNoteEst" : "future.adjNote")}</div>
          </div>
        )),
      );
    } else {
      sections.push(sec("adj", t("future.adjTitle"), <span className="text-slate-500">{t("future.adjLoading")}</span>));
    }
  }

  // 开仓那天看、到今天的所有可能盈亏，金线是你现在的位置
  function drawRetro(g: CanvasRenderingContext2D, W: number, H: number) {
    if (!sorted || !sorted.length) return;
    const lo = Math.min(q(0.01), pnlNow, pnlFair);
    const hi = Math.max(q(0.99), pnlNow, pnlFair);
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
    const xOf = (v: number) => L + ((v - lo) / (hi - lo || 1)) * (W - L - R);
    const ax = xOf(pnlNow);
    g.font = "10px sans-serif";
    // 虚线：拿掉隐含波动率变化/调整后的你（跟推演公平比的那个数）
    if (hasExcl) {
      const fx = xOf(pnlFair);
      g.strokeStyle = "#e2e8f0";
      g.setLineDash([3, 3]);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(fx, T + 10);
      g.lineTo(fx, H - B);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#e2e8f0";
      g.textAlign = fx > W - 60 ? "right" : fx < 60 ? "left" : "center";
      g.fillText(t("future.histFair"), fx, T + 8);
    }
    g.strokeStyle = "#fbbf24";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(ax, T - 2);
    g.lineTo(ax, H - B);
    g.stroke();
    g.lineWidth = 1;
    g.fillStyle = "#fbbf24";
    g.textAlign = ax > W - 60 ? "right" : ax < 60 ? "left" : "center";
    g.fillText(t("winRate.retroYou"), ax, 10);
    g.fillStyle = "#64748b";
    g.textAlign = "left";
    g.fillText(money(lo), L, H - 2);
    g.textAlign = "right";
    g.fillText(money(hi), W - R, H - 2);
  }

  // 显示顺序：先说滑块位置，紧接着说万次推演（上面那张图）里你排在哪，再拆开讲为什么、一路怎么走过来的。
  // 规则复盘之后：调整值不值（adj）→ 用过去2年评价这笔（rh，⑦）→ 规则复盘这一次vs过去2年（rh8，⑧），再说现在的处境
  const ORDER = ["now", "sim", "journey", "path", "replay", "adj", "rh", "rh8", "levels", "next"];
  const ordered = [...sections].sort(
    (a, b) => ORDER.indexOf(String((a as { key?: string }).key)) - ORDER.indexOf(String((b as { key?: string }).key)),
  );

  // ── 复盘结论框（图上方，2026-10-08）：把下面各节的结论提到最前面——是运气还是这笔本身、亏/赚在哪、你做的决定、接下来怎么做 ──
  let conclBox: ReactNode = null;
  {
    const cell = (key: string, label: string, tipId: string, body: ReactNode, cls = "") => (
      <div key={key} className={`min-w-0 border-t border-slate-800 px-3 py-1.5 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0 ${cls}`}>
        <InfoTip {...tip(tipId)}><span className="text-[10.5px] text-slate-400">{label}</span></InfoTip>
        <div className="mt-0.5 text-[11.5px] leading-snug text-slate-100">{body}</div>
      </div>
    );
    if (rankPct == null || !totals) {
      conclBox = (
        <div className="grid shrink-0 grid-cols-1 overflow-hidden rounded-md border border-slate-700 bg-slate-900/70">
          {cell("v", t("rconcl.title"), "verdict", <span className="text-slate-400">{t("future.concl.pending")}</span>)}
        </div>
      );
    } else {
      // 运气：⑦①这段行情在过去2年同类时段里罕不罕见（<15%算少见）；拿不到时按开仓时市场预期，股价走了1.5个标准差以上算少见
      const z = moveInSigma(spot, nowSpot, openIv, days);
      const rare = histSum && histSum.regPct != null ? histSum.regPct < 15 : Math.abs(z) >= 1.5;
      // 这笔本身：⑦②开仓前2年真实走法下这组期权值不值你收/付的价；拿不到时按实际波动vs开仓隐含波动率
      const ratio = since.status === "ok" && since.vol ? since.vol / openIv : null;
      const edgeGood = histSum && histSum.edgeGood != null ? histSum.edgeGood : ratio == null ? true : credit ? ratio <= 1.1 : ratio >= 0.9;
      const losing = pnlNow < -0.005;
      const kind = losing
        ? rare ? (edgeGood ? "luck" : "both") : edgeGood ? "normal" : "edge"
        : rare ? "lucky" : edgeGood ? "good" : "luckyEdge";
      const tone: Record<string, string> = { luck: "border-sky-600", both: "border-rose-600", normal: "border-slate-600", edge: "border-amber-600", lucky: "border-amber-600", good: "border-emerald-600", luckyEdge: "border-amber-600" };
      const color: Record<string, string> = { luck: "text-sky-300", both: "text-rose-300", normal: "text-slate-200", edge: "text-amber-300", lucky: "text-amber-300", good: "text-emerald-300", luckyEdge: "text-amber-200" };
      const sub = t("rconcl.sub", {
        luck: t(rare ? "rconcl.subRare" : "rconcl.subCommon"),
        edge: t(edgeGood ? "rconcl.subEdgeGood" : "rconcl.subEdgeBad"),
      });
      // 亏/赚在哪：跟总结果同方向最大的一项
      const PK = ["price", "time", "iv", "adjust"] as const;
      const partsTxt = PK.filter((k) => Math.abs(totals[k]) >= 0.005).map((k) => `${t(`som.attr_${k}`)} ${signed(totals[k])}`).join(t("future.sep"));
      const better = Math.max(0, Math.min(100, 100 - Math.round(rankPct)));
      // 你做的决定：当初的价格、调整、条件该下车没下车
      const decisions: string[] = [];
      if (histSum && histSum.fair != null && histSum.edgePct != null) {
        decisions.push(t(credit ? "rconcl.decEntryCredit" : "rconcl.decEntryDebit", {
          b: usd(basis ?? 0), f: usd(histSum.fair), p: Math.abs(histSum.edgePct).toFixed(0),
          gl: t(histSum.edgePct >= 0 ? (credit ? "rconcl.more" : "rconcl.less") : credit ? "rconcl.less" : "rconcl.more"),
        }));
      }
      if (adjInfo && Math.abs(adjInfo.diff) >= 0.005) {
        const odds = histSum?.adjOdds;
        decisions.push(
          t(adjInfo.diff >= 0 ? "rconcl.decAdjHelped" : "rconcl.decAdjHurt", { day: adjInfo.day, via: adjInfo.via, d: usd(adjInfo.diff) }) +
            (odds ? t(odds.pBeyond >= 50 ? "rconcl.decAdjOk" : "rconcl.decAdjMaybe", { p: Math.round(odds.pBeyond) }) : ""),
        );
      }
      if (exitShown && exitShown.day < days) {
        const diff = pnlNow - exitShown.pnl;
        decisions.push(t("rconcl.decRule", { d: exitShown.day, kind: t(`rconcl.kind_${exitShown.kind}`), v: money(exitShown.pnl), gl: t(diff >= 0 ? "rconcl.nowMore" : "rconcl.nowLess"), x: usd(diff) }));
      }
      // 接下来怎么做：现在的关键价位 + 以后
      let levelTxt = "";
      if (levels) {
        const be = levels.breakevens;
        if (levels.profitSide === "below") levelTxt = t("future.lvBelow", { a: be[0].toFixed(2) });
        else if (levels.profitSide === "above") levelTxt = t("future.lvAbove", { a: be[0].toFixed(2) });
        else if (levels.profitSide === "between") levelTxt = t("future.lvBetween", { a: be[0].toFixed(2), b: be[1].toFixed(2) });
        else if (levels.profitSide === "outside") levelTxt = t("future.lvOutside", { a: be[0].toFixed(2), b: be[1].toFixed(2) });
      }
      conclBox = (
        <div className={`grid shrink-0 grid-cols-1 overflow-hidden rounded-md border bg-slate-900/70 sm:grid-cols-[minmax(120px,0.85fr)_1fr_1.15fr_1.15fr] ${tone[kind]}`}>
          {cell("v", t("rconcl.title"), "verdict", (
            <>
              <span className={`block text-[16px] font-bold leading-tight ${color[kind]}`}>{t(`rconcl.k_${kind}`)}</span>
              <span className="text-[10.5px] text-slate-400">{sub}</span>
            </>
          ), "bg-slate-950/40")}
          {cell("w", t(losing ? "rconcl.whereLoss" : "rconcl.whereGain"), "where", t("rconcl.whereBody", { v: money(pnlNow), parts: partsTxt || "—", b: better, w: 100 - better }))}
          {cell("d", t("rconcl.decisions"), "decisions", decisions.length ? decisions.join(" ") : <span className="text-slate-400">{t("rconcl.decNone")}</span>)}
          {cell("n", t("future.concl.next"), "next", (
            <>
              {levelTxt && <>{t("rconcl.nowLevel", { lv: levelTxt })} </>}
              {t("rconcl.nowAdvice")} {t(`rconcl.lesson_${kind}`)}
            </>
          ))}
        </div>
      );
    }
  }

  const viewBtn = (v: "plane" | "3d", label: string) => (
    <button
      onClick={() => setView(v)}
      className={`px-2 py-0.5 text-[11px] font-semibold ${view === v ? "bg-sky-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
    >
      {label}
    </button>
  );
  const legend = (
    <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
      <span>{shown ? t("future.retroDone", { n: PATHS.toLocaleString(), iv: (openIv * 100).toFixed(1) }) : t("winRate.retroPending")}</span>
      {view === "3d" ? (
        <InfoTip {...tip("cloud3d")}><span className="inline-block h-2 w-3 rounded-sm bg-slate-100/80" />{t("future.lgRetroCloud")}</InfoTip>
      ) : (
        <>
          <InfoTip {...tip("zones")}><span className="inline-block h-2 w-3 rounded-sm bg-emerald-500/40" />{t("future.lgZoneGain")}<span className="inline-block h-2 w-3 rounded-sm bg-rose-500/50" />{t("future.lgZoneLoss")}</InfoTip>
          <InfoTip {...tip("be")}>{t("future.lgBeWhite")}</InfoTip>
          <InfoTip {...tip("bands")}><span className="inline-block h-2 w-3 rounded-sm bg-slate-400/50" />{t("future.lgBands")}</InfoTip>
        </>
      )}
      <InfoTip {...tip("actual")}><span className="inline-block h-1 w-4 rounded-sm bg-amber-400" />{t("future.lgActual")}</InfoTip>
      {exitShown && (
        <InfoTip {...tip("ruleExit")}>
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: EXIT_RGB[exitShown.kind] }} />
          {t("future.lgRuleExit")}
        </InfoTip>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto pr-1 text-[11px] text-slate-300">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-400">
        <span className="flex overflow-hidden rounded border border-slate-600">
          {viewBtn("3d", t("future.view3d"))}
          {viewBtn("plane", t("future.viewPlane"))}
        </span>
        <InfoTip {...tip("view")}>{t("future.retroIntro")}</InfoTip>
      </div>
      {conclBox}
      {/* 图的高度跟着窗口走（窗口高度的70%，至少420、最多760像素）：立体图太矮看不清；下面的卡片在右栏里往下滚 */}
      <div className="h-[clamp(420px,70vh,760px)] shrink-0 overflow-hidden rounded-md border border-slate-800">
        {view === "3d" ? (
          <SimSurface3D
            model={model}
            days={days}
            path={actual.length > 1 ? { points: actual.map((a) => ({ day: a.day, price: a.price })), exitDay: days, color: "#fbbf24", label: t("future.actualTag3d", { v: money(pnlNow) }) } : null}
            bands={shown?.bands}
            marks={exitShown ? [{ day: exitShown.day, price: exitShown.price, reason: exitShown.kind }] : []}
            scenario={null}
            endDay={days}
            labels={labels3d}
            money={(v) => `${v < -0.005 ? "−" : ""}$${Math.abs(v).toFixed(2)}`}
            notes={notes3d}
            slices={[{ day: days, label: t("future.sliceToday", { d: days }), color: "#fde68a" }]}
            todayDay={days}
          />
        ) : (
          <CanvasBox
            className="h-full w-full"
            draw={drawPlane}
            deps={[model, shown, actual.length, pnlNow, nowSpot, exitShown, days, symbol, t]}
            label={t("future.retroTitle", { s: symbol })}
          />
        )}
      </div>
      {legend}
      <HowToRead
        lines={
          view === "3d"
            ? [t("future.howRetro3d1"), t("future.howRetro3d2"), t("future.howRetro3d3"), t("future.howRetro3d4")]
            : [
                t("future.howRetroPlane1", { iv: (openIv * 100).toFixed(1), n: PATHS.toLocaleString() }),
                t("future.howRetroPlane2"),
                t("future.howRetroPlane3"),
                shown ? t("future.howRetroPlane4", { w: Math.round(100 - percentileOf(shown.sorted, 1e-9)), n: PATHS.toLocaleString() }) : t("winRate.retroPending"),
              ]
        }
      />
      <div className="shrink-0 rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 leading-relaxed">
        {error ? <span className="text-rose-300">{t("winRate.error")}</span> : <div className="flex flex-col gap-2">{ordered}</div>}
        <div className="mt-2 text-[10px] text-slate-500">{t("future.retroModel")}</div>
      </div>
    </div>
  );
}
