// src/components/dialogs/HelpPanel.tsx
import { useState, useCallback } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";

export type HelpModuleId = "analysis" | "compare" | "simulator";

// Persistent "don't show again" for the gate variant (2026-09-07). Separate
// localStorage key per module so dismissing one module's first-entry guide
// doesn't affect the other two. Exported so App.tsx/SimulatorPage.tsx can
// fold this into their initial-open state and skip the gate entirely on
// future visits instead of flashing it open for a frame before it closes.
const GUIDE_DISMISSED_PREFIX = "optionpilot.guideDismissed.";

export function isGuideDismissed(moduleId: HelpModuleId): boolean {
  try {
    return localStorage.getItem(GUIDE_DISMISSED_PREFIX + moduleId) === "1";
  } catch {
    return false; // storage unavailable (private mode, etc.) — fail open, just show the gate
  }
}

function setGuideDismissed(moduleId: HelpModuleId) {
  try {
    localStorage.setItem(GUIDE_DISMISSED_PREFIX + moduleId, "1");
  } catch {
    // best-effort only — worst case the gate reappears next time
  }
}

// Per-module usage guide content (2026-09-06). Previously this panel always
// showed one generic doc (build/scenario/preset/tracking/chart/data) mixing
// analysis-mode, compare-mode, and data-management content together
// regardless of which module you were actually in — xue asked for each
// module to get its own short, focused guide instead. `moduleId` picks
// which set of {title, section[]} i18n keys to render; `MODULE_SECTIONS`
// below is the only thing that needs to change to edit a module's guide
// content — everything else in this file is presentation.
const MODULE_SECTIONS: Record<HelpModuleId, { titleKey: string; sections: { titleKey: string; descKey: string }[] }> = {
  analysis: {
    titleKey: "help.moduleAnalysisTitle",
    sections: [
      { titleKey: "help.moduleAnalysisIntro", descKey: "help.moduleAnalysisIntroDesc" },
      { titleKey: "help.moduleAnalysisBuild", descKey: "help.moduleAnalysisBuildDesc" },
      { titleKey: "help.moduleAnalysisAutofill", descKey: "help.moduleAnalysisAutofillDesc" },
      { titleKey: "help.moduleAnalysisScenario", descKey: "help.moduleAnalysisScenarioDesc" },
      { titleKey: "help.moduleAnalysisChart", descKey: "help.moduleAnalysisChartDesc" },
      { titleKey: "help.moduleAnalysisAttribution", descKey: "help.moduleAnalysisAttributionDesc" },
      { titleKey: "help.moduleAnalysisHealth", descKey: "help.moduleAnalysisHealthDesc" },
      { titleKey: "help.moduleAnalysisPreset", descKey: "help.moduleAnalysisPresetDesc" },
      { titleKey: "help.moduleAnalysisBadge", descKey: "help.moduleAnalysisBadgeDesc" },
      { titleKey: "help.moduleAnalysisSave", descKey: "help.moduleAnalysisSaveDesc" },
      { titleKey: "help.moduleAnalysisSimAdd", descKey: "help.moduleAnalysisSimAddDesc" },
      { titleKey: "help.moduleAnalysisModeSwitch", descKey: "help.moduleAnalysisModeSwitchDesc" },
      { titleKey: "help.moduleAnalysisBulk", descKey: "help.moduleAnalysisBulkDesc" },
      { titleKey: "help.moduleAnalysisActions", descKey: "help.moduleAnalysisActionsDesc" },
      { titleKey: "help.moduleAnalysisRoll", descKey: "help.moduleAnalysisRollDesc" },
      { titleKey: "help.moduleAnalysisProtect", descKey: "help.moduleAnalysisProtectDesc" },
      { titleKey: "help.moduleAnalysisHedge", descKey: "help.moduleAnalysisHedgeDesc" },
      { titleKey: "help.moduleAnalysisCompare2", descKey: "help.moduleAnalysisCompare2Desc" },
      { titleKey: "help.moduleAnalysisSymbolChange", descKey: "help.moduleAnalysisSymbolChangeDesc" },
    ],
  },
  compare: {
    titleKey: "help.moduleCompareTitle",
    sections: [
      { titleKey: "help.moduleCompareIntro", descKey: "help.moduleCompareIntroDesc" },
      { titleKey: "help.moduleCompareUpdate", descKey: "help.moduleCompareUpdateDesc" },
      { titleKey: "help.moduleCompareAttribution", descKey: "help.moduleCompareAttributionDesc" },
      { titleKey: "help.moduleCompareHealth", descKey: "help.moduleCompareHealthDesc" },
      { titleKey: "help.moduleCompareSave", descKey: "help.moduleCompareSaveDesc" },
      { titleKey: "help.moduleCompareHistory", descKey: "help.moduleCompareHistoryDesc" },
      { titleKey: "help.moduleCompareActions", descKey: "help.moduleCompareActionsDesc" },
      { titleKey: "help.moduleCompareRestore", descKey: "help.moduleCompareRestoreDesc" },
      { titleKey: "help.moduleCompareModeSwitch", descKey: "help.moduleCompareModeSwitchDesc" },
      { titleKey: "help.moduleCompareFrozen", descKey: "help.moduleCompareFrozenDesc" },
      { titleKey: "help.moduleCompareSymbolChange", descKey: "help.moduleCompareSymbolChangeDesc" },
    ],
  },
  simulator: {
    titleKey: "help.moduleSimulatorTitle",
    sections: [
      { titleKey: "help.moduleSimulatorPosition", descKey: "help.moduleSimulatorPositionDesc" },
      { titleKey: "help.moduleSimulatorMargin", descKey: "help.moduleSimulatorMarginDesc" },
      { titleKey: "help.moduleSimulatorReview", descKey: "help.moduleSimulatorReviewDesc" },
      { titleKey: "help.moduleSimulatorEarnings", descKey: "help.moduleSimulatorEarningsDesc" },
    ],
  },
};

interface Props {
  moduleId: HelpModuleId;
  onClose: () => void;
  // "info" (default): a normal dismissible dialog — backdrop click and the
  // X button both close it. Used for the header's "使用说明" button, which
  // xue asked to open THIS module's guide instead of the old one-size-fits-
  // all doc.
  // "gate": a first-entry checkpoint — no backdrop-dismiss, no X, the only
  // way through is the "明白了，继续" button (onClose doubles as "continue"
  // here). Shown once per module per App.tsx/SimulatorPage mount — see
  // App.tsx's showAnalysisGuide/showCompareGuide and SimulatorPage's
  // showGuide for exactly when.
  variant?: "info" | "gate";
}

export default function HelpPanel({ moduleId, onClose, variant = "info" }: Props) {
  const { t } = useI18n();
  const isGate = variant === "gate";
  const { titleKey, sections } = MODULE_SECTIONS[moduleId];
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleContinue = useCallback(() => {
    if (dontShowAgain) setGuideDismissed(moduleId);
    onClose();
  }, [dontShowAgain, moduleId, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={isGate ? undefined : onClose}
    >
      <div
        className="max-h-[80vh] w-[600px] max-w-[90vw] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-emerald-400">{t(titleKey)}</h2>
          {!isGate && (
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
              <X size={18} />
            </button>
          )}
        </div>
        <div className="space-y-4 text-[12px] leading-relaxed text-slate-300">
          {sections.map((s) => (
            <section key={s.titleKey}>
              <h3 className="mb-1 text-[13px] font-bold text-sky-300">{t(s.titleKey)}</h3>
              <p>{t(s.descKey)}</p>
            </section>
          ))}
        </div>
        {isGate && (
          <div className="mt-5 flex items-center justify-between">
            <label className="flex items-center gap-2 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="accent-emerald-500"
              />
              {t("help.gateDontShowAgain")}
            </label>
            <button
              onClick={handleContinue}
              className="rounded-md bg-emerald-600 px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-emerald-500"
            >
              {t("help.gateContinue")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
