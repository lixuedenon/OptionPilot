const DB_NAME = "optionpilot_fsa";
const STORE = "handles";
const KEY = "backup_file";

let fileHandle: FileSystemFileHandle | null = null;
let permissionGranted = false;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(val: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(val, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function isAutoSyncSupported(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

export function isAutoSyncActive(): boolean {
  return fileHandle !== null && permissionGranted;
}

export async function getSyncedFileName(): Promise<string | null> {
  const handle = fileHandle ?? (await idbGet<FileSystemFileHandle>());
  return handle?.name ?? null;
}

async function verifyPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}

export interface LinkResult {
  ok: boolean;
  error?: string;
}

export async function linkBackupFile(): Promise<LinkResult> {
  if (!isAutoSyncSupported()) {
    return { ok: false, error: "当前浏览器不支持文件自动同步功能" };
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: "optionpilot_backup.json",
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
    });
    fileHandle = handle;
    permissionGranted = await verifyPermission(handle);
    if (permissionGranted) {
      await idbPut(handle);
      await autoSyncWrite();
      return { ok: true };
    }
    return { ok: false, error: "未获得文件写入权限" };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: "" }; // User cancelled — no error message
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `无法链接文件：${msg}` };
  }
}

export async function unlinkBackupFile(): Promise<void> {
  fileHandle = null;
  permissionGranted = false;
  await idbDelete();
}

export async function restoreHandle(): Promise<boolean> {
  try {
    const handle = await idbGet<FileSystemFileHandle>();
    if (!handle) return false;
    fileHandle = handle;
    permissionGranted = (await handle.queryPermission({ mode: "readwrite" })) === "granted";
    return true;
  } catch {
    return false;
  }
}

export async function requestSyncPermission(): Promise<boolean> {
  if (!fileHandle) return false;
  try {
    permissionGranted = await verifyPermission(fileHandle);
    if (permissionGranted) await autoSyncWrite();
    return permissionGranted;
  } catch {
    return false;
  }
}

export async function autoSyncWrite(): Promise<void> {
  if (!fileHandle || !permissionGranted) return;
  try {
    // Mirrors dataTransfer.ts's exportAllData — kept as a second copy rather
    // than importing it because this write is triggered by a lighter,
    // higher-frequency effect (see App.tsx's autoSyncName effect) and the
    // two intentionally serialize the exact same shape so a linked backup
    // file and a manual "export data" file stay interchangeable.
    const data = {
      version: 2,
      exportedAt: Date.now(),
      savedStrategies: JSON.parse(localStorage.getItem("optionpilot_saved_strategies") ?? "[]"),
      customPresets: JSON.parse(localStorage.getItem("optionpilot_custom_presets") ?? "[]"),
      recentSymbols: JSON.parse(localStorage.getItem("optionpilot_recent_symbols") ?? "[]"),
      simAccount: JSON.parse(localStorage.getItem("optionpilot_sim_account") ?? "null"),
      simPositions: JSON.parse(localStorage.getItem("optionpilot_sim_positions") ?? "[]"),
      simSnapshots: JSON.parse(localStorage.getItem("optionpilot_sim_snapshots") ?? "[]"),
    };
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  } catch {
    // File may be locked or unavailable — silently skip
  }
}