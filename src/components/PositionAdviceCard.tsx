// src/components/PositionAdviceCard.tsx
// 持仓建议卡片（左栏，盈亏归因下面）：先描述组合（策略、开仓/到期、权利金、隐含波动率），再给五种建议之一和一句主要理由，
// 然后股价/时间/盈利/往后四行（触发建议的那一行加▶），最后是指派等提示。计算在positionAdvisor.ts。
// 推演未来：跟着情景滑块/地形图上指的点走；今昔对比：今天的持仓、开仓以来总盈亏（含已实现）。
// 止盈止损、平仓时间、假设波动跟胜率模拟共用一份设定（simSettings.ts）。
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nContext";
import type { Leg } from "@/lib/types";
import type { CustomPreset } from "@/lib/customPresets";
import { PRESET_GROUPS } from "@/lib/presets";
import { matchStrategy } from "@/lib/matchStrategy";
import { addCalendarDays } from "@/lib/dateUtils";
import { comboBaseIv } from "@/lib/stockOptionMap";
import { ncdf } from "@/lib/bs";
import { openingBasis, isCreditCombo, prepareSim, earningsShift, capJump } from "@/lib/winRateSim";
import { comboDelta } from "@/lib/legDelta";
import { adviseCombo, ADVICE_DRIVER, type Advice, type AdviceAction, type AdviceDriver } from "@/lib/positionAdvisor";
import { useSimSettings, useHv20, fracLabel } from "@/lib/simSettings";
import { exEarningsVol, type EarningsCtx } from "@/lib/earnings";
import EarningsRow from "@/components/EarningsRow";

interface Props {
  mode: "analysis" | "tracked";
  symbol: string;
  openingLegs: Leg[]; // 开仓组合（已去掉屏蔽的），dte按开仓那天算
  openingSpot: number;
  openingAt: number;
  nowLegs: Leg[] | null; // 此刻的腿位（权利金=此刻价格）；null=情景日期已过最早到期日
  nowSpot: number;
  nowDay: number; // 开仓后第几天
  pnl: number; // 开仓以来总盈亏（每股，含已实现）
  adjusted?: boolean; // 今昔对比：中途展期/平仓/保护过
  customPresets: CustomPreset[];
  onOpenSettings: () => void;
  // 推演未来：市场预期波动（最近到期日平值IV，见lib/atmIv.ts），跟地形图喇叭口、万次推演、波动率滑块小字同一个数；
  // 不传或null就按各腿隐含波动率平均（今昔对比一直按各腿平均：拿不到开仓那天的期权链）。
  marketIv?: number | null;
  // 第3组：微笑斜率（下跌时IV上升，设定里可关）和各腿半个买卖价差（提前平仓的成交损耗），下标跟openingLegs一致
  skew?: number;
  halfSpread?: (number | undefined)[];
  // 财报这一组：下一次财报（App的useEarningsContext）；liveSpot=今天的股价（市场押的幅度按今天的期权价算）
  earnings?: EarningsCtx | null;
  liveSpot?: number;
}

const ACTION_CLS: Record<AdviceAction, string> = {
  takeProfit: "bg-emerald-500/20 text-emerald-300",
  stopLoss: "bg-rose-500/20 text-rose-300",
  hold: "bg-slate-700/60 text-slate-200",
  holdOrTakeProfit: "text-emerald-300 ring-1 ring-inset ring-emerald-500/60",
  holdOrStopLoss: "text-amber-300 ring-1 ring-inset ring-amber-500/60",
};

function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}
const usd = (v: number) => `$${Math.abs(v).toFixed(2)}`;
const pct0 = (v: number) => String(Math.round(v * 100));
// 不到1%时保留一位小数，避免出现"要跌0%"。
const pctSmall = (v: number) => (Math.abs(v) < 0.01 ? (v * 100).toFixed(1) : String(Math.round(v * 100)));
const fmtStrike = (k: number) => (Number.isInteger(k) ? String(k) : k.toFixed(2));

export default function PositionAdviceCard({ mode, symbol, openingLegs, openingSpot, openingAt, nowLegs, nowSpot, nowDay, pnl, adjusted, customPresets, onOpenSettings, marketIv, skew = 0, halfSpread, earnings = null, liveSpot }: Props) {
  const { t, lang } = useI18n();
  const { rules: rulesBySide, volOverride, driftPct, ivSkewOn, earnJumpOn } = useSimSettings(symbol);
  const effSkew = ivSkewOn ? skew : 0;
  const hv = useHv20(symbol);

  const basis = useMemo(() => openingBasis(openingLegs), [openingLegs]);
  const credit = useMemo(() => isCreditCombo(openingLegs), [openingLegs]);
  const rules = rulesBySide[credit ? "credit" : "debit"];
  const options = openingLegs.filter((l) => l.kind !== "stock");
  const hasStock = openingLegs.some((l) => l.kind === "stock") || (nowLegs ?? []).some((l) => l.kind === "stock");
  const totalTerm = options.length ? Math.max(1, Math.round(Math.min(...options.map((l) => l.dte)))) : 0;
  const legsOpenIv = useMemo(() => comboBaseIv(openingLegs, openingSpot), [openingLegs, openingSpot]);
  const legsNowIv = useMemo(() => (nowLegs ? comboBaseIv(nowLegs, nowSpot) : null), [nowLegs, nowSpot]);
  const useMarket = mode === "analysis" && marketIv != null && marketIv > 0.01;
  const openingIv = useMarket ? marketIv! : legsOpenIv;
  // 推演未来的情景IV = 平值IV + 情景里各腿IV的变化（就是波动率滑块的变化量）
  const nowIv = useMarket ? (legsNowIv != null && legsOpenIv != null ? Math.max(0.01, marketIv! + legsNowIv - legsOpenIv) : null) : legsNowIv;
  // 默认的假设波动跟胜率模拟一样：历史20日，取不到就用隐含（推演未来按开仓时，今昔对比按今天）。
  const ivForDefault = (mode === "analysis" ? openingIv : nowIv) ?? 0.3;
  const vol = volOverride != null ? volOverride / 100 : hv.status === "ok" && hv.hv20 ? hv.hv20 : ivForDefault;
  const volReady = volOverride != null || hv.status !== "loading";
  // 财报这一组：从此刻算第几天有财报（此刻=情景点/今天；剩余天数=此刻腿位的最早到期）。开关打开、有跳空大小时，建议里的推演也加跳空（跟万次推演一样）
  const remaining = nowLegs ? Math.max(0, Math.round(Math.min(...nowLegs.filter((l) => l.kind !== "stock" && !l.disabled).map((l) => l.dte), Infinity))) : 0;
  const earnRel = earnings ? earnings.dayFromOpen - Math.round(nowDay) : null;
  const earnIn = earnRel != null && earnRel >= 1 && earnRel <= remaining ? earnRel : null;
  // 跳空不超过隐含波动率装得下的（跟万次推演、引擎同一个下限，见winRateSim.capJump）。
  // 推演未来：按开仓时的市场预期波动和开仓总期限；今昔对比：按今天的隐含波动率和剩余天数。
  const capIv = (mode === "analysis" ? openingIv : nowIv) ?? vol;
  const capDays = mode === "analysis" ? totalTerm : remaining;
  const jumpCapped = earnings?.jump != null && earnings.jump > 0 ? capJump(earnings.jump, capIv, capDays) : null;
  const earnSim = earnJumpOn && earnIn != null && jumpCapped != null ? { day: earnIn, jump: jumpCapped } : null;
  const volFromIv = volOverride == null && !(hv.status === "ok" && hv.hv20);
  // 按隐含波动率推演时扣掉跳空，免得算两遍。⚠️ 推演未来要跟万次推演一样：平常波动按开仓总期限从开仓时的隐含波动率里扣
  // （财报过了以后也是这个平常波动）；今昔对比用今天的隐含波动率，财报还在后面才扣、按剩余天数扣。
  const earnInOpening = earnings != null && earnings.dayFromOpen >= 1 && earnings.dayFromOpen <= totalTerm;
  const simVol = !volFromIv || !earnJumpOn || jumpCapped == null
    ? vol
    : mode === "analysis"
      ? (earnInOpening ? exEarningsVol(vol, jumpCapped, totalTerm) : vol)
      : (earnSim ? exEarningsVol(vol, jumpCapped, remaining) : vol);
  // 推演未来：开了财报跳空时，情景点的腿位和盈亏按财报前后隐含波动率的变化重算（跟万次推演从情景点出发那团云同一份，见winRateSim.earningsShift）
  const shift = useMemo(() => {
    if (mode !== "analysis" || !earnJumpOn || !earnings || earnings.jump == null || !(earnings.jump > 0) || !nowLegs || basis == null) return null;
    if (earnings.dayFromOpen < 1 || earnings.dayFromOpen > totalTerm) return null;
    const pe = prepareSim({ legs: openingLegs, spot: openingSpot, basis, pnlOffset: 0, rules, totalTerm, earnings: { day: earnings.dayFromOpen, jump: jumpCapped ?? earnings.jump } });
    return pe ? earningsShift(pe, nowDay, nowSpot, nowLegs) : null;
  }, [mode, earnJumpOn, earnings, jumpCapped, nowLegs, basis, totalTerm, openingLegs, openingSpot, rules, nowDay, nowSpot]);
  const advLegs = shift ? shift.legs : nowLegs;
  const advPnl = pnl + (shift?.dPnl ?? 0);
  const earnKey = earnSim ? `${earnSim.day}:${earnSim.jump.toFixed(4)}` : "";

  const descLegs = mode === "tracked" && nowLegs ? nowLegs : openingLegs;
  const name = useMemo(() => {
    const zh = matchStrategy(descLegs, openingSpot, customPresets);
    const preset = PRESET_GROUPS.flatMap((g) => g.items).find((i) => i.name.zh === zh);
    return preset ? preset.name[lang] : zh;
  }, [descLegs, openingSpot, customPresets, lang]);

  // 模拟要几十毫秒：输入停下来一会儿再算（地形图上鼠标移动时不至于卡）；固定种子，同样的输入给同样的结果。
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [sdOpen, setSdOpen] = useState(false);
  const runKey = useMemo(() => {
    if (!advLegs || basis == null || hasStock || !volReady) return "";
    const lk = advLegs.map((l) => [l.action, l.type, l.strike, l.dte.toFixed(2), l.premium.toFixed(4), l.qty ?? 1].join(":")).join("|");
    return [lk, nowSpot.toFixed(3), advPnl.toFixed(4), basis.toFixed(4), JSON.stringify(rules), simVol.toFixed(4), driftPct, totalTerm, credit, useMarket && nowIv != null ? nowIv.toFixed(4) : "", effSkew.toFixed(3), (halfSpread ?? []).map((h) => (h == null ? "-" : h.toFixed(3))).join(","), earnKey].join("#");
  }, [advLegs, nowSpot, advPnl, basis, hasStock, volReady, rules, simVol, driftPct, totalTerm, credit, useMarket, nowIv, effSkew, halfSpread, earnKey]);
  useEffect(() => {
    if (!runKey || !advLegs || basis == null) {
      setAdvice(null);
      return;
    }
    const id = window.setTimeout(() => {
      try {
        setAdvice(
          adviseCombo({
            legs: advLegs, spot: nowSpot, basis, credit, pnl: advPnl, totalTerm, rules, vol: simVol, earnings: earnSim, iv: useMarket && nowIv != null ? nowIv : undefined, skew: effSkew, halfSpread: advLegs.length === (halfSpread ?? []).length ? halfSpread : undefined,
            drift: credit ? 0 : driftPct / 100, n: mode === "tracked" ? 3000 : 1500, seed: 20261001,
          }),
        );
      } catch {
        setAdvice(null);
      }
    }, 250);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  if (options.length === 0) return null;

  const legText = descLegs
    .filter((l) => l.kind !== "stock")
    .map((l) => `${t(l.action === "buy" ? "advice.buy" : "advice.sell")}${fmtStrike(l.strike)} ${l.type === "call" ? "Call" : "Put"}${(l.qty ?? 1) > 1 ? ` ×${l.qty}` : ""}`)
    .join(" / ");
  const expiryTs = addCalendarDays(openingAt, totalTerm);
  const nowTs = addCalendarDays(openingAt, Math.max(0, Math.round(nowDay)));

  const header = (
    <div className="space-y-0.5 text-[11px] text-slate-400">
      <div className="text-[12px] font-semibold text-slate-200">
        {name || t("advice.customCombo")} <span className="font-normal text-slate-400">· {symbol} · {legText}</span>
      </div>
      <div>{t("advice.opened", { date: fmtDate(openingAt), s: openingSpot.toFixed(2), exp: fmtDate(expiryTs), d: totalTerm })}</div>
      <div>
        {basis != null && t(credit ? "advice.premiumCredit" : "advice.premiumDebit", { v: usd(basis) })}
        {openingIv != null && (
          <>
            {basis != null && " · "}
            {t("advice.ivOpen", { v: pct0(openingIv) })}
            {nowIv != null && t(mode === "tracked" ? "advice.ivNow" : "advice.ivScenario", { v: pct0(nowIv) })}
          </>
        )}
      </div>
      {mode === "tracked" && adjusted && <div className="text-amber-300/80">{t("advice.adjusted")}</div>}
    </div>
  );

  const title = (
    <div className="mb-1 flex items-baseline justify-between gap-2">
      <span className="text-[12px] font-bold text-sky-300">{t("advice.title")}</span>
      <span className="text-[10px] text-slate-500">
        {mode === "tracked"
          ? t("advice.atToday", { date: fmtDate(nowTs) })
          : t("advice.atScenario", { date: fmtDate(nowTs), d: Math.round(nowDay), s: nowSpot.toFixed(2) })}
      </span>
    </div>
  );

  let body: ReactNode;
  if (hasStock) body = <div className="text-[11px] text-slate-400">{t("advice.noStock")}</div>;
  else if (basis == null) body = <div className="text-[11px] text-slate-400">{t("advice.noBasis")}</div>;
  else if (!nowLegs) body = <div className="text-[11px] text-slate-400">{t("advice.expired")}</div>;
  else if (!advice) body = <div className="text-[11px] text-slate-500">{t("advice.computing")}</div>;
  else body = renderAdvice(advice);

  return (
    // 左边那一列标签（股价/时间/方向/财报…）的宽度：英文词更长，34px会把"Direction"截掉、"Earnings"压到内容上
    <div className="rounded border border-slate-700/80 bg-slate-900/60 px-2.5 py-2" style={{ ["--lbl" as string]: lang === "en" ? "62px" : "34px" }}>
      {title}
      {header}
      <div className="mt-1.5 border-t border-slate-800 pt-1.5">{body}</div>
    </div>
  );

  function renderAdvice(a: Advice) {
    const cr = credit;
    const r = rules;
    const term = totalTerm;
    const v = vol;
    const dp = driftPct;
    const s = a.signals;
    const driver: AdviceDriver = ADVICE_DRIVER[a.rule];
    const S = nowSpot;
    let priceTxt: string;
    if (s.nearestBe != null && s.sigmaToEdge != null && Math.abs(s.sigmaToEdge) < 0.05) priceTxt = t("advice.priceAtBe", { s: S.toFixed(2), be: s.nearestBe.toFixed(2) });
    else if (s.inProfitZone)
      priceTxt = s.nearestBe != null
        ? t("advice.priceIn", { s: S.toFixed(2), be: s.nearestBe.toFixed(2), p: pctSmall(Math.abs(s.nearestBe / S - 1)), z: s.sigmaToEdge!.toFixed(1) })
        : t("advice.priceInNoBe", { s: S.toFixed(2) });
    else
      priceTxt = s.nearestBe != null
        ? t("advice.priceOut", { s: S.toFixed(2), be: s.nearestBe.toFixed(2), dir: t(s.nearestBe > S ? "advice.up" : "advice.down"), p: pctSmall(Math.abs(s.nearestBe / S - 1)), z: (-s.sigmaToEdge!).toFixed(1) })
        : t("advice.priceOutNoBe", { s: S.toFixed(2) });
    // "几个标准差"对新手是个黑话：点开后用通勤打比方，再给出按这个幅度粗算的概率。
    const sdLines: string[] = [];
    if (s.nearestBe != null && s.sigmaToEdge != null && Math.abs(s.sigmaToEdge) >= 0.05) {
      const z = Math.abs(s.sigmaToEdge);
      const inZ = s.inProfitZone;
      const tier = z < 0.5 ? 0 : z < 1 ? 1 : z < 2 ? 2 : 3;
      const beyond = 1 - ncdf(z);
      sdLines.push(
        t("advice.sdWhat", { iv: (s.sigmaIv * 100).toFixed(0), d: s.remainingDays, m: pctSmall(s.sigmaMove), usd: usd(S * s.sigmaMove) }),
        t(inZ ? "advice.sdAnalogyIn" : "advice.sdAnalogyOut", {
          z: z.toFixed(1), min: Math.max(1, Math.round(z * 10)), tier: t(`advice.sdTier${inZ ? "In" : "Out"}${tier}`),
        }),
        t(inZ ? "advice.sdOddsIn" : "advice.sdOddsOut", { be: s.nearestBe.toFixed(2), pe: pct0(beyond), pt: pct0(Math.min(1, 2 * beyond)) }),
      );
    }
    const priceCell = (
      <>
        <div>
          {priceTxt}
          {sdLines.length > 0 && (
            <button onClick={() => setSdOpen((o) => !o)} className="ml-1.5 text-[10px] font-normal text-sky-400 underline-offset-2 hover:underline">
              {t(sdOpen ? "advice.sdClose" : "advice.sdOpen")}
            </button>
          )}
        </div>
        {sdOpen && sdLines.length > 0 && (
          <div className="mt-0.5 space-y-0.5 rounded border border-slate-700/70 bg-slate-950/50 px-1.5 py-1 text-[10.5px] font-normal text-slate-300">
            {sdLines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </>
    );
    const timeTxt = t("advice.time", { p: pct0(s.elapsed), d: s.remainingDays });
    // 方向（2026-10-06）：组合Delta——股价动$1钱动多少、相当于拿着多少股；再说到盈亏平衡点时会变成多少（IV按各腿不变）。
    // 只说大小和变化，不用它判断看涨看跌（见lib/legDelta.ts开头）。
    let dirTxt: string | null = null;
    const dNow = nowLegs ? comboDelta(nowLegs, S) : null;
    if (dNow != null) {
      const sh = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}`;
      const shares = (d: number) => Math.round(d * 100);
      dirTxt = Math.abs(dNow) < 0.005
        ? t("advice.dirFlat")
        : t("advice.dir", { d: sh(dNow), n: shares(dNow), v: usd(dNow), up: t(dNow > 0 ? "advice.dirGain" : "advice.dirLose"), dn: t(dNow > 0 ? "advice.dirLose" : "advice.dirGain") });
      const be = s.nearestBe;
      if (be != null && nowLegs && Math.abs(be / S - 1) > 0.003) {
        const dBe = comboDelta(nowLegs, S, be);
        if (dBe != null && Math.abs(dBe - dNow) >= 0.02) {
          dirTxt += t(Math.abs(dBe) > Math.abs(dNow) ? "advice.dirAtBeMore" : "advice.dirAtBeLess", { be: be.toFixed(2), d: sh(dBe), n: shares(dBe) });
        }
      }
    }
    const base = t(cr ? "advice.basePremium" : "advice.baseCost");
    const pnlTxt =
      Math.abs(s.pnl) < 0.005
        ? t("advice.pnlFlat")
        : t(s.pnl > 0 ? "advice.pnlUp" : "advice.pnlDown", { v: usd(s.pnl), base, p: pct0(Math.abs(s.pnlPct)) }) +
          (s.pnl > 0 && s.capture != null ? t("advice.pnlCapture", { c: pct0(s.capture) }) : "") +
          (shift && Math.abs(shift.dPnl) >= 0.005 ? t("earn.scenShift", { v: usd(shift.dPnl), dir: t(shift.dPnl > 0 ? "earn.more" : "earn.less") }) : "");
    const tpTxt = r.takeProfitPct == null ? t("advice.tpNone") : t("advice.tpRule", { x: t("winRate.tpOpt", { n: Math.round(r.takeProfitPct * 100) }) });
    const slTxt = r.stopMult == null
      ? t("advice.slNone")
      : t("advice.slRule", { x: cr ? t("winRate.slOpt", { n: r.stopMult }) : t("winRate.slOptDebit", { n: Math.round(r.stopMult * 100) }) });
    const closeTxt = r.closeFrac > 0 ? t("winRate.closeOptFrac", { f: fracLabel(r.closeFrac), d: Math.max(1, Math.round(term * r.closeFrac)) }) : t("winRate.holdToExpiry");
    const settingsTxt = t("advice.settings", { tp: tpTxt, sl: slTxt, close: closeTxt, v: (v * 100).toFixed(1) }) + (cr ? "" : t("advice.settingsDrift", { d: dp }));
    // 已经碰到规则线时，"继续拿"的概率没有意义（模拟第一天就出场）。
    const atRule = a.rule === "hitTp" || a.rule === "hitSl" || a.rule === "closeTime";
    // 四种出场加起来=100%，把"到时间平仓/拿到到期"也列出来，否则止盈止损都是0%时看起来像矛盾。
    const exits = [
      r.takeProfitPct != null ? t("advice.exitTp", { p: pct0(s.pTp) }) : null,
      r.stopMult != null ? t("advice.exitSl", { p: pct0(s.pSl) }) : null,
      r.deltaExit != null ? t("advice.exitDelta", { p: pct0(s.pDelta), d: r.deltaExit.toFixed(2) }) : null,
      r.closeFrac > 0 ? t("advice.exitTime", { p: pct0(s.pTime), d: Math.max(1, Math.round(term * r.closeFrac)) }) : null,
      r.closeFrac === 0 || s.pExpiry > 0.005 ? t("advice.exitExpiry", { p: pct0(s.pExpiry) }) : null,
    ].filter(Boolean).join(t("advice.listSep"));
    const fwdTxt = atRule ? t("advice.forwardNow") : t("advice.forward", { exits, w: pct0(s.pWin) });
    // 规则线在这个组合上根本碰不到（比如止损1倍，但组合最多只亏0.4倍）：直说，免得用户以为模拟出错。
    const unreachable: string[] = [];
    if (!atRule && Number.isFinite(s.slLine) && s.maxLoss != null && s.maxLoss > s.slLine + 1e-6)
      unreachable.push(t("advice.slUnreachable", { line: usd(s.slLine), max: usd(s.maxLoss) }));
    if (!atRule && Number.isFinite(s.tpLine) && s.maxProfit != null && s.maxProfit < s.tpLine - 1e-6)
      unreachable.push(t("advice.tpUnreachable", { line: usd(s.tpLine), max: usd(s.maxProfit) }));
    const roomTxt = t("advice.room", {
      g: s.remainingGain == null ? t("advice.unlimited") : usd(s.remainingGain),
      r: s.remainingRisk == null ? t("advice.unlimited") : usd(s.remainingRisk),
    });
    const why = t(`advice.why.${a.rule}`, {
      rr: pct0(s.rrRel ?? 0), z: (s.sigmaToEdge ?? 0).toFixed(1), sl: pct0(s.pSl), w: pct0(s.pWin),
    });
    const row = (key: Exclude<AdviceDriver, null>, label: string, lines: ReactNode[]) => (
      <div className={`grid grid-cols-[14px_var(--lbl,34px)_1fr] gap-x-1 ${driver === key ? "text-slate-100" : "text-slate-400"}`}>
        <span className="text-sky-400">{driver === key ? "▶" : ""}</span>
        <span className={driver === key ? "font-semibold" : "text-slate-500"}>{label}</span>
        <span className={`min-w-0 ${driver === key ? "font-semibold" : ""}`}>
          {lines.map((l, i) => <div key={i}>{l}</div>)}
        </span>
      </div>
    );
    return (
      <div className="space-y-1 text-[11px] leading-snug">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`rounded px-1.5 py-0.5 text-[12px] font-bold ${ACTION_CLS[a.action]}`}>{t(`advice.act.${a.action}`)}</span>
          <span className="min-w-0 text-[12px] text-slate-200">{why}</span>
        </div>
        {row("price", t("advice.lblPrice"), [priceCell])}
        {row("time", t("advice.lblTime"), [timeTxt])}
        {dirTxt && (
          <div className="grid grid-cols-[14px_var(--lbl,34px)_1fr] gap-x-1 text-slate-400">
            <span />
            <span className="text-slate-500">{t("advice.lblDir")}</span>
            <span className="min-w-0">{dirTxt}</span>
          </div>
        )}
        {earnings && nowLegs && (
          <EarningsRow
            earnings={earnings}
            day={earnIn}
            legs={nowLegs}
            spot={liveSpot && liveSpot > 0 ? liveSpot : nowSpot}
            expiryDate={fmtDate(addCalendarDays(openingAt, totalTerm))}
            afterNow={earnRel != null && earnRel < 1 && earnings.dayFromOpen <= totalTerm}
          />
        )}
        {row("pnl", t("advice.lblPnl"), [pnlTxt])}
        {row("forward", t("advice.lblForward"), [settingsTxt, fwdTxt, ...unreachable, roomTxt])}
        {s.flags.map((f) => (
          <div key={f} className="text-amber-300">⚠ {t(f === "assignment" ? "advice.flagAssignment" : "advice.flagPin")}</div>
        ))}
        <div className="flex flex-wrap items-center gap-x-2 pt-0.5 text-[10px] text-slate-500">
          <span>{t("advice.footer")}</span>
          <button onClick={onOpenSettings} className="text-sky-400 underline-offset-2 hover:underline">{t("advice.openSettings")}</button>
        </div>
      </div>
    );
  }
}
