// src/components/LegActionDialogs.tsx
import type { Leg, Shifts } from "@/lib/types";
import SavePresetDialog from "@/components/SavePresetDialog";
import RollDialog from "@/components/RollDialog";
import ProtectDialog from "@/components/ProtectDialog";
import HedgeDialog from "@/components/HedgeDialog";
import DecisionCompareDialog from "@/components/DecisionCompareDialog";
import { ConfirmBulkDeleteDialog, ConfirmClearDialog, ConfirmSaveTrackedDialog, ImpliedSpotInfoPanel } from "@/components/dialogs";

// Every per-leg/per-combo action popup that isn't about saving/loading a
// named strategy (that half lives in StrategyPersistenceDialogs.tsx) —
// custom-preset save, clear-all confirm, bulk-delete confirm, the
// discard-tracked-edits confirm that clear-all can trigger, and the
// roll/protect/hedge/decision-compare/implied-spot leg-action dialogs.
// Split out of App.tsx purely to shrink that file; every prop here maps
// 1:1 to what was already wired inline, no behavior change.
interface Props {
  saveDialogOpen: boolean;
  onCloseSaveDialog: () => void;
  onSaveCustomPreset: (data: { name: string; desc: string; market: string; stocks: string; direction: string }) => void;
  activeLegs: Leg[];

  confirmClearOpen: boolean;
  onConfirmClear: () => void;
  onCancelClear: () => void;

  confirmBulkDeleteOpen: boolean;
  selectedCount: number;
  onConfirmBulkDelete: () => void;
  onCancelBulkDelete: () => void;

  confirmSaveTrackedOpen: boolean;
  onDontSaveTracked: () => void;
  onSaveTrackedThenClear: () => void;

  rollTarget: Leg | null;
  rollTargetSource: "legs" | "tracked";
  onCloseRoll: () => void;
  onConfirmRoll: (newLeg: Leg) => void;

  protectTarget: Leg | null;
  protectTargetSource: "legs" | "tracked";
  onCloseProtect: () => void;
  onConfirmProtect: (protectLeg: Leg) => void;

  hedgeOpen: boolean;
  hedgeTargetSource: "legs" | "tracked";
  legs: Leg[];
  // The "今日组合" equivalents of `legs`/`spot` — used instead when
  // rollTargetSource/protectTargetSource/hedgeTargetSource is "tracked", so
  // Roll/Protect/Hedge triggered from TrackedComboSection price against the
  // actual current tracked combo/spot rather than the (possibly stale,
  // slider-shifted) opening one. See App.tsx's TrackedComboSection wiring
  // for why these two need to travel together with the *TargetSource flags.
  trackedLegsForDialogs: Leg[];
  trackedSpotForDialogs: number;
  onCloseHedge: () => void;
  onConfirmHedge: (hedgeLeg: Leg) => void;

  compareTargetId: string | null;
  shifts: Shifts;
  onCloseCompare: () => void;

  showImpliedInfo: boolean;
  isCompareMode: boolean;
  effectiveTrackedSpot: number;
  correctedSpot: number | null;
  correcting: boolean;
  onCloseImplied: () => void;
  onCorrectSpot: () => void;

  spot: number;
  symbol: string;
}

export default function LegActionDialogs({
  saveDialogOpen, onCloseSaveDialog, onSaveCustomPreset, activeLegs,
  confirmClearOpen, onConfirmClear, onCancelClear,
  confirmBulkDeleteOpen, selectedCount, onConfirmBulkDelete, onCancelBulkDelete,
  confirmSaveTrackedOpen, onDontSaveTracked, onSaveTrackedThenClear,
  rollTarget, rollTargetSource, onCloseRoll, onConfirmRoll,
  protectTarget, protectTargetSource, onCloseProtect, onConfirmProtect,
  hedgeOpen, hedgeTargetSource, legs, trackedLegsForDialogs, trackedSpotForDialogs, onCloseHedge, onConfirmHedge,
  compareTargetId, shifts, onCloseCompare,
  showImpliedInfo, isCompareMode, effectiveTrackedSpot, correctedSpot, correcting, onCloseImplied, onCorrectSpot,
  spot, symbol,
}: Props) {
  return (
    <>
      <SavePresetDialog
        open={saveDialogOpen}
        onClose={onCloseSaveDialog}
        onSave={onSaveCustomPreset}
        legs={activeLegs}
      />

      {confirmClearOpen && (
        <ConfirmClearDialog
          onConfirm={onConfirmClear}
          onCancel={onCancelClear}
        />
      )}

      {confirmBulkDeleteOpen && (
        <ConfirmBulkDeleteDialog
          count={selectedCount}
          onConfirm={onConfirmBulkDelete}
          onCancel={onCancelBulkDelete}
        />
      )}

      {confirmSaveTrackedOpen && (
        <ConfirmSaveTrackedDialog
          onDontSave={onDontSaveTracked}
          onSaveSnapshot={onSaveTrackedThenClear}
        />
      )}

      {rollTarget && (
        <RollDialog
          leg={rollTarget}
          spot={rollTargetSource === "tracked" ? trackedSpotForDialogs : spot}
          symbol={symbol}
          allLegs={rollTargetSource === "tracked" ? trackedLegsForDialogs : legs}
          onClose={onCloseRoll}
          onConfirm={onConfirmRoll}
        />
      )}
      {protectTarget && (
        <ProtectDialog
          leg={protectTarget}
          spot={protectTargetSource === "tracked" ? trackedSpotForDialogs : spot}
          symbol={symbol}
          onClose={onCloseProtect}
          onConfirm={onConfirmProtect}
        />
      )}
      {hedgeOpen && (
        <HedgeDialog
          legs={hedgeTargetSource === "tracked" ? trackedLegsForDialogs : legs}
          spot={hedgeTargetSource === "tracked" ? trackedSpotForDialogs : spot}
          symbol={symbol}
          onClose={onCloseHedge}
          onConfirm={onConfirmHedge}
        />
      )}

      {compareTargetId && (
        <DecisionCompareDialog
          legs={legs}
          targetLegId={compareTargetId}
          spot={spot}
          symbol={symbol}
          shifts={shifts}
          onClose={onCloseCompare}
        />
      )}

      {showImpliedInfo && isCompareMode && (
        <ImpliedSpotInfoPanel
          trackedSpot={effectiveTrackedSpot}
          correctedSpot={correctedSpot}
          correcting={correcting}
          canCorrect={!!symbol.trim()}
          onClose={onCloseImplied}
          onCorrect={onCorrectSpot}
        />
      )}
    </>
  );
}
