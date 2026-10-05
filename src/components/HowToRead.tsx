// src/components/HowToRead.tsx
// 万次推演图下面的"怎么看这张图"：几条大白话，平面/立体、推演未来/今昔对比各一套（调用方传进来）。
// 默认展开；收起后记在浏览器里，下次打开还是收起的。
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nContext";

const KEY = "optionpilot.simHowTo";

export default function HowToRead({ lines }: { lines: string[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) !== "closed";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, open ? "open" : "closed");
    } catch {
      /* 存不了就只在本次有效 */
    }
  }, [open]);
  return (
    <div className="shrink-0 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-1.5 text-[11px] leading-relaxed">
      <button type="button" onClick={() => setOpen((v) => !v)} className="font-semibold text-sky-300 hover:text-sky-200">
        {open ? "▾" : "▸"} {t("future.howTitle")}
      </button>
      {open && (
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-slate-300">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
