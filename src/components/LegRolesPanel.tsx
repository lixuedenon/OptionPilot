// src/components/LegRolesPanel.tsx
import { useState } from "react";
import { HelpCircle } from "lucide-react";
import type { Leg } from "@/lib/types";
import { explainLegRoles } from "@/lib/legRoles";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  legs: Leg[];
}

const ROLE_COLOR: Record<string, string> = {
  underlying: "text-amber-300",
  anchor: "text-emerald-300",
  core: "text-emerald-300",
  income: "text-emerald-300",
  enhancement: "text-emerald-300",
  protective: "text-sky-300",
  directional: "text-violet-300",
  speculative: "text-violet-300",
  generic: "text-slate-300",
};

// Same hover-popover pattern StrategyBadge already uses — this is the
// "what does each leg actually do" explanation Xue wanted, working off
// the person's REAL current legs (not a matched preset's illustrative
// description, which is what StrategyBadge shows and only works when the
// combo happens to exactly match one of the 39 presets). explainLegRoles
// works on any combo, matched or not.
export default function LegRolesPanel({ legs }: Props) {
  const { t } = useI18n();
  const [hover, setHover] = useState(false);
  const roles = explainLegRoles(legs);

  if (roles.length === 0) return null;

  return (
    <span
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button className="flex items-center gap-0.5 rounded px-1 py-0.5 text-slate-500 transition hover:text-slate-300">
        <HelpCircle size={11} />
        <span className="text-[10px] font-semibold">{t("leg.roles")}</span>
      </button>
      {hover && (
        <span className="pointer-events-none absolute left-0 top-full z-[100] mt-1 w-72 space-y-1.5 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl">
          <span className="mb-1 block text-[11px] font-bold text-slate-100">{t("leg.rolesTitle")}</span>
          {roles.map((r, i) => (
            <span key={i} className="block">
              <span className={`text-[9px] font-semibold uppercase tracking-wide ${ROLE_COLOR[r.role] ?? "text-slate-400"}`}>
                {r.label}
              </span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-300">{r.explanation}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
