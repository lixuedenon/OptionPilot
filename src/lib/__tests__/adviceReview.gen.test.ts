// src/lib/__tests__/adviceReview.gen.test.ts
// 生成"通用持仓建议"抽查表（不是常规测试，平时跳过）：GEN_REVIEW=输出路径 npx vitest run adviceReview
// 42个内置预设（开仓价100、统一按30%隐含波动率重定价），每个在几种股价×时间点下给出建议和理由；
// 熊市Call价差/牛市Put价差另跑一张密格，跟原来审过的540格表对比。
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import type { Leg } from "@/lib/types";
import { PRESET_GROUPS } from "@/lib/presets";
import { bsPrice } from "@/lib/bs";
import { adviseCombo, type Advice } from "@/lib/positionAdvisor";
import { openingBasis, isCreditCombo, type SimRules } from "@/lib/winRateSim";
import { bearCallSpreadTable } from "@/lib/bearCallSpreadTable";
import { bullPutSpreadTable } from "@/lib/bullPutSpreadTable";

const OUT = process.env.GEN_REVIEW;
const IV = 0.3;
const S0 = 100;
const price = (l: Leg, S: number, dte: number) =>
  l.kind === "stock" ? S : dte <= 0 ? (l.type === "call" ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S)) : bsPrice(S, l.strike, dte, IV, 0.05, l.type);
const RULES: Record<"credit" | "debit", SimRules> = {
  credit: { takeProfitPct: 0.5, stopMult: 1, closeFrac: 0.25 },
  debit: { takeProfitPct: 1, stopMult: 0.5, closeFrac: 0.25 },
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const pc = (v: number) => `${Math.round(v * 100)}%`;
const usd = (v: number) => `${v < -0.005 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;

const RULE_TEXT: Record<string, (a: Advice) => string> = {
  hitTp: () => "已经到了止盈线",
  hitSl: () => "已经到了止损线",
  closeTime: () => "已到你设的到期前平仓时间",
  capture: () => "已赚到最大可赚的四分之三以上，剩下的不值得再冒险",
  rr: (a) => `剩下的收益风险比只剩开仓时的${pc(a.signals.rrRel ?? 0)}，不值得再冒险`,
  rrWatch: (a) => `剩下的收益风险比降到开仓时的${pc(a.signals.rrRel ?? 0)}`,
  nearEdge: (a) => `股价离盈亏平衡点只有${(a.signals.sigmaToEdge ?? 0).toFixed(1)}个标准差，稍往不利方向走就会转亏`,
  pStop: (a) => `继续拿有${pc(a.signals.pSl)}的走势会被止损`,
  debitLate: () => "已过四分之三时间，买方的时间损耗在加速",
  outside: () => "股价已在亏损区外1个标准差以上，且时间已过一半",
  recover: () => "最后回到盈利的概率不到20%",
  recoverWatch: () => "最后回到盈利的概率不到40%",
  outsideWatch: () => "股价在亏损区，需要回头才能赚钱",
  debitLoss: () => "亏损已接近止损线",
  ok: () => "股价、时间、盈利都在正常范围",
};
const ACTION_TEXT = { takeProfit: "止盈平仓", stopLoss: "止损平仓", hold: "持有", holdOrTakeProfit: "持有或止盈", holdOrStopLoss: "持有或止损" };

function reasons(a: Advice, S: number, credit: boolean) {
  const s = a.signals;
  const priceTxt = s.inProfitZone
    ? `股价${S.toFixed(2)}，在盈利区内` + (s.nearestBe != null ? `，离盈亏平衡点${s.nearestBe.toFixed(2)}还有${s.sigmaToEdge!.toFixed(1)}个标准差` : "，附近没有盈亏平衡点")
    : s.nearestBe != null
      ? `股价${S.toFixed(2)}，在亏损区，回到盈亏平衡点${s.nearestBe.toFixed(2)}要${s.nearestBe > S ? "涨" : "跌"}${pc(Math.abs(s.nearestBe / S - 1))}（约${(-s.sigmaToEdge!).toFixed(1)}个标准差）`
      : `股价${S.toFixed(2)}，在亏损区`;
  const timeTxt = `时间已过${pc(s.elapsed)}，剩${s.remainingDays}天`;
  const base = credit ? "开仓收的权利金" : "开仓成本";
  const pnlTxt = `${s.pnl >= 0 ? "已赚" : "已亏"}${usd(Math.abs(s.pnl))}（${base}的${pc(Math.abs(s.pnlPct))}` + (s.capture != null && s.pnl > 0 ? `，最大可赚的${pc(s.capture)}` : "") + "）";
  const fwd = `按规则继续拿：止盈${pc(s.pTp)}、止损${pc(s.pSl)}、最后赚钱${pc(s.pWin)}`;
  const room = `剩下最多还能赚${s.remainingGain == null ? "（不封顶）" : usd(s.remainingGain)}，最多可能再亏${s.remainingRisk == null ? "（不封顶）" : usd(s.remainingRisk)}`;
  const flags = s.flags.map((f) => (f === "assignment" ? "⚠ 卖出腿已实值、临近到期，有提前指派风险" : "⚠ 卖出腿贴着行权价临近到期")).join("；");
  return { priceTxt, timeTxt, pnlTxt, fwd, room, why: RULE_TEXT[a.rule](a), flags };
}

// 原来540格表的结论（只用于熊市Call/牛市Put价差的对比）。亏损%按最大亏损算，盈利%按开仓收的权利金算——表里档位的分母原文没写死，这是按最常见的读法。
function tableAction(kind: "bearCall" | "bullPut", legs: Leg[], S: number, elapsed: number, pnl: number, credit: number, maxLoss: number) {
  const shortK = legs.find((l) => l.action === "sell")!.strike;
  const longK = legs.find((l) => l.action === "buy")!.strike;
  const mid = (shortK + longK) / 2;
  let zone: number;
  if (kind === "bearCall") zone = S < shortK * 0.99 ? 0 : S <= shortK * 1.01 ? 1 : S < mid ? 2 : S < longK ? 3 : 4;
  else zone = S > shortK * 1.01 ? 0 : S >= shortK * 0.99 ? 1 : S > mid ? 2 : S > longK ? 3 : 4;
  const bounds = [15, 25, 35, 45, 55, 65, 75, 85, 100];
  const period = Math.min(8, bounds.findIndex((b) => elapsed * 100 < b) === -1 ? 8 : bounds.findIndex((b) => elapsed * 100 < b));
  let bracket: number;
  if (pnl >= 0) {
    const p = (pnl / credit) * 100;
    bracket = p >= 50 ? 0 : p >= 40 ? 1 : p >= 30 ? 2 : p >= 20 ? 3 : p >= 10 ? 4 : 5;
  } else {
    const l = (-pnl / Math.abs(maxLoss)) * 100;
    bracket = l < 10 ? 6 : l < 20 ? 7 : l < 30 ? 8 : l < 40 ? 9 : l < 50 ? 10 : 11;
  }
  const table = kind === "bearCall" ? bearCallSpreadTable.zh : bullPutSpreadTable.zh;
  let act = table[zone][period][bracket][0];
  if (zone <= 1 && pnl < 0) act = -pnl >= 0.7 * Math.abs(maxLoss) ? "CLOSE" : "HOLD";
  const mapped = act === "CLOSE" ? (pnl >= 0 ? "takeProfit" : "stopLoss") : act === "MONITOR" ? (pnl >= 0 ? "holdOrTakeProfit" : "holdOrStopLoss") : "hold";
  return { act, mapped, cell: `${zone}-${period}-${bracket}`, advice: table[zone][period][bracket][2] };
}

it.skipIf(!OUT)("generate advice review", () => {
  const rows: Record<string, unknown>[] = [];
  const compare: Record<string, unknown>[] = [];
  for (const grp of PRESET_GROUPS) {
    for (const item of grp.items) {
      const raw = item.legs();
      const name = item.name.zh;
      if (raw.some((l) => l.kind === "stock")) {
        rows.push({ group: grp.group.zh, name, unsupported: "含正股，暂不支持" });
        continue;
      }
      const open = raw.map((l) => ({ ...l, premium: r2(price(l, S0, l.dte)) }));
      const credit = isCreditCombo(open);
      const basis = openingBasis(open);
      if (basis == null) {
        rows.push({ group: grp.group.zh, name, unsupported: "开仓净权利金≈0" });
        continue;
      }
      const term = Math.min(...open.map((l) => l.dte));
      const net0 = open.reduce((s, l) => s + (l.action === "buy" ? 1 : -1) * (l.qty ?? 1) * l.premium, 0);
      const rules = RULES[credit ? "credit" : "debit"];
      const vk = name === "熊市 Call 价差" ? "bearCall" : name === "牛市 Put 价差" ? "bullPut" : null;
      const moves = vk ? [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2] : [-1.5, -0.75, 0, 0.75, 1.5];
      const times = vk ? [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] : [0.2, 0.45, 0.7];
      let seed = 1;
      for (const e of times) {
        for (const m of moves) {
          const day = Math.round(e * term);
          const S = S0 * Math.exp(m * IV * Math.sqrt(term / 365));
          const now = open.map((l) => ({ ...l, dte: l.dte - day, premium: price(l, S, l.dte - day) }));
          const netNow = now.reduce((s, l) => s + (l.action === "buy" ? 1 : -1) * (l.qty ?? 1) * l.premium, 0);
          const pnl = netNow - net0;
          const a = adviseCombo({ legs: now, spot: S, basis, credit, pnl, totalTerm: term, rules, vol: IV, n: 1500, seed: seed++ });
          if (!a) continue;
          const rs = reasons(a, S, credit);
          const row = {
            group: grp.group.zh, name, side: credit ? "卖方" : "买方", move: m, elapsed: e, day, spot: r2(S), pnl: r2(pnl), pnlPct: Math.round(a.signals.pnlPct * 100),
            action: ACTION_TEXT[a.action], rule: a.rule, ...rs,
          };
          if (!vk) rows.push(row);
          if (vk) {
            const ml = a.signals.maxLoss ?? -basis;
            const ta = tableAction(vk, open, S, e, pnl, basis, ml - 0);
            compare.push({ name, move: m, elapsed: e, spot: r2(S), pnl: r2(pnl), engine: ACTION_TEXT[a.action], table: ACTION_TEXT[ta.mapped as keyof typeof ACTION_TEXT], tableRaw: ta.act, cell: ta.cell, tableAdvice: ta.advice, same: ACTION_TEXT[a.action] === ACTION_TEXT[ta.mapped as keyof typeof ACTION_TEXT], why: rs.why });
          }
        }
      }
      // 密格的预设也补上常规3×5网格，方便跟其它预设一起看
      if (vk) {
        for (const e of [0.2, 0.45, 0.7]) {
          for (const m of [-1.5, -0.75, 0, 0.75, 1.5]) {
            const day = Math.round(e * term);
            const S = S0 * Math.exp(m * IV * Math.sqrt(term / 365));
            const now = open.map((l) => ({ ...l, dte: l.dte - day, premium: price(l, S, l.dte - day) }));
            const pnl = now.reduce((s, l) => s + (l.action === "buy" ? 1 : -1) * (l.qty ?? 1) * l.premium, 0) - net0;
            const a = adviseCombo({ legs: now, spot: S, basis, credit, pnl, totalTerm: term, rules, vol: IV, n: 1500, seed: seed++ })!;
            rows.push({ group: grp.group.zh, name, side: credit ? "卖方" : "买方", move: m, elapsed: e, day, spot: r2(S), pnl: r2(pnl), pnlPct: Math.round(a.signals.pnlPct * 100), action: ACTION_TEXT[a.action], rule: a.rule, ...reasons(a, S, credit) });
          }
        }
      }
    }
  }
  writeFileSync(OUT!, JSON.stringify({ rows, compare }, null, 1));
}, 600000);
