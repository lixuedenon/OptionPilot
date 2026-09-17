// src/components/AppHeader.tsx
// src/components/AppHeader.tsx
import { RefreshCw, TrendingUp, TrendingDown, ChevronDown, HelpCircle } from "lucide-react";
import type { RefObject } from "react";
import type { PresetMeta } from "@/lib/presets";
import type { CustomPreset } from "@/lib/customPresets";
import type { StockQuote } from "@/lib/useStockQuote";
import PresetPicker from "@/components/PresetPicker";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import LiveClock from "@/components/LiveClock";
import { useI18n } from "@/i18n/I18nContext";

// This is the App.tsx split's first (lowest-risk) step — see the App.tsx
// split discussion. Pure JSX extraction: every value below is still owned
// and computed by App.tsx, just handed down as a prop instead of read from
// the enclosing closure. Nothing here decides anything App.tsx didn't
// already decide; this component only renders it and forwards clicks back
// up. The prop list is long because the header genuinely touches this much
// state (symbol, quote, presets, help, the leave-confirmation gate) — that
// surface area doesn't shrink by moving the JSX, only the line count of
// App.tsx does.
//
// The "数据" (export/import/auto-sync-file) dropdown that used to live here
// moved to HomePage.tsx's header, next to the language switcher (2026-09-06,
// xue's request — she wants data management reachable from the home screen,
// not duplicated inside both analysis and compare mode). App.tsx's
// useAutoSync() call is UNCHANGED and keeps writing to the linked backup
// file in the background while the user edits here; only the visible
// button/dropdown and its export/import/link/unlink actions moved.
interface Props {
  // navigation
  simOrigin?: boolean;
  onCancelSimOrigin?: () => void;
  onBackHome?: () => void;
  isCompareMode: boolean;
  canSaveStrategy: boolean;
  onRequestLeave: () => void; // opens ConfirmLeaveDialog — App.tsx still owns that dialog's rendering and outcome handlers

  // presets
  customPresets: CustomPreset[];
  onDeleteCustomPreset: (id: string) => void;
  onSelectPreset: (preset: PresetMeta) => void;

  // symbol / quote
  symbolWrapRef: RefObject<HTMLDivElement>;
  symbol: string;
  onSymbolChange: (v: string) => void;
  symbolDropdownOpen: boolean;
  onToggleSymbolDropdown: () => void;
  recentSymbols: string[];
  onPickRecentSymbol: (s: string) => void;
  quote: StockQuote | null;
  quoteLoading: boolean;
  quoteError: string | null;
  onRefetchQuote: () => void;
  priceChange: number | null;
  changePct: number | null;

  // help
  onOpenHelp: () => void;
}

export default function AppHeader({
  simOrigin,
  onCancelSimOrigin,
  onBackHome,
  isCompareMode,
  canSaveStrategy,
  onRequestLeave,
  customPresets,
  onDeleteCustomPreset,
  onSelectPreset,
  symbolWrapRef,
  symbol,
  onSymbolChange,
  symbolDropdownOpen,
  onToggleSymbolDropdown,
  recentSymbols,
  onPickRecentSymbol,
  quote,
  quoteLoading,
  quoteError,
  onRefetchQuote,
  priceChange,
  changePct,
  onOpenHelp,
}: Props) {
  const { t } = useI18n();

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-2">
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (simOrigin) { onCancelSimOrigin?.(); return; }
            if (!isCompareMode && canSaveStrategy) { onRequestLeave(); return; }
            onBackHome?.();
          }}
          disabled={!onBackHome && !onCancelSimOrigin}
          title={simOrigin ? t("sim.cancelOrigin") : t("home.backToHome")}
          className="flex items-center rounded transition enabled:hover:opacity-80 disabled:cursor-default"
        >
          <img
            src="/image copy 2.png"
            alt="OptionPilot"
            className="h-12 w-auto shrink-0 object-contain"
          />
        </button>

        <PresetPicker
          customPresets={customPresets}
          onDeleteCustom={onDeleteCustomPreset}
          onSelect={onSelectPreset}
          disabled={isCompareMode}
        />

        <div ref={symbolWrapRef} className="relative flex items-center gap-1.5">
          <span className="text-[10px] uppercase text-slate-500">{t("stock.code")}</span>
          <div className="flex items-center">
            <input
              placeholder="SPY"
              value={symbol}
              onChange={(e) => onSymbolChange(e.target.value.toUpperCase())}
              className="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
            <button
              onClick={onToggleSymbolDropdown}
              className="-ml-px rounded-r border border-l-0 border-slate-700 bg-slate-900 px-1 py-1 text-slate-500 transition hover:text-slate-300"
            >
              <ChevronDown size={12} />
            </button>
          </div>
          {symbolDropdownOpen && recentSymbols.length > 0 && (
            <div className="absolute left-0 top-full z-[90] mt-1 max-h-64 w-28 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
              {[...recentSymbols].sort((a, b) => a.localeCompare(b)).map((s) => (
                <button
                  key={s}
                  onClick={() => onPickRecentSymbol(s)}
                  className={`flex w-full items-center px-3 py-1.5 text-xs font-semibold transition ${
                    s === symbol ? "bg-emerald-500/10 text-emerald-300" : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
            onClick={onRefetchQuote}
            title={quoteError ?? (quote ? `${t("stock.live")} ${quote.source}` : t("stock.fetchHint"))}
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] transition hover:border-slate-500"
          >
            {quoteLoading ? (
              <RefreshCw size={11} className="animate-spin text-slate-400" />
            ) : quote ? (
              <span className="flex items-center gap-1">
                {quote.price >= quote.previousClose
                  ? <TrendingUp size={11} className="text-emerald-400" />
                  : <TrendingDown size={11} className="text-rose-400" />
                }
                <span className="font-semibold tabular-nums text-slate-200">{quote.price.toFixed(2)}</span>
              </span>
            ) : quoteError ? (
              <span className="text-rose-400">!</span>
            ) : (
              <RefreshCw size={11} className="text-slate-500" />
            )}
          </button>

          {priceChange !== null && changePct !== null ? (
            <div className="flex items-center gap-1 rounded border border-slate-800 bg-slate-900/40 px-2 py-1 text-[10px] tabular-nums">
              <span className={priceChange >= 0 ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)}
              </span>
              <span className={priceChange >= 0 ? "text-emerald-400/60" : "text-rose-400/60"}>
                ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
              </span>
            </div>
          ) : (
            <div className="w-[88px]" />
          )}
      </div>

      <div className="flex items-center gap-3">
        <LiveClock />
        <LanguageSwitcher />
        <button
          onClick={onOpenHelp}
          title={t("toolbar.help")}
          className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] font-semibold text-slate-400 transition hover:border-emerald-500/50 hover:text-emerald-300"
        >
          <HelpCircle size={12} />
          <span>{t("toolbar.help")}</span>
        </button>
      </div>
    </header>
  );
}
