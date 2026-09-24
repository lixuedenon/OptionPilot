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
  // What this specific leg is doing in the combo (主力腿/保护腿/etc, computed
  // across the whole leg list by legRoles.ts) — shown inside the "..."
  // menu rather than a separate always-visible panel, per Xue's request:
  // folded into the existing menu saves space and keeps the leg row itself
  // uncluttered, rather than adding a permanent header-level element.
  // Undefined for a disabled leg (legRoles.ts only classifies active legs)
  // or when it can't be confidently classified.
  roleInfo?: { label: string; explanation: string };
  // Compare mode's "开仓组合" (opening combo) rows are historical/fixed —
  // that data is supposed to match what analysis mode originally recorded,
  // not today's market, so there's nothing sensible for a "refresh price"
  // button to do there. Set by the caller (LegListSection) for those rows
  // to suppress the premium refresh button entirely, rather than giving it
  // a market-fetch behavior that doesn't apply. Undefined/false elsewhere
  // keeps the normal live-fetch behavior below.
  hidePriceRefresh?: boolean;
  // 2026-09-17新增：这条腿所属的策略"真实到期日"已经过去（真实经过天数超
  // 过了当初完整周期——App.tsx里的openingSimBasis.daysSinceOpen >
  // originalMaxDte，跟isExpiredOpening/ExpiredStrategyDialog同一个判断）。
  // 已经真实到期的合约在Yahoo链上已经找不到了——但此时leg.dte早被
  // handleOpenStrategy/handleTrack的Math.max(0,...)钳到了0（"今天到
  // 期"），如果照样去发起fetchLegPremium/getOptionChain(sym,
  // 0)，请求会静默snap到"今天"附近某个完全不同的、当前真实挂牌的合约上
  // ——不会报错，只在priceNote里露一行不起眼的"已调整为XX/XX"，很容易被
  // 忽略，等于给这条已经不存在的腿悄悄换了张完全不同的合约再定价。所以
  // 这个已过期不能靠"leg.dte===0"本身判断（正常今天到期的合约dte也是
  // 0），必须由调用方（App.tsx）算好了传进来。设为true时连同
  // hidePriceRefresh一起挡住三条路径：策略/行权价下拉菜单背后那次链加
  // 载、premium===0时的自动填充、以及"恢复市场价"手动刷新——统一显示
  // leg.contractExpiredNoPrice提示，而不是静默换合约。
  expired?: boolean;
  // Which leg(s), if any, this one was created from or gave rise to via
  // Roll/Protect/Hedge — see lib/legLinks.ts and types.ts's
  // `Leg.derivedFrom`. Drives the small pairing badge next to the leg
  // index so more than one roll/protect/hedge on the board doesn't turn
  // into guesswork about which rows go together (xue: "否则很容易乱") —
  // the badge shows the paired leg's own number directly, not just in a
  // hover tooltip, so multiple simultaneous pairs stay distinguishable at
  // a glance instead of all looking like the same generic icon.
  linkInfo?: { role: "source" | "derived"; via: "roll" | "protect" | "hedge"; otherIndex: number };
  onChange: (patch: Partial<Leg>) => void;
  onToggleDisable: () => void;
  // Optional: compare mode's "开仓组合" rows pass neither delete nor
  // roll/hedge/protect — the opening combo's structure is locked there
  // (see App.tsx's compare-mode leg toolbar). When provided, the label/
  // icon/tone shown for it is resolved from `leg.derivedFrom` first (an
  // "撤销展期/保护/对冲" undo action), then from `leg.closedPnl` (an
  // already-closed leg, shown but no longer actionable), and falls back to
  // `deleteVariant` otherwise — see the deleteConfig logic below.
  onDelete?: () => void;
  // 2026-09-23起可选：跟onRoll/onHedge/onProtect同一类——对比槽位
  // （ComboCompareSlots.tsx的B/C候选方案）v1故意不接"添加到预设"这个动
  // 作（那套流程是给主combo的SavePresetDialog设计的），之前这个字段是
  // 必填的，调用方漏传时typecheck能抓出来，但vite build不做类型检查，
  // 运行时onAddToPreset会是undefined，用户在B/C槽位点开某条腿的菜单选
  // "添加到预设"会直接抛"onAddToPreset is not a function"崩溃。
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
  // Reordering — buttons in the "..." menu rather than drag-and-drop.
  // (An earlier version tried making the selection checkbox double as a
  // drag handle to save row width, but browsers treat a mousedown inside a
  // draggable ancestor as the start of a drag gesture even when it lands on
  // a checkbox, which silently ate the click and made the checkbox
  // unselectable. Buttons avoid that conflict entirely.)
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
  // 2026-09-17新增：分析模式情景滑块（ΔS/ΔT/ΔV）离开静止点(0,0,0)时由
  // App.tsx算出的isExploring，向下传到每个LegRow，锁定所有可编辑字段/菜单
  // 操作——直到用户点击"重置"把滑块归位。跟`disabled`(=leg.disabled，用户
  // 主动屏蔽某条腿)是两个独立概念，两者都要锁的字段用`fieldsDisabled`合并
  // 判断；只影响某条腿显示/隐藏(如"已屏蔽"灰色样式)的地方仍只看`disabled`。
  locked?: boolean;
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

// Locale-aware weekday abbreviation ("周一" in zh, "Mon" in en) via the
// browser's own Intl formatter rather than a hardcoded Chinese lookup
// table — the earlier version always returned "周X" regardless of UI
// language, so the English interface was showing Chinese weekday labels
// next to expiry dates in the strike/expiry picker dropdown.
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
  rule,
}: {
  label: string;
  value: number;
  step: number;
  width: string;
  onChange: (v: number) => void;
  disabled?: boolean;
  // 2026-09-24新增：行权价/权利金/数量/股数四类调用点各自传各自的规则
  // （NUMBER_RULES.price/premium/qty/shares），onChange前统一clamp到
  // [min,max]区间+按小数位数四舍五入。这是LegRow.tsx里数值输入完全没
  // 有上限/负数防护这个系统性缺口的修复——之前行权价输负数会让
  // bs.ts的Black-Scholes公式算出NaN，一路传染到整个组合定价。
  rule: NumberInputRule;
}) {
  // 2026-09-22移除：这里以前自己叠一层遮罩、点击锁定态的输入框弹提示
  // ("请先点重置")。现在这个反馈已经上移到容器级——LegListSection.tsx/
  // ComboCompareSlots.tsx用LockedOverlay包住整个combo容器，点锁定态下
  // 容器里任意位置都会弹同样的提示，层级比这里高，点击会被那层先拦
  // 截，这里的遮罩+提示永远轮不到、是打不到的死代码，所以直接删掉。
  // disabled状态本身（灰置、input.disabled）还在，只是不再自己接住点击。

  // 2026-09-24修复"输入多位数就卡死"的bug：之前每次keystroke都直接
  // `onChange(clampToRule(num(e.target.value), rule))`，而input是完全受控
  // 的（`value={value}`）。清空框准备输入新数字时解析成0，`clampToRule`
  // 立刻把它钉回rule.min（比如qty是1、价格是0.01），框内瞬间变回"1"，用
  // 户接下来敲的每个数字都接在这个意外冒出来的"1"后面，清空-弹回-清空-
  // 弹回，感觉就是"卡死了打不进去"；打小数（比如"12."）时同理，trailing
  // "."被每次keystroke的clamp立刻吃掉。修复统一收进`useClampedNumberField`
  // （见numberInput.ts），全项目所有同类数值输入框都改用这一个hook，不
  // 再各自重复实现，同一时刻只有一份权威逻辑（CLAUDE.md"五、19"）。
  const field = useClampedNumberField(value, rule, onChange);

  // 2026-09-24修复：这个label之前没有`shrink-0`，是这一整行里唯一一个
  // 会被flexbox压缩的元素——张数框打进很长的数字时，整行内容变宽，浏览
  // 器会把没有shrink-0的这一项挤扁（其它列全部有shrink-0，见调用方），
  // 挤到只剩几像素宽，"张数"两个字因为容器太窄换行变成竖排、输入框里的
  // 数字也看不到。这里补上shrink-0+minWidth，让这一列的宽度永远钉死在
  // width这个值，不会因为内容变化被压缩。
  //
  // 2026-09-24二次修复：上一版这里写的是"数字比框宽时原生input支持横向
  // 滚动查看"——被xue指出这就是变相的滚动，跟"容器尺寸固定死、不能靠
  // 滚动看内容"这条硬性要求是同一个问题，不能这么做。改成：框的宽度
  // (width/minWidth)保持不变，改由字号跟着输入内容的字符数动态收缩，
  // 保证任意长度的数字都能完整地、不滚动地显示在这个固定宽度的框里。
  // BASE_FONT_PX是未收缩时的字号（对应原来text-xs=12px），CHAR_PX是
  // tabular-nums数字在12px字号下的实测宽度近似值，MIN_FONT_PX是收缩下限
  // （再小就不可读了，理论上极端情况下数字仍可能略微溢出，但rule.max
  // 已经在数值层面钉死了每类字段的最大位数，实际不会走到这一步）。
  const BASE_FONT_PX = 12;
  const MIN_FONT_PX = 7;
  const CHAR_PX = 6.6;
  const widthPx = parseFloat(width) || 52;
  const innerPx = widthPx - 12; // 扣掉input左右padding(px-1.5=6px*2)+边框
  const fontSize = (() => {
    const len = Math.max(field.text.length, 1);
    const fit = innerPx / (len * (CHAR_PX / BASE_FONT_PX));
    return Math.max(MIN_FONT_PX, Math.min(BASE_FONT_PX, fit));
  })();

  return (
    <label className="relative flex shrink-0 flex-col gap-0" style={{ width, minWidth: width }}>
      <span className="whitespace-nowrap text-[8px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        className={disabled ? inpDisabled : inp}
        style={{ fontSize }}
        type="number"
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
  locked,
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
  // See Props.locked on LegRow above — disables the "..." trigger itself
  // so none of the menu's actions (block/delete/roll/hedge/…) are reachable
  // while a scenario slider is off its rest position.
  locked?: boolean;
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
        disabled={locked}
        title={locked ? t("leg.blocked") : t("leg.more")}
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
}: Props) {
  const { t, lang } = useI18n();
  const disabled = leg.disabled === true;
  // Combined gate for anything that would actually change this leg's data —
  // see Props.locked's comment. `disabled` alone still drives the "已屏蔽"
  // visual/hide-affordance branches below, unchanged.
  const fieldsDisabled = disabled || locked;
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

  const sym = symbol?.trim() ?? "";
  // `!locked` here suspends BOTH the auto-fill debounce effect below and the
  // manual refresh-price toggle while a scenario slider is off rest — a
  // queued market-price fetch must not land on a leg the user can't see
  // being edited right now. (2026-09-17, part of the slider input-lock.)
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

  // Shared by the auto-fill effect and handleTogglePrice below — both fetch
  // a premium via fetchLegPremium and need to do the exact same thing with
  // the result: patch premium (+ strike/dte if the request snapped to the
  // nearest real chain entry) back onto the leg, and surface a note when a
  // snap happened. Pulled out after this logic was found copy-pasted
  // identically in both places (2026-09-17 dead-code audit).
  const applyFetchedPremium = (result: LegPremiumResult) => {
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
      applyFetchedPremium(result);
      setPriceView("market");
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

  // The drag-to-reorder handle and the selection checkbox share one slot:
  // Selection checkbox. Reordering now lives in the "..." menu (move
  // up/down) instead of drag-and-drop — an earlier version tried making
  // this checkbox double as a drag handle to save space, but a mousedown
  // inside a `draggable` ancestor gets claimed by the browser's native drag
  // gesture even when it lands on a checkbox, which silently swallowed the
  // click and made selection unusable. Rows that opt out of selection
  // (selectable={false}) render nothing here — there's no drag affordance
  // to show any more, so an empty slot keeps columns aligned.
  const selectHandle = selectable ? (
    <span className="flex w-4 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect?.()}
        disabled={locked}
        title={t("leg.selectLeg")}
        className="h-3.5 w-3.5 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
      />
    </span>
  ) : (
    <span className="w-4 shrink-0" />
  );

  // What the delete/close menu item actually does, and how it's labeled —
  // resolved in priority order:
  // 1. `leg.derivedFrom` set → this leg was created by a Roll/Protect/
  //    Hedge, so removing it means undoing that action (the `onDelete`
  //    handler already carries the compound revert logic — see
  //    useLegEditing.ts's deleteLeg/closeTrackedLeg). Locked (1a) once that
  //    action has been captured into a saved snapshot — see types.ts's
  //    comment on `derivedFrom.locked` — in which case the item is shown
  //    disabled instead of actionable, so the record that was just saved
  //    can't be silently invalidated by an undo a moment later.
  // 2. `leg.closedPnl !== undefined` (and no derivedFrom) → this is an
  //    organic leg that's already been closed (平仓) — shown so the row
  //    stays visible with its frozen P&L (see the legPnl fallback below),
  //    but there's nothing further to do here, so the item is disabled
  //    rather than able to silently re-freeze at 0 (a closed leg has no
  //    live P&L to read any more — see closeTrackedLeg's own guard).
  // 3. Otherwise → the plain `deleteVariant` prop ("delete" or "close").
  // The click behavior itself never changes (always just calls
  // `onDelete`); only the label/icon/tone/disabled state do, so the menu
  // tells the person what will actually happen instead of always saying
  // "删除" for what might really be an undo or a no-op.
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

  // Small pairing badge next to the leg index — see linkInfo's own comment
  // on the Props interface above. "source" (the original leg a roll/
  // protect points away from) and "derived" (the new leg it points to) get
  // the same icon (keyed by `via`) but different tone, and both show the
  // OTHER leg's own number right in the badge (not just in the tooltip) —
  // so two separate roll pairs on the board (e.g. #1↔#5 and #2↔#6) stay
  // tellable apart at a glance instead of showing as identical icons that
  // only differ once you hover to read the tooltip text.
  const linkBadge = linkInfo && (
    <span
      className={`flex shrink-0 items-center gap-0.5 ${linkInfo.role === "source" ? "text-slate-500" : "text-amber-400"}`}
      title={t(
        linkInfo.via === "roll"
          ? linkInfo.role === "source" ? "leg.rollSourceHint" : "leg.rollDerivedHint"
          : linkInfo.via === "protect"
          ? linkInfo.role === "source" ? "leg.protectSourceHint" : "leg.protectDerivedHint"
          : linkInfo.role === "source" ? "leg.hedgeSourceHint" : "leg.hedgeDerivedHint",
        { index: linkInfo.otherIndex },
      )}
    >
      {linkInfo.via === "roll" ? <CalendarClock size={10} /> : linkInfo.via === "protect" ? <Shield size={10} /> : <Layers size={10} />}
      <span className="text-[8px] font-bold tabular-nums">{linkInfo.otherIndex}</span>
    </span>
  );

  const menu = (
    <LegMenu
      disabled={disabled}
      locked={locked}
      onToggleDisable={onToggleDisable}
      onDelete={onDelete}
      deleteConfig={deleteConfig}
      onAddToPreset={onAddToPreset}
      onRoll={onRoll}
      onHedge={onHedge}
      onProtect={onProtect}
      onCompare={onCompare}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      canMoveUp={canMoveUp}
      canMoveDown={canMoveDown}
      roleInfo={roleInfo}
    />
  );

  // Stock leg — compact row showing entry price and shares
  if (leg.kind === "stock") {
    return (
      <div
        className={`flex items-center gap-1 rounded border px-2 py-1.5 transition ${
          disabled
            ? "border-slate-700/50 bg-slate-900/40"
            : "border-amber-700/40 bg-amber-950/20"
        }`}
      >
        {selectHandle}
        <span className="w-4 shrink-0 text-center text-[10px] font-semibold text-slate-500">{index + 1}</span>
        {linkBadge}
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
            disabled={fieldsDisabled}
          />
        </div>
        <NumField label={t("leg.buyPrice")} value={leg.strike} step={0.5} width="72px" onChange={(v) => onChange({ strike: v })} disabled={fieldsDisabled} rule={NUMBER_RULES.price} />
        <NumField label={t("leg.sharesLabel")} value={leg.shares ?? 100} step={1} width="56px" onChange={(v) => onChange({ shares: v })} disabled={fieldsDisabled} rule={NUMBER_RULES.shares} />
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
      }`}
    >
      {selectHandle}
      <span className="w-4 shrink-0 text-center text-[10px] font-semibold text-slate-500">{index + 1}</span>
      {linkBadge}

      <div className={`flex shrink-0 flex-col gap-0.5 ${disabled ? "opacity-40" : ""}`}>
        <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{t("leg.action")}</span>
        <ToggleBtn
          value={leg.action}
          next={leg.action === "buy" ? "sell" : "buy"}
          color={leg.action === "buy" ? "bg-emerald-600" : "bg-rose-600"}
          onClick={() => onChange({ action: leg.action === "buy" ? "sell" : "buy" })}
          disabled={fieldsDisabled}
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
          disabled={fieldsDisabled}
        />
      </div>

      <NumField
        label={t("leg.qty")}
        value={leg.qty ?? 1}
        step={1}
        width="52px"
        onChange={(v) => onChange({ qty: v })}
        disabled={fieldsDisabled}
        rule={NUMBER_RULES.qty}
      />

      <div ref={strikeMenuRef} className="relative flex shrink-0 items-end gap-0.5">
        <NumField label={t("leg.strike")} value={leg.strike} step={0.5} width="52px" onChange={(v) => { setPriceError(null); setPriceNote(null); onChange({ strike: v }); }} disabled={fieldsDisabled} rule={NUMBER_RULES.price} />
        {!disabled && (
          <button
            onClick={() => setStrikeMenuOpen((v) => !v)}
            disabled={strikeOptions.length === 0 || locked}
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
        <div className="flex flex-col gap-0" style={{ width: "84px" }}>
          <span className="flex items-baseline gap-1 text-[8px] font-semibold uppercase tracking-wide text-slate-500">
            {t("leg.expiry")}
            <span className="text-[8px] font-medium normal-case text-amber-400/80">{t("leg.left")}{Math.round(leg.dte)}d</span>
          </span>
          <button
            type="button"
            onClick={() => !fieldsDisabled && setExpiryMenuOpen((v) => !v)}
            disabled={fieldsDisabled}
            className={`${fieldsDisabled ? inpDisabled : inp} text-left`}
          >
            {dateFromDte(leg.dte)}
          </button>
        </div>
        {!disabled && (
          <button
            onClick={() => setExpiryMenuOpen((v) => !v)}
            disabled={expiryOptions.length === 0 || locked}
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
        <NumField label={t("leg.premium")} value={leg.premium} step={0.01}  width="76px" onChange={(v) => { setPriceError(null); setPriceNote(null); setPriceView("opening"); onChange({ premium: v }); }} disabled={fieldsDisabled} rule={NUMBER_RULES.premium} />
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

      {scenarioPrice !== undefined && !disabled && (
        <div className="flex shrink-0 flex-col gap-0.5" title={t("leg.scenarioValueHint")}>
          <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{t("leg.scenarioValue")}</span>
          <span className={`rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold tabular-nums ${scenarioPrice >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {scenarioPrice >= 0 ? "+" : ""}{scenarioPrice.toFixed(2)}
          </span>
        </div>
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
        if (displayPnl === undefined) return null;
        const closed = leg.closedPnl !== undefined;
        return (
          <div className="flex shrink-0 flex-col gap-0.5" title={closed ? t("leg.closedPnlHint") : t("leg.legPnlHint")}>
            <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{closed ? t("leg.closedPnlLabel") : t("leg.legPnl")}</span>
            <span className={`rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold tabular-nums ${displayPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {displayPnl >= 0 ? "+" : ""}{displayPnl.toFixed(2)}
            </span>
          </div>
        );
      })()}

      {menu}
    </div>
  );
}