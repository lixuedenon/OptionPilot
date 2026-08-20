import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  onClose: () => void;
}

export default function HelpPanel({ onClose }: Props) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[80vh] w-[600px] max-w-[90vw] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-emerald-400">{t("help.title")}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 text-[12px] leading-relaxed text-slate-300">
          <section>
            <h3 className="mb-1 text-[13px] font-bold text-sky-300">{t("help.build")}</h3>
            <p>{t("help.buildDesc")}</p>
          </section>
          <section>
            <h3 className="mb-1 text-[13px] font-bold text-sky-300">{t("help.scenario")}</h3>
            <p>{t("help.scenarioDesc")}</p>
          </section>
          <section>
            <h3 className="mb-1 text-[13px] font-bold text-sky-300">{t("help.preset")}</h3>
            <p>{t("help.presetDesc")}</p>
          </section>
          <section>
            <h3 className="mb-1 text-[13px] font-bold text-sky-300">{t("help.tracking")}</h3>
            <p>{t("help.trackingDesc")}</p>
          </section>
          <section>
            <h3 className="mb-1 text-[13px] font-bold text-sky-300">{t("help.chart")}</h3>
            <p>{t("help.chartDesc")}</p>
          </section>
          <section>
            <h3 className="mb-1 text-[13px] font-bold text-sky-300">{t("help.data")}</h3>
            <p>{t("help.dataDesc")}</p>
          </section>
        </div>
      </div>
    </div>
  );
}