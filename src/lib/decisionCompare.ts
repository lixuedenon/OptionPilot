import type { Leg } from "./types";
import { priceCombo, probabilityOfProfit, maxProfitLoss } from "./pricing";
import { dteFromDate } from "./dateUtils";
import { getOptionChain, premiumFromQuote, nearestStrikeToSpot } from "./optionChain";

export interface DecisionScenario {
  key: "doNothing" | "close" | "roll";
  legs: Leg[];
  netValue: number;
  maxProfit: number;
  maxLoss: number;
  pop: number;
}

function buildScenario(key: DecisionScenario["key"], legs: Leg[], spot: number): DecisionScenario {
  const active = legs.filter((l) => !l.disabled);
  const netValue = priceCombo(active, { dS: 0, dT: 0, dV: 0 }, spot).shiftedValue;
  const { maxProfit, maxLoss } = maxProfitLoss(active, spot);
  const { pop } = probabilityOfProfit(active, spot);
  return { key, legs, netValue, maxProfit, maxLoss, pop };
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
// Hedging isn't included here — adding a hedge leg is a combo-level
// decision (which strike, which type, sized how) rather than a mechanical
// transform of the target leg the way close/roll are, so it doesn't have
// an equally well-defined "default" to compare against.
export async function compareDecisions(
  allLegs: Leg[],
  targetLegId: string,
  spot: number,
  symbol: string,
): Promise<DecisionScenario[]> {
  const targetLeg = allLegs.find((l) => l.id === targetLegId);
  if (!targetLeg) return [];

  const scenarios: DecisionScenario[] = [buildScenario("doNothing", allLegs, spot)];

  const closedLegs = allLegs.filter((l) => l.id !== targetLegId);
  scenarios.push(buildScenario("close", closedLegs, spot));

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
        scenarios.push(buildScenario("roll", rolledLegs, spot));
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