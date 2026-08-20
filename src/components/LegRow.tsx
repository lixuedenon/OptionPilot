import { useEffect, useMemo, useRef, useState } from "react";
import {
  MoreVertical,
  Ban,
  Trash2,
  BookmarkPlus,
  CalendarClock,
  Shield,
  Layers,
  GripVertical,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import type { Leg } from "@/lib/types";
import { dateFromDte, dteFromDate } from "@/lib/dateUtils";
import { fetchLegPremium, getOptionChain, premiumFromQuote, type OptionChainResponse } from "@/lib/optionChain";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  leg: Leg;
  index: number;
  scenarioPrice?: number;
  symbol?: string;
  onChange: (patch: Partial<Leg>) => void;
  onToggleDisable: () => void;
  onDelete: () => void;
  onAddToPreset: () => void;
  onRoll: () => void;
  onHedge: () => void;
  onProtect: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
  isDragOver: boolean;
}

const inp =
  "w-full rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none tabular-nums";
const inpDisabled =
  "w-full rounded border border-slate-700/40 bg-slate-800/60 px-1.5 py-1 text-xs text-slate-400 tabular-nums cursor-not-allowed";

function useClickOutside(active: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [active, onClose]);
  return ref;
}

function weekdayLabel(iso: string): string {
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  return `周${names[new Date(iso + "T00:00:00").getDay()]}`;
}

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function ToggleBtn({
  value,
  next,
  color,
  onClick,
  disabled,
}: {
  value: string;
  next: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? t("leg.blocked") : `${t("leg.clickSwitch")} ${next}`}
      className={`rounded px-2 py-1 text-[10px] font-bold uppercase text-white transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed ${color}`}
    >
      {value}
    </button>
  );
}

function NumField({
  label,
  value,
  step,
  width,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  step: number;
  width: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-0" style={{ width }}>
      <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        className={disabled ? inpDisabled : inp}
        type="number"
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(num(e.target.value))}
      />
    </label>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  tone?: "default" | "amber" | "rose" | "emerald" | "sky" | "violet";
}) {
  const toneCls = {
    default: "text-slate-300 hover:bg-slate-800",
    amber: "text-amber-400 hover:bg-amber-950/40",
    rose: "text-rose-400 hover:bg-rose-950/40",
    emerald: "text-emerald-400 hover:bg-emerald-950/40",
    sky: "text-sky-400 hover:bg-sky-950/40",
    violet: "text-violet-400 hover:bg-violet-950/40",
  }[tone];

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-[11px] transition ${toneCls}`}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className="text-[9px] text-slate-500">{hint}</span>
    </button>
  );
}

function LegMenu({
  disabled,
  onToggleDisable,
  onDelete,
  onAddToPreset,
  onRoll,
  onHedge,
  onProtect,
}: {
  disabled: boolean;
  onToggleDisable: () => void;
  onDelete: () => void;
  onAddToPreset: () => void;
  onRoll: () => void;
  onHedge: () => void;
  onProtect: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} className="relative ml-1 shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t("leg.more")}
        className="rounded p-1 text-slate-500 transition hover:bg-slate-700/40 hover:text-slate-300"
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
          <MenuItem icon={<BookmarkPlus size={12} />} label={t("leg.addToPreset")} hint={t("leg.all")} onClick={() => run(onAddToPreset)} tone="emerald" />
          <div className="my-0.5 border-t border-slate-800" />
          <MenuItem icon={<Ban size={12} />} label={disabled ? t("leg.unblock") : t("leg.block")} hint={t("leg.single")} onClick={() => run(onToggleDisable)} tone="amber" />
          <MenuItem icon={<Trash2 size={12} />} label={t("leg.delete")} hint={t("leg.single")} onClick={() => run(onDelete)} tone="rose" />
          <div className="my-0.5 border-t border-slate-800" />
          <MenuItem icon={<CalendarClock size={12} />} label={t("leg.roll")} hint={t("leg.single")} onClick={() => run(onRoll)} tone="sky" />
          <MenuItem icon={<Layers size={12} />} label={t("leg.hedge")} hint={t("leg.combo")} onClick={() => run(onHedge)} tone="violet" />
          <MenuItem icon={<Shield size={12} />} label={t("leg.protect")} hint={t("leg.single")} onClick={() => run(onProtect)} tone="sky" />
        </div>
      )}
    </div>
  );
}

export default function LegRow({
  leg,
  index,
  scenarioPrice,
  symbol,
  onChange,
  onToggleDisable,
  onDelete,
  onAddToPreset,
  onRoll,
  onHedge,
  onProtect,
  onDragStart,
  onDragEnter,
  onDragEnd,
  isDragging,
  isDragOver,
}: Props) {
  const { t } = useI18n();
  const disabled = leg.disabled === true;
  const [priceFetching, setPriceFetching] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [priceNote, setPriceNote] = useState<string | null>(null);
  const [chain, setChain] = useState<OptionChainResponse | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [strikeMenuOpen, setStrikeMenuOpen] = useState(false);
  const [expiryMenuOpen, setExpiryMenuOpen] = useState(false);

  const sym = symbol?.trim() ?? "";
  const canAutoPrice = leg.kind !== "stock" && !disabled && sym.length > 0;

  const strikeMenuRef = useClickOutside(strikeMenuOpen, () => setStrikeMenuOpen(false));
  const expiryMenuRef = useClickOutside(expiryMenuOpen, () => setExpiryMenuOpen(false));

  // Load the option chain for this symbol/expiry whenever either changes —
  // this is what backs both the strike dropdown and the expiry dropdown, so
  // the user picks from real, tradeable contracts instead of typing values
  // that may not exist.
  useEffect(() => {
    if (!canAutoPrice) {
      setChain(null);
      return;
    }
    if (leg.dte === undefined || leg.dte < 0) return;

    let cancelled = false;
    getOptionChain(sym, leg.dte)
      .then((c) => {
        if (!cancelled) {
          setChain(c);
          setChainError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setChain(null);
          setChainError(e instanceof Error ? e.message : t("leg.fetchPriceFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAutoPrice, sym, leg.dte]);

  const strikeOptions = useMemo(() => {
    if (!chain) return [];
    const rows = leg.type === "call" ? chain.calls : chain.puts;
    return [...rows].map((r) => r.strike).sort((a, b) => a - b);
  }, [chain, leg.type]);

  const expiryOptions = useMemo(() => {
    if (!chain) return [];
    return [...chain.expirationDates]
      .sort((a, b) => a - b)
      .map((epoch) => ({ epoch, iso: new Date(epoch * 1000).toISOString().slice(0, 10) }));
  }, [chain]);

  // Auto-fill premium once strike + expiry are both set, but only for a fresh
  // leg (premium still 0) — never silently overwrites a value the user (or a
  // preset) already set. Debounced so typing a strike doesn't fire a request
  // per keystroke.
  useEffect(() => {
    if (!canAutoPrice) return;
    if (leg.premium !== 0) return;
    if (!leg.strike || leg.strike <= 0) return;
    if (leg.dte === undefined || leg.dte < 0) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setPriceFetching(true);
      setPriceError(null);
      try {
        const result = await fetchLegPremium(sym, leg.type, leg.strike, leg.dte);
        if (cancelled) return;
        const patch: Partial<Leg> = { premium: result.premium };
        if (result.strikeSnapped) patch.strike = result.actualStrike;
        if (result.expirySnapped) patch.dte = result.actualDte;
        onChange(patch);
        setPriceNote(
          result.strikeSnapped || result.expirySnapped
            ? t("leg.priceSnapNote", { strike: result.actualStrike, date: result.actualExpiryDate })
            : null,
        );
      } catch (e) {
        if (!cancelled) setPriceError(e instanceof Error ? e.message : t("leg.fetchPriceFailed"));
      } finally {
        if (!cancelled) setPriceFetching(false);
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAutoPrice, sym, leg.strike, leg.dte, leg.type, leg.premium]);

  const handleRestorePrice = async () => {
    if (!canAutoPrice) return;
    setPriceFetching(true);
    setPriceError(null);
    try {
      const result = await fetchLegPremium(sym, leg.type, leg.strike, leg.dte, true);
      const patch: Partial<Leg> = { premium: result.premium };
      if (result.strikeSnapped) patch.strike = result.actualStrike;
      if (result.expirySnapped) patch.dte = result.actualDte;
      onChange(patch);
      setPriceNote(
        result.strikeSnapped || result.expirySnapped
          ? t("leg.priceSnapNote", { strike: result.actualStrike, date: result.actualExpiryDate })
          : null,
      );
    } catch (e) {
      setPriceError(e instanceof Error ? e.message : t("leg.fetchPriceFailed"));
    } finally {
      setPriceFetching(false);
    }
  };

  // Picking a strike from the real chain sets the premium instantly from
  // data already in hand — no extra network round trip needed.
  const handleSelectStrike = (strike: number) => {
    setStrikeMenuOpen(false);
    setPriceError(null);
    setPriceNote(null);
    const patch: Partial<Leg> = { strike };
    const rows = chain ? (leg.type === "call" ? chain.calls : chain.puts) : [];
    const q = rows.find((r) => r.strike === strike);
    if (q) {
      const premium = premiumFromQuote(q);
      if (premium > 0) patch.premium = premium;
    }
    onChange(patch);
  };

  // Picking an expiry resets premium to 0 so the existing auto-fill effect
  // fetches a fresh premium for whatever strike is (or gets) selected next.
  const handleSelectExpiry = (iso: string) => {
    setExpiryMenuOpen(false);
    setPriceError(null);
    setPriceNote(null);
    const d = dteFromDate(iso);
    if (d >= 0) onChange({ dte: d, premium: 0 });
  };

  const dragHandle = (
    <span
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      title={t("leg.dragSort")}
      className="cursor-grab text-slate-600 transition hover:text-slate-400 active:cursor-grabbing"
    >
      <GripVertical size={14} />
    </span>
  );

  const menu = (
    <LegMenu
      disabled={disabled}
      onToggleDisable={onToggleDisable}
      onDelete={onDelete}
      onAddToPreset={onAddToPreset}
      onRoll={onRoll}
      onHedge={onHedge}
      onProtect={onProtect}
    />
  );

  const dragOverCls = isDragOver ? "border-t-2 border-t-sky-500" : "";

  // Stock leg — compact row showing entry price and shares
  if (leg.kind === "stock") {
    return (
      <div
        className={`flex items-center gap-1 rounded border px-2 py-1.5 transition ${
          disabled
            ? "border-slate-700/50 bg-slate-900/40"
            : "border-amber-700/40 bg-amber-950/20"
        } ${isDragging ? "opacity-40" : ""} ${dragOverCls}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDragEnd}
      >
        {dragHandle}
        <span className="w-4 shrink-0 text-center text-[10px] font-semibold text-slate-500">{index + 1}</span>
        <div className="flex shrink-0 flex-col gap-0.5">
          <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{t("leg.type")}</span>
          <span className="rounded bg-amber-600 px-2 py-1 text-[10px] font-bold uppercase text-white">{t("hedge.stock")}</span>
        </div>
        <div className="flex shrink-0 flex-col gap-0.5">
          <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{t("leg.action")}</span>
          <ToggleBtn
            value={leg.action}
            next={leg.action === "buy" ? "sell" : "buy"}
            color={leg.action === "buy" ? "bg-emerald-600" : "bg-rose-600"}
            onClick={() => onChange({ action: leg.action === "buy" ? "sell" : "buy" })}
            disabled={disabled}
          />
        </div>
        <NumField label={t("leg.buyPrice")} value={leg.strike} step={0.5} width="72px" onChange={(v) => onChange({ strike: v })} disabled={disabled} />
        <NumField label={t("leg.sharesLabel")} value={leg.shares ?? 100} step={1} width="56px" onChange={(v) => onChange({ shares: v })} disabled={disabled} />
        <div className="flex flex-col gap-0.5">
          <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">Delta</span>
          <span className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold text-emerald-400">
            {leg.action === "buy" ? "+1.00" : "-1.00"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[9px] text-amber-500/70">{t("leg.stockNoPremium")}</span>
        </div>
        {menu}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1 rounded border px-2 py-1.5 transition ${
        disabled
          ? "border-slate-700/50 bg-slate-900/40"
          : "border-slate-800 bg-slate-900/60"
      } ${isDragging ? "opacity-40" : ""} ${dragOverCls}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDragEnd}
    >
      {dragHandle}
      <span className="w-4 shrink-0 text-center text-[10px] font-semibold text-slate-500">{index + 1}</span>

      <div className={`flex shrink-0 flex-col gap-0.5 ${disabled ? "opacity-40" : ""}`}>
        <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{t("leg.action")}</span>
        <ToggleBtn
          value={leg.action}
          next={leg.action === "buy" ? "sell" : "buy"}
          color={leg.action === "buy" ? "bg-emerald-600" : "bg-rose-600"}
          onClick={() => onChange({ action: leg.action === "buy" ? "sell" : "buy" })}
          disabled={disabled}
        />
      </div>

      <div className={`flex shrink-0 flex-col gap-0.5 ${disabled ? "opacity-40" : ""}`}>
        <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{t("leg.type")}</span>
        <ToggleBtn
          value={leg.type}
          next={leg.type === "call" ? "put" : "call"}
          color={leg.type === "call" ? "bg-sky-600" : "bg-violet-600"}
          onClick={() => {
            const next = leg.type === "call" ? "put" : "call";
            onChange({ type: next });
          }}
          disabled={disabled}
        />
      </div>

      <NumField
        label={t("leg.qty")}
        value={leg.qty ?? 1}
        step={1}
        width="38px"
        onChange={(v) => onChange({ qty: Math.max(1, Math.round(v)) })}
        disabled={disabled}
      />

      <div ref={strikeMenuRef} className="relative flex shrink-0 items-end gap-0.5">
        <NumField label={t("leg.strike")} value={leg.strike} step={0.5} width="86px" onChange={(v) => { setPriceError(null); setPriceNote(null); onChange({ strike: v }); }} disabled={disabled} />
        {!disabled && (
          <button
            onClick={() => setStrikeMenuOpen((v) => !v)}
            disabled={strikeOptions.length === 0}
            title={strikeOptions.length > 0 ? t("leg.pickStrike") : chainError ?? t("leg.noStrikeOptions")}
            className="mb-[1px] flex items-center rounded border border-slate-700 bg-slate-900 px-1 py-1 text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronDown size={11} />
          </button>
        )}
        {strikeMenuOpen && strikeOptions.length > 0 && (
          <div className="absolute left-0 top-full z-[80] mt-1 max-h-52 w-24 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
            {strikeOptions.map((s) => (
              <button
                key={s}
                onClick={() => handleSelectStrike(s)}
                className={`flex w-full items-center px-2 py-1 text-[11px] tabular-nums transition ${
                  s === leg.strike ? "bg-emerald-500/10 text-emerald-300" : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={expiryMenuRef} className="relative flex shrink-0 items-end gap-0.5">
        <div className="flex flex-col gap-0" style={{ width: "84px" }}>
          <span className="flex items-baseline gap-1 text-[8px] font-semibold uppercase tracking-wide text-slate-500">
            {t("leg.expiry")}
            <span className="text-[8px] font-medium normal-case text-amber-400/80">{t("leg.left")}{Math.round(leg.dte)}d</span>
          </span>
          <button
            type="button"
            onClick={() => !disabled && setExpiryMenuOpen((v) => !v)}
            disabled={disabled}
            className={`${disabled ? inpDisabled : inp} text-left`}
          >
            {dateFromDte(leg.dte)}
          </button>
        </div>
        {!disabled && (
          <button
            onClick={() => setExpiryMenuOpen((v) => !v)}
            disabled={expiryOptions.length === 0}
            title={expiryOptions.length > 0 ? t("leg.pickExpiry") : chainError ?? t("leg.noExpiryOptions")}
            className="mb-[1px] flex items-center rounded border border-slate-700 bg-slate-900 px-1 py-1 text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronDown size={11} />
          </button>
        )}
        {expiryMenuOpen && expiryOptions.length > 0 && (
          <div className="absolute left-0 top-full z-[80] mt-1 max-h-52 w-32 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
            {expiryOptions.map(({ epoch, iso }) => (
              <button
                key={epoch}
                onClick={() => handleSelectExpiry(iso)}
                className={`flex w-full items-center justify-between gap-2 px-2 py-1 text-[11px] tabular-nums transition ${
                  iso === dateFromDte(leg.dte) ? "bg-emerald-500/10 text-emerald-300" : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                <span>{iso}</span>
                <span className="text-[9px] text-slate-500">{weekdayLabel(iso)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-end gap-0.5">
        <NumField label={t("leg.premium")} value={leg.premium} step={0.01}  width="76px" onChange={(v) => { setPriceError(null); setPriceNote(null); onChange({ premium: v }); }} disabled={disabled} />
        {!disabled && (
          <button
            onClick={handleRestorePrice}
            disabled={priceFetching || !canAutoPrice}
            title={
              priceFetching
                ? t("leg.fetchingPrice")
                : priceError ?? priceNote ?? (canAutoPrice ? t("leg.restorePrice") : t("leg.noSymbolForPrice"))
            }
            className={`mb-[1px] flex items-center rounded border px-1 py-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${
              priceError
                ? "border-rose-700/50 bg-rose-950/30 text-rose-400"
                : priceNote
                ? "border-sky-700/50 bg-sky-950/30 text-sky-400"
                : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-200"
            }`}
          >
            <RefreshCw size={11} className={priceFetching ? "animate-spin" : ""} />
          </button>
        )}
      </div>

      {scenarioPrice !== undefined && !disabled && (
        <div className="flex shrink-0 flex-col gap-0.5" title={t("leg.scenarioValueHint")}>
          <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{t("leg.scenarioValue")}</span>
          <span className={`rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold tabular-nums ${scenarioPrice >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {scenarioPrice >= 0 ? "+" : ""}{scenarioPrice.toFixed(2)}
          </span>
        </div>
      )}

      {menu}
    </div>
  );
}