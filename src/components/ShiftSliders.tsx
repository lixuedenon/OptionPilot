// src/components/ShiftSliders.tsx
import { RotateCcw } from "lucide-react";
import type { Shifts } from "@/lib/types";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  shifts: Shifts;
  onChange: (s: Partial<Shifts>) => void;
  spot: number;
  maxDte: number;
  // 2026-09-17：day0永远锚定在openingAt（真实开仓日），不再有"倒回去看真实
  // 历史"的负dT功能（曾经的设计，已放弃）——dT滑块下界固定为0，openingAt
  // 本身就是这条轴的地板。
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
  // `disabled`：滑块本身不可交互（发灰+锁住），两种情况都会传true——对比
  // 模式（这时trackedSpot/trackedDays/trackedVolShift会有值，显示会自动切
  // 到跟踪快照那一套）、以及2026-09-17新增的"分析模式下一条腿位都没有"（这
  // 时trackedSpot等仍是undefined，显示走正常那套，只是滑块拖不动）。
  disabled?: boolean;
  // `frozen`：专指"对比模式冻结"这一种情况——只控制标题文案（"情景偏移对
  // 比" vs "未来情景模拟"）和重置按钮是否显示。没有legs时disabled=true但
  // frozen=false：标题仍显示"未来情景模拟"（不会被误当成对比模式），重置
  // 按钮也照常显示（虽然此时shifts本来就该是0,0,0，点了也无副作用）。
  frozen?: boolean;
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

export default function ShiftSliders({ shifts, onChange, spot, maxDte, todayDte, onJumpToday, onReset, trackedSpot, trackedDays, trackedVolShift, disabled, frozen }: Props) {
  const { t } = useI18n();
  return (
    <div className={disabled ? "pointer-events-none" : ""}>
      <div className="mb-1 flex items-center justify-between">
        <div className="pointer-events-auto flex items-center gap-2">
          <span className="text-[13px] font-bold text-sky-400">{frozen ? t("shift.scenarioFrozen") : t("shift.scenario")}</span>
        </div>
        {!frozen && (
          // 2026-09-17：改大改醒目——一旦滑块动过，这是唯一能解锁所有输入
          // 的地方（见LegRow.tsx里locked输入框点击后弹出的提示），原来
          // 9px灰字太容易被忽略，改成实心橙色按钮+图标。
          <button
            onClick={onReset}
            className="pointer-events-auto flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 shadow-sm shadow-amber-500/30 transition hover:bg-amber-400 active:bg-amber-600"
          >
            <RotateCcw size={12} />
            {t("shift.reset")}
          </button>
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
          min={0}
          max={maxDte > 0 ? maxDte : 30}
          step={1}
          display={disabled && trackedDays !== undefined
            ? `${trackedDays.toFixed(0)}d`
            // day0(openingAt)永远是这条轴的地板，dT不会是负数，正常显示
            // 非负天数即可，不需要带符号——"今天"只是轴上的一个打点参考
            // (todayDte)，不参与这里的计算或显示格式。
            : `${shifts.dT.toFixed(0)}d`}
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