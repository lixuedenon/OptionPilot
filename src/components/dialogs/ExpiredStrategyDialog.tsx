// src/components/dialogs/ExpiredStrategyDialog.tsx
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";

// 2026-09-15新增。分析模式打开一条策略时，如果"真实经过天数"已经超过它
// 第0天(legsAsOf)当时的完整周期，说明这条策略现实中已经过了真正的到期
// 日——弹这个框问用户删除还是保留。保留的话滑块依然能在完整周期内自由
// 模拟，只是不再有"今天"这个参考点（App.tsx的isExpiredOpening/
// PayoffChart的expired prop负责视觉上的"仅供历史模拟参考"提示）。见
// savedStrategies.ts的OpeningSimBasis注释。
interface Props {
  filename: string;
  onKeep: () => void;
  onDelete: () => void;
}

export default function ExpiredStrategyDialog({ filename, onKeep, onDelete }: Props) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-80 rounded-xl border border-amber-500/30 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={18} className="text-amber-400" />
          <h3 className="text-sm font-bold text-amber-200">{t("expired.title")}</h3>
        </div>
        <p className="mb-1 text-[12px] leading-relaxed text-slate-300">
          {t("expired.desc")}
        </p>
        <p className="mb-5 truncate text-[11px] font-mono text-slate-500" title={filename}>{filename}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onDelete}
            className="rounded-md border border-rose-600/60 px-3 py-1.5 text-[11px] font-semibold text-rose-300 transition hover:border-rose-500 hover:text-rose-200"
          >
            {t("expired.delete")}
          </button>
          <button
            onClick={onKeep}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-amber-500"
          >
            {t("expired.keep")}
          </button>
        </div>
      </div>
    </div>
  );
}
