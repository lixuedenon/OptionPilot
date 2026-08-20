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

export interface PresetMeta {
  name: LocalStr;
  desc: LocalStr;
  market: LocalStr;
  stocks: LocalStr;
  direction: string;
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
        legs: () => [leg({ action: "buy", type: "call", strike: 100, premium: 5 })],
      },
      {
        name: { zh: "裸卖 Call", en: "Short Call" },
        desc: { zh: "卖出call，收取权利金，但上方亏损无限，需要保证金。", en: "Sell a call; collect premium but unlimited upside risk, requires margin." },
        market: { zh: "看跌或震荡行情，预期股价不会大幅上涨。", en: "Bearish or range-bound, expecting no significant upside." },
        stocks: { zh: "低波动率大盘蓝筹，或已持有正股的备兑策略。", en: "Low-vol blue chips, or covered call on held shares." },
        direction: "看跌/中性",
        legs: () => [leg({ action: "sell", type: "call", strike: 100, premium: 5 })],
      },
      {
        name: { zh: "裸买 Put", en: "Long Put" },
        desc: { zh: "买入put，权利金为最大亏损，下方盈利至股价归零。", en: "Buy a put; premium is max loss, downside profit to zero." },
        market: { zh: "强烈看跌行情，预期股价短期大幅下跌。", en: "Strongly bearish, expecting sharp short-term drop." },
        stocks: { zh: "基本面恶化、技术形态破位的个股，或大盘对冲工具（SPY/QQQ）。", en: "Deteriorating fundamentals, broken technicals, or index hedges (SPY/QQQ)." },
        direction: "看跌",
        legs: () => [leg({ action: "buy", type: "put", strike: 100, premium: 5 })],
      },
      {
        name: { zh: "裸卖 Put", en: "Short Put" },
        desc: { zh: "卖出put，收取权利金；若到期价格低于行权价则被迫以行权价买入股票。", en: "Sell a put; if price < strike at expiry, assigned to buy shares." },
        market: { zh: "看涨或温和看涨行情，愿意以更低价格买入股票。", en: "Bullish or mildly bullish, willing to buy shares lower." },
        stocks: { zh: "业绩稳健、愿意持有的股票，常用于分批建仓。", en: "Solid stocks you want to own, often used for scaling in." },
        direction: "看涨",
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
        legs: () => [
          leg({ action: "sell", type: "call", strike: 100, premium: 5 }),
          leg({ action: "buy", type: "call", strike: 110, premium: 1.5 }),
        ],
      },
      {
        name: { zh: "牛市 Put 价差", en: "Bull Put Spread" },
        desc: { zh: "卖低行权价 Put + 买更低行权价 Put，收取信用差价，看涨。", en: "Sell higher strike put + buy lower strike put; credit spread when bullish." },
        market: { zh: "温和看涨，预期股价不会大幅下跌。", en: "Mildly bullish, expecting no significant downside." },
        stocks: { zh: "支撑位明确的大盘指数或蓝筹股。", en: "Index or blue chips with clear support levels." },
        direction: "看涨",
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
        legs: () => [
          leg({ action: "buy", type: "call", strike: 108, premium: 2.5 }),
          leg({ action: "buy", type: "put", strike: 92, premium: 2.5 }),
        ],
      },
      {
        name: { zh: "卖出宽跨式", en: "Short Strangle" },
        desc: { zh: "卖出 OTM Call + OTM Put，区间更宽，胜率更高，但仍有无限亏损风险。", en: "Sell OTM call + put; wider range, higher win rate, still unlimited risk." },
        market: { zh: "低波动率震荡市，预期股价在较宽区间内横盘。", en: "Low-vol sideways market, expecting wide range-bound action." },
        stocks: { zh: "SPY/QQQ 等流动性高的指数ETF，波动率高位时操作。", en: "Liquid index ETFs (SPY/QQQ), when IV is elevated." },
        direction: "中性/震荡",
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
        legs: () => [
          leg({ action: "buy", type: "put", strike: 90, premium: 0.5 }),
          leg({ action: "sell", type: "put", strike: 100, premium: 4 }),
          leg({ action: "sell", type: "call", strike: 100, premium: 4 }),
          leg({ action: "buy", type: "call", strike: 110, premium: 0.5 }),
        ],
      },
      {
        name: { zh: "买入铁蝶", en: "Long Iron Butterfly" },
        desc: { zh: "买入 ATM Call + Put，同时卖出更远 OTM Call + Put 融资，为大幅波动支付权利金，是铁蝶策略的相反方向。", en: "Buy ATM straddle + sell OTM straddle to offset cost; pay for large move, opposite of iron butterfly." },
        market: { zh: "预期事件驱动大幅波动，但不确定方向。", en: "Event-driven, expecting large move but unsure direction." },
        stocks: { zh: "财报前、FDA审批前的个股，或宏观数据发布前的指数。", en: "Pre-earnings or pre-FDA stocks, or indices before macro data releases." },
        direction: "双向波动",
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
        legs: () => [
          leg({ action: "buy", type: "call", strike: 95, premium: 7 }),
          leg({ action: "sell", type: "call", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "call", strike: 100, premium: 5 }),
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
        desc: { zh: "买入一个 Call，卖出两个更高行权价 Call，净低成本甚至收取权利金，但上行有额外卖空风险。", en: "Buy 1 call, sell 2 higher calls; low/net credit but extra short risk upside." },
        market: { zh: "温和看涨，预期股价小幅上涨，不会大幅突破。", en: "Mildly bullish, expecting small gain, no breakout." },
        stocks: { zh: "波动率较高时，中型成长股或LEAPS策略。", en: "Mid-cap growth when vol is high, or LEAPS strategies." },
        direction: "温和看涨",
        legs: () => [
          leg({ action: "buy", type: "call", strike: 98, premium: 6 }),
          leg({ action: "sell", type: "call", strike: 105, premium: 2.5 }),
          leg({ action: "sell", type: "call", strike: 105, premium: 2.5 }),
        ],
      },
      {
        name: { zh: "比率 Put 价差", en: "Put Ratio Spread" },
        desc: { zh: "买入一个 Put，卖出两个更低行权价 Put，低成本做空但下行有额外风险。", en: "Buy 1 put, sell 2 lower puts; cheap bearish but extra downside risk." },
        market: { zh: "温和看跌，预期股价小幅下跌，不会崩盘式下跌。", en: "Mildly bearish, expecting small drop, no crash." },
        stocks: { zh: "阶段性高位个股，或大盘回调但不深跌时。", en: "Stocks at阶段性 highs, or mild market pullback." },
        direction: "温和看跌",
        legs: () => [
          leg({ action: "buy", type: "put", strike: 102, premium: 6 }),
          leg({ action: "sell", type: "put", strike: 95, premium: 2.5 }),
          leg({ action: "sell", type: "put", strike: 95, premium: 2.5 }),
        ],
      },
      {
        name: { zh: "反向比率 Call 价差", en: "Call Backspread" },
        desc: { zh: "卖出一个 Call，买入两个更高行权价 Call，上行盈利加速，下行有限。", en: "Sell 1 call, buy 2 higher calls; accelerating upside profit, limited downside." },
        market: { zh: "看涨但预期可能爆发式上涨。", en: "Bullish but expecting potential explosive rally." },
        stocks: { zh: "财报季成长股、催化剂驱动的个股。", en: "Earnings-season growth stocks, catalyst-driven stocks." },
        direction: "看涨",
        legs: () => [
          leg({ action: "sell", type: "call", strike: 100, premium: 5 }),
          leg({ action: "buy", type: "call", strike: 108, premium: 2 }),
          leg({ action: "buy", type: "call", strike: 108, premium: 2 }),
        ],
      },
      {
        name: { zh: "反向比率 Put 价差", en: "Put Backspread" },
        desc: { zh: "卖出一个 Put，买入两个更低行权价 Put，下行盈利加速，上行有限。", en: "Sell 1 put, buy 2 lower puts; accelerating downside profit, limited upside." },
        market: { zh: "看跌但预期可能爆发式下跌。", en: "Bearish but expecting potential sharp sell-off." },
        stocks: { zh: "财报季高估值成长股、利空催化剂前的个股。", en: "Overvalued growth stocks pre-earnings, stocks facing bearish catalysts." },
        direction: "看跌",
        legs: () => [
          leg({ action: "sell", type: "put", strike: 100, premium: 5 }),
          leg({ action: "buy", type: "put", strike: 92, premium: 2 }),
          leg({ action: "buy", type: "put", strike: 92, premium: 2 }),
        ],
      },
      {
        name: { zh: "圣诞树 Call", en: "Christmas Tree Call" },
        desc: { zh: "买入一个 ATM Call，跳过一行权价卖出两个，再买入一个更高行权价 Call，3:1:1 结构。", en: "Buy 1 ATM call, skip a strike sell 2, buy 1 higher call; 3:1:1 structure." },
        market: { zh: "温和看涨，预期股价小幅上涨至某一目标价。", en: "Mildly bullish, expecting small move to a target price." },
        stocks: { zh: "趋势股、大盘指数接近目标位时。", en: "Trending stocks, index near a target level." },
        direction: "温和看涨",
        legs: () => [
          leg({ action: "buy", type: "call", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "call", strike: 105, premium: 2.5 }),
          leg({ action: "sell", type: "call", strike: 105, premium: 2.5 }),
          leg({ action: "buy", type: "call", strike: 110, premium: 1 }),
        ],
      },
      {
        name: { zh: "圣诞树 Put", en: "Christmas Tree Put" },
        desc: { zh: "买入一个 ATM Put，跳过一行权价卖出两个，再买入一个更低行权价 Put，3:1:1 结构。", en: "Buy 1 ATM put, skip a strike sell 2, buy 1 lower put; 3:1:1 structure." },
        market: { zh: "温和看跌，预期股价小幅下跌至某一目标价。", en: "Mildly bearish, expecting small drop to a target price." },
        stocks: { zh: "高位回调股、大盘见顶时。", en: "Pullback candidates, or when market is topping." },
        direction: "温和看跌",
        legs: () => [
          leg({ action: "buy", type: "put", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "put", strike: 95, premium: 2.5 }),
          leg({ action: "sell", type: "put", strike: 95, premium: 2.5 }),
          leg({ action: "buy", type: "put", strike: 90, premium: 1 }),
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
        legs: () => [
          leg({ action: "buy", type: "put", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "put", strike: 90, premium: 1.5 }),
          leg({ action: "sell", type: "call", strike: 110, premium: 3.5 }),
        ],
      },
      {
        name: { zh: "玉蜥蜴", en: "Broken Wing Butterfly" },
        desc: { zh: "修改版铁蝶，跳过中间行权价，一侧翅膀更远，降低成本并偏中性。", en: "Modified iron butterfly with asymmetric wings; lower cost, neutral bias." },
        market: { zh: "中性偏温和看涨，预期股价在窄区间内震荡。", en: "Neutral to mildly bullish, expecting tight range." },
        stocks: { zh: "大盘指数ETF、波动率回落期的个股。", en: "Index ETFs, stocks during vol normalization." },
        direction: "中性",
        legs: () => [
          leg({ action: "sell", type: "put", strike: 100, premium: 4 }),
          leg({ action: "sell", type: "call", strike: 105, premium: 2.5 }),
          leg({ action: "buy", type: "put", strike: 90, premium: 0.5 }),
          leg({ action: "buy", type: "call", strike: 110, premium: 0.5 }),
        ],
      },
      {
        name: { zh: "破翅蝶式", en: "Broken Wing Butterfly (Call)" },
        desc: { zh: "不对称蝶式，一侧翅膀更远以降低成本，偏多或偏空。", en: "Asymmetric butterfly with one wing further; lower cost, directional bias." },
        market: { zh: "温和看涨，预期股价小幅上涨至目标价后停滞。", en: "Mildly bullish, expecting small move to target then stall." },
        stocks: { zh: "趋势股接近目标位、大盘接近阻力位。", en: "Trending stocks near target, index near resistance." },
        direction: "温和看涨",
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
        legs: () => [
          leg({ action: "sell", type: "call", strike: 95, premium: 7 }),
          leg({ action: "buy", type: "call", strike: 100, premium: 5 }),
          leg({ action: "buy", type: "call", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "call", strike: 105, premium: 3 }),
        ],
      },
      {
        name: { zh: "Call 鹰式", en: "Call Condor" },
        desc: { zh: "全部用 Call 构建的铁鹰，买入两端卖出中间两个，押注股价在中间区间内。", en: "All-call condor; buy wings sell body, bet on range-bound." },
        market: { zh: "中性震荡，预期股价在窄区间内运行。", en: "Neutral sideways, expecting tight range." },
        stocks: { zh: "大盘指数ETF、低波动率个股。", en: "Index ETFs, low-vol stocks." },
        direction: "中性/震荡",
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
        legs: () => [
          leg({ action: "buy", type: "put", strike: 95, premium: 3 }),
          leg({ action: "sell", type: "put", strike: 100, premium: 5 }),
          leg({ action: "sell", type: "put", strike: 100, premium: 5 }),
          leg({ action: "buy", type: "put", strike: 105, premium: 7 }),
        ],
      },
      {
        name: { zh: "双对角价差", en: "Double Diagonal" },
        desc: { zh: "近月 Put 价差 + 远月 Call 价差，押注近月震荡、远月温和上涨。", en: "Near-term put spread + far-term call spread; bet on near-term calm, far-term drift." },
        market: { zh: "短期横盘、中期温和看涨的复合预期。", en: "Short-term sideways, medium-term mildly bullish." },
        stocks: { zh: "大盘指数ETF、波动率期限结构陡峭时。", en: "Index ETFs, when vol term structure is steep." },
        direction: "中性/温和看涨",
        legs: () => [
          leg({ action: "buy", type: "put", strike: 95, dte: 14, premium: 1.5 }),
          leg({ action: "sell", type: "put", strike: 100, dte: 14, premium: 3 }),
          leg({ action: "sell", type: "call", strike: 100, dte: 45, premium: 5 }),
          leg({ action: "buy", type: "call", strike: 110, dte: 45, premium: 1.5 }),
        ],
      },
      {
        name: { zh: "后期价差", en: "Poor Man's Covered Call" },
        desc: { zh: "买入近月 ATM Call + 卖出远月同行权价 Call，押注近月波动率上升。", en: "Buy near-term ATM call + sell far-term same-strike call; bet on near-term vol rise." },
        market: { zh: "预期短期波动加剧，远期相对稳定。", en: "Expecting short-term vol spike, far-term stable." },
        stocks: { zh: "事件驱动个股、波动率期限结构倒挂时。", en: "Event-driven stocks, when vol term structure is inverted." },
        direction: "双向波动",
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