// src/lib/legLinks.ts
import type { Leg } from "./types";

export interface LegLinkInfo {
  role: "source" | "derived";
  via: "roll" | "protect" | "hedge";
  otherIndex: number; // 1-based position of the paired leg within the SAME array passed to computeLegLinks
}

// Resolves Leg.derivedFrom (types.ts) into a per-leg display hint — "this
// leg is linked to leg #N" — so LegRow can show a small badge instead of
// leaving the roll/protect relationship for the person to spot purely from
// two rows happening to look related (xue: "很容易乱" once more than one
// roll/protect/hedge has happened). Hedge legs carry no legId (they target
// the whole combo, not one leg — see useLegEditing.ts's handleHedge) so
// they never produce an entry here; only Roll/Protect do, since only those
// two act on one specific existing leg.
//
// If a source leg was separately deleted, its child's derivedFrom.legId
// just won't resolve (findIndex returns -1) and that leg gets no link
// entry — not an error, just "no link to show". If more than one leg is
// ever derived from the same source (e.g. protecting the same leg twice),
// the source's own badge only reflects the last one processed — an
// accepted simplification for what should be a rare case, not worth a
// multi-link display.
export function computeLegLinks(legs: Leg[]): Map<string, LegLinkInfo> {
  const map = new Map<string, LegLinkInfo>();
  legs.forEach((leg, idx) => {
    const from = leg.derivedFrom;
    if (!from || !from.legId) return;
    const sourceIdx = legs.findIndex((l) => l.id === from.legId);
    if (sourceIdx === -1) return;
    map.set(leg.id, { role: "derived", via: from.via, otherIndex: sourceIdx + 1 });
    map.set(legs[sourceIdx].id, { role: "source", via: from.via, otherIndex: idx + 1 });
  });
  return map;
}