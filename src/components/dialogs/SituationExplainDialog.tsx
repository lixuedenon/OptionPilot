// src/components/dialogs/SituationExplainDialog.tsx
import { X } from "lucide-react";
import type { SituationExplanation } from "@/lib/situationExplainer";

interface Props {
  title: string;
  explanation: SituationExplanation;
  onClose: () => void;
}

// Styled after HelpPanel.tsx's "info" variant (same dialog chrome: backdrop-
// dismiss + X, scrollable body, section list) since this is the same kind of
// "read a short structured explanation, then close it" interaction — just
// with generated content (situationExplainer.ts) instead of static i18n
// guide text, and a headline sentence up top before the section list.
export default function SituationExplainDialog({ title, explanation, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-[600px] max-w-[90vw] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-emerald-400">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-[12px] font-semibold leading-relaxed text-sky-300">{explanation.headline}</p>
        <div className="space-y-4 text-[12px] leading-relaxed text-slate-300">
          {explanation.sections.map((s, i) => (
            <section key={`${s.title}-${i}`}>
              <h3 className="mb-1 text-[13px] font-bold text-sky-300">{s.title}</h3>
              <p>{s.body}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
