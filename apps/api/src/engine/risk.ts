import type { Direction, RiskLevels } from '@goldscope/shared';
import { roundTo, roundToTick } from '../utils/precision.js';

export interface RiskOptions {
  direction: Direction;
  /** observed confirmation close (used as entry when entryType = confirmation_close) */
  confirmationClose: number;
  /** next bar open (used when entryType = next_bar_open and available) */
  nextBarOpen: number | null;
  entryType: 'confirmation_close' | 'next_bar_open';
  /** swing extreme of the retest structure (low for BUY, high for SELL) */
  swingExtreme: number | null;
  atr: number | null;
  atrPeriod: number;
  atrFallbackEnabled: boolean;
  stopBufferTicks: number;
  stopBufferAtrFraction: number;
  maxStopAtr: number;
  minStopTicks: number;
  rrTarget1: number;
  rrTarget2: number;
  minRiskReward: number;
  tickSize: number;
  pricePrecision: number;
}

export type RiskResult =
  | { ok: true; levels: RiskLevels }
  | { ok: false; reason: string };

/**
 * Deterministic entry / stop-loss / take-profit engine.
 *
 * Entry  : confirmation close, or next bar open when `entryType = next_bar_open`
 *          and the next bar is available (otherwise the confirmation close is
 *          used and the fallback is reported in `notes`).
 * Stop  : retest swing extreme +/- buffer (ticks, or ATR fraction when the ATR
 *          fallback is explicitly enabled).
 * TP1/TP2: entry +/- risk * RR multiple.
 */
export function computeRiskLevels(opts: RiskOptions): RiskResult {
  const dir = opts.direction;
  const notes: string[] = [];

  let entry = opts.confirmationClose;
  if (opts.entryType === 'next_bar_open' && opts.nextBarOpen !== null) {
    entry = opts.nextBarOpen;
  } else if (opts.entryType === 'next_bar_open') {
    notes.push('Next-bar open was not available; the confirmation close was used as the assumed entry.');
  }
  entry = roundToTick(entry, opts.tickSize, opts.pricePrecision);
  const observedPrice = roundToTick(opts.confirmationClose, opts.tickSize, opts.pricePrecision);

  if (!Number.isFinite(entry) || entry <= 0) {
    return { ok: false, reason: 'Invalid entry price.' };
  }

  const minStopDistance = Math.max(0, opts.minStopTicks);
  let stop: number | null = null;
  let stopBasis = '';

  if (opts.swingExtreme !== null && Number.isFinite(opts.swingExtreme)) {
    const bufferTicks = Math.max(0, opts.stopBufferTicks);
    const atrBuffer = opts.atr && opts.stopBufferAtrFraction > 0
      ? opts.atr * opts.stopBufferAtrFraction
      : 0;
    const buffer = Math.max(bufferTicks, opts.atrFallbackEnabled ? atrBuffer : 0);
    stop = dir === 'BUY'
      ? opts.swingExtreme - buffer
      : opts.swingExtreme + buffer;
    stopBasis = `retest swing ${dir === 'BUY' ? 'low' : 'high'} ${opts.swingExtreme} ± buffer ${buffer.toFixed(2)}`;
  } else if (opts.atrFallbackEnabled && opts.atr) {
    const mult = 1.5;
    stop = dir === 'BUY' ? entry - opts.atr * mult : entry + opts.atr * mult;
    stopBasis = `ATR fallback (${mult} x ATR ${opts.atr.toFixed(2)})`;
    notes.push('ATR-based stop fallback was used because no confirmed retest swing was available.');
  } else {
    return {
      ok: false,
      reason:
        'No confirmed retest swing is available and the ATR stop fallback is disabled.',
    };
  }

  stop = roundToTick(stop, opts.tickSize, opts.pricePrecision);

  // Direction validation
  if (dir === 'BUY' && stop >= entry) {
    return { ok: false, reason: 'Invalid stop loss: BUY stop loss must be BELOW the entry price.' };
  }
  if (dir === 'SELL' && stop <= entry) {
    return { ok: false, reason: 'Invalid stop loss: SELL stop loss must be ABOVE the entry price.' };
  }

  let risk = Math.abs(entry - stop);

  // Minimum stop distance (too tight stops are rejected by widening to the minimum)
  if (risk < minStopDistance) {
    const widened = dir === 'BUY' ? entry - minStopDistance : entry + minStopDistance;
    stop = roundToTick(widened, opts.tickSize, opts.pricePrecision);
    notes.push(
      `Stop widened to the configured minimum distance of ${minStopDistance.toFixed(2)} because the swing-based stop was too tight.`,
    );
    risk = Math.abs(entry - stop);
  }

  // Maximum stop width in ATR terms
  const atr = opts.atr;
  const stopDistanceInAtr = atr && atr > 0 ? risk / atr : null;
  if (stopDistanceInAtr !== null && opts.maxStopAtr > 0 && stopDistanceInAtr > opts.maxStopAtr) {
    return {
      ok: false,
      reason: `Stop loss rejected: distance is ${stopDistanceInAtr.toFixed(2)} x ATR which exceeds the configured maximum of ${opts.maxStopAtr} x ATR.`,
    };
  }

  const tp1Raw = dir === 'BUY' ? entry + risk * opts.rrTarget1 : entry - risk * opts.rrTarget1;
  const tp2Raw = dir === 'BUY' ? entry + risk * opts.rrTarget2 : entry - risk * opts.rrTarget2;
  const tp1 = roundToTick(tp1Raw, opts.tickSize, opts.pricePrecision);
  const tp2 = roundToTick(tp2Raw, opts.tickSize, opts.pricePrecision);

  if (dir === 'BUY' && (tp1 <= entry || tp2 <= entry)) {
    return { ok: false, reason: 'Invalid take profit: BUY targets must be ABOVE the entry price.' };
  }
  if (dir === 'SELL' && (tp1 >= entry || tp2 <= entry)) {
    return { ok: false, reason: 'Invalid take profit: SELL targets must be BELOW the entry price.' };
  }

  const reward1 = Math.abs(tp1 - entry);
  const reward2 = Math.abs(tp2 - entry);
  const rr1 = roundTo(risk > 0 ? reward1 / risk : 0, 4);
  const rr2 = roundTo(risk > 0 ? reward2 / risk : 0, 4);

  if (opts.minRiskReward > 0 && rr1 < opts.minRiskReward) {
    return {
      ok: false,
      reason: `Risk/reward rejected: TP1 risk/reward of ${rr1} is below the configured minimum of ${opts.minRiskReward}.`,
    };
  }

  return {
    ok: true,
    levels: {
      entry,
      entryType: opts.entryType,
      observedPrice,
      stopLoss: stop,
      stopLossBasis: stopBasis,
      tp1,
      tp2,
      risk: roundTo(risk, opts.pricePrecision),
      reward1: roundTo(reward1, opts.pricePrecision),
      reward2: roundTo(reward2, opts.pricePrecision),
      riskReward1: rr1,
      riskReward2: rr2,
      atr: atr ?? 0,
      atrPeriod: opts.atrPeriod,
      stopDistanceInAtr: stopDistanceInAtr === null ? 0 : roundTo(stopDistanceInAtr, 3),
    },
  };
}
