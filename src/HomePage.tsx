// src/HomePage.tsx
import { useState } from "react";
import { TrendingUp, GitCompare, Wallet, Sparkles, Database, Download, Upload, FileSymlink, Unlink, RefreshCw, X, Share2, ShieldAlert } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import DropdownMenu from "@/components/DropdownMenu";
import { useAutoSync } from "@/hooks/useAutoSync";
import {
  exportAllData,
  importAllData,
  shareBackup,
  canShareBackup,
  needsBackupReminder,
  snoozeBackupReminder,
  getLastBackupAt,
} from "@/lib/dataTransfer";
import { autoSyncWrite } from "@/lib/autoSync";
import { AI_MODULE_ENABLED } from "@/lib/featureFlags";

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
  // 为true时卡片照常显示但不可点击（按钮disabled）。跟comingSoon分开：
  // comingSoon只控制徽章，disabled才真正决定能不能进入。
  disabled?: boolean;
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
    // Was mistakenly marked comingSoon: true even though the simulator
    // module (SimulatorPage.tsx) is fully built and reachable — fixed
    // 2026-09-06 while touching this file for the module-guide work.
    comingSoon: false,
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
    // 2026-09-25屏蔽：见src/lib/featureFlags.ts
    disabled: !AI_MODULE_ENABLED,
  },
];

export default function HomePage({ onSelectModule }: Props) {
  const { t } = useI18n();
  // The "数据" (export/import/link-a-backup-file) dropdown moved here from
  // AppHeader.tsx (2026-09-06, xue's request) — it's app-wide data, not
  // specific to analysis or compare mode, so it belongs on the home screen
  // next to the language switcher rather than duplicated in both module
  // headers. HomePage never edits legs/strategies/presets itself, so unlike
  // App.tsx's instance there's nothing meaningful to pass as change-
  // triggering deps here — after a successful import we just call
  // autoSyncWrite() directly to push the freshly-imported data to the
  // linked file (if any) right away, instead of waiting for a deps change
  // that would never come on this page.
  const {
    autoSyncName,
    autoSyncSupported,
    autoSyncError,
    setAutoSyncError,
    syncNow,
    unlinkBackup,
    linkBackup,
  } = useAutoSync({ savedStrategies: null, customPresets: null, recentSymbols: null });

  // 2026-09-26 移动端第一步：分享备份 + 7天备份提醒，见dataTransfer.ts同名小节。
  // canShare只在挂载时判断一次（浏览器能力不会在会话中途改变）。
  const [shareSupported] = useState(() => canShareBackup());
  const [showBackupReminder, setShowBackupReminder] = useState(() => needsBackupReminder());
  const lastBackupAt = getLastBackupAt();
  const daysSinceBackup = lastBackupAt ? Math.floor((Date.now() - lastBackupAt) / 86400000) : null;
  const handleBackupNow = async () => {
    if (shareSupported) {
      const result = await shareBackup();
      if (result !== "cancelled") setShowBackupReminder(false);
    } else {
      exportAllData();
      setShowBackupReminder(false);
    }
  };

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
          <div className="relative flex items-center gap-3">
            <DropdownMenu
              label={t("toolbar.dataLabel")}
              icon={<Database size={11} />}
              menuClassName="w-56"
            >
              {(close) => (
                <>
                  {autoSyncSupported && (
                    <>
                      <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                        {t("toolbar.fileLink")}
                      </div>
                      {autoSyncName ? (
                        <>
                          <div className="mx-2 mb-1 truncate rounded bg-slate-800 px-2 py-1 text-[10px] text-emerald-400" title={autoSyncName}>
                            <FileSymlink size={10} className="mr-1 inline" />{autoSyncName}
                          </div>
                          <button
                            onClick={syncNow}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
                          >
                            <RefreshCw size={12} className="text-sky-400" /> {t("toolbar.syncNow")}
                          </button>
                          <button
                            onClick={unlinkBackup}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-rose-400 transition hover:bg-rose-950/40"
                          >
                            <Unlink size={12} /> {t("toolbar.unlink")}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={linkBackup}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
                        >
                          <FileSymlink size={12} className="text-emerald-400" /> {t("toolbar.linkBackup")}
                        </button>
                      )}
                      <div className="my-1 border-t border-slate-800" />
                    </>
                  )}
                  {shareSupported && (
                    <button
                      onClick={() => { close(); void shareBackup().then((r) => { if (r !== "cancelled") setShowBackupReminder(false); }); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
                    >
                      <Share2 size={12} className="text-emerald-400" /> {t("toolbar.shareBackup")}
                    </button>
                  )}
                  <button
                    onClick={() => { close(); exportAllData(); setShowBackupReminder(false); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
                  >
                    <Download size={12} className="text-sky-400" /> {t("toolbar.exportData")}
                  </button>
                  <label className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800">
                    <Upload size={12} className="text-sky-400" /> {t("toolbar.importData")}
                    <input
                      type="file"
                      accept=".json,.txt,application/json,text/plain" // .txt：手机"分享备份"发出去的文件（见dataTransfer.ts）
                      className="hidden"
                      onChange={async (e) => {
                        close();
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          await importAllData(file);
                          await autoSyncWrite();
                        } catch {
                          window.alert(t("toolbar.importFail"));
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                </>
              )}
            </DropdownMenu>
            <LanguageSwitcher />
            {autoSyncError && (
              <div className="absolute right-0 top-full mt-1 z-50 max-w-xs rounded-lg border border-rose-700 bg-rose-950/90 px-3 py-2 text-[11px] text-rose-300 shadow-xl">
                {autoSyncError}
                <button
                  onClick={() => setAutoSyncError(null)}
                  className="ml-2 text-rose-500 hover:text-rose-300"
                >
                  <X size={11} className="inline" />
                </button>
              </div>
            )}
          </div>
        </header>

        {showBackupReminder && (
          <div className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-start gap-2">
              <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-400" />
              <p className="text-[12px] leading-relaxed text-amber-200">
                {daysSinceBackup === null
                  ? t("backup.reminderNever")
                  : t("backup.reminderDays", { days: daysSinceBackup })}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => void handleBackupNow()}
                className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-emerald-600/60 bg-emerald-950/40 px-3 text-[12px] font-semibold text-emerald-300 transition hover:border-emerald-500"
              >
                {shareSupported ? <Share2 size={13} /> : <Download size={13} />}
                {shareSupported ? t("toolbar.shareBackup") : t("toolbar.exportData")}
              </button>
              <button
                onClick={() => { snoozeBackupReminder(); setShowBackupReminder(false); }}
                className="min-h-[36px] rounded-lg border border-slate-700 px-3 text-[12px] text-slate-400 transition hover:border-slate-500"
              >
                {t("backup.later")}
              </button>
            </div>
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MODULES.map((m) => (
            <button
              key={m.id}
              onClick={() => { if (!m.disabled) onSelectModule(m.id); }}
              disabled={m.disabled}
              aria-disabled={m.disabled}
              className={`group flex flex-col items-start rounded-xl border bg-slate-900/60 p-4 text-left transition ${
                m.disabled ? "cursor-not-allowed border-slate-800 opacity-50" : m.borderColor
              }`}
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

        <div className="rounded-xl border border-dashed border-slate-800 p-4 text-center">
          <span className="text-[10px] text-slate-600">{t("home.extrasPlaceholder")}</span>
        </div>
      </div>
    </div>
  );
}