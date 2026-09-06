// src/lib/presets.ts
// src/lib/presets.ts
import type { Leg } from "@/lib/types";

let idc = 0;
const uid = () => `leg-${Date.now()}-${idc++}`;

function leg(over: Partial<Leg> = {}): Leg {
  return {
    id: uid(),
    action: "buy",
    type: "call",
    strike: 100,
    dte: 30,
    premium: 5,
    ...over,
  };
}

function stock(over: Partial<Leg> = {}): Leg {
  return leg({
    kind: "stock",
    type: "call",
    action: "buy",
    strike: 100,
    dte: 0,
    premium: 0,
    shares: 100,
    ...over,
  });
}

export type LocalStr = { zh: string; en: string };

// Risk-disclosure line severity — drives the tooltip's color tier:
// "danger" (red) = risk classification, always the size/shape of the
// worst case; "caution" (amber) = margin/capital requirements and
// early-assignment exposure; "info" (blue) = implied-vol / vega
// dynamics (IV crush, IV spikes, time decay interplay). Every preset
// carries at least the danger line; caution/info lines are included
// only where genuinely relevant to that specific structure — this is
// deliberately NOT a boilerplate template repeated on every preset.
export type RiskSeverity = "danger" | "caution" | "info";

export interface RiskLine {
  severity: RiskSeverity;
  text: LocalStr;
}

export interface PresetMeta {
  name: LocalStr;
  desc: LocalStr;
  market: LocalStr;
  stocks: LocalStr;
  direction: string;
  risk?: RiskLine[];
  legs: () => Leg[];
}

export interface PresetGroup {
  group: LocalStr;
  items: PresetMeta[];
}

export const PRESET_GROUPS: PresetGroup[] = [
  {
    group: { zh: "单腿基础", en: "Single Leg" },
    items: [
      {
        name: { zh: "裸买 Call", en: "Long Call" },
        desc: { zh: "买入call，权利金为最大亏损，上方盈利无限。", en: "Buy a call; premium is max loss, upside profit unlimited." },
        market: { zh: "强烈看涨行情，预期股价短期大幅上涨。", en: "Strongly bullish, expecting sharp short-term rally." },
        stocks: { zh: "高β成长股、财报前有明确催化剂的个股。", en: "High-beta growth stocks, stocks with clear catalysts pre-earnings." },
        direction: "看涨",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付权利金，到期归零即为最大亏损。", en: "Defined risk — max loss is capped at the premium paid, hit if the option expires worthless." } },
          { severity: "info", text: { zh: "临近到期时间价值衰减加快；若买入时IV偏高，事后IV回落可能侵蚀盈利，即使方向判断正确。", en: "Time decay accelerates near expiry; if IV was elevated at entry, a later IV drop can eat into gains even when you're right on direction." } },
        ],
        legs: () => [leg({ action: "buy", type: "call", strike: 100, premium: 5 })],
      },
      {
        name: { zh: "裸卖 Call", en: "Short Call" },
        desc: { zh: "卖出call，收取权利金，但上方亏损无限，需要保证金。", en: "Sell a call; collect premium but unlimited upside risk, requires margin." },
        market: { zh: "看跌或震荡行情，预期股价不会大幅上涨。", en: "Bearish or range-bound, expecting no significant upside." },
        stocks: { zh: "低波动率大盘蓝筹，或已持有正股的备兑策略。", en: "Low-vol blue chips, or covered call on held shares." },
        direction: "看跌/中性",
        risk: [
          { severity: "danger", text: { zh: "理论无限亏损——股价越涨越亏，没有上限。", en: "Theoretically unlimited loss — losses grow without bound as the stock keeps rising." } },
          { severity: "caution", text: { zh: "需要裸卖保证金，且随现价上涨保证金要求会持续增加。", en: "Requires naked-call margin, which increases as the stock price rises." } },
          { severity: "caution", text: { zh: "若临近除息日且已处于实值，可能被提前指派、被迫卖出正股（若本身未持仓则形成空头）。", en: "If in the money near an ex-dividend date, may be assigned early — forced to sell (or short) the stock." } },
          { severity: "info", text: { zh: "IV上升会推高回补成本，方向判断对了也可能先经历浮亏。", en: "Rising IV raises the cost to buy back the call, so you can be underwater even while right on direction." } },
        ],
        legs: () => [leg({ action: "sell", type: "call", strike: 100, premium: 5 })],
      },
      {
        name: { zh: "裸买 Put", en: "Long Put" },
        desc: { zh: "买入put，权利金为最大亏损，下方盈利至股价归零。", en: "Buy a put; premium is max loss, downside profit to zero." },
        market: { zh: "强烈看跌行情，预期股价短期大幅下跌。", en: "Strongly bearish, expecting sharp short-term drop." },
        stocks: { zh: "基本面恶化、技术形态破位的个股，或大盘对冲工具（SPY/QQQ）。", en: "Deteriorating fundamentals, broken technicals, or index hedges (SPY/QQQ)." },
        direction: "看跌",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付权利金。", en: "Defined risk — max loss is capped at the premium paid." } },
          { severity: "info", text: { zh: "同样受时间衰减和IV回落影响；事件驱动买入后若波动不及预期，权利金损耗较快。", en: "Also exposed to time decay and IV crush; if the move falls short after an event, premium erodes quickly." } },
        ],
        legs: () => [leg({ action: "buy", type: "put", strike: 100, premium: 5 })],
      },
      {
        name: { zh: "裸卖 Put", en: "Short Put" },
        desc: { zh: "卖出put，收取权利金；若到期价格低于行权价则被迫以行权价买入股票。", en: "Sell a put; if price < strike at expiry, assigned to buy shares." },
        market: { zh: "看涨或温和看涨行情，愿意以更低价格买入股票。", en: "Bullish or mildly bullish, willing to buy shares lower." },
        stocks: { zh: "业绩稳健、愿意持有的股票，常用于分批建仓。", en: "Solid stocks you want to own, often used for scaling in." },
        direction: "看涨",
        risk: [
          { severity: "danger", text: { zh: "下方风险很大但有底——最坏情况是股价跌到0，亏损=行权价×100×张数-已收权利金。", en: "Large but bounded downside — worst case is the stock hitting zero, for a loss of (strike × 100 × contracts) minus premium received." } },
          { severity: "caution", text: { zh: "需要现金担保或保证金；若跌破行权价到期，会被指派以行权价买入正股，确认自己愿意且有能力接盘。", en: "Requires cash-secured or margin backing; if the stock finishes below the strike, you'll be assigned and must buy shares at the strike." } },
          { severity: "caution", text: { zh: "提前指派通常和当前利率环境有关（对方想提前拿现金吃利息），跟除息日关系不大。", en: "Early assignment here is usually driven by prevailing interest rates (the buyer wants cash sooner), not by dividends." } },
          { severity: "info", text: { zh: "IV上升会推高账面浮亏，即使最终不被指派，过程中也可能经历较大波动。", en: "Rising IV can cause meaningful mark-to-market losses along the way, even if you're never actually assigned." } },
        ],
        legs: () => [leg({ action: "sell", type: "put", strike: 100, premium: 5 })],
      },
    ],
  },
  {
    group: { zh: "价差策略", en: "Spreads" },
    items: [
      {
        name: { zh: "牛市 Call 价差", en: "Bull Call Spread" },
        desc: { zh: "买低行权价 Call + 卖高行权价 Call，以降低成本换取有限盈利。", en: "Buy lower strike call + sell higher strike call; lower cost, capped profit." },
        market: { zh: "温和看涨，预期股价上涨但幅度有限。", en: "Mildly bullish, expecting limited upside." },
        stocks: { zh: "大盘指数、波动率偏高时想控制成本的个股。", en: "Index ETFs, high-vol stocks where cost control matters." },
        direction: "看涨",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付净权利金；最大盈利=价差宽度-净权利金。", en: "Defined risk — max loss is the net debit paid; max profit is the spread width minus that debit." } },
          { severity: "caution", text: { zh: "空头腿若临近到期深度实值，可能被提前指派，留意除息日。", en: "If the short leg finishes deep ITM near expiry, it may be assigned early — watch for ex-dividend dates." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "call", strike: 95, premium: 8 }),
          leg({ action: "sell", type: "call", strike: 105, premium: 2.5 }),
        ],
      },
      {
        name: { zh: "熊市 Call 价差", en: "Bear Call Spread" },
        desc: { zh: "卖低行权价 Call + 买高行权价 Call，看跌时收取信用差价。", en: "Sell lower strike call + buy higher strike call; credit spread when bearish." },
        market: { zh: "温和看跌，预期股价下跌或横盘。", en: "Mildly bearish, expecting decline or sideways." },
        stocks: { zh: "大盘指数ETF，或基本面走弱的个股。", en: "Index ETFs, or stocks with weakening fundamentals." },
        direction: "看跌",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=价差宽度-净收权利金。", en: "Defined risk — max loss is the spread width minus the net credit received." } },
          { severity: "caution", text: { zh: "需要相应保证金（≈价差宽度）；空头腿临近到期实值时可能被提前指派，留意除息日。", en: "Requires margin roughly equal to the spread width; the short leg may be assigned early if ITM near expiry — watch ex-dividend dates." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "call", strike: 100, premium: 5 }),
          leg({ action: "buy", type: "call", strike: 110, premium: 1.5 }),
        ],
      },
      {
        name: { zh: "牛市 Put 价差", en: "Bull Put Spread" },
        desc: { zh: "卖较高行权价 Put + 买较低行权价 Put，收取信用差价，看涨。", en: "Sell higher strike put + buy lower strike put; credit spread when bullish." },
        market: { zh: "温和看涨，预期股价不会大幅下跌。", en: "Mildly bullish, expecting no significant downside." },
        stocks: { zh: "支撑位明确的大盘指数或蓝筹股。", en: "Index or blue chips with clear support levels." },
        direction: "看涨",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=价差宽度-净收权利金。", en: "Defined risk — max loss is the spread width minus the net credit received." } },
          { severity: "caution", text: { zh: "需要相应保证金；空头Put若跌破行权价到期会被指派买入正股（多头Put可对冲，但需要主动行权处理）。", en: "Requires margin; if the short put finishes ITM you'll be assigned — the long put can offset it, but you may need to exercise it yourself." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "put", strike: 100, premium: 5 }),
          leg({ action: "buy", type: "put", strike: 90, premium: 1.5 }),
        ],
      },
      {
        name: { zh: "熊市 Put 价差", en: "Bear Put Spread" },
        desc: { zh: "买高行权价 Put + 卖低行权价 Put，看跌时以低成本获利。", en: "Buy higher strike put + sell lower strike put; debit spread when bearish." },
        market: { zh: "温和看跌，预期股价回调但不会暴跌。", en: "Mildly bearish, expecting pullback not a crash." },
        stocks: { zh: "阶段性高位个股，或大盘见顶信号出现时。", en: "Stocks at阶段性 highs, or when market top signals appear." },
        direction: "看跌",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付净权利金。", en: "Defined risk — max loss is the net debit paid." } },
          { severity: "caution", text: { zh: "空头Put临近到期实值可能被提前指派，通常和当前利率环境有关。", en: "The short put may be assigned early if ITM near expiry, typically driven by prevailing interest rates." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "put", strike: 105, premium: 8 }),
          leg({ action: "sell", type: "put", strike: 95, premium: 2.5 }),
        ],
      },
    ],
  },
  {
    group: { zh: "波动率策略", en: "Volatility" },
    items: [
      {
        name: { zh: "买入跨式", en: "Long Straddle" },
        desc: { zh: "同时买入相同行权价的 Call + Put，押注股价大幅波动，方向不限。", en: "Buy ATM call + put; bet on large move, direction-agnostic." },
        market: { zh: "财报、FDA审批、并购等重大事件前，预期大幅波动但方向不明。", en: "Pre-earnings, FDA, M&A; expecting large move but unsure direction." },
        stocks: { zh: "生物科技、高波动成长股、公告前的个股。", en: "Biotech, high-vol growth stocks, pre-announcement stocks." },
        direction: "双向波动",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付总权利金（两条腿都到期归零时）。", en: "Defined risk — max loss is the total premium paid, if both legs expire worthless." } },
          { severity: "info", text: { zh: "对IV极度敏感：事件公布后IV往往骤降（IV crush），即使方向判断对、波动也够大，权利金也可能不及预期上涨，甚至倒亏。", en: "Highly sensitive to IV: after the event, IV often collapses (IV crush) — even a big enough move in the right direction may not pay off as expected, or can still lose money." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "call", strike: 100, premium: 5 }),
          leg({ action: "buy", type: "put", strike: 100, premium: 5 }),
        ],
      },
      {
        name: { zh: "卖出跨式", en: "Short Straddle" },
        desc: { zh: "同时卖出相同行权价的 Call + Put，押注股价横盘，收取双倍权利金。", en: "Sell ATM call + put; bet on sideways, collect double premium." },
        market: { zh: "低波动率期间，股价长期在区间内震荡。", en: "Low-vol periods, stock range-bound for extended time." },
        stocks: { zh: "大盘指数（VIX高位时卖出）、股息型蓝筹股。", en: "Index (sell when VIX is high), dividend blue chips." },
        direction: "中性/震荡",
        risk: [
          { severity: "danger", text: { zh: "两侧都是裸卖：上方（Call侧）理论无限亏损；下方（Put侧）跌到0为止，亏损很大但有底。不管往哪个方向大幅移动都会严重亏损。", en: "Both legs are naked short: the call side has theoretically unlimited loss on the upside; the put side is floored at zero — large but bounded. A big move in either direction still hurts badly." } },
          { severity: "caution", text: { zh: "需要较高保证金（按两条腿孰高计算，不是简单相加）；两条腿都有临近实值时的提前指派风险。", en: "Requires substantial margin (calculated on the greater side, not simply added together); both legs carry early-assignment risk if they move ITM." } },
          { severity: "info", text: { zh: "赚的是IV下降和时间衰减的钱；若遇到意外事件IV不跌反涨，浮亏可能非常快。", en: "Profits from IV decay and time decay; an unexpected event that spikes IV instead of crushing it can produce losses very quickly." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "call", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "put", strike: 100, premium: 5 }),
        ],
      },
      {
        name: { zh: "买入宽跨式", en: "Long Strangle" },
        desc: { zh: "买入 OTM Call + OTM Put，成本更低，需要更大的股价波动才能盈利。", en: "Buy OTM call + put; cheaper, needs larger move to profit." },
        market: { zh: "事件前期，预期爆发式波动，容忍较高盈亏平衡点。", en: "Pre-event, expecting explosive move, tolerating wider breakevens." },
        stocks: { zh: "生物科技、能源股（OPEC决议前）、选举行情。", en: "Biotech, energy (pre-OPEC), election-driven plays." },
        direction: "双向波动",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付总权利金。", en: "Defined risk — max loss is the total premium paid." } },
          { severity: "info", text: { zh: "比跨式便宜但需要更大波动才能盈利；同样面临事件后IV crush的风险。", en: "Cheaper than a straddle but needs a bigger move to profit; also exposed to post-event IV crush." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "call", strike: 108, premium: 2.5 }),
          leg({ action: "buy", type: "put", strike: 92, premium: 2.5 }),
        ],
      },
      {
        name: { zh: "卖出宽跨式", en: "Short Strangle" },
        desc: { zh: "卖出 OTM Call + OTM Put，区间更宽，胜率更高，但上方（Call侧）仍有无限亏损风险。", en: "Sell OTM call + put; wider range, higher win rate, but the call side still carries unlimited upside risk." },
        market: { zh: "低波动率震荡市，预期股价在较宽区间内横盘。", en: "Low-vol sideways market, expecting wide range-bound action." },
        stocks: { zh: "SPY/QQQ 等流动性高的指数ETF，波动率高位时操作。", en: "Liquid index ETFs (SPY/QQQ), when IV is elevated." },
        direction: "中性/震荡",
        risk: [
          { severity: "danger", text: { zh: "两侧都是裸卖：上方（Call侧）理论无限亏损；下方（Put侧）跌到0为止，亏损很大但有底，只是行权价比跨式更宽，需要更大波动才会触及。", en: "Both legs are naked short: the call side has theoretically unlimited loss on the upside; the put side is floored at zero — large but bounded, though the wider strikes here mean it takes a bigger move to get there than a short straddle." } },
          { severity: "caution", text: { zh: "需要较高保证金；任意一侧临近实值都有提前指派风险。", en: "Requires substantial margin; either side carries early-assignment risk if it moves ITM." } },
          { severity: "info", text: { zh: "同样赚IV下降的钱，IV意外走高时两侧都会承压。", en: "Also profits from falling IV; an unexpected IV spike pressures both sides at once." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "call", strike: 108, premium: 2.5 }),
          leg({ action: "sell", type: "put", strike: 92, premium: 2.5 }),
        ],
      },
    ],
  },
  {
    group: { zh: "蝶式 / 鹰式", en: "Butterfly / Condor" },
    items: [
      {
        name: { zh: "铁蝶策略", en: "Iron Butterfly" },
        desc: { zh: "卖出 ATM Call + Put，同时买入更远 OTM Call + Put 作为保护，收取净信用，最大盈利在中间区。", en: "Sell ATM straddle + buy OTM straddle for protection; net credit, max profit at center." },
        market: { zh: "极度震荡预期，认为股价不会在短期内大幅偏离当前价格。", en: "Expecting minimal movement away from current price." },
        stocks: { zh: "大盘指数ETF，财报后趋于稳定的个股。", en: "Index ETFs, stocks stabilizing post-earnings." },
        direction: "中性",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=两翼宽度-净收权利金，在两翼之外的极端行情下发生。", en: "Defined risk — max loss is the wing width minus the net credit, occurring if the stock moves beyond either wing." } },
          { severity: "caution", text: { zh: "四条腿的组合，冷门行权价上的买卖价差可能侵蚀实际到手的权利金；卖出的两条ATM腿有提前指派风险。", en: "A 4-leg trade — wide bid-ask spreads on illiquid strikes can eat into the actual credit received; the two short ATM legs carry early-assignment risk." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "put", strike: 90, premium: 0.5 }),
          leg({ action: "sell", type: "put", strike: 100, premium: 4 }),
          leg({ action: "sell", type: "call", strike: 100, premium: 4 }),
          leg({ action: "buy", type: "call", strike: 110, premium: 0.5 }),
        ],
      },
      {
        // Distinct from both 窄体铁鹰 (whose SOLD legs sit at two different
        // strikes, not a true ATM straddle) and 破翅蝶式 (a single-type,
        // 3-strike call-only structure) — this is the specific shape a
        // real iron butterfly takes when its two protection wings can't
        // be symmetric: both short legs still share ONE strike (a true
        // ATM straddle sold), but the two long protection legs sit at
        // different distances from it. This is exactly what the earnings
        // IV-crash strategy's mid/far groups look like once real listed
        // strikes replace the illustrative ±% targets (their sold legs
        // are always the same ATM strike; their two wings only come out
        // symmetric by coincidence) — caught because matchStrategy had no
        // preset to match that real shape against and so labeled several
        // real earnings positions as unrecognized instead of correctly
        // calling them out as asymmetric.
        name: { zh: "不对称铁蝶", en: "Asymmetric Iron Butterfly" },
        desc: { zh: "卖出同一个行权价的 ATM Call+Put，两侧保护翼宽度不对称，跟铁蝶同源但两翼不等距。", en: "Sell ATM call+put at the SAME strike; the two protective wings sit at different distances — same family as Iron Butterfly, just uneven wings." },
        market: { zh: "中性，但对某一侧的极端走势稍微多一点容忍度。", en: "Neutral, with slightly more tolerance for a move on one side than the other." },
        stocks: { zh: "大盘指数ETF、财报后趋于稳定但两侧风险不对等的个股。", en: "Index ETFs, stocks stabilizing post-earnings with uneven tail risk on each side." },
        direction: "中性",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损取决于两翼中较窄的一侧宽度减去净收权利金（两翼不对称，两侧风险也不对称）。", en: "Defined risk — max loss is driven by whichever wing is narrower, minus the net credit (uneven wings mean uneven risk on each side)." } },
          { severity: "caution", text: { zh: "四条腿组合，两条卖出ATM腿有提前指派风险；常见于财报策略用真实行权价搭出来、两翼天然不对称的近似铁蝶。", en: "A 4-leg trade — the two short ATM legs carry early-assignment risk; this shape often shows up when an earnings-strategy position lands on real listed strikes that aren't perfectly symmetric." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "put", strike: 88, premium: 0.4 }),
          leg({ action: "sell", type: "put", strike: 100, premium: 4 }),
          leg({ action: "sell", type: "call", strike: 100, premium: 4 }),
          leg({ action: "buy", type: "call", strike: 107, premium: 0.8 }),
        ],
      },
      {
        name: { zh: "买入铁蝶", en: "Long Iron Butterfly" },
        desc: { zh: "买入 ATM Call + Put，同时卖出更远 OTM Call + Put 融资，为大幅波动支付权利金，是铁蝶策略的相反方向。", en: "Buy ATM straddle + sell OTM straddle to offset cost; pay for large move, opposite of iron butterfly." },
        market: { zh: "预期事件驱动大幅波动，但不确定方向。", en: "Event-driven, expecting large move but unsure direction." },
        stocks: { zh: "财报前、FDA审批前的个股，或宏观数据发布前的指数。", en: "Pre-earnings or pre-FDA stocks, or indices before macro data releases." },
        direction: "双向波动",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付净权利金，发生在到期正好落在中间行权价时。", en: "Defined risk — max loss is the net debit paid, occurring if the stock lands exactly at the center strike at expiry." } },
          { severity: "caution", text: { zh: "ATM买入+远OTM卖出的四腿组合，行权价越冷门滑点风险越大，实际成交成本可能明显偏离理论价。", en: "A 4-leg ATM-long/far-OTM-short combo — the less liquid the strikes, the more slippage can push your real fill away from the theoretical price." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "put", strike: 90, premium: 0.5 }),
          leg({ action: "buy", type: "put", strike: 100, premium: 4 }),
          leg({ action: "buy", type: "call", strike: 100, premium: 4 }),
          leg({ action: "sell", type: "call", strike: 110, premium: 0.5 }),
        ],
      },
      {
        name: { zh: "铁鹰策略", en: "Iron Condor" },
        desc: { zh: "卖出 OTM Put/Call 价差，收取净信用差价，股价横盘在中间区间时全部获利。", en: "Sell OTM put + call spreads; profit if stock stays in the middle range." },
        market: { zh: "低波动率震荡市，股价在一定区间内运行。", en: "Low-vol sideways market, stock trading in a range." },
        stocks: { zh: "大盘指数（SPY/QQQ），VIX 相对高位时卖波动率的首选。", en: "Index (SPY/QQQ), top pick for selling vol when VIX is elevated." },
        direction: "中性/震荡",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=价差宽度-净收权利金，股价突破任一侧区间时发生。", en: "Defined risk — max loss is the spread width minus the net credit, if price breaks out of either side of the range." } },
          { severity: "caution", text: { zh: "四条腿组合，两条卖出腿都有提前指派风险；实际到手权利金会被买卖价差和手续费小幅侵蚀。", en: "A 4-leg trade — both short legs carry early-assignment risk; the actual credit received is trimmed a bit by bid-ask spread and commissions." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "put", strike: 85, premium: 0.6 }),
          leg({ action: "sell", type: "put", strike: 90, premium: 1.5 }),
          leg({ action: "sell", type: "call", strike: 110, premium: 1.5 }),
          leg({ action: "buy", type: "call", strike: 115, premium: 0.6 }),
        ],
      },
      {
        name: { zh: "反向铁鹰", en: "Reverse Iron Condor" },
        desc: { zh: "买入 OTM Put/Call 价差，为大幅波动支付权利金，是铁鹰策略的相反方向。", en: "Buy OTM put + call spreads; pay for large move, opposite of iron condor." },
        market: { zh: "预期事件驱动大幅波动，但不确定方向。", en: "Event-driven, expecting large move but unsure direction." },
        stocks: { zh: "生物科技、财报季、宏观数据发布前的指数。", en: "Biotech, earnings season, pre-macro data indices." },
        direction: "双向波动",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付净权利金，发生在股价停留在两条卖出腿之间的区间内。", en: "Defined risk — max loss is the net debit paid, occurring if the stock stays inside the range between the two short strikes." } },
          { severity: "caution", text: { zh: "买方策略，需要方向明确的大幅波动才能盈利；四腿组合的滑点/流动性成本同样存在。", en: "A long-premium trade that needs a sizeable move to pay off; the same slippage/liquidity drag from a 4-leg structure applies." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "put", strike: 85, premium: 0.6 }),
          leg({ action: "buy", type: "put", strike: 90, premium: 1.5 }),
          leg({ action: "buy", type: "call", strike: 110, premium: 1.5 }),
          leg({ action: "sell", type: "call", strike: 115, premium: 0.6 }),
        ],
      },
      {
        name: { zh: "买入蝶式", en: "Long Butterfly" },
        desc: { zh: "买入一个低行权价 Call，卖出两个中间行权价 Call，再买入一个高行权价 Call，最大盈利在中间行权价。", en: "Buy 1 lower call, sell 2 middle calls, buy 1 higher call; max profit at middle strike." },
        market: { zh: "预期股价温和上涨至某一具体价格，之后停滞。", en: "Expecting stock to drift up to a target then stall." },
        stocks: { zh: "趋势明确但缺乏动力的个股，或大盘接近阻力位时。", en: "Stocks with trend but no momentum, or index near resistance." },
        direction: "温和看涨",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付净权利金，发生在股价远离中间行权价（两端）时。", en: "Defined risk — max loss is the net debit paid, occurring if price ends up far from the center strike (at either extreme)." } },
          { severity: "caution", text: { zh: "中间行权价的卖出腿数量是外侧的2倍，流动性和滑点会直接影响实际成本；正常应付出一个不大但为正的净成本，若算出来接近0甚至为负要留意报价是否合理。", en: "The two short legs at the center strike are double the outer legs' size — liquidity and slippage directly affect your real cost. This should normally cost a small positive net debit; if it prices near zero or negative, double-check the quotes." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "call", strike: 95, premium: 7 }),
          leg({ action: "sell", type: "call", strike: 100, premium: 4.7 }),
          leg({ action: "sell", type: "call", strike: 100, premium: 4.7 }),
          leg({ action: "buy", type: "call", strike: 105, premium: 3 }),
        ],
      },
    ],
  },
  {
    group: { zh: "时间价差", en: "Calendar Spreads" },
    items: [
      {
        name: { zh: "日历价差", en: "Calendar Spread" },
        desc: { zh: "卖出近月 ATM Call，买入远月同行权价 Call，赚取时间价值的衰减差异。", en: "Sell near-term ATM call, buy far-term same-strike call; profit from time decay differential." },
        market: { zh: "低波动率横盘行情，预期股价短期不动、远期缓涨。", en: "Low-vol sideways, expecting near-term stability, slow drift later." },
        stocks: { zh: "波动率处于低位的大盘蓝筹，或事件后趋于平稳的个股。", en: "Low-vol blue chips, or stocks calming down post-event." },
        direction: "中性/温和看涨",
        risk: [
          { severity: "danger", text: { zh: "风险有限（最大亏损=已付净权利金），但不是\"越久越安全\"——若股价大幅偏离行权价，近月腿提前失去价值，远月腿也可能因方向不利而亏损。", en: "Defined risk (max loss is the net debit paid), but not automatically \"safe over time\" — if price moves far from the strike, the near-term leg loses relevance and the far-term leg can lose value too if direction goes against you." } },
          { severity: "caution", text: { zh: "近月空头腿到期前需要主动处理（平仓或展期），临近到期若变成实值也有提前指派风险。", en: "The near-term short leg needs active management before its own expiry (close or roll); if it moves ITM, it carries early-assignment risk too." } },
          { severity: "info", text: { zh: "本质是做多Vega（尤其是远月）——近月IV下降对你有利，但如果远月IV也一起大幅下降，多头这条腿会承压。", en: "Net long vega, mainly on the far-dated leg — a drop in near-term IV helps you, but if far-term IV drops sharply too, the long leg suffers." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "call", strike: 100, dte: 14, premium: 2.5 }),
          leg({ action: "buy", type: "call", strike: 100, dte: 45, premium: 5 }),
        ],
      },
      {
        name: { zh: "对角价差", en: "Diagonal Spread" },
        desc: { zh: "卖出近月 OTM Call，买入远月更低行权价 Call，兼顾方向性与时间价值衰减。", en: "Sell near-term OTM call, buy far-term lower-strike call; directional + time decay." },
        market: { zh: "温和看涨，预期股价缓慢上涨。", en: "Mildly bullish, expecting slow uptrend." },
        stocks: { zh: "趋势股、大盘指数的进阶备兑策略。", en: "Trending stocks, advanced covered call on index." },
        direction: "温和看涨",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付净权利金。", en: "Defined risk — max loss is the net debit paid." } },
          { severity: "caution", text: { zh: "近月空头腿到期前需要主动处理，临近到期实值有提前指派风险。", en: "The near-term short leg needs active management before its own expiry, and carries early-assignment risk if it's ITM near then." } },
          { severity: "info", text: { zh: "远月越深度实值、近月越浅虚值，越接近\"用较少资金模拟备兑\"的效果（PMCC思路）；本例远月并非深度实值，只是示意结构。", en: "The deeper ITM the far leg and the more OTM the near leg, the closer this gets to a capital-efficient stand-in for a covered call (the PMCC idea); this example's far leg isn't deep ITM — it's just illustrating the shape." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "call", strike: 105, dte: 14, premium: 1.5 }),
          leg({ action: "buy", type: "call", strike: 95, dte: 45, premium: 7 }),
        ],
      },
    ],
  },
  {
    group: { zh: "比率策略", en: "Ratio Spreads" },
    items: [
      {
        name: { zh: "比率 Call 价差", en: "Call Ratio Spread" },
        desc: { zh: "买入一个 Call，卖出两个更高行权价 Call，净低成本甚至收取权利金；一旦涨破卖出行权价，亏损随涨幅线性扩大且理论无限，需设好止损或了结计划。", en: "Buy 1 call, sell 2 higher calls; low cost or net credit, but once price breaks above the short strike, loss grows without limit as price keeps rising — plan an exit." },
        market: { zh: "温和看涨，预期股价小幅上涨，不会大幅突破。", en: "Mildly bullish, expecting small gain, no breakout." },
        stocks: { zh: "波动率较高时，中型成长股或LEAPS策略。", en: "Mid-cap growth when vol is high, or LEAPS strategies." },
        direction: "温和看涨",
        risk: [
          { severity: "danger", text: { zh: "一旦涨破卖出行权价继续上涨，亏损随涨幅线性扩大，理论上没有上限。", en: "Once price breaks above the short strike and keeps climbing, loss grows linearly without a cap." } },
          { severity: "caution", text: { zh: "净卖出1张未被覆盖的Call，需要相应保证金；该腿临近实值时有提前指派风险。", en: "You're net short one uncovered call — it requires margin and carries early-assignment risk if it moves ITM." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "call", strike: 98, premium: 6 }),
          leg({ action: "sell", type: "call", strike: 105, premium: 2.5 }),
          leg({ action: "sell", type: "call", strike: 105, premium: 2.5 }),
        ],
      },
      {
        name: { zh: "比率 Put 价差", en: "Put Ratio Spread" },
        desc: { zh: "买入一个 Put，卖出两个更低行权价 Put，低成本做空；一旦跌破卖出行权价，亏损随跌幅线性扩大（跌到0为止，金额可能很大），需设好止损或了结计划。", en: "Buy 1 put, sell 2 lower puts; cheap bearish exposure, but once price breaks below the short strike, loss grows as price keeps falling (bounded only by zero, but can be large) — plan an exit." },
        market: { zh: "温和看跌，预期股价小幅下跌，不会崩盘式下跌。", en: "Mildly bearish, expecting small drop, no crash." },
        stocks: { zh: "阶段性高位个股，或大盘回调但不深跌时。", en: "Stocks at阶段性 highs, or mild market pullback." },
        direction: "温和看跌",
        risk: [
          { severity: "danger", text: { zh: "一旦跌破卖出行权价继续下跌，亏损随跌幅扩大（跌到0为止，但金额可能很大）。", en: "Once price breaks below the short strike and keeps falling, loss grows as price drops (bounded only by zero, but can be large)." } },
          { severity: "caution", text: { zh: "净卖出1张未被覆盖的Put，需要现金担保或保证金；该腿临近实值时有提前指派风险。", en: "You're net short one uncovered put — it requires cash-secured or margin backing and carries early-assignment risk if it moves ITM." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "put", strike: 102, premium: 6 }),
          leg({ action: "sell", type: "put", strike: 95, premium: 2.5 }),
          leg({ action: "sell", type: "put", strike: 95, premium: 2.5 }),
        ],
      },
      {
        name: { zh: "反向比率 Call 价差", en: "Call Backspread" },
        desc: { zh: "卖出一个 Call，买入两个更高行权价 Call，通常净收权利金；最大亏损不在两端，而是出现在多头行权价附近——大涨或横盘不涨反而更安全，温和涨到多头行权价才是最危险的区间。", en: "Sell 1 call, buy 2 higher calls, usually for a net credit; the worst case isn't at either extreme — it's a moderate rally that stalls right at the long strike, while a big move or no move at all is safer." },
        market: { zh: "看涨但预期可能爆发式上涨。", en: "Bullish but expecting potential explosive rally." },
        stocks: { zh: "财报季成长股、催化剂驱动的个股。", en: "Earnings-season growth stocks, catalyst-driven stocks." },
        direction: "看涨",
        risk: [
          { severity: "danger", text: { zh: "最大亏损不在两端，而是出现在多头行权价附近——这里是唯一有实质亏损风险的区间，两端反而安全或盈利。", en: "Max loss isn't at either extreme — it happens near the long strike, the only zone with real risk; big moves either way are actually safe or profitable." } },
          { severity: "caution", text: { zh: "空头腿临近实值有提前指派风险；通常净收信用，若被提前指派需要额外处理裸露的空头部位。", en: "The short leg carries early-assignment risk; usually a net credit trade, but early assignment leaves you with a short position to manage." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "call", strike: 100, premium: 5 }),
          leg({ action: "buy", type: "call", strike: 108, premium: 2 }),
          leg({ action: "buy", type: "call", strike: 108, premium: 2 }),
        ],
      },
      {
        name: { zh: "反向比率 Put 价差", en: "Put Backspread" },
        desc: { zh: "卖出一个 Put，买入两个更低行权价 Put，通常净收权利金；最大亏损不在两端，而是出现在多头行权价附近——大跌或横盘不跌反而更安全，温和跌到多头行权价才是最危险的区间。", en: "Sell 1 put, buy 2 lower puts, usually for a net credit; the worst case isn't at either extreme — it's a moderate decline that stalls right at the long strike, while a big move or no move at all is safer." },
        market: { zh: "看跌但预期可能爆发式下跌。", en: "Bearish but expecting potential sharp sell-off." },
        stocks: { zh: "财报季高估值成长股、利空催化剂前的个股。", en: "Overvalued growth stocks pre-earnings, stocks facing bearish catalysts." },
        direction: "看跌",
        risk: [
          { severity: "danger", text: { zh: "最大亏损不在两端，而是出现在多头行权价附近——这里是唯一有实质亏损风险的区间，两端反而安全或盈利。", en: "Max loss isn't at either extreme — it happens near the long strike, the only zone with real risk; big moves either way are actually safe or profitable." } },
          { severity: "caution", text: { zh: "空头腿临近实值有提前指派风险；通常净收信用，若被提前指派需要额外处理裸露的空头部位。", en: "The short leg carries early-assignment risk; usually a net credit trade, but early assignment leaves you with a short position to manage." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "put", strike: 100, premium: 5 }),
          leg({ action: "buy", type: "put", strike: 92, premium: 2 }),
          leg({ action: "buy", type: "put", strike: 92, premium: 2 }),
        ],
      },
      {
        name: { zh: "圣诞树 Call", en: "Christmas Tree Call" },
        desc: { zh: "买入一个 ATM Call，跳过一行权价卖出两个，再买入一个更高行权价 Call，1:2:1 结构。", en: "Buy 1 ATM call, skip a strike sell 2, buy 1 higher call; 1:2:1 structure." },
        market: { zh: "温和看涨，预期股价小幅上涨至某一目标价。", en: "Mildly bullish, expecting small move to a target price." },
        stocks: { zh: "趋势股、大盘指数接近目标位时。", en: "Trending stocks, index near a target level." },
        direction: "温和看涨",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付净权利金。", en: "Defined risk — max loss is the net debit paid." } },
          { severity: "caution", text: { zh: "中间行权价的卖出腿数量是外侧的2倍，行权价越不常用滑点越大；该腿临近实值有提前指派风险。", en: "The short legs at the middle strike are double the outer legs' size — less common strikes mean more slippage; this leg carries early-assignment risk if ITM." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "call", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "call", strike: 110, premium: 1.2 }),
          leg({ action: "sell", type: "call", strike: 110, premium: 1.2 }),
          leg({ action: "buy", type: "call", strike: 115, premium: 0.5 }),
        ],
      },
      {
        name: { zh: "圣诞树 Put", en: "Christmas Tree Put" },
        desc: { zh: "买入一个 ATM Put，跳过一行权价卖出两个，再买入一个更低行权价 Put，1:2:1 结构。", en: "Buy 1 ATM put, skip a strike sell 2, buy 1 lower put; 1:2:1 structure." },
        market: { zh: "温和看跌，预期股价小幅下跌至某一目标价。", en: "Mildly bearish, expecting small drop to a target price." },
        stocks: { zh: "高位回调股、大盘见顶时。", en: "Pullback candidates, or when market is topping." },
        direction: "温和看跌",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付净权利金。", en: "Defined risk — max loss is the net debit paid." } },
          { severity: "caution", text: { zh: "中间行权价的卖出腿数量是外侧的2倍，行权价越不常用滑点越大；该腿临近实值有提前指派风险。", en: "The short legs at the middle strike are double the outer legs' size — less common strikes mean more slippage; this leg carries early-assignment risk if ITM." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "put", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "put", strike: 90, premium: 1.2 }),
          leg({ action: "sell", type: "put", strike: 90, premium: 1.2 }),
          leg({ action: "buy", type: "put", strike: 85, premium: 0.5 }),
        ],
      },
    ],
  },
  {
    group: { zh: "保护与对冲", en: "Protection & Hedging" },
    items: [
      {
        name: { zh: "领口策略", en: "Collar" },
        desc: { zh: "需持有 100 股正股，买入 OTM Put 保护下行 + 卖出 OTM Call 融资，锁定风险与收益区间。", en: "Hold 100 shares + buy OTM put + sell OTM call; lock risk/reward range." },
        market: { zh: "持有正股，希望对冲下行风险同时愿意限制上行收益。", en: "Holding shares, want downside hedge while capping upside." },
        stocks: { zh: "长期持有的蓝筹股、大盘ETF。", en: "Long-term blue chips, index ETFs." },
        direction: "中性/温和看涨",
        risk: [
          { severity: "danger", text: { zh: "期权部分风险有限，盈亏被两条腿锁定在一个区间内，但前提是你已经持有正股——正股本身仍是最大的资金占用。", en: "The options side is capped into a defined range — but this assumes you already own the shares; the stock position itself is still your main capital exposure." } },
          { severity: "caution", text: { zh: "若股价涨破卖出的Call行权价，正股可能被指派卖出（\"叫走\"），错过后续更大涨幅；除息日附近尤其容易被提前指派。", en: "If price rises above the short call's strike, your shares can be called away — missing further upside; assignment risk rises near ex-dividend dates." } },
        ],
        legs: () => [
          stock(),
          leg({ action: "buy", type: "put", strike: 95, premium: 1.5 }),
          leg({ action: "sell", type: "call", strike: 110, premium: 1.5 }),
        ],
      },
      {
        name: { zh: "备兑 call", en: "Covered Call" },
        desc: { zh: "需持有 100 股正股，同时卖出 OTM Call 收取权利金，降低持仓成本并锁定卖出价格。", en: "Hold 100 shares + sell OTM call; collect premium, lower cost basis." },
        market: { zh: "温和看涨或横盘，持有正股想增加收益。", en: "Mildly bullish or sideways; enhance returns on held shares." },
        stocks: { zh: "长期持有的蓝筹股、高股息股。", en: "Long-term blue chips, high-dividend stocks." },
        direction: "中性/温和看涨",
        risk: [
          { severity: "danger", text: { zh: "常被误认为\"安全\"，但本策略并不对冲正股下跌的风险——权利金只是给下跌提供一点点缓冲，正股该跌多少还是跌多少。", en: "Often assumed to be \"safe,\" but this does NOT hedge the stock's downside — the premium only cushions the decline slightly; the stock can still fall as far as it wants." } },
          { severity: "caution", text: { zh: "股价涨破行权价时正股可能被指派卖出，锁定收益的同时也放弃了后续涨幅；除息日附近提前指派风险更高。", en: "If price rises above the strike, shares may be called away — you lock in the gain but give up further upside; assignment risk is higher near ex-dividend dates." } },
        ],
        legs: () => [
          stock(),
          leg({ action: "sell", type: "call", strike: 105, premium: 2.5 }),
        ],
      },
      {
        name: { zh: "保护性 Put", en: "Protective Put" },
        desc: { zh: "需持有 100 股正股，同时买入 Put 为下行提供保险，成本为权利金。", en: "Hold 100 shares + buy put as downside insurance; cost is the premium." },
        market: { zh: "担心持仓大幅下跌但不想卖出正股。", en: "Worried about a big drop but don't want to sell shares." },
        stocks: { zh: "重仓个股、财报前持仓保护。", en: "Large positions, pre-earnings protection." },
        direction: "看涨/对冲",
        risk: [
          { severity: "danger", text: { zh: "风险有限，下方最大亏损=正股成本-Put行权价+已付权利金；相当于为持仓买保险。", en: "Defined downside — max loss is your stock cost basis minus the put's strike, plus the premium paid; effectively insurance on the position." } },
          { severity: "info", text: { zh: "保险是有成本的：如果股价不跌，权利金会随时间衰减，等于白付一笔保费。", en: "Insurance has a cost: if the stock doesn't fall, the premium simply decays away — a cost you pay whether or not you need it." } },
        ],
        legs: () => [
          stock(),
          leg({ action: "buy", type: "put", strike: 95, premium: 1.5 }),
        ],
      },
      {
        name: { zh: "备兑 Put", en: "Covered Put" },
        desc: { zh: "需持有 100 股空头正股，同时卖出 OTM Put 收取权利金，是备兑 Call 在空头仓位上的镜像。", en: "Hold a 100-share short position + sell OTM put; collect premium, the short-side mirror of Covered Call." },
        market: { zh: "温和看跌或横盘，持有空头仓位想增加收益。", en: "Mildly bearish or sideways; enhance returns on a short position." },
        stocks: { zh: "基本面走弱但下跌动能有限的个股、大盘指数。", en: "Weakening stocks with limited downside momentum, index ETFs." },
        direction: "中性/温和看跌",
        risk: [
          { severity: "danger", text: { zh: "本策略不对冲空头正股的上行风险——若股价大幅反弹，空头正股的亏损理论上无限，卖出的Put只是收一点权利金垫背，起不到实质保护作用。", en: "This does NOT hedge the short stock's upside risk — if the stock rallies hard, the short position's loss is theoretically unlimited; the short put only adds a small premium cushion, not real protection." } },
          { severity: "caution", text: { zh: "需要维持空头正股仓位（融券及相应保证金）；若股价跌到Put行权价以下，可能被指派买入正股用于平掉空头。", en: "Requires maintaining a short stock position (with borrow and margin); if price falls below the put's strike, assignment forces you to buy shares, which closes out the short." } },
        ],
        legs: () => [
          stock({ action: "sell" }),
          leg({ action: "sell", type: "put", strike: 95, premium: 2.5 }),
        ],
      },
      {
        name: { zh: "保护性 Call", en: "Protective Call" },
        desc: { zh: "需持有 100 股空头正股，同时买入 Call 为上行提供保险，是保护性 Put 在空头仓位上的镜像。", en: "Hold a 100-share short position + buy call as upside insurance; the short-side mirror of Protective Put." },
        market: { zh: "看跌持仓，但担心股价意外反弹，不想被迫回补。", en: "Bearish position, but worried about a sudden squeeze forcing a buy-in." },
        stocks: { zh: "重仓空头个股、财报前空头持仓保护。", en: "Large short positions, pre-earnings protection on shorts." },
        direction: "看跌/对冲",
        risk: [
          { severity: "danger", text: { zh: "风险有限，上方最大亏损=Call行权价-正股做空价+已付权利金；真正为空头仓位的上行风险提供保护（跟\"备兑Put\"不同，后者并不提供同等保护）。", en: "Defined upside risk — max loss is the call's strike minus your short entry price, plus the premium paid; this genuinely hedges the short position's upside (unlike Covered Put, which does not offer equivalent protection)." } },
          { severity: "info", text: { zh: "同样是买保险的成本：股价不涨的话，权利金会衰减掉。", en: "Also has an insurance cost: if the stock doesn't rally, the premium simply decays away." } },
        ],
        legs: () => [
          stock({ action: "sell" }),
          leg({ action: "buy", type: "call", strike: 105, premium: 1.5 }),
        ],
      },
    ],
  },
  {
    group: { zh: "进阶组合", en: "Advanced" },
    items: [
      {
        name: { zh: "海鸥策略", en: "Seagull" },
        desc: { zh: "买入 ATM Call + 卖出 OTM Call + 卖出 OTM Put，零成本看涨，但下行有风险。", en: "Buy ATM call + sell OTM call + sell OTM put; zero-cost bullish, downside risk." },
        market: { zh: "看涨但不愿支付权利金，接受下行风险换取零成本上行。", en: "Bullish but unwilling to pay premium; accept downside risk for zero-cost upside." },
        stocks: { zh: "看好但想零成本做多的个股或指数。", en: "Bullish on a stock/index but want zero-cost exposure." },
        direction: "看涨",
        risk: [
          { severity: "danger", text: { zh: "零成本换来的是下方裸卖Put的风险——大跌时跟裸卖Put一样，理论上跌到0为止都可能亏损。", en: "The zero-cost structure comes from a naked short put on the downside — a big drop hurts just like a naked short put, potentially all the way to zero." } },
          { severity: "caution", text: { zh: "Put侧需要现金担保或保证金；三条腿都有各自的提前指派风险（Put侧参考裸卖Put逻辑）。", en: "The put side needs cash-secured or margin backing; all three legs carry their own early-assignment risk (the put side behaves like a naked short put)." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "call", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "call", strike: 110, premium: 1.5 }),
          leg({ action: "sell", type: "put", strike: 90, premium: 3.5 }),
        ],
      },
      {
        name: { zh: "反向海鸥", en: "Reverse Seagull" },
        desc: { zh: "买入 ATM Put + 卖出 OTM Put + 卖出 OTM Call，零成本看跌，但上行有风险。", en: "Buy ATM put + sell OTM put + sell OTM call; zero-cost bearish, upside risk." },
        market: { zh: "看跌但不愿支付权利金，接受上行风险换取零成本下行。", en: "Bearish but unwilling to pay premium; accept upside risk for zero-cost downside." },
        stocks: { zh: "看空但想零成本做空的个股或指数。", en: "Bearish on a stock/index but want zero-cost short exposure." },
        direction: "看跌",
        risk: [
          { severity: "danger", text: { zh: "零成本换来的是上方裸卖Call的风险——大涨时跟裸卖Call一样，理论上无限亏损。", en: "The zero-cost structure comes from a naked short call on the upside — a big rally hurts just like a naked short call, theoretically without limit." } },
          { severity: "caution", text: { zh: "Call侧需要裸卖保证金；三条腿都有各自的提前指派风险（Call侧参考裸卖Call逻辑，留意除息日）。", en: "The call side needs naked-call margin; all three legs carry their own early-assignment risk (the call side behaves like a naked short call — watch ex-dividend dates)." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "put", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "put", strike: 90, premium: 1.5 }),
          leg({ action: "sell", type: "call", strike: 110, premium: 3.5 }),
        ],
      },
      {
        name: { zh: "窄体铁鹰", en: "Narrow-Body Iron Condor" },
        desc: { zh: "卖出的 Put/Call 行权价彼此靠得很近（不像标准铁鹰隔得远，也不像铁蝶是同一个价），两侧各加保护，形成介于铁蝶和铁鹰之间的窄体结构，两翼宽度还可以不对称。注意：这跟真正的\"玉蜥蜴/Jade Lizard\"不是一回事——那个策略的 Put 侧是裸卖、完全不加保护（见下面的\"玉蜥蜴\"预设）。", en: "Sell a put and a call at strikes close together but not identical (narrower than a standard Iron Condor, wider than an Iron Butterfly's single strike), with a protective wing on each side — wings can be uneven too. Not to be confused with a true Jade Lizard, which leaves the put side completely naked (see the \"Jade Lizard\" preset below)." },
        market: { zh: "中性，认为股价会落在两个卖出行权价之间的窄区间内，同时希望用两翼保护封顶最大亏损。", en: "Neutral, expecting price to land within the narrow band between the two short strikes, while capping max loss with protective wings." },
        stocks: { zh: "大盘指数ETF、财报后趋于稳定但两侧风险不对等的个股。", en: "Index ETFs, stocks stabilizing post-earnings with uneven tail risk on each side." },
        direction: "中性",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损取决于两翼中较窄的一侧宽度减去净收权利金。", en: "Defined risk — max loss is driven by whichever wing is narrower, minus the net credit." } },
          { severity: "caution", text: { zh: "四条腿组合，两翼宽度不对称意味着两侧风险也不对称；两条卖出腿都有提前指派风险。", en: "A 4-leg trade with uneven wing widths, so risk isn't symmetric between the two sides; both short legs carry early-assignment risk." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "put", strike: 100, premium: 4 }),
          leg({ action: "sell", type: "call", strike: 105, premium: 2.5 }),
          leg({ action: "buy", type: "put", strike: 90, premium: 0.5 }),
          leg({ action: "buy", type: "call", strike: 110, premium: 0.5 }),
        ],
      },
      {
        name: { zh: "玉蜥蜴", en: "Jade Lizard" },
        desc: { zh: "裸卖 OTM Put（不加保护）+ 卖出 OTM Call 价差，若总信用 ≥ Call 价差宽度，上方就完全没有额外风险；下方风险等同裸卖 Put——可能被指派接盘，理论上跌到 0 为止。", en: "A naked OTM put (no protection) + a short OTM call spread; if the total credit covers the call spread's width, there's zero upside risk. Downside risk is identical to a naked short put — possible assignment, loss bounded only by the stock hitting zero." },
        market: { zh: "中性偏温和看涨，愿意承担被指派买入正股的下行风险，换取比普通铁鹰更高的权利金、且完全消除上行风险。", en: "Neutral to mildly bullish, willing to accept assignment risk on the downside in exchange for a bigger credit than a typical iron condor and zero upside risk." },
        stocks: { zh: "愿意在下跌时接盘的个股，或希望彻底消除上行风险、专注下方风险管理的场景。", en: "Stocks you're willing to own on a dip, or when you want to eliminate upside risk entirely and focus on managing downside." },
        direction: "中性/温和看涨",
        risk: [
          { severity: "danger", text: { zh: "Put侧是裸卖，下方风险很大但有底（跌到0为止）；只要总信用≥Call价差宽度，上方就没有额外风险。", en: "The put side is naked — large but bounded downside risk (to zero). As long as total credit ≥ the call spread's width, there's no upside risk at all." } },
          { severity: "caution", text: { zh: "Put侧需要现金担保或保证金；三条腿都可能被提前指派（Put端参考裸卖Put逻辑，Call端参考价差指派逻辑）。", en: "The put side needs cash-secured or margin backing; all three legs carry early-assignment risk (put side like a naked short put, call side like a credit spread)." } },
          { severity: "info", text: { zh: "本质是裸卖Put+卖方Call价差的组合，赚的是权利金和IV下降的钱，IV意外走高会同时拖累两侧。", en: "Essentially a naked short put plus a short call spread — profits from premium and falling IV; an IV spike pressures both sides." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "put", strike: 90, premium: 3.5 }),
          leg({ action: "sell", type: "call", strike: 105, premium: 2.5 }),
          leg({ action: "buy", type: "call", strike: 110, premium: 0.7 }),
        ],
      },
      {
        name: { zh: "破翅蝶式", en: "Broken Wing Butterfly (Call)" },
        desc: { zh: "不对称蝶式，一侧翅膀更远以降低成本，偏多或偏空。", en: "Asymmetric butterfly with one wing further; lower cost, directional bias." },
        market: { zh: "温和看涨，预期股价小幅上涨至目标价后停滞。", en: "Mildly bullish, expecting small move to target then stall." },
        stocks: { zh: "趋势股接近目标位、大盘接近阻力位。", en: "Trending stocks near target, index near resistance." },
        direction: "温和看涨",
        risk: [
          { severity: "danger", text: { zh: "通过让一侧翅膀更远，把净成本压得很低甚至转为净收——极端情况下的最大亏损/盈利跟对称蝶式不同，两侧不再对等。", en: "Widening one wing pushes the net cost down (even to a credit) — the max loss/profit at the extremes is no longer symmetric between the two sides." } },
          { severity: "caution", text: { zh: "中间行权价的卖出腿数量是外侧的2倍，流动性/滑点会直接影响实际净成本；该腿临近实值有提前指派风险。", en: "The short legs at the middle strike are double the outer legs' size — liquidity/slippage directly affects your real net cost; this leg carries early-assignment risk if ITM." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "call", strike: 95, premium: 7 }),
          leg({ action: "sell", type: "call", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "call", strike: 100, premium: 5 }),
          leg({ action: "buy", type: "call", strike: 110, premium: 1 }),
        ],
      },
      {
        name: { zh: "反向蝶式", en: "Short Butterfly" },
        desc: { zh: "卖出中间行权价两个 Call，买入两边行权价各一个 Call，押注股价大幅偏离中心。", en: "Sell 2 middle calls, buy 1 each side; bet on stock moving away from center." },
        market: { zh: "预期大幅波动但不确定方向，波动率偏低时。", en: "Expecting large move but unsure direction, when vol is low." },
        stocks: { zh: "财报前个股、事件驱动行情。", en: "Pre-earnings stocks, event-driven plays." },
        direction: "双向波动",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=净收权利金，发生在到期正好落在中间行权价时。", en: "Defined risk — max loss is the net credit received, occurring if price lands exactly at the center strike at expiry." } },
          { severity: "caution", text: { zh: "中间行权价的买入腿数量是外侧的2倍；作为不常用的策略，流动性和滑点成本可能偏高。", en: "The two long legs at the center strike are double the outer legs' size; as a less commonly traded structure, liquidity and slippage costs can run higher." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "call", strike: 95, premium: 7 }),
          leg({ action: "buy", type: "call", strike: 100, premium: 4.7 }),
          leg({ action: "buy", type: "call", strike: 100, premium: 4.7 }),
          leg({ action: "sell", type: "call", strike: 105, premium: 3 }),
        ],
      },
      {
        name: { zh: "Call 鹰式", en: "Call Condor" },
        desc: { zh: "全部用 Call 构建的铁鹰，买入两端卖出中间两个，押注股价在中间区间内。", en: "All-call condor; buy wings sell body, bet on range-bound." },
        market: { zh: "中性震荡，预期股价在窄区间内运行。", en: "Neutral sideways, expecting tight range." },
        stocks: { zh: "大盘指数ETF、低波动率个股。", en: "Index ETFs, low-vol stocks." },
        direction: "中性/震荡",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付净权利金。", en: "Defined risk — max loss is the net debit paid." } },
          { severity: "caution", text: { zh: "全部用Call构建，四条腿都在同一到期日，冷门行权价的滑点会侵蚀理论盈利；卖出的两条中间腿有提前指派风险。", en: "Built entirely from calls on one expiry — illiquid strikes eat into the theoretical profit via slippage; the two short middle legs carry early-assignment risk." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "call", strike: 90, premium: 10 }),
          leg({ action: "sell", type: "call", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "call", strike: 105, premium: 2.5 }),
          leg({ action: "buy", type: "call", strike: 115, premium: 0.5 }),
        ],
      },
      {
        name: { zh: "Put 蝶式", en: "Put Butterfly" },
        desc: { zh: "全部用 Put 构建的蝶式，买入两端卖出中间两个，最大盈利在中心行权价。", en: "All-put butterfly; buy wings sell body, max profit at center strike." },
        market: { zh: "预期股价稳定在某一价格附近。", en: "Expecting stock to stabilize near a specific price." },
        stocks: { zh: "大盘指数、支撑位明确的个股。", en: "Index, stocks with clear support." },
        direction: "中性",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付净权利金，发生在股价远离中间行权价时。", en: "Defined risk — max loss is the net debit paid, occurring if price ends up far from the center strike." } },
          { severity: "caution", text: { zh: "中间行权价的卖出腿数量是外侧的2倍；正常应付出一个不大但为正的净成本，若算出来接近0要留意报价是否合理。", en: "The short legs at the middle strike are double the outer legs' size; this should normally cost a small positive net debit — if it prices near zero, double-check the quotes." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "put", strike: 95, premium: 3 }),
          leg({ action: "sell", type: "put", strike: 100, premium: 4.7 }),
          leg({ action: "sell", type: "put", strike: 100, premium: 4.7 }),
          leg({ action: "buy", type: "put", strike: 105, premium: 7 }),
        ],
      },
      {
        name: { zh: "双对角价差", en: "Double Diagonal" },
        desc: { zh: "近月同时卖出 OTM Call + OTM Put，远月对应买入更高/更低行权价的 Call + Put 保护；Call侧和Put侧各自都是一条对角价差，两条对角价差合在一起才是真正的双对角。", en: "Sell near-term OTM call + OTM put; buy far-term protection at a higher call strike and a lower put strike — each side (call, put) is its own diagonal spread, and the two together form a true double diagonal." },
        market: { zh: "预期近月低波动横盘，愿意接受比双日历价差更小的最大盈利，换取更宽的中性获利区间。", en: "Expecting near-term low volatility and sideways action; accept a smaller max profit than a double calendar in exchange for a wider profit zone." },
        stocks: { zh: "波动率期限结构陡峭（近月IV相对偏低）的大盘指数ETF，或事件后趋于平稳的个股。", en: "Index ETFs when the vol term structure is steep (near-term IV relatively low), or stocks calming down post-event." },
        direction: "中性",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付净权利金；但如果股价大幅偏向任一方向、越过对应的远月行权价，那一侧就跟普通价差一样会亏到接近最大值，不是\"越久越安全\"。", en: "Defined risk — max loss is the net debit paid; but if price moves far enough past either far-dated strike, that side loses like an ordinary spread heading toward its max loss — this isn't automatically \"safer over time.\"" } },
          { severity: "caution", text: { zh: "近月的空头Call和空头Put都需要在各自到期前主动处理（平仓或展期），临近到期变实值也有提前指派风险；四条腿分属两个到期日，管理复杂度比单一对角价差更高。", en: "Both near-term short legs (call and put) need active management before their own expiry (close or roll), and carry early-assignment risk if ITM near then; with 4 legs across two expirations, this is more involved to manage than a single diagonal." } },
          { severity: "info", text: { zh: "本质是双日历价差的近亲——近月双卖的权利金部分抵消远月双买的成本，赚的是近月IV相对走高、股价维持中性的钱；把行权价往两侧挪（而不是像双日历那样锁定同一个ATM行权价）换来更宽的获利区间，代价是最大盈利变小。", en: "A close relative of the double calendar — the near-term double-sell partially offsets the cost of the far-term double-buy, profiting from near-term IV rising relative to far-term and the stock staying centered; moving the strikes outward (instead of stacking both legs on one ATM strike like a double calendar) buys a wider profit zone at the cost of a smaller max profit." } },
        ],
        legs: () => [
          leg({ action: "sell", type: "call", strike: 105, dte: 14, premium: 2 }),
          leg({ action: "buy", type: "call", strike: 115, dte: 45, premium: 3 }),
          leg({ action: "sell", type: "put", strike: 95, dte: 14, premium: 2 }),
          leg({ action: "buy", type: "put", strike: 85, dte: 45, premium: 3 }),
        ],
      },
      {
        name: { zh: "反向日历价差", en: "Reverse Calendar Spread" },
        desc: { zh: "买入近月 ATM Call + 卖出远月同行权价 Call（通常净收权利金），跟日历价差方向相反，押注近月隐含波动率相对走高或股价短期内快速变动，而不是长期横盘。", en: "Buy near-term ATM call + sell far-term same-strike call (usually a net credit); the opposite direction of a calendar spread — bets on near-term IV rising relative to far-term, or a quick move soon, not on prolonged calm." },
        market: { zh: "预期短期波动加剧，远期相对稳定。", en: "Expecting short-term vol spike, far-term stable." },
        stocks: { zh: "事件驱动个股、波动率期限结构倒挂时。", en: "Event-driven stocks, when vol term structure is inverted." },
        direction: "双向波动",
        risk: [
          { severity: "danger", text: { zh: "由于近月到期后仍需处理剩下的远月空头仓位，风险不像普通价差那样在开仓时就完全封顶，需要持续管理。", en: "Because you're left holding the remaining far-dated short leg after the near leg expires, the risk isn't fully locked in at entry like a normal spread — it needs ongoing management." } },
          { severity: "caution", text: { zh: "远月空头Call需要保证金；若临近到期变实值，也有提前指派风险，尤其留意除息日。", en: "The far-dated short call needs margin; if it moves ITM near its own expiry, it carries early-assignment risk — watch ex-dividend dates." } },
          { severity: "info", text: { zh: "赚的是近月IV相对走高（或股价快速变动）的钱；如果近月IV没有如期上升，或维持横盘，可能跑不赢一个简单的日历价差。", en: "Profits from near-term IV rising relative to far-term (or a quick move); if near-term IV doesn't cooperate, or the stock just grinds sideways, this can underperform a plain calendar spread." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "call", strike: 100, dte: 14, premium: 2.5 }),
          leg({ action: "sell", type: "call", strike: 100, dte: 45, premium: 5 }),
        ],
      },
      {
        name: { zh: "Put 鹰式", en: "Put Condor" },
        desc: { zh: "全部用 Put 构建的鹰式，买入两端卖出中间两个，押注股价在中间区间内。", en: "All-put condor; buy wings sell body, bet on range-bound." },
        market: { zh: "中性震荡，预期股价在窄区间内运行。", en: "Neutral sideways, expecting tight range." },
        stocks: { zh: "大盘指数ETF、低波动率个股。", en: "Index ETFs, low-vol stocks." },
        direction: "中性/震荡",
        risk: [
          { severity: "danger", text: { zh: "风险有限，最大亏损=已付净权利金。", en: "Defined risk — max loss is the net debit paid." } },
          { severity: "caution", text: { zh: "全部用Put构建，四条腿都在同一到期日，卖出的两条中间腿有提前指派风险，留意保证金和买卖价差侵蚀。", en: "Built entirely from puts on one expiry — the two short middle legs carry early-assignment risk; watch margin and bid-ask erosion." } },
        ],
        legs: () => [
          leg({ action: "buy", type: "put", strike: 90, premium: 1 }),
          leg({ action: "sell", type: "put", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "put", strike: 105, premium: 8 }),
          leg({ action: "buy", type: "put", strike: 115, premium: 15 }),
        ],
      },
    ],
  },
];