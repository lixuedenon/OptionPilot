import { useState, useEffect, useRef } from "react";
import { Settings2, X, Trash2, Star, Radar, Pencil, Check, GripVertical, FolderOpen } from "lucide-react";
import type { SavedStrategy } from "@/lib/savedStrategies";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  open: boolean;
  onClose: () => void;
  mode?: "open" | "track";
  strategies: SavedStrategy[];
  onOpen: (s: SavedStrategy) => void;
  onReorder: (all: SavedStrategy[]) => void;
  onRename: (id: string, filename: string) => void;
  onDelete: (id: string) => void;
  onToggleStar: (id: string) => void;
  onTrack: (s: SavedStrategy) => void;
}

export default function ManageStrategiesDialog({
  open, onClose, mode = "open", strategies, onOpen, onReorder, onRename, onDelete, onToggleStar, onTrack
}: Props) {
  const { t } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editRef.current) editRef.current.focus();
  }, [editingId]);

  if (!open) return null;

  const startEdit = (s: SavedStrategy) => {
    setEditingId(s.id);
    setEditValue(s.filename);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleDragStart = (i: number) => setDragIndex(i);
  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    setDragOverIndex(i);
  };
  const handleDrop = (i: number) => {
    if (dragIndex === null || dragIndex === i) return;
    const next = [...strategies];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(i, 0, moved);
    onReorder(next);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-[560px] flex-col rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 size={16} className="text-amber-400" />
            <h3 className="text-sm font-bold text-slate-100">{t("manage.title")}</h3>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">{strategies.length}</span>
          </div>
          <button onClick={onClose} className="text-slate-500 transition hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        <div className="mb-2 flex items-center gap-4 text-[9px] text-slate-600">
          {mode === "track" ? (
            <span className="flex items-center gap-1"><Radar size={10} />{t("manage.clickToTrack")}</span>
          ) : (
            <span className="flex items-center gap-1"><FolderOpen size={10} />{t("manage.clickToLoad")}</span>
          )}
          <span className="flex items-center gap-1"><GripVertical size={10} />{t("manage.dragToSort")}</span>
          <span className="flex items-center gap-1"><Pencil size={10} />{t("manage.rename")}</span>
          <span className="flex items-center gap-1"><Star size={10} />{t("manage.star")}</span>
          {mode === "open" && (
            <span className="flex items-center gap-1"><Radar size={10} />{t("manage.track")}</span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {strategies.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-slate-600">
              <span className="text-xs">{t("manage.empty")}</span>
            </div>
          ) : (
            strategies.map((s, i) => (
              <div
                key={s.id}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={() => handleDrop(i)}
                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                className={`group flex items-center gap-1.5 rounded-lg border px-2 py-2 transition ${
                  dragOverIndex === i && dragIndex !== null
                    ? "border-sky-500 bg-sky-950/30"
                    : "border-slate-800 bg-slate-800/40 hover:border-slate-700 hover:bg-slate-800/70"
                } ${dragIndex === i ? "opacity-40" : ""}`}
              >
                <GripVertical size={12} className="shrink-0 cursor-grab text-slate-600 hover:text-slate-400" />

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {editingId === s.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        ref={editRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="w-full rounded border border-sky-600 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 focus:outline-none"
                      />
                      <button onClick={commitEdit} className="shrink-0 rounded p-1 text-emerald-400 hover:bg-emerald-950/40">
                        <Check size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => (mode === "track" ? onTrack(s) : onOpen(s))}
                      title={mode === "track" ? t("manage.clickTrack") : t("manage.clickLoad")}
                      className="truncate text-left font-mono text-xs font-semibold text-slate-100 transition hover:text-sky-300"
                    >
                      {s.filename}
                    </button>
                  )}
                  <div className="flex gap-3 text-[10px] text-slate-500">
                    <span>{s.symbol || "—"}</span>
                    <span>{s.legs.length} {t("manage.legs")}</span>
                    <span>${s.spot.toFixed(2)}</span>
                    <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    onClick={() => onToggleStar(s.id)}
                    title={t("manage.star")}
                    className={`rounded p-1 transition hover:bg-amber-950/40 ${s.starred ? "text-amber-400" : "text-slate-600 hover:text-amber-500"}`}
                  >
                    <Star size={13} fill={s.starred ? "currentColor" : "none"} />
                  </button>
                  {mode === "open" && (
                    <button
                      onClick={() => onTrack(s)}
                      title={t("manage.trackTooltip")}
                      className={`rounded p-1 transition hover:bg-sky-950/40 ${s.tracking ? "text-sky-400" : "text-slate-600 hover:text-sky-500"}`}
                    >
                      <Radar size={13} />
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(s)}
                    title={t("manage.rename")}
                    disabled={editingId === s.id}
                    className="rounded p-1 text-slate-600 transition hover:bg-slate-700/40 hover:text-sky-400 disabled:opacity-30"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => onDelete(s.id)}
                    title={t("manage.deleteConfirm")}
                    className="rounded p-1 text-slate-600 transition hover:bg-rose-950/40 hover:text-rose-400"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            {t("manage.close")}
          </button>
        </div>
      </div>
    </div>
  );
}