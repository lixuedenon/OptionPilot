// src/ScenarioSelectorPage.tsx
import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import {
  rankPresetsForScenario,
  computeBucketBounds,
  isScenarioBlocked,
  ALL_BUCKETS,
  BUCKET_LABELS,
  TIME_WINDOWS,
  MAX_SELECTABLE_BUCKETS,
  TIER_LABELS,
  type Bucket,
  type Tier,
  type ScenarioRecommendation,
} from "@/lib/scenarioEngine";
import { fetchSpotPrice } from "@/lib/useStockQuote";
import { fetchLegPremium } from "@/lib/optionChain";
import { impliedVol } from "@/lib/pricing";
import { fetchHistoricalCloses, computeHV, computeIvHvNote, RICH_THRESHOLD, type IvHvNote } from "@/lib/historicalVolatility";
import { dirKeyMap } from "@/components/StrategyBadge";
import EarningsTabRoot from "@/components/EarningsTabRoot";
import { useI18n } from "@/i18n/I18nContext";
import type { Leg } from "@/lib/types";
import { clamp, blockInvalidNumberKey } from "@/lib/numberInput";

interface Props {
  onBack: () => void;
  onUseCandidate: (payload: { symbol: string; spot: number; legs: Leg[] }) => void;
  // Lets Shell.tsx keep this page's inputs/results alive across a trip into
  // simOrigin and back — without this, canceling out of "use this" would
  // dump the person back to a blank selector, forcing them to re-enter the
  // symbol, re-pick buckets, and re-generate just to look at a DIFFERENT
  // candidate from the same list. persisted is undefined on first visit
  // (nothing to restore yet); onPersist fires on every state change so
  // Shell always has a fresh snapshot, not just on unmount.
  persisted?: SelectorState;
  onPersist: (state: SelectorState) => void;
}

export interface SelectorState {
  symbol: string;
  selectedBuckets: Bucket[];
  windowId: string;
  ivPct: number;
  recommendations: ScenarioRecommendation[] | null;
  // Which tier tab is showing per recommendation card, keyed by preset
  // name (stable across a persist/restore round trip, unlike an array
  // index which the ranking order could in principle change).
  selectedTiers: Record<string, Tier>;
}

const BUCKET_ICON: Record<Bucket, React.ReactNode> = {
  strongDown: <TrendingDown size={14} />,
  mildDown: <TrendingDown size={13} className="opacity-70" />,
  flat: <Minus size={13} />,
  mildUp: <TrendingUp size={13} className="opacity-70" />,
  strongUp: <TrendingUp size={14} />,
};

const TIER_ORDER: Tier[] = ["conservative", "neutral", "aggressive"];

// Same credit/debit determination scenarioEngine.ts uses internally
// (compare illustrative sell vs buy premiums) — reused here just to
// classify "is this recommendation a sell-side or buy-side posture" for
// deciding whether the IV/HV note applies. A recommendation that's net
// credit (selling premium) only gets the note when IV looks cheap
// relative to HV (the sell thesis is weaker than usual); a net-debit
// (buying) recommendation only gets it when IV looks rich (buying is
// more expensive than usual) — the opposite pairing wouldn't be useful
// advice (telling someone already buying that IV is cheap isn't a
// caution, it's a compliment).
function isNetCredit(legs: Leg[]): boolean {
  const sellTotal = legs.filter((l) => l.action === "sell" && l.kind !== "stock").reduce((a, l) => a + l.premium, 0);
  const buyTotal = legs.filter((l) => l.action === "buy" && l.kind !== "stock").reduce((a, l) => a + l.premium, 0);
  return sellTotal >= buyTotal;
}

// How far out is "长期" for a sell-side strategy — 3 months or longer.
// Standard options wisdom puts the theta-efficient sweet spot for selling
// premium around 4-8 weeks (roughly 30-56 days); going out 3 months+
// trades that efficiency for a longer, more exposed holding period. The
// one shape this warning is unconditional for is a naked short call
// (sold, no stock underneath it) — its risk is theoretically unlimited
// on the upside, and a longer window is strictly more time for that tail
// risk to matter, regardless of how attractive the current IV looks.
const LONG_DURATION_WINDOWS = new Set(["3m", "6m", "1y"]);
type DurationWarning = "naked" | "highIvOk" | "preferShort" | null;

function computeDurationWarning(windowId: string, presetName: string, netCredit: boolean, ivHvRatio: number | null): DurationWarning {
  if (!netCredit || !LONG_DURATION_WINDOWS.has(windowId)) return null;
  if (presetName === "裸卖 Call") return "naked";
  if (ivHvRatio !== null && ivHvRatio >= RICH_THRESHOLD) return "highIvOk";
  return "preferShort";
}

export default function ScenarioSelectorPage({ onBack, onUseCandidate, persisted, onPersist }: Props) {
  const { t, lang } = useI18n();
  const [symbol, setSymbol] = useState(persisted?.symbol ?? "");
  const [spot, setSpot] = useState<number | null>(null);
  const [spotLoading, setSpotLoading] = useState(false);
  const [spotError, setSpotError] = useState<string | null>(null);
  const [selectedBuckets, setSelectedBuckets] = useState<Bucket[]>(persisted?.selectedBuckets ?? []);
  const [windowId, setWindowId] = useState(persisted?.windowId ?? "1m");
  // Stand-in for a real chain-derived IV until stage 2 (real option-chain
  // pricing) is wired in — see scenarioEngine.ts's own notes on the
  // two-stage plan. Editable rather than silently hardcoded so the person
  // isn't stuck with a number that's obviously wrong for a very calm or
  // very volatile name; the moment real chain data is wired in this input
  // goes away and gets replaced with a computed weightedAvgIV.
  const [ivPct, setIvPct] = useState(persisted?.ivPct ?? 25);
  const [recommendations, setRecommendations] = useState<ScenarioRecommendation[] | null>(persisted?.recommendations ?? null);
  // Defaults every card to "neutral" the first time it's seen; carries
  // forward the person's own choice on a persist/restore round trip.
  const [selectedTiers, setSelectedTiers] = useState<Record<string, Tier>>(persisted?.selectedTiers ?? {});
  // The "方向" tab (bucket-based direction picker) is the only one with
  // real content right now — "财报" (earnings) and "待定" (TBD) are
  // placeholders for templates on the roadmap (see CLAUDE.md's scenario-
  // template list) that aren't built yet. Structuring the tabs now, even
  // with two of them empty, means adding a real earnings template later
  // is "fill in this tab's content" rather than a page redesign.
  const [activeTab, setActiveTab] = useState<"direction" | "earnings" | "pending">("direction");
  // Keyed by preset name — "use this" is only ever clicked on one card at
  // a time in practice, but keying by name (rather than one shared bool)
  // means a second click on a DIFFERENT card while the first is still
  // fetching doesn't show a stale/wrong loading state on the wrong button.
  const [usingCandidateFor, setUsingCandidateFor] = useState<string | null>(null);
  const [useCandidateError, setUseCandidateError] = useState<string | null>(null);
  // A standalone substitute for true IV Rank/Percentile — see the chat
  // discussion on why: those need a year of accumulated history we don't
  // have yet, but comparing today's real IV to recent realized volatility
  // (HV) is usable right now with data we can already fetch. This does
  // NOT change which strategy gets recommended (the SCENARIO_RULES table
  // stays exactly as Xue defined it) — it only adds an advisory note next
  // to the existing recommendation when the current IV/HV gap suggests
  // the opposite side (buy vs sell) might be worth a look too.
  const [ivHvNote, setIvHvNote] = useState<IvHvNote | null>(null);

  const days = TIME_WINDOWS.find((w) => w.id === windowId)?.days ?? 30;

  // Mirror every change up to Shell.tsx so a trip into simOrigin and back
  // (or a cancel) restores exactly this state — see the Props comment for
  // why. Deliberately NOT including `spot` here: it's re-derived from
  // `symbol` by the effect below on remount, so persisting it separately
  // would just be a second source of truth to keep in sync for no benefit.
  useEffect(() => {
    onPersist({ symbol, selectedBuckets, windowId, ivPct, recommendations, selectedTiers });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, selectedBuckets, windowId, ivPct, recommendations, selectedTiers]);

  useEffect(() => {
    const sym = symbol.trim();
    if (!sym) { setSpot(null); setSpotError(null); return; }
    setSpotLoading(true);
    setSpotError(null);
    const timer = setTimeout(async () => {
      try {
        const p = await fetchSpotPrice(sym);
        if (p > 0) setSpot(p); else throw new Error("no price");
      } catch {
        setSpot(null);
        setSpotError(t("scenario.spotError"));
      } finally {
        setSpotLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const toggleBucket = (b: Bucket) => {
    setRecommendations(null);
    setSelectedBuckets((prev) => {
      if (prev.includes(b)) return prev.filter((x) => x !== b);
      if (prev.length >= MAX_SELECTABLE_BUCKETS) return prev; // shouldn't fire — the 5th checkbox is disabled — but guard anyway
      return [...prev, b];
    });
  };

  const bounds = useMemo(() => {
    if (spot === null) return null;
    return computeBucketBounds(spot, ivPct / 100, days);
  }, [spot, ivPct, days]);

  const blocked = selectedBuckets.length > 0 && isScenarioBlocked(selectedBuckets);
  // Disabled once a result set exists — re-enabled automatically the
  // moment any input changes, since every input handler above already
  // resets recommendations to null on change. Without this, clicking
  // "generate" again with the exact same inputs did nothing visible
  // (recommendations was already populated) but still looked clickable,
  // which read as "did that work?" rather than clearly done.
  const canGenerate = spot !== null && selectedBuckets.length > 0 && !blocked && recommendations === null;

  const handleGenerate = useCallback(() => {
    if (spot === null || selectedBuckets.length === 0 || isScenarioBlocked(selectedBuckets)) return;
    const recs = rankPresetsForScenario({ spot, iv: ivPct / 100, days, windowId, selectedBuckets });
    setRecommendations(recs);
    setSelectedTiers((prev) => {
      const next = { ...prev };
      for (const r of recs) if (!next[r.preset.name.zh]) next[r.preset.name.zh] = "neutral";
      return next;
    });

    // Fire-and-forget: fetch real IV (via one ATM-ish quote) and recent
    // HV in the background, then compute the advisory note once both
    // land. Not blocking the recommendation display itself — the note is
    // supplementary context, not something worth making the person wait
    // on, and if either fetch fails (illiquid name, thin chain) the note
    // just doesn't appear rather than erroring the whole generate flow.
    setIvHvNote(null);
    const sym = symbol.trim();
    (async () => {
      try {
        const [premiumResult, closes] = await Promise.all([
          fetchLegPremium(sym, "call", spot, days),
          fetchHistoricalCloses(sym),
        ]);
        const realIv = impliedVol(spot, premiumResult.actualStrike, premiumResult.actualDte, premiumResult.premium, "call");
        const hv = computeHV(closes, 30);
        setIvHvNote(computeIvHvNote(realIv, hv));
      } catch {
        setIvHvNote(null);
      }
    })();
  }, [spot, ivPct, days, windowId, selectedBuckets, symbol]);

  // Everything up to this point priced legs theoretically (Black-Scholes
  // off the bucket-boundary strikes) — good enough for comparing which
  // STRATEGY fits the scenario, but a theoretical strike like "494.37" or
  // an expiry landing on a Tuesday isn't necessarily a contract that
  // actually trades. Before handing the combo off to simOrigin, snap
  // every option leg to the nearest REAL listed strike and expiry (same
  // chain-lookup fetchLegPremium already does for manually-built legs
  // elsewhere in the app), replacing the theoretical strike/dte/premium
  // with the real ones. A leg that can't be snapped (a fetch failure —
  // illiquid name, chain temporarily unavailable) keeps its theoretical
  // values rather than blocking the whole combo; the person can still
  // adjust that one leg by hand once it's in the editor.
  const handleUseCandidate = useCallback(async (presetName: string, legs: Leg[]) => {
    if (spot === null) return;
    const sym = symbol.trim();
    setUsingCandidateFor(presetName);
    setUseCandidateError(null);
    try {
      const snapped: Leg[] = [];
      let anyFailed = false;
      for (const l of legs) {
        if (l.kind === "stock") { snapped.push(l); continue; }
        try {
          const result = await fetchLegPremium(sym, l.type, l.strike, l.dte);
          snapped.push({ ...l, strike: result.actualStrike, dte: result.actualDte, premium: result.premium });
        } catch {
          anyFailed = true;
          snapped.push(l);
        }
      }
      if (anyFailed) setUseCandidateError(t("scenario.useThisPartialFail"));
      onUseCandidate({ symbol: sym, spot, legs: snapped });
    } finally {
      setUsingCandidateFor(null);
    }
  }, [spot, symbol, onUseCandidate, t]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-200">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-800 px-4 py-3">
        <button onClick={onBack} title={t("home.backToHome")} className="flex items-center rounded transition hover:opacity-80">
          <img
            src="/image copy 2.png"
            alt="OptionPilot"
            className="h-10 w-auto shrink-0 object-contain"
          />
        </button>
        <Sparkles size={16} className="text-violet-400" />
        <h1 className="text-sm font-bold text-slate-100">{t("scenario.title")}</h1>
      </header>

      <div className="flex shrink-0 gap-1 border-b border-slate-800 bg-slate-900/40 px-4 pt-2">
        {(["direction", "earnings", "pending"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-t-lg border-x border-t px-4 py-2 text-[12px] font-semibold transition ${
              activeTab === tab
                ? "border-slate-700 bg-slate-950 text-violet-300"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {t(`scenario.tab.${tab}`)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {activeTab === "earnings" && (
          <EarningsTabRoot onOpened={onBack} />
        )}
        {activeTab === "pending" && (
          <div className="mx-auto max-w-2xl rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-500">
            {t("scenario.tab.comingSoon")}
          </div>
        )}
        {activeTab === "direction" && (
        <div className="mx-auto max-w-2xl space-y-5">
          {/* symbol */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-400">{t("scenario.symbol")}</label>
            <div className="flex items-center gap-2">
              <input
                value={symbol}
                onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setRecommendations(null); }}
                placeholder="QQQ"
                className="w-32 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm font-semibold text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
              />
              {spotLoading && <RefreshCw size={13} className="animate-spin text-slate-500" />}
              {spot !== null && !spotLoading && (
                <span className="text-xs tabular-nums text-emerald-400">${spot.toFixed(2)}</span>
              )}
              {spotError && <span className="text-xs text-rose-400">{spotError}</span>}
            </div>
          </div>

          {/* buckets */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-slate-400">
              {t("scenario.pickView")}
              <span className="ml-1.5 font-normal text-slate-600">{t("scenario.pickViewHint")}</span>
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {ALL_BUCKETS.map((b) => {
                const checked = selectedBuckets.includes(b);
                // Disable this checkbox outright if selecting it would
                // form a blocked combination, rather than letting the
                // person pick it and then explaining why it didn't work
                // after the fact — the person only needs to know "this
                // isn't available right now," not walk into it and read
                // an error. Only checked for UNCHECKED buckets: unchecking
                // something already selected is always allowed, and is
                // in fact how you get OUT of a state where the remaining
                // options are locked (e.g. with both "strongly bullish"
                // and "strongly bearish" checked, "flat" is disabled —
                // unchecking either strong bucket frees it up again).
                const wouldExceed = !checked && selectedBuckets.length >= MAX_SELECTABLE_BUCKETS;
                const wouldBlock = !checked && isScenarioBlocked([...selectedBuckets, b]);
                const disabledNow = wouldExceed || wouldBlock;
                return (
                  <button
                    key={b}
                    onClick={() => toggleBucket(b)}
                    disabled={disabledNow}
                    title={wouldBlock ? t("scenario.wouldBlock") : wouldExceed ? t("scenario.maxFour") : undefined}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-[10px] font-semibold transition ${
                      checked
                        ? "border-violet-500 bg-violet-950/40 text-violet-200"
                        : disabledNow
                        ? "cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-700"
                        : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    {BUCKET_ICON[b]}
                    <span className="text-center leading-tight">{lang === "en" ? BUCKET_LABELS[b].en : BUCKET_LABELS[b].zh}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* time window */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-slate-400">{t("scenario.timeWindow")}</label>
            <div className="flex flex-wrap gap-1.5">
              {TIME_WINDOWS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => { setWindowId(w.id); setRecommendations(null); }}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                    windowId === w.id
                      ? "border-sky-500 bg-sky-950/40 text-sky-300"
                      : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500"
                  }`}
                >
                  {lang === "en" ? w.labelEn : w.labelZh}
                </button>
              ))}
            </div>
          </div>

          {/* IV estimate — stand-in until real chain data is wired in */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-400">
              {t("scenario.ivEstimate")}
              <span className="ml-1.5 font-normal text-slate-600">{t("scenario.ivEstimateHint")}</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={200}
                value={ivPct}
                onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { setIvPct(clamp(v, 1, 200, 0)); setRecommendations(null); } }}
                onKeyDown={(e) => blockInvalidNumberKey(e, { min: 1, decimals: 0 })}
                onWheel={(e) => e.currentTarget.blur()}
                className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs tabular-nums text-slate-200 focus:border-sky-500 focus:outline-none"
              />
              <span className="text-xs text-slate-500">%</span>
              {bounds && spot !== null && (
                <span className="text-[10px] tabular-nums text-slate-600">
                  {t("scenario.boundsPreview", { low: bounds.mildDownMax.toFixed(1), high: bounds.mildUpMax.toFixed(1) })}
                </span>
              )}
            </div>
          </div>

          {blocked && (
            <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
              {t("scenario.blockedNote")}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="w-full rounded-lg bg-violet-600 py-2.5 text-sm font-bold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("scenario.generate")}
          </button>

          {/* results */}
          {recommendations && (
            <div className="space-y-3 border-t border-slate-800 pt-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t("scenario.resultsTitle")}
              </div>
              <p className="text-[10px] leading-relaxed text-slate-600">{t("scenario.theoreticalNote")}</p>
              {useCandidateError && (
                <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
                  {useCandidateError}
                </div>
              )}
              {recommendations.length === 0 ? (
                <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-center text-xs text-slate-500">
                  {t("scenario.noResults")}
                </div>
              ) : (
                recommendations.map((r) => {
                  const tier = selectedTiers[r.preset.name.zh] ?? "neutral";
                  const v = r.variants[tier];
                  return (
                    <div key={r.preset.name.zh} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-100">{lang === "en" ? r.preset.name.en : r.preset.name.zh}</span>
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-500">{t(`dir.${dirKeyMap[r.preset.direction] ?? "neutral"}`)}</span>
                        </div>
                        <button
                          onClick={() => handleUseCandidate(r.preset.name.zh, v.legs)}
                          disabled={spot === null || usingCandidateFor !== null}
                          className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {usingCandidateFor === r.preset.name.zh && <RefreshCw size={11} className="animate-spin" />}
                          {t("scenario.useThis")}
                        </button>
                      </div>

                      {(() => {
                        const netCredit = isNetCredit(r.preset.legs());
                        // "stillRich" only has a meaningful message for
                        // sell-side cards (it's specifically "the ratio
                        // looks low but absolute IV is still rich, sell
                        // premium is fine") — a buy-side card has no
                        // natural counterpart reading of that state, so it
                        // stays silent there rather than forcing an
                        // irrelevant note onto it.
                        const warnApplies = !!ivHvNote && ((netCredit && ivHvNote.bias === "buyCheap") || (!netCredit && ivHvNote.bias === "sellRich"));
                        const reassureApplies = !!ivHvNote && netCredit && ivHvNote.bias === "stillRich";
                        // Decoupled from ivHvNote's success on purpose — the
                        // duration guidance itself doesn't strictly need the
                        // IV/HV comparison to be meaningful (only its
                        // "highIvOk" softened wording does); if that fetch
                        // failed, ratio is just null and the function falls
                        // back to the safe default wording rather than the
                        // whole warning silently disappearing.
                        const durationWarning = computeDurationWarning(windowId, r.preset.name.zh, netCredit, ivHvNote?.ratio ?? null);
                        return (
                          <>
                            {ivHvNote && (
                              // Always shown once loaded — even a "nothing
                              // notable" ratio is useful context, and only
                              // showing this when a threshold trips reads
                              // as "broken" the rest of the time (testing
                              // showed every early attempt landing in the
                              // normal range and showing nothing at all).
                              <div className="mb-1.5 text-[9px] text-slate-500">
                                {t("scenario.ivHvContext", { iv: (ivHvNote.iv * 100).toFixed(0), hv: (ivHvNote.hv * 100).toFixed(0), ratio: (ivHvNote.ratio * 100).toFixed(0) })}
                              </div>
                            )}
                            {warnApplies && ivHvNote && (
                              <div className="mb-2 rounded-md border border-amber-700/40 bg-amber-950/20 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-300">
                                {t(netCredit ? "scenario.ivHvNoteSell" : "scenario.ivHvNoteBuy", { ratio: (ivHvNote.ratio * 100).toFixed(0) })}
                              </div>
                            )}
                            {reassureApplies && ivHvNote && (
                              <div className="mb-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 px-2.5 py-1.5 text-[10px] leading-relaxed text-emerald-300">
                                {t("scenario.ivHvNoteStillRich", { ratio: (ivHvNote.ratio * 100).toFixed(0), iv: (ivHvNote.iv * 100).toFixed(0) })}
                              </div>
                            )}
                            {durationWarning && (
                              <div className="mb-2 rounded-md border border-sky-700/40 bg-sky-950/20 px-2.5 py-1.5 text-[10px] leading-relaxed text-sky-300">
                                {t(`scenario.durationWarning.${durationWarning}`)}
                              </div>
                            )}
                          </>
                        );
                      })()}

                      {/* tier tabs — 保守/中性/激进 */}
                      <div className="mb-2 flex gap-1 rounded-md border border-slate-800 bg-slate-950/40 p-0.5">
                        {TIER_ORDER.map((tk) => (
                          <button
                            key={tk}
                            onClick={() => setSelectedTiers((prev) => ({ ...prev, [r.preset.name.zh]: tk }))}
                            className={`flex-1 rounded px-2 py-1 text-[10px] font-semibold transition ${
                              tier === tk
                                ? "bg-violet-600 text-white"
                                : "text-slate-500 hover:text-slate-300"
                            }`}
                          >
                            {lang === "en" ? TIER_LABELS[tk].en : TIER_LABELS[tk].zh}
                          </button>
                        ))}
                      </div>

                      <div className="mb-1.5 flex flex-wrap gap-1">
                        {v.legs.map((l, li) => (
                          <span key={li} className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[9px] tabular-nums text-slate-300">
                            {l.kind === "stock"
                              ? t("scenario.legStock")
                              : `${l.action === "buy" ? "+" : "-"}${l.type === "call" ? "C" : "P"} ${l.strike}`}
                          </span>
                        ))}
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-[10px]">
                        <div>
                          <span className="text-slate-600">{t("scenario.returnOnRisk")}</span>
                          <div className={`font-semibold tabular-nums ${(v.returnOnRisk ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {v.returnOnRisk !== null ? `${(v.returnOnRisk * 100).toFixed(0)}%` : "—"}
                          </div>
                        </div>
                        <div>
                          <span className="text-slate-600">{t("leg.pop")}</span>
                          <div className="font-semibold tabular-nums text-slate-300">{(v.pop * 100).toFixed(0)}%</div>
                        </div>
                        <div>
                          <span className="text-slate-600">{t("scenario.maxProfit")}</span>
                          <div className="font-semibold tabular-nums text-emerald-400">${v.maxProfit.toFixed(0)}</div>
                        </div>
                        <div>
                          <span className="text-slate-600">{t("scenario.maxLoss")}</span>
                          <div className="font-semibold tabular-nums text-rose-400">${v.maxLoss.toFixed(0)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}