// src/components/SimSurface3D.tsx
// 万次推演的"立体"视图：时间×股价×盈亏的曲面（高度=盈亏，颜色=赚/亏），随机走势像光束一样沿曲面流过，
// 走得多的地方曲面发亮；下车点、情景点、从情景点分出的蓝色云都画在曲面上。拖动旋转，双击复位。
// 用canvas 2D自己投影+画家算法画，不引三维库（不增加打包体积）。跟平面视图读同一份数据，三个滑块变了一起变。
import { useEffect, useMemo, useRef } from "react";
import type { MapModel } from "@/lib/stockOptionMap";
import { rowOf, type ExitPoint } from "@/lib/futureSim";
import type { ExitReason } from "@/lib/winRateSim";

export interface Sample3D {
  prices: number[];
  reason: ExitReason;
  exitDay: number;
}

interface Props {
  model: MapModel;
  days: number;
  rows: number; // 密度网格的价格格数
  density: Float32Array | null; // 还拿着的走势经过的次数，(days+1)×rows
  forkDensity: Float32Array | null;
  forkStartDay: number;
  samples: Sample3D[];
  forkSamples: Sample3D[];
  exits: ExitPoint[];
  scenario: { day: number; price: number } | null;
  endDay: number;
  // time=横轴标题；legend=左上角的三行说明（高度/横向/纵深各代表什么）
  labels: { open: string; expiry: string; close: string; price: string; pnl: string; hint: string; time: string; legend: string[]; today?: string };
  money: (v: number) => string;
  // 今昔对比回看：真实走过的路（金色粗线），走势光束只画到今天。
  actual?: { day: number; price: number }[];
  todayDay?: number;
}

const REASON_RGB: Record<ExitReason, string> = { tp: "52,211,153", sl: "251,113,133", time: "251,191,36", expiry: "56,189,248" };
const DEFAULT_VIEW = { yaw: -0.72, pitch: 0.6 };
const NY = 46;

type V3 = [number, number, number];

function baseColor(v: number, maxProfit: number, maxLoss: number): V3 {
  const k = Math.sqrt(Math.min(1, v >= 0 ? v / maxProfit : -v / maxLoss));
  const from: V3 = [30, 41, 59];
  const to: V3 = v >= 0 ? [16, 185, 129] : [244, 63, 94];
  return [0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * k) as V3;
}

// 每天按当天的最大值归一：越往后走势越散，按整体最大值归一的话后半段几乎看不见。
function columnMax(d: Float32Array | null, days: number, rows: number): Float32Array | null {
  if (!d) return null;
  const m = new Float32Array(days + 1);
  for (let day = 0; day <= days; day++) {
    let mx = 0;
    for (let r = 0; r < rows; r++) mx = Math.max(mx, d[day * rows + r]);
    m[day] = mx;
  }
  if (days >= 1) m[0] = Math.max(m[0], m[1]);
  return m;
}

export default function SimSurface3D(props: Props) {
  const { model, days, rows, density, forkDensity, forkStartDay, samples, forkSamples, exits, scenario, endDay, labels, money, actual, todayDay } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ ...DEFAULT_VIEW });
  const size = useRef({ w: 0, h: 0 });
  const raf = useRef(0);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const zScale = Math.max(model.maxProfit, model.maxLoss) || 1;
  const X = (day: number) => -1 + (2 * day) / Math.max(1, days);
  const Y = (price: number) => -1 + (2 * (price - model.sMin)) / (model.sMax - model.sMin);
  const Z = (pnl: number) => (Math.max(-zScale, Math.min(zScale, pnl)) / zScale) * 0.9;

  // 曲面网格（随模型/滑块变化重算）
  const surface = useMemo(() => {
    const NX = Math.min(64, Math.max(8, days)) + 1;
    const pts: { day: number; price: number; pnl: number }[][] = [];
    for (let i = 0; i < NX; i++) {
      const day = (i / (NX - 1)) * days;
      const col: { day: number; price: number; pnl: number }[] = [];
      for (let j = 0; j < NY; j++) {
        const price = model.sMin + (j / (NY - 1)) * (model.sMax - model.sMin);
        col.push({ day, price, pnl: model.pnlAt(day, price) });
      }
      pts.push(col);
    }
    let lo = Infinity, hi = -Infinity;
    for (const col of pts) for (const c of col) {
      lo = Math.min(lo, c.pnl);
      hi = Math.max(hi, c.pnl);
    }
    return { NX, pts, lo, hi };
  }, [model, days]);

  const colMax = useMemo(() => columnMax(density, days, rows), [density, days, rows]);
  const forkColMax = useMemo(() => columnMax(forkDensity, days, rows), [forkDensity, days, rows]);

  // 走势光束的三维点（盈亏按曲面同一个模型算，光束贴着曲面走）
  const beams = useMemo(() => {
    const mk = (s: Sample3D, offset: number) =>
      s.prices.map((price, k) => {
        const day = k + offset;
        return { day, price, pnl: model.pnlAt(day, price) };
      });
    return {
      main: samples.slice(0, 40).map((s) => ({ s, pts: mk(s, 0) })),
      fork: forkSamples.slice(0, 30).map((s) => ({ s, pts: mk(s, forkStartDay) })),
    };
  }, [samples, forkSamples, forkStartDay, model]);

  const draw = () => {
    const cv = cvRef.current;
    const { w: W, h: H } = size.current;
    if (!cv || W < 40 || H < 40) return;
    const g = cv.getContext("2d");
    if (!g) return;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#020617";
    g.fillRect(0, 0, W, H);

    const { yaw, pitch } = view.current;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // 地板贴着曲面最低处，盒子只包住曲面真正占的高度，图才不会缩在一角。
    const FLOOR = Z(surface.lo) - 0.12;
    const TOP = Z(surface.hi) + 0.14;
    const raw = (x: number, y: number, z: number) => {
      const x1 = x * cy - y * sy;
      const y1 = x * sy + y * cy;
      const u = z * cp + y1 * sp;
      const depth = y1 * cp - z * sp;
      const f = 1 / (1 + 0.14 * depth);
      return { x: x1 * f, y: -u * f, depth };
    };
    // 每次按当前角度把整个盒子（地板+最高最低点）缩放、居中到画布里，转到哪个角度都不出界。
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const x of [-1.15, 1.1]) for (const y of [-1, 1]) for (const z of [FLOOR, TOP]) {
      const r = raw(x, y, z);
      bx0 = Math.min(bx0, r.x); bx1 = Math.max(bx1, r.x); by0 = Math.min(by0, r.y); by1 = Math.max(by1, r.y);
    }
    const padX = 48, padTop = 16, padBottom = 26;
    const S = Math.min((W - 2 * padX) / (bx1 - bx0), (H - padTop - padBottom) / (by1 - by0));
    const ox = padX + ((W - 2 * padX) - (bx1 - bx0) * S) / 2 - bx0 * S;
    const oy = padTop + ((H - padTop - padBottom) - (by1 - by0) * S) / 2 - by0 * S;
    const proj = (x: number, y: number, z: number) => {
      const r = raw(x, y, z);
      return { sx: ox + r.x * S, sy: oy + r.y * S, depth: r.depth };
    };
    const line = (a: V3, b: V3, style: string, width = 1, dash: number[] = []) => {
      const p = proj(...a), q = proj(...b);
      g.strokeStyle = style;
      g.lineWidth = width;
      g.setLineDash(dash);
      g.beginPath();
      g.moveTo(p.sx, p.sy);
      g.lineTo(q.sx, q.sy);
      g.stroke();
      g.setLineDash([]);
    };
    const text = (x: number, y: number, z: number, s: string, color = "#94a3b8", align: CanvasTextAlign = "center", dy = 0) => {
      const p = proj(x, y, z);
      g.fillStyle = color;
      g.textAlign = align;
      g.fillText(s, p.sx, p.sy + dy);
    };

    // 地板：边框+几条价格/时间网格线
    g.font = "10px sans-serif";
    for (let k = 0; k <= 4; k++) {
      const v = -1 + k * 0.5;
      line([-1, v, FLOOR], [1, v, FLOOR], "rgba(71,85,105,0.35)");
      line([v, -1, FLOOR], [v, 1, FLOOR], "rgba(71,85,105,0.35)");
    }
    if (endDay < days) line([X(endDay), -1, FLOOR], [X(endDay), 1, FLOOR], "rgba(251,191,36,0.6)", 1, [3, 3]);

    // 曲面：远处先画，近处后画（画家算法）
    const { NX, pts } = surface;
    const L: V3 = [-0.35, -0.55, 0.76];
    const quads: { depth: number; i: number; j: number }[] = [];
    const P = pts.map((col) => col.map((c) => proj(X(c.day), Y(c.price), Z(c.pnl))));
    for (let i = 0; i < NX - 1; i++)
      for (let j = 0; j < NY - 1; j++) quads.push({ i, j, depth: (P[i][j].depth + P[i + 1][j].depth + P[i + 1][j + 1].depth + P[i][j + 1].depth) / 4 });
    quads.sort((a, b) => b.depth - a.depth);
    const glow = (dens: Float32Array | null, cmax: Float32Array | null, day: number, price: number) => {
      if (!dens || !cmax) return 0;
      const d = Math.min(days, Math.max(0, Math.round(day)));
      const v = dens[d * rows + rowOf({ sMin: model.sMin, sMax: model.sMax, rows, days }, price)];
      return cmax[d] > 0 ? Math.sqrt(v / cmax[d]) : 0;
    };
    for (const { i, j } of quads) {
      const a = pts[i][j], b = pts[i + 1][j], c = pts[i + 1][j + 1], d = pts[i][j + 1];
      const wa: V3 = [X(a.day), Y(a.price), Z(a.pnl)], wb: V3 = [X(b.day), Y(b.price), Z(b.pnl)], wd: V3 = [X(d.day), Y(d.price), Z(d.pnl)];
      const e1 = [wb[0] - wa[0], wb[1] - wa[1], wb[2] - wa[2]], e2 = [wd[0] - wa[0], wd[1] - wa[1], wd[2] - wa[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      const lit = 0.42 + 0.58 * Math.abs((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
      const mid = (a.pnl + b.pnl + c.pnl + d.pnl) / 4;
      let col = baseColor(mid, model.maxProfit, model.maxLoss).map((x) => x * lit) as V3;
      const midDay = (a.day + b.day) / 2, midPrice = (a.price + d.price) / 2;
      const gm = glow(density, colMax, midDay, midPrice);
      if (gm > 0) col = col.map((x, k) => x + ([210, 235, 255][k] - x) * 0.72 * gm) as V3;
      const gf = glow(forkDensity, forkColMax, midDay, midPrice);
      if (gf > 0) col = col.map((x, k) => x + ([56, 189, 248][k] - x) * 0.8 * gf) as V3;
      const fill = `rgb(${col.map((x) => Math.round(Math.min(255, x))).join(",")})`;
      const q = [P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]];
      g.fillStyle = fill;
      g.strokeStyle = fill;
      g.lineWidth = 0.6;
      g.beginPath();
      q.forEach((p, k) => (k ? g.lineTo(p.sx, p.sy) : g.moveTo(p.sx, p.sy)));
      g.closePath();
      g.fill();
      g.stroke();
      // 盈亏平衡线（盈亏=0）：跟着这一格一起画，后面更近的格子会正确地挡住它
      const vs = [a.pnl, b.pnl, c.pnl, d.pnl];
      const cross: { sx: number; sy: number }[] = [];
      for (let k = 0; k < 4; k++) {
        const v0 = vs[k], v1 = vs[(k + 1) % 4];
        if ((v0 > 0) !== (v1 > 0)) {
          const f = v0 / (v0 - v1);
          const p0 = q[k], p1 = q[(k + 1) % 4];
          cross.push({ sx: p0.sx + (p1.sx - p0.sx) * f, sy: p0.sy + (p1.sy - p0.sy) * f });
        }
      }
      if (cross.length >= 2) {
        g.strokeStyle = "rgba(248,250,252,0.9)";
        g.lineWidth = 1.3;
        g.beginPath();
        g.moveTo(cross[0].sx, cross[0].sy);
        g.lineTo(cross[1].sx, cross[1].sy);
        g.stroke();
      }
    }

    // 行权价：贴着曲面的细虚线
    for (const k of model.strikes) {
      if (k < model.sMin || k > model.sMax) continue;
      g.strokeStyle = "rgba(226,232,240,0.45)";
      g.setLineDash([3, 3]);
      g.lineWidth = 1;
      g.beginPath();
      for (let s = 0; s <= 30; s++) {
        const day = (s / 30) * days;
        const p = proj(X(day), Y(k), Z(model.pnlAt(day, k)) + 0.01);
        if (s) g.lineTo(p.sx, p.sy);
        else g.moveTo(p.sx, p.sy);
      }
      g.stroke();
      g.setLineDash([]);
      text(1, Y(k), Z(model.pnlAt(days, k)) + 0.05, `K ${k}`, "#cbd5e1", "left", 0);
    }

    // 走势光束：还拿着的部分按出场原因着色，下车之后的部分画淡
    const beam = (pts3: { day: number; price: number; pnl: number }[], from: number, to: number, style: string, width: number) => {
      if (to <= from) return;
      g.strokeStyle = style;
      g.lineWidth = width;
      g.beginPath();
      for (let k = from; k <= to && k < pts3.length; k++) {
        const pt = pts3[k];
        if (pt.price < model.sMin || pt.price > model.sMax) continue;
        const p = proj(X(pt.day), Y(pt.price), Z(pt.pnl) + 0.02);
        if (k === from) g.moveTo(p.sx, p.sy);
        else g.lineTo(p.sx, p.sy);
      }
      g.stroke();
    };
    for (const { s, pts: p3 } of beams.main) {
      if (todayDay !== undefined) {
        beam(p3, 0, Math.min(todayDay, p3.length - 1), "rgba(203,213,225,0.35)", 1);
        continue;
      }
      beam(p3, 0, s.exitDay, `rgba(${REASON_RGB[s.reason]},0.7)`, 1.1);
      beam(p3, s.exitDay, p3.length - 1, "rgba(203,213,225,0.16)", 1);
    }
    if (actual && actual.length > 1) {
      const a3 = actual.map((a) => ({ day: a.day, price: a.price, pnl: model.pnlAt(a.day, a.price) }));
      beam(a3, 0, a3.length - 1, "rgba(2,6,23,0.9)", 5);
      beam(a3, 0, a3.length - 1, "rgba(251,191,36,1)", 2.6);
      const last = a3[a3.length - 1];
      const pl = proj(X(last.day), Y(last.price), Z(last.pnl) + 0.03);
      g.fillStyle = "#fbbf24";
      g.beginPath();
      g.arc(pl.sx, pl.sy, 5, 0, Math.PI * 2);
      g.fill();
    }
    if (todayDay !== undefined && todayDay > 0 && todayDay < days) {
      line([X(todayDay), -1, FLOOR], [X(todayDay), 1, FLOOR], "rgba(251,191,36,0.7)", 1.2, [4, 3]);
      if (labels.today) text(X(todayDay), -1, FLOOR, labels.today, "#fbbf24", "center", 14);
    }
    for (const { s, pts: p3 } of beams.fork) {
      const exitK = s.exitDay;
      beam(p3, 0, exitK, "rgba(125,211,252,0.75)", 1.1);
    }
    for (const e of exits) {
      if (e.price < model.sMin || e.price > model.sMax) continue;
      const p = proj(X(e.day), Y(e.price), Z(model.pnlAt(e.day, e.price)) + 0.025);
      g.beginPath();
      if (todayDay !== undefined) {
        // 回看时只有一个"按规则本该下车"的点：画成醒目的圈
        g.strokeStyle = `rgb(${REASON_RGB[e.reason]})`;
        g.lineWidth = 2.2;
        g.arc(p.sx, p.sy, 7, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 1;
      } else {
        g.fillStyle = `rgb(${REASON_RGB[e.reason]})`;
        g.arc(p.sx, p.sy, 2.1, 0, Math.PI * 2);
        g.fill();
      }
    }

    // 情景点：从地板立一根针到曲面
    if (scenario && scenario.day <= days && scenario.price >= model.sMin && scenario.price <= model.sMax) {
      const zp = Z(model.pnlAt(scenario.day, scenario.price));
      line([X(scenario.day), Y(scenario.price), FLOOR], [X(scenario.day), Y(scenario.price), zp], "rgba(56,189,248,0.9)", 1.2, [4, 3]);
      const p = proj(X(scenario.day), Y(scenario.price), zp + 0.02);
      g.fillStyle = "#0ea5e9";
      g.strokeStyle = "#f8fafc";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(p.sx, p.sy - 7);
      g.lineTo(p.sx + 7, p.sy);
      g.lineTo(p.sx, p.sy + 7);
      g.lineTo(p.sx - 7, p.sy);
      g.closePath();
      g.fill();
      g.stroke();
    }

    // 坐标：时间（地板前沿，带箭头）、股价（地板左沿，带箭头）、盈亏（左后角竖轴）
    const arrow = (a: V3, b: V3, color: string) => {
      line(a, b, color, 1.6);
      const p = proj(...a), q = proj(...b);
      const ang = Math.atan2(q.sy - p.sy, q.sx - p.sx);
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(q.sx, q.sy);
      g.lineTo(q.sx - 9 * Math.cos(ang - 0.4), q.sy - 9 * Math.sin(ang - 0.4));
      g.lineTo(q.sx - 9 * Math.cos(ang + 0.4), q.sy - 9 * Math.sin(ang + 0.4));
      g.closePath();
      g.fill();
    };
    arrow([-1, -1, FLOOR], [1.14, -1, FLOOR], "rgba(203,213,225,0.85)");
    arrow([-1, -1, FLOOR], [-1, 1.16, FLOOR], "rgba(203,213,225,0.85)");
    g.font = "bold 11px sans-serif";
    text(0, -1, FLOOR, labels.time, "#e2e8f0", "center", 30);
    g.font = "10px sans-serif";
    text(-1, -1, FLOOR, labels.open, "#94a3b8", "center", 14);
    text(1, -1, FLOOR, labels.expiry, "#94a3b8", "center", 14);
    if (endDay < days && endDay > 0) text(X(endDay), -1, FLOOR, labels.close, "#d97706", "center", 14);
    for (const f of [0, 0.5, 1]) {
      const price = model.sMin + f * (model.sMax - model.sMin);
      text(-1, -1 + 2 * f, FLOOR, price.toFixed(price >= 100 ? 0 : 1), "#64748b", "right", 4);
    }
    g.font = "bold 11px sans-serif";
    text(-1.1, 0.35, FLOOR, labels.price, "#e2e8f0", "right", 0);
    g.font = "10px sans-serif";
    line([-1, 1, Z(-model.maxLoss)], [-1, 1, Z(model.maxProfit)], "rgba(148,163,184,0.6)");
    // 最大盈利/亏损离0太近时不单独标0，免得两个数字叠在一起
    const tooClose = Math.min(model.maxProfit, model.maxLoss) / zScale < 0.08;
    for (const v of tooClose ? [model.maxProfit, -model.maxLoss] : [model.maxProfit, 0, -model.maxLoss]) {
      line([-1, 1, Z(v)], [-1.04, 1, Z(v)], "rgba(148,163,184,0.8)");
      text(-1.06, 1, Z(v), v === 0 ? "0" : `${v > 0 ? "+" : "−"}${money(Math.abs(v))}`, v > 0 ? "#6ee7b7" : v < 0 ? "#fda4af" : "#e2e8f0", "right", 4);
    }
    text(-1, 1, TOP, labels.pnl, "#e2e8f0", "center", 0);
    g.font = "10px sans-serif";
    g.fillStyle = "#64748b";
    g.textAlign = "right";
    g.fillText(labels.hint, W - 8, H - 8);
    // 左上角说明：三个方向各代表什么（转到任何角度都看得懂）
    g.textAlign = "left";
    labels.legend.forEach((ln, i) => {
      g.fillStyle = i === 0 ? "#e2e8f0" : "#cbd5e1";
      g.fillText(ln, 10, 16 + i * 15);
    });
  };

  // ⚠️ 动画和尺寸回调都调drawRef.current：它们是第一次渲染时注册的，直接调draw会用到第一次渲染时的旧数据
  // （开场旋转的1.4秒内数据到了，转完画出来的还是空的）。
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const schedule = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => drawRef.current());
  };

  // 尺寸
  useEffect(() => {
    const el = wrapRef.current;
    const cv = cvRef.current;
    if (!el || !cv) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      size.current = { w: el.clientWidth, h: el.clientHeight };
      cv.width = Math.round(el.clientWidth * dpr);
      cv.height = Math.round(el.clientHeight * dpr);
      schedule();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 第一次出现时转一下（从侧面转到默认视角），让人知道这是能转的立体图
  useEffect(() => {
    const start = performance.now();
    const from = { yaw: DEFAULT_VIEW.yaw - 1.1, pitch: 0.25 };
    let id = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 1400);
      const e = 1 - (1 - k) ** 3;
      view.current = { yaw: from.yaw + (DEFAULT_VIEW.yaw - from.yaw) * e, pitch: from.pitch + (DEFAULT_VIEW.pitch - from.pitch) * e };
      drawRef.current();
      if (k < 1 && !drag.current) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, []);

  // 数据变了就重画
  useEffect(() => {
    schedule();
  }, [surface, colMax, forkColMax, beams, exits, scenario, endDay, labels, actual, todayDay]);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x;
        const dy = e.clientY - drag.current.y;
        drag.current = { x: e.clientX, y: e.clientY };
        view.current = { yaw: view.current.yaw + dx * 0.008, pitch: Math.min(1.35, Math.max(0.1, view.current.pitch + dy * 0.006)) };
        schedule();
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onDoubleClick={() => {
        view.current = { ...DEFAULT_VIEW };
        schedule();
      }}
    >
      <canvas ref={cvRef} role="img" aria-label={labels.pnl} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
