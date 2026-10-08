// src/components/MoneyPanel.tsx
// ⑤「你的钱会怎么变」：万次推演平面图正下方，跟上面的股价图用同一批走势、同一条时间轴（左右边距跟平面图一样，竖着对齐看）。
// 上半：每天的盈亏范围（中间50%/90%，已经下车的走势停在下车那天的钱）、中位数、止盈/止损线、选中的那条典型走法
//      （下车前实线；下车后虚线=要是还拿着会怎样）、情景点（滑块定的那一天）。
// 下半细条：到每一天为止，累计止盈下车 / 止损下车 / 到点平仓 / 还拿着各占多少。
// 下面的大白话按"这条走法说明什么 → 有多常见 → 滑块那天的情况 → 对你意味着什么 → 怎么用"。
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/I18nContext";
import CanvasBox from "@/components/simCharts";
import type { Band, Story } from "@/lib/futureSim";
import type { SimStats } from "@/lib/winRateSim";

interface Props {
  days: number; // 横轴总天数（开仓到最早到期）
  endDay: number; // 按规则最晚第几天平仓（< days 表示到点平仓）
  spot: number; // 开仓价
  stories: Story[];
  storyIdx: number;
  colors: Record<Story["kind"], string>;
  money: Band[]; // 每天的盈亏分位数（futureSim.moneyBands）
  exitDays: Record<"tp" | "sl" | "delta" | "time", number[]>;
  stats: SimStats;
  tpLine: number; // 止盈/止损线（开仓以来总盈亏，每股），没设=±Infinity
  slLine: number;
  scen: { day: number; price: number } | null;
  scenPnl: number | null; // 情景点那一刻的盈亏（跟图表头部、持仓建议同一个数）
  margin: { l: number; r: number }; // 跟平面图一样的左右边距，时间轴才对得上
  n: number; // 总走势条数
}

const usdS = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;
const pct = (v: number) => (v > 0 && v < 1 ? "<1" : String(Math.round(v)));

function niceStep(span: number, target: number) {
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
}

// 分位带上某一天的值（带子只取了部分日子，中间按直线插）
function bandAt(bands: Band[], day: number): Band | null {
  if (bands.length === 0) return null;
  if (day <= bands[0].day) return bands[0];
  for (let i = 1; i < bands.length; i++) {
    const a = bands[i - 1], b = bands[i];
    if (day <= b.day) {
      const w = (day - a.day) / Math.max(1e-9, b.day - a.day);
      const mix = (k: keyof Omit<Band, "day">) => a[k] + (b[k] - a[k]) * w;
      return { day, p5: mix("p5"), p25: mix("p25"), p50: mix("p50"), p75: mix("p75"), p95: mix("p95") };
    }
  }
  return bands[bands.length - 1];
}

export default function MoneyPanel(props: Props) {
  const { days, endDay, spot, stories, storyIdx, colors, money, exitDays, stats, tpLine, slLine, scen, scenPnl, margin, n } = props;
  const { t } = useI18n();
  const st = stories.length ? stories[Math.min(storyIdx, stories.length - 1)] : null;
  const ghost = st?.pnls ?? null;

  // 累计下车比例（0..1），下标=第几天
  const cum = (() => {
    const out = { tp: [] as number[], sl: [] as number[], delta: [] as number[], time: [] as number[] };
    let a = 0, b = 0, c = 0, e = 0;
    for (let d = 0; d <= days; d++) {
      a += exitDays.tp[d] ?? 0;
      b += exitDays.sl[d] ?? 0;
      c += exitDays.time[d] ?? 0;
      out.tp.push(a / n);
      out.sl.push(b / n);
      out.time.push(c / n);
      e += exitDays.delta[d] ?? 0;
      out.delta.push(e / n);
    }
    return out;
  })();

  const draw = (g: CanvasRenderingContext2D, W: number, H: number) => {
    const STRIP = 30;
    const M = { l: margin.l, r: margin.r, t: 14, b: STRIP + 30 };
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    if (pw <= 10 || ph <= 10 || money.length === 0) return;
    const X = (d: number) => M.l + (d / days) * pw;
    // 纵轴范围：90%带 + 止盈止损线 + 选中走法（含"要是还拿着"的虚线）
    let lo = Math.min(0, ...money.map((b) => b.p5));
    let hi = Math.max(0, ...money.map((b) => b.p95));
    if (Number.isFinite(tpLine)) hi = Math.max(hi, tpLine);
    if (Number.isFinite(slLine)) lo = Math.min(lo, slLine);
    if (ghost) for (const v of ghost) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (scenPnl != null) { lo = Math.min(lo, scenPnl); hi = Math.max(hi, scenPnl); }
    const pad = (hi - lo) * 0.08 || 0.5;
    lo -= pad;
    hi += pad;
    const Y = (v: number) => M.t + ((hi - Math.min(hi, Math.max(lo, v))) / (hi - lo)) * ph;

    // 刻度
    const step = niceStep(hi - lo, 5);
    g.font = "10px sans-serif";
    g.textAlign = "right";
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = Y(v);
      g.strokeStyle = Math.abs(v) < step / 2 ? "#475569" : "#1e293b";
      g.beginPath();
      g.moveTo(M.l, y);
      g.lineTo(M.l + pw, y);
      g.stroke();
      g.fillStyle = "#94a3b8";
      g.fillText(Math.abs(v) < step / 2 ? "$0" : usdS(v), M.l - 4, y + 3);
    }
    // 分位带
    const poly = (a: (b: Band) => number, b: (b: Band) => number, fill: string) => {
      g.fillStyle = fill;
      g.beginPath();
      money.forEach((bd, i) => (i ? g.lineTo(X(bd.day), Y(a(bd))) : g.moveTo(X(bd.day), Y(a(bd)))));
      for (let i = money.length - 1; i >= 0; i--) g.lineTo(X(money[i].day), Y(b(money[i])));
      g.closePath();
      g.fill();
    };
    poly((b) => b.p95, (b) => b.p5, "rgba(226,232,240,0.12)");
    poly((b) => b.p75, (b) => b.p25, "rgba(226,232,240,0.2)");
    g.strokeStyle = "rgba(226,232,240,0.75)";
    g.lineWidth = 1.2;
    g.beginPath();
    money.forEach((bd, i) => (i ? g.lineTo(X(bd.day), Y(bd.p50)) : g.moveTo(X(bd.day), Y(bd.p50))));
    g.stroke();
    g.lineWidth = 1;
    // 止盈 / 止损线
    const hline = (v: number, color: string, text: string, below: boolean) => {
      if (!Number.isFinite(v) || v < lo || v > hi) return;
      g.strokeStyle = color;
      g.setLineDash([6, 3]);
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(M.l, Y(v));
      g.lineTo(M.l + pw, Y(v));
      g.stroke();
      g.setLineDash([]);
      g.lineWidth = 1;
      g.fillStyle = color;
      g.textAlign = "left";
      g.font = "10px sans-serif";
      g.fillText(text, M.l + pw + 4, Y(v) + (below ? 11 : -3));
    };
    hline(tpLine, "#34d399", t("money.tpLine", { v: usdS(tpLine) }), false);
    hline(slLine, "#fb7185", t("money.slLine", { v: usdS(slLine) }), true);
    // 到点平仓那天
    if (endDay < days && endDay > 0) {
      g.strokeStyle = "rgba(251,191,36,0.6)";
      g.setLineDash([2, 4]);
      g.beginPath();
      g.moveTo(X(endDay), M.t);
      g.lineTo(X(endDay), M.t + ph);
      g.stroke();
      g.setLineDash([]);
    }
    // 情景那一天的竖线
    if (scen && scen.day > 0) {
      g.strokeStyle = "rgba(125,211,252,0.8)";
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(X(scen.day), M.t);
      g.lineTo(X(scen.day), H - 18);
      g.stroke();
      g.setLineDash([]);
    }
    // 选中的走法：下车前实线，下车后虚线（要是还拿着）
    if (st && ghost) {
      const c = colors[st.kind];
      const ex = Math.min(st.day, ghost.length - 1);
      g.strokeStyle = c;
      g.lineWidth = 2.4;
      g.beginPath();
      for (let d = 0; d <= ex; d++) {
        const v = d === ex ? st.pnl : ghost[d];
        if (d) g.lineTo(X(d), Y(v));
        else g.moveTo(X(d), Y(v));
      }
      g.stroke();
      g.lineWidth = 1;
      if (ex < ghost.length - 1) {
        g.globalAlpha = 0.55;
        g.setLineDash([3, 4]);
        g.lineWidth = 1.4;
        g.beginPath();
        for (let d = ex; d < ghost.length; d++) {
          if (d === ex) g.moveTo(X(d), Y(st.pnl));
          else g.lineTo(X(d), Y(ghost[d]));
        }
        g.stroke();
        g.setLineDash([]);
        g.lineWidth = 1;
        g.globalAlpha = 1;
      }
      const ey = Y(st.pnl);
      g.fillStyle = c;
      g.strokeStyle = "#020617";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(X(ex), ey, 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.lineWidth = 1;
      const label = t(`money.exit_${st.kind}`, { d: st.day, v: usdS(st.pnl) });
      g.font = "bold 11px sans-serif";
      const tw = g.measureText(label).width;
      const lx = Math.min(Math.max(X(ex), M.l + tw / 2 + 2), M.l + pw - tw / 2 - 2);
      const up = st.pnl >= 0;
      g.textAlign = "center";
      g.fillStyle = c;
      g.fillText(label, lx, up ? Math.max(M.t + 10, ey - 9) : Math.min(M.t + ph - 3, ey + 17));
    }
    // 情景点
    if (scen && scenPnl != null) {
      const sx = X(scen.day), sy = Y(scenPnl);
      g.fillStyle = "#0ea5e9";
      g.strokeStyle = "#f8fafc";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(sx, sy - 6);
      g.lineTo(sx + 6, sy);
      g.lineTo(sx, sy + 6);
      g.lineTo(sx - 6, sy);
      g.closePath();
      g.fill();
      g.stroke();
      g.lineWidth = 1;
    }
    // 细条：累计下车比例
    const sTop = M.t + ph + 22, sH = STRIP - 6;
    const area = (top: (d: number) => number, bot: (d: number) => number, fill: string) => {
      g.fillStyle = fill;
      g.beginPath();
      for (let d = 0; d <= days; d++) {
        if (d) g.lineTo(X(d), sTop + top(d) * sH);
        else g.moveTo(X(d), sTop + top(d) * sH);
      }
      for (let d = days; d >= 0; d--) g.lineTo(X(d), sTop + bot(d) * sH);
      g.closePath();
      g.fill();
    };
    g.fillStyle = "#334155";
    g.fillRect(M.l, sTop, pw, sH);
    area(() => 0, (d) => cum.tp[d], "rgba(52,211,153,0.8)");
    area((d) => 1 - cum.sl[d], () => 1, "rgba(251,113,133,0.85)");
    area((d) => 1 - cum.sl[d] - cum.delta[d], (d) => 1 - cum.sl[d], "rgba(167,139,250,0.85)");
    area((d) => 1 - cum.sl[d] - cum.delta[d] - cum.time[d], (d) => 1 - cum.sl[d] - cum.delta[d], "rgba(251,191,36,0.8)");
    g.font = "10px sans-serif";
    g.textAlign = "left";
    g.fillStyle = "#94a3b8";
    g.fillText(t("money.stripTitle"), M.l, sTop - 5);
    const last = days;
    g.fillStyle = "#6ee7b7";
    g.fillText(t("money.stripTp", { p: pct(cum.tp[last] * 100) }), M.l + pw + 4, sTop + 8);
    g.fillStyle = "#fda4af";
    g.fillText(t("money.stripSl", { p: pct(cum.sl[last] * 100) }), M.l + pw + 4, sTop + sH);
    // 横轴
    g.fillStyle = "#64748b";
    g.fillText(t("future.axOpen"), M.l, H - 4);
    g.textAlign = "right";
    g.fillText(t("future.axExpiry", { d: days }), M.l + pw, H - 4);
  };

  // ── 大白话 ──
  const lines: { title: string; body: ReactNode }[] = [];
  if (st) {
    const ex = Math.min(st.day, st.prices.length - 1);
    const pEx = st.prices[ex];
    const chg = (pEx / spot - 1) * 100;
    const chgT = t(chg >= 0 ? "money.up" : "money.down", { p: Math.abs(chg).toFixed(1) });
    const g = ghost ? ghost[ghost.length - 1] : null;
    const name = t(`future.story_${st.kind}`);
    const vars = { chg: chgT, p: `$${pEx.toFixed(2)}`, d: st.day, v: usdS(st.pnl), va: `$${Math.abs(st.pnl).toFixed(2)}`, g: g != null ? usdS(g) : "", line: usdS(st.kind === "sl" ? slLine : tpLine) };
    lines.push({ title: t("money.hWhat"), body: t(`money.what_${st.kind}`, vars) });
    const by = stats.byReason;
    const avgOf = (k: "tp" | "sl" | "delta" | "time") => {
      let s = 0, c = 0;
      exitDays[k].forEach((v, d) => { s += v * d; c += v; });
      return c ? s / c : null;
    };
    const avg = st.kind === "tp" || st.kind === "sl" || st.kind === "delta" || st.kind === "time" ? avgOf(st.kind) : null;
    lines.push({
      title: t("money.hCommon"),
      body: t("money.common", {
        n: n.toLocaleString(), name, s: pct(st.share),
        avg: avg != null ? t("money.avgDay", { d: Math.round(avg) }) : "",
        list: [
          t("money.part_tp", { p: pct(by.tp.pct) }),
          t("money.part_sl", { p: pct(by.sl.pct) }),
          ...(by.delta.pct > 0 ? [t("money.part_delta", { p: pct(by.delta.pct) })] : []),
          ...(endDay < days || by.time.pct > 0 ? [t("money.part_time", { p: pct(by.time.pct) })] : []),
          ...(endDay >= days || by.expiry.pct > 0 ? [t("money.part_exp", { p: pct(by.expiry.pct) })] : []),
        ].join(t("money.sep")),
      }),
    });
    if (scen && scen.day > 0) {
      const d = Math.min(days, Math.round(scen.day));
      const b = bandAt(money, d);
      const h = Math.max(0, 1 - cum.tp[d] - cum.sl[d] - cum.delta[d] - cum.time[d]);
      lines.push({
        title: t("money.hDay", { d, n: n.toLocaleString() }),
        body: t("money.day", {
          d, tp: pct(cum.tp[d] * 100), sl: pct(cum.sl[d] * 100), time: `${cum.delta[d] > 0 ? t("money.dayDelta", { p: pct(cum.delta[d] * 100) }) : ""}${cum.time[d] > 0 ? t("money.dayTime", { p: pct(cum.time[d] * 100) }) : ""}`, h: pct(h * 100),
          lo: b ? usdS(b.p5) : "", hi: b ? usdS(b.p95) : "", lo2: b ? usdS(b.p25) : "", hi2: b ? usdS(b.p75) : "",
        }),
      });
    } else {
      lines.push({ title: t("money.hDayNone"), body: t("money.dayNone") });
    }
    const rebound = st.kind === "sl" && g != null && g > st.pnl;
    lines.push({ title: t("money.hMean"), body: <>{t(`money.mean_${st.kind}`, vars)}{rebound && <> {t("money.mean_slRebound", { d: st.day, g: usdS(g!) })}</>}</> });
    lines.push({ title: t("money.hHow"), body: t("money.how") });
  }

  return (
    <div className="shrink-0 rounded-md border border-slate-800 bg-slate-950/40 px-2 py-2">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-1">
        <span className="text-[12px] font-bold text-slate-100">{t("money.title")}</span>
        <span className="text-[10px] text-slate-500">{t("money.sub", { n: n.toLocaleString() })}</span>
      </div>
      <CanvasBox
        className="h-[300px] w-full"
        draw={draw}
        deps={[money, exitDays, stories, storyIdx, scen?.day, scen?.price, scenPnl, tpLine, slLine, days, endDay, t]}
        label={t("money.title")}
      />
      <div className="mt-1 flex flex-wrap items-center gap-3 px-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: "rgba(226,232,240,0.32)" }} />{t("money.lg50")}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: "rgba(226,232,240,0.14)" }} />{t("money.lg90")}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 rounded bg-slate-200" />{t("money.lgMid")}</span>
        {st && <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 rounded" style={{ background: colors[st.kind] }} />{t("money.lgStory")}</span>}
        <span>{t("money.lgGhost")}</span>
        <span>{t("money.lgStrip")}</span>
      </div>
      {lines.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-slate-800 px-1 pt-2 leading-relaxed">
          {lines.map((l) => (
            <div key={l.title}>
              <div className="text-[11px] font-bold text-sky-300">{l.title}</div>
              <div className="text-slate-300">{l.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
