// src/components/RetroHistoryPanel.tsx
// ⑦⑧（今昔对比·复盘评估）：用这只股票过去2年的真实走势评价这笔（示意图⑦⑧，xue确认过）。
// ⑦ ① 你遇到的行情正不正常 ② 当初这笔开得好不好（只用开仓前2年，跟后来的运气分开看）③ 你那次调整在当时合不合理
// ⑧ 规则复盘：几种规则放在你真实走过的路上（只看这一次） vs 放到开仓前2年所有同样的仓位（以过去2年为准）
// 计算在lib/retroHistory.ts；日线拉5年（historical-prices有共享缓存），开仓前不够2年的部分会说"数据不够"。
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nContext";
import type { Leg } from "@/lib/types";
import { prepareSim, maxShortDelta, type SimRules, type SimSetup } from "@/lib/winRateSim";
import { RULE_CANDIDATES } from "@/lib/futureSim";
import { fetchHistoricalSeries } from "@/lib/historicalVolatility";
import { setSideRules, fracLabel } from "@/lib/simSettings";
import { useEarningsDates, earningsReactions } from "@/lib/earnings";
import { formatDateInput } from "@/lib/dateUtils";
import { regime, biggestDay, openBarSec, spansEarnings, entryQuality, adjustOdds, rulesOnce, rulesHistory, dailyPathSince, type Series } from "@/lib/retroHistory";
import { priceNearDay } from "@/lib/adjustReview";

interface Props {
  symbol: string;
  legs: Leg[]; // 开仓那天的组合（dte按开仓日）
  spot: number; // 开仓价
  openingAt: number; // 毫秒
  todayDay: number;
  nowSpot: number;
  pnlNow: number;
  history: { day: number; price: number; pnl: number }[];
  markers: { day: number; via: "roll" | "protect" | "hedge" }[];
  adjusted: boolean;
  rules: SimRules;
  credit: boolean;
  basis: number;
  horizon: number;
  sec: (key: string, title: string, body: ReactNode) => ReactNode;
}

const sameRules = (a: SimRules, b: SimRules) =>
  a.takeProfitPct === b.takeProfitPct && a.stopMult === b.stopMult && Math.abs(a.closeFrac - b.closeFrac) < 1e-9 && (a.deltaExit ?? null) === (b.deltaExit ?? null);

export default function RetroHistoryPanel(props: Props) {
  const { symbol, legs, spot, openingAt, todayDay, nowSpot, pnlNow, history, markers, adjusted, rules, credit, basis, horizon, sec } = props;
  const { t } = useI18n();
  const [series, setSeries] = useState<{ key: string; s: Series | null; status: "loading" | "ok" | "error" }>({ key: "", s: null, status: "loading" });
  const [view, setView] = useState<"once" | "hist">("once");
  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    setSeries({ key: symbol, s: null, status: "loading" });
    fetchHistoricalSeries(symbol, "5y")
      .then((s) => alive && setSeries({ key: symbol, s, status: "ok" }))
      .catch(() => alive && setSeries({ key: symbol, s: null, status: "error" }));
    return () => {
      alive = false;
    };
  }, [symbol]);

  const openSec = Math.floor(openingAt / 1000);
  const days = Math.max(1, Math.min(horizon, Math.round(todayDay)));
  const s = series.key === symbol ? series.s : null;
  const setup: SimSetup = useMemo(() => ({ legs, spot, basis, pnlOffset: 0, rules, totalTerm: horizon }), [legs, spot, basis, rules, horizon]);
  const side = credit ? "credit" : "debit";

  const myRet = nowSpot / spot - 1;
  // 财报这一组：过去财报的反应日（SEC日期+这5年日线），⑦①分开比"跨财报 / 不跨财报"的时段，再看开仓以来最大的那一天是不是财报
  const earnDates = useEarningsDates(symbol);
  const reactions = useMemo(() => (s && earnDates.data ? earningsReactions(s, earnDates.data.past) : []), [s, earnDates.data]);
  const earnT = useMemo(() => reactions.map((r) => r.t), [reactions]);
  // 开仓那天的日线：开仓当天早上的跳空（比如前一晚盘后公布的财报）是开仓之前的事，不算持仓期间
  const openBar = useMemo(() => (s ? openBarSec(s, formatDateInput(openingAt)) : null), [s, openingAt]);
  const myEarn = openBar != null ? reactions.find((r) => spansEarnings(openBar, days, [r.t])) ?? null : null;
  const reg = useMemo(() => (s ? regime(s, days, myRet, openSec + days * 86400, earnT) : null), [s, days, myRet, openSec, earnT]);
  const big = useMemo(() => (s && openBar != null ? biggestDay(s, openBar, days, earnT) : null), [s, openBar, days, earnT]);
  // 判断"罕不罕见"用跟你这段同一组的比例（分开算的时候）
  const regPct = reg ? (reg.split ? (myEarn ? reg.split.earn.pct : reg.split.plain.pct) : reg.pctMoreExtreme) : 100;
  const eq = useMemo(() => (s ? entryQuality(s, setup, openSec, credit) : null), [s, setup, openSec, credit]);
  const firstAdj = markers.length ? markers.reduce((a, b) => (a.day <= b.day ? a : b)) : null;
  const adj = useMemo(() => {
    if (!s || !firstAdj) return null;
    const price = priceNearDay(history, firstAdj.day, nowSpot);
    const shorts = legs.filter((l) => !l.disabled && l.kind !== "stock" && l.action === "sell");
    if (!shorts.length) return null;
    const leg = shorts.reduce((a, b) => (Math.abs(a.strike - price) <= Math.abs(b.strike - price) ? a : b));
    const r = adjustOdds(s, openSec + firstAdj.day * 86400, price, leg, horizon - firstAdj.day);
    return r ? { ...r, price, leg } : null;
  }, [s, firstAdj, history, nowSpot, legs, openSec, horizon]);

  const candidates = useMemo(() => {
    // Delta规则的线要高过开仓时卖出腿的Delta才有意义（跟万次推演"比一比"同一个判断）
    const p = prepareSim(setup);
    const startDelta = p ? maxShortDelta(p, 0, spot) : 0;
    const list = [rules, ...RULE_CANDIDATES[side].filter((r) => !sameRules(r, rules) && (r.deltaExit == null || r.deltaExit > startDelta + 0.05))];
    return list.slice(0, 6);
  }, [rules, side, setup, spot]);
  const once = useMemo(() => (s ? rulesOnce(setup, candidates, dailyPathSince(s, openSec, days)) : null), [s, setup, candidates, openSec, days]);
  const [histRows, setHistRows] = useState<ReturnType<typeof rulesHistory> | undefined>(undefined);
  useEffect(() => {
    if (!s) return;
    setHistRows(undefined);
    // 几百段×几种规则：放到下一拍算，不卡住界面
    const id = window.setTimeout(() => setHistRows(rulesHistory(s, setup, openSec, side)), 30);
    return () => window.clearTimeout(id);
  }, [s, setup, openSec, side]);

  const money = (v: number) => `${v < -0.005 ? "−" : v > 0.005 ? "+" : ""}$${Math.abs(v).toFixed(2)}`;
  const usd = (v: number) => `$${Math.abs(v).toFixed(2)}`;
  const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;
  const describe = (r: SimRules) =>
    [
      `${t("winRate.tp")} ${r.takeProfitPct == null ? t("winRate.none") : t("winRate.tpOpt", { n: r.takeProfitPct * 100 })}`,
      `${t("winRate.sl")} ${r.stopMult == null ? t("winRate.none") : credit ? t("winRate.slOpt", { n: r.stopMult }) : t("winRate.slOptDebit", { n: r.stopMult * 100 })}`,
      ...(r.deltaExit != null ? [t("future.deltaRuleShort", { d: r.deltaExit.toFixed(2) })] : []),
      r.closeFrac > 0 ? t("winRate.closeOptFrac", { f: fracLabel(r.closeFrac), d: Math.max(1, Math.round(horizon * r.closeFrac)) }) : t("winRate.holdToExpiry"),
    ].join(" · ");
  const lbl = (k: string) => <span className="text-[11px] font-bold text-sky-300">{t(k)} </span>;
  const out: ReactNode[] = [];

  if (series.status === "loading" && !s) {
    out.push(sec("rh", t("rh.title", { s: symbol }), <span className="text-slate-500">{t("rh.loading")}</span>));
    return <>{out}</>;
  }
  if (!s) {
    out.push(sec("rh", t("rh.title", { s: symbol }), <span className="text-slate-500">{t("rh.noData")}</span>));
    return <>{out}</>;
  }

  // ⑦ ① ② ③
  const parts: ReactNode[] = [];
  if (reg) {
    const mx = Math.max(...reg.bins.map((b) => b.count)) || 1;
    const rare = regPct < 15;
    const k = Math.max(1, Math.round(100 / Math.max(1, regPct)));
    const lose = pnlNow < 0;
    const sp = reg.split;
    const fmtDay = (sec: number) => new Date(sec * 1000).toISOString().slice(5, 10).replace("-", "/");
    parts.push(
      <div key="r1" className="flex flex-col gap-1">
        <div className="text-[11px] font-semibold text-slate-200">{t("rh.r1Title")}</div>
        {sp ? (
          // 分开算时：每根柱子下面是没跨财报的段（灰），上面叠跨过财报的段（紫）；比你更极端的那几格颜色深，你那一格顶上一道金边
          <div className="flex h-[54px] items-end gap-[2px]" aria-label={t("rh.r1Title")}>
            {reg.bins.map((b, i) => {
              const mine = reg.myRet >= b.lo && reg.myRet <= b.hi;
              const beyond = reg.myRet < 0 ? b.hi <= reg.myRet : b.lo >= reg.myRet;
              const op = beyond || mine ? 1 : 0.5;
              return (
                <span key={i} className="flex flex-1 flex-col justify-end" style={{ height: `${Math.max(2, (b.count / mx) * 50)}px`, borderTop: mine ? "2px solid #fbbf24" : undefined }}>
                  <span style={{ flexGrow: b.earn, background: "#a78bfa", opacity: op }} />
                  <span style={{ flexGrow: b.count - b.earn, background: beyond ? "#94a3b8" : "#475569", opacity: op }} />
                </span>
              );
            })}
          </div>
        ) : (
          <div className="flex h-[54px] items-end gap-[2px]" aria-label={t("rh.r1Title")}>
            {reg.bins.map((b, i) => {
              const mine = reg.myRet >= b.lo && reg.myRet <= b.hi;
              const beyond = reg.myRet < 0 ? b.hi <= reg.myRet : b.lo >= reg.myRet;
              return <span key={i} className="flex-1 rounded-t-sm" style={{ height: `${Math.max(2, (b.count / mx) * 50)}px`, background: mine ? "#fbbf24" : beyond ? "#f97316" : "#334155" }} />;
            })}
          </div>
        )}
        <div className="flex justify-between text-[10px] text-slate-500">
          <span>{pct(reg.bins[0].lo)}</span>
          {sp && (
            <span className="flex gap-2">
              <span><span className="mr-1 inline-block h-2 w-2 bg-violet-400" />{t("rh.r1LegendEarn")}</span>
              <span><span className="mr-1 inline-block h-2 w-2 bg-slate-500" />{t("rh.r1LegendPlain")}</span>
            </span>
          )}
          <span>{pct(reg.bins[reg.bins.length - 1].hi)}</span>
        </div>
        <div>
          {lbl("rh.what")}
          {sp
            ? t(reg.myRet < 0 ? "rh.r1SplitDown" : "rh.r1SplitUp", {
                d: days, r: Math.abs(reg.myRet * 100).toFixed(1),
                mine: myEarn ? t("rh.r1MineEarn", { date: myEarn.date.slice(5).replace("-", "/") }) : t("rh.r1MinePlain"),
                ne: sp.earn.n, pe: sp.earn.pct < 1 && sp.earn.pct > 0 ? "<1" : Math.round(sp.earn.pct), np: sp.plain.n, pp: sp.plain.pct < 1 && sp.plain.pct > 0 ? "<1" : Math.round(sp.plain.pct),
              })
            : t(reg.myRet < 0 ? "rh.r1WhatDown" : "rh.r1WhatUp", { d: days, r: Math.abs(reg.myRet * 100).toFixed(1), p: Math.round(reg.pctMoreExtreme), n: reg.n })}
        </div>
        {big && Math.abs(big.move) >= 0.02 && (
          <div>
            {lbl("rh.r1Big")}
            {t(big.earn ? "rh.r1BigEarn" : reactions.length ? "rh.r1BigNews" : "rh.r1BigPlain", { date: fmtDay(big.t), m: pct(big.move) })}
          </div>
        )}
        <div>{lbl("rh.mean")}{t(rare ? (lose ? "rh.r1RareLose" : "rh.r1RareWin") : lose ? "rh.r1CommonLose" : "rh.r1CommonWin", { k })}</div>
      </div>,
    );
  } else {
    parts.push(<div key="r1" className="text-slate-500">{t("rh.r1None")}</div>);
  }
  if (eq) {
    const edge = credit ? eq.basis - eq.fair : eq.fair - eq.basis;
    const edgePct = eq.fair > 0.005 ? (edge / (credit ? eq.fair : eq.basis)) * 100 : 0;
    const good = edge > 0.01;
    const near = eq.shortDist != null && eq.shortDist < 0.03;
    const rare = reg ? regPct < 15 : false;
    const lose = pnlNow < 0;
    const meanKey = !good ? "rh.r2NoEdge" : lose && rare ? "rh.r2EdgeBadLuck" : lose && near ? "rh.r2EdgeTooNear" : lose ? "rh.r2EdgeLose" : "rh.r2EdgeWin";
    const cell = (k: string, v: string, cls = "text-slate-100") => (
      <div className="flex min-w-0 flex-col"><span className="text-[10px] text-slate-400">{t(k)}</span><span className={`text-[14px] font-bold tabular-nums ${cls}`}>{v}</span></div>
    );
    parts.push(
      <div key="r2" className="flex flex-col gap-1 border-t border-slate-800/70 pt-1.5">
        <div className="text-[11px] font-semibold text-slate-200">{t("rh.r2Title")}</div>
        <div className="grid grid-cols-4 gap-2">
          {cell("rh.r2Win", `${eq.winPct.toFixed(0)}%`)}
          {cell("rh.r2Fair", usd(eq.fair))}
          {cell(credit ? "rh.r2PaidCredit" : "rh.r2PaidDebit", `${usd(eq.basis)}（${edgePct >= 0 ? "+" : "−"}${Math.abs(edgePct).toFixed(0)}%）`, good ? "text-emerald-300" : "text-rose-300")}
          {cell("rh.r2Dist", eq.shortDist == null ? "—" : `${(eq.shortDist * 100).toFixed(1)}%`, near ? "text-amber-300" : "text-slate-100")}
        </div>
        <div>{lbl("rh.mean")}{t(meanKey, { w: eq.winPct.toFixed(0), f: usd(eq.fair), b: usd(eq.basis), e: Math.abs(edgePct).toFixed(0), dist: eq.shortDist == null ? "—" : (eq.shortDist * 100).toFixed(1), n: eq.n })}</div>
        <div>{lbl("rh.how")}{t(!good ? "rh.r2HowNoEdge" : near ? "rh.r2HowNear" : "rh.r2HowOk")}</div>
      </div>,
    );
  } else {
    parts.push(<div key="r2" className="border-t border-slate-800/70 pt-1.5 text-slate-500">{t("rh.r2None")}</div>);
  }
  {
    let body: ReactNode;
    if (!adjusted || !firstAdj) body = <span className="text-slate-400">{t("rh.r3NoAdj")}</span>;
    else if (!adj) body = <span className="text-slate-500">{t("rh.r3None")}</span>;
    else {
      const via = t(`future.adjVia_${firstAdj.via}`);
      const crossed = adj.dist < 0;
      body = (
        <>
          <div>{lbl("rh.what")}{t(crossed ? "rh.r3WhatCrossed" : "rh.r3What", { day: firstAdj.day, via, s: adj.price.toFixed(2), k: adj.leg.strike, d: Math.abs(adj.dist * 100).toFixed(1), r: adj.remaining, p: Math.round(adj.pBeyond), n: adj.n })}</div>
          <div>{lbl("rh.mean")}{t(adj.pBeyond >= 50 ? "rh.r3MeanLikely" : "rh.r3MeanUnlikely", { via, p: Math.round(adj.pBeyond), q: 100 - Math.round(adj.pBeyond) })}</div>
          <div>{lbl("rh.how")}{t("rh.r3How", { p: Math.round(adj.pBeyond), via })}</div>
        </>
      );
    }
    parts.push(
      <div key="r3" className="flex flex-col gap-1 border-t border-slate-800/70 pt-1.5">
        <div className="text-[11px] font-semibold text-slate-200">{t("rh.r3Title")}</div>
        {body}
      </div>,
    );
  }
  out.push(sec("rh", t("rh.title", { s: symbol }), <div className="flex flex-col gap-1.5">{parts}<div className="text-[10px] text-slate-500">{t("rh.note")}</div></div>));

  // ⑧ 规则复盘：这一次 vs 过去2年
  const th = "px-1.5 py-1 text-left font-normal text-slate-500";
  const td = "px-1.5 py-1 tabular-nums";
  let table: ReactNode = null;
  let what = "";
  let how = "";
  if (view === "once" && once && once.length) {
    const best = once.reduce((a, b) => (b.pnl > a.pnl ? b : a));
    const cur = once[0];
    const kindTxt = (k: string) => t(`rh.kind_${k}`);
    table = (
      <table className="w-full min-w-[520px] border-collapse text-[10.5px]">
        <thead><tr className="border-b border-slate-800">
          <th className={th}>{t("future.rtRule")}</th><th className={th}>{t("rh.colResult")}</th><th className={th}>{t("rh.colDay")}</th><th className={th}>{t("future.rtCost")}</th><th className={th}>{t("rh.colPnl")}</th>
        </tr></thead>
        <tbody>
          {once.map((r, i) => (
            <tr key={i} className={`border-b border-slate-800/60 ${r === best ? "bg-sky-950/40" : ""}`}>
              <td className={`px-1.5 py-1 ${i === 0 ? "font-semibold text-slate-100" : "text-slate-300"}`}>{i === 0 && <span className="mr-1 text-sky-300">{t("future.rtCurrent")}</span>}{describe(r.rules)}</td>
              <td className={td}>{kindTxt(r.kind)}</td>
              <td className={td}>{r.kind === "holding" ? t("rh.stillHolding", { d: r.day }) : t("future.rtDaysVal", { d: r.day })}</td>
              <td className={td}>{r.cost > 0 ? usd(r.cost) : "—"}</td>
              <td className={`${td} font-bold ${r.pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(r.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
    what = best === cur
      ? t("rh.onceWhatCurrentBest", { v: money(cur.pnl) })
      : t("rh.onceWhat", { c: kindTxt(cur.kind), cv: money(cur.pnl), b: describe(best.rules), bv: money(best.pnl), d: usd(best.pnl - cur.pnl) });
    how = t("rh.onceHow");
  } else if (view === "hist") {
    if (histRows === undefined) table = <span className="text-slate-500">{t("rh.histPending")}</span>;
    else if (!histRows) table = <span className="text-slate-500">{t("rh.histNone")}</span>;
    else {
      const rows = [...histRows.rows].sort((a, b) => b.avg - a.avg);
      const top = rows[0];
      table = (
        <table className="w-full min-w-[560px] border-collapse text-[10.5px]">
          <thead><tr className="border-b border-slate-800">
            <th className={th}>{t("future.rtRule")}</th><th className={th}>{t("future.rtWin")}</th><th className={th}>{t("future.rtDays")}</th><th className={th}>{t("future.rtAvg")}</th><th className={th}>{t("future.rtPer30")}</th><th className={th}>{t("future.rtWorst")}</th><th className={th} />
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-b border-slate-800/60 ${i === 0 ? "bg-sky-950/40" : ""}`}>
                <td className={`px-1.5 py-1 ${r.current ? "font-semibold text-slate-100" : "text-slate-300"}`}>{r.current && <span className="mr-1 text-sky-300">{t("future.rtCurrent")}</span>}{describe(r.rules)}</td>
                <td className={td}>{r.winPct.toFixed(0)}%</td>
                <td className={td}>{t("future.rtDaysVal", { d: r.avgDays.toFixed(0) })}</td>
                <td className={`${td} font-bold ${r.avg >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(r.avg)}</td>
                <td className={`${td} ${r.per30 >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(r.per30)}</td>
                <td className={`${td} text-rose-300`}>{money(r.worst5)}</td>
                <td className="px-1.5 py-1">{!r.current && <button onClick={() => setSideRules(side, r.rules)} className="rounded border border-sky-600 px-1 py-0 text-[10px] text-sky-300 hover:bg-sky-500/20">{t("future.altApply")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
      const onceBest = once && once.length ? once.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null;
      what = top.avg < 0 ? t("rh.histAllLose") : t("rh.histWhat", { r: describe(top.rules), a: money(top.avg), p30: money(top.per30), w: money(top.worst5), n: histRows.rows.length });
      how = onceBest && sameRules(onceBest.rules, top.rules) ? t("rh.histSame") : t("rh.histDiff");
    }
  }
  const btn = (v: "once" | "hist", k: string) => (
    <button type="button" onClick={() => setView(v)} className={`px-1.5 py-0.5 text-[10px] font-semibold ${view === v ? "bg-sky-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>{t(k)}</button>
  );
  out.push(
    sec("rh8", t("rh.r8Title"), (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
          <span className="flex overflow-hidden rounded border border-slate-700">{btn("once", "rh.viewOnce")}{btn("hist", "rh.viewHist")}</span>
          <span>{t(view === "once" ? "rh.onceSub" : "rh.histSub")}</span>
        </div>
        <div className="overflow-x-auto">{table}</div>
        {what && <div>{lbl("rh.what")}{what}</div>}
        {how && <div>{lbl("rh.how")}{how}</div>}
        <div className="text-[10px] text-slate-500">{t("rh.r8Note")}</div>
      </div>
    )),
  );
  return <>{out}</>;
}
