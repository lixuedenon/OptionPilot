import { useState } from "react";
import { X, Save } from "lucide-react";
import type { Leg } from "@/lib/types";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    desc: string;
    market: string;
    stocks: string;
    direction: string;
  }) => void;
  legs: Leg[];
}

const DIRECTIONS = [
  "看涨", "温和看涨", "看跌", "温和看跌",
  "中性", "中性/震荡", "双向波动", "看跌/中性",
];

const dirKeys: Record<string, string> = {
  "看涨": "dir.bullish",
  "温和看涨": "dir.mildBullish",
  "看跌": "dir.bearish",
  "温和看跌": "dir.mildBearish",
  "中性": "dir.neutral",
  "中性/震荡": "dir.neutralRange",
  "双向波动": "dir.volatile",
  "看跌/中性": "dir.bearishNeutral",
};

export default function SavePresetDialog({ open, onClose, onSave, legs }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [market, setMarket] = useState("");
  const [stocks, setStocks] = useState("");
  const [direction, setDirection] = useState("中性");
  const [err, setErr] = useState("");

  if (!open) return null;

  const handleSave = () => {
    if (!name.trim()) { setErr(t("savePreset.errName")); return; }
    if (!desc.trim()) { setErr(t("savePreset.errDesc")); return; }
    if (legs.length === 0) { setErr(t("savePreset.errNoLegs")); return; }
    setErr("");
    onSave({ name: name.trim(), desc: desc.trim(), market: market.trim(), stocks: stocks.trim(), direction });
    setName(""); setDesc(""); setMarket(""); setStocks(""); setDirection("中性");
  };

  const inputCls = "w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-100 placeholder-slate-600 focus:border-amber-500 focus:outline-none";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[340px] rounded-xl border border-slate-700 bg-slate-950 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
            <Save size={14} className="text-amber-400" />
            {t("savePreset.title")}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2.5">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("savePreset.name")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("savePreset.namePlaceholder")} maxLength={30} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("savePreset.desc")}</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("savePreset.descPlaceholder")} rows={2} maxLength={200} className={inputCls + " resize-none"} />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("savePreset.market")}</label>
            <input value={market} onChange={(e) => setMarket(e.target.value)} placeholder={t("savePreset.marketPlaceholder")} maxLength={100} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("savePreset.stocks")}</label>
            <input value={stocks} onChange={(e) => setStocks(e.target.value)} placeholder={t("savePreset.stocksPlaceholder")} maxLength={100} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("savePreset.direction")}</label>
            <div className="flex flex-wrap gap-1">
              {DIRECTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDirection(d)}
                  className={`rounded px-2 py-1 text-[10px] font-semibold transition ${
                    direction === d
                      ? "bg-amber-500 text-slate-950"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {t(dirKeys[d] ?? d)}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-slate-900/50 px-2.5 py-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{t("savePreset.currentLegs")} ({legs.length})</span>
            <p className="mt-0.5 text-[10px] text-slate-400">
              {legs.map((l) => `${l.action === "buy" ? t("leg.buy") : t("leg.sell")} ${l.type === "call" ? "C" : "P"}${l.strike}`).join("  /  ")}
            </p>
          </div>

          {err && <p className="text-[10px] font-semibold text-rose-400">{err}</p>}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-400 hover:text-slate-200">
            {t("savePreset.cancel")}
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1 rounded bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-slate-950 transition hover:bg-amber-400"
          >
            <Save size={12} /> {t("savePreset.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
