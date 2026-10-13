// src/components/AdjustCompareButton.tsx
// 展期/保护/对冲对话框底部的"放到对比方案里比"按钮（只在分析模式出现）。
import { GitCompare } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";
import type { Leg } from "@/lib/types";

export interface CompareOption {
  // 选这个时：方案A不动，复制一份调整后的组合放进新的对比方案。
  onConfirm: (leg: Leg) => void;
  // 有值时按钮变灰，悬停说明原因（对比方案已满、腿数超过10条）。
  disabledReason?: string;
  // 只能放进对比方案（已经展期过的腿再展期：叠在A里会变成两倍仓位）。
  only?: boolean;
}

export function AdjustCompareNote({ option, onlyKey }: { option?: CompareOption; onlyKey: string }) {
  const { t } = useI18n();
  if (!option?.only) return null;
  return (
    <p className="mt-4 rounded-md border border-sky-700/40 bg-sky-950/30 px-3 py-2 text-[11px] leading-relaxed text-sky-200">
      {t(onlyKey)}
      {option.disabledReason && <span className="mt-1 block text-amber-300">{option.disabledReason}</span>}
    </p>
  );
}

export function AdjustCompareButton({ option, busy, onClick }: { option?: CompareOption; busy?: boolean; onClick: () => void }) {
  const { t } = useI18n();
  if (!option) return null;
  const blocked = !!option.disabledReason;
  return (
    <button
      onClick={onClick}
      disabled={busy || blocked}
      title={option.disabledReason ?? t("adjust.toCompareHint")}
      className="flex items-center gap-1 rounded-md border border-sky-600/70 px-3 py-1.5 text-[11px] font-semibold text-sky-300 transition hover:border-sky-500 hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <GitCompare size={12} />
      {t("adjust.toCompare")}
    </button>
  );
}
