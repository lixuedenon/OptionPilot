// src/components/SimSurface3D.tsx
// 万次推演的"立体"视图：时间×股价×盈亏的曲面（高度=盈亏，颜色=赚/亏），最底下一层"地面"=时间×股价（跟平面图一样）。
// 股价走势画在地面上，从走势往上拉一道半透明"帘子"连到曲面：帘子有多高=那天、那个股价下的盈亏，帘子顶上的亮线=钱怎么变。
// 一次只画一条走势（推演未来=选中的典型结局，今昔对比=真实走过的路），不再让几十条线贴着曲面走——那样线的高低是盈亏不是股价，看不懂。
// 曲面半透明，地面上的走势透得过来。canvas 2D自己投影+画家算法画，不引三维库。拖动旋转、滚轮缩放、Shift拖动平移、双击复位。
import { useEffect, useMemo, useRef } from "react";
import type { MapModel } from "@/lib/stockOptionMap";
import type { ExitReason } from "@/lib/winRateSim";
import type { Band } from "@/lib/futureSim";

// 一条走势：points按天排好；exitDay之后（已下车）只在地面画淡虚线，帘子停在exitDay。
export interface Path3D {
  points: { day: number; price: number }[];
  exitDay: number;
  color: string; // #rrggbb
  label: string; // 贴在帘子终点的说明
}

export interface Mark3D {
  day: number;
  price: number;
  reason: ExitReason;
  label?: string;
}

interface Props {
  model: MapModel;
  days: number;
  path: Path3D | null;
  bands?: Band[]; // 全部走势每天的股价范围（跟平面图同一份），画在地面上——这就是"万次推演"在立体图里的样子
  marks?: Mark3D[];
  scenario: { day: number; price: number } | null;
  endDay: number;
  labels: {
    open: string; expiry: string; close: string; price: string; pnl: string; hint: string; time: string; intro: string; today?: string;
    floor: string; // 地面上的说明
    curtain: string; // 帘子上的说明
    zero: string; // 虚线网格（盈亏0）的说明
    band: string; // 地面灰带的说明
    dayTick: (d: number) => string;
    scen: (d: number, price: string, v: string) => string;
  };
  notes?: SurfaceNotes;
  slices?: { day: number; label: string; color: string }[];
  money: (v: number) => string;
  todayDay?: number;
}

export interface SurfaceNotes {
  top: (range: string, v: string) => string;
  bottom: (range: string, v: string) => string;
  breakeven: string;
  above: (a: string) => string;
  below: (b: string) => string;
  between: (a: string, b: string) => string;
  outside: (a: string, b: string) => string;
}

const REASON_RGB: Record<ExitReason, string> = { tp: "52,211,153", sl: "251,113,133", delta: "167,139,250", time: "251,191,36", expiry: "56,189,248" };
const DEFAULT_VIEW = { yaw: -0.72, pitch: 0.55 };
const NY = 46;

type V3 = [number, number, number];

function baseColor(v: number, maxProfit: number, maxLoss: number): V3 {
  const k = Math.sqrt(Math.min(1, v >= 0 ? v / maxProfit : -v / maxLoss));
  const from: V3 = [30, 41, 59];
  const to: V3 = v >= 0 ? [16, 185, 129] : [244, 63, 94];
  return [0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * k) as V3;
}

function hexRgb(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export default function SimSurface3D(props: Props) {
  const { model, days, path, bands, marks, scenario, endDay, labels, money, todayDay, notes, slices } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ ...DEFAULT_VIEW });
  const size = useRef({ w: 0, h: 0 });
  const raf = useRef(0);
  const drag = useRef<{ x: number; y: number; pan: boolean } | null>(null);
  // 放大缩小+平移：屏幕坐标 = 自动缩放居中后的坐标 × k + (tx, ty)。
  const zoom = useRef({ k: 1, tx: 0, ty: 0 });

  const zScale = Math.max(model.maxProfit, model.maxLoss) || 1;
  const X = (day: number) => -1 + (2 * day) / Math.max(1, days);
  const Y = (price: number) => -1 + (2 * (Math.min(model.sMax, Math.max(model.sMin, price)) - model.sMin)) / (model.sMax - model.sMin);
  const Z = (pnl: number) => (Math.max(-zScale, Math.min(zScale, pnl)) / zScale) * 0.9;

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
    return { NX, pts };
  }, [model, days]);

  // 走势上每一点的盈亏（按曲面同一个模型）——帘子顶上那条线
  const path3 = useMemo(() => {
    if (!path || path.points.length < 2) return null;
    const pts = path.points.filter((p) => p.day >= 0 && p.day <= days).map((p) => ({ ...p, pnl: model.pnlAt(p.day, p.price) }));
    const held = pts.filter((p) => p.day <= path.exitDay + 1e-9);
    const after = pts.filter((p) => p.day >= path.exitDay - 1e-9);
    return { pts, held, after, rgb: hexRgb(path.color), color: path.color, label: path.label };
  }, [path, model, days]);

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
    const BASE = Z(0); // 盈亏0的高度（虚线网格）
    const FLOOR = Math.min(Z(-model.maxLoss), BASE) - 0.3; // 地面：比最低的曲面再低一截，帘子才看得出高矮
    const raw = (x: number, y: number, z: number) => {
      const x1 = x * cy - y * sy;
      const y1 = x * sy + y * cy;
      const u = z * cp + y1 * sp;
      const depth = y1 * cp - z * sp;
      const f = 1 / (1 + 0.14 * depth);
      return { x: x1 * f, y: -u * f, depth };
    };
    // 按当前角度把真正画出来的东西（地面四角、曲面上的点、轴的两头）缩放居中到画布里
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    const fit = (x: number, y: number, z: number) => {
      const r = raw(x, y, z);
      bx0 = Math.min(bx0, r.x); bx1 = Math.max(bx1, r.x); by0 = Math.min(by0, r.y); by1 = Math.max(by1, r.y);
    };
    const step = Math.max(1, Math.floor(surface.NX / 12));
    for (let i = 0; i < surface.NX; i += step) for (let j = 0; j < NY; j += 5) fit(X(surface.pts[i][j].day), Y(surface.pts[i][j].price), Z(surface.pts[i][j].pnl));
    for (const x of [-1, 1.16]) for (const y of [-1, 1.16]) fit(x, y, FLOOR);
    fit(-1, -1, Math.max(Z(model.maxProfit), BASE + 0.1) + 0.12);
    const padX = 64, padTop = 28, padBottom = 40;
    const S = Math.min((W - 2 * padX) / (bx1 - bx0), (H - padTop - padBottom) / (by1 - by0));
    const ox = padX + ((W - 2 * padX) - (bx1 - bx0) * S) / 2 - bx0 * S;
    const oy = padTop + ((H - padTop - padBottom) - (by1 - by0) * S) / 2 - by0 * S;
    const proj = (x: number, y: number, z: number) => {
      const r = raw(x, y, z);
      const zm = zoom.current;
      return { sx: (ox + r.x * S) * zm.k + zm.tx, sy: (oy + r.y * S) * zm.k + zm.ty, depth: r.depth };
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
    // 已经占用的文字框（坐标刻度先画、先占位，曲面标签再避开它们）
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    // 坐标刻度：垫一层底色，压在曲面上也看得清
    const tick = (x: number, y: number, z: number, s: string, color: string, align: CanvasTextAlign, dy = 0) => {
      const p = proj(x, y, z);
      const tw = g.measureText(s).width;
      const x0 = align === "right" ? p.sx - tw : align === "center" ? p.sx - tw / 2 : p.sx;
      g.fillStyle = "rgba(2,6,23,0.75)";
      g.fillRect(x0 - 3, p.sy + dy - 10, tw + 6, 13);
      placed.push({ x0: x0 - 3, y0: p.sy + dy - 10, x1: x0 + tw + 3, y1: p.sy + dy + 3 });
      g.fillStyle = color;
      g.textAlign = align;
      g.fillText(s, p.sx, p.sy + dy);
    };
    const polyline = (pts: { sx: number; sy: number }[], style: string, width: number, dash: number[] = []) => {
      if (pts.length < 2) return;
      g.strokeStyle = style;
      g.lineWidth = width;
      g.setLineDash(dash);
      g.beginPath();
      pts.forEach((p, k) => (k ? g.lineTo(p.sx, p.sy) : g.moveTo(p.sx, p.sy)));
      g.stroke();
      g.setLineDash([]);
    };
    const { NX, pts } = surface;
    g.font = "10px sans-serif";

    // ① 地面：时间×股价，网格 + 每天的盈亏平衡价（白虚线）——跟平面图同一张"地图"
    {
      const c = [proj(-1, -1, FLOOR), proj(1, -1, FLOOR), proj(1, 1, FLOOR), proj(-1, 1, FLOOR)];
      g.fillStyle = "rgba(30,41,59,0.6)";
      g.beginPath();
      c.forEach((p, k) => (k ? g.lineTo(p.sx, p.sy) : g.moveTo(p.sx, p.sy)));
      g.closePath();
      g.fill();
      for (const v of [-1, -0.5, 0, 0.5, 1]) {
        line([-1, v, FLOOR], [1, v, FLOOR], "rgba(100,116,139,0.35)");
        line([v, -1, FLOOR], [v, 1, FLOOR], "rgba(100,116,139,0.35)");
      }
      g.strokeStyle = "rgba(226,232,240,0.55)";
      g.lineWidth = 1;
      g.setLineDash([4, 3]);
      for (let i = 0; i < NX - 1; i++) {
        for (let j = 0; j < NY - 1; j++) {
          const a = pts[i][j], b = pts[i + 1][j], c2 = pts[i + 1][j + 1], d = pts[i][j + 1];
          const q = [a, b, c2, d];
          const cross: V3[] = [];
          for (let k = 0; k < 4; k++) {
            const p0 = q[k], p1 = q[(k + 1) % 4];
            if ((p0.pnl > 0) !== (p1.pnl > 0)) {
              const f = p0.pnl / (p0.pnl - p1.pnl);
              cross.push([X(p0.day + (p1.day - p0.day) * f), Y(p0.price + (p1.price - p0.price) * f), FLOOR]);
            }
          }
          if (cross.length >= 2) {
            const p = proj(...cross[0]), r = proj(...cross[1]);
            g.beginPath();
            g.moveTo(p.sx, p.sy);
            g.lineTo(r.sx, r.sy);
            g.stroke();
          }
        }
      }
      g.setLineDash([]);
      if (endDay < days) line([X(endDay), -1, FLOOR], [X(endDay), 1, FLOOR], "rgba(251,191,36,0.6)", 1, [3, 3]);
      if (todayDay !== undefined && todayDay > 0 && todayDay < days) line([X(todayDay), -1, FLOOR], [X(todayDay), 1, FLOOR], "rgba(251,191,36,0.7)", 1.2, [4, 3]);
    }

    // 地面上的股价范围带：浅=10次里9次，深=一半，白线=中位数
    let bandTagAt: { sx: number; sy: number } | null = null;
    if (bands && bands.length > 1) {
      const area = (lo: (b: Band) => number, hi: (b: Band) => number, fill: string) => {
        const top = bands.map((b) => proj(X(b.day), Y(hi(b)), FLOOR));
        const bot = [...bands].reverse().map((b) => proj(X(b.day), Y(lo(b)), FLOOR));
        g.fillStyle = fill;
        g.beginPath();
        [...top, ...bot].forEach((p, k) => (k ? g.lineTo(p.sx, p.sy) : g.moveTo(p.sx, p.sy)));
        g.closePath();
        g.fill();
      };
      area((b) => b.p5, (b) => b.p95, "rgba(226,232,240,0.14)");
      area((b) => b.p25, (b) => b.p75, "rgba(226,232,240,0.22)");
      polyline(bands.map((b) => proj(X(b.day), Y(b.p50), FLOOR)), "rgba(248,250,252,0.6)", 1.2);
      const bk = bands[Math.round((bands.length - 1) * 0.8)];
      bandTagAt = proj(X(bk.day), Y(bk.p95), FLOOR);
    }

    // 地面上的走势（先画一遍；曲面是半透明的，透得过来。画完曲面后再淡淡地补一遍）
    const floorPts = (arr: { day: number; price: number }[]) => arr.map((p) => proj(X(p.day), Y(p.price), FLOOR));
    const drawFloorPath = (alpha: number) => {
      if (!path3) return;
      polyline(floorPts(path3.after), `rgba(${path3.rgb},${(alpha * 0.45).toFixed(2)})`, 1.6, [5, 4]);
      polyline(floorPts(path3.held), "rgba(2,6,23,0.8)", 5);
      polyline(floorPts(path3.held), `rgba(${path3.rgb},${alpha})`, 2.8);
    };
    drawFloorPath(1);

    // ② 盈亏0的虚线网格（曲面在它上面是赚、下面是亏）
    for (const v of [-1, -0.5, 0, 0.5, 1]) {
      line([-1, v, BASE], [1, v, BASE], "rgba(148,163,184,0.22)", 1, [2, 3]);
      line([v, -1, BASE], [v, 1, BASE], "rgba(148,163,184,0.22)", 1, [2, 3]);
    }

    // ③ 曲面格子 + 帘子格子一起按远近排序（画家算法），都半透明
    type Quad = { depth: number; pts: { sx: number; sy: number }[]; fill: string; be?: { sx: number; sy: number }[] };
    const quads: Quad[] = [];
    const L: V3 = [-0.35, -0.55, 0.76];
    const P = pts.map((col) => col.map((c) => proj(X(c.day), Y(c.price), Z(c.pnl))));
    for (let i = 0; i < NX - 1; i++) {
      for (let j = 0; j < NY - 1; j++) {
        const a = pts[i][j], b = pts[i + 1][j], c = pts[i + 1][j + 1], d = pts[i][j + 1];
        const wa: V3 = [X(a.day), Y(a.price), Z(a.pnl)], wb: V3 = [X(b.day), Y(b.price), Z(b.pnl)], wd: V3 = [X(d.day), Y(d.price), Z(d.pnl)];
        const e1 = [wb[0] - wa[0], wb[1] - wa[1], wb[2] - wa[2]], e2 = [wd[0] - wa[0], wd[1] - wa[1], wd[2] - wa[2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const nl = Math.hypot(n[0], n[1], n[2]) || 1;
        const lit = 0.45 + 0.55 * Math.abs((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
        const mid = (a.pnl + b.pnl + c.pnl + d.pnl) / 4;
        const col = baseColor(mid, model.maxProfit, model.maxLoss).map((x) => Math.round(Math.min(255, x * lit)));
        const q = [P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]];
        // 盈亏平衡线跟着这一格一起画，更近的格子会盖住它
        const vs = [a.pnl, b.pnl, c.pnl, d.pnl];
        const be: { sx: number; sy: number }[] = [];
        for (let k = 0; k < 4; k++) {
          const v0 = vs[k], v1 = vs[(k + 1) % 4];
          if ((v0 > 0) !== (v1 > 0)) {
            const f = v0 / (v0 - v1);
            be.push({ sx: q[k].sx + (q[(k + 1) % 4].sx - q[k].sx) * f, sy: q[k].sy + (q[(k + 1) % 4].sy - q[k].sy) * f });
          }
        }
        quads.push({ depth: (q[0].depth + q[1].depth + q[2].depth + q[3].depth) / 4, pts: q, fill: `rgba(${col.join(",")},0.5)`, be: be.length >= 2 ? be : undefined });
      }
    }
    if (path3) {
      const h = path3.held;
      for (let k = 0; k < h.length - 1; k++) {
        const a = h[k], b = h[k + 1];
        const q = [proj(X(a.day), Y(a.price), FLOOR), proj(X(b.day), Y(b.price), FLOOR), proj(X(b.day), Y(b.price), Z(b.pnl)), proj(X(a.day), Y(a.price), Z(a.pnl))];
        quads.push({ depth: (q[0].depth + q[1].depth + q[2].depth + q[3].depth) / 4, pts: q, fill: `rgba(${path3.rgb},0.3)` });
      }
    }
    quads.sort((a, b) => b.depth - a.depth);
    for (const q of quads) {
      g.fillStyle = q.fill;
      g.beginPath();
      q.pts.forEach((p, k) => (k ? g.lineTo(p.sx, p.sy) : g.moveTo(p.sx, p.sy)));
      g.closePath();
      g.fill();
      if (q.be) {
        g.strokeStyle = "rgba(248,250,252,0.9)";
        g.lineWidth = 1.3;
        g.beginPath();
        g.moveTo(q.be[0].sx, q.be[0].sy);
        g.lineTo(q.be[1].sx, q.be[1].sy);
        g.stroke();
      }
    }

    // 曲面上的细网格线：半透明的曲面也看得出起伏
    g.lineWidth = 0.7;
    for (let i = 0; i < NX; i += Math.max(1, Math.round(NX / 10))) polyline(P[i], "rgba(226,232,240,0.16)", 0.7);
    for (let j = 0; j < NY; j += 5) polyline(P.map((col) => col[j]), "rgba(226,232,240,0.16)", 0.7);

    // 行权价：贴着曲面的细虚线
    for (const k of model.strikes) {
      if (k < model.sMin || k > model.sMax) continue;
      const kp: { sx: number; sy: number }[] = [];
      for (let s = 0; s <= 30; s++) {
        const day = (s / 30) * days;
        kp.push(proj(X(day), Y(k), Z(model.pnlAt(day, k)) + 0.01));
      }
      polyline(kp, "rgba(226,232,240,0.45)", 1, [3, 3]);
      text(1, Y(k), Z(model.pnlAt(days, k)) + 0.05, `K ${k}`, "#cbd5e1", "left", 0);
    }

    // ④ 帘子：竖线 + 顶上的亮线（=钱怎么变）+ 地面走势再淡淡补一遍
    const tags: { x: number; y: number; text: string; color: string }[] = [];
    if (path3 && path3.held.length > 1) {
      const h = path3.held;
      const every = Math.max(1, Math.round(h.length / 10));
      h.forEach((p, k) => {
        if (k % every && k !== h.length - 1) return;
        line([X(p.day), Y(p.price), FLOOR], [X(p.day), Y(p.price), Z(p.pnl)], `rgba(${path3.rgb},0.55)`, 1);
      });
      drawFloorPath(0.95); // 曲面挡住的地方也补画出来（像影子），走势要始终看得见
      const top = h.map((p) => proj(X(p.day), Y(p.price), Z(p.pnl) + 0.01));
      polyline(top, "rgba(2,6,23,0.85)", 5);
      polyline(top, "#fef3c7", 2.4);
      const last = h[h.length - 1];
      const pl = proj(X(last.day), Y(last.price), Z(last.pnl) + 0.01);
      g.fillStyle = path3.color;
      g.strokeStyle = "#020617";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(pl.sx, pl.sy, 6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      tags.push({ x: pl.sx, y: pl.sy, text: path3.label, color: path3.color });
      // 地面和帘子各贴一句说明（在走势前段，避开终点标签）
      const fA = h[Math.min(h.length - 1, Math.max(1, Math.round(h.length * 0.25)))];
      const pf = proj(X(fA.day), Y(fA.price), FLOOR);
      tags.push({ x: pf.sx, y: pf.sy, text: labels.floor, color: path3.color });
      const cA = h[Math.min(h.length - 1, Math.max(1, Math.round(h.length * 0.55)))];
      const pc = proj(X(cA.day), Y(cA.price), (FLOOR + Z(cA.pnl)) / 2);
      tags.push({ x: pc.sx, y: pc.sy, text: labels.curtain, color: "#fde68a" });
    }

    // 按规则本该下车的点（今昔对比）
    for (const m of marks ?? []) {
      const p = proj(X(m.day), Y(m.price), Z(model.pnlAt(m.day, m.price)) + 0.02);
      g.strokeStyle = `rgb(${REASON_RGB[m.reason]})`;
      g.lineWidth = 2.2;
      g.beginPath();
      g.arc(p.sx, p.sy, 7, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 1;
      if (m.label) tags.push({ x: p.sx, y: p.sy, text: m.label, color: `rgb(${REASON_RGB[m.reason]})` });
    }

    // 某一天的盈亏曲线（=盈亏图里那一天的线）：沿股价方向切一刀
    for (const sl of slices ?? []) {
      if (sl.day < 0 || sl.day > days) continue;
      const cut: { sx: number; sy: number }[] = [];
      for (let k = 0; k <= 60; k++) {
        const price = model.sMin + (k / 60) * (model.sMax - model.sMin);
        cut.push(proj(X(sl.day), Y(price), Z(model.pnlAt(sl.day, price)) + 0.015));
      }
      polyline(cut, "rgba(2,6,23,0.85)", 4.5);
      polyline(cut, sl.color, 2.2);
      line([X(sl.day), -1, FLOOR], [X(sl.day), 1, FLOOR], sl.color, 1, [4, 3]);
      const ap = model.sMin + 0.8 * (model.sMax - model.sMin);
      const tp = proj(X(sl.day), Y(ap), Z(model.pnlAt(sl.day, ap)) + 0.015);
      tags.push({ x: tp.sx, y: tp.sy, text: sl.label, color: sl.color });
    }

    // 情景点：地面上一个点，立一根针到曲面
    if (scenario && scenario.day <= days && scenario.price >= model.sMin && scenario.price <= model.sMax) {
      const v = model.pnlAt(scenario.day, scenario.price);
      const zp = Z(v);
      line([X(scenario.day), Y(scenario.price), FLOOR], [X(scenario.day), Y(scenario.price), zp], "rgba(56,189,248,0.95)", 1.4, [4, 3]);
      const diamond = (p: { sx: number; sy: number }, r: number) => {
        g.beginPath();
        g.moveTo(p.sx, p.sy - r);
        g.lineTo(p.sx + r, p.sy);
        g.lineTo(p.sx, p.sy + r);
        g.lineTo(p.sx - r, p.sy);
        g.closePath();
        g.fill();
        g.stroke();
      };
      g.fillStyle = "#0ea5e9";
      g.strokeStyle = "#f8fafc";
      g.lineWidth = 1.5;
      diamond(proj(X(scenario.day), Y(scenario.price), FLOOR), 5);
      const ps = proj(X(scenario.day), Y(scenario.price), zp + 0.02);
      diamond(ps, 7);
      tags.push({ x: ps.sx, y: ps.sy, text: labels.scen(Math.round(scenario.day), scenario.price.toFixed(2), `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`), color: "#7dd3fc" });
    }

    // 曲面标注：最后一天那一列最赚/最亏的一片、白线（不赚不亏）、虚线网格（盈亏0）
    if (notes) {
      const col = pts[NX - 1];
      const vals = col.map((c) => c.pnl);
      const maxV = Math.max(...vals), minV = Math.min(...vals), span = maxV - minV;
      const fmtP = (x: number) => x.toFixed(x >= 100 ? 0 : 1);
      const region = (best: number, pick: (v: number) => boolean) => {
        const runs: [number, number][] = [];
        for (let j = 0; j < NY; j++) {
          if (!pick(vals[j])) continue;
          if (runs.length && runs[runs.length - 1][1] === j - 1) runs[runs.length - 1][1] = j;
          else runs.push([j, j]);
        }
        const [a0, a1] = runs.find(([lo, hi]) => lo <= best && best <= hi) ?? [best, best];
        if (runs.length === 2 && runs[0][0] === 0 && runs[1][1] === NY - 1) {
          return { r: notes.outside(fmtP(col[runs[0][1]].price), fmtP(col[runs[1][0]].price)), mid: Math.round((a0 + a1) / 2) };
        }
        const r = a1 >= NY - 1 && a0 > 0 ? notes.above(fmtP(col[a0].price))
          : a0 <= 0 && a1 < NY - 1 ? notes.below(fmtP(col[a1].price))
            : notes.between(fmtP(col[a0].price), fmtP(col[a1].price));
        return { r, mid: Math.round((a0 + a1) / 2) };
      };
      if (span > 1e-6) {
        const top = region(vals.indexOf(maxV), (v) => v >= maxV - 0.03 * span);
        const bot = region(vals.indexOf(minV), (v) => v <= minV + 0.03 * span);
        const pTop = proj(X(col[top.mid].day), Y(col[top.mid].price), Z(col[top.mid].pnl) + 0.02);
        const pBot = proj(X(col[bot.mid].day), Y(col[bot.mid].price), Z(col[bot.mid].pnl) + 0.02);
        tags.push({ x: pTop.sx, y: pTop.sy, text: notes.top(top.r, money(maxV)), color: "#6ee7b7" });
        tags.push({ x: pBot.sx, y: pBot.sy, text: notes.bottom(bot.r, money(minV)), color: "#fda4af" });
      }
      const ci = Math.round((NX - 1) * 0.7);
      for (let j = 1; j < NY; j++) {
        const a = pts[ci][j - 1], b = pts[ci][j];
        if ((a.pnl > 0) !== (b.pnl > 0)) {
          const f = a.pnl / (a.pnl - b.pnl);
          const pb = proj(X(a.day), Y(a.price + (b.price - a.price) * f), BASE + 0.02);
          tags.push({ x: pb.sx, y: pb.sy, text: notes.breakeven, color: "#f8fafc" });
          break;
        }
      }
    }
    {
      const pz = proj(1, 1, BASE);
      tags.push({ x: pz.sx, y: pz.sy, text: labels.zero, color: "#94a3b8" });
      if (bandTagAt) tags.push({ x: bandTagAt.sx, y: bandTagAt.sy, text: labels.band, color: "#cbd5e1" });
    }

    // ⑤ 坐标轴：时间、股价沿地面的两条边，盈亏从地面角上竖起来
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
    const AX = "rgba(203,213,225,0.85)";
    arrow([-1, -1, FLOOR], [1.14, -1, FLOOR], AX);
    arrow([-1, -1, FLOOR], [-1, 1.16, FLOOR], AX);
    const zTop = Math.max(Z(model.maxProfit), BASE + 0.1);
    line([-1, -1, FLOOR], [-1, -1, zTop], AX, 1.6);
    arrow([-1, -1, zTop - 0.01], [-1, -1, zTop + 0.06], AX);
    // 时间刻度
    g.font = "bold 11px sans-serif";
    text(0, -1, FLOOR, labels.time, "#e2e8f0", "center", 32);
    g.font = "10px sans-serif";
    text(-1, -1, FLOOR, labels.open, "#94a3b8", "center", 16);
    text(1, -1, FLOOR, labels.expiry, "#94a3b8", "center", 16);
    for (const f of [1 / 3, 2 / 3]) {
      const d = Math.round(f * days);
      if (d > 0 && d < days) {
        line([X(d), -1, FLOOR], [X(d), -1.04, FLOOR], AX);
        tick(X(d), -1, FLOOR, labels.dayTick(d), "#94a3b8", "center", 16);
      }
    }
    if (endDay < days && endDay > 0 && labels.close) text(X(endDay), -1, FLOOR, labels.close, "#d97706", "center", 28);
    if (todayDay !== undefined && todayDay > 0 && todayDay < days && labels.today) text(X(todayDay), -1, FLOOR, labels.today, "#fbbf24", "center", 28);
    // 股价刻度（沿地面左边）
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const price = model.sMin + f * (model.sMax - model.sMin);
      line([-1, -1 + 2 * f, FLOOR], [-1.04, -1 + 2 * f, FLOOR], AX);
      tick(-1.06, -1 + 2 * f, FLOOR, price.toFixed(price >= 100 ? 0 : 1), "#94a3b8", "right", 4);
    }
    g.font = "bold 11px sans-serif";
    tick(-1, 1.24, FLOOR, `${labels.price} →`, "#e2e8f0", "center", 0);
    g.font = "10px sans-serif";
    // 盈亏刻度
    const tooClose = Math.min(model.maxProfit, model.maxLoss) / zScale < 0.08;
    for (const v of tooClose ? [model.maxProfit, -model.maxLoss] : [model.maxProfit, 0, -model.maxLoss]) {
      line([-1, -1, Z(v)], [-1.04, -1, Z(v)], "rgba(148,163,184,0.8)");
      tick(-1.06, -1, Z(v), v === 0 ? "0" : `${v > 0 ? "+" : "−"}${money(Math.abs(v))}`, v > 0 ? "#6ee7b7" : v < 0 ? "#fda4af" : "#e2e8f0", "right", 4);
    }
    g.font = "bold 11px sans-serif";
    text(-1, -1, zTop + 0.08, labels.pnl, "#e2e8f0", "center", -4);
    g.font = "10px sans-serif";
    // 所有文字标签最后统一摆放、避让重叠
    {
      g.font = "bold 11px sans-serif";
      const hit = (bx: number, by: number, tw: number) => placed.some((p) => bx < p.x1 && bx + tw > p.x0 && by < p.y1 && by + 18 > p.y0);
      for (const tg of tags) {
        const tw = g.measureText(tg.text).width + 10;
        const bx = Math.min(W - tw - 6, Math.max(6, tg.x - tw / 2));
        let by = Math.max(70, tg.y - 34);
        for (let k = 0; k < 6 && hit(bx, by, tw); k++) by -= 22;
        if (by < 4 || hit(bx, by, tw)) {
          by = Math.min(H - 24, tg.y + 14);
          for (let k = 0; k < 6 && hit(bx, by, tw); k++) by += 22;
        }
        placed.push({ x0: bx, y0: by, x1: bx + tw, y1: by + 18 });
        g.strokeStyle = tg.color;
        g.globalAlpha = 0.7;
        g.beginPath();
        g.moveTo(tg.x, tg.y);
        g.lineTo(Math.min(bx + tw, Math.max(bx, tg.x)), by < tg.y ? by + 18 : by);
        g.stroke();
        g.globalAlpha = 1;
        g.fillStyle = tg.color;
        g.beginPath();
        g.arc(tg.x, tg.y, 2.5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(2,6,23,0.88)";
        g.fillRect(bx, by, tw, 18);
        g.strokeStyle = tg.color;
        g.strokeRect(bx + 0.5, by + 0.5, tw - 1, 17);
        g.fillStyle = tg.color;
        g.textAlign = "left";
        g.fillText(tg.text, bx + 5, by + 13);
      }
      g.font = "10px sans-serif";
    }

    g.fillStyle = "#64748b";
    g.textAlign = "right";
    g.fillText(labels.hint, W - 8, H - 8);
    if (zoom.current.k > 1.01) {
      g.fillStyle = "#94a3b8";
      g.fillText(`×${zoom.current.k.toFixed(1)}`, W - 8, H - 22);
    }
    if (pitch > 1.35) {
      g.font = "bold 12px sans-serif";
      const tw = g.measureText(labels.intro).width;
      g.fillStyle = "rgba(2,6,23,0.85)";
      g.fillRect(W / 2 - tw / 2 - 8, H - 40, tw + 16, 22);
      g.fillStyle = "#fcd34d";
      g.textAlign = "center";
      g.fillText(labels.intro, W / 2, H - 25);
      g.font = "10px sans-serif";
    }
  };

  // ⚠️ 动画和尺寸回调都调drawRef.current：它们是第一次渲染时注册的，直接调draw会用到第一次渲染时的旧数据。
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const schedule = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => drawRef.current());
  };

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

  // 开场：先从正上方往下看（=平面图），停一下，再慢慢倾斜把盈亏立成高度。拖动会打断动画。
  useEffect(() => {
    const start = performance.now();
    const from = { yaw: 0, pitch: Math.PI / 2 };
    const HOLD = 900, TILT = 1800;
    let id = 0;
    const step = (now: number) => {
      if (drag.current) return;
      const k = Math.min(1, Math.max(0, (now - start - HOLD) / TILT));
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      view.current = { yaw: from.yaw + (DEFAULT_VIEW.yaw - from.yaw) * e, pitch: from.pitch + (DEFAULT_VIEW.pitch - from.pitch) * e };
      drawRef.current();
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, []);

  // 滚轮放大缩小：以鼠标所在的点为中心，1～8倍。非passive监听才能挡住页面滚动。
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const z = zoom.current;
      const k = Math.min(8, Math.max(1, z.k * Math.exp(-e.deltaY * 0.0015)));
      if (k === z.k) return;
      if (k === 1) zoom.current = { k: 1, tx: 0, ty: 0 };
      else zoom.current = { k, tx: mx - ((mx - z.tx) / z.k) * k, ty: my - ((my - z.ty) / z.k) * k };
      schedule();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    schedule();
  }, [surface, path3, bands, marks, scenario, endDay, labels, todayDay, slices]);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x;
        const dy = e.clientY - drag.current.y;
        drag.current = { ...drag.current, x: e.clientX, y: e.clientY };
        if (drag.current.pan) zoom.current = { ...zoom.current, tx: zoom.current.tx + dx, ty: zoom.current.ty + dy };
        else view.current = { yaw: view.current.yaw + dx * 0.008, pitch: Math.min(1.35, Math.max(0.1, view.current.pitch + dy * 0.006)) };
        schedule();
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={() => {
        view.current = { ...DEFAULT_VIEW };
        zoom.current = { k: 1, tx: 0, ty: 0 };
        schedule();
      }}
    >
      <canvas ref={cvRef} role="img" aria-label={labels.pnl} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
