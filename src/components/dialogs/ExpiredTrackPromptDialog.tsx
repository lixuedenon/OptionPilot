// src/components/dialogs/ExpiredTrackPromptDialog.tsx
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";

// 2026-09-17新增。对比模式"跟踪"一条已经过了真实到期日的策略时弹出的提
// 示——跟ExpiredStrategyDialog.tsx（分析模式"打开策略"用，删除/保留二选
// 一）是姊妹组件但故意分开：对比模式的核心是"开仓组合 vs 今日组合"两份
// 真实数据的比较，真实到期日一过，合约在市场上已经不存在了，压根没有
// "今日真实行情"可言，"保留下来继续跟踪"这个选项没有意义——所以这里只提
// 示信息，一个"确定"按钮，点了直接删除这条策略，不给"保留"分支。
interface Props {
  filename: string;
  onConfirm: () => void;
}

export default function ExpiredTrackPromptDialog({ filename, onConfirm }: Props) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-80 rounded-xl border border-amber-500/30 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={18} className="text-amber-400" />
          <h3 className="text-sm font-bold text-amber-200">{t("expired.title")}</h3>
        </div>
        <p className="mb-1 text-[12px] leading-relaxed text-slate-300">
          {t("expired.trackDesc")}
        </p>
        <p className="mb-5 truncate text-[11px] font-mono text-slate-500" title={filename}>{filename}</p>
        <div className="flex justify-end">
          <button
            onClick={onConfirm}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-amber-500"
          >
            {t("expired.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
