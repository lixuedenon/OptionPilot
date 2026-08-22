import { useEffect, useState } from "react";
import { GitCompare, X, RefreshCw } from "lucide-react";
import type { Leg } from "@/lib/types";
import { compareDecisions, type DecisionScenario } from "@/lib/decisionCompare";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  legs: Leg[];
  targetLegId: string;
  spot: number;
  symbol: string;
  onClose: () => void;
}

const LABEL_KEY: Record<DecisionScenario["key"], string> = {
  doNothing: "compare2.doNothing",
  close: "compare2.close",
  roll: "compare2.roll",
};

function fmtMoney(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

export default function DecisionCompareDialog({ legs, targetLegId, spot, symbol, onClose }: Props) {
  const { t } = useI18n();
  const targetLeg = legs.find((l) => l.id === targetLegId);
  const [scenarios, setScenarios] = useState<DecisionScenario[] | null>(null);
  const [loadingRoll, setLoadingRoll] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // doNothing/close are pure local math — show them immediately rather
    // than waiting on the network call the roll scenario needs, then
    // append roll once (if) it resolves. compareDecisions itself already
    // returns doNothing+close synchronously fast and only awaits network
    // time for the roll leg, but we still show a loading indicator for
    // the roll row specifically since the table renders before that
    // promise settles.
    setLoadingRoll(true);
    compareDecisions(legs, targetLegId, spot, symbol).then((result) => {
      if (!cancelled) {
        setScenarios(result);
        setLoadingRoll(false);
      }
    }).catch(() => {
      if (!cancelled) setLoadingRoll(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLegId]);

  const rollAvailable = scenarios?.some((s) => s.key === "roll") ?? false;
  const rows = scenarios ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[520px] max-w-[92vw] rounded-xl border border-violet-500/30 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitCompare size={18} className="text-violet-400" />
            <h3 className="text-sm font-bold text-violet-200">{t("compare2.title")}</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 transition hover:text-slate-300">
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-[11px] text-slate-500">{t("compare2.subtitle")}</p>

        {targetLeg && (
          <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-800/40 p-2.5 text-[11px] text-slate-300">
            {targetLeg.action === "buy" ? t("leg.buy") : t("leg.sell")} {targetLeg.kind === "stock" ? t("hedge.stock") : (targetLeg.type === "call" ? "Call" : "Put")}
            {targetLeg.kind !== "stock" && <> {targetLeg.strike} · {Math.round(targetLeg.dte)}{t("roll.days")}</>}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="bg-slate-900/60 text-slate-500">
                <th className="px-3 py-2 font-medium"></th>
                <th className="px-3 py-2 font-medium">{t("compare2.netValue")}</th>
                <th className="px-3 py-2 font-medium">{t("compare2.maxProfit")}</th>
                <th className="px-3 py-2 font-medium">{t("compare2.maxLoss")}</th>
                <th className="px-3 py-2 font-medium">{t("compare2.pop")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.key} className="border-t border-slate-800/60 text-slate-300">
                  <td className="px-3 py-2 font-semibold text-slate-200">{t(LABEL_KEY[s.key])}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtMoney(s.netValue)}</td>
                  <td className="px-3 py-2 tabular-nums text-emerald-400">{fmtMoney(s.maxProfit)}</td>
                  <td className="px-3 py-2 tabular-nums text-rose-400">{fmtMoney(s.maxLoss)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {s.key === "close" ? (
                      <span className="text-slate-600">{t("compare2.closedNoPop")}</span>
                    ) : (
                      `${(s.pop * 100).toFixed(0)}%`
                    )}
                  </td>
                </tr>
              ))}
              {loadingRoll && (
                <tr className="border-t border-slate-800/60 text-slate-500">
                  <td className="px-3 py-2 font-semibold">{t("compare2.roll")}</td>
                  <td colSpan={4} className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <RefreshCw size={11} className="animate-spin" />
                      {t("compare2.loadingRoll")}
                    </span>
                  </td>
                </tr>
              )}
              {!loadingRoll && !rollAvailable && targetLeg?.kind !== "stock" && (
                <tr className="border-t border-slate-800/60 text-slate-600">
                  <td className="px-3 py-2 font-semibold">{t("compare2.roll")}</td>
                  <td colSpan={4} className="px-3 py-2">{t("compare2.rollUnavailable")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          {targetLeg?.kind === "stock" ? t("compare2.noRollOnStock") : t("compare2.rollHint")}
        </p>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}