// src/components/dialogs/ConfirmPremiumCheckDialog.tsx
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";
import type { PremiumIssue } from "@/lib/pricing";

interface Props {
  issues: PremiumIssue[];
  spot: number;
  onConfirm: () => void;
  onCancel: () => void;
}

// 保存追踪快照前，权利金跟股价明显对不上时弹出（App.tsx的handleSaveTrackedClick）。快照一旦存下就是那一刻的记录，
// 事后发现输错只能删掉，所以在这里拦一下。
export default function ConfirmPremiumCheckDialog({ issues, spot, onConfirm, onCancel }: Props) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-80 rounded-xl border border-amber-500/30 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={18} className="text-amber-400" />
          <h3 className="text-sm font-bold text-amber-200">{t("premiumCheck.title")}</h3>
        </div>
        <p className="mb-2 text-[12px] leading-relaxed text-slate-300">{t("premiumCheck.desc", { spot: spot.toFixed(2) })}</p>
        <ul className="mb-4 space-y-1 text-[12px] leading-relaxed text-slate-200">
          {issues.map((it) => (
            <li key={it.index}>
              {it.kind === "belowIntrinsic"
                ? t("premiumCheck.belowIntrinsic", { n: it.index + 1, premium: it.premium.toFixed(2), intrinsic: it.intrinsic.toFixed(2) })
                : it.kind === "ivJump"
                  ? t("premiumCheck.ivJump", { n: it.index + 1, premium: it.premium.toFixed(2), iv: (it.iv * 100).toFixed(0), refIv: (it.refIv * 100).toFixed(0) })
                  : t(it.kind === "ivTooLow" ? "premiumCheck.ivTooLow" : "premiumCheck.ivTooHigh", { n: it.index + 1, premium: it.premium.toFixed(2), iv: (it.iv * 100).toFixed(0) })}
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-amber-500"
          >
            {t("premiumCheck.back")}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            {t("premiumCheck.saveAnyway")}
          </button>
        </div>
      </div>
    </div>
  );
}
