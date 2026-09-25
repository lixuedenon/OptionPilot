// src/components/StrategyPersistenceDialogs.tsx
import type { Leg, Shifts } from "@/lib/types";
import type { SavedStrategy } from "@/lib/savedStrategies";
import SaveStrategyDialog from "@/components/SaveStrategyDialog";
import ManageStrategiesDialog from "@/components/ManageStrategiesDialog";
import { ConfirmLeaveDialog, ConfirmReplacePresetDialog, ConfirmSnapshotDialog } from "@/components/dialogs";

// Every dialog about saving/switching/leaving a named strategy — the four
// "you have unsaved tracked edits, save first?" confirms (preset switch,
// preset replace-in-place, leaving the page, mode switch) plus a symbol
// change's own copy of the same confirm (switching the underlying while
// "今日组合" has unsaved edits), and the save/manage strategy dialogs
// themselves. Split out of App.tsx purely to shrink that file; every
// callback here is the exact same closure App.tsx already built inline,
// just handed down as a prop instead of written in place — no behavior
// change beyond the symbol-change guard itself.
interface Props {
  confirmPresetOpen: boolean;
  onCancelPresetSwitch: () => void;
  onDontSavePresetSwitch: () => void;
  onSaveSnapshotThenPresetSwitch: () => void;

  confirmReplaceOpen: boolean;
  onCancelReplace: () => void;
  onDontSaveReplace: () => void;
  onSaveFirstReplace: () => void;

  confirmLeaveOpen: boolean;
  // 2026-09-24新增，配合"退出时逐一提示"——当前正在问哪一个combo（"方案
  // A/B/C"）、后面还有几个待确认，undefined/0表示不需要显示（只有一个
  // 待确认，或者调用方没传）。
  leaveComboLabel?: string;
  leaveRemainingCount?: number;
  onCancelLeave: () => void;
  onDontSaveLeave: () => void;
  onSaveFirstLeave: () => void;

  confirmSwitchOpen: boolean;
  onCancelSwitch: () => void;
  onDontSaveSwitch: () => void;
  onSaveSnapshotThenSwitch: () => void;

  confirmSymbolChangeOpen: boolean;
  onCancelSymbolChange: () => void;
  onDontSaveSymbolChange: () => void;
  onSaveSnapshotThenSymbolChange: () => void;

  saveStrategyOpen: boolean;
  onCloseSaveStrategy: () => void;
  onSaveStrategy: (filename: string) => void;
  onOverwriteStrategy: (id: string, filename: string) => void;
  symbol: string;
  comboDirection: "buy" | "sell";
  strategyName: string;
  activeLegs: Leg[];
  spot: number;
  shifts: Shifts;
  openingAt: number;
  savedStrategies: SavedStrategy[];

  manageStrategyOpen: boolean;
  onCloseManage: () => void;
  manageMode: "open" | "track";
  onOpenStrategy: (s: SavedStrategy) => void;
  onReorderStrategies: (all: SavedStrategy[]) => void;
  onRenameStrategy: (id: string, filename: string) => void;
  onDeleteStrategy: (id: string) => void;
  onToggleStarStrategy: (id: string) => void;
  onTrackStrategy: (s: SavedStrategy) => void;
}

export default function StrategyPersistenceDialogs({
  confirmPresetOpen, onCancelPresetSwitch, onDontSavePresetSwitch, onSaveSnapshotThenPresetSwitch,
  confirmReplaceOpen, onCancelReplace, onDontSaveReplace, onSaveFirstReplace,
  confirmLeaveOpen, leaveComboLabel, leaveRemainingCount, onCancelLeave, onDontSaveLeave, onSaveFirstLeave,
  confirmSwitchOpen, onCancelSwitch, onDontSaveSwitch, onSaveSnapshotThenSwitch,
  confirmSymbolChangeOpen, onCancelSymbolChange, onDontSaveSymbolChange, onSaveSnapshotThenSymbolChange,
  saveStrategyOpen, onCloseSaveStrategy, onSaveStrategy, onOverwriteStrategy,
  symbol, comboDirection, strategyName, activeLegs, spot, shifts, openingAt, savedStrategies,
  manageStrategyOpen, onCloseManage, manageMode, onOpenStrategy, onReorderStrategies,
  onRenameStrategy, onDeleteStrategy, onToggleStarStrategy, onTrackStrategy,
}: Props) {
  return (
    <>
      {confirmPresetOpen && (
        <ConfirmSnapshotDialog
          onCancel={onCancelPresetSwitch}
          onDontSave={onDontSavePresetSwitch}
          onSaveSnapshot={onSaveSnapshotThenPresetSwitch}
        />
      )}

      {confirmReplaceOpen && (
        <ConfirmReplacePresetDialog
          onCancel={onCancelReplace}
          onDontSave={onDontSaveReplace}
          onSaveFirst={onSaveFirstReplace}
        />
      )}

      {confirmLeaveOpen && (
        <ConfirmLeaveDialog
          comboLabel={leaveComboLabel}
          remainingCount={leaveRemainingCount}
          onCancel={onCancelLeave}
          onDontSave={onDontSaveLeave}
          onSaveFirst={onSaveFirstLeave}
        />
      )}

      {confirmSwitchOpen && (
        <ConfirmSnapshotDialog
          onCancel={onCancelSwitch}
          onDontSave={onDontSaveSwitch}
          onSaveSnapshot={onSaveSnapshotThenSwitch}
        />
      )}

      {confirmSymbolChangeOpen && (
        <ConfirmSnapshotDialog
          onCancel={onCancelSymbolChange}
          onDontSave={onDontSaveSymbolChange}
          onSaveSnapshot={onSaveSnapshotThenSymbolChange}
        />
      )}

      <SaveStrategyDialog
        open={saveStrategyOpen}
        onClose={onCloseSaveStrategy}
        onSave={onSaveStrategy}
        onOverwrite={onOverwriteStrategy}
        symbol={symbol}
        direction={comboDirection}
        strategyName={strategyName}
        legs={activeLegs}
        spot={spot}
        shifts={shifts}
        openingAt={openingAt}
        existing={savedStrategies}
      />

      <ManageStrategiesDialog
        open={manageStrategyOpen}
        onClose={onCloseManage}
        mode={manageMode}
        strategies={savedStrategies}
        onOpen={onOpenStrategy}
        onReorder={onReorderStrategies}
        onRename={onRenameStrategy}
        onDelete={onDeleteStrategy}
        onToggleStar={onToggleStarStrategy}
        onTrack={onTrackStrategy}
      />
    </>
  );
}