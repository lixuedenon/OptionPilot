import type { Leg, Shifts } from "./types";
import { priceCombo, probabilityOfProfit, maxProfitLoss, payoffCurvePoints, type PayoffPoint } from "./pricing";
import { dteFromDate } from "./dateUtils";
import { getOptionChain, premiumFromQuote, nearestStrikeToSpot } from "./optionChain";

export interface DecisionScenario {
  key: "doNothing" | "close" | "roll";
  legs: Leg[];
  // Current (marked-to-market) combo value, evaluated under the SAME
  // price/time/IV shift the analysis-mode sliders are currently set to —
  // see compareDecisions' own comment for why this follows the sliders
  // instead of always being "as of right now".
  netValue: number;
  // maxProfit/maxLoss/pop describe the combo's outcome AT EXPIRY, which is
  // a property of the leg list itself (strikes, premiums, actions) — the
  // slider shift doesn't change that, so these are intentionally NOT
  // re-evaluated under the shift the way netValue is.
  maxProfit: number;
  maxLoss: number;
  pop: number;
  curve: PayoffPoint[];
  // Only set for "roll" — the real, listed expiry date it resolved to, so
  // the dialog can show an actual date instead of a vague "+30 days".
  expiryDate?: string;
}

function buildScenario(
  key: DecisionScenario["key"],
  legs: Leg[],
  spot: number,
  shifts: Shifts,
  expiryDate?: string,
): DecisionScenario {
  const active = legs.filter((l) => !l.disabled);
  const netValue = priceCombo(active, shifts, spot).shiftedValue;
  const { maxProfit, maxLoss } = maxProfitLoss(active, spot);
  const { pop } = probabilityOfProfit(active, spot);
  const curve = payoffCurvePoints(active, spot);
  return { key, legs, netValue, maxProfit, maxLoss, pop, curve, expiryDate };
}

// Compares three outcomes for one specific leg within the combo:
//  - doNothing: the combo exactly as it is
//  - close: that leg removed (as if closed out)
//  - roll: that leg replaced with the nearest REAL listed strike/expiry
//    roughly 30 days further out, using the real quoted premium from the
//    live option chain (same data source and shared server-side cache the
//    rest of the app already uses — see option-chain's cache design notes).
//    This is a real network call, so the roll scenario can take a moment
//    to appear and is added to the list once it resolves rather than
//    blocking doNothing/close from showing immediately.
//
// `shifts` is the analysis-mode sliders' CURRENT price/time/IV shift, not
// always {0,0,0} — the comparison deliberately follows wherever the
// sliders are set, so a trader can drag to a hypothetical future scenario
// ("if the stock drops 5% and 10 days pass") and immediately see what
// hold/close/roll would each look like from there. That's the whole point
// of pairing this with the sliders: rehearsing a decision before the real
// market ever gets there, not just describing the position as of today.
//
// Hedging isn't included here — adding a hedge leg is a combo-level
// decision (which strike, which type, sized how) rather than a mechanical
// transform of the target leg the way close/roll are, so it doesn't have
// an equally well-defined "default" to compare against.
export async function compareDecisions(
  allLegs: Leg[],
  targetLegId: string,
  spot: number,
  symbol: string,
  shifts: Shifts,
): Promise<DecisionScenario[]> {
  const targetLeg = allLegs.find((l) => l.id === targetLegId);
  if (!targetLeg) return [];

  const scenarios: DecisionScenario[] = [buildScenario("doNothing", allLegs, spot, shifts)];

  const closedLegs = allLegs.filter((l) => l.id !== targetLegId);
  scenarios.push(buildScenario("close", closedLegs, spot, shifts));

  if (targetLeg.kind !== "stock" && spot > 0 && symbol.trim()) {
    try {
      const oldDte = Math.max(0, Math.round(targetLeg.dte));
      const chain = await getOptionChain(symbol.trim(), oldDte + 30);
      const rows = targetLeg.type === "call" ? chain.calls : chain.puts;
      const matchedStrike = nearestStrikeToSpot(rows, targetLeg.strike);
      const quote = matchedStrike !== null ? rows.find((r) => r.strike === matchedStrike) : undefined;
      if (quote) {
        const rolledLeg: Leg = {
          ...targetLeg,
          id: `${targetLeg.id}-preview-roll`,
          strike: matchedStrike as number,
          dte: dteFromDate(chain.usedExpiryDate),
          premium: premiumFromQuote(quote),
        };
        const rolledLegs = [...allLegs.filter((l) => l.id !== targetLegId), rolledLeg];
        scenarios.push(buildScenario("roll", rolledLegs, spot, shifts, chain.usedExpiryDate));
      }
    } catch {
      // Real chain data unavailable (network issue, symbol has no listed
      // options, etc.) — the roll scenario just doesn't appear rather than
      // failing the whole comparison over one scenario's data being
      // unreachable. doNothing/close are still useful on their own.
    }
  }

  return scenarios;
}