import { useState, useEffect } from "react";
import { Save, X, AlertTriangle } from "lucide-react";
import type { Leg } from "@/lib/types";
import { generateFilename, findDuplicate, type SavedStrategy } from "@/lib/savedStrategies";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (filename: string) => void;
  onOverwrite: (id: string, filename: string) => void;
  symbol: string;
  direction: "buy" | "sell";
  strategyName: string;
  legs: Leg[];
  spot: number;
  shifts: { dS: number; dT: number; dV: number };
  openingAt: number;
  existing: SavedStrategy[];
}

export default function SaveStrategyDialog({
  open, onClose, onSave, onOverwrite, symbol, direction, strategyName, legs, spot, shifts, openingAt, existing,
}: Props) {
  const { t } = useI18n();
  const [filename, setFilename] = useState("");
  const [dup, setDup] = useState<SavedStrategy | null>(null);

  useEffect(() => {
    if (open) {
      setFilename(generateFilename(symbol, direction, strategyName, legs));
      setDup(null);
    }
  }, [open, symbol, direction, strategyName, legs]);

  if (!open) return null;

  const trySave = () => {
    if (!filename.trim()) return;
    const match = findDuplicate({ symbol, spot, legs, shifts }, existing);
    if (match) {
      setDup(match);
    } else {
      onSave(filename.trim());
    }
  };

  const confirmOverwrite = () => {
    if (dup) {
      onOverwrite(dup.id, filename.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-96 rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Save size={16} className="text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-100">{t("saveStrategy.title")}</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 transition hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        {dup ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-amber-600/50 bg-amber-950/30 px-3 py-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
              <div className="text-[11px] leading-relaxed text-amber-200">
                {t("saveStrategy.dupTitle")}<span className="font-mono font-semibold text-amber-100">{dup.filename}</span>
                <br />
                {dup.symbol} · {dup.legs.length} {t("manage.legs")} · {t("saveStrategy.dupDesc")}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDup(null)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                {t("saveStrategy.cancel")}
              </button>
              <button
                onClick={confirmOverwrite}
                className="flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-amber-500"
              >
                <Save size={12} /> {t("saveStrategy.overwrite")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("saveStrategy.filename")}</label>
            <input
              autoFocus
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") trySave();
              }}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
            />

            <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-[10px] text-slate-500">
              <div className="flex gap-4">
                <span>{t("saveStrategy.stock")}：<span className="text-slate-300">{symbol || "—"}</span></span>
                <span>{t("saveStrategy.direction")}：<span className={direction === "buy" ? "text-emerald-400" : "text-rose-400"}>{direction === "buy" ? t("saveStrategy.buy") : t("saveStrategy.sell")}</span></span>
                <span>{t("saveStrategy.legCount")}：<span className="text-slate-300">{legs.length}</span></span>
              </div>
              <div className="mt-1">
                {t("saveStrategy.strategy")}：<span className="text-slate-300">{strategyName || t("saveStrategy.noName")}</span>
              </div>
              <div className="mt-1 flex gap-4">
                <span>{t("saveStrategy.openingPrice")}：<span className="text-slate-300">{spot.toFixed(2)}</span></span>
                <span>{t("saveStrategy.openingDate")}：<span className="text-slate-300">{new Date(openingAt).toLocaleDateString()}</span></span>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                {t("saveStrategy.cancel")}
              </button>
              <button
                onClick={trySave}
                disabled={!filename.trim()}
                className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={12} /> {t("saveStrategy.save")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
