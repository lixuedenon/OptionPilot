// src/components/LockedOverlay.tsx
// 2026-09-22新增：滑块偏离原点(isExploring)时，A/B/C三个combo容器的所有
// 输入都被锁定。之前只有LegRow.tsx里个别输入框（NumField）自己叠了一层
// 透明遮罩去接住点击、弹"请先点重置"的提示——现在要求点容器内任意区域
// 都要有同样的反馈，不止那几个输入框。这个组件把"锁定时叠一层遮罩+点击
// 弹提示"收敛成一个可复用的wrapper，LegListSection.tsx（主combo）和
// ComboCompareSlots.tsx（B/C槽位）共用，不用各自重写一遍。
//
// 遮罩必须是真实盖在最上层的DOM元素，不能指望点击从原生disabled表单控件
// 上"冒泡"出来——浏览器根本不会为disabled的input/button派发click事件，
// 父级监听器（哪怕是capture阶段）也收不到，这也是NumField那个更早的实现
// 选择遮罩而不是事件委托的原因，这里保持同样的技术选型。
//
// NumField自己的字段级遮罩/提示已删除（2026-09-22，同一轮）——容器级遮罩
// z-index更高、会先拦到点击，字段级那层从引入这个组件起就是打不到的死
// 代码，按"发现可删的东西尽快删"的policy一并清掉了，见LegRow.tsx。
//
// 2026-09-22再新增：可选的onClick——"A/B/C完全对等"这轮改动里，点击某个
// combo容器的任意区域要能把它"激活"成当前操作对象（见App.tsx的
// activeComboIndex）。只在未锁定时透传给根div——锁定时最上层是遮罩本身
// （见下面locked分支），点击天然只会弹提示、不会冒泡到这个onClick，这也
// 是刻意的：滑块没归位时不该允许切换正在编辑的槽位。
import { useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  locked?: boolean;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function LockedOverlay({ locked, children, className, onClick }: Props) {
  const { t } = useI18n();
  const [showHint, setShowHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashHint = () => {
    setShowHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setShowHint(false), 2500);
  };
  return (
    <div className={`relative ${className ?? ""}`} onClick={onClick}>
      {children}
      {locked && (
        <div className="absolute inset-0 z-10 cursor-not-allowed" onClick={flashHint} />
      )}
      {showHint && (
        <div className="absolute left-1/2 top-2 z-20 w-max max-w-[220px] -translate-x-1/2 rounded border border-amber-600/50 bg-slate-900 px-2 py-1 text-center text-[10px] font-medium text-amber-300 shadow-lg">
          {t("leg.lockedInputHint", { section: t("shift.scenario") })}
        </div>
      )}
    </div>
  );
}
