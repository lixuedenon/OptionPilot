import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  title: string;
  icon: React.ReactNode;
  onBack: () => void;
}

export default function ComingSoonPage({ title, icon, onBack }: Props) {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-slate-200">
      <button
        onClick={onBack}
        title={t("home.backToHome")}
        className="mb-5 flex items-center rounded transition hover:opacity-80"
      >
        <img
          src="/image copy 2.png"
          alt="OptionPilot"
          className="h-12 w-auto shrink-0 object-contain"
        />
      </button>
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 text-slate-500">
        {icon}
      </div>
      <h1 className="mb-2 text-lg font-bold text-slate-100">
        {t("comingSoon.title", { feature: title })}
      </h1>
      <p className="mb-6 max-w-xs text-center text-[12px] leading-relaxed text-slate-500">
        {t("comingSoon.desc")}
      </p>
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-[12px] font-semibold text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-300"
      >
        <ArrowLeft size={13} />
        {t("comingSoon.back")}
      </button>
    </div>
  );
}