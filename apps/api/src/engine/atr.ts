import type { Candle } from '@goldscope/shared';

/**
 * Average True Range using Wilder's smoothing.
 * TR = max(high-low, |high-prevClose|, |low-prevClose|)
 * ATR = Wilder EMA of TR over `period` (seeded with the simple mean of the first `period` TRs).
 */
export function calculateAtr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trs.push(tr);
  }
  if (trs.length < period) return null;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += trs[i];
  let atr = sum / period;
  for (let i = period; i < trs.length; i += 1) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return Number.isFinite(atr) && atr > 0 ? atr : null;
}
