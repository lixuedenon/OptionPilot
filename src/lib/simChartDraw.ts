// src/lib/simChartDraw.ts
// 胜率模拟/万次推演"高级分析"里的小图：盈亏平衡波动率曲线、年化涨跌曲线、盈亏分布。
import type { CurvePoint, DriftPoint, Histogram } from "@/lib/winRateSim";

type T = (key: string, vars?: Record<string, string | number>) => string;

function axisAndMarks(g: CanvasRenderingContext2D, W: number, H: number, xs: number[], ys: number[], money: (v: number) => string) {
  const L = 46, R = 10, T = 16, B = 20;
  const xLo = Math.min(...xs), xHi = Math.max(...xs);
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
  g.fillText(money(yHi), L - 3, T + 4);
  g.fillText(money(yLo), L - 3, H - B);
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
    const right = X(v) > W - 90;
    g.textAlign = right ? "right" : "left";
    g.fillText(label, X(v) + (right ? -3 : 3), T + 2 + row * 11);
  };
  const line = (pts: [number, number][]) => {
    g.strokeStyle = "#60a5fa";
    g.lineWidth = 2;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    g.stroke();
    g.lineWidth = 1;
  };
  return { X, H, B, mark, line };
}

// 盈亏平衡波动率曲线：横轴实际波动，纵轴平均盈亏；标出隐含/假设/平衡三条竖线。
export function drawVolCurve(
  g: CanvasRenderingContext2D, W: number, H: number,
  o: { curve: CurvePoint[]; ivCenter: number; vol: number; breakevenVol: number | null; money: (v: number) => string; t: T },
) {
  const c = o.curve;
  const a = axisAndMarks(g, W, H, c.map((x) => x.vol), c.map((x) => x.avg), o.money);
  g.textAlign = "center";
  g.fillStyle = "#64748b";
  for (let i = 0; i < c.length; i += 3) g.fillText(`${(c[i].vol * 100).toFixed(0)}%`, a.X(c[i].vol), H - 5);
  a.mark(o.ivCenter, o.t("winRate.markIv", { v: (o.ivCenter * 100).toFixed(0) }), "#a78bfa", 0);
  a.mark(o.vol, o.t("winRate.markRv", { v: (o.vol * 100).toFixed(0) }), "#fbbf24", 1);
  if (o.breakevenVol != null) a.mark(o.breakevenVol, o.t("winRate.markBev", { v: (o.breakevenVol * 100).toFixed(1) }), "#f8fafc", 2);
  a.line(c.map((x) => [x.vol, x.avg]));
}

// 买方：不同年化涨跌下的平均盈亏。
export function drawDriftCurve(
  g: CanvasRenderingContext2D, W: number, H: number,
  o: { curve: DriftPoint[]; driftPct: number; breakeven: number | null; money: (v: number) => string; t: T },
) {
  const c = o.curve;
  const a = axisAndMarks(g, W, H, c.map((x) => x.drift), c.map((x) => x.avg), o.money);
  g.textAlign = "center";
  g.fillStyle = "#64748b";
  for (let i = 0; i < c.length; i += 2) g.fillText(`${c[i].drift >= 0 ? "+" : ""}${Math.round(c[i].drift * 100)}%`, a.X(c[i].drift), H - 5);
  a.mark(o.driftPct / 100, o.t("winRate.markDrift", { v: o.driftPct }), "#fbbf24", 0);
  if (o.breakeven != null) a.mark(o.breakeven, o.t("winRate.markDriftBe", { v: (o.breakeven * 100).toFixed(1) }), "#f8fafc", 1);
  a.line(c.map((x) => [x.drift, x.avg]));
}

// 1万次结果的盈亏分布。
export function drawPnlHist(g: CanvasRenderingContext2D, W: number, H: number, h: Histogram, money: (v: number) => string) {
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
}

// 阶梯图（瀑布图）：开仓0 → 股价 → 时间 → 隐含波动率 → 调整 → 终点。
// 高度由调用方的容器定死；纵向按这几根柱子自己缩放，但跨度至少minSpan——都接近0时（滑块刚动一点）不会把几分钱放大成满屏的柱子。
export function drawWaterfall(
  g: CanvasRenderingContext2D, W: number, H: number, steps: { label: string; v: number }[], end: number, openLabel: string, endLabel: string,
  minSpan = 0,
) {
  const bars: { label: string; from: number; to: number; kind: "step" | "end" }[] = [{ label: openLabel, from: 0, to: 0, kind: "end" }];
  let acc = 0;
  for (const st of steps) {
    bars.push({ label: st.label, from: acc, to: acc + st.v, kind: "step" });
    acc += st.v;
  }
  bars.push({ label: endLabel, from: 0, to: end, kind: "end" });
  let lo = Math.min(0, ...bars.flatMap((b) => [b.from, b.to]));
  let hi = Math.max(0, ...bars.flatMap((b) => [b.from, b.to]));
  if (hi - lo < minSpan) {
    // 不够minSpan时按现有正负比例往两边补
    const extra = minSpan - (hi - lo);
    const up = hi - lo > 0 ? hi / (hi - lo) : 0.5;
    hi += extra * up;
    lo -= extra * (1 - up);
  }
  const T = 14, B = 16, L = 4, R = 4;
  const Yv = (v: number) => T + ((hi - v) / (hi - lo || 1)) * (H - T - B);
  const bw = (W - L - R) / bars.length;
  g.strokeStyle = "rgba(148,163,184,0.5)";
  g.beginPath();
  g.moveTo(L, Yv(0));
  g.lineTo(W - R, Yv(0));
  g.stroke();
  g.font = "10px sans-serif";
  g.textAlign = "center";
  bars.forEach((b, i) => {
    const x = L + i * bw + bw * 0.18;
    const w = bw * 0.64;
    const y0 = Yv(Math.max(b.from, b.to)), y1 = Yv(Math.min(b.from, b.to));
    const v = b.to - b.from;
    g.fillStyle = b.kind === "end" ? (b.to >= 0 ? "#10b981" : "#f43f5e") : v >= 0 ? "rgba(52,211,153,0.75)" : "rgba(251,113,133,0.75)";
    g.fillRect(x, y0, w, Math.max(1.5, y1 - y0));
    if (i < bars.length - 1 && b.kind === "step") {
      g.strokeStyle = "rgba(148,163,184,0.5)";
      g.setLineDash([2, 2]);
      g.beginPath();
      g.moveTo(x + w, Yv(b.to));
      g.lineTo(x + bw, Yv(b.to));
      g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = "#cbd5e1";
    const shownV = b.kind === "end" ? b.to : v;
    if (!(b.kind === "end" && i === 0)) g.fillText(`${shownV >= 0 ? "+" : "−"}$${Math.abs(shownV).toFixed(2)}`.replace(".00", ""), x + w / 2, Math.max(10, y0 - 3));
    g.fillStyle = "#94a3b8";
    g.fillText(b.label, x + w / 2, H - 4);
  });
}
