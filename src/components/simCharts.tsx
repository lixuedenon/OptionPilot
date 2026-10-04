// src/components/simCharts.tsx
// 胜率模拟/万次推演共用的画布组件；"高级分析"小图的画法在lib/simChartDraw.ts。
import { useEffect, useRef, useState } from "react";

// 画布：跟容器同宽高，尺寸或数据变了就重画。
export default function CanvasBox({ className, draw, deps, label }: { className: string; draw: (g: CanvasRenderingContext2D, w: number, h: number) => void; deps: unknown[]; label: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv || size.w < 40 || size.h < 40) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    draw(g, size.w, size.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, ...deps]);
  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <canvas ref={cvRef} role="img" aria-label={label} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
