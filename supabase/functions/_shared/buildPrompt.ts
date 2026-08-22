import type { IndicatorResult } from "./technicalIndicators.ts";

// STRATEGY_REQUIREMENTS below is copied VERBATIM from daily_strategy.py —
// do not edit the strategy logic itself. Per the integration handoff notes:
// "开发者本人是有实战经验的期权交易者，策略逻辑经过本人验证，不要随意修改
// STRATEGY_REQUIREMENTS中的策略方向定义". If this ever needs to change, the
// person needs to make that call, not a translation pass.
export const STRATEGY_REQUIREMENTS = `
## 策略要求

核心目标：通过卖出期权获取稳定权利金，追求长期稳定收益而非短期暴利。

**卖方为主（约80%以上）：**

根据走势判断匹配策略类型：
- 缓慢上涨 / 暴涨 / 横盘 → 优先Sell Put，行权价在支撑位下方
- 横盘 → 也可以考虑Iron Condor，Call端必须在强压力位上方
- 缓慢下跌 / 急跌 → 考虑Bear Call Spread（买入Call已锁定最大亏损，
  无需额外对冲仓位，可以直接做）
- 裸Sell Call → 必须有正股或Long Call对冲才能做，否则不做

行权价选择原则（所有卖方策略）：
- 行权价必须在关键支撑位之下，这是底线
- 不想接货：支撑位下方近一点，适当多收权利金
- 想接货（仓位极低时）：支撑位下方远一点，用更低价格接货，权利金少收没关系
- 宁可少收权利金，绝不冒被意外行权的风险
- 两种情况的共同底线：行权价必须在支撑位之下

**买方为辅（约20%以下）：**

仅考虑Leap Call，触发条件是距52周高点有足够跌幅，具体跌幅由你自己判断并说明理由。
- Delta选择0.7-0.8（深度实值，方向感强，时间价值损耗相对小）
- 到期时间由你根据把握程度决定并说明理由：
  - 把握很大 → 可以做6个月，甚至3个月
  - 把握中等 → 建议9-12个月，给足周旋空间，即使上涨较慢也有足够时间
  - 不建议做1-2个月或更短，除非把握极大
- 有合理收益即可考虑平仓，不需要等到最大利润

**观望条件：**
- 下跌趋势中没有对冲仓位且不适合Bear Call Spread时观望
- 行权价找不到合适支撑位下方的位置时观望
- 权利金极低（不值得承担风险）时观望
- 其余情况优先找卖方机会，即使权利金少也可以做
`;

export interface OptionSummary {
  expDate: string;
  daysToExp: number;
  atmIv: number | null; // percent, e.g. 24.5
}

export interface MacroSnapshot {
  vix?: { value: number; change: number };
  treasury10y?: { value: number; change: number };
  sp500?: { value: number; change: number };
}

export interface FearGreedSnapshot {
  score: number | null;
  rating: string;
}

export interface NewsSnapshot {
  headline: string;
}

export type PromptMode = "1" | "2"; // 1 = concise, 2 = detailed — matches the Python script's CLI arg

// Direct port of build_prompt() from daily_strategy.py. `ticker` is only
// ever "QQQ" in this pipeline — see the AI-strategy integration notes on
// why TQQQ doesn't get its own AI call (its parameters are delta-matched
// from QQQ's recommendation instead, via deltaMatch.ts).
export function buildPrompt(params: {
  ticker: "QQQ";
  currentPrice: number;
  date: string;
  ohlcv: { date: string; open: number; high: number; low: number; close: number; volume: number }[];
  indicators: IndicatorResult;
  options: OptionSummary | null;
  macro: MacroSnapshot;
  fearGreed: FearGreedSnapshot;
  news: NewsSnapshot[];
  mode: PromptMode;
}): string {
  const { ticker, currentPrice, date, ohlcv, indicators: p, options: o, macro, fearGreed: fg, news, mode } = params;

  const ohlcvText = ohlcv
    .map((row) => `${row.date}  开:${row.open}  高:${row.high}  低:${row.low}  收:${row.close}  量:${row.volume.toLocaleString()}`)
    .join("\n");

  const indicatorsText = [
    `均线：MA20=${fmt(p.ma20)}  MA50=${fmt(p.ma50)}  MA200=${fmt(p.ma200)}`,
    `      价格vs MA20:${fmt(p.priceVsMa20Pct)}%  vs MA50:${fmt(p.priceVsMa50Pct)}%  vs MA200:${fmt(p.priceVsMa200Pct)}%`,
    `动量：RSI=${fmt(p.rsi14)}  MACD柱=${fmt(p.macdHistogram)}`,
    `布林：上${fmt(p.bbUpper)}  中${fmt(p.bbMid)}  下${fmt(p.bbLower)}  位置${fmt(p.bbPct)}%`,
    `波动：ATR=${fmt(p.atr14)}（${fmt(p.atrPct)}%）`,
    `成交：量比${fmt(p.volumeRatio)}x`,
    `价位：52周高$${fmt(p.high52w)}（回调${fmt(p.drawdownFrom52wHigh)}%）`,
    `      20日高$${fmt(p.high20d)}  20日低$${fmt(p.low20d)}`,
    `涨跌：1日${fmt(p.chg1d)}%  5日${fmt(p.chg5d)}%  20日${fmt(p.chg20d)}%`,
  ].join("\n");

  // NOTE — deliberate approximation, flagged for confirmation: the Python
  // original's options_text came from Moomoo/Schwab, which returned
  // put_delta/open_interest/liquidity_grade directly. Those brokers are
  // dropped for the web version per the integration scope (Moomoo is
  // local-only; Schwab was Moomoo's backup, no longer needed once Yahoo
  // replaces both). Since Yahoo's free chain doesn't carry OI/liquidity
  // grade at all, this summary only reports what we can actually source:
  // the expiry being used, days to expiry, and an ATM-strike implied vol
  // (computed the same way the rest of this app back-solves IV — see
  // deltaMatch.ts). If a closer match to the original section is wanted,
  // that needs a call on what to do about the missing OI/liquidity fields.
  const optionsText = o
    ? `到期:${o.expDate}（${o.daysToExp}天）\nIV=${o.atmIv !== null ? (o.atmIv * 100).toFixed(1) : "N/A"}%`
    : "期权数据不可用";

  const vix = macro.vix;
  const sp500 = macro.sp500;
  const treasury = macro.treasury10y;
  const newsText = news.length > 0 ? news.slice(0, 5).map((n) => `  ${n.headline}`).join("\n") : "无";

  const marketText = [
    `VIX=${fmt(vix?.value)}  恐贪=${fg.score !== null ? fg.score : "N/A"}(${fg.rating})`,
    `标普=${fmt(sp500?.value)}(${sp500 && sp500.change > 0 ? "+" : ""}${fmt(sp500?.change)}%)`,
    `10年债=${fmt(treasury?.value)}%`,
    `近期新闻：`,
    newsText,
  ].join("\n");

  const outputFormat = mode === "1" ? OUTPUT_FORMAT_CONCISE : OUTPUT_FORMAT_DETAILED;

  return `分析标的：${ticker}（纳斯达克100ETF）
当前价格：$${currentPrice}  日期：${date}

## 180天价格数据
${ohlcvText}

## 技术指标
${indicatorsText}

## 期权数据
${optionsText}

## 市场环境
${marketText}

${STRATEGY_REQUIREMENTS}

${outputFormat}`;
}

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? "N/A" : String(v);
}

const OUTPUT_FORMAT_CONCISE = `
## 输出要求
直接给出策略结论，不要任何解释、教学或分析过程。严格按以下格式：

【走势判断】一句话：方向+置信度
【推荐策略】
策略：
参数：行权价 / 到期日 / 预期权利金
理由：一句话（行权价为何在支撑位下方+安全边际）
止盈：
止损：

【备选一】策略 | 参数 | 理由一句话 | 止盈 | 止损
【备选二】策略 | 参数 | 理由一句话 | 止盈 | 止损
【观望】什么情况下不操作
`;

const OUTPUT_FORMAT_DETAILED = `
## 输出格式

【走势判断】
方向与置信度：
关键支撑：$XX/$XX  关键压力：$XX/$XX
波动区间：$XX-$XX
风险提示：一句话

【推荐策略】
策略：
走势匹配理由：（当前走势为XX，因此选择XX策略）
参数：行权价 / 到期日 / 预期权利金
行权价理由：（支撑位在$XX，行权价$XX在支撑位下方XX%，大概率不被行权）
止盈：
止损：
持仓管理：股价跌破$XX则XX；到期前X天若未达目标则XX

【备选一】策略 | 参数 | 理由 | 止盈 | 止损
【备选二】策略 | 参数 | 理由 | 止盈 | 止损
【观望】什么情况不操作，原因
`;