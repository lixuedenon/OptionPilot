// src/components/EarningsIvCrashTab.tsx
import { useState } from "react";
import { RefreshCw, AlertTriangle, Info } from "lucide-react";
import {
  EARNINGS_GROUPS,
  pickGroupExpiries,
  buildGroupLegs,
  computeUnitsFromRiskBudget,
  computeEarningsPreview,
  type EarningsGroupLegs,
  type GroupExpiry,
  type EarningsPreview,
} from "@/lib/earningsStrategy";
import { loadSimAccount, loadSimPositions, computeAvailableCapital, openSimPosition } from "@/lib/simAccount";
import { fetchSpotPrice } from "@/lib/useStockQuote";
import { useI18n } from "@/i18n/I18nContext";
import Term from "@/components/Term";
import { clamp, blockInvalidNumberKey } from "@/lib/numberInput";

interface Props {
  onOpened: () => void; // called after all 3 groups are successfully opened — the caller navigates back to the simulator so the person sees the new positions
}

const GROUP_COLOR: Record<string, string> = { near: "text-sky-300", mid: "text-violet-300", far: "text-amber-300" };

export default function EarningsIvCrashTab({ onOpened }: Props) {
  const { t } = useI18n();
  const [symbol, setSymbol] = useState("");
  const [spot, setSpot] = useState<number | null>(null);
  const [spotLoading, setSpotLoading] = useState(false);
  const [spotError, setSpotError] = useState<string | null>(null);
  const [riskPct, setRiskPct] = useState(3);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<EarningsPreview | null>(null);
  const [groupExpiries, setGroupExpiries] = useState<GroupExpiry[] | null>(null);
  const [availableCapital, setAvailableCapital] = useState<number | null>(null);

  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const handleFetchSpot = async () => {
    const sym = symbol.trim();
    if (!sym) return;
    setSpotLoading(true);
    setSpotError(null);
    setPreview(null);
    try {
      const p = await fetchSpotPrice(sym);
      if (p > 0) setSpot(p); else throw new Error("no price");
    } catch {
      setSpot(null);
      setSpotError(t("scenario.spotError"));
    } finally {
      setSpotLoading(false);
    }
  };

  const handleGeneratePreview = async () => {
    const sym = symbol.trim();
    if (!sym || spot === null) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    setOpenError(null);
    try {
      const expiries = await pickGroupExpiries(sym);
      const nearSpec = EARNINGS_GROUPS.find((g) => g.group === "near")!;
      const nearExpiry = expiries.find((e) => e.group === "near")!;
      const nearAtOneUnit = await buildGroupLegs(sym, spot, nearSpec, nearExpiry.expiryDate, 1);

      const account = await loadSimAccount();
      if (!account) {
        setPreviewError(t("scenario.earningsNoAccount"));
        return;
      }
      const positions = await loadSimPositions();
      const avail = computeAvailableCapital(account, positions);
      setAvailableCapital(avail);

      const sizing = computeUnitsFromRiskBudget(avail, riskPct / 100, nearAtOneUnit.maxLossPerUnit);
      if (!sizing.affordable) {
        setPreviewError(t("scenario.earningsNotAffordable", { budget: sizing.riskBudget.toFixed(0), perUnit: sizing.maxLossPerUnitNear.toFixed(0) }));
        return;
      }

      const groups: EarningsGroupLegs[] = [];
      for (const spec of EARNINGS_GROUPS) {
        const expiry = expiries.find((e) => e.group === spec.group)!;
        const units = spec.group === "near" ? sizing.units : sizing.units * spec.unitMultiplier;
        const built = await buildGroupLegs(sym, spot, spec, expiry.expiryDate, units);
        groups.push(built);
      }

      setGroupExpiries(expiries);
      setPreview(computeEarningsPreview(groups, spot));
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : t("scenario.earningsPreviewFail"));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmOpen = async () => {
    if (!preview) return;
    setOpening(true);
    setOpenError(null);
    try {
      // Tags each of the 3 groups with a shared batch id (so the closing-
      // guidance view can later find "all 3 groups from this earnings
      // trade" as one unit) plus its own group name — this is what lets
      // the future closing/management screen recognize "this SimPosition
      // is the near group of an IV-crash batch" instead of it just being
      // an anonymous position indistinguishable from anything else the
      // person opened by hand.
      const batchId = `${symbol.trim()}-${Date.now()}`;
      for (const g of preview.groups) {
        await openSimPosition({ symbol: symbol.trim(), legs: g.legs, spot: spot!, note: `earnings-iv-crash:${g.group}:${batchId}` });
      }
      onOpened();
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : t("scenario.earningsOpenFail"));
    } finally {
      setOpening(false);
    }
  };

  const marginExceedsCapital = preview && availableCapital !== null && preview.totalMargin > availableCapital;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="rounded-lg border border-sky-800/40 bg-sky-950/20 px-3 py-2 text-[11px] leading-relaxed text-sky-300">
        {t("scenario.earningsIntro")}
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold text-slate-400">{t("scenario.symbol")}</label>
        <div className="flex items-center gap-2">
          <input
            value={symbol}
            onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setSpot(null); setPreview(null); }}
            onBlur={handleFetchSpot}
            onKeyDown={(e) => { if (e.key === "Enter") handleFetchSpot(); }}
            placeholder="MSFT"
            className="w-32 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm font-semibold text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
          />
          {spotLoading && <RefreshCw size={13} className="animate-spin text-slate-500" />}
          {spot !== null && !spotLoading && <span className="text-xs tabular-nums text-emerald-400">${spot.toFixed(2)}</span>}
          {spotError && <span className="text-xs text-rose-400">{spotError}</span>}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-600">{t("scenario.earningsStockHint")}</p>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold text-slate-400">
          {t("scenario.earningsRiskPct")}
          <span className="ml-1.5 font-normal text-slate-600">{t("scenario.earningsRiskPctHint")}</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0.5}
            max={20}
            step={0.5}
            value={riskPct}
            onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { setRiskPct(clamp(v, 0.5, 20, 1)); setPreview(null); } }}
            onKeyDown={(e) => blockInvalidNumberKey(e, { min: 0.5, decimals: 1 })}
            onWheel={(e) => e.currentTarget.blur()}
            className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs tabular-nums text-slate-200 focus:border-sky-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">%</span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">{t("scenario.earningsRiskPctExplain")}</p>
      </div>

      <button
        onClick={handleGeneratePreview}
        disabled={spot === null || previewLoading}
        className="w-full rounded-lg bg-violet-600 py-2.5 text-sm font-bold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {previewLoading ? t("scenario.earningsGenerating") : t("scenario.earningsGenerate")}
      </button>

      {previewError && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
          {previewError}
        </div>
      )}

      {preview && groupExpiries && (
        <div className="space-y-3 border-t border-slate-800 pt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("scenario.earningsPreviewTitle")}</div>

          {preview.groups.map((g) => {
            const spec = EARNINGS_GROUPS.find((s) => s.group === g.group)!;
            const expiry = groupExpiries.find((e) => e.group === g.group)!;
            const units = g.legs[0]?.qty ?? 1;
            return (
              <div key={g.group} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className={`text-sm font-bold ${GROUP_COLOR[g.group]}`}>{spec.label}</span>
                  <span className="text-[10px] tabular-nums text-slate-500">{expiry.expiryDate}（{expiry.dte}天）· {units} {t("scenario.earningsUnits")}</span>
                </div>
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {g.legs.map((l, i) => (
                    <span key={i} className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[9px] tabular-nums text-slate-300">
                      {l.action === "buy" ? "+" : "-"}{l.type === "call" ? "C" : "P"} {l.strike}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-slate-600">{t("scenario.earningsNetCredit")}</span>
                    <div className="font-semibold tabular-nums text-emerald-400">${(g.netCreditPerUnit * units * 100).toFixed(0)}</div>
                  </div>
                  <div>
                    <span className="text-slate-600">{t("scenario.earningsMaxLoss")}</span>
                    <div className="font-semibold tabular-nums text-rose-400">-${(g.maxLossPerUnit * units).toFixed(0)}</div>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
            <div className="mb-2 text-[11px] font-bold text-slate-200">{t("scenario.earningsTotalsTitle")}</div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-slate-600">{t("scenario.earningsNetCredit")}</span>
                <div className="font-bold tabular-nums text-emerald-400">${preview.totalNetCredit.toFixed(0)}</div>
              </div>
              <div>
                <span className="text-slate-600">{t("scenario.earningsMaxLoss")}</span>
                <div className="font-bold tabular-nums text-rose-400">-${preview.totalMaxLoss.toFixed(0)}</div>
              </div>
              <div>
                <Term titleKey="glossary.marginUsed" descKey="glossary.marginUsedDesc" className="text-slate-600">{t("sim.marginRequired")}</Term>
                <div className={`font-bold tabular-nums ${marginExceedsCapital ? "text-rose-400" : "text-slate-200"}`}>${preview.totalMargin.toFixed(0)}</div>
              </div>
            </div>
            {marginExceedsCapital && (
              <div className="mt-2 flex items-start gap-1.5 rounded border border-rose-700/40 bg-rose-950/20 px-2 py-1.5 text-[10px] leading-relaxed text-rose-300">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {t("scenario.earningsMarginExceeds")}
              </div>
            )}
          </div>

          <div className="flex items-start gap-1.5 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-[10px] leading-relaxed text-slate-500">
            <Info size={12} className="mt-0.5 shrink-0" />
            {t("scenario.earningsOpenTimingNote")}
          </div>

          {openError && (
            <div className="rounded-lg border border-rose-700/40 bg-rose-950/20 px-3 py-2 text-[11px] leading-relaxed text-rose-300">
              {openError}
            </div>
          )}

          <button
            onClick={handleConfirmOpen}
            disabled={opening || !!marginExceedsCapital}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {opening && <RefreshCw size={14} className="animate-spin" />}
            {opening ? t("scenario.earningsOpening") : t("scenario.earningsConfirmOpen")}
          </button>
        </div>
      )}
    </div>
  );
}