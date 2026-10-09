// src/components/InfoTip.tsx
// 悬停说明：一个小"ⓘ"，鼠标移上去弹出小窗（标题、说明、例子），移开就关；点一下钉住，再点或点别处才关。
// 手机/触屏上点一下开、再点关（不靠悬停，避免模拟的mouseenter和click一开一关）。键盘Tab到它会打开，Esc关。
// 小窗用fixed定位，不会被图表容器的overflow裁掉；先量出真实高度再决定放上面还是下面，并夹在屏幕里；页面滚动时关掉（位置会过时）。
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  title: string;
  body: ReactNode;
  example?: ReactNode;
  children?: ReactNode; // 跟ⓘ放在一起的文字（图例），鼠标停在文字上也弹
  className?: string;
}

const W = 320;
const GAP = 6;

export default function InfoTip({ title, body, example, children, className = "" }: Props) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const id = useId();
  // hover=鼠标停着才开；pinned=点过，鼠标移开也不关
  const [state, setState] = useState<"closed" | "hover" | "pinned">("closed");
  const open = state !== "closed";
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 两步定位：先放在屏幕外量高度，再算位置
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    if (!ref.current || !tipRef.current) return;
    const r = ref.current.getBoundingClientRect();
    const h = tipRef.current.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(vw - W - 8, r.left));
    const below = r.bottom + GAP;
    const above = r.top - GAP - h;
    // 下面放得下放下面；放不下且上面放得下放上面；都放不下就贴着屏幕底（不盖住自己的触发点为先）
    const top = below + h <= vh - 8 ? below : above >= 8 ? above : Math.max(8, vh - 8 - h);
    setPos({ left, top });
  }, [open]);

  // 钉住时点别处关；打开时页面滚动/窗口变化就关；Esc关
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setState("closed");
    };
    const close = () => setState("closed");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setState("closed");
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      tabIndex={0}
      aria-describedby={open ? id : undefined}
      aria-label={children ? undefined : title}
      className={`relative inline-flex cursor-help items-center gap-1 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-sky-400 ${className}`}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setState((s) => (s === "closed" ? "hover" : s));
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setState((s) => (s === "hover" ? "closed" : s));
      }}
      onClick={(e) => {
        e.stopPropagation();
        // 鼠标：悬停已经开了，点一下是钉住；钉住了再点是关。触屏：点一下开/关
        setState((s) => (s === "pinned" ? "closed" : "pinned"));
      }}
      onFocus={() => setState((s) => (s === "closed" ? "hover" : s))}
      onBlur={() => setState((s) => (s === "hover" ? "closed" : s))}
    >
      {children}
      <span aria-hidden className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full border border-sky-500/80 bg-sky-950 text-[9px] font-bold leading-none text-sky-300">
        i
      </span>
      {open && (
        <span
          ref={tipRef}
          id={id}
          role="tooltip"
          className="pointer-events-none fixed z-[1000] block rounded-lg border border-sky-500 bg-slate-950 px-3 py-2 text-left text-[11.5px] font-normal leading-relaxed text-slate-200 shadow-xl shadow-black/60"
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, width: W, maxWidth: "calc(100vw - 16px)", visibility: pos ? "visible" : "hidden" }}
        >
          <span className="mb-0.5 block font-semibold text-sky-300">{title}</span>
          <span className="block">{body}</span>
          {example && <span className="mt-1 block border-l-2 border-slate-600 pl-2 text-slate-400">{example}</span>}
        </span>
      )}
    </span>
  );
}
