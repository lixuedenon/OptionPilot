import { TrendingUp, GitCompare, Wallet, Sparkles } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export type ModuleId = "analysis" | "tracking" | "simulator" | "ai";

interface Props {
  onSelectModule: (id: ModuleId) => void;
}

interface ModuleCard {
  id: ModuleId;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  borderColor: string;
  titleKey: string;
  descKey: string;
  comingSoon: boolean;
}

const MODULES: ModuleCard[] = [
  {
    id: "analysis",
    icon: <TrendingUp size={18} />,
    iconBg: "bg-emerald-950",
    iconColor: "text-emerald-400",
    borderColor: "border-emerald-600/60 hover:border-emerald-500",
    titleKey: "home.analysisTitle",
    descKey: "home.analysisDesc",
    comingSoon: false,
  },
  {
    id: "tracking",
    icon: <GitCompare size={18} />,
    iconBg: "bg-sky-950",
    iconColor: "text-sky-400",
    borderColor: "border-slate-700 hover:border-sky-500/60",
    titleKey: "home.trackingTitle",
    descKey: "home.trackingDesc",
    comingSoon: false,
  },
  {
    id: "simulator",
    icon: <Wallet size={18} />,
    iconBg: "bg-amber-950",
    iconColor: "text-amber-400",
    borderColor: "border-slate-700 hover:border-amber-500/60",
    titleKey: "home.simulatorTitle",
    descKey: "home.simulatorDesc",
    comingSoon: true,
  },
  {
    id: "ai",
    icon: <Sparkles size={18} />,
    iconBg: "bg-violet-950",
    iconColor: "text-violet-400",
    borderColor: "border-slate-700 hover:border-violet-500/60",
    titleKey: "home.aiTitle",
    descKey: "home.aiDesc",
    comingSoon: true,
  },
];

const HELP_SECTIONS = [
  { titleKey: "help.build", descKey: "help.buildDesc" },
  { titleKey: "help.scenario", descKey: "help.scenarioDesc" },
  { titleKey: "help.preset", descKey: "help.presetDesc" },
  { titleKey: "help.tracking", descKey: "help.trackingDesc" },
  { titleKey: "help.chart", descKey: "help.chartDesc" },
  { titleKey: "help.data", descKey: "help.dataDesc" },
];

export default function HomePage({ onSelectModule }: Props) {
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/image copy 2.png"
              alt="OptionPilot"
              className="h-12 w-auto shrink-0 object-contain"
            />
            <span className="text-xs text-slate-500">{t("home.subtitle")}</span>
          </div>
          <LanguageSwitcher />
        </header>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MODULES.map((m) => (
            <button
              key={m.id}
              onClick={() => onSelectModule(m.id)}
              className={`group flex flex-col items-start rounded-xl border bg-slate-900/60 p-4 text-left transition ${m.borderColor}`}
            >
              <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${m.iconBg} ${m.iconColor}`}>
                {m.icon}
              </div>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-100">{t(m.titleKey)}</span>
                {m.comingSoon && (
                  <span className="rounded bg-stone-900 px-1.5 py-0.5 text-[9px] font-semibold text-stone-500">
                    {t("home.comingSoonBadge")}
                  </span>
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">{t(m.descKey)}</p>
            </button>
          ))}
        </div>

        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="mb-3 text-sm font-bold text-emerald-400">{t("home.helpSectionTitle")}</h2>
          <div className="space-y-4 text-[12px] leading-relaxed text-slate-300">
            {HELP_SECTIONS.map((s) => (
              <section key={s.titleKey}>
                <h3 className="mb-1 text-[13px] font-bold text-sky-300">{t(s.titleKey)}</h3>
                <p>{t(s.descKey)}</p>
              </section>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-slate-800 p-4 text-center">
          <span className="text-[10px] text-slate-600">{t("home.extrasPlaceholder")}</span>
        </div>
      </div>
    </div>
  );
}