// src/components/dialogs/ConfirmLeaveDialog.tsx
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  // 2026-09-24新增，配合"打开的对比组合，没有改动就不提示；有改动的逐一
  // 提示"这轮改动——App.tsx里requestLeave一次性算出所有脏了的combo，一个
  // 一个弹这个对话框确认，comboLabel标出这次问的是哪一个（"方案A/B/C"），
  // remainingCount是"这次之后还有几个待确认"，用来在标题旁边加一个小提
  // 示，避免用户以为同一个提示弹了两次。两者都是可选的——不传就是旧的单
  // combo行为（标题/正文不带任何后缀）。
  comboLabel?: string;
  remainingCount?: number;
  onCancel: () => void;
  onDontSave: () => void;
  onSaveFirst: () => void;
}

// Shown when navigating away from analysis mode (the header logo/back
// button) while canSaveStrategy is true — i.e. the current combo differs
// from strategyBaseline and would otherwise be silently lost, since
// switching modules in Shell.tsx unmounts App.tsx entirely rather than
// keeping it alive in the background. Same three-button shape as
// ConfirmReplacePresetDialog (cancel / leave without saving / save then
// leave) for a consistent pattern across App.tsx's various "you'll lose
// this" moments.
//
// 2026-09-24起，也用于"多方案对比"（A/B/C）逐一确认的场景——见上面
// comboLabel/remainingCount的注释，以及App.tsx里requestLeave/
// advanceLeaveQueue的实现。
export default function ConfirmLeaveDialog({ comboLabel, remainingCount, onCancel, onDontSave, onSaveFirst }: Props) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-72 rounded-xl border border-sky-500/30 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={18} className="text-sky-400" />
          <h3 className="text-sm font-bold text-sky-200">
            {t("confirm.leaveTitle")}
            {comboLabel && <span className="ml-1 font-normal text-sky-400">· {comboLabel}</span>}
          </h3>
        </div>
        <p className="mb-1.5 text-[12px] leading-relaxed text-slate-300">
          {t("confirm.leaveDesc")}
        </p>
        {!!remainingCount && remainingCount > 0 && (
          <p className="mb-3.5 text-[10px] text-slate-500">
            {t("confirm.leaveRemaining", { count: remainingCount })}
          </p>
        )}
        {(!remainingCount || remainingCount <= 0) && <div className="mb-5" />}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onDontSave}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            {t("confirm.dontSave")}
          </button>
          <button
            onClick={onSaveFirst}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-sky-500"
          >
            {t("confirm.saveFirst")}
          </button>
        </div>
      </div>
    </div>
  );
}