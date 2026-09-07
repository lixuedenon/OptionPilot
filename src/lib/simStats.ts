// src/lib/simStats.ts
import type { SimPosition } from "./simAccount";

// Trade-quality statistics for the simulator (2026-09, xue's proposal #6,
// v1 scope). Deliberately pure realized-P&L-sequence stats — no margin
// dependency — because SimPosition doesn't persist "margin used at open"
// (margin is only ever computed live over currently-open positions, see
// margin.ts's computeMarginUsed), so anything margin-adjusted (e.g. return
// on margin / annualized yield) can't be recomputed for positions that are
// already closed. That's intentionally left for later, alongside the
// backlog's "年化收益率" item, which would need the same new stored field
// and should land together rather than bolting one narrow case on here.
//
// maxDrawdown here is the peak-to-trough drop in the CUMULATIVE REALIZED
// P&L sequence (closed trades only, ordered by close time) — not a daily
// mark-to-market equity curve including unrealized swings. The latter would
// need account-level snapshot aggregation the data model doesn't support
// today (PositionSnapshot is per-position, not aggregated account-wide);
// see FEATURE_PROPOSALS_2026-09.md's Feature C notes for the fuller
// version if that fidelity is ever wanted.
export interface SimStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number | null; // 0..1, null when there are no closed trades yet
  avgWin: number | null; // average of positive realizedPnl, null if no wins
  avgLoss: number | null; // average MAGNITUDE of negative realizedPnl (positive number), null if no losses
  profitFactor: number | null; // sum(wins) / sum(|losses|); Infinity if all wins and no losses; null if no trades or no wins
  maxWinStreak: number;
  maxLossStreak: number;
  maxDrawdown: number; // magnitude, >= 0
}

const EMPTY_STATS: SimStats = {
  totalTrades: 0,
  wins: 0,
  losses: 0,
  winRate: null,
  avgWin: null,
  avgLoss: null,
  profitFactor: null,
  maxWinStreak: 0,
  maxLossStreak: 0,
  maxDrawdown: 0,
};

export function computeSimStats(positions: SimPosition[]): SimStats {
  const closed = positions
    .filter((p): p is SimPosition & { realizedPnl: number; closedAt: number } =>
      p.status === "closed" && typeof p.realizedPnl === "number" && typeof p.closedAt === "number",
    )
    .sort((a, b) => a.closedAt - b.closedAt);

  if (closed.length === 0) return EMPTY_STATS;

  let wins = 0;
  let losses = 0;
  let sumWin = 0;
  let sumLoss = 0; // positive magnitude
  let winStreak = 0;
  let lossStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const p of closed) {
    const pnl = p.realizedPnl;
    if (pnl > 0) {
      wins++;
      sumWin += pnl;
      winStreak++;
      lossStreak = 0;
      if (winStreak > maxWinStreak) maxWinStreak = winStreak;
    } else if (pnl < 0) {
      losses++;
      sumLoss += -pnl;
      lossStreak++;
      winStreak = 0;
      if (lossStreak > maxLossStreak) maxLossStreak = lossStreak;
    } else {
      // Exact breakeven: counts as a trade but doesn't extend either streak.
      winStreak = 0;
      lossStreak = 0;
    }

    cumulative += pnl;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const totalTrades = closed.length;
  const profitFactor = sumLoss > 0 ? sumWin / sumLoss : (sumWin > 0 ? Infinity : null);

  return {
    totalTrades,
    wins,
    losses,
    winRate: wins / totalTrades,
    avgWin: wins > 0 ? sumWin / wins : null,
    avgLoss: losses > 0 ? sumLoss / losses : null,
    profitFactor,
    maxWinStreak,
    maxLossStreak,
    maxDrawdown,
  };
}