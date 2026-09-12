// src/components/dialogs/ConfirmLockRollDialog.tsx
import { Lock } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  onConfirm: () => void;
  onCancel: () => void;
}

// 2026-09-12: shown when the person clicks "保存追踪快照" (App.tsx's
// handleSaveTrackedClick) while "今日组合" contains at least one leg from an
// unconfirmed Roll/Protect/Hedge (derivedFrom set, not yet locked — see
// types.ts's `derivedFrom.locked`). Saving bakes a permanent lock into that
// leg (useStrategyOrchestration.ts's saveTrackedSnapshotTo), after which
// "撤销展期/保护/对冲" stops being offered — xue's own framing of the
// design: saving a snapshot is the last gate for these actions, so the
// person should be told BEFORE they cross it, not left to discover it later
// when "撤销" is already disabled. Styled like ConfirmBulkDeleteDialog
// (single confirm button, no third option) since — like that dialog — this
// is confirming a real, one-way consequence of an action already in
// progress, not offering a menu of choices.
//
// Deliberately only gates this one button, not handleSaveTracked itself —
// see App.tsx's confirmLockRollOpen comment for why the hook's other
// internal callers (save-then-clear/switch-mode/switch-preset/
// symbol-change) stay unwrapped.
export default function ConfirmLockRollDialog({ onConfirm, onCancel }: Props) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-72 rounded-xl border border-amber-500/30 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <Lock size={18} className="text-amber-400" />
          <h3 className="text-sm font-bold text-amber-200">{t("confirm.lockRollTitle")}</h3>
        </div>
        <p className="mb-5 text-[12px] leading-relaxed text-slate-300">
          {t("confirm.lockRollDesc")}
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
            className="rounded-md bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-amber-500"
          >
            {t("confirm.lockRollConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
