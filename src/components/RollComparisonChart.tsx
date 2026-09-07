// src/components/RollComparisonChart.tsx
import { useId } from "react";
import { payoffCurvePoints, maxProfitLoss } from "@/lib/pricing";
import type { Leg } from "@/lib/types";
import { useI18n } from "@/i18n/I18nContext";

// Roll-dialog-only "before vs after" overlay (xue's proposal #4, 2026-09).
// Deliberately NOT a reuse of PayoffChart.tsx — that component carries a lot
// of coupling this doesn't need (compareMode/onAlert/health-score wiring,
// live-spot correction UI, scenario-slider state). This is the same kind of
// small, self-contained, at-expiry-only illustration as PayoffSparkline.tsx,
// just with two curves instead of one. Both curves are sampled at the same
// `spot` so payoffCurvePoints picks the same x-axis window for each
// (the window is derived purely from spot, not from the legs), which is
// what keeps the two paths comparable point-for-point.
//
// Callers MUST pass already-`disabled`-filtered leg arrays — pnlAtExpiry
// (and therefore payoffCurvePoints/maxProfitLoss which sit on top of it)
// does not filter disabled "ghost" legs left behind by earlier rolls
// (CLAUDE.md known-issue #19); filtering happens once in RollDialog.tsx
// before either array reaches this component.
const POINTS = 60;
const W = 360;
const H = 120;
const PAD_X = 6;
const PAD_Y = 8;

function buildGeometry(beforePts: { spot: number; pnl: number }[], afterPts: { spot: number; pnl: number }[]) {
  const allPnls = [...beforePts.map((p) => p.pnl), ...afterPts.map((p) => p.pnl), 0];
  const minPnl = Math.min(...allPnls);
  const maxPnl = Math.max(...allPnls);
  const range = maxPnl - minPnl || 1;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;

  const n = beforePts.length;
  const xFor = (i: number) => PAD_X + (i / (n - 1)) * innerW;
  const yFor = (pnl: number) => PAD_Y + innerH - ((pnl - minPnl) / range) * innerH;
  const zeroY = yFor(0);

  const pathFor = (pts: { spot: number; pnl: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p.pnl).toFixed(1)}`).join(" ");

  return { beforePath: pathFor(beforePts), afterPath: pathFor(afterPts), zeroY };
}

interface Props {
  beforeLegs: Leg[];
  afterLegs: Leg[];
  spot: number;
}

export default function RollComparisonChart({ beforeLegs, afterLegs, spot }: Props) {
  const { t } = useI18n();
  const clipId = useId();

  if (spot <= 0 || beforeLegs.length === 0 || afterLegs.length === 0) return null;

  const beforePts = payoffCurvePoints(beforeLegs, spot, POINTS);
  const afterPts = payoffCurvePoints(afterLegs, spot, POINTS);
  if (beforePts.length < 2 || afterPts.length < 2) return null;

  const { beforePath, afterPath, zeroY } = buildGeometry(beforePts, afterPts);
  const spotXIndex = beforePts.reduce(
    (best, p, i) => (Math.abs(p.spot - spot) < Math.abs(beforePts[best].spot - spot) ? i : best),
    0,
  );
  const spotX = PAD_X + (spotXIndex / (beforePts.length - 1)) * (W - PAD_X * 2);

  const beforeML = maxProfitLoss(beforeLegs, spot);
  const afterML = maxProfitLoss(afterLegs, spot);
  const clip = `${clipId}-spot`;

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("roll.compareTitle")}</span>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1 text-slate-400">
            <span className="inline-block h-[2px] w-3 bg-slate-500" /> {t("roll.compareBefore")}
          </span>
          <span className="flex items-center gap-1 text-sky-300">
            <span className="inline-block h-[2px] w-3 bg-sky-400" /> {t("roll.compareAfter")}
          </span>
        </div>
      </div>

      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <rect x={0} y={0} width={W} height={H} />
          </clipPath>
        </defs>
        <line x1={PAD_X} y1={zeroY} x2={W - PAD_X} y2={zeroY} stroke="#475569" strokeWidth={1} strokeDasharray="2,2" />
        <line x1={spotX} y1={PAD_Y} x2={spotX} y2={H - PAD_Y} stroke="#64748b" strokeWidth={1} strokeDasharray="1,2" clipPath={`url(#${clip})`} />
        <path d={beforePath} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="3,2" />
        <path d={afterPath} fill="none" stroke="#38bdf8" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      </svg>

      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] tabular-nums">
        <div className="rounded border border-slate-700/50 bg-slate-900/40 p-1.5">
          <div className="text-slate-500">{t("roll.compareBefore")}</div>
          <div className="text-slate-300">
            {t("roll.compareMaxLoss")} <span className="font-semibold text-rose-300">{beforeML.maxLoss.toFixed(0)}</span>
          </div>
        </div>
        <div className="rounded border border-sky-700/40 bg-sky-950/20 p-1.5">
          <div className="text-sky-400">{t("roll.compareAfter")}</div>
          <div className="text-slate-300">
            {t("roll.compareMaxLoss")} <span className="font-semibold text-rose-300">{afterML.maxLoss.toFixed(0)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
