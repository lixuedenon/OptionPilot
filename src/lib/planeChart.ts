// src/lib/planeChart.ts
// 万次推演"平面"视图（推演未来、今昔对比共用）的底层画法：
// 底色只分赚/亏两区（某一天、某个股价下平仓是赚是亏），白虚线是两区分界（不赚不亏）；
// 上面叠全部走势的股价范围带（浅=10次里9次、深=一半、白线=中间）。
// 原来用的"按天归一的密度云+盈亏渐变底色"两层叠在一起什么都看不清，而且只画还拿着的走势会让云往下沉（涨的都先止盈走了）。
import type { MapModel } from "@/lib/stockOptionMap";
import type { Band } from "@/lib/futureSim";

export interface PlaneFrame {
  X: (day: number) => number;
  Y: (price: number) => number;
  left: number;
  top: number;
  width: number;
  height: number;
}

// 赚/亏两区 + 分界线。days=横轴最后一天（推演未来=到期，今昔对比=今天）。
// beColor：盈亏平衡分界线的颜色。万次推演用黄色（白色是中位数线）；今昔对比的真实走势是金色实线，那边仍用白色
export function drawZones(g: CanvasRenderingContext2D, model: MapModel, days: number, f: PlaneFrame, beColor = "rgba(251,191,36,0.95)") {
  const NX = Math.min(120, Math.max(24, Math.round(days * 3)));
  const NY = 90;
  const cw = f.width / NX, ch = f.height / NY;
  const cross: number[][] = [];
  for (let c = 0; c <= NX; c++) {
    const day = (c / NX) * days;
    const col: number[] = [];
    let prev = NaN;
    for (let r = 0; r <= NY; r++) {
      const price = model.sMax - (r / NY) * (model.sMax - model.sMin);
      const v = model.pnlAt(day, price);
      if (c < NX && r < NY) {
        // 格子对齐到整像素、互不重叠：半透明的格子一重叠就会出现一道道细缝
        const vm = model.pnlAt(day + days / NX / 2, price - (model.sMax - model.sMin) / NY / 2);
        const x0 = Math.round(f.left + c * cw), x1 = Math.round(f.left + (c + 1) * cw);
        const y0 = Math.round(f.top + r * ch), y1 = Math.round(f.top + (r + 1) * ch);
        g.fillStyle = vm >= 0 ? "rgba(16,185,129,0.16)" : "rgba(244,63,94,0.22)";
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      if (r > 0 && Number.isFinite(prev) && (prev >= 0) !== (v >= 0)) {
        const p0 = model.sMax - ((r - 1) / NY) * (model.sMax - model.sMin);
        col.push(p0 + ((price - p0) * prev) / (prev - v));
      }
      prev = v;
    }
    cross.push(col);
  }
  // 分界线：相邻两列交点个数一样时按顺序连起来
  // 黄色虚线（2026-10-08：原来白色，跟白色的中位数线分不清）
  g.strokeStyle = beColor;
  g.lineWidth = 1.6;
  g.setLineDash([5, 4]);
  for (let c = 1; c <= NX; c++) {
    const a = cross[c - 1], b = cross[c];
    if (a.length !== b.length) continue;
    for (let k = 0; k < a.length; k++) {
      g.beginPath();
      g.moveTo(f.X(((c - 1) / NX) * days), f.Y(a[k]));
      g.lineTo(f.X((c / NX) * days), f.Y(b[k]));
      g.stroke();
    }
  }
  g.setLineDash([]);
  g.lineWidth = 1;
}

// 股价范围带：浅色=5%~95%（10次里9次），深色=25%~75%（一半），白线=中位数。dayOffset：分叉云从情景点那天开始。
export function drawBands(g: CanvasRenderingContext2D, bands: Band[], f: PlaneFrame, tint = "226,232,240", dayOffset = 0) {
  if (bands.length < 2) return;
  const band = (lo: keyof Band, hi: keyof Band, a: number) => {
    g.fillStyle = `rgba(${tint},${a})`;
    g.beginPath();
    bands.forEach((b, i) => (i ? g.lineTo(f.X(b.day + dayOffset), f.Y(b[hi])) : g.moveTo(f.X(b.day + dayOffset), f.Y(b[hi]))));
    for (let i = bands.length - 1; i >= 0; i--) g.lineTo(f.X(bands[i].day + dayOffset), f.Y(bands[i][lo]));
    g.closePath();
    g.fill();
  };
  band("p5", "p95", 0.13);
  band("p25", "p75", 0.24);
  g.strokeStyle = `rgba(${tint},0.95)`;
  g.lineWidth = 2;
  g.beginPath();
  bands.forEach((b, i) => (i ? g.lineTo(f.X(b.day + dayOffset), f.Y(b.p50)) : g.moveTo(f.X(b.day + dayOffset), f.Y(b.p50))));
  g.stroke();
  g.lineWidth = 1;
}

// 范围带旁边的三句说明，贴在带子的边上（横轴60%处）。
export function labelBands(g: CanvasRenderingContext2D, bands: Band[], f: PlaneFrame, text: { mid: string; dark: string; light: string }) {
  if (bands.length < 2) return;
  const b = bands[Math.min(bands.length - 1, Math.round(bands.length * 0.6))];
  const x = f.X(b.day) + 6;
  g.font = "10px sans-serif";
  g.textAlign = "left";
  const put = (s: string, y: number, color: string) => {
    if (y < f.top + 10 || y > f.top + f.height - 4) return;
    const tw = g.measureText(s).width;
    g.fillStyle = "rgba(2,6,23,0.6)";
    g.fillRect(x - 2, y - 10, tw + 4, 13);
    g.fillStyle = color;
    g.fillText(s, x, y);
  };
  put(text.mid, f.Y(b.p50) - 4, "#f8fafc");
  put(text.dark, f.Y(b.p75) - 4, "#cbd5e1");
  put(text.light, f.Y(b.p95) - 4, "#94a3b8");
}

// 带框的文字标签，避开已经放好的标签（往下挪）。返回放好的框。
export interface Placed { x: number; y: number; w: number; h: number }
export function tagBox(
  g: CanvasRenderingContext2D, anchor: { x: number; y: number }, lines: { text: string; color: string; bold?: boolean }[],
  border: string, placed: Placed[], bounds: { left: number; right: number; top: number; bottom: number }, preferLeft = false,
) {
  g.font = "bold 11px sans-serif";
  const w = Math.max(...lines.map((l) => g.measureText(l.text).width)) + 12;
  const h = lines.length * 14 + 6;
  let x = preferLeft ? anchor.x - w - 10 : anchor.x + 10;
  if (x + w > bounds.right) x = anchor.x - w - 10;
  if (x < bounds.left) x = bounds.left;
  let y = Math.max(bounds.top, Math.min(bounds.bottom - h, anchor.y - h / 2));
  for (let k = 0; k < 8 && placed.some((p) => x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y); k++) {
    y += h + 4;
    if (y + h > bounds.bottom) y = bounds.top + k * (h + 4);
  }
  placed.push({ x, y, w, h });
  g.strokeStyle = border;
  g.globalAlpha = 0.7;
  g.beginPath();
  g.moveTo(anchor.x, anchor.y);
  g.lineTo(x < anchor.x ? x + w : x, y + h / 2);
  g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = "rgba(2,6,23,0.9)";
  g.fillRect(x, y, w, h);
  g.strokeStyle = border;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.textAlign = "left";
  lines.forEach((l, i) => {
    g.font = l.bold ? "bold 11px sans-serif" : "11px sans-serif";
    g.fillStyle = l.color;
    g.fillText(l.text, x + 6, y + 14 + i * 14);
  });
}
