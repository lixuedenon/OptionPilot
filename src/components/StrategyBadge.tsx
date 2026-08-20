import { useState, useRef } from "react";
import type { PresetMeta, LocalStr } from "@/lib/presets";
import { PRESET_GROUPS } from "@/lib/presets";
import type { CustomPreset } from "@/lib/customPresets";
import { useI18n } from "@/i18n/I18nContext";
import type { Lang } from "@/i18n/translations";

function ls(val: LocalStr | string, lang: Lang): string {
  return typeof val === "string" ? val : val[lang];
}

const dirKeyMap: Record<string, string> = {
  "看涨": "bullish", "看跌": "bearish", "看跌/中性": "bearishNeutral",
  "温和看涨": "mildBullish", "温和看跌": "mildBearish", "中性": "neutral",
  "中性/震荡": "neutralRange", "中性/温和看涨": "neutralMildBullish",
  "双向波动": "volatile", "看涨/对冲": "bullishHedge",
};

interface Props {
  name: string;
  customPresets: CustomPreset[];
}

export default function StrategyBadge({ name, customPresets }: Props) {
  const { t, lang } = useI18n();
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  const meta: PresetMeta | null =
    PRESET_GROUPS.flatMap((g) => g.items).find((i) => i.name.zh === name) ?? null;

  const custom = customPresets.find((c) => c.name === name) ?? null;

  const desc = meta ? ls(meta.desc, lang) : custom?.desc ?? null;
  const market = meta ? ls(meta.market, lang) : custom?.market ?? null;
  const stocks = meta ? ls(meta.stocks, lang) : custom?.stocks ?? null;
  const direction = meta?.direction ?? custom?.direction ?? null;
  const legs = meta?.legs() ?? custom?.legs ?? null;

  const displayName = meta ? ls(meta.name, lang) : name;

  return (
    <span
      ref={ref}
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="cursor-help rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
        {displayName}
      </span>
      {hover && desc && (
        <span className="pointer-events-none absolute left-0 top-full z-[100] mt-1 w-64 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl">
          <span className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-100">{displayName}</span>
            {direction && (
              <span className="text-[10px] font-semibold text-slate-400">{t(`dir.${dirKeyMap[direction] ?? "neutral"}`)}</span>
            )}
          </span>
          <span className="mb-2 block text-[10px] leading-relaxed text-slate-400">{desc}</span>
          {(market || stocks || legs) && (
            <span className="block space-y-1.5 border-t border-slate-800 pt-2">
              {market && (
                <span className="block">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{t("preset.market")}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-300">{market}</span>
                </span>
              )}
              {stocks && (
                <span className="block">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{t("preset.stocks")}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-300">{stocks}</span>
                </span>
              )}
              {legs && legs.length > 0 && (
                <span className="block">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{t("preset.legs")}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-300">
                    {legs.map((l) =>
                      `${l.action === "buy" ? t("leg.buy") : t("leg.sell")} ${l.type === "call" ? "C" : "P"}${l.strike}`
                    ).join("  /  ")}
                  </span>
                </span>
              )}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
