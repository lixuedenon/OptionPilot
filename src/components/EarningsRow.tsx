// src/components/EarningsRow.tsx
// 财报这一组（2026-10-07，示意图1、3）：持仓建议卡里的"财报"一行——
// 第几天有财报、市场押财报后涨跌多少、卖出腿在不在这个范围里（带一条范围图）、过去几次财报有几次动得比这次押的还大，
// 点"看过去几次"展开每次的真实涨跌（柱状）。数据在lib/earnings.ts（App的useEarningsContext）。
import { useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nContext";
import type { Leg } from "@/lib/types";
import type { EarningsCtx } from "@/lib/earnings";

interface Props {
  earnings: EarningsCtx;
  day: number | null; // 从此刻算第几天有财报（不在持仓期间=null）
  legs: Leg[]; // 此刻的腿位
  spot: number; // 今天的股价（市场押的幅度是按今天的期权价算的）
  expiryDate: string; // 最早到期日（mm/dd/yyyy，给"到期前没有财报"用）
  afterNow: boolean; // 财报已经在情景日之前了（推演未来把情景点拖到财报之后）
}

const pct1 = (v: number) => (v * 100).toFixed(1);
// "这次市场押的范围"在两张图里同一个颜色（琥珀色：跟绿涨红跌、蓝色的现价都分得开）
const BAND_FILL = "#f59e0b";
const BAND_EDGE = "#fbbf24";
const md = (iso: string) => iso.slice(5).replace("-", "/");

export default function EarningsRow({ earnings, day, legs, spot, expiryDate, afterNow }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const date = md(earnings.next);
  const label = <span className="text-amber-400/90">{t("earn.label")}</span>;
  const wrap = (body: ReactNode) => (
    <div className="grid grid-cols-[14px_var(--lbl,34px)_1fr] gap-x-1 text-slate-400">
      <span />
      {label}
      <span className="min-w-0">{body}</span>
    </div>
  );
  if (afterNow) return wrap(t("earn.passed", { date }));
  if (day == null) return wrap(t("earn.none", { date, exp: expiryDate }));

  const m = earnings.move;
  const timing = earnings.afterClose === false ? t("earn.bmo") : earnings.afterClose === true ? t("earn.amc") : "";
  const head = t("earn.head", { d: day, date, timing, est: earnings.estimated ? t("earn.estimated") : "" });
  const lines: ReactNode[] = [];
  let bar: ReactNode = null;
  if (m != null && spot > 0) {
    const lo = spot * (1 - m), hi = spot * (1 + m);
    lines.push(t(earnings.moveSource === "past" ? "earn.movePast" : "earn.move", { m: pct1(m), lo: lo.toFixed(2), hi: hi.toFixed(2) }));
    // 离现价最近的卖出腿：在不在市场押的范围里
    const shorts = legs.filter((l) => !l.disabled && l.kind !== "stock" && l.action === "sell");
    if (shorts.length) {
      const k = shorts.reduce((a, b) => (Math.abs(a.strike - spot) <= Math.abs(b.strike - spot) ? a : b));
      const dist = k.type === "put" ? 1 - k.strike / spot : k.strike / spot - 1; // 正=虚值方向离现价多远
      const room = dist - m;
      const v = { k: k.strike, type: k.type === "put" ? "Put" : "Call", d: pct1(Math.abs(dist)), m: pct1(m), r: pct1(Math.abs(room)), dir: t(k.type === "put" ? "earn.down" : "earn.up") };
      lines.push(
        <span className={room > 0 ? "text-emerald-300" : "text-rose-300"}>
          {t(dist < 0 ? "earn.shortItm" : room > 0 ? "earn.shortOut" : "earn.shortIn", v)}
        </span>,
      );
    } else {
      lines.push(t("earn.buyer", { m: pct1(m) }));
    }
    bar = <RangeBar spot={spot} m={m} legs={legs} />;
  } else {
    lines.push(t("earn.noMove"));
  }
  const rs = earnings.reactions;
  if (rs.length >= 2 && m != null) {
    // 按显示出来的一位小数比（不然会出现"+3.2% 比 3.2% 还大"这种看着矛盾的情况）
    const r1 = (v: number) => Math.round(Math.abs(v) * 1000);
    const big = rs.filter((r) => r1(r.move) > r1(m));
    lines.push(
      <span className="text-slate-500">
        {big.length
          ? t("earn.pastBig", { n: rs.length, k: big.length, m: pct1(m), list: big.map((r) => `${r.day.slice(2, 7)} ${r.move >= 0 ? "+" : "−"}${pct1(Math.abs(r.move))}%`).join(t("earn.sep")) })
          : t("earn.pastNone", { n: rs.length, m: pct1(m) })}
        <button type="button" onClick={() => setOpen((o) => !o)} className="ml-1.5 text-[10px] text-sky-400 underline-offset-2 hover:underline">
          {t(open ? "earn.pastClose" : "earn.pastOpen")}
        </button>
      </span>,
    );
  }
  return wrap(
    <>
      <div className="font-semibold text-amber-100">{head}</div>
      {lines.map((l, i) => <div key={i}>{l}</div>)}
      {bar}
      {open && <PastBars earnings={earnings} />}
    </>,
  );
}

// 范围图：现价、市场押的范围、各腿行权价
function RangeBar({ spot, m, legs }: { spot: number; m: number; legs: Leg[] }) {
  const opts = legs.filter((l) => !l.disabled && l.kind !== "stock");
  const ks = opts.map((l) => l.strike);
  const lo = Math.min(spot * (1 - 1.6 * m), ...ks.map((k) => k * 0.99));
  const hi = Math.max(spot * (1 + 1.6 * m), ...ks.map((k) => k * 1.01));
  const W = 300, H = 46;
  const X = (v: number) => 8 + ((v - lo) / (hi - lo)) * (W - 16);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full max-w-[320px]" role="img" aria-label="earnings range">
      <line x1={8} x2={W - 8} y1={24} y2={24} stroke="#334155" strokeWidth={2} />
      <rect x={X(spot * (1 - m))} y={17} width={X(spot * (1 + m)) - X(spot * (1 - m))} height={14} rx={3} fill={BAND_FILL} fillOpacity={0.28} stroke={BAND_EDGE} />
      <line x1={X(spot)} x2={X(spot)} y1={12} y2={36} stroke="#f1f5f9" strokeDasharray="3 2" />
      <text x={X(spot)} y={9} fill="#e2e8f0" fontSize={9} textAnchor="middle">${spot.toFixed(2)}</text>
      {opts.map((l, i) => (
        <g key={i}>
          <line x1={X(l.strike)} x2={X(l.strike)} y1={14} y2={34} stroke={l.action === "sell" ? "#e11d48" : "#059669"} strokeWidth={l.action === "sell" ? 2.5 : 2} />
          <text x={X(l.strike)} y={44} fill={l.action === "sell" ? "#fb7185" : "#34d399"} fontSize={9} textAnchor="middle">
            {l.strike}{l.type === "put" ? "P" : "C"}
          </text>
        </g>
      ))}
    </svg>
  );
}

// 过去几次：每次反应那天的涨跌（柱=收盘），细线=那天盘中走到最远的地方（涨的那天到最高、跌的那天到最低，跟K线的影线一样）；
// 背景带=这次市场押的范围（琥珀色，跟上面范围图同一个颜色）
function PastBars({ earnings }: { earnings: EarningsCtx }) {
  const { t } = useI18n();
  const rs = earnings.reactions;
  const m = earnings.move ?? 0;
  const far = (r: (typeof rs)[number]) => (r.extreme != null && Math.abs(r.extreme) > Math.abs(r.move) && Math.sign(r.extreme) === Math.sign(r.move || r.extreme) ? r.extreme : r.move);
  const mx = Math.max(m * 1.2, ...rs.map((r) => Math.abs(far(r)))) || 0.05;
  const W = 300, H = 104, mid = 48, k = 38 / mx;
  const bw = (W - 16) / rs.length;
  const hasWick = rs.some((r) => far(r) !== r.move);
  return (
    <div className="mt-1 rounded border border-slate-700/70 bg-slate-950/50 px-1.5 py-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[320px]" role="img" aria-label={t("earn.pastOpen")}>
        {m > 0 && (
          <>
            <rect x={8} y={mid - m * k} width={W - 16} height={2 * m * k} fill={BAND_FILL} fillOpacity={0.3} />
            <line x1={8} x2={W - 8} y1={mid - m * k} y2={mid - m * k} stroke={BAND_EDGE} strokeDasharray="3 2" strokeWidth={0.8} />
            <line x1={8} x2={W - 8} y1={mid + m * k} y2={mid + m * k} stroke={BAND_EDGE} strokeDasharray="3 2" strokeWidth={0.8} />
          </>
        )}
        <line x1={8} x2={W - 8} y1={mid} y2={mid} stroke="#334155" />
        {rs.map((r, i) => {
          const x = 8 + i * bw, cx = x + bw / 2;
          const h = Math.max(1, Math.abs(r.move) * k);
          const up = r.move >= 0;
          const c = up ? "#34d399" : "#fb7185";
          const f = far(r);
          const wy = mid - f * k; // 影线末端
          const endY = up ? Math.min(mid - h, wy) : Math.max(mid + h, wy);
          const tip = `${r.day}  ${t("earn.tipClose")} ${up ? "+" : "−"}${pct1(Math.abs(r.move))}%` + (f !== r.move ? `  ${t(up ? "earn.tipHigh" : "earn.tipLow")} ${f >= 0 ? "+" : "−"}${pct1(Math.abs(f))}%` : "");
          return (
            <g key={r.date}>
              <title>{tip}</title>
              {f !== r.move && <line x1={cx} x2={cx} y1={up ? mid - h : mid + h} y2={wy} stroke={c} strokeWidth={1} />}
              <rect x={x + bw * 0.2} y={up ? mid - h : mid} width={bw * 0.6} height={h} rx={1.5} fill={c} />
              <text x={cx} y={up ? endY - 2 : endY + 9} fill={c} fontSize={8.5} textAnchor="middle">{`${up ? "+" : "−"}${pct1(Math.abs(r.move))}`}</text>
              <text x={cx} y={H - 2} fill="#64748b" fontSize={8} textAnchor="middle">{r.day.slice(2, 7)}</text>
            </g>
          );
        })}
      </svg>
      <div className="text-[10px] text-slate-500">{t(hasWick ? "earn.pastNoteWick" : "earn.pastNote")}</div>
    </div>
  );
}
