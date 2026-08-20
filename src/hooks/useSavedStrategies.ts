import { useCallback, useState } from "react";
import {
  loadSavedStrategies,
  deleteSavedStrategy,
  renameSavedStrategy,
  reorderSavedStrategies,
  toggleStarStrategy,
  type SavedStrategy,
} from "@/lib/savedStrategies";

// Owns the saved-strategy library's data, the save/manage dialog state, and
// the "is the current combo different from what's saved" baseline.
//
// The actual save/overwrite actions (handleSaveStrategy/handleOverwriteStrategy
// in App.tsx) deliberately stay there instead of moving in here: they read
// symbol/spot/legs/shifts/openingAt — combo and tracking state this pass
// didn't touch — and chain into the pending-preset-replace flow on success.
// This hook exposes its raw setters (setSavedStrategies, setStrategyBaseline)
// specifically so those orchestrators can keep updating this state without
// this hook needing to know anything about combos or presets.
export function useSavedStrategies() {
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>([]);
  const [saveStrategyOpen, setSaveStrategyOpen] = useState(false);
  const [manageStrategyOpen, setManageStrategyOpen] = useState(false);
  const [manageMode, setManageMode] = useState<"open" | "track">("open");
  const [strategyBaseline, setStrategyBaseline] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const s = await loadSavedStrategies();
    setSavedStrategies(s);
    return s;
  }, []);

  const handleDeleteStrategy = useCallback(async (id: string) => {
    setSavedStrategies(await deleteSavedStrategy(id));
  }, []);

  const handleRenameStrategy = useCallback(async (id: string, filename: string) => {
    setSavedStrategies(await renameSavedStrategy(id, filename));
  }, []);

  const handleReorderStrategies = useCallback(async (all: SavedStrategy[]) => {
    setSavedStrategies(await reorderSavedStrategies(all));
  }, []);

  const handleToggleStar = useCallback(async (id: string) => {
    setSavedStrategies(await toggleStarStrategy(id));
  }, []);

  return {
    savedStrategies,
    setSavedStrategies,
    saveStrategyOpen,
    setSaveStrategyOpen,
    manageStrategyOpen,
    setManageStrategyOpen,
    manageMode,
    setManageMode,
    strategyBaseline,
    setStrategyBaseline,
    reload,
    handleDeleteStrategy,
    handleRenameStrategy,
    handleReorderStrategies,
    handleToggleStar,
  };
}