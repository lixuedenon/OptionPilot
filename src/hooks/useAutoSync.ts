import { useCallback, useEffect, useState } from "react";
import {
  isAutoSyncSupported,
  linkBackupFile,
  unlinkBackupFile,
  restoreHandle,
  requestSyncPermission,
  autoSyncWrite,
  getSyncedFileName,
} from "@/lib/autoSync";
import type { LinkResult } from "@/lib/autoSync";
import { useI18n } from "@/i18n/I18nContext";

// Owns the "linked backup file" feature end to end: restoring the
// previously-linked file handle on mount, auto-writing to it whenever the
// data it tracks changes, and the link/unlink/sync-now actions.
//
// Fully self-contained — nothing here reaches into legs, tracking, or combo
// state, which is exactly why this was safe to pull out of App.tsx as a
// pure mechanical move. `deps` is whatever data should trigger a write; the
// caller decides what that is (currently savedStrategies/customPresets/
// recentSymbols, matching the original inline effect).
export function useAutoSync(deps: { savedStrategies: unknown; customPresets: unknown; recentSymbols: unknown }) {
  const { t } = useI18n();
  const [autoSyncName, setAutoSyncName] = useState<string | null>(null);
  const [autoSyncSupported] = useState(() => isAutoSyncSupported());
  const [autoSyncError, setAutoSyncError] = useState<string | null>(null);

  useEffect(() => {
    restoreHandle().then(async () => {
      setAutoSyncName(await getSyncedFileName());
    });
  }, []);

  useEffect(() => {
    if (autoSyncName) autoSyncWrite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.savedStrategies, deps.customPresets, deps.recentSymbols, autoSyncName]);

  const syncNow = useCallback(async () => {
    const ok = await requestSyncPermission();
    if (ok) {
      setAutoSyncError(null);
    } else {
      setAutoSyncError(t("toolbar.noWritePerm"));
    }
  }, [t]);

  const unlinkBackup = useCallback(async () => {
    await unlinkBackupFile();
    setAutoSyncName(null);
  }, []);

  const linkBackup = useCallback(async () => {
    const result: LinkResult = await linkBackupFile();
    if (result.ok) {
      setAutoSyncName(await getSyncedFileName());
      setAutoSyncError(null);
    } else if (result.error) {
      setAutoSyncError(result.error);
    }
  }, []);

  return {
    autoSyncName,
    autoSyncSupported,
    autoSyncError,
    setAutoSyncError,
    syncNow,
    unlinkBackup,
    linkBackup,
  };
}