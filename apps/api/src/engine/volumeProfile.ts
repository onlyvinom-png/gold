import type { Candle, VolumeProfileLevel, VolumeProfileResult } from '@goldscope/shared';
import { getLocalParts, parseHhMm, zonedTimeToUtc } from '../utils/time.js';
import { roundTo, roundToTick } from '../utils/precision.js';

export interface VolumeProfileOptions {
  timezone: string;
  sessionStart: string;
  sessionEnd: string;
  lookbackDays: number;
  valueAreaPercent: number;
  binSize: number | null;
  tickSize: number;
  pricePrecision: number;
  now?: Date;
  volumeSemantics?: string;
}

interface SessionWindow {
  start: Date;
  end: Date;
}

function localDateAtOffset(base: Date, timezone: string, daysBack: number): { y: number; m: number; d: number } {
  const p = getLocalParts(base, timezone);
  const anchor = new Date(Date.UTC(p.year, p.month - 1, p.day));
  anchor.setUTCDate(anchor.getUTCDate() - daysBack);
  return { y: anchor.getUTCFullYear(), m: anchor.getUTCMonth() + 1, d: anchor.getUTCDate() };
}

/** Build the session window for a local calendar date. */
export function sessionWindow(
  date: { y: number; m: number; d: number },
  sessionStart: string,
  sessionEnd: string,
  timezone: string,
): SessionWindow {
  const startMin = parseHhMm(sessionStart);
  let endMin = parseHhMm(sessionEnd);
  if (endMin <= startMin) endMin = 24 * 60; // session crosses midnight
  const start = zonedTimeToUtc(date.y, date.m, date.d, startMin, timezone);
  const endDate = endMin >= 24 * 60
    ? { y: date.y, m: date.m, d: date.d + 1 }
    : date;
  const end = zonedTimeToUtc(endDate.y, endDate.m, endDate.d, endMin % (24 * 60), timezone);
  return { start, end };
}

/**
 * Find the most recent COMPLETED sessions (session end <= now) that contain candles.
 * Documented behaviour: the profile always uses finished sessions only, so a
 * partially formed session can never repaint a previously published profile.
 */
export function findProfileWindows(
  candles: Candle[],
  opts: VolumeProfileOptions,
): { windows: SessionWindow[]; usedCandleCount: number } {
  const now = opts.now ?? new Date();
  const windows: SessionWindow[] = [];
  let used = 0;
  const targetSessions = Math.max(1, opts.lookbackDays);
  // look back far enough to skip weekends/holidays (max 10 calendar days)
  for (let back = 0; back <= 10 && windows.length < targetSessions; back += 1) {
    const date = localDateAtOffset(now, opts.timezone, back);
    const win = sessionWindow(date, opts.sessionStart, opts.sessionEnd, opts.timezone);
    if (win.end.getTime() > now.getTime()) continue; // session still running
    const inSession = candles.filter(
      (c) => {
        const t = new Date(c.time).getTime();
        return t >= win.start.getTime() && t < win.end.getTime();
      },
    );
    if (inSession.length === 0) continue;
    windows.push(win);
    used += inSession.length;
  }
  return { windows, usedCandleCount: used };
}

/**
 * Volume-at-price computation.
 *
 * METHOD (documented): candle-level volume only (never trade-level/tick-by-tick).
 * A candle's reported volume is distributed UNIFORMLY across every price bin the
 * candle's [low, high] range overlaps, proportionally to the overlap width.
 * This is an approximation of the volume that traded inside each price band and
 * is explicitly NOT exact trade-level volume.
 */
export function computeVolumeProfile(
  candles: Candle[],
  opts: VolumeProfileOptions,
): VolumeProfileResult {
  const now = opts.now ?? new Date();
  const emptyBase = {
    available: false,
    rangeStart: new Date(0).toISOString(),
    rangeEnd: new Date(0).toISOString(),
    sessionStart: opts.sessionStart,
    sessionEnd: opts.sessionEnd,
    timezone: opts.timezone,
    binSize: 0,
    valueAreaPercent: opts.valueAreaPercent,
    poc: null,
    vah: null,
    val: null,
    bins: [],
    totalVolume: 0,
    candleCount: 0,
    volumeSemantics: opts.volumeSemantics ?? 'candle_volume',
    incomplete: false,
    method:
      'candle-volume distributed uniformly across overlapped price bins (approximation, not trade-level volume)',
  };

  if (candles.length === 0) {
    return { ...emptyBase, reason: 'No candles available from the market-data provider.' };
  }

  const { windows } = findProfileWindows(candles, opts);
  if (windows.length === 0) {
    return {
      ...emptyBase,
      reason:
        'No completed session with candle data was found inside the configured profile range.',
    };
  }

  const rangeStart = windows[0].start;
  const rangeEnd = windows[windows.length - 1].end;
  const inRange = candles.filter((c) => {
    const t = new Date(c.time).getTime();
    return t >= rangeStart.getTime() && t < rangeEnd.getTime();
  });
  if (inRange.length === 0) {
    return { ...emptyBase, reason: 'No candles fall inside the resolved profile range.' };
  }

  const low = Math.min(...inRange.map((c) => c.low));
  const high = Math.max(...inRange.map((c) => c.high));
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    return { ...emptyBase, reason: 'Invalid price range in the profile candles.' };
  }

  const binSize = opts.binSize && opts.binSize > 0
    ? opts.binSize
    : Math.max(opts.tickSize, roundTo((high - low) / 150, opts.pricePrecision + 1));

  const binCount = Math.max(1, Math.ceil((high - low) / binSize) + 1);
  const volumes = new Array<number>(binCount).fill(0);

  for (const candle of inRange) {
    const cLow = Math.min(candle.low, candle.high);
    const cHigh = Math.max(candle.low, candle.high);
    const volume = Number.isFinite(candle.volume) && candle.volume > 0 ? candle.volume : 0;
    if (volume <= 0) continue;
    const firstIdx = Math.floor((cLow - low) / binSize);
    const lastIdx = Math.floor((cHigh - low) / binSize);
    const startIdx = Math.max(0, Math.min(binCount - 1, firstIdx));
    const endIdx = Math.max(0, Math.min(binCount - 1, lastIdx));
    let totalOverlap = 0;
    const overlaps: number[] = [];
    for (let i = startIdx; i <= endIdx; i += 1) {
      const binLow = low + i * binSize;
      const binHigh = binLow + binSize;
      const overlap = Math.min(cHigh, binHigh) - Math.max(cLow, binLow);
      const w = overlap > 0 ? overlap : 0;
      overlaps.push(w);
      totalOverlap += w;
    }
    if (totalOverlap <= 0) {
      volumes[startIdx] += volume;
      continue;
    }
    for (let k = 0; k < overlaps.length; k += 1) {
      volumes[startIdx + k] += (overlaps[k] / totalOverlap) * volume;
    }
  }

  const bins: VolumeProfileLevel[] = volumes.map((v, i) => {
    const binLow = roundToTick(low + i * binSize, opts.tickSize, opts.pricePrecision);
    const binHigh = roundToTick(low + (i + 1) * binSize, opts.tickSize, opts.pricePrecision);
    return { price: binLow, binLow, binHigh, volume: Number(v.toFixed(8)) };
  });

  const totalVolume = bins.reduce((s, b) => s + b.volume, 0);
  if (totalVolume <= 0) {
    return {
      ...emptyBase,
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      reason: 'Volume data is zero or unavailable for the profile range.',
    };
  }

  let pocIdx = 0;
  for (let i = 1; i < bins.length; i += 1) {
    if (bins[i].volume > bins[pocIdx].volume) pocIdx = i;
  }

  // Value area expansion: grow from POC adding the richer neighbour each round.
  const target = (totalVolume * opts.valueAreaPercent) / 100;
  let lo = pocIdx;
  let hi = pocIdx;
  let acc = bins[pocIdx].volume;
  while (acc < target && (lo > 0 || hi < bins.length - 1)) {
    const below = lo > 0 ? bins[lo - 1].volume : -1;
    const above = hi < bins.length - 1 ? bins[hi + 1].volume : -1;
    if (above >= below && above >= 0) {
      hi += 1;
      acc += bins[hi].volume;
    } else if (below >= 0) {
      lo -= 1;
      acc += bins[lo].volume;
    } else break;
  }

  const poc = bins[pocIdx];
  const val = bins[lo];
  const vah = bins[hi];

  return {
    available: true,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    sessionStart: opts.sessionStart,
    sessionEnd: opts.sessionEnd,
    timezone: opts.timezone,
    binSize: Number(binSize.toFixed(6)),
    valueAreaPercent: opts.valueAreaPercent,
    poc,
    vah,
    val,
    bins,
    totalVolume: Number(totalVolume.toFixed(6)),
    candleCount: inRange.length,
    volumeSemantics: opts.volumeSemantics ?? 'candle_volume',
    incomplete: false,
    method:
      'candle-volume distributed uniformly across overlapped price bins (approximation, not trade-level volume)',
  };
}
