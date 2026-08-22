// Direct TypeScript port of qqq_data_fetcher.py's indicator math.
//
// IMPORTANT: this intentionally mirrors what the Python script actually
// computes, not what its comments claim. In particular, calcRsi and calcAtr
// are labelled "Wilder smoothing" in the original but are actually simple
// moving averages of the gain/loss and true-range series — a real Wilder
// implementation would use a recursive smoothing formula and would produce
// different numbers. This port preserves the simple-average behavior
// exactly, since the strategy logic downstream was tuned against these
// numbers, not against textbook Wilder RSI/ATR. Do not "fix" this without
// checking with the person first — see the daily_strategy.py handoff notes.

export interface OhlcvRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorResult {
  currentPrice: number;
  ma20: number | null;
  ma50: number | null;
  ma200: number | null;
  ema9: number | null;
  ema21: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  bbMid: number | null;
  bbWidth: number | null;
  bbPct: number | null;
  atr14: number | null;
  atrPct: number | null;
  volumeToday: number;
  volumeAvg20d: number | null;
  volumeRatio: number | null;
  high52w: number;
  low52w: number;
  high20d: number | null;
  low20d: number | null;
  high60d: number | null;
  drawdownFrom52wHigh: number;
  drawdownFrom60dHigh: number | null;
  priceVsMa20Pct: number | null;
  priceVsMa50Pct: number | null;
  priceVsMa200Pct: number | null;
  chg1d: number | null;
  chg5d: number | null;
  chg20d: number | null;
}

function round(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Population standard deviation (ddof=0, matching numpy's default and the
// Python script's np.std(..., ddof=0) call for the Bollinger Band width).
function stdPopulation(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}

function sma(arr: number[], window: number): number | null {
  if (arr.length < window) return null;
  return round(mean(arr.slice(-window)), 2);
}

// Returns the full EMA series (needed because MACD is built from EMA
// series, not just the latest EMA value).
function emaFull(arr: number[], window: number): number[] | null {
  if (arr.length < window) return null;
  const k = 2 / (window + 1);
  const result: number[] = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    result.push(arr[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

function emaLast(arr: number[], window: number): number | null {
  const series = emaFull(arr, window);
  if (!series) return null;
  return round(series[series.length - 1], 2);
}

function calcMacd(arr: number[]): { line: number | null; signal: number | null; hist: number | null } {
  if (arr.length < 35) return { line: null, signal: null, hist: null };
  const ema12 = emaFull(arr, 12);
  const ema26 = emaFull(arr, 26);
  if (!ema12 || !ema26) return { line: null, signal: null, hist: null };
  const minLen = Math.min(ema12.length, ema26.length);
  const macdSeries = ema12.slice(-minLen).map((v, i) => v - ema26.slice(-minLen)[i]);
  const signalSeries = emaFull(macdSeries, 9);
  if (!signalSeries) return { line: null, signal: null, hist: null };
  const line = round(macdSeries[macdSeries.length - 1], 3);
  const signal = round(signalSeries[signalSeries.length - 1], 3);
  const hist = round(line - signal, 3);
  return { line, signal, hist };
}

// Simple average of gains/losses over the window — see the file-level note
// above on why this is not "real" Wilder smoothing despite the name.
function calcRsi(arr: number[], period = 14): number | null {
  if (arr.length < period + 2) return null;
  const deltas: number[] = [];
  for (let i = 1; i < arr.length; i++) deltas.push(arr[i] - arr[i - 1]);
  const gains = deltas.map((d) => (d > 0 ? d : 0));
  const losses = deltas.map((d) => (d < 0 ? -d : 0));
  const avgGain = mean(gains.slice(-period));
  const avgLoss = mean(losses.slice(-period));
  if (avgLoss === 0) return 100.0;
  const rs = avgGain / avgLoss;
  return round(100 - 100 / (1 + rs), 1);
}

// Simple average of true range over the window — see the file-level note
// above; this is not the recursive Wilder ATR either.
function calcAtr(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const trs: number[] = [];
  const n = closes.length;
  for (let i = n - period; i < n; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs.push(tr);
  }
  return round(mean(trs), 2);
}

export function computeIndicators(rows: OhlcvRow[]): IndicatorResult | null {
  const n = rows.length;
  if (n < 60) return null; // matches the Python script's "价格数据不足" guard

  const opens = rows.map((r) => r.open);
  const highs = rows.map((r) => r.high);
  const lows = rows.map((r) => r.low);
  const closes = rows.map((r) => r.close);
  const volumes = rows.map((r) => r.volume);
  void opens; // kept for parity with the Python source, which also loads but doesn't use `opens`

  const currentPrice = closes[n - 1];

  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, Math.min(200, n));
  const ema9 = emaLast(closes, 9);
  const ema21 = emaLast(closes, 21);

  const { line: macdLine, signal: macdSignal, hist: macdHistogram } = calcMacd(closes);
  const rsi14 = calcRsi(closes, 14);

  let bbUpper: number | null = null;
  let bbLower: number | null = null;
  let bbMid: number | null = null;
  let bbWidth: number | null = null;
  let bbPct: number | null = null;
  if (n >= 20) {
    bbMid = ma20;
    const std20 = stdPopulation(closes.slice(-20));
    bbUpper = round((bbMid as number) + 2 * std20, 2);
    bbLower = round((bbMid as number) - 2 * std20, 2);
    bbWidth = round(((bbUpper - bbLower) / (bbMid as number)) * 100, 1);
    if (bbUpper !== bbLower) {
      bbPct = round(((currentPrice - bbLower) / (bbUpper - bbLower)) * 100, 1);
    }
  }

  const atr14 = calcAtr(highs, lows, closes, 14);
  const atrPct = atr14 ? round((atr14 / currentPrice) * 100, 2) : null;

  const avgVol20 = n >= 20 ? mean(volumes.slice(-20)) : null;
  const volumeRatio = avgVol20 ? round(volumes[n - 1] / avgVol20, 2) : null;

  const windowFor252 = highs.slice(-Math.min(252, n));
  const windowFor252Lows = lows.slice(-Math.min(252, n));
  const high52w = Math.max(...windowFor252);
  const low52w = Math.min(...windowFor252Lows);
  const high20d = n >= 20 ? Math.max(...highs.slice(-20)) : null;
  const low20d = n >= 20 ? Math.min(...lows.slice(-20)) : null;
  const high60d = n >= 60 ? Math.max(...highs.slice(-60)) : null;

  const drawdownFrom52wHigh = round(((currentPrice - high52w) / high52w) * 100, 2);
  const drawdownFrom60dHigh = high60d ? round(((currentPrice - high60d) / high60d) * 100, 2) : null;

  const priceVsMa20Pct = ma20 ? round(((currentPrice - ma20) / ma20) * 100, 2) : null;
  const priceVsMa50Pct = ma50 ? round(((currentPrice - ma50) / ma50) * 100, 2) : null;
  const priceVsMa200Pct = ma200 ? round(((currentPrice - ma200) / ma200) * 100, 2) : null;

  const chg1d = n >= 2 ? round(((closes[n - 1] - closes[n - 2]) / closes[n - 2]) * 100, 2) : null;
  const chg5d = n >= 6 ? round(((closes[n - 1] - closes[n - 6]) / closes[n - 6]) * 100, 2) : null;
  const chg20d = n >= 21 ? round(((closes[n - 1] - closes[n - 21]) / closes[n - 21]) * 100, 2) : null;

  return {
    currentPrice: round(currentPrice, 2),
    ma20,
    ma50,
    ma200,
    ema9,
    ema21,
    rsi14,
    macdLine,
    macdSignal,
    macdHistogram,
    bbUpper,
    bbLower,
    bbMid,
    bbWidth,
    bbPct,
    atr14,
    atrPct,
    volumeToday: volumes[n - 1],
    volumeAvg20d: avgVol20 ? Math.round(avgVol20) : null,
    volumeRatio,
    high52w: round(high52w, 2),
    low52w: round(low52w, 2),
    high20d: high20d ? round(high20d, 2) : null,
    low20d: low20d ? round(low20d, 2) : null,
    high60d: high60d ? round(high60d, 2) : null,
    drawdownFrom52wHigh,
    drawdownFrom60dHigh,
    priceVsMa20Pct,
    priceVsMa50Pct,
    priceVsMa200Pct,
    chg1d,
    chg5d,
    chg20d,
  };
}