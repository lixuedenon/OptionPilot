// src/components/AppHeader.tsx
// src/components/AppHeader.tsx
import { RefreshCw, TrendingUp, TrendingDown, ChevronDown, HelpCircle, Target } from "lucide-react";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { PresetMeta } from "@/lib/presets";
import type { CustomPreset } from "@/lib/customPresets";
import type { StockQuote } from "@/lib/useStockQuote";
import type { EpsEstimate } from "@/hooks/useEpsEstimate";
import PresetPicker from "@/components/PresetPicker";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import LiveClock from "@/components/LiveClock";
import { useI18n } from "@/i18n/I18nContext";

// 2026-09-18新增：远期估值区间小徽章，点击展开popover——跟Term.tsx/
// PositionHealthBadge.tsx同一套"portal到body、按trigger位置算popover坐标、
// 点击外部关闭"机制，这里没有直接复用Term.tsx，是因为Term的两种视觉样式
// （下划线文字 / 纯图标圆按钮）都跟AppHeader其它徽章"方框+边框"的视觉不一
// 致，内容也是算出来的数字而不是一句静态文案，用Term的descVars插值不如
// 直接传结构化数据划算。就地实现，不额外建文件——这也是选择放在
// AppHeader.tsx而不是PayoffChart.tsx的原因之一：改动量留在这一个已经很小
// 的文件里。
function EpsValuationBadge({ estimate }: { estimate: EpsEstimate }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popoverWidth = 220;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8));
    setPos({ top: rect.bottom + 4, left });
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        btnRef.current && !btnRef.current.contains(target) &&
        popRef.current && !popRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title={t("valuation.tooltip")}
        className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-amber-300/80 transition hover:border-amber-500/50 hover:text-amber-300"
      >
        <Target size={11} />
      </button>

      {open && createPortal(
        <div
          ref={popRef}
          className="fixed z-[100] w-[220px] rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-2xl"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="mb-2 text-[11px] font-bold text-slate-200">{t("valuation.title")}</div>
          <div className="space-y-1">
            {estimate.ranges.map((r) => (
              <div key={r.period} className="flex items-center justify-between text-[11px] tabular-nums">
                <span className="text-slate-400">{t(r.period === "1y" ? "valuation.label1y" : "valuation.label2y")}</span>
                <span className="font-semibold text-slate-200">${r.low.toFixed(2)} - ${r.high.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 border-t border-slate-800 pt-2 text-[10px] leading-relaxed text-slate-500">
            {t("valuation.methodNote", {
              peLabel: t(estimate.peSource === "forward" ? "valuation.peForward" : "valuation.peTrailing"),
              pe: estimate.peMultiple,
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

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
  // 2026-09-24修复：这里以前还接一个`canSaveStrategy`，自己判断"要不要提
  // 示"——只看得到A（主combo）是否有未保存改动，看不到B/C（多方案对比槽
  // 位）。xue反馈"打开的对比组合有改动就该逐一提示，没改动就不提示"，这
  // 个判断必须同时看A和所有B/C，而B/C的状态只有App.tsx自己知道（见
  // useCompareSlots.ts的CompareSlot.baseline/isSlotDirty）。所以不再在这
  // 里做判断，退出图标点击时无条件调用`onRequestLeave`，由App.tsx的
  // requestLeave统一算"到底有没有东西没保存、需不需要弹、弹哪几个"——包
  // 括"什么都没改，直接调onBackHome、不弹任何东西"这个分支也移到那边了。
  // 2026-09-25再次修复：这个组件以前对isCompareMode（跟踪对比模式，不是
  // 上面说的A/B/C多方案对比）单独分支，点logo直接onBackHome、完全不检查
  // trackedLegs有没有未保存改动——对比模式下有未保存的持仓编辑，点logo
  // 会被无声丢弃，这本身是一个真实bug。现在不再区分isCompareMode，退出
  // 图标点击统一调用onRequestLeave，App.tsx的requestLeave内部自己按
  // isCompareMode分两条路径判断（跟踪对比模式看trackedDirty，分析模式看
  // A/B/C），这个组件不用再关心是哪种模式。
  onRequestLeave: () => void; // App.tsx still owns the confirm dialog(s)' rendering and outcome handlers

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

  // 2026-09-18新增：远期估值区间（分析师EPS预估区间 × 当前市盈率粗算），
  // 换标的代码后App.tsx里的useEpsEstimate会自动防抖拉取。estimate为null
  // 时（还没拉到/该标的没有分析师预估数据，比如大部分ETF）整个徽章不渲
  // 染，不占位置——这是个锦上添花的辅助信息，不是quote那类核心数据，没
  // 必要为了"缺失也要展示框架"占用header本就紧张的空间。
  epsEstimate: EpsEstimate | null;
  epsLoading: boolean;

  // help
  onOpenHelp: () => void;

  // 2026-09-17新增：分析模式情景滑块离开(0,0,0)时由App.tsx算出的
  // isExploring，锁定策略库选择器、标的代码输入框及其下拉——直到点击"重置"。
  locked?: boolean;
}

export default function AppHeader({
  simOrigin,
  onCancelSimOrigin,
  onBackHome,
  isCompareMode,
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
  epsEstimate,
  epsLoading,
  onOpenHelp,
  locked = false,
}: Props) {
  const { t } = useI18n();

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-2">
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (simOrigin) { onCancelSimOrigin?.(); return; }
            onRequestLeave();
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
          disabled={isCompareMode || locked}
        />

        <div ref={symbolWrapRef} className="relative flex items-center gap-1.5">
          <span className="text-[10px] uppercase text-slate-500">{t("stock.code")}</span>
          <div className="flex items-center">
            <input
              placeholder="SPY"
              value={symbol}
              onChange={(e) => onSymbolChange(e.target.value.toUpperCase())}
              disabled={locked}
              className="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            />
            <button
              onClick={onToggleSymbolDropdown}
              disabled={locked}
              className="-ml-px rounded-r border border-l-0 border-slate-700 bg-slate-900 px-1 py-1 text-slate-500 transition hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
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

          {epsLoading ? (
            <RefreshCw size={11} className="animate-spin text-slate-600" />
          ) : epsEstimate ? (
            <EpsValuationBadge estimate={epsEstimate} />
          ) : null}
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