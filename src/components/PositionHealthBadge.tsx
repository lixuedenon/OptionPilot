// src/components/PositionHealthBadge.tsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HeartPulse } from "lucide-react";
import type { HealthResult } from "@/lib/positionHealth";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  health: HealthResult;
}

const TIER_COLOR: Record<HealthResult["tier"], string> = {
  healthy: "text-emerald-400",
  watch: "text-amber-400",
  warning: "text-orange-400",
  critical: "text-rose-400",
};

const TIER_DOT: Record<HealthResult["tier"], string> = {
  healthy: "bg-emerald-400",
  watch: "bg-amber-400",
  warning: "bg-orange-400",
  critical: "bg-rose-400",
};

const STATUS_DOT: Record<string, string> = {
  good: "bg-emerald-400",
  warning: "bg-amber-400",
  bad: "bg-rose-400",
};

export default function PositionHealthBadge({ health }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // The popover is rendered via a portal directly under <body>, not as a
  // normal DOM child of this component — a scrolling ancestor (the left
  // panel now scrolls as one column, see App.tsx's layout notes) will clip
  // any absolutely-positioned descendant that extends past its visible
  // area, no matter how wide the popover itself is set. Escaping to a
  // portal sidesteps that clipping entirely; position is computed from the
  // button's own screen position instead of relying on CSS position:absolute
  // within the clipped ancestor chain.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const popoverWidth = 320; // matches w-80 below — widened to fit the added "what this means" line per factor
    // Keep the popover on-screen: align its right edge with the button's
    // right edge, but never let its left edge go past the viewport edge.
    const left = Math.max(8, Math.min(rect.right - popoverWidth, window.innerWidth - popoverWidth - 8));
    setPos({ top: rect.bottom + 4, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
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
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className="flex shrink-0 items-center gap-1.5 rounded border border-slate-800 bg-slate-900/40 px-2 py-1 transition hover:border-slate-600"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TIER_DOT[health.tier]}`} />
        <HeartPulse size={11} className={TIER_COLOR[health.tier]} />
        <span className="whitespace-nowrap text-[10px] text-slate-500">{t("health.title")}</span>
        <span className={`text-base font-bold tabular-nums leading-none ${TIER_COLOR[health.tier]}`}>{health.score}</span>
      </button>

      {open && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[100] w-80 whitespace-normal rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-2xl"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-200">{t("health.title")}</span>
            <span className={`text-sm font-bold tabular-nums ${TIER_COLOR[health.tier]}`}>{health.score} / 100</span>
          </div>
          <p className="mb-2.5 rounded-md bg-slate-800/60 px-2 py-1.5 text-[10px] leading-relaxed text-slate-300">
            {health.summary}
          </p>
          <div className="space-y-1.5">
            {health.factors.map((f, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[f.status]}`} />
                <div className="text-[10px] leading-relaxed">
                  <div>
                    <span className="font-semibold text-slate-300">{f.label}{t("health.labelSeparator")}</span>
                    <span className="text-slate-400">{f.note}</span>
                  </div>
                  {/* Static "what this number means" line — independent of
                      the current value, so it stays useful even once the
                      number itself is glanced past. Dimmer than `note` so
                      the concrete reading still reads first. */}
                  <div className="mt-0.5 text-slate-600">{f.meaning}</div>
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}