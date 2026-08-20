import { useState, useMemo, useEffect } from "react";
import { Shield, X, RefreshCw } from "lucide-react";
import type { Leg } from "@/lib/types";
import { dateFromDte, dteFromDate, todayISO, nearestFridayDte } from "@/lib/dateUtils";
import { blackScholes } from "@/lib/bs";
import { impliedVol } from "@/lib/pricing";
import { fetchLegPremium } from "@/lib/optionChain";
import { useI18n } from "@/i18n/I18nContext";

const RATE = 0.05;

const inp =
  "w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none tabular-nums";

interface Props {
  leg: Leg;
  spot: number;
  symbol?: string;
  onClose: () => void;
  onConfirm: (protectLeg: Leg) => void;
}

export default function ProtectDialog({ leg, spot, symbol, onClose, onConfirm }: Props) {
  const { t } = useI18n();
  const sym = symbol?.trim() ?? "";
  // Protection logic:
  // short call → buy call at higher strike
  // short put → buy put at lower strike
  // long call → sell call at higher strike (covered call / take profit)
  // long put → sell put at lower strike
  const isShort = leg.action === "sell";
  const protectAction = isShort ? "buy" : "sell";
  const protectType = leg.type;

  const suggestedStrike = useMemo(() => {
    if (isShort) {
      // buy further OTM: call → higher, put → lower
      return leg.type === "call"
        ? Math.round((leg.strike + Math.max(2.5, spot * 0.02)) * 2) / 2
        : Math.round((leg.strike - Math.max(2.5, spot * 0.02)) * 2) / 2;
    }
    // long position: sell further OTM
    return leg.type === "call"
      ? Math.round((leg.strike + Math.max(2.5, spot * 0.02)) * 2) / 2
      : Math.round((leg.strike - Math.max(2.5, spot * 0.02)) * 2) / 2;
  }, [leg, isShort, spot]);

  const suggestedDte = Math.max(7, nearestFridayDte(Math.round(leg.dte)));

  const [strike, setStrike] = useState(suggestedStrike);
  const [dte, setDte] = useState(suggestedDte);
  const [premiumTouched, setPremiumTouched] = useState(false);
  const [premium, setPremium] = useState(0);
  const [liveFetching, setLiveFetching] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveNote, setLiveNote] = useState<string | null>(null);

  const newDate = dateFromDte(dte);

  const estimatePremium = useMemo(() => {
    if (spot <= 0) return 0;
    const iv = impliedVol(spot, leg.strike, leg.dte, leg.premium, leg.type);
    return Math.round(
      blackScholes({ spot, strike, dte, vol: iv, rate: RATE, type: protectType }).price * 100,
    ) / 100;
  }, [spot, leg, strike, dte, protectType]);

  // Follow the recomputed estimate as strike/expiry change, unless the user
  // has typed their own premium — otherwise confirming without touching this
  // field silently adds a leg priced at $0.
  useEffect(() => {
    if (!premiumTouched) setPremium(estimatePremium);
  }, [estimatePremium, premiumTouched]);

  // With a symbol available, replace the theoretical estimate with a real
  // listed strike/expiry/premium — same pattern LegRow uses for auto-fill.
  useEffect(() => {
    if (!sym || premiumTouched) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLiveFetching(true);
      setLiveError(null);
      try {
        const result = await fetchLegPremium(sym, protectType, strike, dte, true);
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
  }, [sym, strike, dte, protectType, premiumTouched]);

  const handleConfirm = () => {
    const protectLeg: Leg = {
      id: `leg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action: protectAction as "buy" | "sell",
      type: protectType,
      strike,
      dte,
      premium,
    };
    onConfirm(protectLeg);
  };

  const description = isShort
    ? `${t("protect.descShort")} ${leg.type === "call" ? "Call" : "Put"} ${t("protect.descShortSuffix")}`
    : `${t("protect.descLong")} ${leg.type === "call" ? "Call" : "Put"} ${t("protect.descLongSuffix")}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[420px] max-w-[90vw] rounded-xl border border-sky-500/30 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-sky-400" />
            <h3 className="text-sm font-bold text-sky-200">{isShort ? t("protect.titleProtect") : t("protect.titleTakeProfit")}</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 transition hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        <p className="mb-4 text-[11px] leading-relaxed text-slate-400">{description}</p>

        {/* Original leg */}
        <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("protect.originalLeg")}</div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-300">
            <span>{leg.action === "buy" ? t("leg.buy") : t("leg.sell")} {leg.type === "call" ? "Call" : "Put"}</span>
            <span>{t("protect.strike")} <span className="font-semibold text-slate-100">{leg.strike}</span></span>
            <span>{t("protect.expiry")} <span className="font-semibold text-slate-100">{dateFromDte(Math.round(leg.dte))}</span></span>
          </div>
        </div>

        {/* Protection leg */}
        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
              {isShort ? t("protect.protectLeg") : t("protect.takeProfitLeg")}（{protectAction === "buy" ? t("protect.buyLabel") : t("protect.sellLabel")} {protectType === "call" ? "Call" : "Put"}）
            </div>
            <div className="flex gap-3">
              <label className="flex-1">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("protect.strike")}</span>
                <input
                  type="number"
                  step={0.5}
                  value={strike}
                  onChange={(e) => { setPremiumTouched(false); setLiveNote(null); setStrike(parseFloat(e.target.value) || 0); }}
                  className={inp}
                />
              </label>
              <label className="flex-1">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("protect.expiry")}</span>
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
                  {t("protect.premium")}
                  {liveFetching && <RefreshCw size={9} className="animate-spin text-sky-400" />}
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
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                {liveFetching ? (
                  <span className="flex items-center gap-1 text-sky-400">
                    <RefreshCw size={10} className="animate-spin" /> {t("roll.fetchingLive")}
                  </span>
                ) : liveError ? (
                  <span className="text-rose-400">{liveError}</span>
                ) : liveNote ? (
                  <span className="text-sky-400">{liveNote}</span>
                ) : (
                  <span className="text-emerald-400">{t("roll.liveDataUsed")}</span>
                )}
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                <span>{t("protect.refPremium")}</span>
                <button
                  onClick={() => { setPremiumTouched(false); setPremium(estimatePremium); }}
                  className="font-semibold text-sky-400 transition hover:text-sky-300"
                >
                  {estimatePremium.toFixed(2)}
                </button>
                <span className="text-slate-600">{t("protect.clickToUse")}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            {t("protect.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={liveFetching}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("protect.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}