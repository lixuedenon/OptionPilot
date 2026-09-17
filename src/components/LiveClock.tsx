// src/components/LiveClock.tsx
// src/components/LiveClock.tsx
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";

// 2026-09-15，xue要求在四个模块（分析模式/跟踪对比共用App.tsx一份头部、模拟账户、
// AI推荐策略）右上角都放一个当天日期+当时时间，所以做成一个共用组件，三处头部
// 各自引入即可，不用各写一份。每秒更新一次；日期/时间格式跟随App语言状态
// （lang==="en"时用en-US格式，否则zh-CN），做法上跟其它5处<input type="date">
// 的lang处理是同一个思路，保持全项目"日期展示跟随App语言"这条不变量一致。
export default function LiveClock({ className = "" }: { className?: string }) {
  const { lang } = useI18n();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const locale = lang === "en" ? "en-US" : "zh-CN";
  const dateStr = now.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
  const timeStr = now.toLocaleTimeString(locale, { hour12: false });

  return (
    <div className={`flex items-center gap-1 text-[10px] tabular-nums text-slate-500 ${className}`}>
      <Clock size={11} className="text-slate-600" />
      <span>{dateStr}</span>
      <span className="text-slate-600">{timeStr}</span>
    </div>
  );
}
