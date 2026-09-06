// src/hooks/useLegEditing.ts
import { useMemo, useState } from "react";
import type { Leg } from "@/lib/types";

interface UseLegEditingParams {
  legs: Leg[];
  setLegs: React.Dispatch<React.SetStateAction<Leg[]>>;
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
export function useLegEditing({ legs, setLegs, setTrackedLegs }: UseLegEditingParams) {
  const [rollTarget, setRollTarget] = useState<Leg | null>(null);
  const [protectTarget, setProtectTarget] = useState<Leg | null>(null);
  const [hedgeOpen, setHedgeOpen] = useState(false);
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

  const handleRoll = (legId: string) => {
    const leg = legs.find((l) => l.id === legId);
    if (leg) setRollTarget(leg);
  };
  const handleRollConfirm = (newLeg: Leg) => {
    if (!rollTarget) return;
    setLegs((prev) => prev.map((l) => l.id === rollTarget.id ? { ...l, disabled: true } : l));
    setLegs((prev) => [...prev, newLeg]);
    setRollTarget(null);
  };

  const handleProtect = (legId: string) => {
    const leg = legs.find((l) => l.id === legId);
    if (leg) setProtectTarget(leg);
  };
  const handleProtectConfirm = (protectLeg: Leg) => {
    setLegs((prev) => [...prev, protectLeg]);
    setProtectTarget(null);
  };

  const handleCompare = (legId: string) => setCompareTargetId(legId);

  const handleHedge = () => setHedgeOpen(true);
  const handleHedgeConfirm = (hedgeLeg: Leg) => {
    setLegs((prev) => [...prev, hedgeLeg]);
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
    rollTarget, setRollTarget,
    protectTarget, setProtectTarget,
    hedgeOpen, setHedgeOpen,
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