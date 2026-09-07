// src/components/SimStatsPanel.tsx
import { Percent, Scale, TrendingDown, Repeat } from "lucide-react";
import type { SimStats } from "@/lib/simStats";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  stats: SimStats;
}

function fmtPct01(v: number | null): string {
  return v === null ? "-" : `${Math.round(v * 100)}%`;
}

function fmtRatio(v: number | null): string {
  if (v === null) return "-";
  if (!Number.isFinite(v)) return "∞"; // ∞ — all wins, no losses yet
  return v.toFixed(2);
}

function fmtMoney(v: number | null): string {
  return v === null ? "-" : `$${v.toFixed(2)}`;
}

// Trade-quality stats, sitting below the account-level summary cards
// (总权益/现金/未实现盈亏/已实现盈亏) — those answer "how is the account doing
// right now," this answers "is this trading approach actually working."
// v1 scope (2026-09, xue's proposal #6): pure realized-P&L-sequence stats,
// no margin/return-on-margin — see simStats.ts's own comment for why.
// Always rendered once there's an account (rather than hidden until trades
// exist), with "-" placeholders and statsEmptyHint below when there's
// nothing closed yet — same "show the framework, explain why" convention
// the rest of the app follows instead of hiding UI outright.
export default function SimStatsPanel({ stats }: Props) {
  const { t } = useI18n();
  const hasTrades = stats.totalTrades > 0;

  return (
    <div className="mb-4">
      <div className="mb-2 text-[11px] font-bold text-slate-500">
        {t("sim.statsTitle", { trades: stats.totalTrades })}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-emerald-400">
            <Percent size={12} />
            <span className="text-[8px] text-slate-500">{t("sim.statsWinRate")}</span>
          </div>
          <div className="text-sm font-bold text-slate-100">{fmtPct01(stats.winRate)}</div>
          <div className="mt-0.5 text-[8px] text-slate-600">
            {t("sim.statsWinLossCount", { wins: stats.wins, losses: stats.losses })}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-sky-400">
            <Scale size={12} />
            <span className="text-[8px] text-slate-500">{t("sim.statsProfitFactor")}</span>
          </div>
          <div className="text-sm font-bold text-slate-100">{fmtRatio(stats.profitFactor)}</div>
          <div className="mt-0.5 text-[8px] text-slate-600">
            {t("sim.statsAvgWinLoss", { win: fmtMoney(stats.avgWin), loss: fmtMoney(stats.avgLoss) })}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-rose-400">
            <TrendingDown size={12} />
            <span className="text-[8px] text-slate-500">{t("sim.statsMaxDrawdown")}</span>
          </div>
          <div className="text-sm font-bold text-rose-400">
            {hasTrades ? `-$${stats.maxDrawdown.toFixed(2)}` : "-"}
          </div>
          <div className="mt-0.5 text-[8px] text-slate-600">{t("sim.statsDrawdownHint")}</div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-amber-400">
            <Repeat size={12} />
            <span className="text-[8px] text-slate-500">{t("sim.statsStreak")}</span>
          </div>
          <div className="text-sm font-bold text-slate-100">
            {hasTrades ? `${stats.maxWinStreak} / ${stats.maxLossStreak}` : "-"}
          </div>
          <div className="mt-0.5 text-[8px] text-slate-600">{t("sim.statsStreakHint")}</div>
        </div>
      </div>
      {!hasTrades && (
        <div className="mt-2 text-[10px] text-slate-600">{t("sim.statsEmptyHint")}</div>
      )}
    </div>
  );
}
