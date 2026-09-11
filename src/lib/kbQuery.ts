// src/lib/kbQuery.ts
//
// Query construction + fetch for the "持仓处置建议" retrieval feature (see
// claude/retrieval-feature-design.md). Two independent pieces:
//
// 1. computePositionSignals(): from the same kind of numbers
//    situationExplainer.ts's actionHints() already computes (DTE, distance
//    to the nearest breakeven, which P&L zone the position is in), decides
//    which of the KB's 4 "computable" situation_tag values apply right now.
//    Deliberately NOT importing those helpers from situationExplainer.ts —
//    that file's internal functions aren't exported, and duplicating this
//    small amount of arithmetic here is safer than modifying a file whose
//    App.tsx callers have a carefully-ordered dependency chain (see
//    CLAUDE.md's TDZ warning) just to add exports for an unrelated feature.
//
// 2. fetchPositionAdvice(): calls the kb-retrieve Edge Function the same
//    way the rest of the app calls its other Edge Functions (plain fetch +
//    VITE_SUPABASE_ANON_KEY bearer token — see src/lib/optionChain.ts) —
//    this app has never used the @supabase/supabase-js client on the
//    frontend, so this doesn't introduce that dependency.

import type { Leg } from "./types";
import { maxProfitLoss, legGreekBreakdown } from "./pricing";
import { toKbStrategyMeta } from "./kbStrategyMeta";

export type SituationTag = "near_expiry" | "pin_risk" | "take_profit_target" | "stop_loss_trigger";
export type Direction = "bullish" | "bearish" | "neutral";

// Same thresholds situationExplainer.ts's actionHints()/classifyPnl() use —
// see that file's DTE_HINT_THRESHOLD / BREAKEVEN_HINT_THRESHOLD / the 70%
// zone cutoff in classifyPnl(). Kept as separate constants here (rather
// than imported) for the reason explained above.
const DTE_THRESHOLD = 21;
const BREAKEVEN_PCT_THRESHOLD = 3;
const PNL_ZONE_PCT_THRESHOLD = 70;

// Priority when a position happens to trip more than one signal at once
// (e.g. both near expiry AND near max profit) — a P&L extreme is the more
// urgent thing to look at than a plain DTE countdown.
const TAG_PRIORITY: SituationTag[] = ["stop_loss_trigger", "take_profit_target", "pin_risk", "near_expiry"];

export interface PositionSignals {
  dte: number | null;
  breakevenPct: number | null;
  tagCandidates: SituationTag[];
  primaryTag: SituationTag | null;
}

export function computePositionSignals(params: {
  legs: Leg[]; // active legs, current (not opening) state
  spot: number; // current spot to evaluate P&L/breakeven distance against
  change: number; // current P&L relative to opening (e.g. trackedResult.change, or unrealized for a SimPosition)
  breakevens: number[];
  dte: number | null; // nearest DTE remaining among current option legs — caller already has this (nearestDteRemaining in SimulatorPage, minDte-equivalent in compare mode)
}): PositionSignals {
  const { legs, spot, change, breakevens, dte } = params;
  const { maxProfit, maxLoss } = maxProfitLoss(legs, spot);

  const breakevenPct =
    breakevens.length > 0 && spot > 0
      ? (Math.min(...breakevens.map((be) => Math.abs(spot - be))) / spot) * 100
      : null;

  let nearMaxProfit = false;
  let nearMaxLoss = false;
  if (Math.abs(change) >= 0.01) {
    if (change > 0 && maxProfit > 0) {
      nearMaxProfit = (change / maxProfit) * 100 >= PNL_ZONE_PCT_THRESHOLD;
    } else if (change < 0 && maxLoss < 0) {
      // maxLoss is itself negative, so change/maxLoss is positive when both are negative
      nearMaxLoss = (change / maxLoss) * 100 >= PNL_ZONE_PCT_THRESHOLD;
    }
  }

  const tagCandidates: SituationTag[] = [];
  if (nearMaxLoss) tagCandidates.push("stop_loss_trigger");
  if (nearMaxProfit) tagCandidates.push("take_profit_target");
  if (breakevenPct !== null && breakevenPct < BREAKEVEN_PCT_THRESHOLD) tagCandidates.push("pin_risk");
  if (dte !== null && dte <= DTE_THRESHOLD) tagCandidates.push("near_expiry");

  // Sort by priority rather than the (arbitrary) push order above.
  tagCandidates.sort((a, b) => TAG_PRIORITY.indexOf(a) - TAG_PRIORITY.indexOf(b));

  return { dte, breakevenPct, tagCandidates, primaryTag: tagCandidates[0] ?? null };
}

// Fallback direction inference for the 7 KB strategies with no
// matchStrategy()/presets.ts equivalent (see kbStrategyMeta.ts) — sums
// signed per-contract delta across active legs. This is a coarser read
// than the KB's own fixed per-strategy direction label (see
// kbStrategyMeta.ts's comment on why that table exists), but there's no
// better option once we don't know which of the 48 KB strategies the
// position structurally corresponds to.
const NEUTRAL_DELTA_BAND = 0.15;

export function inferDirection(legs: Leg[], spot: number): Direction {
  const active = legs.filter((l) => !l.disabled);
  if (active.length === 0 || spot <= 0) return "neutral";
  const netDelta = active.reduce((sum, l) => {
    const qty = l.kind === "stock" ? 1 : (l.qty ?? 1);
    return sum + legGreekBreakdown(l, { dS: 0, dT: 0, dV: 0 }, spot).delta * qty;
  }, 0);
  if (netDelta > NEUTRAL_DELTA_BAND) return "bullish";
  if (netDelta < -NEUTRAL_DELTA_BAND) return "bearish";
  return "neutral";
}

export interface KbRecord {
  id: string;
  source: string;
  strategy: string;
  leg_count: number;
  direction: Direction;
  situation_tag: SituationTag;
  label: string;
  question: string;
  answer: string;
  action: string;
  reasoning: string;
  risk_factors: string;
}

export type MatchLevel = "strategy" | "leg_direction" | "tag_only" | "none";

export interface PositionAdviceResult {
  records: KbRecord[];
  matchLevel: MatchLevel;
}

// Builds the query params from a live position + its matched strategy name
// (from matchStrategy() or compare mode's equivalent), then calls
// kb-retrieve. `matchedStrategyName` may be null (matchStrategy() found
// nothing close enough) — the query still runs, just without a strategy
// filter (kb-retrieve's tier 2).
export async function fetchPositionAdvice(params: {
  matchedStrategyName: string | null;
  legs: Leg[]; // used only for the fallback leg_count/direction when the strategy doesn't map to a KB entry
  spot: number;
  tag: SituationTag;
}): Promise<PositionAdviceResult> {
  const { matchedStrategyName, legs, spot, tag } = params;

  const kbMeta = toKbStrategyMeta(matchedStrategyName);
  const strategyName = kbMeta?.kbStrategyName ?? null;
  const legCount = kbMeta?.meta.legCount ?? legs.filter((l) => !l.disabled).length;
  const direction: Direction = kbMeta?.meta.direction ?? inferDirection(legs, spot);

  const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kb-retrieve`);
  url.searchParams.set("legCount", String(legCount));
  url.searchParams.set("direction", direction);
  url.searchParams.set("tag", tag);
  if (strategyName) url.searchParams.set("strategy", strategyName);

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`kb-retrieve returned ${resp.status}: ${body.slice(0, 300)}`);
  }
  return await resp.json();
}