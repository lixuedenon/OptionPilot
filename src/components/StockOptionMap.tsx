// src/components/StockOptionMap.tsx
// "股价 vs 期权价"标签：横轴时间（开仓→最近到期日）、纵轴股价（往上是涨）、颜色是组合盈亏，
// 叠加典型股价走势线（对立走势同图，形成喇叭口），让人直接看到"股价这样走，期权组合会怎样"。
// 计算在lib/stockOptionMap.ts；这里只负责画图、子标签和鼠标读数。
import { useEffect, useMemo, useRef, useState } from "react";
import type { Leg } from "@/lib/types";
import { useI18n } from "@/i18n/I18nContext";
import { PATH_GROUPS, buildMapModel, summarizePath, type MapModel, type PathId, type HistoryPoint, type AdjustMarker, type SegmentAttribution, type PnlParts } from "@/lib/stockOptionMap";
import { quickAdvice, type QuickAdviceCtx, type AdviceAction } from "@/lib/positionAdvisor";
import { simPnlAt } from "@/lib/winRateSim";
import { priceCombo } from "@/lib/pricing";

interface Props {
  symbol: string;
  legs: Leg[];
  spot: number;
  dV: number;
  openingAt: number;
  daysSinceOpen?: number;
  emptyText?: string;
  // 当前选中的点（鼠标所指或钉住的点，鼠标离开后停在最后位置）；App据此驱动图表头部盈亏、归因和情景估值。
  onPointChange?: (p: { day: number; price: number } | null) => void;
  // 实时现价：开仓日在过去时，可以切换成"从今天、现价出发"画走势线和概率范围。
  liveSpot?: number;
  // 跟踪对比模式：左半边画开仓至今真实走过的股价（history）和展期/保护/对冲标记，
  // 右半边从今天（todayDay）、现价推演，所有盈亏都加上开仓至今的总盈亏（pnlOffset），显示总账。
  // segments/totals：今昔对比——开仓至今的盈亏逐段拆成股价/时间/波动率/调整，画在左半边底部，读数和图下方的总结都用它。
  // ruleExit：按你的止盈止损规则，真实走过的路上第一次碰到线的那一天（今昔对比，标"这里本该下车"）。
  tracked?: { todayDay: number; pnlOffset: number; history: HistoryPoint[]; markers: AdjustMarker[]; segments?: SegmentAttribution[]; totals?: PnlParts & { total: number }; ruleExit?: { day: number; price: number; pnl: number; kind: "tp" | "sl" | "time" } | null };
  // 推演未来：底部股价/时间滑块定的情景点（画蓝色菱形）；滑块一动，鼠标钉住的点就让位给滑块。
  scenario?: { day: number; price: number } | null;
  // 推演未来：风险分区和走势上的节点用的快速版持仓建议（跟左边持仓建议同一套规则）。
  zoneCtx?: QuickAdviceCtx | null;
}

type MapPoint = { day: number; price: number };
const EMIT_INTERVAL_MS = 70; // 限制向上汇报的频率，避免整个App每帧重渲染

const M = { l: 46, r: 62, t: 20, b: 34 };
const PATH_COLORS = ["#38bdf8", "#fbbf24"];
const FLAT_COLOR = "#e2e8f0";
const DAY_MS = 86400000;

const PART_KEYS = ["price", "time", "iv", "adjust"] as const;
const PART_COLORS: Record<(typeof PART_KEYS)[number], string> = { price: "#38bdf8", time: "#a3e635", iv: "#c084fc", adjust: "#fbbf24" };
const BAND_H = 46;

const ZONE_ORDER: AdviceAction[] = ["takeProfit", "holdOrTakeProfit", "hold", "holdOrStopLoss", "stopLoss"];
const ZONE_RGB: Record<AdviceAction, [number, number, number]> = {
  takeProfit: [16, 185, 129],
  holdOrTakeProfit: [74, 160, 120],
  hold: [51, 65, 85],
  holdOrStopLoss: [217, 119, 6],
  stopLoss: [225, 29, 72],
};
const COLOR_KEY = "optionpilot.mapColor";

const fmtPnlRaw = (v: number) => (Math.abs(v) < 0.005 ? "$0.00" : `${v > 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`);
const pnlColor = (v: number) => (Math.abs(v) < 0.005 ? "#cbd5e1" : v > 0 ? "#34d399" : "#fb7185");

function niceStep(span: number, target: number) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

// 盈利按最大盈利、亏损按最大亏损各自换算深浅。
function cellColor(v: number, maxProfit: number, maxLoss: number): [number, number, number] {
  if (!Number.isFinite(v)) return [15, 23, 42]; // 没有推演的区域（跟踪对比模式的"已走过"半边）
  const k = Math.sqrt(Math.min(1, v >= 0 ? v / maxProfit : -v / maxLoss));
  const base: [number, number, number] = [22, 30, 46];
  const to: [number, number, number] = v >= 0 ? [16, 185, 129] : [244, 63, 94];
  return [0, 1, 2].map((i) => Math.round(base[i] + (to[i] - base[i]) * k)) as [number, number, number];
}

export default function StockOptionMap({ symbol, legs, spot, dV, openingAt, daysSinceOpen, emptyText, onPointChange, liveSpot, tracked, scenario, zoneCtx }: Props) {
  const { t } = useI18n();
  const [colorMode, setColorMode] = useState<"pnl" | "zone">(() => {
    try {
      return localStorage.getItem(COLOR_KEY) === "zone" ? "zone" : "pnl";
    } catch {
      return "pnl";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLOR_KEY, colorMode);
    } catch {
      /* 不记住而已 */
    }
  }, [colorMode]);
  const [groupId, setGroupId] = useState(PATH_GROUPS[0].id);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [point, setPoint] = useState<MapPoint | null>(null);
  const [pinned, setPinned] = useState(false);
  const [startMode, setStartMode] = useState<"open" | "today">("open");
  const fmtPnl = (v: number) => fmtPnlRaw(v);
  const fmtVal = (v: number) => `$${Math.abs(v).toFixed(2)}`;

  // 节流汇报选中点：最多每EMIT_INTERVAL_MS一次，并保证最后一次一定送达。
  const emitRef = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null });
  const onPointChangeRef = useRef(onPointChange);
  onPointChangeRef.current = onPointChange;
  useEffect(() => {
    const st = emitRef.current;
    if (st.timer) clearTimeout(st.timer);
    const wait = Math.max(0, EMIT_INTERVAL_MS - (Date.now() - st.last));
    st.timer = setTimeout(() => {
      st.last = Date.now();
      st.timer = null;
      onPointChangeRef.current?.(point);
    }, wait);
  }, [point]);
  useEffect(() => () => {
    if (emitRef.current.timer) clearTimeout(emitRef.current.timer);
    onPointChangeRef.current?.(null);
  }, []);

  // 滑块一动：鼠标钉住/停留的点让位给滑块（否则头部盈亏和持仓建议还停在旧的点上）。
  const scenKey = scenario ? `${scenario.day}|${scenario.price.toFixed(4)}` : "";
  const prevScenKey = useRef(scenKey);
  useEffect(() => {
    if (prevScenKey.current === scenKey) return;
    prevScenKey.current = scenKey;
    setPinned(false);
    setPoint(null);
  }, [scenKey]);

  const canStartToday = !tracked && daysSinceOpen !== undefined && daysSinceOpen > 0 && liveSpot !== undefined && liveSpot > 0;
  const useToday = startMode === "today" && canStartToday;
  const todayDay = tracked ? tracked.todayDay : daysSinceOpen;
  const model = useMemo(
    () =>
      buildMapModel(
        legs,
        spot,
        dV,
        tracked
          ? { timeOffset: tracked.todayDay, pnlOffset: tracked.pnlOffset, extraPrices: tracked.history.map((h) => h.price) }
          : useToday
            ? { start: { day: daysSinceOpen!, price: liveSpot! }, extraPrices: scenario ? [scenario.price] : [] }
            : { extraPrices: scenario ? [scenario.price] : [] },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [legs, spot, dV, useToday, daysSinceOpen, liveSpot, tracked, scenario?.price],
  );
  const zoneOn = colorMode === "zone" && !!zoneCtx && !tracked;
  // 风险分区：每一格换成左边持仓建议在那一点会给的建议（快速版，不跑模拟）。
  const zoneGrid = useMemo(() => {
    if (!zoneOn || !model || !zoneCtx) return null;
    const out = new Uint8Array(model.rows * model.cols);
    for (let r = 0; r < model.rows; r++) {
      const price = model.sMax - (r / (model.rows - 1)) * (model.sMax - model.sMin);
      const exp = simPnlAt(zoneCtx.p, zoneCtx.p.horizon, price);
      for (let c = 0; c < model.cols; c++) {
        const day = (c / (model.cols - 1)) * model.horizon;
        out[r * model.cols + c] = ZONE_ORDER.indexOf(quickAdvice(zoneCtx, day, price, model.grid[r * model.cols + c], exp));
      }
    }
    return out;
  }, [zoneOn, model, zoneCtx]);
  // 选中的走势上，建议发生变化的那几天（推演未来）。
  const pathNodes = useMemo(() => {
    if (!model || !zoneCtx || tracked) return [] as { id: PathId; day: number; price: number; from: AdviceAction; to: AdviceAction }[];
    const nodes: { id: PathId; day: number; price: number; from: AdviceAction; to: AdviceAction }[] = [];
    const g = PATH_GROUPS.find((x) => x.id === groupId) ?? PATH_GROUPS[0];
    for (const id of g.paths) {
      let prev: AdviceAction | null = null;
      let n = 0;
      for (let d = Math.ceil(model.start.day); d <= Math.floor(model.horizon) && n < 3; d++) {
        const price = model.path(id, d);
        const a = quickAdvice(zoneCtx, d, price, model.pnlAt(d, price));
        if (prev && a !== prev) {
          nodes.push({ id, day: d, price, from: prev, to: a });
          n++;
        }
        prev = a;
      }
    }
    return nodes;
  }, [model, zoneCtx, tracked, groupId]);
  const group = PATH_GROUPS.find((g) => g.id === groupId) ?? PATH_GROUPS[0];
  const summaries = useMemo(
    () => (model ? group.paths.map((id) => ({ id, ...summarizePath(model, id) })) : []),
    [model, group],
  );
  // 图下方的"发现"（推演未来）：都从数字直接算，不靠模型生成文字。
  const findings = useMemo(() => {
    if (!model || !zoneCtx || tracked) return [] as string[];
    const out: string[] = [];
    const p = zoneCtx.p;
    const bes = [...zoneCtx.breakevens].filter((b) => b > spot * 0.2 && b < spot * 5).sort((a, b) => a - b);
    const winAt = (x: number) => simPnlAt(p, p.horizon, x) > 0;
    const pctFrom = (b: number) => `${b >= spot ? "+" : "−"}${Math.abs((b / spot - 1) * 100).toFixed(1)}%`;
    if (bes.length === 1) {
      const above = winAt(bes[0] * 1.01);
      out.push(t(above ? "som.findBeAbove" : "som.findBeBelow", { be: bes[0].toFixed(2), pct: pctFrom(bes[0]) }));
    } else if (bes.length >= 2) {
      const lo = bes[0], hi = bes[bes.length - 1];
      out.push(t(winAt((lo + hi) / 2) ? "som.findBeInside" : "som.findBeOutside", { lo: lo.toFixed(2), hi: hi.toFixed(2) }));
    }
    // 时间：股价不动，前1/3和最后1/3每天的盈亏
    const h = model.horizon;
    if (h >= 6) {
      const s0 = model.start.price;
      const early = (model.pnlAt(h / 3, s0) - model.pnlAt(0, s0)) / (h / 3);
      const late = (model.pnlAt(h, s0) - model.pnlAt((2 * h) / 3, s0)) / (h / 3);
      if (Math.abs(early) > 1e-4 || Math.abs(late) > 1e-4) {
        const sameSign = early * late > 0;
        const k = sameSign && Math.abs(early) > 1e-6 ? Math.abs(late / early) : 0;
        out.push(
          t(late >= 0 ? "som.findTimeGain" : "som.findTimeLoss", { a: fmtVal(early), b: fmtVal(late) }) +
            (sameSign && k >= 1.5 ? t(late >= 0 ? "som.findTimeFaster" : "som.findTimeFasterLoss", { k: k.toFixed(1) }) : ""),
        );
      }
    }
    // 隐含波动率：开仓第二天，隐含波动率降/升10个点
    const base = priceCombo(legs, { dS: 0, dT: 1, dV }, spot).change;
    const down = priceCombo(legs, { dS: 0, dT: 1, dV: dV - 10 }, spot).change - base;
    const up = priceCombo(legs, { dS: 0, dT: 1, dV: dV + 10 }, spot).change - base;
    if (Math.abs(down) > 0.005 || Math.abs(up) > 0.005) out.push(t("som.findVega", { dn: fmtPnl(down), up: fmtPnl(up) }));
    return out;
  }, [model, zoneCtx, tracked, legs, spot, dV, t]);
  const multiExpiry = new Set(legs.filter((l) => l.kind !== "stock").map((l) => l.dte)).size > 1;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pathColor = (id: PathId, i: number) => (id === "flat" ? FLAT_COLOR : PATH_COLORS[i % PATH_COLORS.length]);
  const dateLabel = (day: number) => {
    const d = new Date(openingAt + day * DAY_MS);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const pixelToPoint = (x: number, y: number): MapPoint | null => {
    if (!model) return null;
    const pw = size.w - M.l - M.r;
    const ph = size.h - M.t - M.b;
    if (x < M.l || x > M.l + pw || y < M.t || y > M.t + ph) return null;
    return {
      day: Math.round(((x - M.l) / pw) * model.horizon),
      price: model.sMax - ((y - M.t) / ph) * (model.sMax - model.sMin),
    };
  };

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !model || size.w < 50 || size.h < 50) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    draw(g, model, size.w, size.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, size, group, hover, daysSinceOpen, point, pinned, symbol, zoneGrid, pathNodes, scenario]);

  function draw(g: CanvasRenderingContext2D, m: MapModel, W: number, H: number) {
    const pw = W - M.l - M.r;
    const ph = H - M.t - M.b;
    const tx = (day: number) => M.l + (day / m.horizon) * pw;
    const ty = (p: number) => M.t + ((m.sMax - p) / (m.sMax - m.sMin)) * ph;

    // 盈亏网格先画到小画布上，再放大绘制（浏览器插值得到平滑过渡）。
    const off = document.createElement("canvas");
    off.width = m.cols;
    off.height = m.rows;
    const og = off.getContext("2d");
    if (og) {
      const img = og.createImageData(m.cols, m.rows);
      for (let i = 0; i < m.grid.length; i++) {
        const [r, gg, b] = zoneGrid ? ZONE_RGB[ZONE_ORDER[zoneGrid[i]]] : cellColor(m.grid[i], m.maxProfit, m.maxLoss);
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = gg;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = 255;
      }
      og.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(off, M.l, M.t, pw, ph);
    }

    g.font = "10px ui-sans-serif, system-ui, sans-serif";

    // 坐标轴说明：纵轴"股价"沿纵轴竖排（中文逐字上下排列，英文旋转90°），横轴=时间。股票代码在上方标题里已有，这里不重复。
    g.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
    g.fillStyle = "#e2e8f0";
    g.textAlign = "center";
    const yLabel = t("som.axisPrice");
    const midY = M.t + ph / 2;
    if (/[\u4e00-\u9fff]/.test(yLabel)) {
      const chars = ["↑", ...yLabel];
      const lineH = 14;
      const top = midY - ((chars.length - 1) * lineH) / 2;
      chars.forEach((ch, i) => g.fillText(ch, 9, top + i * lineH + 4));
    } else {
      g.save();
      g.translate(10, midY);
      g.rotate(-Math.PI / 2);
      g.fillText(`${yLabel} →`, 0, 4);
      g.restore();
    }
    g.fillText(`${t("som.axisTime")} →`, M.l + pw / 2, H - 4);
    g.font = "10px ui-sans-serif, system-ui, sans-serif";

    // 股票代码：图的上方正中间
    g.font = "bold 13px ui-sans-serif, system-ui, sans-serif";
    g.fillStyle = "#f8fafc";
    g.textAlign = "center";
    g.fillText(symbol, M.l + pw / 2, 14);
    g.font = "10px ui-sans-serif, system-ui, sans-serif";

    // 价格刻度
    g.fillStyle = "#94a3b8";
    g.textAlign = "right";
    const pStep = niceStep(m.sMax - m.sMin, 6);
    for (let p = Math.ceil(m.sMin / pStep) * pStep; p <= m.sMax; p += pStep) {
      g.fillText(p >= 100 ? p.toFixed(0) : p.toFixed(1), M.l - 5, ty(p) + 3);
    }

    // 时间刻度（日期）
    g.textAlign = "center";
    const dStep = Math.max(1, Math.round(niceStep(m.horizon, 6)));
    for (let d = 0; d <= m.horizon; d += dStep) {
      if (d !== 0 && tx(m.horizon) - tx(d) < 70) continue;
      g.fillText(d === 0 ? `${t("som.open")} ${dateLabel(0)}` : dateLabel(d), tx(d), H - 19);
    }
    g.fillText(`${t("som.expiry")} ${dateLabel(m.horizon)}`, Math.min(tx(m.horizon), W - M.r - 20), H - 19);

    // 盈亏平衡线：网格里盈亏正负交界的位置，逐列找交点、相邻列就近连起来。
    const rowPrice = (r: number) => m.sMax - (r / (m.rows - 1)) * (m.sMax - m.sMin);
    const colDay = (c: number) => (c / (m.cols - 1)) * m.horizon;
    const crossings: number[][] = [];
    for (let c = 0; c < m.cols; c++) {
      const list: number[] = [];
      for (let r = 0; r < m.rows - 1; r++) {
        const a0 = m.grid[r * m.cols + c];
        const a1 = m.grid[(r + 1) * m.cols + c];
        if ((a0 >= 0) !== (a1 >= 0)) {
          const f = a0 / (a0 - a1);
          list.push(rowPrice(r) + (rowPrice(r + 1) - rowPrice(r)) * f);
        }
      }
      crossings.push(list);
    }
    const maxJump = ((m.sMax - m.sMin) / (m.rows - 1)) * 4;
    g.strokeStyle = "rgba(248,250,252,0.9)";
    g.lineWidth = 1.5;
    g.setLineDash([5, 3]);
    g.beginPath();
    let labelAt: { x: number; y: number } | null = null;
    for (let c = 0; c < m.cols - 1; c++) {
      for (const p0 of crossings[c]) {
        let best: number | null = null;
        for (const p1 of crossings[c + 1]) if (best === null || Math.abs(p1 - p0) < Math.abs(best - p0)) best = p1;
        if (best === null || Math.abs(best - p0) > maxJump) continue;
        g.moveTo(tx(colDay(c)), ty(p0));
        g.lineTo(tx(colDay(c + 1)), ty(best));
        if (c === Math.floor(m.cols * 0.82)) labelAt = { x: tx(colDay(c)), y: ty(p0) };
      }
    }
    g.stroke();
    g.setLineDash([]);
    if (labelAt) {
      g.font = "bold 10px ui-sans-serif, system-ui, sans-serif";
      g.fillStyle = "#f8fafc";
      g.textAlign = "center";
      g.fillText(t("som.breakeven"), labelAt.x, labelAt.y - 5);
      g.font = "10px ui-sans-serif, system-ui, sans-serif";
    }

    // 概率范围（按隐含波动率的±1σ、±2σ），从走势起点展开成喇叭口
    for (const k of [1, 2]) {
      g.strokeStyle = k === 1 ? "rgba(196,181,253,0.8)" : "rgba(196,181,253,0.45)";
      g.lineWidth = 1;
      g.setLineDash(k === 1 ? [6, 3] : [2, 4]);
      for (const side of [0, 1] as const) {
        // 超出图的价格范围就断开，不贴着边框画。
        g.beginPath();
        let drawing = false;
        for (let s2 = 0; s2 <= 60; s2++) {
          const day = m.start.day + (s2 / 60) * (m.horizon - m.start.day);
          const pr = m.cone(k, day)[side];
          if (pr < m.sMin || pr > m.sMax) {
            drawing = false;
            continue;
          }
          if (!drawing) g.moveTo(tx(day), ty(pr));
          else g.lineTo(tx(day), ty(pr));
          drawing = true;
        }
        g.stroke();
      }
      g.setLineDash([]);
      const [lo, hi] = m.cone(k, m.horizon);
      g.fillStyle = k === 1 ? "#c4b5fd" : "rgba(196,181,253,0.7)";
      g.textAlign = "right";
      if (hi <= m.sMax) g.fillText(`+${k}σ`, M.l + pw - 3, ty(hi) - 3);
      if (lo >= m.sMin) g.fillText(`−${k}σ`, M.l + pw - 3, ty(lo) + 11);
    }

    // 行权价横线：接近开仓价白色，高于开仓价绿色，低于红色
    g.setLineDash([4, 3]);
    g.lineWidth = 1;
    g.textAlign = "left";
    for (const k of m.strikes) {
      if (k < m.sMin || k > m.sMax) continue;
      const c = Math.abs(k - spot) / spot < 0.005 ? "#f8fafc" : k > spot ? "#34d399" : "#f87171";
      g.strokeStyle = c;
      g.globalAlpha = 0.7;
      g.beginPath();
      g.moveTo(M.l, ty(k));
      g.lineTo(M.l + pw, ty(k));
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = c;
      g.fillText(String(k), M.l + 3, ty(k) - 3);
    }

    // 今天
    if (todayDay !== undefined && todayDay > 0 && todayDay < m.horizon) {
      g.strokeStyle = "#94a3b8";
      g.beginPath();
      g.moveTo(tx(todayDay), M.t);
      g.lineTo(tx(todayDay), M.t + ph);
      g.stroke();
      g.fillStyle = "#cbd5e1";
      g.textAlign = "center";
      g.fillText(t("som.today"), tx(todayDay), M.t + 10);
    }
    g.setLineDash([]);

    // 跟踪对比模式：左半边标题、展期/保护/对冲标记、真实走过的股价线（快照点按当时总盈亏上色）
    if (tracked) {
      g.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
      g.textAlign = "center";
      g.fillStyle = "#cbd5e1";
      if (tracked.todayDay > 0) g.fillText(t("som.pastTitle"), tx(tracked.todayDay / 2), M.t + 24);
      g.fillText(t("som.futureTitle"), tx((tracked.todayDay + m.horizon) / 2), M.t + 24);
      g.font = "10px ui-sans-serif, system-ui, sans-serif";
      g.setLineDash([3, 3]);
      g.strokeStyle = "#f59e0b";
      g.lineWidth = 1;
      for (const mk of tracked.markers) {
        g.beginPath();
        g.moveTo(tx(mk.day), M.t);
        g.lineTo(tx(mk.day), M.t + ph);
        g.stroke();
        g.fillStyle = "#fbbf24";
        g.textAlign = "left";
        g.fillText(t(`som.adjust.${mk.via}`), tx(mk.day) + 3, M.t + ph - (tracked.segments?.length ? BAND_H + 6 : 4));
      }
      g.setLineDash([]);
      const pts = [...tracked.history, { day: tracked.todayDay, price: spot, pnl: tracked.pnlOffset }];
      g.beginPath();
      pts.forEach((h, i) => (i === 0 ? g.moveTo(tx(h.day), ty(h.price)) : g.lineTo(tx(h.day), ty(h.price))));
      g.strokeStyle = "#020617";
      g.lineWidth = 5;
      g.stroke();
      g.strokeStyle = "#f8fafc";
      g.lineWidth = 2.5;
      g.stroke();
      for (const h of tracked.history.slice(1)) {
        g.fillStyle = pnlColor(h.pnl);
        g.beginPath();
        g.arc(tx(h.day), ty(h.price), h.estimated ? 2.5 : 4.5, 0, Math.PI * 2);
        g.fill();
      }
      // 盈亏拆解条：每一段一根柱，正的部分往上叠、负的往下叠，颜色=股价/时间/波动率/调整。
      const segs = tracked.segments ?? [];
      if (segs.length && tracked.todayDay > 0) {
        const bx0 = M.l;
        const bx1 = tx(tracked.todayDay);
        const by0 = M.t + ph - BAND_H;
        const mid = by0 + BAND_H / 2 + 4;
        g.fillStyle = "rgba(2,6,23,0.8)";
        g.fillRect(bx0, by0, bx1 - bx0, BAND_H);
        g.strokeStyle = "#475569";
        g.beginPath();
        g.moveTo(bx0, mid);
        g.lineTo(bx1, mid);
        g.stroke();
        g.fillStyle = "#94a3b8";
        g.textAlign = "left";
        g.fillText(t("som.attrBand"), bx0 + 4, by0 + 10);
        let maxStack = 1e-9;
        for (const sg of segs) {
          let up = 0;
          let dn = 0;
          for (const k of PART_KEYS) {
            if (sg[k] > 0) up += sg[k];
            else dn -= sg[k];
          }
          maxStack = Math.max(maxStack, up, dn);
        }
        const half = BAND_H / 2 - 6;
        for (const sg of segs) {
          const x0 = tx(sg.fromDay);
          const x1 = tx(sg.toDay);
          const w = Math.max(2, Math.min(18, (x1 - x0) * 0.7));
          const cx = (x0 + x1) / 2;
          let up = 0;
          let dn = 0;
          g.globalAlpha = sg.estimated ? 0.6 : 1;
          for (const k of PART_KEYS) {
            const v = sg[k];
            if (Math.abs(v) < 1e-9) continue;
            const h = (Math.abs(v) / maxStack) * half;
            g.fillStyle = PART_COLORS[k];
            if (v > 0) {
              g.fillRect(cx - w / 2, mid - up - h, w, h);
              up += h;
            } else {
              g.fillRect(cx - w / 2, mid + dn, w, h);
              dn += h;
            }
          }
          g.globalAlpha = 1;
        }
      }
    }

    // 走势线 + 终点盈亏标签
    group.paths.forEach((id, i) => {
      const color = pathColor(id, i);
      const steps = 80;
      g.beginPath();
      for (let s = 0; s <= steps; s++) {
        const day = m.start.day + (s / steps) * (m.horizon - m.start.day);
        const x = tx(day);
        const y = ty(m.path(id, day));
        if (s === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = "#020617";
      g.lineWidth = 4.5;
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = 2.2;
      g.stroke();

      const endY = Math.max(M.t + 8, Math.min(M.t + ph - 4, ty(m.path(id, m.horizon))));
      const endV = m.pnlAt(m.horizon, m.path(id, m.horizon));
      const label = fmtPnl(endV);
      g.font = "bold 10px ui-sans-serif, system-ui, sans-serif";
      const tw = g.measureText(label).width;
      const bx = M.l + pw + 4;
      g.fillStyle = "#0f172a";
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.fillRect(bx, endY - 8, tw + 8, 15);
      g.strokeRect(bx, endY - 8, tw + 8, 15);
      g.fillStyle = pnlColor(endV);
      g.textAlign = "left";
      g.fillText(label, bx + 4, endY + 3);
      g.font = "10px ui-sans-serif, system-ui, sans-serif";
    });

    // 走势上建议变化的节点：圆点颜色=变成什么建议，旁边写"第N天 →建议"
    pathNodes.forEach((nd, i) => {
      const x = tx(nd.day), y = ty(nd.price);
      const [r, gg, b] = ZONE_RGB[nd.to];
      g.fillStyle = "#020617";
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = `rgb(${Math.min(255, r + 40)},${Math.min(255, gg + 40)},${Math.min(255, b + 40)})`;
      g.beginPath();
      g.arc(x, y, 4.5, 0, Math.PI * 2);
      g.fill();
      const lbl = t("som.node", { d: nd.day, a: t(`advice.act.${nd.to}`) });
      g.font = "bold 10px ui-sans-serif, system-ui, sans-serif";
      const lw = g.measureText(lbl).width;
      const lx = Math.min(M.l + pw - lw - 6, Math.max(M.l + 2, x - lw / 2));
      const ly = i % 2 === 0 ? y - 12 : y + 18;
      g.fillStyle = "rgba(2,6,23,0.85)";
      g.fillRect(lx - 3, ly - 10, lw + 6, 14);
      g.fillStyle = "#f8fafc";
      g.textAlign = "left";
      g.fillText(lbl, lx, ly);
      g.font = "10px ui-sans-serif, system-ui, sans-serif";
    });

    // 跟踪对比：按规则本该下车的那一天
    if (tracked?.ruleExit) {
      const re = tracked.ruleExit;
      const x = tx(re.day), y = ty(re.price);
      g.strokeStyle = re.kind === "tp" ? "#34d399" : re.kind === "sl" ? "#fb7185" : "#fbbf24";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.stroke();
      const lbl = t(re.kind === "tp" ? "som.ruleExitTp" : re.kind === "sl" ? "som.ruleExitSl" : "som.ruleExitTime", { d: re.day, v: fmtPnl(re.pnl) });
      g.font = "bold 10px ui-sans-serif, system-ui, sans-serif";
      const lw = g.measureText(lbl).width;
      const lx = Math.min(M.l + pw - lw - 6, Math.max(M.l + 2, x - lw / 2));
      g.fillStyle = "rgba(2,6,23,0.88)";
      g.fillRect(lx - 3, y - 26, lw + 6, 14);
      g.fillStyle = re.kind === "tp" ? "#6ee7b7" : re.kind === "sl" ? "#fda4af" : "#fcd34d";
      g.textAlign = "left";
      g.fillText(lbl, lx, y - 16);
      g.font = "10px ui-sans-serif, system-ui, sans-serif";
      g.lineWidth = 1;
    }

    // 推演未来：滑块定的情景点
    if (scenario && !tracked && scenario.day <= m.horizon) {
      const x = tx(scenario.day), y = ty(scenario.price);
      g.fillStyle = "#0ea5e9";
      g.strokeStyle = "#f8fafc";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, y - 7);
      g.lineTo(x + 7, y);
      g.lineTo(x, y + 7);
      g.lineTo(x - 7, y);
      g.closePath();
      g.fill();
      g.stroke();
      g.lineWidth = 1;
    }

    // 起点（跟踪对比模式是"今天"：标出开仓至今的总盈亏）
    g.fillStyle = "#f8fafc";
    g.beginPath();
    g.arc(tx(m.start.day), ty(m.start.price), tracked ? 5 : 3.5, 0, Math.PI * 2);
    g.fill();
    if (tracked) {
      // 深色底框，避免文字压在红/绿背景上看不清
      g.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
      g.textAlign = "left";
      const lbl = `${t("som.totalNow")} ${fmtPnl(tracked.pnlOffset)}`;
      const lw = g.measureText(lbl).width;
      const lx = tx(m.start.day) + 8;
      const ly = ty(m.start.price) - 22;
      g.fillStyle = "rgba(2,6,23,0.88)";
      g.fillRect(lx - 4, ly, lw + 8, 16);
      g.strokeStyle = "#475569";
      g.lineWidth = 1;
      g.strokeRect(lx - 4, ly, lw + 8, 16);
      g.fillStyle = pnlColor(tracked.pnlOffset);
      g.fillText(lbl, lx, ly + 12);
      g.font = "10px ui-sans-serif, system-ui, sans-serif";
    }

    // 选中点标记：钉住时琥珀色；未钉住且鼠标不在图上时（停在最后位置）白色
    const hoverInside = hover && hover.x >= M.l && hover.x <= M.l + pw && hover.y >= M.t && hover.y <= M.t + ph;
    if (point && (pinned || !hoverInside)) {
      const px = tx(Math.min(point.day, m.horizon));
      const py = ty(point.price);
      const c = pinned ? "#fbbf24" : "#f8fafc";
      g.setLineDash([2, 3]);
      g.strokeStyle = pinned ? "rgba(251,191,36,0.6)" : "rgba(248,250,252,0.4)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px, M.t);
      g.lineTo(px, M.t + ph);
      g.moveTo(M.l, py);
      g.lineTo(M.l + pw, py);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#020617";
      g.beginPath();
      g.arc(px, py, 6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = c;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(px, py, 5, 0, Math.PI * 2);
      g.stroke();
    }

    // 鼠标十字线 + 读数
    if (hover && hover.x >= M.l && hover.x <= M.l + pw && hover.y >= M.t && hover.y <= M.t + ph) {
      const day = Math.round(((hover.x - M.l) / pw) * m.horizon);
      const price = m.sMax - ((hover.y - M.t) / ph) * (m.sMax - m.sMin);
      const v = m.pnlAt(day, price);
      const inPast = !!tracked && day < tracked.todayDay;
      g.strokeStyle = "rgba(226,232,240,0.5)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(hover.x, M.t);
      g.lineTo(hover.x, M.t + ph);
      g.moveTo(M.l, hover.y);
      g.lineTo(M.l + pw, hover.y);
      g.stroke();
      // 读数：日期、股价、组合盈亏、组合净值、每条腿的价值（每股计，跟"盈亏图"标签口径一致）。
      // 跟踪对比模式"已走过"半边：显示离鼠标最近的那条真实快照（当天股价和当时的总盈亏）。
      const near = inPast && tracked
        ? tracked.history.reduce((a, b) => (Math.abs(b.day - day) < Math.abs(a.day - day) ? b : a))
        : null;
      const legVals = m.legValuesAt(day, price);
      const net = legVals.reduce((a, b) => a + b, 0);
      const seg = inPast && tracked?.segments ? tracked.segments.find((sg) => day > sg.fromDay - 1e-9 && day <= sg.toDay + 1e-9 && sg.toDay > sg.fromDay) : undefined;
      const segLines: { text: string; color: string }[] = seg ? [
        { text: `${dateLabel(seg.fromDay)} → ${dateLabel(seg.toDay)}  ${t("som.attrChange")} ${fmtPnl(seg.total)}`, color: pnlColor(seg.total) },
        ...PART_KEYS.map((k) => ({ text: `  ${t(`som.attr_${k}`)} ${fmtPnl(seg[k])}`, color: PART_COLORS[k] })),
        ...(seg.estimated ? [{ text: t("som.attrSegEst"), color: "#94a3b8" }] : []),
      ] : [];
      const lines: { text: string; color: string }[] = near ? [
        { text: `${dateLabel(near.day)} · ${t("som.day", { n: near.day })}${near.estimated ? ` · ${t("som.estimated")}` : ""}`, color: "#e2e8f0" },
        { text: `${t("som.tipPrice")} ${near.price.toFixed(2)}`, color: "#e2e8f0" },
        { text: `${t("som.tipTotal")} ${fmtPnl(near.pnl)}`, color: pnlColor(near.pnl) },
        ...segLines,
      ] : [
        { text: `${dateLabel(day)} · ${t("som.day", { n: day })}`, color: "#e2e8f0" },
        { text: `${t("som.tipPrice")} ${price.toFixed(2)}`, color: "#e2e8f0" },
        { text: `${tracked ? t("som.tipTotal") : t("som.tipPnl")} ${fmtPnl(v)}`, color: pnlColor(v) },
        { text: `${t("som.tipNet")} ${net >= 0 ? t("chart.netReceive") : t("chart.netPay")} ${fmtVal(net)}`, color: "#e2e8f0" },
        ...legs.map((l, i) => {
          const act = l.action === "buy" ? t("saveStrategy.buy") : t("saveStrategy.sell");
          const kind = l.kind === "stock" ? t("som.stockLeg") : `${l.type === "call" ? "C" : "P"}${l.strike}`;
          const qty = l.kind !== "stock" && (l.qty ?? 1) > 1 ? ` ×${l.qty}` : "";
          const val = l.kind === "stock" ? fmtPnl(legVals[i]) : fmtVal(legVals[i]);
          return { text: `  ${act} ${kind}${qty}  ${val}`, color: l.action === "buy" ? "#6ee7b7" : "#fda4af" };
        }),
      ];
      g.font = "11px ui-sans-serif, system-ui, sans-serif";
      const bw = Math.max(...lines.map((ln) => g.measureText(ln.text).width)) + 12;
      const bh = lines.length * 13 + 6;
      const bx = hover.x + 12 + bw > M.l + pw ? hover.x - 12 - bw : hover.x + 12;
      const by = Math.min(Math.max(M.t, hover.y - bh / 2), M.t + ph - bh);
      g.fillStyle = "rgba(2,6,23,0.92)";
      g.fillRect(bx, by, bw, bh);
      g.strokeStyle = "#475569";
      g.strokeRect(bx, by, bw, bh);
      g.textAlign = "left";
      lines.forEach((ln, i) => {
        g.fillStyle = ln.color;
        g.fillText(ln.text, bx + 6, by + 14 + i * 13);
        if (i === (near ? 2 : 3)) {
          g.strokeStyle = "#334155";
          g.beginPath();
          g.moveTo(bx + 4, by + 17 + i * 13);
          g.lineTo(bx + bw - 4, by + 17 + i * 13);
          g.stroke();
        }
      });
    }
  }

  if (!model) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">{emptyText}</div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {PATH_GROUPS.map((gr) => (
          <button
            key={gr.id}
            onClick={() => setGroupId(gr.id)}
            className={`rounded border px-2 py-0.5 text-[11px] font-semibold transition ${
              gr.id === group.id
                ? "border-sky-500/60 bg-sky-500/15 text-sky-300"
                : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-200"
            }`}
          >
            {t(`som.group.${gr.id}`)}
          </button>
        ))}
        {canStartToday && (
          <span className="ml-2 flex items-center gap-0.5 rounded border border-slate-700 p-0.5 text-[10px]">
            {(["open", "today"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setStartMode(mode)}
                className={`rounded px-1.5 py-0.5 font-semibold ${
                  (mode === "today") === useToday ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t(mode === "open" ? "som.startOpen" : "som.startToday")}
              </button>
            ))}
          </span>
        )}
        {zoneCtx && !tracked && (
          <span className="ml-2 flex items-center gap-0.5 rounded border border-slate-700 p-0.5 text-[10px]">
            {(["pnl", "zone"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setColorMode(mode)}
                className={`rounded px-1.5 py-0.5 font-semibold ${colorMode === mode ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
              >
                {t(mode === "pnl" ? "som.colorPnl" : "som.colorZone")}
              </button>
            ))}
          </span>
        )}
        <span className="ml-auto text-[10px] text-slate-500">
          {t("som.moveNote", { pct: ((model.move / model.start.price) * 100).toFixed(1) })}
          {multiExpiry && ` · ${t("som.multiExpiryNote")}`}
        </span>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-crosshair"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - r.left;
            const y = e.clientY - r.top;
            setHover({ x, y });
            if (!pinned) {
              const p = pixelToPoint(x, y);
              if (p) setPoint(p);
            }
          }}
          // 鼠标离开后选中点停在最后位置（不清空）。
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            // 点一下钉住这个点，再点一下取消钉住（并跟随鼠标）。
            const r = e.currentTarget.getBoundingClientRect();
            const p = pixelToPoint(e.clientX - r.left, e.clientY - r.top);
            if (pinned) {
              setPinned(false);
              if (p) setPoint(p);
            } else if (p) {
              setPoint(p);
              setPinned(true);
            }
          }}
        />
      </div>
      {tracked?.totals && tracked.segments && tracked.segments.length > 0 && (() => {
        const tot = tracked.totals;
        // "为什么是今天这样"：跟总结果同方向、贡献最大的那一项；反方向更大的一项算"抵消了一部分"。
        const sameSign = PART_KEYS.filter((k) => tot[k] * tot.total > 0);
        const main = sameSign.length ? sameSign.reduce((a, b) => (Math.abs(tot[b]) > Math.abs(tot[a]) ? b : a)) : null;
        const opp = PART_KEYS.filter((k) => tot[k] * tot.total < 0).sort((a, b) => Math.abs(tot[b]) - Math.abs(tot[a]))[0];
        return (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
            <span className="font-semibold text-slate-200">
              {t("som.attrTitle")} <span className="tabular-nums" style={{ color: pnlColor(tot.total) }}>{fmtPnl(tot.total)}</span> =
            </span>
            {PART_KEYS.map((k) => (
              <span key={k} className="flex items-center gap-1 text-slate-400">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: PART_COLORS[k] }} />
                {t(`som.attr_${k}`)} <span className="tabular-nums" style={{ color: pnlColor(tot[k]) }}>{fmtPnl(tot[k])}</span>
              </span>
            ))}
            {main && Math.abs(tot.total) > 0.005 && (
              <span className="font-semibold text-amber-200">
                {t(tot.total > 0 ? "som.attrMainGain" : "som.attrMainLoss", { name: t(`som.attr_${main}`) })}
                {opp && Math.abs(tot[opp]) > 0.005 && t("som.attrOffset", { name: t(`som.attr_${opp}`), v: fmtPnl(tot[opp]) })}
              </span>
            )}
          </div>
        );
      })()}
      {zoneOn && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
          {ZONE_ORDER.map((a) => (
            <span key={a} className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: `rgb(${ZONE_RGB[a].join(",")})` }} />
              {t(`advice.act.${a}`)}
            </span>
          ))}
          <span className="text-slate-500">{t("som.zoneHint")}</span>
        </div>
      )}
      <div className="text-[10px] text-slate-500">
        {tracked
          ? t("som.trackedHint")
          : pinned && point
            ? <span className="text-amber-300">{t("som.pinned", { date: dateLabel(point.day), price: point.price.toFixed(2) })}</span>
            : t("som.pinHint")}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
        {summaries.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1.5 text-slate-400">
            <span className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: pathColor(s.id, i) }} />
            <span className="font-semibold text-slate-200">{t(`som.path.${s.id}`)}</span>
            <span>{t("som.end")}</span>
            <span className="font-semibold tabular-nums" style={{ color: pnlColor(s.end) }}>{fmtPnl(s.end)}</span>
            <span className="text-slate-500">
              · {t("som.best")} <span className="tabular-nums" style={{ color: pnlColor(s.best) }}>{fmtPnl(s.best)}</span>
              {" "}· {t("som.worst")} <span className="tabular-nums" style={{ color: pnlColor(s.worst) }}>{fmtPnl(s.worst)}</span>
            </span>
          </span>
        ))}
      </div>
      {findings.length > 0 && (
        <div className="rounded-md border border-slate-800 bg-slate-900/50 px-2 py-1 text-[11px] leading-relaxed text-slate-300">
          <span className="mr-1 font-semibold text-sky-300">{t("som.findTitle")}</span>
          {findings.map((f, i) => (
            <div key={i}>· {f}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// 今昔对比时这个标签下只保留隐含波动率滑块（时间和股价已经体现在图上）。baseIv是开仓时各期权腿IV的平均值（小数）。
export function IvShiftSlider({ value, onChange, baseIv, baseIsToday }: { value: number; onChange: (v: number) => void; baseIv: number | null; baseIsToday?: boolean }) {
  const { t } = useI18n();
  const pct = ((value + 100) / 200) * 100;
  const basePct = baseIv !== null ? baseIv * 100 : null;
  const nowPct = basePct !== null ? Math.max(1, basePct + value) : null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[13px] font-bold text-sky-400">{t("som.ivTitle")}</span>
        {value !== 0 && (
          <button
            onClick={() => onChange(0)}
            className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
          >
            {t("som.ivReset")}
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="w-28 shrink-0 text-[10px] text-slate-400">
          {t(baseIsToday ? "som.ivBaseToday" : "som.ivBase")} <span className="font-bold tabular-nums text-slate-200">{basePct !== null ? `${basePct.toFixed(1)}%` : "—"}</span>
        </span>
        <input
          type="range"
          min={-100}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="slider-range w-full"
          style={{ background: `linear-gradient(to right, #a78bfa ${pct}%, rgb(51 65 85) ${pct}%)` }}
        />
        <span className="w-36 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
          {nowPct !== null && <span className="font-bold text-violet-300">{nowPct.toFixed(1)}%</span>}
          <span className="ml-1">({`${value >= 0 ? "+" : ""}${value.toFixed(0)}`})</span>
        </span>
      </div>
      <div className="mt-0.5 text-[10px] text-slate-500">{t("som.ivHint")}</div>
    </div>
  );
}
