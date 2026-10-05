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
  // intro=开场从正上方看（=平面图）时的提示；"网格面=盈亏0"写在legend第一行
  labels: { open: string; expiry: string; close: string; price: string; pnl: string; hint: string; time: string; legend: string[]; intro: string; today?: string };
  // 曲面上的文字标注（最赚的一片、最亏的一片、白线），看横轴最后一天那一列；不传就不标
  notes?: SurfaceNotes;
  // 在曲面上切出"某一天的盈亏曲线"（=那一天的盈亏图），比如滑块定的那天、到期那天
  slices?: { day: number; label: string; color: string }[];
  money: (v: number) => string;
  // 今昔对比回看：真实走过的路（金色粗线），走势光束只画到今天。
  actual?: { day: number; price: number }[];
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
  const { model, days, rows, density, forkDensity, forkStartDay, samples, forkSamples, exits, scenario, endDay, labels, money, actual, todayDay, notes, slices } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ ...DEFAULT_VIEW });
  const size = useRef({ w: 0, h: 0 });
  const raf = useRef(0);
  const drag = useRef<{ x: number; y: number; pan: boolean } | null>(null);
  // 放大缩小+平移：屏幕坐标 = 自动缩放居中后的坐标 × k + (tx, ty)。滚轮以鼠标所在的点为中心放大，按住Shift（或右键）拖动平移。
  const zoom = useRef({ k: 1, tx: 0, ty: 0 });

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
    // 三个轴共用一个原点：开仓那天、最低股价、盈亏0。BASE=盈亏0的高度，那里画一层网格（"0面"）：曲面在它上面是赚、下面是亏。
    const BASE = Z(0);
    const raw = (x: number, y: number, z: number) => {
      const x1 = x * cy - y * sy;
      const y1 = x * sy + y * cy;
      const u = z * cp + y1 * sp;
      const depth = y1 * cp - z * sp;
      const f = 1 / (1 + 0.14 * depth);
      return { x: x1 * f, y: -u * f, depth };
    };
    // 每次按当前角度，把真正画出来的东西（曲面上的点、0面四角、三根轴的两头）缩放、居中到画布里，转到哪个角度都不出界。
    // 不用整个盒子的八个角：盒子底面的角大多空着，按它算会在下面留一大片空白，窗口再大曲面也只占一小块。
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    const fit = (x: number, y: number, z: number) => {
      const r = raw(x, y, z);
      bx0 = Math.min(bx0, r.x); bx1 = Math.max(bx1, r.x); by0 = Math.min(by0, r.y); by1 = Math.max(by1, r.y);
    };
    const step = Math.max(1, Math.floor(surface.NX / 12));
    for (let i = 0; i < surface.NX; i += step) for (let j = 0; j < NY; j += 5) fit(X(surface.pts[i][j].day), Y(surface.pts[i][j].price), Z(surface.pts[i][j].pnl));
    for (const j of [0, NY - 1]) fit(X(surface.pts[surface.NX - 1][j].day), Y(surface.pts[surface.NX - 1][j].price), Z(surface.pts[surface.NX - 1][j].pnl));
    for (const x of [-1, 1.16]) for (const y of [-1, 1.16]) fit(x, y, Z(0));
    fit(-1, -1, Math.max(Z(model.maxProfit), Z(0) + 0.1) + 0.12);
    fit(-1, -1, Math.min(Z(-model.maxLoss), Z(0)));
    const padX = 64, padTop = 28, padBottom = 36;
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

    // 0面：先整张画一遍（曲面在它上面的地方会被曲面盖住），画完曲面后再把"曲面在0面下面"那些地方的网格补画在上层。
    g.font = "10px sans-serif";
    const GRID = [-1, -0.5, 0, 0.5, 1];
    for (const v of GRID) {
      line([-1, v, BASE], [1, v, BASE], "rgba(148,163,184,0.28)");
      line([v, -1, BASE], [v, 1, BASE], "rgba(148,163,184,0.28)");
    }
    if (endDay < days) line([X(endDay), -1, BASE], [X(endDay), 1, BASE], "rgba(251,191,36,0.6)", 1, [3, 3]);

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

    // 0面在曲面上方的部分（亏损区）：网格补画在曲面上层，看得出"这一片沉在0面下面"
    g.strokeStyle = "rgba(203,213,225,0.32)";
    g.lineWidth = 1;
    const dayOf = (x: number) => ((x + 1) / 2) * days;
    const priceOf = (y: number) => model.sMin + ((y + 1) / 2) * (model.sMax - model.sMin);
    for (const v of GRID) {
      for (const horiz of [true, false]) {
        g.beginPath();
        let on = false;
        for (let k = 0; k <= 48; k++) {
          const u = -1 + (2 * k) / 48;
          const [x, y] = horiz ? [u, v] : [v, u];
          if (model.pnlAt(dayOf(x), priceOf(y)) < 0) {
            const p = proj(x, y, BASE);
            if (on) g.lineTo(p.sx, p.sy);
            else g.moveTo(p.sx, p.sy);
            on = true;
          } else on = false;
        }
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
      line([X(todayDay), -1, BASE], [X(todayDay), 1, BASE], "rgba(251,191,36,0.7)", 1.2, [4, 3]);
      if (labels.today) text(X(todayDay), -1, BASE, labels.today, "#fbbf24", "center", 14);
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

    // 所有文字标签（曲面标注+盈亏曲线名）收在一起，最后统一摆放、避让重叠
    const tags: { x: number; y: number; text: string; color: string }[] = [];

    // 某一天的盈亏曲线（=盈亏图标签里那一天的那条线）：沿股价方向切一刀
    for (const sl of slices ?? []) {
      if (sl.day < 0 || sl.day > days) continue;
      g.strokeStyle = "rgba(2,6,23,0.85)";
      g.lineWidth = 4.5;
      const pathOf = () => {
        g.beginPath();
        for (let k = 0; k <= 60; k++) {
          const price = model.sMin + (k / 60) * (model.sMax - model.sMin);
          const p = proj(X(sl.day), Y(price), Z(model.pnlAt(sl.day, price)) + 0.015);
          if (k) g.lineTo(p.sx, p.sy);
          else g.moveTo(p.sx, p.sy);
        }
      };
      pathOf();
      g.stroke();
      g.strokeStyle = sl.color;
      g.lineWidth = 2.2;
      pathOf();
      g.stroke();
      g.lineWidth = 1;
      // 标签放到下面统一排（跟其他标注一起避让重叠），锚点在这条线上靠高价那一头
      const ap = model.sMin + 0.8 * (model.sMax - model.sMin);
      const tp = proj(X(sl.day), Y(ap), Z(model.pnlAt(sl.day, ap)) + 0.015);
      tags.push({ x: tp.sx, y: tp.sy, text: sl.label, color: sl.color });
    }

    // 情景点：从0面立一根针到曲面
    if (scenario && scenario.day <= days && scenario.price >= model.sMin && scenario.price <= model.sMax) {
      const zp = Z(model.pnlAt(scenario.day, scenario.price));
      line([X(scenario.day), Y(scenario.price), BASE], [X(scenario.day), Y(scenario.price), zp], "rgba(56,189,248,0.9)", 1.2, [4, 3]);
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

    // 曲面上的文字标注：横轴最后一天那一列里，最赚的一片、最亏的一片各标一句（价格区间+金额），白线标"不赚不亏"。
    // 转到任何角度都跟着曲面上的点走；标签框放在点的上方，用一根细线连回去。
    if (notes) {
      const col = pts[NX - 1];
      const vals = col.map((c) => c.pnl);
      const maxV = Math.max(...vals), minV = Math.min(...vals), span = maxV - minV;
      const fmtP = (x: number) => x.toFixed(x >= 100 ? 0 : 1);
      // 找出所有接近最高（最低）的连续区段：一段=某价以上/以下/之间；两头各一段（铁鹰两边都是最亏、买跨式两边都是最赚）=某价以下或某价以上
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
      // 白线：在横轴70%处那一列找盈亏穿过0的地方
      const ci = Math.round((NX - 1) * 0.7);
      for (let j = 1; j < NY; j++) {
        const a = pts[ci][j - 1], b = pts[ci][j];
        if ((a.pnl > 0) !== (b.pnl > 0)) {
          const f = a.pnl / (a.pnl - b.pnl);
          const pr = a.price + (b.price - a.price) * f;
          const pb = proj(X(a.day), Y(pr), Z(0) + 0.02);
          tags.push({ x: pb.sx, y: pb.sy, text: notes.breakeven, color: "#f8fafc" });
          break;
        }
      }
    }
    {
      g.font = "bold 11px sans-serif";
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
      const hit = (bx: number, by: number, tw: number) => placed.some((p) => bx < p.x1 && bx + tw > p.x0 && by < p.y1 && by + 18 > p.y0);
      for (const tg of tags) {
        const tw = g.measureText(tg.text).width + 10;
        const bx = Math.min(W - tw - 6, Math.max(6, tg.x - tw / 2));
        // 先试点的上方，挤了就往上挪；上面放不下再试下方
        let by = Math.max(70, tg.y - 34);
        for (let k = 0; k < 5 && hit(bx, by, tw); k++) by -= 22;
        if (by < 4 || hit(bx, by, tw)) {
          by = Math.min(H - 24, tg.y + 14);
          for (let k = 0; k < 5 && hit(bx, by, tw); k++) by += 22;
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

    // 坐标轴
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
    // 三个轴都从原点（开仓、最低股价、盈亏0）出发
    arrow([-1, -1, BASE], [1.14, -1, BASE], "rgba(203,213,225,0.85)");
    arrow([-1, -1, BASE], [-1, 1.16, BASE], "rgba(203,213,225,0.85)");
    const zTop = Math.max(Z(model.maxProfit), BASE + 0.1);
    line([-1, -1, Math.min(Z(-model.maxLoss), BASE)], [-1, -1, zTop], "rgba(203,213,225,0.85)", 1.6);
    arrow([-1, -1, zTop - 0.01], [-1, -1, zTop + 0.06], "rgba(203,213,225,0.85)");
    g.font = "bold 11px sans-serif";
    text(0, -1, BASE, labels.time, "#e2e8f0", "center", 30);
    g.font = "10px sans-serif";
    text(-1, -1, BASE, labels.open, "#94a3b8", "center", 16);
    text(1, -1, BASE, labels.expiry, "#94a3b8", "center", 14);
    if (endDay < days && endDay > 0) text(X(endDay), -1, BASE, labels.close, "#d97706", "center", 14);
    // 股价刻度：原点那一头不标（跟盈亏刻度挤在一起），最低价写在左上角说明里
    for (const f of [0.5, 1]) {
      const price = model.sMin + f * (model.sMax - model.sMin);
      text(-1, -1 + 2 * f, BASE, price.toFixed(price >= 100 ? 0 : 1), "#64748b", "right", 4);
    }
    g.font = "bold 11px sans-serif";
    text(-1.1, 0.35, BASE, labels.price, "#e2e8f0", "right", 0);
    g.font = "10px sans-serif";
    // 最大盈利/亏损离0太近时不单独标0，免得两个数字叠在一起
    const tooClose = Math.min(model.maxProfit, model.maxLoss) / zScale < 0.08;
    for (const v of tooClose ? [model.maxProfit, -model.maxLoss] : [model.maxProfit, 0, -model.maxLoss]) {
      line([-1, -1, Z(v)], [-1.04, -1, Z(v)], "rgba(148,163,184,0.8)");
      text(-1.06, -1, Z(v), v === 0 ? "0" : `${v > 0 ? "+" : "−"}${money(Math.abs(v))}`, v > 0 ? "#6ee7b7" : v < 0 ? "#fda4af" : "#e2e8f0", "right", 4);
    }
    text(-1, -1, zTop + 0.08, labels.pnl, "#e2e8f0", "center", -4);
    g.font = "10px sans-serif";
    g.fillStyle = "#64748b";
    g.textAlign = "right";
    g.fillText(labels.hint, W - 8, H - 8);
    if (zoom.current.k > 1.01) {
      g.fillStyle = "#94a3b8";
      g.fillText(`×${zoom.current.k.toFixed(1)}`, W - 8, H - 22);
    }
    // 开场从正上方看的那一会儿：告诉用户这就是平面图
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
    // 左上角说明：三个方向各代表什么（转到任何角度都看得懂）
    g.textAlign = "left";
    // 放大后曲面会铺到左上角，说明文字垫一层底色免得看不清
    const lw = Math.max(...labels.legend.map((ln) => g.measureText(ln).width));
    g.fillStyle = "rgba(2,6,23,0.75)";
    g.fillRect(4, 4, lw + 12, labels.legend.length * 15 + 4);
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

  // 开场：先从正上方往下看（这时跟平面图一模一样：横轴时间、纵轴股价、颜色是盈亏），停一下，再慢慢倾斜把盈亏立成高度。
  // 让用户一眼看出"立体图就是平面图立起来"。拖动会打断动画。
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

  // 滚轮放大缩小：以鼠标所在的点为中心（那一点放大前后不动），1～8倍。要用非passive的监听才能挡住页面跟着滚动。
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

  // 数据变了就重画
  useEffect(() => {
    schedule();
  }, [surface, colMax, forkColMax, beams, exits, scenario, endDay, labels, actual, todayDay]);

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
