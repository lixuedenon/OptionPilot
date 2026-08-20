import { useState, useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  label: string;
  icon?: ReactNode;
  menuClassName?: string;
  children: (close: () => void) => ReactNode;
}

export default function DropdownMenu({ label, icon, menuClassName, children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold transition ${
          open
            ? "border-slate-500 bg-slate-700/60 text-slate-100"
            : "border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600 hover:text-white"
        }`}
      >
        {icon}
        {label}
        <ChevronDown size={10} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className={`absolute right-0 top-full z-50 mt-1 w-32 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl ${menuClassName ?? ""}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
