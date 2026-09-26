// src/lib/dataTransfer.ts
import type { SavedStrategy } from "./savedStrategies";
import type { CustomPreset } from "./customPresets";
import type { SimAccount, SimPosition, PositionSnapshot } from "./simAccount";

export interface ExportData {
  version: 1 | 2;
  exportedAt: number;
  savedStrategies: SavedStrategy[];
  customPresets: CustomPreset[];
  recentSymbols: string[];
  // Added in version 2 — the simulated account (balance, open/closed
  // positions, daily mark-to-market snapshots) previously lived only in
  // localStorage and wasn't covered by backup/restore at all, so trading
  // history could silently disappear on a cache clear or browser switch.
  // Optional so version-1 backup files (and any restore of them) still work.
  simAccount?: SimAccount | null;
  simPositions?: SimPosition[];
  simSnapshots?: PositionSnapshot[];
}

// Reads every localStorage key this app backs up into one ExportData
// snapshot. Exported (2026-09-07) so autoSync.ts's autoSyncWrite() can call
// this instead of keeping its own second copy of the same six getItem/
// JSON.parse lines — that duplication was flagged as a real risk (a future
// schema change, e.g. a version-3 field, is easy to land in only one of the
// two copies, silently making manual "export data" backups and the
// auto-synced file diverge). Pure refactor: byte-for-byte the same object
// shape either call site produced before.
export function collectBackupPayload(): ExportData {
  return {
    version: 2,
    exportedAt: Date.now(),
    savedStrategies: JSON.parse(localStorage.getItem("optionpilot_saved_strategies") ?? "[]"),
    customPresets: JSON.parse(localStorage.getItem("optionpilot_custom_presets") ?? "[]"),
    recentSymbols: JSON.parse(localStorage.getItem("optionpilot_recent_symbols") ?? "[]"),
    simAccount: JSON.parse(localStorage.getItem("optionpilot_sim_account") ?? "null"),
    simPositions: JSON.parse(localStorage.getItem("optionpilot_sim_positions") ?? "[]"),
    simSnapshots: JSON.parse(localStorage.getItem("optionpilot_sim_snapshots") ?? "[]"),
  };
}

function backupTimestamp(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}` +
    `${String(d.getMonth() + 1).padStart(2, "0")}` +
    `${String(d.getDate()).padStart(2, "0")}` +
    `_${String(d.getHours()).padStart(2, "0")}` +
    `${String(d.getMinutes()).padStart(2, "0")}`
  );
}

export function exportAllData(): void {
  const data: ExportData = collectBackupPayload();

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `optionpilot_backup_${backupTimestamp()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  markBackedUp();
}

// ── 分享备份 + 备份提醒（2026-09-26，移动端第一步）────────────────────────
// 手机上File System Access API（autoSync.ts的"链接备份文件"）不可用，iOS
// Safari还会把7天未访问网站的localStorage清空，所以手机用户需要一个顺手的
// 备份方式：调用系统分享面板（Web Share API），用户选"邮件"就是把备份作为
// 附件发到自己邮箱，也可以选微信/网盘/"存储到文件"。不经过任何服务器。
//
// 文件用.txt/text/plain而不是.json：Chrome（安卓/Windows）的Web Share只允
// 许一份固定白名单里的文件类型，application/json不在里面，canShare会直接
// 返回false。内容仍然是同一份JSON，导入入口（HomePage.tsx）同时接受.txt。

const LAST_BACKUP_KEY = "optionpilot.lastBackupAt";
const REMINDER_SNOOZE_KEY = "optionpilot.backupReminderSnoozedAt";
const BACKUP_REMINDER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function readTs(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** 记录"刚刚完成了一次备份"——导出下载、分享成功、自动同步写文件成功都算。 */
export function markBackedUp(): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
  } catch {
    // 存储不可用时静默跳过，不影响备份本身
  }
}

export function getLastBackupAt(): number | null {
  return readTs(LAST_BACKUP_KEY);
}

/** 有没有值得备份的用户数据（空白的新用户不提醒）。 */
export function hasBackupableData(): boolean {
  const d = collectBackupPayload();
  return (
    d.savedStrategies.length > 0 ||
    d.customPresets.length > 0 ||
    d.simAccount != null ||
    (d.simPositions?.length ?? 0) > 0
  );
}

/** 距离上次备份（或上次点"稍后提醒"）超过7天、且确实有数据时返回true。 */
export function needsBackupReminder(now: number = Date.now()): boolean {
  if (!hasBackupableData()) return false;
  const last = Math.max(getLastBackupAt() ?? 0, readTs(REMINDER_SNOOZE_KEY) ?? 0);
  return now - last > BACKUP_REMINDER_DAYS * DAY_MS;
}

export function snoozeBackupReminder(): void {
  try {
    localStorage.setItem(REMINDER_SNOOZE_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

function buildBackupShareFile(): File {
  const data = collectBackupPayload();
  return new File([JSON.stringify(data, null, 2)], `optionpilot_backup_${backupTimestamp()}.txt`, {
    type: "text/plain",
  });
}

/** 当前浏览器能不能通过系统分享面板发送备份文件（手机基本都能，部分桌面浏览器不能）。 */
export function canShareBackup(): boolean {
  try {
    if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
    const probe = new File(["{}"], "probe.txt", { type: "text/plain" });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * 通过系统分享面板发送备份。浏览器不支持分享文件时退回普通下载。
 * 返回值：shared=已分享、downloaded=退回下载、cancelled=用户关掉了分享面板。
 */
export async function shareBackup(): Promise<"shared" | "downloaded" | "cancelled"> {
  if (!canShareBackup()) {
    exportAllData();
    return "downloaded";
  }
  try {
    await navigator.share({ files: [buildBackupShareFile()], title: "OptionPilot backup" });
    markBackedUp();
    return "shared";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    // 分享通道本身出错（少数浏览器canShare返回true但实际分享失败），退回下载
    exportAllData();
    return "downloaded";
  }
}

export async function importAllData(file: File): Promise<ExportData> {
  const text = await file.text();
  const parsed = JSON.parse(text) as ExportData;

  if (!parsed || typeof parsed !== "object" || (parsed.version !== 1 && parsed.version !== 2)) {
    throw new Error("文件格式不正确");
  }

  if (Array.isArray(parsed.savedStrategies)) {
    localStorage.setItem("optionpilot_saved_strategies", JSON.stringify(parsed.savedStrategies));
  }
  if (Array.isArray(parsed.customPresets)) {
    localStorage.setItem("optionpilot_custom_presets", JSON.stringify(parsed.customPresets));
  }
  if (Array.isArray(parsed.recentSymbols)) {
    localStorage.setItem("optionpilot_recent_symbols", JSON.stringify(parsed.recentSymbols));
  }
  // version-1 backups predate these fields entirely, so leave existing
  // simulated-account data untouched rather than wiping it on import.
  if (parsed.simAccount !== undefined) {
    localStorage.setItem("optionpilot_sim_account", JSON.stringify(parsed.simAccount));
  }
  if (Array.isArray(parsed.simPositions)) {
    localStorage.setItem("optionpilot_sim_positions", JSON.stringify(parsed.simPositions));
  }
  if (Array.isArray(parsed.simSnapshots)) {
    localStorage.setItem("optionpilot_sim_snapshots", JSON.stringify(parsed.simSnapshots));
  }

  return parsed;
}