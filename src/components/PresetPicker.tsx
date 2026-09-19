// src/components/PresetPicker.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, TrendingUp, TrendingDown, Minus, Zap, Trash2, Star, AlertTriangle, ShieldAlert, Activity } from "lucide-react";
import type { PresetMeta, RiskLine, RiskSeverity } from "@/lib/presets";
import { PRESET_GROUPS } from "@/lib/presets";
import type { CustomPreset } from "@/lib/customPresets";
import type { Leg } from "@/lib/types";
import { useI18n } from "@/i18n/I18nContext";
import type { Lang } from "@/i18n/translations";
import type { LocalStr } from "@/lib/presets";
import { dirKeyMap } from "@/components/StrategyBadge";
import { PayoffSparkline } from "@/components/PayoffSparkline";

function ls(val: LocalStr | string, lang: Lang): string {
  return typeof val === "string" ? val : val[lang];
}

// A stock leg carries placeholder type/strike fields just to satisfy the Leg
// type (they're meaningless for kind:"stock") — never format them as if they
// were an option leg, or a short stock position renders as something like
// "卖 C100", which reads as a completely different (and wrong) strategy.
function legLabel(l: Leg, t: (key: string) => string): string {
  if (l.kind === "stock") {
    return l.action === "buy" ? t("preset.longStock") : t("preset.shortStock");
  }
  return `${l.action === "buy" ? t("leg.buy") : t("leg.sell")} ${l.type === "call" ? "C" : "P"}${l.strike}`;
}

interface Props {
  onSelect: (preset: PresetMeta) => void;
  customPresets: CustomPreset[];
  onDeleteCustom: (id: string) => void;
  // 2026-09-12: compare mode's "开仓组合" is a saved strategy's frozen
  // structure — applying a preset there would silently replace it (and,
  // worse, wipe the whole tracked session per App.tsx's onSelectPreset
  // guard), which xue confirmed should just be blocked outright rather than
  // routed through a confirm dialog. Shows the button grayed out with an
  // explanatory tooltip instead of hiding it — "展示框架+解释原因" per
  // CLAUDE.md's design principle 8.
  disabled?: boolean;
}

const dirColor: Record<string, string> = {
  "看涨":       "text-emerald-400",
  "看跌":       "text-rose-400",
  "看跌/中性":  "text-rose-300",
  "温和看涨":   "text-emerald-300",
  "温和看跌":   "text-rose-300",
  "中性":       "text-sky-400",
  "中性/震荡":  "text-sky-400",
  "中性/温和看涨": "text-sky-300",
  "双向波动":   "text-amber-400",
  "看涨/对冲":  "text-emerald-300",
};

const dirIcon: Record<string, React.ReactNode> = {
  "看涨":       <TrendingUp  size={10} />,
  "看跌":       <TrendingDown size={10} />,
  "看跌/中性":  <TrendingDown size={10} />,
  "温和看涨":   <TrendingUp  size={10} />,
  "温和看跌":   <TrendingDown size={10} />,
  "中性":       <Minus       size={10} />,
  "中性/震荡":  <Minus       size={10} />,
  "中性/温和看涨": <Minus    size={10} />,
  "双向波动":   <Zap         size={10} />,
  "看涨/对冲":  <TrendingUp  size={10} />,
};

// Risk-disclosure tier styling — kept in one place so every tooltip (built-in
// or custom) that ever grows a `risk` array renders it identically. Colors
// match the app's existing direction-badge palette (rose/amber/sky).
const riskTier: Record<RiskSeverity, { icon: React.ReactNode; text: string; bg: string; border: string }> = {
  danger: {
    icon: <AlertTriangle size={12} className="mt-px shrink-0 text-rose-400" />,
    text: "text-rose-200",
    bg: "bg-rose-400/10",
    border: "border-rose-400/25",
  },
  caution: {
    icon: <ShieldAlert size={12} className="mt-px shrink-0 text-amber-400" />,
    text: "text-amber-200",
    bg: "bg-amber-400/10",
    border: "border-amber-400/20",
  },
  info: {
    icon: <Activity size={12} className="mt-px shrink-0 text-sky-400" />,
    text: "text-sky-200",
    bg: "bg-sky-400/10",
    border: "border-sky-400/20",
  },
};

function RiskDisclosure({ risk, lang }: { risk: RiskLine[]; lang: Lang }) {
  const { t } = useI18n();
  if (!risk.length) return null;
  return (
    <div className="mt-2 border-t border-slate-800 pt-2">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{t("preset.risk")}</span>
      <div className="mt-1.5 flex flex-col gap-1">
        {risk.map((line, i) => {
          const tier = riskTier[line.severity];
          return (
            <div
              key={i}
              className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 ${tier.bg} ${tier.border}`}
            >
              {tier.icon}
              <p className={`text-[9.5px] leading-snug ${tier.text}`}>{ls(line.text, lang)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TooltipContent({ item }: { item: PresetMeta }) {
  const { t, lang } = useI18n();
  return (
    <div className="w-64 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-100">{ls(item.name, lang)}</span>
        <span className={`flex items-center gap-1 text-[10px] font-semibold ${dirColor[item.direction] ?? "text-slate-400"}`}>
          {dirIcon[item.direction]}
          {t(`dir.${dirKeyMap[item.direction] ?? "neutral"}`)}
        </span>
      </div>
      <p className="mb-2 text-[10px] leading-relaxed text-slate-400">{ls(item.desc, lang)}</p>
      <div className="mb-2">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{t("preset.payoff")}</span>
        <div className="mt-1">
          <PayoffSparkline legs={item.legs()} />
        </div>
      </div>
      <div className="space-y-1.5 border-t border-slate-800 pt-2">
        <div>
          <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{t("preset.market")}</span>
          <p className="mt-0.5 text-[10px] text-slate-300">{ls(item.market, lang)}</p>
        </div>
        <div>
          <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{t("preset.stocks")}</span>
          <p className="mt-0.5 text-[10px] text-slate-300">{ls(item.stocks, lang)}</p>
        </div>
        <div>
          <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{t("preset.legs")}</span>
          <p className="mt-0.5 text-[10px] text-slate-300">{item.legs().map(l => legLabel(l, t)).join("  /  ")}</p>
        </div>
      </div>
      {item.risk && <RiskDisclosure risk={item.risk} lang={lang} />}
    </div>
  );
}

export default function PresetPicker({ onSelect, customPresets, onDeleteCustom, disabled = false }: Props) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const tooltipStyle = useCallback((): React.CSSProperties => {
    const panel = panelRef.current;
    if (!panel) return { display: "none" };
    const rect = panel.getBoundingClientRect();
    const TW = 264;
    const TH = 560; // taller now that the risk-disclosure section and payoff sparkline are always shown
    let left = rect.right + 8;
    if (left + TW > window.innerWidth - 8) {
      left = rect.left - TW - 8;
    }
    const top = Math.min(rect.top, window.innerHeight - TH - 8);
    return { top: Math.max(8, top), left };
  }, []);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={disabled ? t("leg.disabledInCompare") : undefined}
        className={`flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
          disabled ? "text-slate-500" : "text-slate-300 hover:border-emerald-500/50 hover:text-slate-100"
        }`}
      >
        <span>{t("preset.presetBtn")}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div ref={panelRef} className="absolute right-0 top-full z-40 mt-1 w-60 rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
          style={{ maxHeight: "min(520px, 75vh)", overflowY: "auto" }}>

          {/* Built-in presets */}
          {PRESET_GROUPS.map((group) => (
            <div key={ls(group.group, "zh")}>
              <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 px-3 py-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{ls(group.group, lang)}</span>
              </div>
              {group.items.map((item) => (
                <div
                  key={ls(item.name, "zh")}
                  className="group relative"
                  onMouseEnter={() => setHovered(ls(item.name, "zh"))}
                  onMouseLeave={() => setHovered(null)}
                >
                  <button
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
                    onClick={() => { onSelect(item); setOpen(false); }}
                  >
                    <span>{ls(item.name, lang)}</span>
                    <span className={`flex items-center gap-0.5 text-[9px] font-semibold ${dirColor[item.direction] ?? "text-slate-400"}`}>
                      {dirIcon[item.direction]}
                      {t(`dir.${dirKeyMap[item.direction] ?? "neutral"}`)}
                    </span>
                  </button>
                  {hovered === ls(item.name, "zh") && (
                    <div className="pointer-events-none fixed z-[60]" style={tooltipStyle()}>
                      <TooltipContent item={item} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {/* Custom presets */}
          <div>
            <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-slate-800 bg-amber-950/40 px-3 py-1.5">
              <Star size={9} className="text-amber-400" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400">{t("preset.custom")}</span>
              {customPresets.length > 0 && (
                <span className="ml-auto rounded bg-amber-500/20 px-1.5 text-[8px] font-bold text-amber-300">{customPresets.length}</span>
              )}
            </div>

            {customPresets.length === 0 ? (
              <div className="px-3 py-3 text-center text-[10px] text-slate-600">
                {t("preset.noCustom")}
              </div>
            ) : (
              customPresets.map((cp) => (
                <div
                  key={cp.id}
                  className="group relative border-l-2 border-amber-500/60 bg-amber-950/10"
                  onMouseEnter={() => setHovered(cp.name)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <button
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] text-amber-200 transition hover:bg-amber-900/20 hover:text-amber-100"
                    onClick={() => {
                      onSelect({
                        name: { zh: cp.name, en: cp.name },
                        desc: { zh: cp.desc, en: cp.desc },
                        market: { zh: cp.market || "—", en: cp.market || "—" },
                        stocks: { zh: cp.stocks || "—", en: cp.stocks || "—" },
                        direction: cp.direction,
                        legs: () => cp.legs,
                      });
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{cp.name}</span>
                    <span className={`flex items-center gap-0.5 text-[9px] font-semibold ${dirColor[cp.direction] ?? "text-slate-400"}`}>
                      {dirIcon[cp.direction]}
                      {t(`dir.${dirKeyMap[cp.direction] ?? "neutral"}`)}
                    </span>
                  </button>

                  {/* Delete button */}
                  <button
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-600 opacity-0 transition hover:bg-rose-900/40 hover:text-rose-400 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCustom(cp.id);
                    }}
                    title={t("preset.deleteCustom")}
                  >
                    <Trash2 size={11} />
                  </button>

                  {hovered === cp.name && (
                    <div className="pointer-events-none fixed z-[60]" style={tooltipStyle()}>
                      <div className="w-64 rounded-lg border border-amber-700/60 bg-slate-900 p-3 shadow-xl">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="flex items-center gap-1 text-[11px] font-bold text-amber-200">
                            <Star size={10} className="text-amber-400" />
                            {cp.name}
                          </span>
                          <span className={`flex items-center gap-1 text-[10px] font-semibold ${dirColor[cp.direction] ?? "text-slate-400"}`}>
                            {dirIcon[cp.direction]}
                            {t(`dir.${dirKeyMap[cp.direction] ?? "neutral"}`)}
                          </span>
                        </div>
                        <p className="mb-2 text-[10px] leading-relaxed text-slate-400">{cp.desc}</p>
                        <div className="mb-2">
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{t("preset.payoff")}</span>
                          <div className="mt-1">
                            <PayoffSparkline legs={cp.legs} />
                          </div>
                        </div>
                        <div className="space-y-1.5 border-t border-slate-800 pt-2">
                          <div>
                            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{t("preset.market")}</span>
                            <p className="mt-0.5 text-[10px] text-slate-300">{cp.market || "—"}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{t("preset.stocks")}</span>
                            <p className="mt-0.5 text-[10px] text-slate-300">{cp.stocks || "—"}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{t("preset.legs")}</span>
                            <p className="mt-0.5 text-[10px] text-slate-300">{cp.legs.map(l => legLabel(l, t)).join("  /  ")}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}