// src/components/AppHeader.tsx
import { RefreshCw, TrendingUp, TrendingDown, ChevronDown, Download, Upload, FileSymlink, Unlink, X, Database, HelpCircle, GitCompare, History } from "lucide-react";
import type { RefObject } from "react";
import type { PresetMeta } from "@/lib/presets";
import type { CustomPreset } from "@/lib/customPresets";
import type { StockQuote } from "@/lib/useStockQuote";
import type { SavedStrategy } from "@/lib/savedStrategies";
import PresetPicker from "@/components/PresetPicker";
import DropdownMenu from "@/components/DropdownMenu";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { exportAllData, importAllData } from "@/lib/dataTransfer";
import { useI18n } from "@/i18n/I18nContext";

// This is the App.tsx split's first (lowest-risk) step — see the App.tsx
// split discussion. Pure JSX extraction: every value below is still owned
// and computed by App.tsx, just handed down as a prop instead of read from
// the enclosing closure. Nothing here decides anything App.tsx didn't
// already decide; this component only renders it and forwards clicks back
// up. The prop list is long because the header genuinely touches this much
// state (symbol, quote, presets, data-sync, help, the leave-confirmation
// gate) — that surface area doesn't shrink by moving the JSX, only the
// line count of App.tsx does.
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

  // analysis ↔ compare mode switch — moved here (between the preset picker
  // and the symbol field) per xue's request; used to live in the leg
  // panel's title row (LegPanelTitleRow.tsx), which still owns the
  // "对比模式" badge but no longer the switch controls themselves.
  legsCount: number;
  trackedStrategy: SavedStrategy | undefined;
  onSwitchToCompare: () => void;
  onSwitchToAnalysis: (source: "baseline" | "current" | string) => void;

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

  // data sync menu
  autoSyncSupported: boolean;
  autoSyncName: string | null;
  autoSyncError: string | null;
  onDismissAutoSyncError: () => void;
  onSyncNow: () => void;
  onUnlinkBackup: () => void;
  onLinkBackup: () => void;
  onReloadData: () => Promise<void>;

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
  legsCount,
  trackedStrategy,
  onSwitchToCompare,
  onSwitchToAnalysis,
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
  autoSyncSupported,
  autoSyncName,
  autoSyncError,
  onDismissAutoSyncError,
  onSyncNow,
  onUnlinkBackup,
  onLinkBackup,
  onReloadData,
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
        />

        {!simOrigin && !isCompareMode && legsCount > 0 && (
          <button
            onClick={onSwitchToCompare}
            title={t("leg.switchToCompareHint")}
            className="flex shrink-0 items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] font-semibold text-sky-400 transition hover:border-sky-500/50"
          >
            <GitCompare size={11} />
            {t("leg.switchToCompare")}
          </button>
        )}
        {!simOrigin && isCompareMode && (
          <DropdownMenu label={t("leg.switchToAnalysis")} icon={<GitCompare size={11} />} menuClassName="w-64">
            {(close) => (
              <>
                <button
                  onClick={() => { close(); onSwitchToAnalysis("baseline"); }}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-[11px] text-slate-300 transition hover:bg-slate-800"
                >
                  <span className="font-semibold">{t("leg.switchSourceBaseline")}</span>
                  <span className="text-[9px] text-slate-500">{t("leg.switchSourceBaselineHint")}</span>
                </button>
                <button
                  onClick={() => { close(); onSwitchToAnalysis("current"); }}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-[11px] text-slate-300 transition hover:bg-slate-800"
                >
                  <span className="font-semibold">{t("leg.switchSourceCurrent")}</span>
                  <span className="text-[9px] text-slate-500">{t("leg.switchSourceCurrentHint")}</span>
                </button>
                {(trackedStrategy?.trackedSnapshots?.length ?? 0) > 0 && (
                  <>
                    <div className="my-1 border-t border-slate-800" />
                    <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-600">{t("leg.switchSourceSnapshot")}</div>
                    {trackedStrategy!.trackedSnapshots!.map((sn, idx) => (
                      <button
                        key={sn.id}
                        onClick={() => { close(); onSwitchToAnalysis(sn.id); }}
                        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-slate-300 transition hover:bg-slate-800"
                      >
                        <History size={11} className="text-sky-500" />
                        #{idx + 1} {new Date(sn.savedAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </DropdownMenu>
        )}

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

        <DropdownMenu
          label={t("toolbar.dataLabel")}
          icon={<Database size={11} />}
          menuClassName="w-56"
        >
          {(close) => (
            <>
              {autoSyncSupported && (
                <>
                  <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("toolbar.fileLink")}
                  </div>
                  {autoSyncName ? (
                    <>
                      <div className="mx-2 mb-1 truncate rounded bg-slate-800 px-2 py-1 text-[10px] text-emerald-400" title={autoSyncName}>
                        <FileSymlink size={10} className="mr-1 inline" />{autoSyncName}
                      </div>
                      <button
                        onClick={onSyncNow}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
                      >
                        <RefreshCw size={12} className="text-sky-400" /> {t("toolbar.syncNow")}
                      </button>
                      <button
                        onClick={onUnlinkBackup}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-rose-400 transition hover:bg-rose-950/40"
                      >
                        <Unlink size={12} /> {t("toolbar.unlink")}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={onLinkBackup}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
                    >
                      <FileSymlink size={12} className="text-emerald-400" /> {t("toolbar.linkBackup")}
                    </button>
                  )}
                  <div className="my-1 border-t border-slate-800" />
                </>
              )}
              <button
                onClick={() => { close(); exportAllData(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
              >
                <Download size={12} className="text-sky-400" /> {t("toolbar.exportData")}
              </button>
              <label className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-800">
                <Upload size={12} className="text-sky-400" /> {t("toolbar.importData")}
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={async (e) => {
                    close();
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      await importAllData(file);
                      await onReloadData();
                    } catch {
                      window.alert(t("toolbar.importFail"));
                    }
                    e.target.value = "";
                  }}
                />
              </label>
            </>
          )}
        </DropdownMenu>
        <LanguageSwitcher />
        <button
          onClick={onOpenHelp}
          title={t("toolbar.help")}
          className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] font-semibold text-slate-400 transition hover:border-emerald-500/50 hover:text-emerald-300"
        >
          <HelpCircle size={12} />
          <span>{t("toolbar.help")}</span>
        </button>
        {autoSyncError && (
          <div className="absolute right-2 top-full mt-1 z-50 max-w-xs rounded-lg border border-rose-700 bg-rose-950/90 px-3 py-2 text-[11px] text-rose-300 shadow-xl">
            {autoSyncError}
            <button
              onClick={onDismissAutoSyncError}
              className="ml-2 text-rose-500 hover:text-rose-300"
            >
              <X size={11} className="inline" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
