// src/lib/kbStrategyMeta.ts
//
// Static metadata about position-management-kb's 48 strategy names — used
// by kbQuery.ts to build the "持仓处置建议" retrieval query (see
// claude/retrieval-feature-design.md). Extracted directly from the actual
// KB data (all 1170 records, 2026-09-10): `direction` and `leg_count` turn
// out to be FIXED per strategy name across the whole KB (verified — zero
// strategies have more than one direction or leg_count value), NOT a live
// per-position calculation. E.g. every "Covered Call" record is tagged
// direction="neutral" regardless of that particular position's actual
// delta — it's a categorical label tied to the strategy itself. So when
// the live position's matched strategy name is one of these 48, we use
// THIS table's leg_count/direction (not values computed from the live
// legs) to build the query — that's what actually matches what's in the
// database.
//
// matchStrategy() (src/lib/matchStrategy.ts) returns names from
// presets.ts's PRESET_GROUPS, which only has 43 of these 48 — see
// STRATEGY_NAME_ALIAS below for the one naming mismatch, and
// toKbStrategyMeta()'s null return for the 7 KB strategies with no
// preset-matcher equivalent (PMCC, LEAPS Call/Put, Naked Call, Synthetic
// Long/Short Stock, Ratio Spread) — those fall back to a live-computed
// leg_count/direction query instead (see kbQuery.ts).

export interface KbStrategyMeta {
  legCount: number;
  direction: "bullish" | "bearish" | "neutral";
}

// ⚠️ matchStrategy() (src/lib/matchStrategy.ts) returns `item.name.zh` —
// the CHINESE display string (e.g. "裸卖 Put"), always, regardless of the
// app's current UI language — see that file's own return statements
// (`return item.name.zh` in the main preset loop, and the Chinese string
// literals `checkIronButterflyFamily` returns directly). It does NOT
// return presets.ts's `name.en`. First real-world test of this feature
// (2026-09-10, xue) surfaced this: a plain 裸卖Put position got matched
// against the KB with no strategy filter at all (silently degraded to the
// leg_count+direction-only tier), because `toKbStrategyMeta("裸卖 Put")`
// found nothing in a table keyed by English names — mixing in unrelated
// strategies (LEAPS Call, Long Call) that happen to share the same
// (leg_count=1, direction=bullish) signature as a short put but have
// completely different management logic. Fix: translate matchStrategy()'s
// Chinese output back to the KB's English `strategy` values FIRST, via
// this table (extracted from presets.ts's `name: { zh, en }` for all 42
// built-in presets — matchStrategy() can only ever return one of these 42
// zh strings, or a raw custom-preset name for a CustomPreset match, which
// won't appear here and correctly falls through to the no-strategy
// fallback below).
const ZH_TO_EN_STRATEGY_NAME: Record<string, string> = {
  "裸买 Call": "Long Call",
  "裸卖 Call": "Short Call",
  "裸买 Put": "Long Put",
  "裸卖 Put": "Short Put",
  "牛市 Call 价差": "Bull Call Spread",
  "熊市 Call 价差": "Bear Call Spread",
  "牛市 Put 价差": "Bull Put Spread",
  "熊市 Put 价差": "Bear Put Spread",
  "买入跨式": "Long Straddle",
  "卖出跨式": "Short Straddle",
  "买入宽跨式": "Long Strangle",
  "卖出宽跨式": "Short Strangle",
  "铁蝶策略": "Iron Butterfly",
  "不对称铁蝶": "Asymmetric Iron Butterfly",
  "买入铁蝶": "Long Iron Butterfly",
  "铁鹰策略": "Iron Condor",
  "反向铁鹰": "Reverse Iron Condor",
  "买入蝶式": "Long Butterfly",
  "日历价差": "Calendar Spread",
  "对角价差": "Diagonal Spread",
  "比率 Call 价差": "Call Ratio Spread",
  "比率 Put 价差": "Put Ratio Spread",
  "反向比率 Call 价差": "Call Backspread",
  "反向比率 Put 价差": "Put Backspread",
  "圣诞树 Call": "Christmas Tree Call",
  "圣诞树 Put": "Christmas Tree Put",
  "领口策略": "Collar",
  "备兑 call": "Covered Call",
  "保护性 Put": "Protective Put",
  "备兑 Put": "Covered Put",
  "保护性 Call": "Protective Call",
  "海鸥策略": "Seagull",
  "反向海鸥": "Reverse Seagull",
  "窄体铁鹰": "Narrow-Body Iron Condor",
  "玉蜥蜴": "Jade Lizard",
  "破翅蝶式": "Broken Wing Butterfly (Call)",
  "反向蝶式": "Short Butterfly",
  "Call 鹰式": "Call Condor",
  "Put 蝶式": "Put Butterfly",
  "双对角价差": "Double Diagonal",
  "反向日历价差": "Reverse Calendar Spread",
  "Put 鹰式": "Put Condor",
};

// English preset name -> KB's `strategy` column value, only where they
// differ. presets.ts's "Narrow-Body Iron Condor" is KB's
// "Narrow Iron Condor" — same structure, just named slightly differently
// in the two places they were each written.
const STRATEGY_NAME_ALIAS: Record<string, string> = {
  "Narrow-Body Iron Condor": "Narrow Iron Condor",
};

const KB_STRATEGY_META: Record<string, KbStrategyMeta> = {
  "Asymmetric Iron Butterfly": { legCount: 4, direction: "neutral" },
  "Bear Call Spread": { legCount: 2, direction: "bearish" },
  "Bear Put Spread": { legCount: 2, direction: "bearish" },
  "Broken Wing Butterfly (Call)": { legCount: 3, direction: "bullish" },
  "Bull Call Spread": { legCount: 2, direction: "bullish" },
  "Bull Put Spread": { legCount: 2, direction: "bullish" },
  "Calendar Spread": { legCount: 2, direction: "neutral" },
  "Call Backspread": { legCount: 2, direction: "bullish" },
  "Call Condor": { legCount: 4, direction: "neutral" },
  "Call Ratio Spread": { legCount: 2, direction: "bullish" },
  "Christmas Tree Call": { legCount: 3, direction: "bullish" },
  "Christmas Tree Put": { legCount: 3, direction: "bearish" },
  "Collar": { legCount: 3, direction: "bullish" },
  "Covered Call": { legCount: 2, direction: "neutral" },
  "Covered Put": { legCount: 2, direction: "bearish" },
  "Diagonal Spread": { legCount: 2, direction: "bullish" },
  "Double Diagonal": { legCount: 4, direction: "neutral" },
  "Iron Butterfly": { legCount: 4, direction: "neutral" },
  "Iron Condor": { legCount: 4, direction: "neutral" },
  "Jade Lizard": { legCount: 3, direction: "bullish" },
  "LEAPS Call": { legCount: 1, direction: "bullish" },
  "LEAPS Put": { legCount: 1, direction: "bearish" },
  "Long Butterfly": { legCount: 3, direction: "bullish" },
  "Long Call": { legCount: 1, direction: "bullish" },
  "Long Iron Butterfly": { legCount: 4, direction: "neutral" },
  "Long Put": { legCount: 1, direction: "bearish" },
  "Long Straddle": { legCount: 2, direction: "neutral" },
  "Long Strangle": { legCount: 2, direction: "neutral" },
  "Naked Call": { legCount: 1, direction: "bearish" },
  "Narrow Iron Condor": { legCount: 4, direction: "neutral" },
  "PMCC": { legCount: 2, direction: "bullish" },
  "Protective Call": { legCount: 2, direction: "bearish" },
  "Protective Put": { legCount: 2, direction: "bullish" },
  "Put Backspread": { legCount: 2, direction: "bearish" },
  "Put Butterfly": { legCount: 3, direction: "neutral" },
  "Put Condor": { legCount: 4, direction: "neutral" },
  "Put Ratio Spread": { legCount: 2, direction: "bearish" },
  "Ratio Spread": { legCount: 2, direction: "neutral" },
  "Reverse Calendar Spread": { legCount: 2, direction: "neutral" },
  "Reverse Iron Condor": { legCount: 4, direction: "neutral" },
  "Reverse Seagull": { legCount: 3, direction: "bearish" },
  "Seagull": { legCount: 3, direction: "bullish" },
  "Short Butterfly": { legCount: 3, direction: "neutral" },
  "Short Put": { legCount: 1, direction: "bullish" },
  "Short Straddle": { legCount: 2, direction: "neutral" },
  "Short Strangle": { legCount: 2, direction: "neutral" },
  "Synthetic Long Stock": { legCount: 2, direction: "bullish" },
  "Synthetic Short Stock": { legCount: 2, direction: "bearish" },
};

// Returns the KB's canonical strategy name + its fixed leg_count/direction
// for a name coming out of matchStrategy() (or compare mode's equivalent
// strategy-match path). Returns null when matchStrategy() itself returned
// null/undefined, OR when the matched name isn't one of the KB's 48
// strategies (the 7 unmapped ones) — either way, the caller should fall
// back to a live-computed leg_count/direction query with no strategy
// filter (see kbQuery.ts's fetchPositionAdvice).
export function toKbStrategyMeta(
  matchedName: string | null | undefined,
): { kbStrategyName: string; meta: KbStrategyMeta } | null {
  if (!matchedName) return null;
  const enName = ZH_TO_EN_STRATEGY_NAME[matchedName] ?? matchedName;
  const kbStrategyName = STRATEGY_NAME_ALIAS[enName] ?? enName;
  const meta = KB_STRATEGY_META[kbStrategyName];
  return meta ? { kbStrategyName, meta } : null;
}