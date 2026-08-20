import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { Leg, Shifts } from "@/lib/types";
import { blackScholes } from "@/lib/bs";
import { useI18n } from "@/i18n/I18nContext";
import { RefreshCw } from "lucide-react";

export type AlertZone = "golden" | "danger" | "stop" | null;
export interface AlertInfo {
  zone: AlertZone;
  pnl: number;
  netCredit: number;
  capturedPct: number;
  days: number;
  stock: boolean;
  maxProfit: number;
  maxLoss: number;
}

interface PerLegValue {
  leg: Leg;
  shifted: number;
  change: { total: number };
}

interface Props {
  legs: Leg[];
  spot: number;
  shifts: Shifts;
  symbol: string;
  pop: number;
  breakevens: number[];
  trackedLegs?: Leg[];   // 持仓组合 — drawn as a fixed curve, not affected by shifts
  trackedSpot?: number;  // 持仓组合's current spot price
  openingLegs?: Leg[];   // 开仓组合 — original legs used as cost basis for tracked P&L curve
  compareMode?: boolean; // when true, headline P&L / alert / spot marker use tracked combo
  perLegValues?: PerLegValue[];
  netValue?: number;
  netChange?: number;
  onAlert?: (info: AlertInfo) => void;
  correctedSpot?: number | null;
  correcting?: boolean;
  onCorrectSpot?: () => void;
  symbolForCorrect?: string;
}

const POINTS = 200;
const RATE = 0.05;
const PAD = { t: 12, r: 16, b: 32, l: 52 };

function impliedVol(spot: number, strike: number, dte: number, premium: number, type: "call" | "put"): number {
  let lo = 0.01, hi = 5.0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const p = blackScholes({ spot, strike, dte, vol: mid, rate: RATE, type }).price;
    if (p < premium) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function calcPnL(legs: Leg[], spot: number, shifts: Shifts, sTest: number): number {
  let pnl = 0;
  const volBump = shifts.dV / 100;
  for (const l of legs) {
    const sign = l.action === "buy" ? 1 : -1;
    if (l.kind === "stock") { pnl += sign * (sTest - l.strike); continue; }
    const qty = l.qty ?? 1;
    const iv = impliedVol(spot, l.strike, l.dte, l.premium, l.type);
    const newDte = Math.max(0, l.dte - shifts.dT);
    const newVol = Math.max(0.01, iv + volBump);
    let newPrice: number;
    if (newDte <= 0) {
      newPrice = l.type === "call" ? Math.max(0, sTest - l.strike) : Math.max(0, l.strike - sTest);
    } else {
      newPrice = blackScholes({ spot: sTest, strike: l.strike, dte: newDte, vol: newVol, rate: RATE, type: l.type }).price;
    }
    pnl += sign * qty * (newPrice - l.premium);
  }
  return pnl;
}

function calcPnLAtTime(legs: Leg[], spot: number, sTest: number, daysElapsed: number): number {
  let pnl = 0;
  for (const l of legs) {
    const sign = l.action === "buy" ? 1 : -1;
    if (l.kind === "stock") { pnl += sign * (sTest - l.strike); continue; }
    const qty = l.qty ?? 1;
    const iv = impliedVol(spot, l.strike, l.dte, l.premium, l.type);
    const newDte = Math.max(0, l.dte - daysElapsed);
    let newPrice: number;
    if (newDte <= 0) {
      newPrice = l.type === "call" ? Math.max(0, sTest - l.strike) : Math.max(0, l.strike - sTest);
    } else {
      newPrice = blackScholes({ spot: sTest, strike: l.strike, dte: newDte, vol: iv, rate: RATE, type: l.type }).price;
    }
    pnl += sign * qty * (newPrice - l.premium);
  }
  return pnl;
}

// P&L of a tracked position using opening premium as cost basis.
// Pricing uses the tracked leg's current DTE and IV (back-solved from current premium),
// but profit is measured against what was originally paid (openingLegs premium).
function calcTrackedPnL(trackedLegs: Leg[], openingLegs: Leg[], spot: number, sTest: number): number {
  let pnl = 0;
  for (let i = 0; i < trackedLegs.length; i++) {
    const l = trackedLegs[i];
    const open = openingLegs[i];
    const sign = l.action === "buy" ? 1 : -1;
    if (l.kind === "stock") { pnl += sign * (sTest - l.strike); continue; }
    const qty = l.qty ?? 1;
    const iv = impliedVol(spot, l.strike, l.dte, l.premium, l.type);
    let newPrice: number;
    if (l.dte <= 0) {
      newPrice = l.type === "call" ? Math.max(0, sTest - l.strike) : Math.max(0, l.strike - sTest);
    } else {
      newPrice = blackScholes({ spot: sTest, strike: l.strike, dte: l.dte, vol: iv, rate: RATE, type: l.type }).price;
    }
    pnl += sign * qty * (newPrice - (open?.premium ?? l.premium));
  }
  return pnl;
}

function calcTrackedPnLAtTime(trackedLegs: Leg[], openingLegs: Leg[], spot: number, sTest: number, daysElapsed: number): number {
  let pnl = 0;
  for (let i = 0; i < trackedLegs.length; i++) {
    const l = trackedLegs[i];
    const open = openingLegs[i];
    const sign = l.action === "buy" ? 1 : -1;
    if (l.kind === "stock") { pnl += sign * (sTest - l.strike); continue; }
    const qty = l.qty ?? 1;
    const iv = impliedVol(spot, l.strike, l.dte, l.premium, l.type);
    const newDte = Math.max(0, l.dte - daysElapsed);
    let newPrice: number;
    if (newDte <= 0) {
      newPrice = l.type === "call" ? Math.max(0, sTest - l.strike) : Math.max(0, l.strike - sTest);
    } else {
      newPrice = blackScholes({ spot: sTest, strike: l.strike, dte: newDte, vol: iv, rate: RATE, type: l.type }).price;
    }
    pnl += sign * qty * (newPrice - (open?.premium ?? l.premium));
  }
  return pnl;
}

function hasStock(legs: Leg[]): boolean {
  return legs.some((l) => l.kind === "stock");
}

type Zone = "golden" | "great" | "danger" | "stop" | "neutral";

function getZone(pnl: number, netCredit: number, maxProfit: number, maxLoss: number, stock: boolean): Zone {
  if (stock) {
    const maxP = maxProfit > 0 ? maxProfit : 1;
    const maxL = maxLoss < 0 ? maxLoss : -1;
    if (pnl >= 0.5 * maxP && pnl <= 0.8 * maxP) return "golden";
    if (pnl > 0.8 * maxP) return "great";
    if (pnl <= 0.5 * maxL) return "danger";
    if (pnl <= 0.8 * maxL) return "stop";
    return "neutral";
  }
  if (netCredit > 0) {
    if (pnl < -1.5 * netCredit) return "stop";
    if (pnl < -netCredit) return "danger";
    if (pnl >= 0.5 * netCredit && pnl <= 0.7 * netCredit) return "golden";
    if (pnl > 0.7 * netCredit) return "great";
  } else {
    const maxP = maxProfit > 0 ? maxProfit : 1;
    if (pnl >= 0.5 * maxP) return "golden";
    if (pnl > 0.7 * maxP) return "great";
    const cost = Math.abs(netCredit);
    if (pnl < -0.5 * cost) return "danger";
    if (pnl < -0.8 * cost) return "stop";
  }
  return "neutral";
}

const FAN_COLORS = ["#fbbf24", "#f59e0b", "#a3a3a3", "#475569"];

export default function PayoffChart({ legs, spot, shifts, symbol, breakevens, trackedLegs, trackedSpot, openingLegs, compareMode, perLegValues, netValue, netChange, onAlert, correctedSpot, correcting, onCorrectSpot, symbolForCorrect }: Props) {
  const { t } = useI18n();
  const [showFan, setShowFan] = useState(false);
  const [showImpliedInfo, setShowImpliedInfo] = useState(false);
  const [xZoom, setXZoom] = useState(1);
  const [xPanFrac, setXPanFrac] = useState(0); // fraction of baseRange to shift center
  const [dims, setDims] = useState({ w: 560, h: 360 });

  const FAN_LABELS = [t("chart.fanToday"), t("chart.fan13"), t("chart.fan23"), t("chart.fanExpiry")];

  const svgContainerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startPan: number } | null>(null);
  const isDragging = useRef(false);

  const active = legs.length > 0 && spot > 0;
  const stock = hasStock(compareMode && trackedLegs ? trackedLegs : legs);

  useEffect(() => {
    const el = svgContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) setDims({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  const W = dims.w;
  const H = dims.h;
  const CW = W - PAD.l - PAD.r;
  const CH = H - PAD.t - PAD.b;

  // Base range (unzoomed)
  const baseRange = active ? Math.max(20, spot * 0.55) : 20;

  // Zoomed + panned window
  const zoomedRange = baseRange / xZoom;
  const centerSpot = active ? spot + xPanFrac * baseRange : 100;
  const sMin = Math.max(0.01, centerSpot - zoomedRange);
  const sMax = centerSpot + zoomedRange;

  const resetView = useCallback(() => {
    setXZoom(1);
    setXPanFrac(0);
  }, []);

  // Wheel = zoom, centered on mouse X position within chart
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    if (!svgContainerRef.current) return;
    const rect = svgContainerRef.current.getBoundingClientRect();
    // Map mouse X to chart fraction [0,1]
    const chartLeft = rect.left + rect.width * (PAD.l / W);
    const chartWidth = rect.width * (CW / W);
    const mouseFrac = Math.max(0, Math.min(1, (e.clientX - chartLeft) / chartWidth));
    // The spot price under the mouse cursor in current view
    const mouseSpot = sMin + mouseFrac * (sMax - sMin);

    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    const newZoom = Math.max(1, Math.min(10, xZoom * factor));

    // Adjust pan so mouseSpot stays fixed under cursor
    const newZoomedRange = baseRange / newZoom;
    const newSMin = mouseSpot - mouseFrac * 2 * newZoomedRange;
    const newCenter = newSMin + newZoomedRange;
    const newPanFrac = (newCenter - spot) / baseRange;

    setXZoom(newZoom);
    setXPanFrac(Math.max(-3, Math.min(3, newPanFrac)));
  }, [xZoom, xPanFrac, sMin, sMax, baseRange, spot]);

  useEffect(() => {
    const el = svgContainerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = false;
    dragRef.current = { startX: e.clientX, startPan: xPanFrac };
  }, [xPanFrac]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current || !svgContainerRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    if (Math.abs(dx) > 3) isDragging.current = true;
    if (!isDragging.current) return;
    const rect = svgContainerRef.current.getBoundingClientRect();
    const chartWidth = rect.width * (CW / W);
    // drag right → pan left (lower prices), drag left → pan right
    const dxFrac = -(dx / chartWidth) * (2 * zoomedRange / baseRange);
    const newPan = Math.max(-3, Math.min(3, dragRef.current.startPan + dxFrac));
    setXPanFrac(newPan);
  }, [zoomedRange, baseRange]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    isDragging.current = false;
  }, []);

  const baseLegs = compareMode && trackedLegs ? trackedLegs : legs;
  const netCredit = useMemo(
    () => baseLegs.reduce((acc, l) => acc + (l.kind === "stock" ? 0 : (l.action === "sell" ? l.premium : -l.premium) * (l.qty ?? 1)), 0),
    [baseLegs]
  );
  const maxDte = useMemo(
    () => baseLegs.length > 0 ? Math.max(...baseLegs.filter(l => l.kind !== "stock").map((l) => l.dte), 0) : 30,
    [baseLegs]
  );

  const FAN_SLICES = useMemo(
    () => [0, Math.round(maxDte / 3), Math.round((2 * maxDte) / 3), maxDte],
    [maxDte]
  );

  const points = useMemo(() => {
    if (!active) return [];
    const pts: { s: number; pnl: number }[] = [];
    for (let i = 0; i <= POINTS; i++) {
      const s = sMin + (i / POINTS) * (sMax - sMin);
      pts.push({ s, pnl: calcPnL(legs, spot, shifts, s) });
    }
    return pts;
  }, [active, legs, spot, shifts, sMin, sMax]);

  // Tracked (持仓组合) — model curve anchored to the actual current P&L.
  const hasTracked = (trackedLegs?.length ?? 0) > 0;
  const trackedCurrentPnl = compareMode && hasTracked && openingLegs && netChange !== undefined ? netChange : null;
  // In compare mode, the current stock price is always the live quote (trackedSpot),
  // continuously updated from the stock-quote feed. Premiums are user-input.
  const effectiveTrackedSpot = trackedSpot ?? spot;
  const trackedPoints = useMemo(() => {
    if (!active || !hasTracked || !trackedLegs) return [];
    const openLegs = openingLegs ?? trackedLegs;
    const anchorSpot = effectiveTrackedSpot;
    const modelAtAnchor = calcTrackedPnL(trackedLegs, openLegs, anchorSpot, anchorSpot);
    const anchorOffset = trackedCurrentPnl === null ? 0 : trackedCurrentPnl - modelAtAnchor;
    const pts: { s: number; pnl: number }[] = [];
    for (let i = 0; i <= POINTS; i++) {
      const s = sMin + (i / POINTS) * (sMax - sMin);
      pts.push({ s, pnl: calcTrackedPnL(trackedLegs, openLegs, anchorSpot, s) + anchorOffset });
    }
    return pts;
  }, [active, hasTracked, trackedLegs, openingLegs, effectiveTrackedSpot, trackedCurrentPnl, sMin, sMax]);

  const fanPaths = useMemo(() => {
    if (!active || !showFan) return [];
    const fanLegs = compareMode && trackedLegs ? trackedLegs : legs;
    const fanSpot = compareMode && hasTracked ? effectiveTrackedSpot : spot;
    const openLegs = compareMode && openingLegs ? openingLegs : fanLegs;
    return FAN_SLICES.map((days) => {
      const pts: { s: number; pnl: number }[] = [];
      for (let i = 0; i <= POINTS; i++) {
        const s = sMin + (i / POINTS) * (sMax - sMin);
        pts.push({ s, pnl: compareMode && trackedLegs ? calcTrackedPnLAtTime(fanLegs, openLegs, fanSpot, s, days) : calcPnLAtTime(fanLegs, fanSpot, s, days) });
      }
      return pts;
    });
  }, [active, showFan, FAN_SLICES, legs, spot, trackedLegs, trackedSpot, openingLegs, compareMode, sMin, sMax]);

  const { rawMin, rawMax, maxProfit, maxProfitS, maxLoss, maxLossS } = useMemo(() => {
    const src = compareMode && trackedPoints.length > 0 ? trackedPoints : points;
    if (src.length === 0) return { rawMin: -1, rawMax: 1, maxProfit: 0, maxProfitS: 100, maxLoss: 0, maxLossS: 100 };
    let maxProfit = -Infinity, maxProfitS = 0, maxLoss = Infinity, maxLossS = 0;
    let rawMin = Infinity, rawMax = -Infinity;
    for (const p of src) {
      if (p.pnl < rawMin) rawMin = p.pnl;
      if (p.pnl > rawMax) rawMax = p.pnl;
      if (p.pnl > maxProfit) { maxProfit = p.pnl; maxProfitS = p.s; }
      if (p.pnl < maxLoss) { maxLoss = p.pnl; maxLossS = p.s; }
    }
    // Include both curves in Y bounds
    for (const p of points) {
      if (p.pnl < rawMin) rawMin = p.pnl;
      if (p.pnl > rawMax) rawMax = p.pnl;
    }
    for (const p of trackedPoints) {
      if (p.pnl < rawMin) rawMin = p.pnl;
      if (p.pnl > rawMax) rawMax = p.pnl;
    }
    if (trackedCurrentPnl !== null) {
      rawMin = Math.min(rawMin, trackedCurrentPnl);
      rawMax = Math.max(rawMax, trackedCurrentPnl);
    }
    return { rawMin, rawMax, maxProfit, maxProfitS, maxLoss, maxLossS };
  }, [points, trackedPoints, compareMode]);

  const fanBounds = useMemo(() => {
    if (!showFan || fanPaths.length === 0) return { fMin: 0, fMax: 0 };
    let fMin = Infinity, fMax = -Infinity;
    for (const path of fanPaths) {
      for (const p of path) {
        if (p.pnl < fMin) fMin = p.pnl;
        if (p.pnl > fMax) fMax = p.pnl;
      }
    }
    return { fMin: Number.isFinite(fMin) ? fMin : 0, fMax: Number.isFinite(fMax) ? fMax : 0 };
  }, [showFan, fanPaths]);

  const yPad = Math.max(0.5, (Math.max(rawMax, fanBounds.fMax) - Math.min(rawMin, fanBounds.fMin)) * 0.1);
  const yMin = Math.min(rawMin, fanBounds.fMin) - yPad;
  const yMax = Math.max(rawMax, fanBounds.fMax) + yPad;

  const ySpan = yMax - yMin || 1;
  const toX = (s: number) => PAD.l + ((s - sMin) / (sMax - sMin || 1)) * CW;
  const toY = (pnl: number) => PAD.t + (1 - (pnl - yMin) / ySpan) * CH;
  const zeroY = toY(0);
  const currentSpot = compareMode && hasTracked ? effectiveTrackedSpot : (active ? spot + shifts.dS : spot);
  const currentX = toX(currentSpot);

  const currentPnL = useMemo(
    () => compareMode && hasTracked && openingLegs && netChange !== undefined
      ? netChange
      : (active ? calcPnL(legs, spot, shifts, currentSpot) : 0),
    [compareMode, hasTracked, openingLegs, netChange, active, legs, spot, shifts, currentSpot]
  );
  const currentZone = getZone(currentPnL, netCredit, maxProfit, maxLoss, stock);
  const capturedPct = stock
    ? (maxProfit > 0 ? (currentPnL / maxProfit) * 100 : 0)
    : (netCredit > 0 ? (currentPnL / netCredit) * 100 : 0);
  const alertZone: AlertZone = (currentZone === "golden" || currentZone === "danger" || currentZone === "stop") ? currentZone : null;

  useEffect(() => {
    onAlert?.({ zone: alertZone, pnl: currentPnL, netCredit, capturedPct, days: compareMode ? 0 : shifts.dT, stock, maxProfit, maxLoss });
  }, [alertZone, currentPnL, netCredit, capturedPct, compareMode, shifts.dT, onAlert, stock, maxProfit, maxLoss]);

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-600">
        {spot <= 0 ? t("chart.noSpot") : t("chart.addLegs")}
      </div>
    );
  }

  if (CW <= 0 || CH <= 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-600">
        {t("chart.tooSmall")}
      </div>
    );
  }

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.s).toFixed(1)},${toY(p.pnl).toFixed(1)}`)
    .join(" ");

  const fanPathDs = fanPaths.map((path) =>
    path.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.s).toFixed(1)},${toY(p.pnl).toFixed(1)}`).join(" ")
  );

  const profitD =
    `M${toX(sMin).toFixed(1)},${zeroY.toFixed(1)} ` +
    points.map((p) => `L${toX(p.s).toFixed(1)},${Math.min(toY(p.pnl), zeroY).toFixed(1)}`).join(" ") +
    ` L${toX(sMax).toFixed(1)},${zeroY.toFixed(1)} Z`;

  const lossD =
    `M${toX(sMin).toFixed(1)},${zeroY.toFixed(1)} ` +
    points.map((p) => `L${toX(p.s).toFixed(1)},${Math.max(toY(p.pnl), zeroY).toFixed(1)}`).join(" ") +
    ` L${toX(sMax).toFixed(1)},${zeroY.toFixed(1)} Z`;

  const yTicks = (() => {
    const span = yMax - yMin;
    const nice = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
    const step = nice.find((n) => span / n <= 6) ?? 500;
    const ticks: number[] = [];
    const start = Math.ceil(yMin / step) * step;
    for (let v = start; v <= yMax + 0.001; v += step) ticks.push(parseFloat(v.toFixed(4)));
    return ticks;
  })();

  // More x-ticks when zoomed in so labels don't crowd
  const xTickCount = xZoom >= 3 ? 8 : xZoom >= 2 ? 6 : 4;
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => sMin + (i / xTickCount) * (sMax - sMin));

  const strikes = [...new Set(baseLegs.filter(l => l.kind !== "stock").map((l) => l.strike))];

  const zoneBands = (() => {
    if (stock) {
      const maxP = maxProfit > 0 ? maxProfit : 0;
      const maxL = maxLoss < 0 ? maxLoss : 0;
      return {
        golden: maxP > 0 ? { y1: toY(0.8 * maxP), y2: toY(0.5 * maxP) } : null,
        stop:   maxL < 0 ? { y1: toY(0.5 * maxL), y2: toY(0.8 * maxL) } : null,
      };
    }
    if (netCredit > 0) {
      return {
        golden: { y1: toY(0.7 * netCredit), y2: toY(0.5 * netCredit) },
        stop:   { y1: toY(-netCredit), y2: toY(-1.5 * netCredit) },
      };
    }
    return { golden: null, stop: null };
  })();

  const isZoomed = xZoom > 1.01;

  return (
    <div className="flex h-full flex-col">
      {/* Headline P&L + per-leg values */}
      <div className="mb-1 flex flex-col gap-0.5 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-extrabold text-slate-50">{symbol}</span>
            <span className="text-[9px] text-slate-500">{t("chart.currentPnl")}</span>
          </div>
          <div className="flex items-baseline gap-3">
            <div className="flex items-center gap-2">
              {(() => {
                const isFlat = Math.abs(currentPnL) < 0.005; // rounds to $0.00 either way — treat as break-even, not a signed P&L
                const sign = isFlat ? "flat" : currentPnL > 0 ? "profit" : "loss";
                const amountCls = sign === "profit" ? "text-emerald-400" : sign === "loss" ? "text-rose-400" : "text-slate-300";
                const labelCls = sign === "profit" ? "text-emerald-500" : sign === "loss" ? "text-rose-500" : "text-slate-500";
                const label = sign === "profit" ? t("chart.profit") : sign === "loss" ? t("chart.loss") : t("chart.flat");
                return (
                  <>
                    <span className={`text-lg font-black tabular-nums leading-none ${amountCls}`}>
                      {sign === "profit" ? "+" : ""}${Math.abs(currentPnL).toFixed(2)}
                    </span>
                    <span className={`text-[9px] font-bold ${labelCls}`}>{label}</span>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
        {perLegValues && perLegValues.length > 0 && (
          <div className="flex flex-wrap items-center gap-0.5">
            <span className="text-[8px] uppercase tracking-wide text-slate-600">{t("chart.perLeg")}</span>
            {perLegValues.map(({ leg, shifted, change }) => (
              <div key={leg.id} className="flex items-center gap-0.5 rounded border border-slate-800 bg-slate-900/60 px-1.5 py-0 text-[9px]">
                <span className={leg.action === "buy" ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                  {leg.action === "buy" ? t("saveStrategy.buy") : t("saveStrategy.sell")}
                </span>
                <span className="text-slate-400">{leg.kind === "stock" ? "S" : leg.type === "call" ? "C" : "P"}</span>
                <span className="text-slate-500">{leg.strike}</span>
                <span className="font-semibold tabular-nums text-slate-200">{Math.abs(shifted).toFixed(2)}</span>
                <span className={"tabular-nums " + (change.total >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {change.total >= 0 ? "+" : ""}{change.total.toFixed(2)}
                </span>
              </div>
            ))}
            {netValue !== undefined && (
              <span className="ml-auto shrink-0 rounded border border-slate-700 bg-slate-900 px-1.5 py-0 text-[9px]">
                <span className="text-slate-500">{t("chart.net")} </span>
                <span className="font-bold tabular-nums text-slate-100">${Math.abs(netValue).toFixed(2)}</span>
                {netChange !== undefined && (
                  <span className={"ml-1 font-semibold tabular-nums " + (netChange >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {netChange >= 0 ? "+" : ""}{netChange.toFixed(2)}
                  </span>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Main Chart */}
      <div className="relative flex-1 min-h-0">
        {/* Top-right controls */}
        <div className="absolute right-0 top-0 z-10 flex items-center gap-1">
          {isZoomed && (
            <button
              onClick={resetView}
              className="flex items-center gap-1 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
              title={t("chart.resetView")}
            >
              <span>↺</span>
              <span>{t("chart.resetView")}</span>
            </button>
          )}
          {isZoomed && (
            <span className="rounded border border-slate-700/60 bg-slate-900/80 px-1.5 py-0.5 text-[9px] tabular-nums text-slate-400">
              {xZoom.toFixed(1)}×
            </span>
          )}
          <button
            onClick={() => setShowFan((v) => !v)}
            className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 transition hover:text-slate-300"
            title={t("chart.timeDecay")}
          >
            <span className="relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors" style={{ backgroundColor: showFan ? "#fbbf24" : "rgb(51 65 85)" }}>
              <span
                className="inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform"
                style={{ transform: showFan ? "translateX(11px)" : "translateX(1px)" }}
              />
            </span>
            <span className={showFan ? "text-amber-300" : "text-slate-500"}>{t("chart.timeDecay")}</span>
          </button>
        </div>

        {/* Fan legend */}
        {showFan && (
          <div className="absolute left-0 top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-800 bg-slate-950/80 px-2 py-1 text-[10px] backdrop-blur-sm">
            {FAN_LABELS.map((label, i) => (
              <span key={label} className="flex items-center gap-1">
                <span
                  className="inline-block h-0.5 w-3 rounded"
                  style={{
                    backgroundColor: FAN_COLORS[i],
                    borderTop: i === 0 ? "none" : "2px dashed " + FAN_COLORS[i],
                    height: i === 0 ? 2 : 0,
                  }}
                />
                <span className="text-slate-400">{label}</span>
              </span>
            ))}
          </div>
        )}

        {/* Zoom hint — only when not zoomed */}
        {!isZoomed && (
          <div className="pointer-events-none absolute bottom-6 right-0 z-10 text-[9px] text-slate-600">
            {t("chart.zoomHint")}
          </div>
        )}

        <div
          ref={svgContainerRef}
          className="h-full w-full"
          style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" style={{ overflow: "visible", display: "block" }}>
            <defs>
              <clipPath id="chart-clip">
                <rect x={PAD.l} y={PAD.t} width={CW} height={CH} />
              </clipPath>
            </defs>

            {/* Grid */}
            {yTicks.map((v) => (
              <line key={v} x1={PAD.l} x2={PAD.l + CW} y1={toY(v)} y2={toY(v)} stroke="rgb(51 65 85)" strokeWidth="0.5" />
            ))}

            {/* Golden zone band */}
            {zoneBands.golden && (() => {
              const { y1, y2 } = zoneBands.golden;
              if (Math.min(y1, y2) >= PAD.t + CH || Math.max(y1, y2) <= PAD.t) return null;
              return <rect x={PAD.l} y={Math.min(y1, y2)} width={CW} height={Math.abs(y2 - y1)} fill="rgba(52,211,153,0.06)" clipPath="url(#chart-clip)" />;
            })()}

            {/* Stop zone band */}
            {zoneBands.stop && (() => {
              const { y1, y2 } = zoneBands.stop;
              const yTop = Math.min(y1, y2), yBot = Math.max(y1, y2);
              if (yTop >= PAD.t + CH || yBot <= PAD.t) return null;
              return (
                <rect x={PAD.l} y={Math.max(PAD.t, yTop)} width={CW}
                  height={Math.min(yBot, PAD.t + CH) - Math.max(PAD.t, yTop)}
                  fill="rgba(244,63,94,0.07)" clipPath="url(#chart-clip)" />
              );
            })()}

            {/* Strike lines */}
            {strikes.map((k) => (
              <line key={k} x1={toX(k)} x2={toX(k)} y1={PAD.t} y2={PAD.t + CH}
                stroke="rgb(148 163 184)" strokeWidth="0.8" strokeDasharray="3 3" clipPath="url(#chart-clip)" />
            ))}

            {/* Breakeven lines */}
            {breakevens.map((be, i) => {
              const bx = toX(be);
              if (bx < PAD.l || bx > PAD.l + CW) return null;
              const labelAtTop = i % 2 === 1;
              const labelY = labelAtTop ? PAD.t + 2 : PAD.t + CH - 14;
              return (
                <g key={`be-${i}`} clipPath="url(#chart-clip)">
                  <line x1={bx} x2={bx} y1={PAD.t} y2={PAD.t + CH}
                    stroke="rgb(56 189 248)" strokeWidth="1.2" strokeDasharray="4 2" />
                  <rect x={bx - 26} y={labelY} width={52} height={14} rx={2} fill="rgb(15 23 42)" fillOpacity={0.9} />
                  <text x={bx} y={labelY + 10} textAnchor="middle" fontSize="9" fill="rgb(56 189 248)" fontWeight="bold">
                    BEP {be.toFixed(1)}
                  </text>
                </g>
              );
            })}

            {/* Profit fill */}
            <path d={profitD} fill="rgb(16 185 129)" fillOpacity="0.15" clipPath="url(#chart-clip)" />
            {/* Loss fill */}
            <path d={lossD} fill="rgb(244 63 94)" fillOpacity="0.15" clipPath="url(#chart-clip)" />

            {/* Zero line */}
            {zeroY >= PAD.t && zeroY <= PAD.t + CH && (
              <line x1={PAD.l} x2={PAD.l + CW} y1={zeroY} y2={zeroY} stroke="rgb(100 116 139)" strokeWidth="1" />
            )}

            {/* Fan curves */}
            {showFan && fanPathDs.map((d, i) => (
              <path key={`fan-${i}`} d={d} fill="none" stroke={FAN_COLORS[i]}
                strokeWidth={i === 0 ? 1.5 : 1.2} strokeDasharray={i === 0 ? "none" : "4 3"}
                opacity={0.85} clipPath="url(#chart-clip)" />
            ))}

            {/* Golden zone label */}
            {zoneBands.golden && (() => {
              const { y1, y2 } = zoneBands.golden;
              const midY = (y1 + y2) / 2;
              if (midY < PAD.t || midY > PAD.t + CH) return null;
              const label = stock ? t("chart.goldenZoneStock") : t("chart.goldenZone");
              return (
                <g clipPath="url(#chart-clip)">
                  <line x1={PAD.l - 4} x2={PAD.l + CW} y1={y2} y2={y2} stroke="rgba(52,211,153,0.35)" strokeWidth="0.8" strokeDasharray="3 2" />
                  <line x1={PAD.l - 4} x2={PAD.l + CW} y1={y1} y2={y1} stroke="rgba(52,211,153,0.35)" strokeWidth="0.8" strokeDasharray="3 2" />
                  <rect x={PAD.l + CW - 60} y={midY - 8} width={58} height={13} rx={2} fill="rgba(16,42,28,0.9)" />
                  <text x={PAD.l + CW - 31} y={midY + 1} textAnchor="middle" fontSize="7.5" fill="rgba(52,211,153,0.9)" fontWeight="bold">{label}</text>
                </g>
              );
            })()}

            {/* Stop zone label */}
            {zoneBands.stop && (() => {
              const { y1, y2 } = zoneBands.stop;
              const midY = (y1 + y2) / 2;
              if (midY < PAD.t || midY > PAD.t + CH) return null;
              const label = stock ? t("chart.stopZoneStock") : t("chart.stopZone");
              return (
                <g clipPath="url(#chart-clip)">
                  <line x1={PAD.l - 4} x2={PAD.l + CW} y1={y1} y2={y1} stroke="rgba(244,63,94,0.4)" strokeWidth="0.8" strokeDasharray="3 2" />
                  <line x1={PAD.l - 4} x2={PAD.l + CW} y1={y2} y2={y2} stroke="rgba(244,63,94,0.4)" strokeWidth="0.8" strokeDasharray="3 2" />
                  <rect x={PAD.l + CW - 60} y={midY - 8} width={58} height={13} rx={2} fill="rgba(42,10,18,0.9)" />
                  <text x={PAD.l + CW - 31} y={midY + 1} textAnchor="middle" fontSize="7.5" fill="rgba(244,63,94,0.9)" fontWeight="bold">{label}</text>
                </g>
              );
            })()}

            {/* Main P&L curve */}
            <path d={pathD} fill="none" stroke="#34d399" strokeWidth="2" clipPath="url(#chart-clip)" />

            {/* Tracked (current combo) — fixed curve */}
            {hasTracked && trackedPoints.length > 0 && (() => {
              const d = trackedPoints.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.s).toFixed(1)},${toY(p.pnl).toFixed(1)}`).join(" ");
              return <path d={d} fill="none" stroke="#f43f5e" strokeWidth="2" strokeDasharray="6 3" clipPath="url(#chart-clip)" />;
            })()}

            {/* Max profit annotation */}
            {maxProfit > 0.5 && (() => {
              const px = toX(maxProfitS), py = toY(maxProfit);
              if (px < PAD.l || px > PAD.l + CW) return null;
              return (
                <g clipPath="url(#chart-clip)">
                  <circle cx={px} cy={py} r="3" fill="#34d399" stroke="#1e293b" strokeWidth="1" />
                  <rect x={px - 28} y={py - 16} width={56} height={12} rx={2} fill="rgb(15 23 42)" fillOpacity={0.85} />
                  <text x={px} y={py - 7} textAnchor="middle" fontSize="8" fill="#34d399" fontWeight="bold">
                    MAX +${maxProfit.toFixed(0)}
                  </text>
                </g>
              );
            })()}

            {/* Max loss annotation */}
            {maxLoss < -0.5 && (() => {
              const px = toX(maxLossS), py = toY(maxLoss);
              if (px < PAD.l || px > PAD.l + CW) return null;
              return (
                <g clipPath="url(#chart-clip)">
                  <circle cx={px} cy={py} r="3" fill="#f43f5e" stroke="#1e293b" strokeWidth="1" />
                  <rect x={px - 28} y={py + 4} width={56} height={12} rx={2} fill="rgb(15 23 42)" fillOpacity={0.85} />
                  <text x={px} y={py + 13} textAnchor="middle" fontSize="8" fill="#f43f5e" fontWeight="bold">
                    MAX ${maxLoss.toFixed(0)}
                  </text>
                </g>
              );
            })()}

            {/* Current spot line */}
            <line x1={currentX} x2={currentX} y1={PAD.t} y2={PAD.t + CH}
              stroke="#fbbf24" strokeWidth="1.5" clipPath="url(#chart-clip)" />
            {currentX >= PAD.l && currentX <= PAD.l + CW && (() => {
              const py = toY(currentPnL);
              const labelW = 56, labelH = 16;
              const labelX = currentX + 8;
              const labelY = Math.max(PAD.t + 2, Math.min(PAD.t + CH - labelH, py - labelH / 2));
              const isFlat = Math.abs(currentPnL) < 0.005;
              const accent = isFlat ? "#cbd5e1" : currentPnL > 0 ? "#34d399" : "#f43f5e";
              return (
                <g clipPath="url(#chart-clip)">
                  <circle cx={currentX} cy={py} r="4"
                    fill={currentZone === "golden" ? "#34d399" : currentZone === "danger" || currentZone === "stop" ? "#f43f5e" : "#fbbf24"}
                    stroke="#1e293b" strokeWidth="1.5" />
                  <rect x={labelX} y={labelY} width={labelW} height={labelH} rx={3} fill="#1e293b" fillOpacity={0.95} stroke={accent} strokeWidth="0.8" />
                  <text x={labelX + labelW / 2} y={labelY + labelH - 4} textAnchor="middle" fontSize="10" fill={accent} fontWeight="bold">
                    {!isFlat && currentPnL > 0 ? "+" : ""}{currentPnL.toFixed(2)}
                  </text>
                </g>
              );
            })()}

            {/* Fan curve intersection markers at current spot */}
            {showFan && currentX >= PAD.l && currentX <= PAD.l + CW && FAN_SLICES.map((days, i) => {
              const fanPnl = compareMode && trackedLegs && openingLegs
                ? calcTrackedPnLAtTime(trackedLegs, openingLegs, effectiveTrackedSpot, currentSpot, days)
                : calcPnLAtTime(legs, spot, currentSpot, days);
              const fy = toY(fanPnl);
              if (fy < PAD.t || fy > PAD.t + CH) return null;
              const label = `${fanPnl >= 0 ? "+" : ""}${fanPnl.toFixed(1)}`;
              const labelW = 48;
              const labelH = 16;
              const labelY = Math.max(PAD.t + 2, Math.min(PAD.t + CH - labelH, fy - labelH / 2));
              const labelX = i % 2 === 0 ? currentX + 8 : currentX - labelW - 8;
              const accentColor = fanPnl >= 0 ? "#fde047" : "#4ade80";
              return (
                <g key={`fan-intersect-${i}`} clipPath="url(#chart-clip)">
                  <circle cx={currentX} cy={fy} r="4" fill={accentColor} stroke="#1e293b" strokeWidth="1.2" />
                  <rect x={labelX} y={labelY} width={labelW} height={labelH} rx={3} fill="#1e293b" fillOpacity={0.95} stroke={accentColor} strokeWidth="0.8" />
                  <text x={labelX + labelW / 2} y={labelY + labelH - 4} textAnchor="middle" fontSize="10" fill={accentColor} fontWeight="bold">
                    {label}
                  </text>
                </g>
              );
            })}

            {/* Current spot price label at x-axis intersection */}
            {currentX >= PAD.l && currentX <= PAD.l + CW && (() => {
              const labelW = 52;
              const labelH = 14;
              const labelX = Math.max(PAD.l, Math.min(PAD.l + CW - labelW, currentX - labelW / 2));
              return (
                <g>
                  <rect x={labelX} y={PAD.t + CH + 2} width={labelW} height={labelH} rx={2} fill="#fbbf24" />
                  <text x={labelX + labelW / 2} y={PAD.t + CH + 12} textAnchor="middle" fontSize="9" fill="#1e293b" fontWeight="bold">
                    {currentSpot.toFixed(currentSpot < 10 ? 2 : currentSpot < 100 ? 1 : 0)}
                  </text>
                </g>
              );
            })()}

            {/* Implied-spot info badge — only in compare mode, placed next to the yellow price label */}
            {compareMode && hasTracked && currentX >= PAD.l && currentX <= PAD.l + CW && (() => {
              const labelW = 52;
              const labelX = Math.max(PAD.l, Math.min(PAD.l + CW - labelW, currentX - labelW / 2));
              const badgeR = 6;
              const badgeY = PAD.t + CH + 9;
              const rightX = labelX + labelW + 6 + badgeR;
              const leftX = labelX - 6 - badgeR;
              const badgeX = rightX + badgeR <= PAD.l + CW ? rightX : leftX;
              return (
                <g
                  style={{ cursor: "pointer" }}
                  onClick={() => setShowImpliedInfo((v) => !v)}
                >
                  <circle cx={badgeX} cy={badgeY} r={badgeR} fill="#0ea5e9" stroke="#0c4a6e" strokeWidth="1" />
                  <text x={badgeX} y={badgeY + 3} textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">i</text>
                </g>
              );
            })()}

            {/* Y axis labels */}
            {yTicks.map((v) => (
              <text key={v} x={PAD.l - 4} y={toY(v) + 3.5} textAnchor="end" fontSize="9" fill="rgb(100 116 139)">
                {v >= 0 ? "" : "-"}{Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(0)}
              </text>
            ))}

            {/* X axis labels — skip labels that overlap (min 32px apart) */}
            {xTicks.reduce<{ v: number; x: number }[]>((acc, s) => {
              const x = toX(s);
              if (acc.length === 0 || x - acc[acc.length - 1].x >= 32) acc.push({ v: s, x });
              return acc;
            }, []).map(({ v, x }) => (
              <text key={v} x={x} y={PAD.t + CH + 14} textAnchor="middle" fontSize="9" fill="rgb(100 116 139)">
                {v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)}
              </text>
            ))}

            {/* Strike labels */}
            {strikes.map((k, idx) => {
              const kx = toX(k);
              if (kx < PAD.l || kx > PAD.l + CW) return null;
              const labelAtTop = idx % 2 === 0;
              const labelY = labelAtTop ? PAD.t + 2 : PAD.t + CH - 14;
              return (
                <g key={k} clipPath="url(#chart-clip)">
                  <rect x={kx - 20} y={labelY} width={40} height={14} rx={2} fill="rgb(15 23 42)" fillOpacity={0.8} />
                  <text x={kx} y={labelY + 10} textAnchor="middle" fontSize="9" fill="rgb(148 163 184)" fontWeight="bold">
                    K {k}
                  </text>
                </g>
              );
            })}

            {/* Axes */}
            <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + CH} stroke="rgb(71 85 105)" strokeWidth="1" />
            <line x1={PAD.l} x2={PAD.l + CW} y1={PAD.t + CH} y2={PAD.t + CH} stroke="rgb(71 85 105)" strokeWidth="1" />
          </svg>
        </div>

        {/* Implied-spot info tooltip */}
        {showImpliedInfo && compareMode && hasTracked && (
          <div className="absolute left-1/2 top-1/2 z-20 w-72 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-sky-500/40 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold text-sky-300">{t("chart.impliedTitle")}</span>
              <button onClick={() => setShowImpliedInfo(false)} className="text-slate-500 transition hover:text-slate-300">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <p className="text-[12px] leading-relaxed text-slate-300">
              {t("chart.impliedDesc", { spot: currentSpot.toFixed(2) })}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              {t("chart.impliedExample")}
            </p>
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-900/20 px-2.5 py-2">
              <p className="text-[11px] leading-relaxed text-amber-200">
                {t("chart.impliedWarning")}
              </p>
            </div>
            {correctedSpot !== null && correctedSpot !== undefined && (
              <p className="mt-2 text-[11px] leading-relaxed text-emerald-300">
                {t("chart.impliedCorrected", { spot: correctedSpot.toFixed(2) })}
              </p>
            )}
            {onCorrectSpot && (
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => { onCorrectSpot(); setShowImpliedInfo(false); }}
                  disabled={correcting || !symbolForCorrect?.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw size={12} className={correcting ? "animate-spin" : ""} />
                  {correcting ? t("chart.impliedFetching") : t("chart.impliedCorrect")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* K / BEP legend */}
        <div className="absolute bottom-0 left-0 z-10 flex items-center gap-2 text-[9px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 border border-dashed border-slate-500" />
            <span><span className="font-semibold text-slate-400">K</span> = {t("chart.strikeLabel")}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 border border-dashed border-sky-500" />
            <span><span className="font-semibold text-sky-400">BEP</span> = {t("chart.bepLabel")}</span>
          </span>
          {hasTracked && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-4 rounded bg-rose-400" style={{ borderTop: "2px dashed #f43f5e", height: 0 }} />
              <span className="font-semibold text-rose-400">{t("chart.trackedCombo")}</span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 rounded bg-emerald-400" />
            <span className="font-semibold text-emerald-400">{t("chart.openCombo")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}