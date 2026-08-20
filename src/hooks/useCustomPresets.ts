import { useCallback, useState } from "react";
import { loadCustomPresets, addCustomPreset, deleteCustomPreset, type CustomPreset } from "@/lib/customPresets";
import type { Leg } from "@/lib/types";

// Owns the custom-preset library's data and its own save-dialog state.
// Building a preset from the CURRENT combo — normalizing strikes/premiums
// against spot — deliberately stays in App.tsx, since that normalization is
// a "combo" concern, not a "preset storage" one. This hook only knows how
// to persist an already-normalized preset.
export function useCustomPresets() {
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  const reload = useCallback(async () => {
    const p = await loadCustomPresets();
    setCustomPresets(p);
    return p;
  }, []);

  const addPreset = useCallback(
    async (data: { name: string; desc: string; market: string; stocks: string; direction: string }, legs: Leg[]) => {
      const updated = await addCustomPreset({ ...data, legs });
      setCustomPresets(updated);
      setSaveDialogOpen(false);
    },
    [],
  );

  const removePreset = useCallback(async (id: string) => {
    setCustomPresets(await deleteCustomPreset(id));
  }, []);

  return {
    customPresets,
    setCustomPresets,
    saveDialogOpen,
    setSaveDialogOpen,
    reload,
    addPreset,
    removePreset,
  };
}