// src/components/LockedOverlay.tsx
// 锁定整个左侧区域的唯一实现，两种原因（App.tsx的leftLockReason）：
//   explore——情景滑块离开原点，提示"请先重置情景滑块"；
//   symbol / symbolInvalid——还没有有效股票代码（使用顺序第一步），提示先输入代码。
// 上面盖一层透明遮罩，点击时看遮罩下面是什么：在豁免区域里就把点击转给它，其它地方在点击处弹提示。
// 豁免：data-lock-exempt（只读说明，如盈亏归因"?"）任何原因都放行；data-lock-exempt-symbol
// （策略库——打开已存策略会带上它自己的代码）只在缺代码时放行，滑块锁定时不放行。
// 键盘Tab进入非豁免区域时同样拦下。各子组件不再各自处理锁定。
import { useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nContext";

export type LockReason = "explore" | "symbol" | "symbolInvalid";

interface Props {
  reason?: LockReason | null;
  children: ReactNode;
  className?: string;
}

const CLICKABLE = "button, a, [role='button'], [role='link']";

export default function LockedOverlay({ reason, children, className }: Props) {
  const locked = !!reason;
  const exemptSel = reason === "explore" ? "[data-lock-exempt]" : "[data-lock-exempt], [data-lock-exempt-symbol]";
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [hintTop, setHintTop] = useState<number | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashHintAt = (clientY: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    setHintTop(Math.max(4, clientY - (rect?.top ?? 0) - 36));
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHintTop(null), 2500);
  };

  // 遮罩下面、豁免区域里的元素；不在豁免区域返回null。
  const exemptTargetAt = (overlay: HTMLElement, x: number, y: number): HTMLElement | null => {
    overlay.style.pointerEvents = "none";
    const under = document.elementFromPoint(x, y);
    overlay.style.pointerEvents = "";
    if (!(under instanceof Element)) return null;
    const exempt = under.closest(exemptSel);
    if (!exempt || !rootRef.current?.contains(exempt)) return null;
    const clickable = under.closest(CLICKABLE);
    return (clickable ?? exempt) as HTMLElement;
  };

  // mousedown也要转发：弹出说明框靠document上的mousedown判断"点在外面就关"，
  // 不转发的话点"?"会先被当成点在外面关掉、再被click重新打开。
  const handleOverlayMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    const target = exemptTargetAt(e.currentTarget, e.clientX, e.clientY);
    if (!target) return;
    e.stopPropagation();
    target.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
  };

  // 豁免区域里：按钮上显示手型，其余显示普通箭头；锁定区域显示禁止符号。
  const handleOverlayMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const overlay = e.currentTarget;
    const target = exemptTargetAt(overlay, e.clientX, e.clientY);
    overlay.style.cursor = !target ? "not-allowed" : target.matches(CLICKABLE) ? "pointer" : "default";
  };

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = exemptTargetAt(e.currentTarget, e.clientX, e.clientY);
    if (target) {
      target.click();
      return;
    }
    flashHintAt(e.clientY);
  };

  const handleFocusCapture = (e: FocusEvent<HTMLDivElement>) => {
    if (!locked) return;
    const el = e.target as HTMLElement;
    if (el.closest(exemptSel)) return;
    el.blur();
    flashHintAt(el.getBoundingClientRect().top + 36);
  };

  return (
    <div ref={rootRef} className="relative" onFocusCapture={handleFocusCapture}>
      <div className={className}>{children}</div>
      {locked && <div className="absolute inset-0 z-30 cursor-not-allowed" onMouseMove={handleOverlayMouseMove} onMouseDown={handleOverlayMouseDown} onClick={handleOverlayClick} />}
      {locked && hintTop !== null && (
        <div
          className="pointer-events-none absolute left-1/2 z-40 w-max max-w-[260px] -translate-x-1/2 rounded border border-amber-600/50 bg-slate-900 px-2 py-1 text-center text-[11px] font-medium text-amber-300 shadow-lg"
          style={{ top: hintTop }}
        >
          {reason === "explore"
            ? t("leg.lockedInputHint", { section: t("shift.scenario") })
            : reason === "symbolInvalid"
              ? t("guide.symbolInvalid")
              : t("chart.noSpot")}
        </div>
      )}
    </div>
  );
}
