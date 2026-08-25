import { useEffect, useState } from "react";
import { GitCompare, X, RefreshCw } from "lucide-react";
import type { Leg, Shifts } from "@/lib/types";
import { compareDecisions, type DecisionScenario } from "@/lib/decisionCompare";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  legs: Leg[];
  targetLegId: string;
  spot: number;
  symbol: string;
  shifts: Shifts;
  onClose: () => void;
}

const LABEL_KEY: Record<DecisionScenario["key"], string> = {
  doNothing: "compare2.doNothing",
  close: "compare2.close",
  roll: "compare2.roll",
};

// Fixed per-scenario colors so the legend, the curves, and the table rows
// all agree without having to thread a color prop through three places.
const SCENARIO_COLOR: Record<DecisionScenario["key"], string> = {
  doNothing: "#94a3b8", // slate-400
  close: "#f59e0b", // amber-500
  roll: "#a78bfa", // violet-400
};

function fmtMoney(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

// Small inline SVG overlay of each scenario's payoff-at-expiry curve — this
// is the "simple summary, but graphical" the person asked for, sitting
// alongside (not replacing) the numeric table. All curves share one x
// domain (the spot window compareDecisions/payoffCurvePoints scans) and one
// y domain, so shapes are directly comparable at a glance.
function PayoffOverlayChart({
  scenarios,
  spot,
  shiftedSpot,
}: {
  scenarios: DecisionScenario[];
  spot: number;
  shiftedSpot: number;
}) {
  const width = 460;
  const height = 150;
  const padL = 8;
  const padR = 8;
  const padT = 8;
  const padB = 8;

  const allPoints = scenarios.flatMap((s) => s.curve);
  if (allPoints.length === 0) return null;

  const xMin = Math.min(...allPoints.map((p) => p.spot));
  const xMax = Math.max(...allPoints.map((p) => p.spot));
  const yMin = Math.min(0, ...allPoints.map((p) => p.pnl));
  const yMax = Math.max(0, ...allPoints.map((p) => p.pnl));
  const yRange = yMax - yMin || 1;

  const xScale = (s: number) => padL + ((s - xMin) / (xMax - xMin || 1)) * (width - padL - padR);
  const yScale = (v: number) => padT + (1 - (v - yMin) / yRange) * (height - padT - padB);

  const zeroY = yScale(0);
  const spotX = xScale(spot);
  const shiftedX = xScale(shiftedSpot);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 160 }}>
      {/* zero line */}
      <line x1={padL} y1={zeroY} x2={width - padR} y2={zeroY} stroke="#334155" strokeWidth={1} />
      {/* current real spot */}
      <line x1={spotX} y1={padT} x2={spotX} y2={height - padB} stroke="#475569" strokeWidth={1} strokeDasharray="2,2" />
      {/* slider's hypothetical spot, if different from the real one */}
      {Math.abs(shiftedX - spotX) > 1 && (
        <line x1={shiftedX} y1={padT} x2={shiftedX} y2={height - padB} stroke="#facc15" strokeWidth={1} strokeDasharray="3,2" />
      )}
      {scenarios.map((s) => {
        const d = s.curve
          .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.spot).toFixed(1)} ${yScale(p.pnl).toFixed(1)}`)
          .join(" ");
        return <path key={s.key} d={d} fill="none" stroke={SCENARIO_COLOR[s.key]} strokeWidth={1.75} />;
      })}
    </svg>
  );
}

export default function DecisionCompareDialog({ legs, targetLegId, spot, symbol, shifts, onClose }: Props) {
  const { t } = useI18n();
  const targetLeg = legs.find((l) => l.id === targetLegId);
  const [scenarios, setScenarios] = useState<DecisionScenario[] | null>(null);
  const [loadingRoll, setLoadingRoll] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingRoll(true);
    compareDecisions(legs, targetLegId, spot, symbol, shifts).then((result) => {
      if (!cancelled) {
        setScenarios(result);
        setLoadingRoll(false);
      }
    }).catch(() => {
      if (!cancelled) setLoadingRoll(false);
    });
    return () => { cancelled = true; };
    // Deliberately NOT re-running on every shifts change while the dialog
    // is open — re-fetching the roll leg's real chain data on every slider
    // tick would hammer the network for no benefit (the roll leg's real
    // strike/expiry/premium don't depend on the slider at all, only its
    // MARK does, and that's cheap local math done inline below). Re-opening
    // the dialog picks up the sliders' current position at open time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLegId]);

  const rollAvailable = scenarios?.some((s) => s.key === "roll") ?? false;
  const rows = scenarios ?? [];
  const shiftedSpot = spot + shifts.dS;
  const hasShift = shifts.dS !== 0 || shifts.dT !== 0 || shifts.dV !== 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[560px] max-w-[94vw] rounded-xl border border-violet-500/30 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitCompare size={18} className="text-violet-400" />
            <h3 className="text-sm font-bold text-violet-200">{t("compare2.title")}</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 transition hover:text-slate-300">
            <X size={16} />
          </button>
        </div>
        <p className="mb-3 text-[11px] text-slate-500">{t("compare2.subtitle")}</p>

        {hasShift && (
          <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-900/10 px-2.5 py-1.5 text-[10px] text-amber-200">
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
            {t("compare2.followingShift", { spot: shiftedSpot.toFixed(2) })}
          </div>
        )}

        {targetLeg && (
          <div className="mb-3 rounded-lg border border-slate-700/50 bg-slate-800/40 p-2.5 text-[11px] text-slate-300">
            {targetLeg.action === "buy" ? t("leg.buy") : t("leg.sell")} {targetLeg.kind === "stock" ? t("hedge.stock") : (targetLeg.type === "call" ? "Call" : "Put")}
            {targetLeg.kind !== "stock" && <> {targetLeg.strike} · {Math.round(targetLeg.dte)}{t("roll.days")}</>}
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="mb-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2">
              <PayoffOverlayChart scenarios={rows} spot={spot} shiftedSpot={shiftedSpot} />
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400">
              {rows.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: SCENARIO_COLOR[s.key] }} />
                  {t(LABEL_KEY[s.key])}
                </span>
              ))}
            </div>
          </>
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="bg-slate-900/60 text-slate-500">
                <th className="px-3 py-2 font-medium"></th>
                <th className="px-3 py-2 font-medium">{t("compare2.netValue")}</th>
                <th className="px-3 py-2 font-medium">{t("compare2.maxProfit")}</th>
                <th className="px-3 py-2 font-medium">{t("compare2.maxLoss")}</th>
                <th className="px-3 py-2 font-medium">{t("compare2.pop")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.key} className="border-t border-slate-800/60 text-slate-300">
                  <td className="px-3 py-2 font-semibold text-slate-200">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: SCENARIO_COLOR[s.key] }} />
                    {t(LABEL_KEY[s.key])}
                    {s.key === "roll" && s.expiryDate && (
                      <span className="ml-1 font-normal text-slate-500">({s.expiryDate})</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmtMoney(s.netValue)}</td>
                  <td className="px-3 py-2 tabular-nums text-emerald-400">{fmtMoney(s.maxProfit)}</td>
                  <td className="px-3 py-2 tabular-nums text-rose-400">{fmtMoney(s.maxLoss)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {s.key === "close" ? (
                      <span className="text-slate-600">{t("compare2.closedNoPop")}</span>
                    ) : (
                      `${(s.pop * 100).toFixed(0)}%`
                    )}
                  </td>
                </tr>
              ))}
              {loadingRoll && (
                <tr className="border-t border-slate-800/60 text-slate-500">
                  <td className="px-3 py-2 font-semibold">{t("compare2.roll")}</td>
                  <td colSpan={4} className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <RefreshCw size={11} className="animate-spin" />
                      {t("compare2.loadingRoll")}
                    </span>
                  </td>
                </tr>
              )}
              {!loadingRoll && !rollAvailable && targetLeg?.kind !== "stock" && (
                <tr className="border-t border-slate-800/60 text-slate-600">
                  <td className="px-3 py-2 font-semibold">{t("compare2.roll")}</td>
                  <td colSpan={4} className="px-3 py-2">{t("compare2.rollUnavailable")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          {targetLeg?.kind === "stock" ? t("compare2.noRollOnStock") : t("compare2.rollHint")}
        </p>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}