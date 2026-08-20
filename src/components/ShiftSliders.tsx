import type { Shifts } from "@/lib/types";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  shifts: Shifts;
  onChange: (s: Partial<Shifts>) => void;
  spot: number;
  maxDte: number;
  onReset: () => void;
  trackedSpot?: number;
  trackedDays?: number;
  trackedVolShift?: number;
  disabled?: boolean;
}

function Slider({
  label,
  sublabel,
  value,
  min,
  max,
  step,
  display,
  subdisplay,
  onChange,
  accent,
  markerValue,
  markerLabel,
  disabled,
}: {
  label: string;
  sublabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  subdisplay?: string;
  onChange: (v: number) => void;
  accent: string;
  markerValue?: number;
  markerLabel?: string;
  disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const markerPct = markerValue !== undefined && markerValue >= min && markerValue <= max
    ? ((markerValue - min) / (max - min)) * 100
    : null;
  return (
    <div className="flex-1">
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold text-slate-200">{label}</span>
        <span className="text-[9px] text-slate-500">{sublabel}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className={`slider-range w-full ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
            style={{
              background: `linear-gradient(to right, ${accent} ${pct}%, rgb(51 65 85) ${pct}%)`,
            }}
          />
          {markerPct !== null && (
            <div
              className="pointer-events-none absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${markerPct}%` }}
              title={markerLabel ?? `${t("shift.positionSpot")} ${markerValue!.toFixed(2)}`}
            >
              <div className="h-2.5 w-2.5 rounded-full bg-rose-500 shadow-md ring-2 ring-white" />
            </div>
          )}
        </div>
        <span
          className="w-16 text-right text-[10px] font-bold tabular-nums"
          style={{ color: accent }}
        >
          {display}
          {subdisplay && (
            <span className="ml-1 text-[9px] font-medium text-slate-500">{subdisplay}</span>
          )}
        </span>
      </div>
    </div>
  );
}

export default function ShiftSliders({ shifts, onChange, spot, maxDte, onReset, trackedSpot, trackedDays, trackedVolShift, disabled }: Props) {
  const { t } = useI18n();
  return (
    <div className={disabled ? "pointer-events-none" : ""}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{disabled ? t("shift.scenarioFrozen") : t("shift.scenario")}</span>
        {!disabled && (
          <button onClick={onReset} className="text-[9px] font-semibold text-slate-500 transition hover:text-slate-300">{t("shift.reset")}</button>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Slider
          label={t("shift.spotChange")}
          sublabel="ΔS"
          value={shifts.dS}
          min={spot > 0 ? -spot * 0.5 : -50}
          max={spot > 0 ? spot * 0.5 : 50}
          step={spot > 0 ? Math.max(0.01, spot * 0.001) : 0.5}
          display={disabled && trackedSpot !== undefined && spot > 0
            ? `${trackedSpot - spot >= 0 ? "+" : ""}${(trackedSpot - spot).toFixed(2)}`
            : `${shifts.dS >= 0 ? "+" : ""}${shifts.dS.toFixed(2)}`}
          subdisplay={disabled && trackedSpot !== undefined && spot > 0
            ? `${trackedSpot.toFixed(2)} (${((trackedSpot - spot) / spot * 100).toFixed(1)}%)`
            : spot > 0 ? `${(spot + shifts.dS).toFixed(2)} (${(shifts.dS / spot * 100).toFixed(1)}%)` : undefined}
          onChange={(v) => onChange({ dS: v })}
          accent="#34d399"
          markerValue={trackedSpot !== undefined && spot > 0 ? trackedSpot - spot : undefined}
          markerLabel={trackedSpot !== undefined ? `${t("shift.positionSpot")} ${trackedSpot.toFixed(2)}` : undefined}
          disabled={disabled}
        />
        <Slider
          label={t("shift.timeDecay")}
          sublabel="ΔT (天)"
          value={shifts.dT}
          min={0}
          max={maxDte > 0 ? maxDte : 30}
          step={1}
          display={disabled && trackedDays !== undefined
            ? `${trackedDays.toFixed(0)}d`
            : `${shifts.dT.toFixed(0)}d`}
          subdisplay={disabled && trackedDays !== undefined
            ? `${t("shift.left")} ${Math.max(0, maxDte - trackedDays).toFixed(0)}d`
            : `${t("shift.left")} ${Math.max(0, maxDte - shifts.dT).toFixed(0)}d`}
          onChange={(v) => onChange({ dT: v })}
          accent="#fbbf24"
          markerValue={trackedDays !== undefined ? trackedDays : undefined}
          markerLabel={trackedDays !== undefined ? `${t("shift.elapsed")} ${trackedDays.toFixed(1)}` : undefined}
          disabled={disabled}
        />
        <Slider
          label={t("shift.volChange")}
          sublabel="ΔV"
          value={shifts.dV}
          min={-100}
          max={100}
          step={1}
          display={disabled && trackedVolShift !== undefined
            ? `${trackedVolShift >= 0 ? "+" : ""}${trackedVolShift.toFixed(2)}%`
            : `${shifts.dV >= 0 ? "+" : ""}${shifts.dV.toFixed(0)}%`}
          onChange={(v) => onChange({ dV: v })}
          accent="#38bdf8"
          markerValue={trackedVolShift !== undefined ? trackedVolShift : undefined}
          markerLabel={trackedVolShift !== undefined ? `${t("shift.positionIV")} ${trackedVolShift >= 0 ? "+" : ""}${trackedVolShift.toFixed(2)}%` : undefined}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
