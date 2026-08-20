import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  onCancel: () => void;
  onDontSave: () => void;
  onSaveFirst: () => void;
}

// Shown when applying a preset would overwrite unsaved changes in the
// analysis-mode combo. All three buttons just fire a callback — App.tsx
// owns confirmReplaceOpen and the pendingPresetReplace ref, this component
// has no state of its own.
export default function ConfirmReplacePresetDialog({ onCancel, onDontSave, onSaveFirst }: Props) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-72 rounded-xl border border-sky-500/30 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={18} className="text-sky-400" />
          <h3 className="text-sm font-bold text-sky-200">{t("confirm.replaceTitle")}</h3>
        </div>
        <p className="mb-5 text-[12px] leading-relaxed text-slate-300">
          {t("confirm.replaceDesc")}
        </p>
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