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

export function matchStrategy(
  activeLegs: Leg[],
  _spot: number,
  customPresets: CustomPreset[]
): string {
  if (activeLegs.length === 0) return "";

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