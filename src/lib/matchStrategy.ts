// src/lib/matchStrategy.ts
import type { Leg } from "@/lib/types";
import { PRESET_GROUPS } from "@/lib/presets";
import type { CustomPreset } from "@/lib/customPresets";

type Pattern = string;

function patternOf(legs: Leg[]): Pattern {
  const opts = legs.filter((l) => l.kind !== "stock");
  const stockLegs = legs.filter((l) => l.kind === "stock");

  const hasStock = stockLegs.length > 0;
  const stockAction = stockLegs.length > 0 ? stockLegs[0].action : "";

  // Rank alone (0th, 1st, 2nd smallest strike...) throws away the actual
  // SPACING between strikes — a symmetric butterfly (equal gaps either
  // side of the body) and a "broken wing" butterfly (deliberately
  // unequal gaps) both reduce to the same rank sequence (buy-sell-sell-
  // buy at ranks 0,1,1,2), even though they're genuinely different
  // structures with different risk profiles. Same problem for Iron
  // Condor vs Jade Lizard (Broken Wing Iron Condor) — both are buy-put/
  // sell-put/sell-call/buy-call at ranks 0,1,2,3 regardless of whether
  // the put spread and call spread are the same width or not. Using each
  // strike's PROPORTIONAL position within the full range (0 = lowest
  // strike, 1 = highest, everything else scaled between) instead of a
  // plain rank preserves that shape information — a symmetric structure
  // and an asymmetric one now land on different proportions and stop
  // colliding. Rounded to 3 decimals so real-world strikes that are
  // close-but-not-exactly proportional to a preset's illustrative ones
  // still match (the whole point of matching is fuzziness on absolute
  // price, not exact-cent shape matching).
  const uniqueStrikes = [...new Set(opts.map((l) => l.strike))].sort((a, b) => a - b);
  const strikeMin = uniqueStrikes[0];
  const strikeMax = uniqueStrikes[uniqueStrikes.length - 1];
  const strikeRange = strikeMax - strikeMin;
  const bucket = (strike: number) =>
    strikeRange > 0 ? Math.round(((strike - strikeMin) / strikeRange) * 1000) / 1000 : 0;

  // Same idea as the strike bucket above, but for expiry — WITHOUT this,
  // a Bull Call Spread (buy lower strike + sell higher strike, same dte)
  // and a Diagonal Spread (buy lower strike + sell higher strike,
  // DIFFERENT dte) produce the identical pattern, since only relative
  // strike order and buy/sell were compared. Whichever one happens to sit
  // earlier in PRESET_GROUPS then wins the match regardless of which one
  // the person actually built — caught by a real diagonal spread getting
  // labeled "Bull Call Spread" in the UI. Bucketing dte the same way
  // strikes are bucketed (by relative order, not exact day count) lets
  // two legs sharing one expiry stay pattern-equal while two legs on
  // different expiries don't, without needing an exact-day match (a
  // preset's illustrative 14/45-day calendar should still match a real
  // 13/48-day one).
  const uniqueDtes = [...new Set(opts.map((l) => l.dte))].sort((a, b) => a - b);
  const dteBucket = (dte: number) => uniqueDtes.indexOf(dte);

  const sorted = [...opts].sort((a, b) => {
    if (a.strike !== b.strike) return a.strike - b.strike;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return a.action < b.action ? -1 : 1;
  });

  const optPattern = sorted
    .map((l) => `${l.action[0]}${l.type[0]}${bucket(l.strike)}d${dteBucket(l.dte)}`)
    .join(",");

  return hasStock ? `S${stockAction[0]}|${optPattern}` : optPattern;
}

// Iron-butterfly-family shapes (2 sold legs of different type at the SAME
// strike — a true ATM straddle sold — plus 2 bought legs protecting each
// side) can't be told apart by proportional pattern-matching against a
// single fixed example the way other shapes can: real market strikes
// produce essentially arbitrary wing-width RATIOS, and pattern-matching
// only recognizes whichever exact ratio a specific preset happens to
// illustrate. Iron Butterfly (equal wings) vs Asymmetric Iron Butterfly
// (uneven wings) is fundamentally a STRUCTURAL question — are the two
// widths equal or not — not a specific-shape lookup, so it's checked
// directly here instead of relying on the generic pattern loop below to
// happen to find a matching ratio (caught when real earnings-strategy
// positions, whose wing widths come out essentially random once mapped
// onto actual listed strikes, matched nothing at all — a hand-picked
// example preset for "asymmetric" could only ever match ITS OWN specific
// ratio, never the general category).
function checkIronButterflyFamily(legs: Leg[]): string | null {
  const opts = legs.filter((l) => l.kind !== "stock");
  if (opts.length !== 4) return null;
  const sells = opts.filter((l) => l.action === "sell");
  const buys = opts.filter((l) => l.action === "buy");
  if (sells.length !== 2 || buys.length !== 2) return null;

  const sellCall = sells.find((l) => l.type === "call");
  const sellPut = sells.find((l) => l.type === "put");
  const buyCall = buys.find((l) => l.type === "call");
  const buyPut = buys.find((l) => l.type === "put");
  if (!sellCall || !sellPut || !buyCall || !buyPut) return null;
  if (sellCall.strike !== sellPut.strike) return null; // not a true ATM straddle sold — e.g. 玉蜥蜴's sold legs sit at two different strikes
  if (buyCall.strike <= sellCall.strike || buyPut.strike >= sellPut.strike) return null; // wings must actually protect outward on their own side
  // All 4 legs must share ONE expiry — this shape concept is inherently
  // single-expiry. A double diagonal spread (near-month sold, far-month
  // bought, on both call and put sides) happens to match the same strike
  // criteria above while being a completely different, multi-expiry
  // strategy — caught by the regression check for every preset re-
  // identifying itself: 双对角价差 started matching "不对称铁蝶" the moment
  // this function stopped looking at dte at all.
  if (sellCall.dte !== sellPut.dte || sellCall.dte !== buyCall.dte || sellCall.dte !== buyPut.dte) return null;

  const upWidth = buyCall.strike - sellCall.strike;
  const downWidth = sellPut.strike - buyPut.strike;
  const symmetric = Math.abs(upWidth - downWidth) < 0.01; // tight — this is asking "genuinely equal," not "roughly similar"
  return symmetric ? "铁蝶策略" : "不对称铁蝶";
}

export function matchStrategy(
  activeLegs: Leg[],
  _spot: number,
  customPresets: CustomPreset[]
): string {
  if (activeLegs.length === 0) return "";

  const ironButterflyMatch = checkIronButterflyFamily(activeLegs);
  if (ironButterflyMatch) return ironButterflyMatch;

  const actualPattern = patternOf(activeLegs);

  for (const group of PRESET_GROUPS) {
    for (const item of group.items) {
      if (patternOf(item.legs()) === actualPattern) {
        return item.name.zh;
      }
    }
  }

  for (const custom of customPresets) {
    if (patternOf(custom.legs) === actualPattern) {
      return custom.name;
    }
  }

  return "";
}