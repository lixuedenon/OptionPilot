// src/components/StepBadge.tsx
// 新用户引导的步骤编号：贴在控件右上角的小圆圈数字，悬停（手机上点一下）立刻显示说明。
// 不用原生title：浏览器要等约1秒才弹，而且在label/按钮上容易被父元素的title盖住。
// 说明框用portal挂到body、fixed定位，避免被左栏的overflow/sticky裁掉。
// 每一步一个颜色（STEP_COLORS），父元素需要是relative定位。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  n: number;
  title: string;
}

const TIP_WIDTH = 240;
const STEP_COLORS: Record<number, string> = {
  1: "bg-amber-400",
  2: "bg-sky-400",
  3: "bg-emerald-400",
  4: "bg-violet-400",
  5: "bg-pink-400",
};

export default function StepBadge({ n, title }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const lastPointer = useRef<string>("mouse");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left - 8, window.innerWidth - TIP_WIDTH - 8));
    setPos({ left, top: r.bottom + 6 });
  };
  const hide = () => setPos(null);

  // 手机上点开后，点别处或滚动就收起。
  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPos(null);
    };
    const onScroll = () => setPos(null);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [pos]);

  return (
    <>
      <span
        ref={ref}
        role="note"
        aria-label={title}
        // 只对真鼠标做悬停：触屏点一下也会模拟出mouseenter，会和下面的点击切换打架。
        onPointerEnter={(e) => { if (e.pointerType === "mouse") show(); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") hide(); }}
        onPointerDown={(e) => { lastPointer.current = e.pointerType; }}
        onClick={(e) => {
          // 点徽章只看说明，不触发旁边的控件（如label聚焦输入框）。
          e.preventDefault();
          e.stopPropagation();
          if (lastPointer.current === "mouse") return;
          if (pos) hide();
          else show();
        }}
        className={`pointer-events-auto absolute -right-1.5 -top-1.5 z-10 flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full text-[9px] font-bold leading-none text-slate-950 shadow ${STEP_COLORS[n] ?? "bg-slate-400"}`}
      >
        {n}
      </span>
      {pos &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[1000] rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-[11px] leading-snug text-slate-200 shadow-lg"
            style={{ left: pos.left, top: pos.top, maxWidth: TIP_WIDTH }}
          >
            {title}
          </div>,
          document.body
        )}
    </>
  );
}
