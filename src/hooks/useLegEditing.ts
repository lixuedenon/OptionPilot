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
  // 2026-09-12 bug fix: every function in this file that mutates `trackedLegs`
  // must also flip this on — see the long comment above handleRollConfirm's
  // tracked branch for why. Optional only so this file doesn't force every
  // existing/future caller to wire it before TypeScript is satisfied; when
  // omitted, tracked-side edits made here silently fail to unlock "保存追踪
  // 快照" (App.tsx's `TrackedComboSection` disables that button on
  // `!trackedDirty`), so the one real caller (App.tsx) always passes it.
  setTrackedDirty?: React.Dispatch<React.SetStateAction<boolean>>;
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
// (lives in useStrategyOrchestration.ts), handleCorrectSpot, handleAddCustom/
// handleAddToSimAccount (cross-feature, not leg-editing).
//
// 2026-09-12 bug fix: every tracked-side mutation in THIS file (roll/protect/
// hedge confirm, toggle, close) must call `setTrackedDirty?.(true)` too, the
// same as updateTrackedLeg already does — xue reported that after Roll/
// Protect/Hedge/平仓/取消屏蔽 on a "今日组合" leg, "保存追踪快照" stayed
// disabled. Root cause: that button's `disabled={!trackedDirty}` and this
// file's tracked-side handlers changed `trackedLegs` directly via
// `setTrackedLegs` without ever touching `trackedDirty` — plain field edits
// (typing a new strike/premium) went through `updateTrackedLeg` instead,
// which already set it, so only THESE actions were silently exempt.
export function useLegEditing({ legs, setLegs, trackedLegs, setTrackedLegs, setTrackedDirty }: UseLegEditingParams) {
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
  // 2026-09-12: deleting a leg that was created by Roll (`derivedFrom.via
  // === "roll"`) now auto-re-enables the leg it rolled away FROM, in the
  // same state update — undoing a roll used to mean the person had to
  // separately remember to go "取消屏蔽" the old leg AND delete the new one,
  // and with more than one roll/protect/hedge on the board there was no way
  // to tell which pair went together (see lib/legLinks.ts — that's the
  // other half of this fix, the "linked to leg #N" badge). Protect/Hedge
  // legs never disable anything to begin with (see handleProtectConfirm/
  // handleHedgeConfirm below), so deleting one of those is still a plain
  // removal — nothing extra to restore. (Opening-combo legs never carry
  // `closedPnl` — see types.ts — so there's nothing to clear here.)
  const deleteLeg = (id: string) => {
    setLegs((prev) => {
      const target = prev.find((l) => l.id === id);
      const filtered = prev.filter((l) => l.id !== id);
      if (target?.derivedFrom?.via === "roll" && target.derivedFrom.legId) {
        const sourceId = target.derivedFrom.legId;
        return filtered.map((l) => (l.id === sourceId ? { ...l, disabled: false } : l));
      }
      return filtered;
    });
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

  // "统一数量/行权价/到期日" (2026-09-12, xue's request): sync the rest of
  // the selected legs to match the FIRST selected leg's value, so adjusting
  // a multi-leg combo (e.g. every leg of an iron condor) doesn't mean
  // repeating the same qty/strike/expiry edit on every row by hand.
  // Restricted to option legs — a stock leg's `strike` field is actually
  // its entry price and it has neither `dte` nor `qty` (see types.ts), so
  // letting one anchor or receive one of these values would silently apply
  // a number that means something else entirely on that row. Fewer than
  // two eligible (option) legs selected means there's nothing to sync, so
  // both the availability flag and the action itself are no-ops then.
  const eligibleForUnify = useMemo(
    () => selectedLegsList.filter((l) => l.kind !== "stock"),
    [selectedLegsList],
  );
  const canUnifyLegs = eligibleForUnify.length >= 2;

  const unifyLegField = (field: "qty" | "strike" | "dte") => {
    if (eligibleForUnify.length < 2) return;
    const baseline = eligibleForUnify[0];
    const targetIds = new Set(eligibleForUnify.slice(1).map((l) => l.id));
    setLegs((prev) =>
      prev.map((l) => {
        if (!targetIds.has(l.id)) return l;
        if (field === "qty") return { ...l, qty: baseline.qty ?? 1 };
        // Strike/expiry changing invalidates whatever premium was quoted
        // for the leg's OLD contract — resetting it to 0 here is exactly
        // what LegRow's own strike/expiry pickers already do
        // (handleSelectExpiry), which lets each affected row's existing
        // auto-fill effect fetch the right premium for its new strike/
        // expiry, rather than this hook trying to fetch option chains
        // itself.
        if (field === "strike") return { ...l, strike: baseline.strike, premium: 0 };
        return { ...l, dte: baseline.dte, premium: 0 };
      }),
    );
  };
  const unifyQty = () => unifyLegField("qty");
  const unifyStrike = () => unifyLegField("strike");
  const unifyDte = () => unifyLegField("dte");

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
  // `sourcePnl`: only meaningful (and only ever passed) when rolling a
  // TRACKED leg — App.tsx supplies `trackedLegPnlById.get(rollTarget.id)`,
  // the source leg's live P&L the instant before it's disabled, so that
  // P&L is booked as `closedPnl` instead of silently disappearing from the
  // position's total the moment the leg stops being "active" (see types.ts
  // and useComboAnalytics.ts's realizedTrackedPnl). The opening combo
  // ("legs") has no such concept — it's a hypothetical construction, not an
  // actual position — so its branch below never sets closedPnl.
  const handleRollConfirm = (newLeg: Leg, sourcePnl?: number) => {
    if (!rollTarget) return;
    // Tags the new leg with where it came from — see types.ts's
    // `derivedFrom` and lib/legLinks.ts — so the UI can badge the pair and
    // deleteLeg/closeTrackedLeg can auto-restore rollTarget on undo.
    const taggedLeg: Leg = { ...newLeg, derivedFrom: { legId: rollTarget.id, via: "roll" } };
    if (rollTargetSource === "tracked") {
      setTrackedLegs((prev) => (prev ? prev.map((l) => (l.id === rollTarget.id ? { ...l, disabled: true, closedPnl: sourcePnl } : l)) : prev));
      // The new rolled-to leg has no opening-combo counterpart of its own
      // (it didn't exist when trackedLegs was derived from legs) — leaving
      // openLegId unset is correct here, not a gap to fill in; see types.ts.
      setTrackedLegs((prev) => (prev ? [...prev, taggedLeg] : prev));
      setTrackedDirty?.(true);
    } else {
      setLegs((prev) => prev.map((l) => l.id === rollTarget.id ? { ...l, disabled: true } : l));
      setLegs((prev) => [...prev, taggedLeg]);
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
    if (!protectTarget) return;
    const taggedLeg: Leg = { ...protectLeg, derivedFrom: { legId: protectTarget.id, via: "protect" } };
    if (protectTargetSource === "tracked") {
      setTrackedLegs((prev) => (prev ? [...prev, taggedLeg] : prev));
      setTrackedDirty?.(true);
    } else {
      setLegs((prev) => [...prev, taggedLeg]);
    }
    setProtectTarget(null);
  };

  const handleCompare = (legId: string) => setCompareTargetId(legId);

  const handleHedge = (source: LegTarget = "legs") => {
    setHedgeOpen(true);
    setHedgeTargetSource(source);
  };
  const handleHedgeConfirm = (hedgeLeg: Leg) => {
    // No legId here — hedge targets the whole combo, not one specific leg
    // (handleHedge above never takes a legId either), so there's no single
    // "source" leg to link back to or restore on undo. Tagged only so the
    // menu can still show "撤销对冲" instead of a generic "删除"/"平仓".
    const taggedLeg: Leg = { ...hedgeLeg, derivedFrom: { via: "hedge" } };
    if (hedgeTargetSource === "tracked") {
      setTrackedLegs((prev) => (prev ? [...prev, taggedLeg] : prev));
      setTrackedDirty?.(true);
    } else {
      setLegs((prev) => [...prev, taggedLeg]);
    }
    setHedgeOpen(false);
  };

  // "今日组合"版的 toggleLeg/deleteLeg — added 2026-09-12 as part of giving
  // TrackedComboSection's three-dot menu real functionality instead of the
  // `() => {}` no-ops it shipped with (see App.tsx's TrackedComboSection
  // wiring). Xue reported that after Roll/Protect/Hedge on a tracked leg,
  // neither the frozen original leg nor the newly-added leg could be
  // touched again — that was never a freezing bug in handleRoll/
  // handleProtect/handleHedge above, it was simply that TrackedComboSection
  // had no real toggle/delete handlers to call.
  //
  // Re-enabling a blocked leg always clears any `closedPnl` it's carrying
  // (whether from a plain 平仓 or from being a roll's source) — once it's
  // live again, its P&L is computed fresh from trackedResult every render,
  // and leaving a stale closedPnl behind would double-count it: once via
  // the live calculation, again via realizedTrackedPnl summing closedPnl
  // across trackedLegs.
  const toggleTrackedLeg = (id: string) => {
    setTrackedLegs((prev) =>
      prev
        ? prev.map((l) => (l.id === id ? { ...l, disabled: !l.disabled, closedPnl: l.disabled ? undefined : l.closedPnl } : l))
        : prev,
    );
    setTrackedDirty?.(true);
  };
  // `pnl`: the leg's live P&L (App.tsx supplies `trackedLegPnlById.get(id)`)
  // right before it's closed — see types.ts's `closedPnl` for why this is
  // captured instead of just deleting the leg (xue: closing a leg used to
  // make its P&L vanish from the position's total instead of booking it).
  //
  // A leg with `derivedFrom` set means this click is really "撤销展期/保护/
  // 对冲" (see LegRow.tsx's deleteConfig, which relabels the same delete
  // action for such a leg) — that's a full undo, not a close, so it still
  // deletes the leg outright; Roll's case additionally restores the source
  // leg to fully live (clearing ITS closedPnl too, for the same
  // double-counting reason as toggleTrackedLeg above) rather than leaving a
  // half-reverted, still-closed leg behind.
  const closeTrackedLeg = (id: string, pnl: number) => {
    setTrackedLegs((prev) => {
      if (!prev) return prev;
      const target = prev.find((l) => l.id === id);
      if (!target) return prev;
      if (target.derivedFrom) {
        const filtered = prev.filter((l) => l.id !== id);
        if (target.derivedFrom.via === "roll" && target.derivedFrom.legId) {
          const sourceId = target.derivedFrom.legId;
          return filtered.map((l) => (l.id === sourceId ? { ...l, disabled: false, closedPnl: undefined } : l));
        }
        return filtered;
      }
      // Already closed (e.g. a stray second click) — nothing to do; in
      // particular, must NOT re-freeze at `pnl`, which for an already-
      // disabled leg is 0 (trackedLegPnlById only covers active legs).
      if (target.disabled && target.closedPnl !== undefined) return prev;
      return prev.map((l) => (l.id === id ? { ...l, disabled: true, closedPnl: pnl } : l));
    });
    setTrackedDirty?.(true);
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
    setTrackedDirty?.(true);
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
    canUnifyLegs,
    unifyQty,
    unifyStrike,
    unifyDte,
    handleRoll,
    handleRollConfirm,
    handleProtect,
    handleProtectConfirm,
    handleCompare,
    handleHedge,
    handleHedgeConfirm,
    moveLeg,
    moveTrackedLeg,
    toggleTrackedLeg,
    closeTrackedLeg,
  };
}