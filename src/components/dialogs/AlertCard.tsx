import type { AlertInfo } from "@/components/PayoffChart";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  alert: AlertInfo;
}

export default function AlertCard({ alert }: Props) {
  const { t } = useI18n();
  if (!alert.zone) return null;

  if (alert.stock) {
    if (alert.zone === "golden") {
      return (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-900/20 px-3 py-2">
          <span className="mt-0.5 text-sm leading-none">💡</span>
          <p className="text-[11px] leading-relaxed text-emerald-200">
            <span className="font-bold text-emerald-300">{t("alert.goldenStock")}</span>
            {t("alert.goldenStockDesc", { pnl: alert.pnl.toFixed(2), max: alert.maxProfit.toFixed(2), pct: alert.capturedPct.toFixed(0) })}
          </p>
        </div>
      );
    }
    const lossPct = alert.maxLoss < 0 ? (alert.pnl / alert.maxLoss) * 100 : 0;
    return (
      <div className="mb-2 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-900/20 px-3 py-2">
        <span className="mt-0.5 text-sm leading-none">⚠️</span>
        <p className="text-[11px] leading-relaxed text-rose-200">
          <span className="font-bold text-rose-300">{t("alert.stopStock")}</span>
          {t("alert.stopStockDesc", { pnl: Math.abs(alert.pnl).toFixed(2), max: Math.abs(alert.maxLoss).toFixed(2), pct: Math.abs(lossPct).toFixed(0) })}
          {alert.zone === "stop" ? t("alert.stopStockNear") : t("alert.stopStockFar")}
        </p>
      </div>
    );
  }

  if (alert.zone === "golden") {
    return (
      <div className="mb-2 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-900/20 px-3 py-2">
        <span className="mt-0.5 text-sm leading-none">💡</span>
        <p className="text-[11px] leading-relaxed text-emerald-200">
          <span className="font-bold text-emerald-300">{t("alert.golden")}</span>
          {t("alert.goldenDesc", { days: alert.days > 0 ? ` ${alert.days} ${t("compare.days")}` : "", pct: alert.capturedPct.toFixed(0), pnl: alert.pnl.toFixed(0) })}
        </p>
      </div>
    );
  }

  const lossRatio = alert.netCredit > 0 ? (-alert.pnl / alert.netCredit) : 0;
  return (
    <div className="mb-2 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-900/20 px-3 py-2">
      <span className="mt-0.5 text-sm leading-none">⚠️</span>
      <p className="text-[11px] leading-relaxed text-rose-200">
        <span className="font-bold text-rose-300">{t("alert.stop")}</span>
        {t("alert.stopDesc", { pnl: Math.abs(alert.pnl).toFixed(0) })}
        {alert.netCredit > 0 ? t("alert.stopCredit", { ratio: lossRatio.toFixed(1) }) : ""}
        {t("alert.stopAction")}
      </p>
    </div>
  );
}