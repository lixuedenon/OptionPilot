// src/components/dialogs/AlertCard.tsx
import type { AlertSeverity } from "@/lib/situationExplainer";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  alert: { severity: AlertSeverity; body: string } | null;
}

// 2026-09-19：取代原来按netCredit百分比算golden/danger/stop的那套（见
// PayoffChart.tsx同日注释）。现在只读App.tsx从situationExplanation里挑出
// 的那一条severity+body，三态样式，文案就是540格表里的那句cellAdvice——
// 不再自己拼数字。只有熊市Call/牛市Put价差会有内容，其它形状severity为
// undefined，alert为null，这里直接不渲染。
export default function AlertCard({ alert }: Props) {
  const { t } = useI18n();
  if (!alert) return null;

  if (alert.severity === "takeProfit") {
    return (
      <div className="mb-2 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-900/20 px-3 py-2">
        <span className="mt-0.5 text-sm leading-none">💡</span>
        <p className="text-[11px] leading-relaxed text-emerald-200">
          <span className="font-bold text-emerald-300">{t("alert.takeProfit")}</span>
          {alert.body}
        </p>
      </div>
    );
  }

  if (alert.severity === "stopLoss") {
    return (
      <div className="mb-2 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-900/20 px-3 py-2">
        <span className="mt-0.5 text-sm leading-none">⚠️</span>
        <p className="text-[11px] leading-relaxed text-rose-200">
          <span className="font-bold text-rose-300">{t("alert.stopLoss")}</span>
          {alert.body}
        </p>
      </div>
    );
  }

  return (
    <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-900/20 px-3 py-2">
      <span className="mt-0.5 text-sm leading-none">👀</span>
      <p className="text-[11px] leading-relaxed text-amber-200">
        <span className="font-bold text-amber-300">{t("alert.monitor")}</span>
        {alert.body}
      </p>
    </div>
  );
}
