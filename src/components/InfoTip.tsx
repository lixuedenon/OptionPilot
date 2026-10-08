// src/components/InfoTip.tsx
// 悬停说明（2026-10-08，xue：图上每样东西都要能鼠标一停就看到它是什么、举个例子；跟图下面"怎么看这张图"重复也没关系）。
// 一个小"ⓘ"，鼠标移上去（手机上点一下）弹出小窗：标题、说明、例子。小窗用fixed定位，不会被图表容器的overflow裁掉，并且夹在屏幕里。
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  title: string;
  body: ReactNode;
  example?: ReactNode;
  children?: ReactNode; // 跟ⓘ放在一起的文字（图例），鼠标停在文字上也弹
  className?: string;
}

const W = 320;

export default function InfoTip({ title, body, example, children, className = "" }: Props) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(vw - W - 8, r.left));
    // 下面放不下就放上面（估一个高度）
    const top = r.bottom + 6 + 180 > vh ? Math.max(8, r.top - 6 - 180) : r.bottom + 6;
    setPos({ left, top });
  }, [open]);
  return (
    <span
      ref={ref}
      className={`relative inline-flex cursor-help items-center gap-1 ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((o) => !o)}
    >
      {children}
      <span aria-label={title} className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full border border-sky-500/80 bg-sky-950 text-[9px] font-bold leading-none text-sky-300">
        i
      </span>
      {open && pos && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[1000] block rounded-lg border border-sky-500 bg-slate-950 px-3 py-2 text-left text-[11.5px] font-normal leading-relaxed text-slate-200 shadow-xl shadow-black/60"
          style={{ left: pos.left, top: pos.top, width: W }}
        >
          <span className="mb-0.5 block font-semibold text-sky-300">{title}</span>
          <span className="block">{body}</span>
          {example && <span className="mt-1 block border-l-2 border-slate-600 pl-2 text-slate-400">{example}</span>}
        </span>
      )}
    </span>
  );
}
