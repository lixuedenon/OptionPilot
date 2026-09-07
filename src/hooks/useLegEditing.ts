// src/hooks/useLegEditing.ts
import { useMemo, useState } from "react";
import type { Leg } from "@/lib/types";

// Which combo an in-flight roll/protect/hedge action targets. Defaults to
// "legs" everywhere below so every pre-existing call site (LegListSection's
// opening-combo rows, which only ever pass a legId with no second argument)
// keeps behaving exactly as before with zero changes at the call site.
// TrackedComboSection's rows are the only caller that explicitly passes
// "tracked" — see App.tsx's TrackedComboSection wiring.
type LegTarget = "legs" | "tracked";

interface UseLegEditingParams {
  legs: Leg[];
  setLegs: React.Dispatch<React.SetStateAction<Leg[]>>;
  trackedLegs: Leg[] | null;
  setTrackedLegs: React.Dispatch<React.SetStateAction<Leg[] | null>>;
}

// Owns everything about editing/selecting/acting-on the individual legs of
// the OPENING combo (App.tsx's `legs`): per-leg CRUD, the batch-selection
// toolbar (select/clear/bulk-disable/bulk-delete), and the roll/protect/
// hedge/compare leg-action dialogs' target state. Extracted out of App.tsx
// purely to keep that file's size down — this is not a semantically
// independent module (it reaches back into `legs`/`setLegs` directly), so it
// deliberately stays out of src/lib/. `moveTrackedLeg` rides along here too
// even though it moves `trackedLegs` rather than `legs`, since it's the same
// kind of trivial reorder helper as `moveLeg` and has no other natural home.
//
// Deliberately NOT included (stays in App.tsx): addLeg/applyPreset/
// clearAllLegs/doClearAll (they reset/replace the whole combo and touch
// legBaseSpot/legBaseSymbol/spotManuallySet/tracking state), updateTrackedLeg
// (tracked-mode dirty-tracking), handleCorrectSpot, handleAddCustom/
// handleAddToSimAccount (cross-feature, not leg-editing).
export function useLegEditing({ legs, setLegs, trackedLegs, setTrackedLegs }: UseLegEditingParams) {
  const [rollTarget, setRollTarget] = useState<Leg | null>(null);
  const [rollTargetSource, setRollTargetSource] = useState<LegTarget>("legs");
  const [protectTarget, setProtectTarget] = useState<Leg | null>(null);
  const [protectTargetSource, setProtectTargetSource] = useState<LegTarget>("legs");
  const [hedgeOpen, setHedgeOpen] = useState(false);
  const [hedgeTargetSource, setHedgeTargetSource] = useState<LegTarget>("legs");
  const [compareTargetId, setCompareTargetId] = useState<string | null>(null);
  const [selectedLegIds, setSelectedLegIds] = useState<Set<string>>(new Set());
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);

  const updateLeg = (id: string, patch: Partial<Leg>) =>
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const toggleLeg = (id: string) => {
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, disabled: !l.disabled } : l)));
  };
  const deleteLeg = (id: string) => {
    setLegs((prev) => prev.filter((l) => l.id !== id));
    setSelectedLegIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // ── Batch selection (analysis + tracking's shared open-combo list) ──
  const toggleLegSelection = (id: string) => {
    setSelectedLegIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearLegSelection = () => setSelectedLegIds(new Set());
  const selectAllLegs = () => setSelectedLegIds(new Set(legs.map((l) => l.id)));

  const selectedLegsList = useMemo(
    () => legs.filter((l) => selectedLegIds.has(l.id)),
    [legs, selectedLegIds],
  );
  const selectedCount = selectedLegsList.length;
  const allSelectedDisabled = selectedCount > 0 && selectedLegsList.every((l) => l.disabled);

  // Toggle disable for every currently-selected leg in one go. Mirrors the
  // per-row block/unblock: if every selected leg is already blocked, this
  // unblocks them all; otherwise it blocks them all (so a mixed selection
  // always resolves to "block everything selected" rather than a confusing
  // per-leg flip).
  const bulkToggleDisable = () => {
    if (selectedCount === 0) return;
    setLegs((prev) => prev.map((l) => (selectedLegIds.has(l.id) ? { ...l, disabled: !allSelectedDisabled } : l)));
  };

  const requestBulkDelete = () => {
    if (selectedCount === 0) return;
    setConfirmBulkDeleteOpen(true);
  };
  const confirmBulkDelete = () => {
    setLegs((prev) => prev.filter((l) => !selectedLegIds.has(l.id)));
    setConfirmBulkDeleteOpen(false);
    clearLegSelection();
  };

  // `source` picks which combo the leg is looked up in AND which combo the
  // confirm handler below eventually mutates — "legs" (the default, so
  // every existing legId-only call site keeps working unchanged) for a row
  // in the opening combo, "tracked" for a row in TrackedComboSection's
  // "今日组合". Previously this always searched/mutated `legs` regardless
  // of which section's row actually triggered it — a Roll/Protect/Hedge
  // clicked from the "今日组合" list silently modified the OPENING combo
  // instead (the tracked row's own change never showed up, while the
  // opening combo picked up an edit nobody asked it to make there).
  const handleRoll = (legId: string, source: LegTarget = "legs") => {
    const pool = source === "tracked" ? (trackedLegs ?? []) : legs;
    const leg = pool.find((l) => l.id === legId);
    if (leg) {
      setRollTarget(leg);
      setRollTargetSource(source);
    }
  };
  const handleRollConfirm = (newLeg: Leg) => {
    if (!rollTarget) return;
    if (rollTargetSource === "tracked") {
      setTrackedLegs((prev) => (prev ? prev.map((l) => (l.id === rollTarget.id ? { ...l, disabled: true } : l)) : prev));
      // The new rolled-to leg has no opening-combo counterpart of its own
      // (it didn't exist when trackedLegs was derived from legs) — leaving
      // openLegId unset is correct here, not a gap to fill in; see types.ts.
      setTrackedLegs((prev) => (prev ? [...prev, newLeg] : prev));
    } else {
      setLegs((prev) => prev.map((l) => l.id === rollTarget.id ? { ...l, disabled: true } : l));
      setLegs((prev) => [...prev, newLeg]);
    }
    setRollTarget(null);
  };

  const handleProtect = (legId: string, source: LegTarget = "legs") => {
    const pool = source === "tracked" ? (trackedLegs ?? []) : legs;
    const leg = pool.find((l) => l.id === legId);
    if (leg) {
      setProtectTarget(leg);
      setProtectTargetSource(source);
    }
  };
  const handleProtectConfirm = (protectLeg: Leg) => {
    if (protectTargetSource === "tracked") {
      setTrackedLegs((prev) => (prev ? [...prev, protectLeg] : prev));
    } else {
      setLegs((prev) => [...prev, protectLeg]);
    }
    setProtectTarget(null);
  };

  const handleCompare = (legId: string) => setCompareTargetId(legId);

  const handleHedge = (source: LegTarget = "legs") => {
    setHedgeOpen(true);
    setHedgeTargetSource(source);
  };
  const handleHedgeConfirm = (hedgeLeg: Leg) => {
    if (hedgeTargetSource === "tracked") {
      setTrackedLegs((prev) => (prev ? [...prev, hedgeLeg] : prev));
    } else {
      setLegs((prev) => [...prev, hedgeLeg]);
    }
    setHedgeOpen(false);
  };

  const moveLeg = (index: number, direction: -1 | 1) => {
    setLegs((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const arr = [...prev];
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr;
    });
  };
  const moveTrackedLeg = (index: number, direction: -1 | 1) => {
    setTrackedLegs((prev) => {
      if (!prev) return prev;
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const arr = [...prev];
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr;
    });
  };

  return {
    rollTarget, setRollTarget, rollTargetSource,
    protectTarget, setProtectTarget, protectTargetSource,
    hedgeOpen, setHedgeOpen, hedgeTargetSource,
    compareTargetId, setCompareTargetId,
    selectedLegIds,
    confirmBulkDeleteOpen, setConfirmBulkDeleteOpen,
    updateLeg,
    toggleLeg,
    deleteLeg,
    toggleLegSelection,
    clearLegSelection,
    selectAllLegs,
    selectedCount,
    allSelectedDisabled,
    bulkToggleDisable,
    requestBulkDelete,
    confirmBulkDelete,
    handleRoll,
    handleRollConfirm,
    handleProtect,
    handleProtectConfirm,
    handleCompare,
    handleHedge,
    handleHedgeConfirm,
    moveLeg,
    moveTrackedLeg,
  };
}