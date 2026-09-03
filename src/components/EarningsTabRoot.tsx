// src/components/EarningsTabRoot.tsx
import { useState } from "react";
import EarningsIvCrashTab from "@/components/EarningsIvCrashTab";
import { useI18n } from "@/i18n/I18nContext";

// "财报" is one tab with a real hierarchy underneath it, not a single flat
// flow — see chat: 赌财报 splits into IV Crash and 方向 (direction), and IV
// Crash itself splits further into tiers by how strict the "past earnings
// stayed calm" requirement is (90% / 80% / 70% of the last 3 years' high-
// low extremes under 10%). Only the 90% tier has been designed and built
// so far (EarningsIvCrashTab) — 80%/70% and the whole 方向 branch are
// placeholders until their own design passes happen, same as 财报/待定
// were placeholders before this branch existed.
type EarningsMode = "ivCrash" | "direction" | null;
type IvCrashTier = "90" | "80" | "70" | null;

export default function EarningsTabRoot({ onOpened }: { onOpened: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<EarningsMode>(null);
  const [tier, setTier] = useState<IvCrashTier>(null);

  if (mode === null) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="mb-1 text-[11px] font-semibold text-slate-400">测试标记ABC123 {t("scenario.earningsPickMode")}</div>
        <button
          onClick={() => setMode("ivCrash")}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-4 text-left transition hover:border-violet-500/60 hover:bg-slate-900/80"
        >
          <div className="text-sm font-bold text-slate-100">{t("scenario.earningsModeIvCrash")}</div>
          <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{t("scenario.earningsModeIvCrashDesc")}</div>
        </button>
        <button
          onClick={() => setMode("direction")}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-4 text-left transition hover:border-violet-500/60 hover:bg-slate-900/80"
        >
          <div className="text-sm font-bold text-slate-100">{t("scenario.earningsModeDirection")}</div>
          <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{t("scenario.earningsModeDirectionDesc")}</div>
        </button>
      </div>
    );
  }

  if (mode === "direction") {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <button onClick={() => setMode(null)} className="text-[11px] text-slate-500 transition hover:text-slate-300">
          ← {t("scenario.earningsBack")}
        </button>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-500">
          {t("scenario.tab.comingSoon")}
        </div>
      </div>
    );
  }

  if (tier === null) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <button onClick={() => setMode(null)} className="text-[11px] text-slate-500 transition hover:text-slate-300">
          ← {t("scenario.earningsBack")}
        </button>
        <div className="mb-1 text-[11px] font-semibold text-slate-400">{t("scenario.earningsPickTier")}</div>
        {(["90", "80", "70"] as const).map((tk) => (
          <button
            key={tk}
            onClick={() => setTier(tk)}
            disabled={tk !== "90"}
            className={`w-full rounded-lg border p-4 text-left transition ${
              tk === "90"
                ? "border-slate-700 bg-slate-900 hover:border-violet-500/60 hover:bg-slate-900/80"
                : "cursor-not-allowed border-slate-800 bg-slate-900/40 opacity-50"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-100">{t("scenario.earningsTierLabel", { pct: tk })}</span>
              {tk !== "90" && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-500">{t("scenario.tab.comingSoon")}</span>}
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{t("scenario.earningsTierDesc", { pct: tk })}</div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <button onClick={() => setTier(null)} className="mb-3 text-[11px] text-slate-500 transition hover:text-slate-300">
        ← {t("scenario.earningsBack")}
      </button>
      <EarningsIvCrashTab onOpened={onOpened} />
    </div>
  );
}
