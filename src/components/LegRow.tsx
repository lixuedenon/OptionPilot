// src/components/LegRow.tsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  MoreVertical,
  Ban,
  Trash2,
  LogOut,
  Undo2,
  Lock,
  BookmarkPlus,
  CalendarClock,
  Shield,
  Layers,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  GitCompare,
  HelpCircle,
} from "lucide-react";
import type { Leg } from "@/lib/types";
import { dateFromDte, dteFromDate } from "@/lib/dateUtils";
import { fetchLegPremium, getOptionChain, premiumFromQuote, type LegPremiumResult, type OptionChainResponse } from "@/lib/optionChain";
import { useI18n } from "@/i18n/I18nContext";
import { NUMBER_RULES, blockInvalidNumberKey, useClampedNumberField, type NumberInputRule } from "@/lib/numberInput";
import { useIsMobile } from "@/hooks/useIsMobile";
import { optionDelta, strikeForDelta } from "@/lib/legDelta";

interface Props {
  leg: Leg;
  index: number;
  scenarioPrice?: number;
  legPnl?: number;
  symbol?: string;
  // Current underlying price, used only to auto-scroll the strike-picker
  // dropdown so the strike closest to the money opens already centered in
  // view, instead of the list always opening scrolled to its lowest strike
  // — for a wide chain that's dozens of far-OTM rows away from anything
  // most people actually pick. Undefined/0 just skips the auto-scroll and
  // leaves the dropdown's default scroll position alone.
  spot?: number;
  // 这条腿在组合里的角色（legRoles.ts计算），显示在"..."菜单里。无法分类或已屏蔽的腿为undefined。
  roleInfo?: { label: string; explanation: string };
  // Compare mode's "开仓组合" (opening combo) rows are historical/fixed —
  // that data is supposed to match what analysis mode originally recorded,
  // not today's market, so there's nothing sensible for a "refresh price"
  // button to do there. Set by the caller (LegListSection) for those rows
  // to suppress the premium refresh button entirely, rather than giving it
  // a market-fetch behavior that doesn't apply. Undefined/false elsewhere
  // keeps the normal live-fetch behavior below.
  hidePriceRefresh?: boolean;
  // 这条腿所属策略的真实到期日已过（由App.tsx算好传入）。
  // ⚠️ 不能用leg.dte===0判断：过期腿的dte已被钳到0，照常请求期权链会静默换成另一张在市合约。
  // 为true时挡住期权链加载、自动拉价、手动刷新三条路径，显示"合约已过期"提示。
  expired?: boolean;
  // 这条腿通过展期/保护跟哪条腿配对（lib/legLinks.ts），配对的两条腿铺同色背景。
  linkInfo?: { role: "source" | "derived"; via: "roll" | "protect" | "hedge"; otherIndex: number; color: string };
  onChange: (patch: Partial<Leg>) => void;
  onToggleDisable: () => void;
  // 可选：对比模式"开仓组合"不传（结构锁定）。菜单项的文字/图标先看leg.derivedFrom（撤销），再看leg.closedPnl（已平仓），否则用deleteVariant。
  onDelete?: () => void;
  // 可选：B/C对比槽位不接"添加到预设"。菜单里只在传了时才显示该项。
  onAddToPreset?: () => void;
  onRoll?: () => void;
  onHedge?: () => void;
  onProtect?: () => void;
  onCompare?: () => void;
  // "delete" (default) renders 删除/Trash2/rose; "close" renders 平仓/
  // LogOut/sky — used by TrackedComboSection's "今日组合" rows, where
  // removing a leg means closing that part of the position, not deleting a
  // mistake. Ignored (overridden) when `leg.derivedFrom` or `leg.closedPnl`
  // is set — see deleteConfig below.
  deleteVariant?: "delete" | "close";
  // 排序用"..."菜单里的上移/下移，不用拖拽（拖拽会吞掉复选框的点击）。
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  // Batch selection. `selectable` hides the checkbox for rows that
  // shouldn't be selectable (e.g. the read-only "today's combo" in
  // tracking mode), defaulting to true.
  selected?: boolean;
  onToggleSelect?: () => void;
  selectable?: boolean;
  // 情景滑块离开原点时（App.tsx的isExploring）为true：暂停自动拉取市场权利金。
  // 界面上的锁定由App.tsx左侧整体的LockedOverlay负责，这里不再处理。
  locked?: boolean;
  // 今昔对比的持仓组合：方向/类型/张数/行权价/到期日锁住（换合约要走展期、平仓要走平仓，否则已实现盈亏会丢），权利金照常可改。
  contractLocked?: boolean;
  // 选行权价的方式（LegListSection"全选"旁的开关，2026-10-06）："delta"时行权价格子换成Delta输入，按期权链挑最接近的行权价。
  // 不传=自己选。showDelta：行权价标签旁显示这张期权的Delta（分析模式的开仓组合传true）。
  strikeMode?: "manual" | "delta";
  showDelta?: boolean;
}

// 按Delta选行权价的输入：填正数（0.30），Put的Delta显示成负的
const DELTA_RULE: NumberInputRule = { min: 0.01, max: 0.99, decimals: 2 };

const inp =
  "w-full rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none tabular-nums";
const inpDisabled =
  "w-full rounded border border-slate-700/40 bg-slate-800/60 px-1.5 py-1 text-xs text-slate-400 tabular-nums cursor-not-allowed";

// 窗口宽度≤1440px时收窄各列固定宽度和间距。整行所有列都是shrink-0（数字不能被截断/滚动，只能靠字号收缩），
// 所以窄窗口下要把列宽本身也收窄，否则整行会被挤到换行。阈值是粗略估计，不够就调这个数或各列宽度。
function useNarrowLegRow(breakpointPx = 1440): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= breakpointPx,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const handler = () => setNarrow(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpointPx]);
  return narrow;
}

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

// 按界面语言显示星期几（Intl），不要写死中文。
function weekdayLabel(iso: string, lang: string): string {
  const date = new Date(iso + "T00:00:00");
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { weekday: "short" }).format(date);
}

function ToggleBtn({
  value,
  next,
  color,
  onClick,
  disabled,
  compact,
}: {
  value: string;
  next: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
  // 窄窗口下切换按钮左右padding收窄。
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? t("leg.blocked") : `${t("leg.clickSwitch")} ${next}`}
      className={`rounded ${compact ? "px-1" : "px-2"} py-1 text-[10px] font-bold uppercase text-white transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed ${color}`}
    >
      {value}
    </button>
  );
}

// 字号自动收缩的公共公式，NumField和ValueBadge共用：宽度固定死、不能滚动，靠缩小字号放下长数字。
const SHRINK_BASE_FONT_PX = 12;
const SHRINK_MIN_FONT_PX = 7;
const SHRINK_CHAR_PX = 7.2; // 估宽一点：按6.6估时窄窗口下"227.5"这种会被裁掉最后一位
function shrinkFontSize(text: string, widthPx: number, innerPad = 12): number {
  const innerPx = widthPx - innerPad;
  const len = Math.max(text.length, 1);
  const fit = innerPx / (len * (SHRINK_CHAR_PX / SHRINK_BASE_FONT_PX));
  return Math.max(SHRINK_MIN_FONT_PX, Math.min(SHRINK_BASE_FONT_PX, fit));
}

// 只读的情景估值/腿位盈亏徽章：固定宽度+字号自动收缩，保证每行"..."菜单位置对齐。
function ValueBadge({
  label,
  value,
  width,
  title,
}: {
  label: string;
  value: number;
  width: string;
  title?: string;
}) {
  const text = `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
  const widthPx = parseFloat(width) || 64;
  const fontSize = shrinkFontSize(text, widthPx, 8);
  return (
    <div className="flex shrink-0 flex-col gap-0.5" style={{ width, minWidth: width }} title={title}>
      <span className="whitespace-nowrap text-[8px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span
        className={`block rounded border border-slate-700 bg-slate-800 px-1 py-1 text-center font-semibold tabular-nums ${value >= 0 ? "text-emerald-400" : "text-rose-400"}`}
        style={{ fontSize }}
      >
        {text}
      </span>
    </div>
  );
}

function NumField({
  label,
  value,
  step,
  width,
  onChange,
  disabled,
  title,
  rule,
}: {
  label: string;
  value: number;
  step: number;
  width: string;
  onChange: (v: number) => void;
  disabled?: boolean;
  title?: string;
  // 数值输入统一走useClampedNumberField（numberInput.ts），按传入的规则clamp。
  rule: NumberInputRule;
}) {

  const field = useClampedNumberField(value, rule, onChange);

  // ⚠️ 宽度固定（shrink-0+minWidth），不能被压缩，也不能靠横向滚动显示长数字（xue的硬性要求）；
  // 数字太长时由shrinkFontSize缩小字号。
  const widthPx = parseFloat(width) || 52;
  const fontSize = shrinkFontSize(field.text, widthPx, 12);

  return (
    <label className="relative flex shrink-0 flex-col gap-0" style={{ width, minWidth: width }} title={title}>
      <span className="whitespace-nowrap text-[8px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        className={disabled ? inpDisabled : inp}
        style={{ fontSize }}
        type="number"
        inputMode={rule.decimals > 0 ? "decimal" : "numeric"}
        step={step}
        min={rule.min}
        max={rule.max}
        value={field.text}
        disabled={disabled}
        onFocus={field.onFocus}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.onBlur}
        onKeyDown={(e) => {
          blockInvalidNumberKey(e, rule);
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onWheel={(e) => e.currentTarget.blur()}
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
  disabled = false,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  tone?: "default" | "amber" | "rose" | "emerald" | "sky" | "violet";
  disabled?: boolean;
  // Native tooltip, distinct from `hint` (the small always-visible "single
  // leg / whole combo" scope label) — used for the one case that needs a
  // longer explanation than that hint area can fit: a locked "撤销" item
  // (see deleteConfig's locked branch below), where hovering explains WHY
  // it's disabled instead of just leaving the person to guess.
  title?: string;
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
      disabled={disabled}
      title={title}
      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent ${toneCls}`}
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
  deleteConfig,
  onAddToPreset,
  onRoll,
  onHedge,
  onProtect,
  onCompare,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  roleInfo,
}: {
  disabled: boolean;
  onToggleDisable: () => void;
  onDelete?: () => void;
  deleteConfig: {
    icon: React.ReactNode;
    label: string;
    tone: "default" | "amber" | "rose" | "emerald" | "sky" | "violet";
    disabled?: boolean;
    hint?: string;
    title?: string;
  };
  onAddToPreset?: () => void;
  onRoll?: () => void;
  onHedge?: () => void;
  onProtect?: () => void;
  onCompare?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  roleInfo?: { label: string; explanation: string };
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // Separate from `open` — clicking "这条腿的作用" expands an explanation
  // block IN PLACE rather than closing the whole dropdown (closing would
  // defeat the point; the person wants to read it, not dismiss it), and
  // resets whenever the dropdown itself closes so it doesn't stay expanded
  // the next time this same row's menu is reopened for something else.
  const [showRole, setShowRole] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setShowRole(false);
  }, [open]);

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

  const showMove = onMoveUp !== undefined || onMoveDown !== undefined;
  const showRollGroup = onRoll !== undefined || onHedge !== undefined || onProtect !== undefined;

  return (
    <div ref={ref} className="relative ml-1 shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t("leg.more")}
        className="rounded p-1 text-slate-500 transition hover:bg-slate-700/40 hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500"
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div className={`absolute right-0 top-full z-50 mt-1 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl transition-all ${showRole ? "w-64" : "w-36"}`}>
          {showMove && (
            <>
              <MenuItem icon={<ChevronUp size={12} />} label={t("leg.moveUp")} hint={t("leg.single")} onClick={() => onMoveUp && run(onMoveUp)} disabled={!canMoveUp} />
              <MenuItem icon={<ChevronDown size={12} />} label={t("leg.moveDown")} hint={t("leg.single")} onClick={() => onMoveDown && run(onMoveDown)} disabled={!canMoveDown} />
              <div className="my-0.5 border-t border-slate-800" />
            </>
          )}
          {onAddToPreset && <MenuItem icon={<BookmarkPlus size={12} />} label={t("leg.addToPreset")} hint={t("leg.all")} onClick={() => run(onAddToPreset)} tone="emerald" />}
          <div className="my-0.5 border-t border-slate-800" />
          <MenuItem icon={<Ban size={12} />} label={disabled ? t("leg.unblock") : t("leg.block")} hint={t("leg.single")} onClick={() => run(onToggleDisable)} tone="amber" />
          {onDelete && (
            <MenuItem icon={deleteConfig.icon} label={deleteConfig.label} hint={deleteConfig.hint ?? t("leg.single")} title={deleteConfig.title} onClick={() => onDelete && run(onDelete)} tone={deleteConfig.tone} disabled={deleteConfig.disabled} />
          )}
          {showRollGroup && <div className="my-0.5 border-t border-slate-800" />}
          {onRoll && <MenuItem icon={<CalendarClock size={12} />} label={t("leg.roll")} hint={t("leg.single")} onClick={() => onRoll && run(onRoll)} tone="sky" />}
          {onHedge && <MenuItem icon={<Layers size={12} />} label={t("leg.hedge")} hint={t("leg.combo")} onClick={() => onHedge && run(onHedge)} tone="violet" />}
          {onProtect && <MenuItem icon={<Shield size={12} />} label={t("leg.protect")} hint={t("leg.single")} onClick={() => onProtect && run(onProtect)} tone="sky" />}
          {onCompare && (
            <>
              <div className="my-0.5 border-t border-slate-800" />
              <MenuItem icon={<GitCompare size={12} />} label={t("compare2.menuItem")} hint={t("leg.single")} onClick={() => run(onCompare)} tone="violet" />
            </>
          )}
          {roleInfo && (
            <>
              <div className="my-0.5 border-t border-slate-800" />
              <MenuItem icon={<HelpCircle size={12} />} label={t("leg.roleMenuItem")} hint={roleInfo.label} onClick={() => setShowRole((v) => !v)} tone="sky" />
              {showRole && (
                <div className="mx-2 mb-1.5 rounded bg-slate-800/60 px-2 py-1.5 text-[10px] leading-relaxed text-slate-300">
                  {roleInfo.explanation}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function LegRow({
  leg,
  index,
  contractLocked,
  scenarioPrice,
  legPnl,
  symbol,
  spot,
  roleInfo,
  hidePriceRefresh,
  expired,
  linkInfo,
  onChange,
  onToggleDisable,
  onDelete,
  onAddToPreset,
  onRoll,
  onHedge,
  onProtect,
  onCompare,
  deleteVariant = "delete",
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  selected = false,
  onToggleSelect,
  selectable = true,
  locked = false,
  strikeMode = "manual",
  showDelta = false,
}: Props) {
  const { t, lang } = useI18n();
  // 窄窗口收窄列宽，见useNarrowLegRow。
  const narrow = useNarrowLegRow();
  // 手机上一行放不下，拆成两行：第一行方向/类型/张数/行权价/到期日，第二行权利金/情景估值/盈亏/菜单
  // （靠一个basis-full的空元素换行）。到期日框在手机上用84px，否则日期会被挤成两行。
  const isMobile = useIsMobile();
  const disabled = leg.disabled === true;
  const fieldLocked = disabled || contractLocked === true;
  const lockTitle = contractLocked && !disabled ? t("leg.contractLocked") : undefined;
  const [priceFetching, setPriceFetching] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [priceNote, setPriceNote] = useState<string | null>(null);
  const [chain, setChain] = useState<OptionChainResponse | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [strikeMenuOpen, setStrikeMenuOpen] = useState(false);
  const [expiryMenuOpen, setExpiryMenuOpen] = useState(false);
  // Toggle state for the (non-compare-mode) premium refresh button: first
  // click fetches and shows today's market price, second click reverts to
  // whatever premium was showing right before that fetch — no network call
  // needed for the revert since it's just replaying a value already in
  // hand. `openingPremiumRef` holds that pre-fetch value; it's a ref rather
  // than state because writing it must never itself trigger a re-render.
  // Any OTHER path that changes premium (manual edit, picking a strike from
  // the chain, picking a new expiry) resets `priceView` back to "opening" —
  // otherwise a stale `openingPremiumRef` could get restored by a later
  // toggle click after the person has already moved on to a different
  // premium entirely.
  const [priceView, setPriceView] = useState<"opening" | "market">("opening");
  const openingPremiumRef = useRef<number | null>(null);
  // 手动刷新报价是异步的：回来时这一行可能已经不在了（切了快照/策略），就别再写回去。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const sym = symbol?.trim() ?? "";
  // 滑块离开原点时（locked）暂停自动拉价和手动刷新价格。
  const canAutoPrice = leg.kind !== "stock" && !disabled && !locked && !expired && sym.length > 0;

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

  // 这张期权本身的Delta（按这条腿的权利金反推IV）；权利金没填好时为null
  const legDeltaValue = useMemo(
    () => (leg.kind === "stock" || !spot ? null : optionDelta(leg, spot)),
    [leg, spot],
  );
  const deltaMode = strikeMode === "delta" && leg.kind !== "stock" && !fieldLocked;
  const handleDeltaInput = (target: number) => {
    setPriceNote(null);
    if (!chain || !spot) {
      setPriceError(t("leg.deltaNoChain"));
      return;
    }
    const hit = strikeForDelta(chain, leg.type, spot, leg.dte, target);
    if (!hit) {
      setPriceError(t("leg.deltaNoChain"));
      return;
    }
    setPriceError(null);
    if (hit.strike !== leg.strike) handleSelectStrike(hit.strike);
  };

  const strikeOptions = useMemo(() => {
    if (!chain) return [];
    const rows = leg.type === "call" ? chain.calls : chain.puts;
    return [...rows].map((r) => r.strike).sort((a, b) => a - b);
  }, [chain, leg.type]);

  // Whichever listed strike sits closest to the current underlying price —
  // used only to auto-scroll the dropdown below to it when opened; the
  // list itself stays in plain ascending order (easiest to scan), only the
  // starting scroll position changes.
  const nearestStrikeToSpot = useMemo(() => {
    if (!spot || spot <= 0 || strikeOptions.length === 0) return null;
    let best = strikeOptions[0];
    let bestDiff = Math.abs(best - spot);
    for (const s of strikeOptions) {
      const diff = Math.abs(s - spot);
      if (diff < bestDiff) {
        best = s;
        bestDiff = diff;
      }
    }
    return best;
  }, [strikeOptions, spot]);
  const strikeListRef = useRef<HTMLDivElement>(null);

  // Runs right after the dropdown mounts open, before paint, so the person
  // never sees it flash open at the top and then jump — same reasoning as
  // Term.tsx's own position effect.
  useLayoutEffect(() => {
    if (!strikeMenuOpen || nearestStrikeToSpot === null) return;
    const el = strikeListRef.current?.querySelector<HTMLButtonElement>(
      `[data-strike="${nearestStrikeToSpot}"]`,
    );
    el?.scrollIntoView({ block: "center" });
  }, [strikeMenuOpen, nearestStrikeToSpot]);

  const expiryOptions = useMemo(() => {
    if (!chain) return [];
    return [...chain.expirationDates]
      .sort((a, b) => a - b)
      .map((epoch) => ({ epoch, iso: new Date(epoch * 1000).toISOString().slice(0, 10) }));
  }, [chain]);

  // 自动拉价和手动刷新共用：把拉到的权利金（以及贴到最近真实合约时的行权价/dte）写回这条腿，发生贴靠时显示提示。
  const applyFetchedPremium = (result: LegPremiumResult) => {
    // 合约锁住时不允许贴到别的合约：行权价不同或到期日差2天以上就不写入（差1~2天只是日期取整，仍是同一张）。
    if (contractLocked && (result.strikeSnapped || Math.abs(result.actualDte - leg.dte) > 2)) {
      setPriceNote(null);
      setPriceError(t("leg.contractNoQuote"));
      return;
    }
    const patch: Partial<Leg> = { premium: result.premium };
    if (result.strikeSnapped) patch.strike = result.actualStrike;
    if (result.expirySnapped) patch.dte = result.actualDte;
    onChange(patch);
    setPriceNote(
      result.strikeSnapped || result.expirySnapped
        ? t("leg.priceSnapNote", { strike: result.actualStrike, date: result.actualExpiryDate })
        : null,
    );
  };

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
        applyFetchedPremium(result);
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

  // Opening -> market: remember the premium as it stands right now (before
  // the fetch overwrites it), then force-fetch today's live price exactly
  // like the old always-fetch button did. Market -> opening: no network
  // round trip — just replay the value we stashed on the way in.
  const handleTogglePrice = async () => {
    if (!canAutoPrice) return;

    if (priceView === "market") {
      setPriceError(null);
      setPriceNote(null);
      if (openingPremiumRef.current !== null) {
        onChange({ premium: openingPremiumRef.current });
      }
      setPriceView("opening");
      return;
    }

    openingPremiumRef.current = leg.premium;
    setPriceFetching(true);
    setPriceError(null);
    try {
      const result = await fetchLegPremium(sym, leg.type, leg.strike, leg.dte, true);
      if (!mountedRef.current) return;
      applyFetchedPremium(result);
      setPriceView("market");
    } catch (e) {
      if (!mountedRef.current) return;
      setPriceError(e instanceof Error ? e.message : t("leg.fetchPriceFailed"));
    } finally {
      if (mountedRef.current) setPriceFetching(false);
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
    setPriceView("opening");
    onChange(patch);
  };

  // Picking an expiry resets premium to 0 so the existing auto-fill effect
  // fetches a fresh premium for whatever strike is (or gets) selected next.
  const handleSelectExpiry = (iso: string) => {
    setExpiryMenuOpen(false);
    setPriceError(null);
    setPriceNote(null);
    const d = dteFromDate(iso);
    setPriceView("opening");
    if (d >= 0) onChange({ dte: d, premium: 0 });
  };

  // 选择复选框；selectable={false}的行放一个同宽空位保持对齐。
  // 手机上不做批量选择，不显示复选框。
  const selectHandle = isMobile ? null : selectable ? (
    <span className="flex w-4 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect?.()}
        title={t("leg.selectLeg")}
        className="h-3.5 w-3.5 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
      />
    </span>
  ) : (
    <span className="w-4 shrink-0" />
  );

  // 删除/平仓菜单项的显示，按优先级：
  // 1. leg.derivedFrom → 这条腿由展期/保护/对冲产生，删除=撤销该操作；已保存进快照后（derivedFrom.locked）禁用，不能再撤销。
  // 2. leg.closedPnl已设置 → 已平仓的腿，禁用（保留显示冻结的盈亏）。
  // 3. 其它 → 按deleteVariant显示"删除"或"平仓"。
  // 点击行为始终是调onDelete，只有文字/图标/是否禁用不同。
  const deleteConfig = (() => {
    if (leg.derivedFrom) {
      if (leg.derivedFrom.locked) {
        const lockedLabel =
          leg.derivedFrom.via === "roll" ? t("leg.rollLocked")
          : leg.derivedFrom.via === "protect" ? t("leg.protectLocked")
          : t("leg.hedgeLocked");
        return {
          icon: <Lock size={12} />,
          label: lockedLabel,
          tone: "default" as const,
          disabled: true,
          hint: t("leg.lockedShortHint"),
          title: t("leg.lockedHint"),
        };
      }
      switch (leg.derivedFrom.via) {
        case "roll":
          return { icon: <Undo2 size={12} />, label: t("leg.undoRoll"), tone: "amber" as const };
        case "protect":
          return { icon: <Undo2 size={12} />, label: t("leg.undoProtect"), tone: "amber" as const };
        case "hedge":
          return { icon: <Undo2 size={12} />, label: t("leg.undoHedge"), tone: "amber" as const };
      }
    }
    if (leg.closedPnl !== undefined) {
      return { icon: <Lock size={12} />, label: t("leg.alreadyClosed"), tone: "default" as const, disabled: true };
    }
    return deleteVariant === "close"
      ? { icon: <LogOut size={12} />, label: t("leg.closePosition"), tone: "sky" as const }
      : { icon: <Trash2 size={12} />, label: t("leg.delete"), tone: "rose" as const };
  })();

  // 展期/保护配对：一组配对的两条腿铺同一种颜色的背景（颜色见lib/legLinks.ts），鼠标悬停说明跟哪条腿配对。
  const linkStyle = linkInfo ? { backgroundColor: `${linkInfo.color}1f`, borderColor: `${linkInfo.color}73` } : undefined;
  const linkTitle = linkInfo
    ? t(
        linkInfo.via === "roll"
          ? linkInfo.role === "source" ? "leg.rollSourceHint" : "leg.rollDerivedHint"
          : linkInfo.via === "protect"
          ? linkInfo.role === "source" ? "leg.protectSourceHint" : "leg.protectDerivedHint"
          : linkInfo.role === "source" ? "leg.hedgeSourceHint" : "leg.hedgeDerivedHint",
        { index: linkInfo.otherIndex },
      )
    : undefined;

  const menu = (
    <LegMenu
      disabled={disabled}
      onToggleDisable={onToggleDisable}
      onDelete={onDelete}
      deleteConfig={deleteConfig}
      // 手机精简版：菜单只留屏蔽和删除/平仓，其余操作在电脑上做。
      onAddToPreset={isMobile ? undefined : onAddToPreset}
      onRoll={isMobile ? undefined : onRoll}
      onHedge={isMobile ? undefined : onHedge}
      onProtect={isMobile ? undefined : onProtect}
      onCompare={isMobile ? undefined : onCompare}
      onMoveUp={isMobile ? undefined : onMoveUp}
      onMoveDown={isMobile ? undefined : onMoveDown}
      canMoveUp={canMoveUp}
      canMoveDown={canMoveDown}
      roleInfo={isMobile ? undefined : roleInfo}
    />
  );

  // Stock leg — compact row showing entry price and shares
  if (leg.kind === "stock") {
    return (
      <div
        style={linkStyle}
        title={linkTitle}
        className={`flex items-center ${isMobile ? "flex-wrap gap-x-1 gap-y-1 px-1.5" : narrow ? "gap-0.5 px-1.5" : "gap-1 px-2"} rounded border py-1.5 transition ${
          disabled
            ? "border-slate-700/50 bg-slate-900/40"
            : "border-amber-700/40 bg-amber-950/20"
        }`}
      >
        <div className="flex shrink-0 items-center gap-0">
          {selectHandle}
          <span className="w-4 shrink-0 text-center text-[10px] font-semibold text-slate-500">{index + 1}</span>
        </div>
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
            disabled={fieldLocked}
            compact={narrow}
          />
        </div>
        <NumField label={t("leg.buyPrice")} value={leg.strike} step={0.5} width={isMobile ? "80px" : narrow ? "60px" : "72px"} onChange={(v) => onChange({ strike: v })} disabled={fieldLocked} title={lockTitle} rule={NUMBER_RULES.price} />
        <NumField label={t("leg.sharesLabel")} value={leg.shares ?? 100} step={1} width={isMobile ? "64px" : narrow ? "46px" : "56px"} onChange={(v) => onChange({ shares: v })} disabled={fieldLocked} title={lockTitle} rule={NUMBER_RULES.shares} />
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
      style={linkStyle}
      title={linkTitle}
      className={`flex items-center ${isMobile ? "flex-wrap gap-x-1 gap-y-1 px-1.5" : narrow ? "gap-0.5 px-1.5" : "gap-1 px-2"} rounded border py-1.5 transition ${
        disabled
          ? "border-slate-700/50 bg-slate-900/40"
          : "border-slate-800 bg-slate-900/60"
      }`}
    >
      {/* 复选框和腿号紧挨，给后面的列腾宽度 */}
      <div className="flex shrink-0 items-center gap-0">
        {selectHandle}
        <span className="w-4 shrink-0 text-center text-[10px] font-semibold text-slate-500">{index + 1}</span>
      </div>

      <div className={`flex shrink-0 flex-col gap-0.5 ${disabled ? "opacity-40" : ""}`} title={lockTitle}>
        <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{t("leg.action")}</span>
        <ToggleBtn
          value={leg.action}
          next={leg.action === "buy" ? "sell" : "buy"}
          color={leg.action === "buy" ? "bg-emerald-600" : "bg-rose-600"}
          onClick={() => onChange({ action: leg.action === "buy" ? "sell" : "buy" })}
          disabled={fieldLocked}
          compact={narrow}
        />
      </div>

      <div className={`flex shrink-0 flex-col gap-0.5 ${disabled ? "opacity-40" : ""}`} title={lockTitle}>
        <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{t("leg.type")}</span>
        <ToggleBtn
          value={leg.type}
          next={leg.type === "call" ? "put" : "call"}
          color={leg.type === "call" ? "bg-sky-600" : "bg-violet-600"}
          onClick={() => {
            const next = leg.type === "call" ? "put" : "call";
            onChange({ type: next });
          }}
          disabled={fieldLocked}
          compact={narrow}
        />
      </div>

      {/* 张数框38px（日常1~3位数），更长的数字靠字号收缩 */}
      <NumField
        label={t("leg.qty")}
        value={leg.qty ?? 1}
        step={1}
        width={isMobile ? "48px" : narrow ? "30px" : "38px"}
        onChange={(v) => onChange({ qty: v })}
        disabled={fieldLocked}
        title={lockTitle}
        rule={NUMBER_RULES.qty}
      />

      {isMobile && <div className="ml-auto">{menu}</div>}
      {isMobile && <div className="h-0 basis-full" aria-hidden />}
      <div ref={strikeMenuRef} className="relative flex shrink-0 items-end gap-0.5">
        {deltaMode ? (
          // 按Delta：格子里填Delta（正数），标签上显示挑到的行权价；宽度跟行权价格子一样，整行不变宽
          <NumField
            label={`Δ→${leg.strike}`}
            value={legDeltaValue != null ? Math.round(Math.abs(legDeltaValue) * 100) / 100 : 0.3}
            step={0.05}
            width={isMobile ? "72px" : narrow ? "44px" : "52px"}
            onChange={handleDeltaInput}
            title={t("leg.deltaInputHint", { k: leg.strike })}
            rule={DELTA_RULE}
          />
        ) : (
          <NumField
            label={showDelta && legDeltaValue != null ? `${t("leg.strike")} Δ${legDeltaValue.toFixed(2)}` : t("leg.strike")}
            value={leg.strike}
            step={0.5}
            width={isMobile ? "72px" : narrow ? "44px" : "52px"}
            onChange={(v) => { setPriceError(null); setPriceNote(null); onChange({ strike: v }); }}
            disabled={fieldLocked}
            title={lockTitle ?? (showDelta && legDeltaValue != null ? t("leg.deltaHint", { d: legDeltaValue.toFixed(2), p: Math.round(Math.abs(legDeltaValue) * 100) }) : undefined)}
            rule={NUMBER_RULES.price}
          />
        )}
        {!fieldLocked && !deltaMode && (
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
          <div ref={strikeListRef} className="absolute left-0 top-full z-[80] mt-1 max-h-52 w-24 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
            {strikeOptions.map((s) => (
              <button
                key={s}
                data-strike={s}
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
        <div className="flex flex-col gap-0" style={{ width: isMobile ? "104px" : narrow ? "70px" : "84px" }}>
          <span className="flex items-baseline gap-1 text-[8px] font-semibold uppercase tracking-wide text-slate-500">
            {t("leg.expiry")}
            <span className="text-[8px] font-medium normal-case text-amber-400/80">{t("leg.left")}{Math.round(leg.dte)}d</span>
          </span>
          <button
            type="button"
            onClick={() => !fieldLocked && setExpiryMenuOpen((v) => !v)}
            disabled={fieldLocked}
            title={lockTitle}
            className={`${fieldLocked ? inpDisabled : inp} text-left`}
          >
            {dateFromDte(leg.dte)}
          </button>
        </div>
        {!fieldLocked && !isMobile && (
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
                <span className="text-[9px] text-slate-500">{weekdayLabel(iso, lang)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-end gap-0.5">
        <NumField label={t("leg.premium")} value={leg.premium} step={0.01} width={isMobile ? "80px" : narrow ? "62px" : "76px"} onChange={(v) => { setPriceError(null); setPriceNote(null); setPriceView("opening"); onChange({ premium: v }); }} disabled={disabled} rule={NUMBER_RULES.premium} />
        {!disabled && !hidePriceRefresh && (
          <button
            onClick={handleTogglePrice}
            disabled={priceFetching || !canAutoPrice}
            title={
              priceFetching
                ? t("leg.fetchingPrice")
                : priceError ?? priceNote ?? (canAutoPrice
                  ? (priceView === "market" ? t("leg.showOpeningPrice") : t("leg.restorePrice"))
                  : expired ? t("leg.contractExpiredNoPrice") : t("leg.noSymbolForPrice"))
            }
            className={`mb-[1px] flex items-center rounded border px-1 py-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${
              priceError
                ? "border-rose-700/50 bg-rose-950/30 text-rose-400"
                : priceNote
                ? "border-sky-700/50 bg-sky-950/30 text-sky-400"
                : priceView === "market"
                ? "border-emerald-700/50 bg-emerald-950/20 text-emerald-400 hover:border-emerald-500"
                : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-200"
            }`}
          >
            <RefreshCw size={11} className={priceFetching ? "animate-spin" : ""} />
          </button>
        )}
      </div>

      {/* 固定宽度，保证各行"..."菜单对齐 */}
      {scenarioPrice !== undefined && !disabled && !isMobile && (
        <ValueBadge label={t("leg.scenarioValue")} value={scenarioPrice} width={narrow ? "46px" : "56px"} title={t("leg.scenarioValueHint")} />
      )}

      {(() => {
        // A closed leg has no live per-leg P&L any more (it's excluded from
        // the active-legs calculation that produces `legPnl` — see
        // useComboAnalytics.ts's trackedLegPnlById), so this falls back to
        // the frozen `closedPnl` snapshot taken the instant it was closed,
        // and relabels the box so it reads as "已实现" rather than the
        // live "腿位盈亏" — the number itself won't move again either way,
        // but the label is what tells the person why.
        const displayPnl = legPnl ?? leg.closedPnl;
        if (displayPnl === undefined || isMobile) return null;
        const closed = leg.closedPnl !== undefined;
        return (
          <ValueBadge
            label={closed ? t("leg.closedPnlLabel") : t("leg.legPnl")}
            value={displayPnl}
            width={narrow ? "46px" : "56px"}
            title={closed ? t("leg.closedPnlHint") : t("leg.legPnlHint")}
          />
        );
      })()}

      {!isMobile && menu}
    </div>
  );
}