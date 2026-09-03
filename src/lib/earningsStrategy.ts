// src/lib/earningsStrategy.ts
import type { Leg, OptionType } from "./types";
import { getOptionChain, nearestStrikeQuote, premiumFromQuote } from "./optionChain";
import { dteFromDate } from "./dateUtils";
import { computeComboMargin, type MarginNote } from "./margin";

// ── The three groups, per the design doc worked out in chat ──
// Each group is a short iron butterfly (sell ATM call + sell ATM put,
// buy a protective call/put further out on each side) — same shape,
// different protection width, expiry, and size. Mid/far are 2x the near
// group's size because they carry the trade's main earnings-IV-crush
// thesis over a longer window; near is 1x because it's built to be
// unwound within hours of the print, not held for its own sake.
export type EarningsGroup = "near" | "mid" | "far";

export interface EarningsGroupSpec {
  group: EarningsGroup;
  label: string;
  protectionPct: number; // e.g. 0.10 = strikes roughly ±10% from spot
  unitMultiplier: number; // relative to the near group's 1 base unit
  targetDte: number; // rough anchor for picking a real expiry — see below
}

// targetDte is only a STARTING anchor for picking the closest real expiry
// out of whatever this symbol's chain actually lists (see
// pickGroupExpiries below) — it is not itself used as the final DTE, and
// deliberately doesn't try to identify "the standard 3rd-Friday monthly"
// specifically. A real chain's actual listed dates are used verbatim;
// this is a known simplification flagged in chat, not an oversight.
export const EARNINGS_GROUPS: EarningsGroupSpec[] = [
  { group: "near", label: "近期组", protectionPct: 0.10, unitMultiplier: 1, targetDte: 4 },
  { group: "mid", label: "中期组", protectionPct: 0.15, unitMultiplier: 2, targetDte: 30 },
  { group: "far", label: "远期组", protectionPct: 0.20, unitMultiplier: 2, targetDte: 60 },
];

// ── Step 1: pick one real expiry per group from the symbol's own chain ──
// One chain fetch (at a rough far-out dte, so the returned
// expirationDates list covers near/mid/far all at once) rather than three
// separate fetches guessing independently — this also guarantees near/
// mid/far can never accidentally collide on the same expiry, since
// they're each the closest-to-target pick from one shared list, and two
// targets 4/30/60 days apart essentially never resolve to the same real
// date.
export interface GroupExpiry {
  group: EarningsGroup;
  expiryDate: string; // ISO yyyy-mm-dd
  dte: number;
}

export async function pickGroupExpiries(symbol: string): Promise<GroupExpiry[]> {
  const farAnchorDte = Math.max(...EARNINGS_GROUPS.map((g) => g.targetDte)) + 15; // pad past the far target so its own chain fetch's own snap doesn't accidentally clip the list short
  const chain = await getOptionChain(symbol, farAnchorDte);
  if (chain.expirationDates.length === 0) {
    throw new Error("这只股票没有可用的到期日数据");
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return EARNINGS_GROUPS.map((spec) => {
    let best = chain.expirationDates[0];
    let bestDiff = Infinity;
    for (const epochSec of chain.expirationDates) {
      const diff = Math.abs(epochSec * 1000 - (today.getTime() + spec.targetDte * 86400000));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = epochSec;
      }
    }
    const expiryDate = new Date(best * 1000).toISOString().slice(0, 10);
    return { group: spec.group, expiryDate, dte: dteFromDate(expiryDate) };
  });
}

// ── Step 2: build one group's 4 legs at a GIVEN unit count, using real
// quotes from that group's own expiry chain ──
export interface EarningsGroupLegs {
  group: EarningsGroup;
  legs: Leg[]; // 4 legs: sell call, sell put, buy call (protection), buy put (protection)
  netCreditPerUnit: number; // dollars per 1 contract (not yet × units × 100)
  maxLossPerUnit: number; // dollars per 1 contract, the WORSE of the two protected sides
}

let legIdCounter = 0;
function newLegId(): string {
  legIdCounter += 1;
  return `earn-${Date.now()}-${legIdCounter}`;
}

export async function buildGroupLegs(
  symbol: string,
  spot: number,
  spec: EarningsGroupSpec,
  expiryDate: string,
  units: number,
): Promise<EarningsGroupLegs> {
  const dte = dteFromDate(expiryDate);
  const chain = await getOptionChain(symbol, dte);

  const atmTarget = spot;
  const callProtectionTarget = spot * (1 + spec.protectionPct);
  const putProtectionTarget = spot * (1 - spec.protectionPct);

  const atmCallQ = nearestStrikeQuote(chain.calls, atmTarget);
  const atmPutQ = nearestStrikeQuote(chain.puts, atmTarget);
  const protCallQ = nearestStrikeQuote(chain.calls, callProtectionTarget);
  const protPutQ = nearestStrikeQuote(chain.puts, putProtectionTarget);
  if (!atmCallQ || !atmPutQ || !protCallQ || !protPutQ) {
    throw new Error(`${symbol} 在这个到期日（${expiryDate}）上的期权链数据不完整`);
  }

  const mk = (action: "buy" | "sell", type: OptionType, q: typeof atmCallQ): Leg => ({
    id: newLegId(),
    action,
    type,
    strike: q.strike,
    dte,
    premium: premiumFromQuote(q),
    qty: units,
  });

  const legs: Leg[] = [
    mk("sell", "call", atmCallQ),
    mk("sell", "put", atmPutQ),
    mk("buy", "call", protCallQ),
    mk("buy", "put", protPutQ),
  ];

  // Per-1-contract economics (units factored back out) — used for sizing
  // math, which needs a per-unit number BEFORE units is finalized. Real
  // strikes rarely land at EXACTLY ±protectionPct%, so the call-side and
  // put-side wing widths (and therefore max losses) are only approximately
  // symmetric — computing both and taking the worse one is the correct,
  // not-approximate way to state a defined-risk combo's true max loss.
  const sellCallPremium = premiumFromQuote(atmCallQ);
  const sellPutPremium = premiumFromQuote(atmPutQ);
  const buyCallPremium = premiumFromQuote(protCallQ);
  const buyPutPremium = premiumFromQuote(protPutQ);
  const netCreditPerUnit = sellCallPremium + sellPutPremium - buyCallPremium - buyPutPremium;

  const callSideWidth = protCallQ.strike - atmCallQ.strike;
  const putSideWidth = atmPutQ.strike - protPutQ.strike;
  const maxLossCallSide = Math.max(0, callSideWidth * 100 - netCreditPerUnit * 100);
  const maxLossPutSide = Math.max(0, putSideWidth * 100 - netCreditPerUnit * 100);
  const maxLossPerUnit = Math.max(maxLossCallSide, maxLossPutSide);

  return { group: spec.group, legs, netCreditPerUnit, maxLossPerUnit };
}

// ── Step 3: size the near group's "1 unit" off the account's risk budget ──
// The near group anchors sizing (mid/far simply ride at 2x whatever the
// near group comes out to) because it's the group whose max-loss-per-unit
// is cheapest to discover — it needs only ONE real-quote fetch before any
// sizing decision can be made, whereas sizing off mid or far would need
// their own fetches to happen first for no real benefit (the RATIO between
// groups is fixed by design, not something sizing needs to re-derive).
export interface PositionSizingResult {
  units: number; // the near group's unit count; mid/far = units × their own unitMultiplier
  riskBudget: number; // availableCapital × riskPct
  maxLossPerUnitNear: number;
  affordable: boolean; // false if even 1 unit exceeds the risk budget
}

export function computeUnitsFromRiskBudget(
  availableCapital: number,
  riskPct: number,
  maxLossPerUnitNear: number,
): PositionSizingResult {
  const riskBudget = availableCapital * riskPct;
  if (maxLossPerUnitNear <= 0) {
    return { units: 0, riskBudget, maxLossPerUnitNear, affordable: false };
  }
  const units = Math.floor(riskBudget / maxLossPerUnitNear);
  return { units, riskBudget, maxLossPerUnitNear, affordable: units >= 1 };
}

// ── Step 4: aggregate preview across all 3 groups, before opening ──
// Reuses margin.ts's existing computeComboMargin per group (each group is
// its own iron-butterfly-shaped combo — the same shape margin.ts already
// knows how to margin as a credit spread pair) rather than inventing a
// second, parallel margin calculation just for this strategy.
export interface EarningsPreview {
  groups: EarningsGroupLegs[];
  totalMaxLoss: number;
  totalMargin: number;
  totalNetCredit: number;
  marginNotes: { group: EarningsGroup; notes: MarginNote[] }[];
}

export function computeEarningsPreview(groupLegs: EarningsGroupLegs[], spot: number): EarningsPreview {
  let totalMaxLoss = 0;
  let totalMargin = 0;
  let totalNetCredit = 0;
  const marginNotes: { group: EarningsGroup; notes: MarginNote[] }[] = [];

  for (const g of groupLegs) {
    const units = g.legs[0]?.qty ?? 1;
    totalMaxLoss += g.maxLossPerUnit * units;
    totalNetCredit += g.netCreditPerUnit * units * 100;
    const margin = computeComboMargin(g.legs, spot);
    totalMargin += margin.total;
    marginNotes.push({ group: g.group, notes: margin.notes });
  }

  return { groups: groupLegs, totalMaxLoss, totalMargin, totalNetCredit, marginNotes };
}