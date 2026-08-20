import { useState, useMemo, useEffect } from "react";
import { CalendarClock, AlertTriangle, X, RefreshCw } from "lucide-react";
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
  symbol?: string; // when provided, strike/expiry/premium are pulled from the real option chain instead of a theoretical BS estimate
  onClose: () => void;
  onConfirm: (newLeg: Leg) => void;
}

export default function RollDialog({ leg, spot, symbol, onClose, onConfirm }: Props) {
  const { t } = useI18n();
  const oldDte = Math.max(0, Math.round(leg.dte));
  const oldDate = dateFromDte(oldDte);
  const sym = symbol?.trim() ?? "";

  const [newDte, setNewDte] = useState(() => nearestFridayDte(oldDte + 30));
  const [newStrike, setNewStrike] = useState(leg.strike);
  const [premiumTouched, setPremiumTouched] = useState(false);
  const [newPremium, setNewPremium] = useState(() => {
    if (spot <= 0) return leg.premium;
    const iv = impliedVol(spot, leg.strike, leg.dte, leg.premium, leg.type);
    return Math.round(
      blackScholes({ spot, strike: leg.strike, dte: nearestFridayDte(oldDte + 30), vol: iv, rate: RATE, type: leg.type }).price * 100,
    ) / 100;
  });
  const [covered, setCovered] = useState(false);
  const [liveFetching, setLiveFetching] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveNote, setLiveNote] = useState<string | null>(null);

  const newDate = dateFromDte(newDte);
  const isNakedShortCall = leg.action === "sell" && leg.type === "call" && !covered;
  const strikeDown = newStrike < leg.strike;
  const closerExpiry = newDte < oldDte;

  const riskWarnings: string[] = [];
  if (isNakedShortCall) {
    riskWarnings.push(t("roll.riskNakedCall"));
  }
  if (strikeDown && leg.action === "sell") {
    riskWarnings.push(t("roll.riskStrikeDown"));
  }
  if (closerExpiry) {
    riskWarnings.push(t("roll.riskCloserExpiry"));
  }

  // Theoretical fallback (used when there's no symbol to look up real market data for).
  const estimatePremium = useMemo(() => {
    if (spot <= 0) return 0;
    const iv = impliedVol(spot, leg.strike, leg.dte, leg.premium, leg.type);
    return Math.round(
      blackScholes({ spot, strike: newStrike, dte: newDte, vol: iv, rate: RATE, type: leg.type }).price * 100,
    ) / 100;
  }, [spot, leg, newStrike, newDte]);

  useEffect(() => {
    if (!premiumTouched) setNewPremium(estimatePremium);
  }, [estimatePremium, premiumTouched]);

  // With a symbol available, pull the real listed strike/expiry/premium
  // instead of trusting a theoretical price — same auto-correct pattern
  // LegRow uses when a leg's premium is still unset.
  useEffect(() => {
    if (!sym || premiumTouched) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLiveFetching(true);
      setLiveError(null);
      try {
        const result = await fetchLegPremium(sym, leg.type, newStrike, newDte, true);
        if (cancelled) return;
        if (result.strikeSnapped) setNewStrike(result.actualStrike);
        if (result.expirySnapped) setNewDte(result.actualDte);
        setNewPremium(result.premium);
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
  }, [sym, newStrike, newDte, leg.type, premiumTouched]);

  const handleConfirm = () => {
    const newLeg: Leg = {
      id: `leg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action: leg.action,
      type: leg.type,
      strike: newStrike,
      dte: newDte,
      premium: newPremium,
    };
    onConfirm(newLeg);
  };

  const setExpiryPreset = (days: number) => {
    setPremiumTouched(false);
    setLiveNote(null);
    setNewDte(nearestFridayDte(oldDte + days));
  };

  const presetActive = (days: number) => newDte === nearestFridayDte(oldDte + days);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[420px] max-w-[90vw] rounded-xl border border-sky-500/30 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock size={18} className="text-sky-400" />
            <h3 className="text-sm font-bold text-sky-200">{t("roll.title")}</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 transition hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        {/* Old leg info */}
        <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("roll.originalLeg")}</div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-300">
            <span>{leg.action === "buy" ? t("leg.buy") : t("leg.sell")} {leg.type === "call" ? "Call" : "Put"}</span>
            <span>{t("roll.strike")} <span className="font-semibold text-slate-100">{leg.strike}</span></span>
            <span>{t("roll.expiryLabel")} <span className="font-semibold text-slate-100">{oldDate}</span> ({t("roll.left")}{oldDte}{t("roll.days")})</span>
            <span>{t("roll.premium")} <span className="font-semibold text-slate-100">{leg.premium}</span></span>
          </div>
        </div>

        {/* New leg inputs */}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("roll.rollTo")}</label>
            <div className="flex gap-1.5">
              <button
                onClick={() => setExpiryPreset(7)}
                className={`rounded border px-2.5 py-1.5 text-[11px] transition ${
                  presetActive(7)
                    ? "border-sky-500 bg-sky-950/50 text-sky-300"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:border-sky-500 hover:text-sky-300"
                }`}
              >
                +7{t("roll.days")}
              </button>
              <button
                onClick={() => setExpiryPreset(14)}
                className={`rounded border px-2.5 py-1.5 text-[11px] transition ${
                  presetActive(14)
                    ? "border-sky-500 bg-sky-950/50 text-sky-300"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:border-sky-500 hover:text-sky-300"
                }`}
              >
                +14{t("roll.days")}
              </button>
              <button
                onClick={() => setExpiryPreset(30)}
                className={`rounded border px-2.5 py-1.5 text-[11px] transition ${
                  presetActive(30)
                    ? "border-sky-500 bg-sky-950/50 text-sky-300"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:border-sky-500 hover:text-sky-300"
                }`}
              >
                +30{t("roll.days")}
              </button>
              <input
                type="date"
                value={newDate}
                min={todayISO()}
                onChange={(e) => {
                  if (e.target.value) {
                    const d = dteFromDate(e.target.value);
                    if (d >= 0) {
                      setPremiumTouched(false);
                      setLiveNote(null);
                      setNewDte(d);
                    }
                  }
                }}
                className={`${inp} flex-1`}
              />
            </div>
            {sym && (
              <p className="mt-1 text-[10px] text-slate-500">
                {presetActive(7) || presetActive(14) || presetActive(30)
                  ? t("roll.snappedToFriday")
                  : ""}
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <label className="flex-1">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("roll.strike")}</span>
              <input
                type="number"
                step={0.5}
                value={newStrike}
                onChange={(e) => { setPremiumTouched(false); setLiveNote(null); setNewStrike(parseFloat(e.target.value) || 0); }}
                className={inp}
              />
            </label>
            <label className="flex-1">
              <span className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {t("roll.premium")}
                {liveFetching && <RefreshCw size={9} className="animate-spin text-sky-400" />}
              </span>
              <input
                type="number"
                step={0.01}
                value={newPremium}
                onChange={(e) => { setPremiumTouched(true); setNewPremium(parseFloat(e.target.value) || 0); }}
                className={inp}
              />
            </label>
          </div>

          {sym ? (
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
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
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span>{t("roll.refPremium")}</span>
              <button
                onClick={() => { setPremiumTouched(false); setNewPremium(estimatePremium); }}
                className="font-semibold text-sky-400 transition hover:text-sky-300"
              >
                {estimatePremium.toFixed(2)}
              </button>
              <span className="text-slate-600">{t("roll.clickToUse")}</span>
            </div>
          )}

          {leg.action === "sell" && leg.type === "call" && (
            <label className="flex items-center gap-2 text-[11px] text-slate-300">
              <input
                type="checkbox"
                checked={covered}
                onChange={(e) => setCovered(e.target.checked)}
                className="accent-sky-500"
              />
              {t("roll.covered")}
            </label>
          )}

          {riskWarnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3">
              <div className="mb-1 flex items-center gap-1.5">
                <AlertTriangle size={12} className="text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-wide text-amber-400">{t("roll.riskTitle")}</span>
              </div>
              <ul className="space-y-1">
                {riskWarnings.map((w, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-amber-200">{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            {t("roll.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={liveFetching}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("roll.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}