// src/components/PayoffSparkline.tsx
// src/components/PayoffSparkline.tsx
import { useId } from "react";
import { payoffCurvePoints } from "@/lib/pricing";
import type { Leg } from "@/lib/types";

// A compact, always-visible "shape at a glance" for a preset's tooltip —
// separate from the real analysis-mode PayoffChart (which uses live spot,
// scenario shifts, breakeven markers, etc). This one is purely illustrative:
// it prices the preset's own example legs (all built around an assumed
// spot of 100, matching every preset's illustrative strikes) at expiry.
// Multi-expiry presets (calendar/diagonal/double-diagonal/reverse-calendar)
// are handled correctly for free — payoffCurvePoints/pnlAtExpiry already
// Black-Scholes-reprice the not-yet-expired leg(s) at the near leg's
// horizon instead of pretending everything is intrinsic value only.
const REF_SPOT = 100;
const POINTS = 48;

const W = 220;
const H = 68;
const PAD_X = 4;
const PAD_Y = 6;

function buildGeometry(points: { spot: number; pnl: number }[]) {
  const pnls = points.map((p) => p.pnl);
  const minPnl = Math.min(...pnls, 0);
  const maxPnl = Math.max(...pnls, 0);
  const range = maxPnl - minPnl || 1;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;

  const xFor = (i: number) => PAD_X + (i / (points.length - 1)) * innerW;
  const yFor = (pnl: number) => PAD_Y + innerH - ((pnl - minPnl) / range) * innerH;
  const zeroY = yFor(0);

  const coords = points.map((p, i) => [xFor(i), yFor(p.pnl)] as const);
  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const lastX = coords[coords.length - 1][0].toFixed(1);
  const firstX = coords[0][0].toFixed(1);
  const areaPath = `${linePath} L${lastX},${zeroY.toFixed(1)} L${firstX},${zeroY.toFixed(1)} Z`;

  return { linePath, areaPath, zeroY };
}

export function PayoffSparkline({ legs }: { legs: Leg[] }) {
  const clipId = useId();
  if (!legs || legs.length === 0) return null;

  const points = payoffCurvePoints(legs, REF_SPOT, POINTS);
  if (points.length < 2) return null;

  const { linePath, areaPath, zeroY } = buildGeometry(points);
  const posClip = `${clipId}-pos`;
  const negClip = `${clipId}-neg`;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-hidden="true">
      <defs>
        <clipPath id={posClip}>
          <rect x={0} y={0} width={W} height={Math.max(0, zeroY)} />
        </clipPath>
        <clipPath id={negClip}>
          <rect x={0} y={zeroY} width={W} height={Math.max(0, H - zeroY)} />
        </clipPath>
      </defs>

      {/* zero P/L reference line */}
      <line x1={PAD_X} y1={zeroY} x2={W - PAD_X} y2={zeroY} stroke="#475569" strokeWidth={1} strokeDasharray="2,2" />

      {/* profit region (above zero) tinted emerald, loss region tinted rose */}
      <path d={areaPath} fill="#34d399" fillOpacity={0.16} clipPath={`url(#${posClip})`} />
      <path d={areaPath} fill="#fb7185" fillOpacity={0.16} clipPath={`url(#${negClip})`} />

      {/* the payoff curve itself */}
      <path d={linePath} fill="none" stroke="#38bdf8" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
