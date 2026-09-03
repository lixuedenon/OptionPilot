// src/lib/margin.ts
import type { Leg, OptionType } from "./types";

// Margin is only relevant to SHORT (sold) exposure — a long option or long
// stock leg's max loss is already the premium/cost paid, which is already
// reflected in cash via computeCostBasis (see simAccount.ts). This module
// only ever produces a non-zero number for legs/combos that involve selling.
//
// The formulas below are the standard FINRA/Reg T MINIMUM margin rules,
// which is what "通用券商保证金机制" (a generic, broker-agnostic baseline)
// means in practice — actual brokers are free to require more, never less.
// Two deliberate choices worth flagging up front:
//
//   1. Short puts default to CASH-SECURED (full strike × 100), not the
//      lower Reg-T "naked" formula. Reg-T naked margin requires a higher
//      options approval tier most retail/beginner accounts don't have;
//      cash-secured is what a level-2 beginner account actually uses in
//      practice, and this app is explicitly aimed at "更初级的用户" — so
//      cash-secured is the more honest default for a simulated account
//      meant to teach realistic capital requirements. If this should
//      instead be the reduced Reg-T naked-put formula, that's a one-line
//      change (see NAKED_PUT_MODE below) — flagging for confirmation
//      rather than assuming.
//   2. Only same-expiry, same-type vertical spreads are recognized as
//      "defined risk" and get spread margin. Calendars/diagonals (short
//      leg covered by a long leg of a LATER expiry) are treated as naked
//      on the short leg — most brokers don't give full spread-margin
//      credit for those either, so this errs conservative rather than
//      silently under-margining a diagonal.

const NAKED_PUT_MODE: "cash-secured" | "reg-t-naked" = "cash-secured";

export interface MarginNote {
  legIds: string[];
  kind: "spread" | "iron-condor" | "cash-secured-put" | "naked-call" | "covered-call" | "covered";
  amount: number;
  label: string;
}

export interface MarginResult {
  total: number;
  notes: MarginNote[];
}

interface OptLeg {
  id: string;
  action: "buy" | "sell";
  type: OptionType;
  strike: number;
  dte: number;
  premium: number;
  qty: number;
}

function toOptLeg(l: Leg): OptLeg {
  return {
    id: l.id,
    action: l.action,
    type: l.type,
    strike: l.strike,
    dte: l.dte,
    premium: l.premium,
    qty: l.qty ?? 1,
  };
}

// Reg-T uncovered (naked) equity option formula:
//   max(20% × spot − OTM amount + premium, 10% × base + premium) × 100 × qty
// where base is the strike for puts, spot for calls, and OTM amount is
// clamped at 0 (can't go negative / reduce the requirement below the floor).
function nakedMargin(leg: OptLeg, spot: number): number {
  const otm = leg.type === "call"
    ? Math.max(0, leg.strike - spot)
    : Math.max(0, spot - leg.strike);
  const base = leg.type === "put" ? leg.strike : spot;
  const a = 0.2 * spot - otm + leg.premium;
  const b = 0.1 * base + leg.premium;
  return Math.max(a, b, 0) * 100 * leg.qty;
}

function cashSecuredPutMargin(leg: OptLeg): number {
  return leg.strike * 100 * leg.qty;
}

// Greedy 1:1 pairing of short legs with long legs of the SAME type and
// SAME dte (same expiry) into vertical spreads, closest-strike-first. Any
// short left unpaired after that falls through to the naked formula; any
// long left unpaired costs nothing extra (already paid for via premium).
function pairVerticals(shorts: OptLeg[], longs: OptLeg[]): {
  spreads: { short: OptLeg; long: OptLeg }[];
  unpaired: OptLeg[];
} {
  const remainingLongs = [...longs];
  const spreads: { short: OptLeg; long: OptLeg }[] = [];
  const unpaired: OptLeg[] = [];

  for (const short of shorts) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < remainingLongs.length; i++) {
      const long = remainingLongs[i];
      if (long.dte !== short.dte) continue; // different expiry = not a simple vertical, see header note
      const dist = Math.abs(long.strike - short.strike);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      spreads.push({ short, long: remainingLongs[bestIdx] });
      remainingLongs.splice(bestIdx, 1);
    } else {
      unpaired.push(short);
    }
  }

  return { spreads, unpaired };
}

// Real brokers (portfolio/risk-based margin — TIMS-style, what a platform
// like thinkorswim actually charges) don't reserve the full worst-case
// loss the instant a defined-risk spread opens. They reserve a small
// floor while price sits safely at the short strike, and scale UP toward
// the full max loss only as price actually moves toward the long strike
// (the wing) — then scale back down if price returns. The static "always
// reserve 100% of max loss regardless of where spot is" version below
// this comment used to be the whole formula; it was flagged as wildly
// overstating margin for a position that just opened at/near its own
// short strike (caught against a real thinkorswim comparison: 4 iron-
// butterfly units the static formula said needed way more margin than
// TIMS actually required, at a moment when spot was sitting right on the
// short strikes — exactly the "should be near the floor" case).
//
// This models that behavior with linear interpolation between a floor
// (MARGIN_FLOOR_PCT of max loss) and the full max loss, based on how far
// spot has already traveled from the short strike toward the long strike
// on the side that matters for this spread's own risk direction. This is
// a simplified stand-in for a full TIMS/portfolio-margin engine (which
// stress-tests a position across many hypothetical price/vol scenarios) —
// not a claim of matching any specific broker's number exactly, just the
// same SHAPE of behavior (low-near-center, scaling toward max-at-the-wing)
// instead of a flat worst-case reservation regardless of where price is.
const MARGIN_FLOOR_PCT = 0.10;

export function computeComboMargin(legs: Leg[], spot: number): MarginResult {
  const active = legs.filter((l) => !l.disabled && l.kind !== "stock").map(toOptLeg);
  const stockLegs = legs.filter((l) => !l.disabled && l.kind === "stock");
  const notes: MarginNote[] = [];
  let total = 0;

  for (const type of ["call", "put"] as OptionType[]) {
    const shorts = active.filter((l) => l.type === type && l.action === "sell").sort((a, b) => a.strike - b.strike);
    const longs = active.filter((l) => l.type === type && l.action === "buy").sort((a, b) => a.strike - b.strike);
    const { spreads, unpaired } = pairVerticals(shorts, longs);

    for (const { short, long } of spreads) {
      const qty = Math.min(short.qty, long.qty);
      const width = Math.abs(short.strike - long.strike);
      const netCredit = (short.premium - long.premium) * qty;
      // Only a NET CREDIT spread needs margin (width minus whatever credit
      // was collected — even a $0-credit spread still needs the full width,
      // hence >= 0 not > 0). A net DEBIT spread's max loss is capped at the
      // debit paid, which is already deducted from cash via costBasis —
      // it needs zero additional margin. Using the credit-spread formula
      // unconditionally here was a real bug: it inflated a debit spread's
      // margin ABOVE the width instead of recognizing it needs none.
      const maxLoss = netCredit >= 0 ? Math.max(0, width * 100 * qty - netCredit * 100) : 0;

      // Risk direction depends on which strike is the short (safe/center)
      // one: a call spread's danger is spot rising from short toward long;
      // a put spread's danger is spot falling from short toward long.
      const riskFraction = maxLoss <= 0 ? 0 : Math.max(0, Math.min(1,
        type === "call"
          ? (spot - short.strike) / (long.strike - short.strike)
          : (short.strike - spot) / (short.strike - long.strike)
      ));
      const m = maxLoss * (MARGIN_FLOOR_PCT + riskFraction * (1 - MARGIN_FLOOR_PCT));
      notes.push({
        legIds: [short.id, long.id],
        kind: "spread",
        amount: m,
        label: `${type === "call" ? "Call" : "Put"}价差（宽度${width}×${qty}张，按现价离风险的距离动态计算，最坏情况上限$${maxLoss.toFixed(0)}）`,
      });
      total += m;

      // Leftover quantity beyond the matched size on either leg is NOT a
      // clean spread for that excess — treat the excess short quantity as
      // naked rather than silently under-counting it.
      if (short.qty > qty) {
        const excess: OptLeg = { ...short, qty: short.qty - qty };
        unpaired.push(excess);
      }
    }

    for (const short of unpaired) {
      // Covered-call check: a short call backed by owned shares of the
      // underlying (100 shares per contract, standard lot) needs no
      // additional margin beyond the capital already spent on the stock.
      if (type === "call") {
        const coveringShares = stockLegs
          .filter((s) => s.action === "buy")
          .reduce((sum, s) => sum + (s.shares ?? 100), 0);
        const neededShares = short.qty * 100;
        if (coveringShares >= neededShares) {
          notes.push({ legIds: [short.id], kind: "covered-call", amount: 0, label: "备兑Call（正股已覆盖，不占用额外保证金）" });
          continue;
        }
      }

      if (type === "put" && NAKED_PUT_MODE === "cash-secured") {
        const m = cashSecuredPutMargin(short);
        notes.push({ legIds: [short.id], kind: "cash-secured-put", amount: m, label: `现金担保Put（行权价×100×${short.qty}张）` });
        total += m;
      } else {
        const m = nakedMargin(short, spot);
        notes.push({ legIds: [short.id], kind: "naked-call", amount: m, label: `裸卖${type === "call" ? "Call" : "Put"}（Reg-T标准公式）` });
        total += m;
      }
    }
  }

  // Iron-condor style credit: if there's exactly one call-spread and one
  // put-spread (both credit spreads, same qty, same expiry) already
  // counted above as two separate spread margins, only one side can
  // finish in the money at expiry — replace the sum with the larger of
  // the two, which is the standard iron-condor margin treatment.
  const spreadNotes = notes.filter((n) => n.kind === "spread");
  if (spreadNotes.length === 2) {
    const [a, b] = spreadNotes;
    const combinedBefore = a.amount + b.amount;
    const combinedAfter = Math.max(a.amount, b.amount);
    if (combinedAfter < combinedBefore) {
      total -= (combinedBefore - combinedAfter);
      notes.push({
        legIds: [...a.legIds, ...b.legIds],
        kind: "iron-condor",
        amount: -(combinedBefore - combinedAfter),
        label: "铁鹰/组合折抵（两翼不会同时被行权，按较大一侧计算，非两者相加）",
      });
    }
  }

  return { total: Math.round(total * 100) / 100, notes };
}