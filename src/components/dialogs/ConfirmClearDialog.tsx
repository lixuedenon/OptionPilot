import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmClearDialog({ onConfirm, onCancel }: Props) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-72 rounded-xl border border-rose-500/30 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={18} className="text-rose-400" />
          <h3 className="text-sm font-bold text-rose-200">{t("confirm.clearTitle")}</h3>
        </div>
        <p className="mb-5 text-[12px] leading-relaxed text-slate-300">
          {t("confirm.clearDesc")}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-rose-500"
          >
            {t("confirm.clear")}
          </button>
        </div>
      </div>
    </div>
  );
}