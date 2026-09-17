// src/components/ShiftSliders.tsx
import type { Shifts } from "@/lib/types";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  shifts: Shifts;
  onChange: (s: Partial<Shifts>) => void;
  spot: number;
  maxDte: number;
  // 2026-09-15新增，分析模式"全生命周期模拟"重设计：dT滑块的下界。默认0（旧行为，
  // 时间只能往前走）；分析模式下由App.tsx算出的openingSimBasis传入一个负值，
  // 让滑块能往回拖到保存组合的那一天（"第0天"）——pricing.ts的priceCombo早就
  // 支持负dT（newDte = max(0, leg.dte - dT)反向变大），这里只是把UI下界放开。
  // 对比模式（disabled=true）不传，滑块本来就冻结，min/max无所谓。
  minDte?: number;
  // 2026-09-15新增。有值时在dT滑块轨道上打一个"今天"参考点（复用Slider现成的
  // markerValue/markerLabel机制，不是重新发明），配合下面的onJumpToday按钮。
  // 过期策略（isExpiredOpening）不传——过期之后时间轴上已经没有真实的"今天"
  // 位置可言，见App.tsx的isExpiredOpening注释。
  todayDte?: number;
  // 2026-09-15新增，配合todayDte：点击"今天"按钮直接把dT跳到0（"今天"在这个
  // 设计里永远对应shifts.dT===0，因为legs.dte本身就是从"今天"实时衰减出来的，
  // 不需要额外换算）。todayDte未定义时不渲染这个按钮。
  onJumpToday?: () => void;
  onReset: () => void;
  trackedSpot?: number;
  trackedDays?: number;
  trackedVolShift?: number;
  disabled?: boolean;
  // "解释当前情况" button (2026-09-09) — rendered in the header row next to
  // the title, same slot for both modes (this row renders whether or not
  // `disabled` is set, unlike `onReset` which only shows when enabled). A
  // plain ReactNode so this component doesn't need to know anything about
  // situationExplainer.ts/SituationExplainDialog — App.tsx builds the button
  // and owns the dialog's open state, same pattern as PayoffChart.tsx's
  // modeSwitchButton prop.
  explainButton?: React.ReactNode;
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
  labelExtra,
  t,
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
  // 2026-09-15新增，只有dT滑块会用："今天"跳转按钮，渲染在label右边（跟
  // sublabel共享那一行，button放sublabel左边）。其它滑块不传。
  labelExtra?: React.ReactNode;
  // Only actually needed for the markerLabel-less fallback below, but every
  // call site today always passes markerLabel alongside markerValue — this
  // is a defensive fallback, not a normally-hit path. Threaded in as a prop
  // (rather than calling useI18n() here) because Slider is a plain helper
  // component, not something that should own its own i18n subscription.
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const markerPct = markerValue !== undefined && markerValue >= min && markerValue <= max
    ? ((markerValue - min) / (max - min)) * 100
    : null;
  return (
    <div className="flex-1">
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold text-slate-200">{label}</span>
        <span className="flex items-center gap-1.5">
          {labelExtra}
          <span className="text-[9px] text-slate-500">{sublabel}</span>
        </span>
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

export default function ShiftSliders({ shifts, onChange, spot, maxDte, minDte, todayDte, onJumpToday, onReset, trackedSpot, trackedDays, trackedVolShift, disabled, explainButton }: Props) {
  const { t } = useI18n();
  return (
    <div className={disabled ? "pointer-events-none" : ""}>
      <div className="mb-1 flex items-center justify-between">
        {/* explainButton sits right next to the title now (2026-09-12, per
            Xue) instead of over on the far right by the reset button — it
            used to be easy to miss all the way over there, separated from
            the title by the whole width of this row; right next to the
            title it's much more likely to actually get noticed. */}
        <div className="pointer-events-auto flex items-center gap-2">
          <span className="text-[13px] font-bold text-sky-400">{disabled ? t("shift.scenarioFrozen") : t("shift.scenario")}</span>
          {explainButton}
        </div>
        {!disabled && (
          <button onClick={onReset} className="pointer-events-auto text-[9px] font-semibold text-slate-500 transition hover:text-slate-300">{t("shift.reset")}</button>
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
          t={t}
        />
        <Slider
          label={t("shift.timeDecay")}
          sublabel={t("shift.deltaTSublabel")}
          value={shifts.dT}
          min={minDte ?? 0}
          max={maxDte > 0 ? maxDte : 30}
          step={1}
          display={disabled && trackedDays !== undefined
            ? `${trackedDays.toFixed(0)}d`
            // 2026-09-15：dT现在可以为负（第0天到今天之间的历史回放），跟ΔS
            // 一样统一用带符号格式，避免"-5d"和"5d"混在一起看不出方向。
            : `${shifts.dT >= 0 ? "+" : ""}${shifts.dT.toFixed(0)}d`}
          subdisplay={disabled && trackedDays !== undefined
            ? `${t("shift.left")} ${Math.max(0, maxDte - trackedDays).toFixed(0)}d`
            : `${t("shift.left")} ${Math.max(0, maxDte - shifts.dT).toFixed(0)}d`}
          onChange={(v) => onChange({ dT: v })}
          accent="#fbbf24"
          markerValue={trackedDays !== undefined ? trackedDays : todayDte}
          markerLabel={trackedDays !== undefined
            ? `${t("shift.elapsed")} ${trackedDays.toFixed(1)}`
            : todayDte !== undefined ? t("shift.today") : undefined}
          disabled={disabled}
          labelExtra={!disabled && todayDte !== undefined && onJumpToday ? (
            <button
              onClick={onJumpToday}
              disabled={shifts.dT === todayDte}
              className="rounded border border-slate-700 px-1 py-px text-[8px] font-semibold text-slate-400 transition hover:border-sky-500 hover:text-sky-300 disabled:cursor-default disabled:opacity-40 disabled:hover:border-slate-700 disabled:hover:text-slate-400"
            >
              {t("shift.today")}
            </button>
          ) : undefined}
          t={t}
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
          t={t}
        />
      </div>
    </div>
  );
}
