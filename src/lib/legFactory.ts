// src/lib/legFactory.ts
// App.tsx's own leg-id/blank-leg helpers, split out purely to shrink that
// file — no behavior change. Note: src/lib/presets.ts has its own separate
// uid()/idc counter (pre-existing duplication, not consolidated here, out
// of scope for this move — see CLAUDE.md's file-slimming note).
import type { Leg } from "@/lib/types";
import { PRESET_GROUPS } from "@/lib/presets";
import { nearestFridayDte } from "@/lib/dateUtils";

let idc = 0;
export const uid = () => `leg-${Date.now()}-${idc++}`;

export const blankLeg = (strikeHint = 0): Leg => ({
  id: uid(),
  action: "buy",
  type: "call",
  strike: strikeHint,
  dte: nearestFridayDte(30),
  premium: 0,
});

// Clones a leg (tracked or opening) into a fresh OPENING-combo leg with the
// given new id, stripping `openLegId` in the process — a tracked leg's
// openLegId points at whatever ITS opening counterpart used to be, which is
// meaningless (and would be actively misleading — see types.ts) once this
// leg itself becomes the new opening combo, e.g. performSwitchToAnalysis's
// "current"/snapshot branches in App.tsx.
export const asOpeningLeg = (leg: Leg, newId: string): Leg => {
  const { openLegId, ...rest } = leg;
  void openLegId;
  return { ...rest, id: newId };
};

// Every distinct DTE used across all built-in presets (e.g. calendar/diagonal
// spreads mix 14/45-day legs with the usual 30-day default). Computed once so
// the cache-warming effect can pre-fetch a real chain for each — otherwise a
// preset leg whose DTE isn't the common 30-day default would still show a
// placeholder strike/premium until its own async fetch completes.
export const PRESET_DTE_SET = Array.from(new Set(
  PRESET_GROUPS.flatMap((g) => g.items.flatMap((item) =>
    item.legs().filter((l) => l.kind !== "stock").map((l) => l.dte)
  ))
));