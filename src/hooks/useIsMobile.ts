// src/hooks/useIsMobile.ts
import { useEffect, useState } from "react";

// 2026-09-26 移动端第二步：手机布局开关。
//
// 判断条件（满足任一即为"手机布局"）：
//   ① 视口宽度 < 768px —— 所有手机竖屏（360–440px）
//   ② 视口高度 <= 500px 且主输入设备是触屏 —— 手机横屏（宽度可能超过768，
//      但高度只有320–430，左右两栏会被压得不能用，xue实测确认，所以横屏也
//      走上下排列）
// iPad（竖屏768+、横屏1024+，高度都远大于500）不命中，照常用电脑版左右两栏。
//
// 用matchMedia而不是纯CSS断点：手机/电脑两种布局不只是class不同，
// App.tsx需要按它决定外层是"整页滚动"还是"固定一屏高、内部各自滚动"，
// 以及图表容器要不要给固定高度，写成一个布尔值最直接。
const MOBILE_QUERY = "(max-width: 767px), (max-height: 500px) and (pointer: coarse)";

function query(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(query);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
