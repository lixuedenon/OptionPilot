// src/components/OrderHintBox.tsx
// 挂单提示框（2026-10-06）：分析模式里，某条腿的权利金（或整单净价）跟市场中间价差得多时，在腿位下面说清楚
// "按这个价挂单，股价要到多少才会成交、今天/3天内成交的机会、代价是什么"。计算在lib/orderHint.ts。
// 市场中间价从期权链缓存取（optionChain.getOptionChain，腿位自动填价时通常已经拉过，不会多一次请求）。
// 用户如果是在记录"我已经按这个价成交了"，可以点"不用提示"收起（记在LegListSection，按腿+价格，改了价格会再出现）。
import { useEffect, useMemo, useState } from "react";
import type { Leg } from "@/lib/types";
import { useI18n } from "@/i18n/I18nContext";
import { getOptionChain, premiumFromQuote } from "@/lib/optionChain";
import { legOrderHint, comboOrderHint, nearestBreakeven, type OrderHint } from "@/lib/orderHint";
import { skewFromChain } from "@/lib/atmIv";
import { useSimSettings } from "@/lib/simSettings";

// 期权链里这条腿的市场中间价；取不到为null
function useMids(symbol: string, legs: Leg[], spot = 0): { mids: (number | null)[]; skew: number } {
  const sym = symbol.trim().toUpperCase();
  const key = legs.map((l) => `${l.kind ?? "option"}:${l.type}:${l.strike}:${l.dte}`).join("|");
  const [mids, setMids] = useState<(number | null)[]>(() => legs.map(() => null));
  const [skew, setSkew] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!sym) {
      setMids(legs.map(() => null));
      return;
    }
    Promise.all(
      legs.map(async (l) => {
        if (l.kind === "stock" || !(l.dte > 0)) return null;
        try {
          const c = await getOptionChain(sym, l.dte);
          const q = (l.type === "call" ? c.calls : c.puts).find((r) => r.strike === l.strike);
          const m = q ? premiumFromQuote(q) : 0;
          return m > 0 ? m : null;
        } catch {
          return null;
        }
      }),
    ).then((r) => alive && setMids(r));
    // 微笑斜率：用最早到期那条腿的期权链（跟万次推演同一种估法）
    const near = legs.filter((l) => l.kind !== "stock" && l.dte > 0).sort((a, b) => a.dte - b.dte)[0];
    if (near && spot > 0) getOptionChain(sym, near.dte).then((c) => alive && setSkew(skewFromChain(c, spot, near.dte))).catch(() => alive && setSkew(0));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, key, spot > 0]);
  return { mids, skew };
}

const usd = (v: number) => `$${Math.abs(v).toFixed(2)}`;
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;
const odds = (v: number) => (v > 0 && v < 0.01 ? "<1" : String(Math.round(v * 100)));

function where(h: OrderHint, which: "now" | "day3", spot: number, t: (k: string, v?: Record<string, string | number>) => string): string | null {
  const w = h[which];
  const part = (p: number | null, dir: "down" | "up") => (p == null ? null : t(dir === "down" ? "order.fallTo" : "order.riseTo", { s: p.toFixed(2), c: pct(p / spot - 1) }));
  const parts = [part(w.down, "down"), part(w.up, "up")].filter(Boolean) as string[];
  return parts.length ? parts.join(t("order.or")) : null;
}

function Box({ title, lines, onDismiss }: { title: string; lines: string[]; onDismiss?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="ml-6 mt-0.5 rounded border border-amber-800/70 bg-amber-950/25 px-2 py-1 text-[10.5px] leading-snug text-slate-300">
      <div className="font-semibold text-amber-300">{title}</div>
      {lines.map((l, i) => (
        <div key={i} className={i === 0 ? "" : "text-slate-400"}>{l}</div>
      ))}
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="mt-0.5 text-[10px] text-sky-400 underline-offset-2 hover:underline">
          {t("order.dismiss")}
        </button>
      )}
    </div>
  );
}

// 单腿
export function LegOrderHint({ leg, symbol, spot, onDismiss }: { leg: Leg; symbol: string; spot: number; onDismiss: () => void }) {
  const { t } = useI18n();
  const { ivSkewOn } = useSimSettings(symbol);
  const { mids, skew } = useMids(symbol, [leg], spot);
  const mid = mids[0];
  const sk = ivSkewOn ? skew : 0;
  const h = useMemo(() => (mid != null && spot > 0 && !leg.disabled ? legOrderHint(leg, mid, spot, sk) : null), [leg, mid, spot, sk]);
  if (!h) return null;
  const sell = h.side === 1;
  if (h.kind === "marketable") {
    return (
      <Box
        title={t(sell ? "order.legMarketableSell" : "order.legMarketableBuy", { p: usd(h.limit) })}
        lines={[t(sell ? "order.legMarketableSellWhy" : "order.legMarketableBuyWhy", { p: usd(h.limit), m: usd(h.market), d: usd(h.limit - h.market) })]}
        onDismiss={onDismiss}
      />
    );
  }
  const w0 = where(h, "now", spot, t);
  const w3 = where(h, "day3", spot, t);
  const lines: string[] = [];
  if (!w0) lines.push(t("order.unreachable"));
  else {
    lines.push(t("order.legWait", { w0, w3: w3 ?? w0, o1: odds(h.odds?.[0] ?? 0), o3: odds(h.odds?.[1] ?? 0) }));
    const fill = h.now.down ?? h.now.up!;
    lines.push(
      sell && (leg.type === "put" ? fill <= leg.strike : fill >= leg.strike)
        ? t("order.legCostSellItm", { k: leg.strike, d: usd(h.limit - h.market) })
        : sell
        ? t("order.legCostSell", { k: leg.strike, f: (Math.abs(fill / leg.strike - 1) * 100).toFixed(1), n: (Math.abs(spot / leg.strike - 1) * 100).toFixed(1), d: usd(h.limit - h.market) })
        : t("order.legCostBuy", { d: usd(h.market - h.limit) }),
    );
  }
  lines.push(sk > 0 ? t("order.ivNoteSkew", { k: (sk * 10).toFixed(1) }) : t("order.ivNote"));
  return <Box title={t(sell ? "order.legTitleSell" : "order.legTitleBuy", { p: usd(h.limit), m: usd(h.market) })} lines={lines} onDismiss={onDismiss} />;
}

// 整单（两条以上期权腿）
export function ComboOrderHint({ legs, symbol, spot, onDismiss }: { legs: Leg[]; symbol: string; spot: number; onDismiss: () => void }) {
  const { t } = useI18n();
  const active = useMemo(() => legs.filter((l) => !l.disabled && l.kind !== "stock"), [legs]);
  const { ivSkewOn } = useSimSettings(symbol);
  const { mids, skew } = useMids(symbol, active, spot);
  const sk = ivSkewOn ? skew : 0;
  const h = useMemo(() => {
    if (active.length < 2 || mids.some((m) => m == null) || !(spot > 0)) return null;
    return comboOrderHint(active.map((leg, i) => ({ leg, mid: mids[i]! })), spot, sk);
  }, [active, mids, spot, sk]);
  if (!h || h.kind !== "wait") return null;
  const credit = h.side === 1;
  const w0 = where(h, "now", spot, t);
  const w3 = where(h, "day3", spot, t);
  const lines: string[] = [];
  if (!w0) lines.push(t("order.unreachable"));
  else {
    lines.push(t("order.comboWait", { w0, w3: w3 ?? w0, o1: odds(h.odds?.[0] ?? 0), o3: odds(h.odds?.[1] ?? 0) }));
    // 代价：成交时离盈亏平衡还剩多少 vs 按市场价现在开
    const netMine = credit ? h.limit : -h.limit;
    const netMkt = credit ? h.market : -h.market;
    const fill = h.now.down != null && h.now.up != null ? (Math.abs(h.now.down - spot) <= Math.abs(h.now.up - spot) ? h.now.down : h.now.up) : (h.now.down ?? h.now.up!);
    const beMine = nearestBreakeven(active, netMine, fill);
    const beMkt = nearestBreakeven(active, netMkt, spot);
    if (beMine != null && beMkt != null) {
      lines.push(t("order.comboCost", {
        f: fill.toFixed(2), cf: (Math.abs(fill - beMine) / fill * 100).toFixed(1), cn: (Math.abs(spot - beMkt) / spot * 100).toFixed(1),
        d: usd(h.limit - h.market), kind: t(credit ? "order.moreCredit" : "order.lessCost"),
      }));
    }
  }
  lines.push(sk > 0 ? t("order.ivNoteSkew", { k: (sk * 10).toFixed(1) }) : t("order.ivNote"));
  return (
    <Box
      title={t(credit ? "order.comboTitleCredit" : "order.comboTitleDebit", { p: usd(h.limit), m: usd(h.market) })}
      lines={lines}
      onDismiss={onDismiss}
    />
  );
}
