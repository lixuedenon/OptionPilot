// src/components/Term.tsx
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  titleKey: string; // i18n key for the popover's bold title line
  descKey: string; // i18n key for the one-line definition
  // Optional interpolation vars for the description (e.g. live numbers baked
  // into the sentence via t(descKey, descVars)) — omit for a static string,
  // same as before this existed. Purely additive: no existing call site
  // passes this, so none of them are affected.
  descVars?: Record<string, string | number>;
  children: ReactNode; // the label itself — rendered inline with a dotted-underline affordance
  className?: string; // extra classes merged onto the trigger, e.g. to match surrounding text size/color
  // true renders the trigger as a plain round icon button (no dotted-
  // underline text styling) for icon-only triggers such as a "?" badge,
  // instead of the default inline-text affordance. Defaults to false, so
  // every existing call site (all of which pass a text label) is unaffected.
  iconTrigger?: boolean;
}

// Generic "click a term, see a one-line definition" primitive (2026-09,
// xue's proposal #5). Not a new interaction pattern — PositionHealthBadge.tsx
// already does portal-positioned, click-to-toggle popovers for the health
// score's factor list; this extracts that same mechanism (portal to
// <body> to escape scroll-clipping ancestors, position computed from the
// trigger's own screen rect, close on outside mousedown) into something
// reusable for a single term anywhere in the app, instead of every call
// site reinventing it. Click rather than CSS :hover so it works the same
// on touch as on desktop.
export default function Term({ titleKey, descKey, descVars, children, className, iconTrigger = false }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const popoverWidth = 256; // matches w-64 below
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8));
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
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          iconTrigger
            ? `flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:text-slate-400 ${className ?? ""}`
            : `inline cursor-default border-b border-dotted border-slate-600 text-inherit transition hover:border-slate-400 ${className ?? ""}`
        }
      >
        {children}
      </button>

      {open && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[100] w-64 whitespace-normal rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-2xl"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="mb-1 text-[11px] font-bold text-slate-200">{t(titleKey)}</div>
          <div className="text-[10px] leading-relaxed text-slate-300">{t(descKey, descVars)}</div>
        </div>,
        document.body,
      )}
    </>
  );
}
