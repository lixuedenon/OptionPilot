// src/lib/scenarioEngine.ts
import type { Leg, OptionType } from "./types";
import { PRESET_GROUPS, type PresetMeta } from "./presets";
import { blackScholes } from "./bs";
import { maxProfitLoss, probabilityOfProfit, impliedVol } from "./pricing";

export type Bucket = "strongDown" | "mildDown" | "flat" | "mildUp" | "strongUp";
export const ALL_BUCKETS: Bucket[] = ["strongDown", "mildDown", "flat", "mildUp", "strongUp"];

// The 5 fixed time windows from the scenario selector UI, mapped to days.
// A calendar month/quarter/year isn't a fixed day count, but this doesn't
// need to be exact — it's an input to computeBucketBounds' sqrt(days/365)
// expected-move formula, where being off by a day or two has no visible
// effect on the resulting bucket boundaries.
export const TIME_WINDOWS: { id: string; days: number; labelZh: string; labelEn: string }[] = [
  { id: "1w", days: 7, labelZh: "一周", labelEn: "1 Week" },
  { id: "1m", days: 30, labelZh: "一个月", labelEn: "1 Month" },
  { id: "3m", days: 90, labelZh: "三个月", labelEn: "3 Months" },
  { id: "6m", days: 182, labelZh: "六个月", labelEn: "6 Months" },
  { id: "1y", days: 365, labelZh: "一年", labelEn: "1 Year" },
];

export const BUCKET_LABELS: Record<Bucket, { zh: string; en: string }> = {
  strongDown: { zh: "强烈看跌", en: "Strongly Bearish" },
  mildDown: { zh: "温和看跌", en: "Mildly Bearish" },
  flat: { zh: "平盘", en: "Flat" },
  mildUp: { zh: "温和看涨", en: "Mildly Bullish" },
  strongUp: { zh: "强烈看涨", en: "Strongly Bullish" },
};

// Max checkboxes selectable — see design notes elsewhere: selecting all 5
// carries the same (zero) information as selecting none, so the UI should
// never let the person reach that state rather than special-case it after
// the fact. Exported so the selector component and this engine can't drift
// out of sync on what the limit actually is.
export const MAX_SELECTABLE_BUCKETS = 4;

// ── bucket thresholds ──
// Expected move over the window, from the underlying's current weighted
// IV (see pricing.ts's weightedAvgIV — callers pass that in as `iv` here
// rather than this module re-deriving it, since it already needs a real
// quote/chain to compute and this module shouldn't own that dependency).
// The ±0.3σ / 1σ split points are the ones discussed with Xue — deliberately
// easy to retune, see BOUND_INNER / BOUND_OUTER below.
const BOUND_INNER = 0.3; // flat vs mild boundary, in units of expected-move σ
const BOUND_OUTER = 1.0; // mild vs strong boundary, in units of expected-move σ
// Representative price for evaluating the two open-ended buckets — a point
// meaningfully past the strong threshold, not the threshold itself, since
// scoring AT the boundary would understate how a strategy performs deep
// into that bucket (e.g. a long call's payoff keeps climbing well past 1σ).
const OPEN_END_REPR = 1.5; // in units of σ, for strongUp/strongDown only

export interface BucketBounds {
  strongDownMax: number; // prices below this are "strongDown"
  mildDownMax: number;   // [strongDownMax, mildDownMax) is "mildDown"
  flatMax: number;       // [mildDownMax, flatMax] is "flat"
  mildUpMax: number;     // (flatMax, mildUpMax] is "mildUp"; above is "strongUp"
  repr: Record<Bucket, number>; // representative price used to score each bucket
}

export function computeBucketBounds(spot: number, iv: number, days: number): BucketBounds {
  const sigma = spot * Math.max(0, iv) * Math.sqrt(Math.max(1, days) / 365);
  const inner = sigma * BOUND_INNER;
  const outer = sigma * BOUND_OUTER;
  const openEnd = sigma * OPEN_END_REPR;
  return {
    strongDownMax: spot - outer,
    mildDownMax: spot - inner,
    flatMax: spot + inner,
    mildUpMax: spot + outer,
    repr: {
      strongDown: Math.max(0.01, spot - openEnd),
      mildDown: spot - (inner + outer) / 2,
      flat: spot,
      mildUp: spot + (inner + outer) / 2,
      strongUp: spot + openEnd,
    },
  };
}

// ── strike optimization ──
// Instead of copying a preset's illustrative percentage-of-spot strikes
// (which just encode whatever width the preset's author happened to pick,
// unrelated to the actual scenario), reposition strikes against the SAME
// bucket boundaries used for scoring. One rule, applied leg-by-leg — no
// need to hand-classify each preset into a fixed set of shapes:
//
//   - A combo with 0-1 option legs (a lone directional bet): the single
//     leg's strike is positioned by the risk tier (see computeTieredStrike)
//     regardless of buy or sell — this is what lets the SAME preset (a
//     plain short put, say) serve as either a conservative OTM income play
//     or an aggressive deep-ITM stock-substitute depending on which tier
//     the person picked, without needing a separate preset for "deep ITM
//     short put."
//   - For each option TYPE (call/put) present, 3+ legs of that type with a
//     strike shared by 2+ of them AND legs on BOTH sides of that strike
//     is a butterfly-shaped "body" (buy-low / sell-sell-middle / buy-high)
//     — the body anchors to the scenario's price target (the weighted
//     average of the selected buckets' representative points), and the
//     wings sit a fixed distance out from the body. A 1-buy/2-sell ratio
//     spread also has 3 same-type legs and a repeated strike, but only has
//     legs on ONE side of it — checked separately below so it isn't
//     mistaken for a butterfly.
//   - Otherwise, if BOTH a sell and a buy leg exist for that type, it's a
//     vertical (or the 1-buy/2-sell shape of a ratio spread): the SOLD
//     leg(s) anchor to the boundary between the selected/excluded buckets
//     on that side (mildDownMax for puts, mildUpMax for calls); the
//     bought leg(s) sit one wing-width further from the money than that —
//     this reads correctly regardless of which side was closer to spot in
//     the original illustrative preset.
//   - A single leg of that type with no opposite-action partner (a collar's
//     protective put, a covered call's income call, a naked protective
//     put) anchors directly to that same boundary — a sold income leg and
//     a bought protection leg are drawing the same line for different
//     reasons ("past this point my view was wrong" either way), so they
//     get the same anchor logic.
//
// Known simplification: Iron Butterfly's defining feature is both short
// strikes sitting at the SAME price (a tight, symmetric center). This rule
// anchors the put side and call side independently (mildDownMax and
// mildUpMax), which pulls them apart into something closer to a narrower
// Iron Condor rather than preserving the tight single-strike body. Flagging
// this rather than silently changing what "Iron Butterfly" produces —
// if the tight center matters, that preset needs a one-off exception.
const WING_SIGMA_MULT = 0.5; // fixed multiple of the expected-move sigma, not proportional to the preset's original illustrative width — retune this number freely, the shape of the rule is what matters

function weightedBucketTarget(bounds: BucketBounds, buckets: Bucket[]): number {
  if (buckets.length === 0) return bounds.repr.flat;
  const sum = buckets.reduce((acc, b) => acc + bounds.repr[b], 0);
  return sum / buckets.length;
}

export type Tier = "aggressive" | "neutral" | "conservative";
export const TIER_LABELS: Record<Tier, { zh: string; en: string }> = {
  aggressive: { zh: "激进", en: "Aggressive" },
  neutral: { zh: "中性", en: "Neutral" },
  conservative: { zh: "保守", en: "Conservative" },
};

// A SOLD leg represents "the edge of my accepted range" — a sold put's
// assignment risk is on the DOWNSIDE, a sold call's is on the UPSIDE — so
// its neutral position should sit exactly at the boundary between the
// buckets the person SELECTED and the ones they didn't, on that side.
// Walking outward from flat: if the mild bucket on that side isn't
// selected, the boundary is right at the edge of flat; if mild is
// selected but strong isn't, push to the mild/strong boundary; if strong
// IS selected too, there's no boundary left on that side (open-ended) —
// use its far representative point instead. This is what makes "strongly
// bearish + mildly bearish + flat + mildly bullish selected, only
// strongly bullish excluded" correctly park a sold call's strike way out
// near the strong/mild boundary (clearing the whole mildly-bullish zone)
// instead of a fixed, scenario-blind distance from spot that happened to
// land INSIDE the mildly-bullish zone and made the "sell call" structure
// score as a loser there — caught by checking that exact case against
// worked numbers rather than trusting the fixed-distance version by
// inspection.
function selectedDownBoundary(bounds: BucketBounds, selectedBuckets: Bucket[]): number {
  const selected = new Set(selectedBuckets);
  if (!selected.has("mildDown")) return bounds.mildDownMax;
  if (!selected.has("strongDown")) return bounds.strongDownMax;
  return bounds.repr.strongDown;
}
function selectedUpBoundary(bounds: BucketBounds, selectedBuckets: Bucket[]): number {
  const selected = new Set(selectedBuckets);
  if (!selected.has("mildUp")) return bounds.flatMax;
  if (!selected.has("strongUp")) return bounds.mildUpMax;
  return bounds.repr.strongUp;
}

// How far the aggressive/conservative tiers shift from that scenario-
// implied boundary — a small nudge either side of "exactly the edge you
// said," not a big swing; retune freely.
const TIER_ADJUST_SIGMA = 0.2;

// When the scenario explicitly EXCLUDED the matching "strong" bucket on
// this leg's side (strongDown for a put, strongUp for a call), that
// exclusion itself is a statement that real protection matters here —
// the person isn't just leaning bearish/bullish, they're saying "and I
// don't believe a real crash/rally happens." Letting "aggressive" pull
// the strike all the way in by the normal amount quietly gives up part
// of that stated protection without the person necessarily noticing —
// caught by checking a "温和看跌 selected, 强烈看跌 excluded" scenario's
// actual numbers: aggressive dropped win rate from 87% to 83%, trading
// away real crash protection for a modest premium bump the person never
// asked to trade against. So the aggressive tier only gets a SMALLER
// nudge toward the money in that case — still somewhat more aggressive
// than neutral, just not at the cost of the safety the scenario itself
// called for. Doesn't apply to the conservative tier (moving further
// from the money is never a "quietly gave up protection" problem), and
// doesn't apply at all when the matching strong bucket IS selected (the
// person never asked for that protection in the first place).
const TIGHTENED_AGGRESSIVE_ADJUST_SIGMA = 0.08;

// A leg's strike moves along the SAME risk/reward axis Xue asked for
// (aggressive = closer to, or even past, the money = more premium/leverage
// = higher risk & reward; conservative = further from the money = safer,
// smaller payoff). SOLD legs anchor to the scenario boundary above and
// the tiers nudge in/out from THAT point (see TIER_ADJUST_SIGMA) — this
// is what makes the strike actually respond to which buckets were picked.
// BOUGHT legs (a lone directional bet, or a vertical's protective/cost-
// reducing extension leg) aren't "the edge of a view" the same way, so
// they keep a simpler fixed distance from spot per tier rather than being
// scenario-boundary-aware; getting the sign right per (type, action) here
// was verified against worked numbers, not trusted by inspection.
function computeTieredStrike(type: OptionType, action: "buy" | "sell", spot: number, sigma: number, tier: Tier, bounds?: BucketBounds, selectedBuckets?: Bucket[]): number {
  if (action === "sell" && bounds && selectedBuckets) {
    const boundary = type === "put" ? selectedDownBoundary(bounds, selectedBuckets) : selectedUpBoundary(bounds, selectedBuckets);
    if (tier === "neutral") return boundary;
    // put boundary sits below spot (toward money = up = +); call boundary
    // sits above spot (toward money = down = -).
    const towardMoney = type === "put" ? 1 : -1;
    const sign = tier === "aggressive" ? towardMoney : -towardMoney;
    const relevantStrongBucket: Bucket = type === "put" ? "strongDown" : "strongUp";
    const protectionMatters = !new Set(selectedBuckets).has(relevantStrongBucket);
    const magnitude = tier === "aggressive" && protectionMatters ? TIGHTENED_AGGRESSIVE_ADJUST_SIGMA : TIER_ADJUST_SIGMA;
    return boundary + sign * magnitude * sigma;
  }
  if (type === "put" && action === "sell") {
    if (tier === "aggressive") return spot + 0.3 * sigma;
    if (tier === "neutral") return spot - 0.3 * sigma;
    return spot - 1.0 * sigma;
  }
  if (type === "call" && action === "buy") {
    if (tier === "aggressive") return spot + 1.0 * sigma;
    if (tier === "neutral") return spot + 0.3 * sigma;
    return spot - 0.3 * sigma;
  }
  if (type === "call" && action === "sell") {
    if (tier === "aggressive") return spot - 0.3 * sigma;
    if (tier === "neutral") return spot + 0.3 * sigma;
    return spot + 1.0 * sigma;
  }
  // put + buy
  if (tier === "aggressive") return spot - 1.0 * sigma;
  if (tier === "neutral") return spot - 0.3 * sigma;
  return spot + 0.3 * sigma;
}

function optimizeStrikes(rawLegs: Leg[], spot: number, bounds: BucketBounds, selectedBuckets: Bucket[], sigma: number, tier: Tier): Leg[] {
  const stockLegs = rawLegs
    .filter((l) => l.kind === "stock")
    .map((l) => ({ ...l, strike: Math.round(spot * 100) / 100 }));
  const optionLegs = rawLegs.filter((l) => l.kind !== "stock");

  if (stockLegs.length === 0 && optionLegs.length <= 1) {
    const only = optionLegs[0];
    if (only) {
      const strike = computeTieredStrike(only.type, only.action, spot, sigma, tier, bounds, selectedBuckets);
      return [...stockLegs, { ...only, strike: Math.round(strike * 2) / 2 }];
    }
    return stockLegs;
  }

  // Straddle/strangle detection: exactly one call + one put, BOTH bought
  // or BOTH sold (never mixed — a mixed buy/put+sell/call is a different
  // shape entirely, handled by the vertical/anchor logic further below),
  // covers both Long AND Short Straddle/Strangle — the same-strike-vs-
  // different-strike distinction is what separates a straddle from a
  // strangle regardless of which direction (buy or sell) it's traded in.
  // Missing the SOLD case here was exactly the kind of gap a full sweep
  // catches and single manual tests don't: Short Straddle passed every
  // check that happened to only exercise the bought path, then produced
  // two different strikes (530/510) the moment it was actually run.
  const isCall = (l: Leg) => l.type === "call";
  const isPut = (l: Leg) => l.type === "put";
  const calls = optionLegs.filter(isCall);
  const puts = optionLegs.filter(isPut);
  const isStraddleOrStrangleShape =
    stockLegs.length === 0 &&
    calls.length === 1 &&
    puts.length === 1 &&
    calls[0].action === puts[0].action;

  if (isStraddleOrStrangleShape && calls[0].strike === puts[0].strike) {
    // Straddle: shares one ATM strike by definition. Neither a Long nor a
    // Short straddle has a strike-based aggressive/conservative axis the
    // way an OTM strangle does — both legs are AT the money by
    // definition, so all three tiers land on the same spot-centered
    // strike; tier differentiation for these two presets comes through
    // DTE (the pure-buy extension) rather than strike distance for the
    // long version, and doesn't differentiate by strike at all for the
    // short version. That's a known, deliberate simplification.
    const atmStrike = Math.round(spot * 2) / 2;
    return optionLegs.map((l) => ({ ...l, strike: atmStrike }));
  }

  if (isStraddleOrStrangleShape && calls[0].strike !== puts[0].strike) {
    // Strangle: both legs genuinely OTM by definition, at a tier-
    // dependent distance. The generic per-action tier formula elsewhere
    // is designed for a LONE directional leg (where "conservative"
    // reasonably means "closer to, or past, the money for more delta"),
    // but applied independently to both halves of a strangle pair that
    // lets the two legs cross each other (call's conservative strike
    // ending up below spot, put's above spot) — not a strangle shape
    // anymore. Clamping each leg to a small buffer past spot, on its own
    // natural side, keeps all three tiers varying how far OTM the
    // strangle is, never whether it still IS one. Works the same whether
    // the legs are bought (Long Strangle) or sold (Short Strangle) —
    // "OTM" and "which side" don't depend on buy vs sell.
    const MIN_OTM_SIGMA = 0.1;
    return optionLegs.map((l) => {
      const raw = computeTieredStrike(l.type, l.action, spot, sigma, tier, bounds, selectedBuckets);
      const clamped = l.type === "call"
        ? Math.max(raw, spot + MIN_OTM_SIGMA * sigma)
        : Math.min(raw, spot - MIN_OTM_SIGMA * sigma);
      return { ...l, strike: Math.round(clamped * 2) / 2 };
    });
  }

  // Wing width (how far the protective/paired leg — or a butterfly's
  // wings — sit from the anchor/body) scales with tier too: narrower for
  // aggressive (tighter, more concentrated payoff, cheaper), wider for
  // conservative (more room, safer, costs more). This matters most for
  // butterflies specifically — a butterfly's body position is driven by
  // the SCENARIO, not the tier (see below), so wing width is the ONLY
  // lever available to make its 3 tiers actually different from each
  // other; without this they'd render as 3 identical positions, which
  // defeats the entire point of offering tiers.
  const WING_TIER_MULT: Record<Tier, number> = { aggressive: 0.3, neutral: WING_SIGMA_MULT, conservative: 0.7 };
  const wingWidth = Math.max(0.5, sigma * WING_TIER_MULT[tier]);
  const bodyPrice = weightedBucketTarget(bounds, selectedBuckets);
  const out: Leg[] = [];

  for (const type of ["call", "put"] as OptionType[]) {
    const legsOfType = optionLegs.filter((l) => l.type === type);
    if (legsOfType.length === 0) continue;

    if (legsOfType.length >= 3) {
      // Butterfly signature specifically: a strike shared by 2+ legs, WITH
      // at least one other leg on each side of it (the classic buy-low /
      // sell-sell-middle / buy-high sandwich). A 1-buy/2-sell ratio spread
      // also has 3 legs of one type and a repeated strike, but only has
      // legs on ONE side of that repeated strike — checking for both sides
      // is what tells the two shapes apart, so a ratio spread correctly
      // falls through to the vertical/ratio branch below instead.
      const repeated = legsOfType.find((l) => legsOfType.filter((x) => x.strike === l.strike).length >= 2);
      const hasBothSides = repeated
        ? legsOfType.some((l) => l.strike < repeated.strike) && legsOfType.some((l) => l.strike > repeated.strike)
        : false;

      if (repeated && hasBothSides) {
        // The body's position is driven by the SCENARIO (where selected
        // buckets point), not the risk tier — a butterfly's "which price
        // it's betting on" isn't a risk dial. The wing width IS
        // tier-sensitive (see WING_TIER_MULT above) — that's the only
        // thing that makes a butterfly's 3 tiers different from each
        // other, since the body itself doesn't move.
        for (const l of legsOfType) {
          if (l.strike === repeated.strike) {
            out.push({ ...l, strike: Math.round(bodyPrice * 2) / 2 });
          } else {
            const lowerWing = l.strike < repeated.strike;
            const newStrike = lowerWing ? bodyPrice - wingWidth : bodyPrice + wingWidth;
            out.push({ ...l, strike: Math.round(newStrike * 2) / 2 });
          }
        }
        continue;
      }
    }

    const shorts = legsOfType.filter((l) => l.action === "sell");
    const longs = legsOfType.filter((l) => l.action === "buy");

    if (shorts.length > 0 && longs.length > 0) {
      // Which leg is "the anchor" (positioned close to the money via the
      // tier) and which is "the extension" (positioned further out)
      // depends on whether this is a CREDIT spread or a DEBIT spread —
      // and that isn't determined by buy/sell alone. A credit spread
      // (Bull Put, Bear Call, Iron Condor's each side): the SOLD leg is
      // the near-money income leg, the BOUGHT leg is the further-out
      // protection. A debit spread (Bull Call, Bear Put): it's reversed
      // — the BOUGHT leg is the near-money leg you're paying for
      // directional exposure with, and the SOLD leg is further out,
      // reducing cost/capping profit. Using "sell always anchors" — the
      // earlier version of this rule — silently inverted every debit
      // spread's strikes (a "Bull Call Spread" came out with its sell
      // leg BELOW its buy leg, which is backwards; caught by checking a
      // mildDown scenario recommend a "Bull Call Spread" that was
      // structurally a bear spread wearing the wrong name).
      // Illustrative premiums tell the two apart: whichever of the short
      // or long leg was priced higher in the ORIGINAL preset is the
      // "primary" leg for a spread of that width, and that's the anchor.
      const netCredit = shorts[0].premium >= longs[0].premium;
      const anchorAction: "buy" | "sell" = netCredit ? "sell" : "buy";
      const edge = computeTieredStrike(type, anchorAction, spot, sigma, tier, bounds, selectedBuckets);
      // The OUTER leg's direction from the anchor is fixed by option type
      // alone, regardless of credit/debit — a call spread's outer leg is
      // always the HIGHER strike (whichever leg plays that role), a put
      // spread's outer leg is always the LOWER strike.
      const extensionOffset = type === "call" ? wingWidth : -wingWidth;
      for (const l of legsOfType) {
        const isAnchor = l.action === anchorAction;
        const newStrike = isAnchor ? edge : edge + extensionOffset;
        out.push({ ...l, strike: Math.round(newStrike * 2) / 2 });
      }
    } else {
      for (const l of legsOfType) {
        const strike = computeTieredStrike(type, l.action, spot, sigma, tier, bounds, selectedBuckets);
        out.push({ ...l, strike: Math.round(strike * 2) / 2 });
      }
    }
  }

  return [...stockLegs, ...out];
}


// Shift every leg's dte by the same delta so the SHORTEST-dated leg lands
// on `targetDays` — preserves the gap between near/far legs (e.g. a 14/45
// calendar becomes 30/61 for a 30-day target) instead of collapsing every
// leg onto the same expiry, which would silently turn a calendar spread
// into a same-expiry combo and destroy the whole point of the structure.
function anchorDte(legs: Leg[], targetDays: number): Leg[] {
  const optionDtes = legs.filter((l) => l.kind !== "stock").map((l) => l.dte);
  if (optionDtes.length === 0) return legs;
  const minDte = Math.min(...optionDtes);
  const delta = targetDays - minDte;
  return legs.map((l) => (l.kind === "stock" ? l : { ...l, dte: Math.max(1, l.dte + delta) }));
}

// Fill in a theoretical premium for every option leg via Black-Scholes at
// a flat IV (stage 1 of the two-stage plan — cheap, no option-chain calls;
// only the final shortlist gets re-priced against real chain data by the
// caller). Stock legs keep premium 0, matching how the rest of the app
// treats them.
function priceLegsTheoretical(legs: Leg[], spot: number, iv: number, rate = 0.05): Leg[] {
  return legs.map((l) => {
    if (l.kind === "stock") return l;
    const price = blackScholes({ spot, strike: l.strike, dte: l.dte, vol: Math.max(0.01, iv), rate, type: l.type }).price;
    return { ...l, premium: Math.round(price * 100) / 100 };
  });
}

function pnlAtPrice(legs: Leg[], targetPrice: number): number {
  let pnl = 0;
  for (const l of legs) {
    const sign = l.action === "buy" ? 1 : -1;
    const qty = l.qty ?? 1;
    if (l.kind === "stock") {
      pnl += sign * (targetPrice - l.strike) * qty;
      continue;
    }
    const intrinsic = l.type === "call" ? Math.max(0, targetPrice - l.strike) : Math.max(0, l.strike - targetPrice);
    pnl += sign * (intrinsic - l.premium) * qty;
  }
  return pnl;
}

export interface TierResult {
  legs: Leg[]; // theoretical legs (real spot/dte, Black-Scholes premium) — caller re-prices the shortlist against real chain data
  maxProfit: number;
  maxLoss: number;
  pop: number;
  returnOnRisk: number | null; // bucket-weighted pnl / |maxLoss|, null when maxLoss is 0 (shouldn't happen for a real position, but guards div/0)
  bucketPnl: Record<Bucket, number>;
}

export interface ScenarioRecommendation {
  preset: PresetMeta;
  groupLabel: { zh: string; en: string };
  variants: Record<Tier, TierResult>;
}

// See computeTierMetrics for how this is actually used — the ranking
// criterion is the worst outcome among SELECTED buckets (a maximin).
// Note: the earlier scan-all-39-presets version of this file excluded
// multi-expiry (calendar/diagonal) presets here, since maxProfitLoss/
// probabilityOfProfit evaluate every leg's INTRINSIC value at one shared
// terminal price — only valid when every leg is actually at its own
// expiry simultaneously, which a calendar spread's mismatched legs never
// are. That's still a real, separate gap in pricing.ts (also affects
// anyone manually building a calendar in Analysis Mode), but none of the
// hand-picked presets in SCENARIO_RULES below are multi-expiry shapes, so
// the check itself is no longer needed in this file specifically now that
// preset selection comes from Xue's table rather than an automatic scan.

// Computes maxProfit/maxLoss/pop/bucketPnl/returnOnRisk for a set of
// ALREADY-PRICED legs — split out from evaluateTier so the exact same
// scoring math applies whether the premiums came from Black-Scholes
// (theoretical, stage 1) or a real option chain quote (stage 2, see
// repriceWithRealQuotes below). Keeping one implementation means a
// real-data recommendation and a theoretical one are judged by identical
// rules, not two versions that could quietly drift apart.
export function computeTierMetrics(priced: Leg[], spot: number, sigma: number, bounds: BucketBounds, selectedBuckets: Bucket[]): Omit<TierResult, "legs"> {
  const { maxProfit, maxLoss } = maxProfitLoss(priced, spot);
  const { pop } = probabilityOfProfit(priced, spot);

  const bucketPnl: Record<Bucket, number> = {
    strongDown: pnlAtPrice(priced, bounds.repr.strongDown),
    mildDown: pnlAtPrice(priced, bounds.repr.mildDown),
    flat: pnlAtPrice(priced, bounds.repr.flat),
    mildUp: pnlAtPrice(priced, bounds.repr.mildUp),
    strongUp: pnlAtPrice(priced, bounds.repr.strongUp),
  };
  const farUp = pnlAtPrice(priced, spot + sigma * OPEN_END_REPR * 2);
  const farDown = pnlAtPrice(priced, Math.max(0.01, spot - sigma * OPEN_END_REPR * 2));
  bucketPnl.strongUp = Math.min(bucketPnl.strongUp, farUp);
  bucketPnl.strongDown = Math.min(bucketPnl.strongDown, farDown);

  const selected = new Set(selectedBuckets);
  // The ranking criterion is a two-tier maximin, not one flat minimum
  // across every selected bucket. "flat"/"mildDown"/"mildUp" are the
  // higher-probability CORE of the selected range and are held to a hard
  // bar — a candidate needs to be genuinely fine everywhere in that core,
  // same reasoning as before (an additive sum let one lucky corner mask
  // real losses elsewhere in the same accepted range). But "strongDown"/
  // "strongUp" are open-ended TAILS — low-probability by construction,
  // and no defined-risk structure can stay profitable arbitrarily far
  // into a tail once it's past its wings; capped, bounded loss out there
  // is the realistic best case, not a bug. Treating a tail bucket as an
  // equally hard constraint as the core meant a structure with genuinely
  // strong core performance (an Iron Butterfly, flat/mildDown both solidly
  // positive) lost to a structure that was merely non-negative EVERYWHERE
  // including both tails (a thin, barely-profitable Put Backspread) —
  // technically satisfying the maximin, but a worse real recommendation.
  // Splitting the two lets the core do the ranking and the tail act as a
  // softer, capped penalty (only when the tail is actually a loss; a
  // strong tail performance doesn't get extra credit for being unlikely
  // to matter) rather than a second hard floor.
  const CORE_BUCKETS: Bucket[] = ["mildDown", "flat", "mildUp"];
  const TAIL_BUCKETS: Bucket[] = ["strongDown", "strongUp"];
  const TAIL_PENALTY_WEIGHT = 0.3;

  const coreSelected = CORE_BUCKETS.filter((b) => selected.has(b));
  const tailSelected = TAIL_BUCKETS.filter((b) => selected.has(b));
  const worstTail = tailSelected.length > 0 ? Math.min(...tailSelected.map((b) => bucketPnl[b])) : 0;

  let worstSelected: number;
  if (coreSelected.length > 0) {
    const worstCore = Math.min(...coreSelected.map((b) => bucketPnl[b]));
    // Only a NEGATIVE tail counts against the score — a tail that happens
    // to be fine too isn't a reason to rank a candidate any higher than
    // its core performance already earned.
    worstSelected = worstCore + TAIL_PENALTY_WEIGHT * Math.min(0, worstTail);
  } else {
    // Nothing in the core was selected at all (e.g. only "strongUp", or
    // "strongDown"+"strongUp" together) — the tail buckets ARE the whole
    // ask here, so they're the full, un-discounted criterion, not a
    // secondary penalty on top of a core that doesn't exist.
    worstSelected = worstTail;
  }

  const denom = Math.max(5, Math.abs(maxLoss));
  const returnOnRisk = worstSelected / denom;

  return { maxProfit, maxLoss, pop, returnOnRisk, bucketPnl };
}

function evaluateTier(
  preset: PresetMeta,
  spot: number,
  iv: number,
  days: number,
  bounds: BucketBounds,
  selectedBuckets: Bucket[],
  sigma: number,
  tier: Tier,
): TierResult {
  const rawLegs = preset.legs();
  const optimized = optimizeStrikes(rawLegs, spot, bounds, selectedBuckets, sigma, tier);
  const anchored = anchorDte(optimized, days);
  const priced = priceLegsTheoretical(anchored, spot, iv);
  const metrics = computeTierMetrics(priced, spot, sigma, bounds, selectedBuckets);
  return { legs: priced, ...metrics };
}

// ── fixed scenario → strategy table ──
// Earlier rounds tried scoring across all 39 presets to auto-discover the
// best fit; the DEBIT/CREDIT anchor bug and then the additive-vs-maximin
// scoring bug both came from that approach silently producing wrong or
// unintuitive answers for combinations a domain expert could just look at
// and know the answer to directly. Xue reviewed every one of the 30
// possible bucket combinations (5 singles + 10 pairs + 10 triples + 5
// quadruples — "5 selected" was already impossible, capped at 4) by hand
// and specified exactly which preset(s) fit, or whether the combination is
// internally contradictory and should be blocked outright (e.g. wanting
// BOTH extreme tails to pay off AND flat to pay off at the same time —
// no straddle/strangle-family structure can do both, since they're built
// to lose specifically when price stays near center). This table is that
// answer key. The scoring engine above (evaluateTier, optimizeStrikes,
// computeTieredStrike, the bucket-boundary math) is still exactly what
// computes the real numbers — strikes, premiums, max profit/loss, PoP —
// for whichever preset(s) this table names; only the "which preset(s)"
// decision moved from an algorithm to Xue's direct specification.
type ScenarioRule = { presets: string[] } | { blocked: true };

function bucketKey(buckets: Bucket[]): string {
  return [...buckets].sort().join("+");
}

const SCENARIO_RULES: Record<string, ScenarioRule> = {
  // singles
  [bucketKey(["strongUp"])]: { presets: ["裸买 Call"] },
  [bucketKey(["strongDown"])]: { presets: ["裸买 Put"] },
  [bucketKey(["mildUp"])]: { presets: ["牛市 Put 价差"] },
  [bucketKey(["mildDown"])]: { presets: ["熊市 Call 价差", "裸卖 Put"] },
  [bucketKey(["flat"])]: { presets: ["卖出跨式", "卖出宽跨式"] },

  // pairs
  [bucketKey(["strongDown", "mildDown"])]: { presets: ["裸买 Put", "熊市 Call 价差"] },
  [bucketKey(["strongDown", "flat"])]: { blocked: true },
  [bucketKey(["strongDown", "mildUp"])]: { presets: ["熊市 Call 价差"] },
  [bucketKey(["strongDown", "strongUp"])]: { presets: ["买入跨式"] },
  [bucketKey(["mildDown", "flat"])]: { presets: ["熊市 Call 价差", "裸卖 Put"] },
  [bucketKey(["mildDown", "mildUp"])]: { presets: ["买入宽跨式"] },
  [bucketKey(["mildDown", "strongUp"])]: { presets: ["裸卖 Put"] },
  [bucketKey(["flat", "mildUp"])]: { presets: ["牛市 Put 价差", "裸卖 Put"] },
  [bucketKey(["flat", "strongUp"])]: { blocked: true },
  [bucketKey(["mildUp", "strongUp"])]: { presets: ["裸买 Call", "牛市 Call 价差"] },

  // triples
  [bucketKey(["strongDown", "mildDown", "flat"])]: { presets: ["熊市 Call 价差"] },
  [bucketKey(["strongDown", "mildDown", "mildUp"])]: { presets: ["裸卖 Call", "熊市 Call 价差"] },
  [bucketKey(["strongDown", "strongUp", "flat"])]: { blocked: true },
  [bucketKey(["strongDown", "strongUp", "mildDown"])]: { presets: ["买入跨式", "买入宽跨式"] },
  [bucketKey(["strongDown", "strongUp", "mildUp"])]: { presets: ["买入跨式", "买入宽跨式"] },
  [bucketKey(["strongDown", "flat", "mildUp"])]: { presets: ["裸卖 Call", "熊市 Call 价差"] },
  [bucketKey(["mildDown", "flat", "mildUp"])]: { presets: ["卖出宽跨式"] },
  [bucketKey(["strongUp", "mildDown", "mildUp"])]: { presets: ["裸卖 Put", "牛市 Put 价差"] },
  [bucketKey(["strongUp", "mildUp", "flat"])]: { presets: ["裸卖 Put", "牛市 Put 价差"] },
  [bucketKey(["strongUp", "mildDown", "flat"])]: { presets: ["裸卖 Put", "牛市 Put 价差"] },

  // quadruples (excludes exactly one bucket)
  [bucketKey(["mildDown", "flat", "mildUp", "strongUp"])]: { presets: ["裸卖 Put", "牛市 Put 价差"] }, // excludes strongDown
  [bucketKey(["strongDown", "mildDown", "flat", "mildUp"])]: { presets: ["裸卖 Call", "熊市 Call 价差"] }, // excludes strongUp
  [bucketKey(["strongDown", "mildDown", "mildUp", "strongUp"])]: { presets: ["买入跨式", "买入宽跨式"] }, // excludes flat
  [bucketKey(["strongDown", "flat", "mildUp", "strongUp"])]: { blocked: true }, // excludes mildDown
  [bucketKey(["strongDown", "mildDown", "flat", "strongUp"])]: { blocked: true }, // excludes mildUp
};

// A "pure buy" structure (every option leg is bought, nothing sold) has
// the classic long-option problem: time decay works against it every day,
// so if the actual move takes even a little longer than expected, an
// option that expires exactly on the person's stated time window can
// finish worthless despite the view eventually being right. Extending the
// expiry gives the trade room to be early. This does NOT apply to spread
// structures (even ones with a bought leg) — a spread's width and cost
// are defined by BOTH legs sharing one expiry; stretching only the date
// without redesigning the whole structure would break what the spread
// actually is, not just make it safer.
const BUY_DTE_EXTENSION: Record<string, number> = {
  "1w": 30,   // 1 week  → 1 month
  "1m": 75,   // 1 month → ~2.5 months
  "3m": 182,  // 3 months → 6 months
  "6m": 365,  // 6 months → 1 year
  "1y": 547,  // 1 year → 1.5 years
};

function isPureBuyStructure(rawLegs: Leg[]): boolean {
  const optionLegs = rawLegs.filter((l) => l.kind !== "stock");
  return optionLegs.length > 0 && optionLegs.every((l) => l.action === "buy");
}

export function isScenarioBlocked(selectedBuckets: Bucket[]): boolean {
  const rule = SCENARIO_RULES[bucketKey(selectedBuckets)];
  return !!rule && "blocked" in rule;
}

export function rankPresetsForScenario(params: {
  spot: number;
  iv: number;
  days: number;
  windowId: string;
  selectedBuckets: Bucket[];
}): ScenarioRecommendation[] {
  const { spot, iv, days, windowId, selectedBuckets } = params;
  const bounds = computeBucketBounds(spot, iv, days);
  const sigma = spot * Math.max(0, iv) * Math.sqrt(Math.max(1, days) / 365);

  const rule = SCENARIO_RULES[bucketKey(selectedBuckets)];
  if (!rule || "blocked" in rule) return [];

  const presetByName = new Map<string, PresetMeta>();
  for (const group of PRESET_GROUPS) {
    for (const preset of group.items) presetByName.set(preset.name.zh, preset);
  }

  const recommendations: ScenarioRecommendation[] = [];
  for (const name of rule.presets) {
    const preset = presetByName.get(name);
    if (!preset) continue; // table references a preset name that doesn't exist in presets.ts — skip rather than crash, but this indicates a typo in SCENARIO_RULES worth fixing
    const extendedDays = isPureBuyStructure(preset.legs())
      ? (BUY_DTE_EXTENSION[windowId] ?? days)
      : days;
    // Group label isn't tracked by name → group map above; find it once here.
    const group = PRESET_GROUPS.find((g) => g.items.includes(preset));
    recommendations.push({
      preset,
      groupLabel: group?.group ?? { zh: "", en: "" },
      variants: {
        aggressive: evaluateTier(preset, spot, iv, extendedDays, bounds, selectedBuckets, sigma, "aggressive"),
        neutral: evaluateTier(preset, spot, iv, extendedDays, bounds, selectedBuckets, sigma, "neutral"),
        conservative: evaluateTier(preset, spot, iv, extendedDays, bounds, selectedBuckets, sigma, "conservative"),
      },
    });
  }
  return recommendations;
}