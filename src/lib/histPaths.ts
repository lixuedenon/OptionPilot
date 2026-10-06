// src/lib/histPaths.ts
// 第2组「这只股票历史上的真实走法」：把过去几年每天的收盘价切成一段一段跟这笔期权同样长的走势，套到今天的股价上推演。
// 每个交易日都可以是一个起点（相邻起点的日子大部分重叠，所以"共N段"的可信度比N看起来低，界面上要说清楚）。
// 推演按日历日走（跟定价的dte/365一致）：第d个日历日的股价=那天或之前最近一个交易日的收盘价，周末节假日股价不动、时间照样流逝。
// 走势里包含那段时间真实的涨跌趋势、财报跳空、连续大跌，按它们真实出现的频率出现——这正是跟随机走法（正常大小的每日涨跌）的区别。

export interface HistPaths {
  ratios: Float32Array; // count×(days+1)，第i段第d天 = 收盘价 ÷ 起点收盘价
  days: number; // 每段多少个日历日（=这笔期权开仓到最早到期）
  count: number;
  starts: number[]; // 每段起点的时间（unix秒）
  vols: number[]; // 每段自己的实际波动（年化，小数）：用来挑"最动荡/最平静的几段"
  from: number; // 数据第一天（unix秒）
  to: number; // 数据最后一天
  tradingDays: number; // 一共多少个交易日的数据
}

export const MIN_HIST_PATHS = 30;

export function buildHistPaths(series: { closes: number[]; timestamps: number[] }, days: number): HistPaths | null {
  const { closes, timestamps } = series;
  const n = Math.min(closes.length, timestamps.length);
  if (n < 10 || !(days >= 1)) return null;
  const D = Math.round(days);
  const last = timestamps[n - 1];
  // 起点：结束日（起点 + D个日历日）不能超过最后一天
  const startIdx: number[] = [];
  for (let i = 0; i < n - 1; i++) if (timestamps[i] + D * 86400 <= last + 43200 && closes[i] > 0) startIdx.push(i);
  const count = startIdx.length;
  if (count === 0) return null;
  const w = D + 1;
  const ratios = new Float32Array(count * w);
  const vols: number[] = [];
  startIdx.forEach((i, k) => {
    const c0 = closes[i];
    let j = i;
    let sum = 0, sq = 0, m = 0;
    for (let d = 0; d <= D; d++) {
      const target = timestamps[i] + d * 86400 + 43200; // 半天余量：盘中时间戳不在零点
      while (j + 1 < n && timestamps[j + 1] <= target) {
        j++;
        const r = Math.log(closes[j] / closes[j - 1]);
        sum += r;
        sq += r * r;
        m++;
      }
      ratios[k * w + d] = closes[j] / c0;
    }
    const mean = m ? sum / m : 0;
    vols.push(m > 1 ? Math.sqrt(Math.max(0, sq / m - mean * mean) * 252) : 0);
  });
  return { ratios, days: D, count, starts: startIdx.map((i) => timestamps[i]), vols, from: timestamps[0], to: last, tradingDays: n };
}

// 第day天股价比现在涨到（target>1）/跌到（target<1）target倍以外的段数占比——历史走法下"这个情景有多常见"。
export function histProbBeyond(h: HistPaths, day: number, target: number): number {
  const d = Math.max(0, Math.min(h.days, Math.round(day)));
  const w = h.days + 1;
  let c = 0;
  for (let k = 0; k < h.count; k++) {
    const r = h.ratios[k * w + d];
    if (target >= 1 ? r >= target : r <= target) c++;
  }
  return h.count ? c / h.count : 0;
}
