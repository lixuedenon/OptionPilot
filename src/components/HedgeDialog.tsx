import { useState, useMemo, useEffect } from "react";
import { Layers, X, RefreshCw } from "lucide-react";
import type { Leg } from "@/lib/types";
import { dateFromDte, dteFromDate, todayISO, nearestFridayDte } from "@/lib/dateUtils";
import { blackScholes } from "@/lib/bs";
import { impliedVol } from "@/lib/pricing";
import { fetchLegPremium } from "@/lib/optionChain";
import { useI18n } from "@/i18n/I18nContext";

const RATE = 0.05;

const inp =
  "w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 focus:border-violet-500 focus:outline-none tabular-nums";

interface Props {
  legs: Leg[];
  spot: number;
  symbol?: string;
  onClose: () => void;
  onConfirm: (hedgeLeg: Leg) => void;
}

export default function HedgeDialog({ legs, spot, symbol, onClose, onConfirm }: Props) {
  const { t } = useI18n();
  const sym = symbol?.trim() ?? "";
  // Calculate total portfolio delta
  const portfolioDelta = useMemo(() => {
    let total = 0;
    for (const l of legs) {
      if (l.disabled) continue;
      if (l.kind === "stock") {
        const sign = l.action === "buy" ? 1 : -1;
        total += sign * (l.shares ?? 100) / 100;
        continue;
      }
      if (spot <= 0 || l.premium <= 0) continue;
      const iv = impliedVol(spot, l.strike, l.dte, l.premium, l.type);
      const greeks = blackScholes({ spot, strike: l.strike, dte: l.dte, vol: iv, rate: RATE, type: l.type });
      const sign = l.action === "buy" ? 1 : -1;
      total += sign * greeks.delta;
    }
    return total;
  }, [legs, spot]);

  const hedgeShares = Math.round(Math.abs(portfolioDelta) * 100);
  const hedgeAction = portfolioDelta > 0 ? "sell" : "buy";

  const [method, setMethod] = useState<"stock" | "option">("stock");
  const [optType, setOptType] = useState<"call" | "put">(
    portfolioDelta > 0 ? "put" : "call",
  );
  const [strike, setStrike] = useState(
    Math.round((spot > 0 ? spot : 100) * 2) / 2,
  );
  const [dte, setDte] = useState(() => nearestFridayDte(30));
  const [premiumTouched, setPremiumTouched] = useState(false);
  const [premium, setPremium] = useState(0);
  const [liveFetching, setLiveFetching] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveNote, setLiveNote] = useState<string | null>(null);

  const newDate = dateFromDte(dte);

  const estimatePremium = useMemo(() => {
    if (spot <= 0) return 0;
    // Use a rough IV: average of existing legs or 0.3 fallback
    let iv = 0.3;
    let weightSum = 0;
    let ivSum = 0;
    for (const l of legs) {
      if (l.disabled || l.kind === "stock" || l.premium <= 0) continue;
      const w = Math.abs(l.premium);
      ivSum += impliedVol(spot, l.strike, l.dte, l.premium, l.type) * w;
      weightSum += w;
    }
    if (weightSum > 0) iv = ivSum / weightSum;
    return Math.round(
      blackScholes({ spot, strike, dte, vol: iv, rate: RATE, type: optType }).price * 100,
    ) / 100;
  }, [spot, legs, strike, dte, optType]);

  // Follow the recomputed estimate as strike/expiry/type change, unless the
  // user has typed their own premium — otherwise confirming without touching
  // this field silently adds a leg priced at $0.
  useEffect(() => {
    if (!premiumTouched) setPremium(estimatePremium);
  }, [estimatePremium, premiumTouched]);

  // With a symbol available (and hedging with an option), replace the
  // theoretical estimate with a real listed strike/expiry/premium.
  useEffect(() => {
    if (!sym || method !== "option" || premiumTouched) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLiveFetching(true);
      setLiveError(null);
      try {
        const result = await fetchLegPremium(sym, optType, strike, dte, true);
        if (cancelled) return;
        if (result.strikeSnapped) setStrike(result.actualStrike);
        if (result.expirySnapped) setDte(result.actualDte);
        setPremium(result.premium);
        setLiveNote(
          result.strikeSnapped || result.expirySnapped
            ? t("leg.priceSnapNote", { strike: result.actualStrike, date: result.actualExpiryDate })
            : null,
        );
      } catch (e) {
        if (!cancelled) setLiveError(e instanceof Error ? e.message : t("leg.fetchPriceFailed"));
      } finally {
        if (!cancelled) setLiveFetching(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, method, strike, dte, optType, premiumTouched]);

  const handleConfirm = () => {
    if (method === "stock") {
      const hedgeLeg: Leg = {
        id: `leg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        action: hedgeAction,
        type: "call",
        strike: spot,
        dte: 0,
        premium: 0,
        kind: "stock",
        shares: hedgeShares,
      };
      onConfirm(hedgeLeg);
    } else {
      const hedgeLeg: Leg = {
        id: `leg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        action: "buy",
        type: optType,
        strike,
        dte,
        premium,
      };
      onConfirm(hedgeLeg);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[440px] max-w-[90vw] rounded-xl border border-violet-500/30 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-violet-400" />
            <h3 className="text-sm font-bold text-violet-200">{t("hedge.title")}</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 transition hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        {/* Portfolio delta display */}
        <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("hedge.portfolioDelta")}</span>
            <span className={`text-lg font-bold tabular-nums ${portfolioDelta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {portfolioDelta >= 0 ? "+" : ""}{portfolioDelta.toFixed(2)}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            {Math.abs(portfolioDelta) < 0.01
              ? t("hedge.deltaNeutral")
              : `${t("hedge.needHedge")} ${hedgeAction === "buy" ? t("hedge.buy") : t("hedge.sell")} ${t("hedge.about")} ${hedgeShares} ${t("hedge.shares")} ${t("hedge.stock")} ${t("hedge.needHedgeSuffix")}`}
          </div>
        </div>

        {/* Method selection */}
        <div className="mb-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("hedge.method")}</div>
          <div className="flex gap-2">
            <button
              onClick={() => setMethod("stock")}
              className={`flex-1 rounded border px-3 py-2 text-[11px] font-semibold transition ${
                method === "stock"
                  ? "border-violet-500 bg-violet-950/30 text-violet-300"
                  : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-500"
              }`}
            >
              {t("hedge.stockHedge")}
            </button>
            <button
              onClick={() => setMethod("option")}
              className={`flex-1 rounded border px-3 py-2 text-[11px] font-semibold transition ${
                method === "option"
                  ? "border-violet-500 bg-violet-950/30 text-violet-300"
                  : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-500"
              }`}
            >
              {t("hedge.optionHedge")}
            </button>
          </div>
        </div>

        {method === "stock" ? (
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3 text-xs text-slate-300">
            <span>{hedgeAction === "buy" ? t("hedge.buy") : t("hedge.sell")} </span>
            <span className="font-semibold text-violet-300">{hedgeShares} {t("hedge.shares")}</span>
            <span> {t("hedge.stock")}（{t("hedge.about")} {Math.abs(portfolioDelta).toFixed(2)} {t("hedge.deltaLabel")}）</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-3">
              <label className="flex-1">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("hedge.type")}</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setPremiumTouched(false); setLiveNote(null); setOptType("call"); }}
                    className={`flex-1 rounded border px-2 py-1.5 text-[11px] font-semibold transition ${
                      optType === "call" ? "border-sky-500 bg-sky-950/30 text-sky-300" : "border-slate-700 bg-slate-800 text-slate-400"
                    }`}
                  >
                    Call
                  </button>
                  <button
                    onClick={() => { setPremiumTouched(false); setLiveNote(null); setOptType("put"); }}
                    className={`flex-1 rounded border px-2 py-1.5 text-[11px] font-semibold transition ${
                      optType === "put" ? "border-violet-500 bg-violet-950/30 text-violet-300" : "border-slate-700 bg-slate-800 text-slate-400"
                    }`}
                  >
                    Put
                  </button>
                </div>
              </label>
              <label className="flex-1">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("hedge.strike")}</span>
                <input
                  type="number"
                  step={0.5}
                  value={strike}
                  onChange={(e) => { setPremiumTouched(false); setLiveNote(null); setStrike(parseFloat(e.target.value) || 0); }}
                  className={inp}
                />
              </label>
            </div>
            <div className="flex gap-3">
              <label className="flex-1">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("hedge.expiry")}</span>
                <input
                  type="date"
                  value={newDate}
                  min={todayISO()}
                  onChange={(e) => {
                    if (e.target.value) {
                      const d = dteFromDate(e.target.value);
                      if (d >= 0) { setPremiumTouched(false); setLiveNote(null); setDte(d); }
                    }
                  }}
                  className={inp}
                />
              </label>
              <label className="flex-1">
                <span className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("hedge.premium")}
                  {liveFetching && <RefreshCw size={9} className="animate-spin text-violet-400" />}
                </span>
                <input
                  type="number"
                  step={0.01}
                  value={premium}
                  onChange={(e) => { setPremiumTouched(true); setPremium(parseFloat(e.target.value) || 0); }}
                  className={inp}
                />
              </label>
            </div>
            {sym ? (
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                {liveFetching ? (
                  <span className="flex items-center gap-1 text-violet-400">
                    <RefreshCw size={10} className="animate-spin" /> {t("roll.fetchingLive")}
                  </span>
                ) : liveError ? (
                  <span className="text-rose-400">{liveError}</span>
                ) : liveNote ? (
                  <span className="text-violet-400">{liveNote}</span>
                ) : (
                  <span className="text-emerald-400">{t("roll.liveDataUsed")}</span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span>{t("hedge.refPremium")}</span>
                <button
                  onClick={() => { setPremiumTouched(false); setPremium(estimatePremium); }}
                  className="font-semibold text-violet-400 transition hover:text-violet-300"
                >
                  {estimatePremium.toFixed(2)}
                </button>
                <span className="text-slate-600">{t("hedge.clickToUse")}</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            {t("hedge.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={method === "option" && liveFetching}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("hedge.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}