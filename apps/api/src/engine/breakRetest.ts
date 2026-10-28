import type {
  BreakoutEvidence,
  Candle,
  ConditionCheck,
  Direction,
  VolumeProfileResult,
} from '@goldscope/shared';

export interface BreakRetestOptions {
  retestWindowCandles: number;
  retestZoneTicks: number;
  retestZoneAtrFraction: number;
  atr: number | null;
}

export interface BreakRetestCandidate {
  found: boolean;
  direction: Direction | null;
  breakoutIndex: number | null;
  retestIndex: number | null;
  confirmationIndex: number | null;
  evidence: BreakoutEvidence;
  swingExtreme: number | null;
  conditions: ConditionCheck[];
  failureReason: string | null;
}

const NONE_EVIDENCE: BreakoutEvidence = {
  breakoutCandleTime: '',
  breakoutClose: NaN,
  retestCandleTime: null,
  retestLow: null,
  retestHigh: null,
  confirmationCandleTime: null,
  confirmationClose: null,
  candlesBetween: null,
};

/**
 * Break & Retest detection.
 *
 * BUY  : close > VAH  -> retest candle trades back into the retest zone ->
 *        next candle closes back above VAH.
 * SELL : close < VAL  -> retest candle trades back into the retest zone ->
 *        next candle closes back below VAL.
 *
 * The breakout candle, the retest candle and the confirmation candle are always
 * three DISTINCT candles (no same-candle breakout+retest, no repainting).
 */
export function detectBreakRetest(
  candles: Candle[],
  profile: VolumeProfileResult,
  opts: BreakRetestOptions,
): BreakRetestCandidate {
  const conditions: ConditionCheck[] = [];
  const vah = profile.vah?.binHigh ?? null;
  const val = profile.val?.binLow ?? null;
  const boundary = profile.bins.length > 0 ? profile.bins : [];

  if (!profile.available || vah === null || val === null) {
    return {
      found: false,
      direction: null,
      breakoutIndex: null,
      retestIndex: null,
      confirmationIndex: null,
      evidence: NONE_EVIDENCE,
      swingExtreme: null,
      conditions: [
        {
          key: 'profile_available',
          label: 'Volume Profile متاح (VAH/VAL محسوبة)',
          passed: false,
          detail: profile.reason ?? 'Profile levels are not available.',
        },
      ],
      failureReason: profile.reason ?? 'Volume Profile unavailable.',
    };
  }

  const profileEnd = new Date(profile.rangeEnd).getTime();
  const after = candles
    .map((c, i) => ({ candle: c, i }))
    .filter(({ candle }) => new Date(candle.time).getTime() > profileEnd)
    .map(({ candle, i }) => ({ candle, i }));

  if (after.length < 3) {
    return {
      found: false,
      direction: null,
      breakoutIndex: null,
      retestIndex: null,
      confirmationIndex: null,
      evidence: NONE_EVIDENCE,
      swingExtreme: null,
      conditions: [
        {
          key: 'post_profile_candles',
          label: 'شموع كافية بعد نهاية نطاق الـ Volume Profile',
          passed: false,
          detail: `Only ${after.length} candle(s) after the profile range; at least 3 are required.`,
        },
      ],
      failureReason:
        'Not enough candles after the profile range to evaluate a break & retest.',
    };
  }

  const zoneTicks = Math.max(0, opts.retestZoneTicks);
  const atrFrac = opts.retestZoneAtrFraction ?? 0;
  const atrTol = opts.atr && atrFrac > 0 ? opts.atr * atrFrac : 0;
  const zoneWidth = Math.max(zoneTicks, atrTol);

  let best: {
    direction: Direction;
    breakoutIdx: number;
    retestIdx: number;
    confirmIdx: number;
    evidence: BreakoutEvidence;
    swing: number;
  } | null = null;

  let sawBreakout = false;
  let sawRetest = false;
  let sawConfirmation = false;

  for (let a = 0; a < after.length - 2; a += 1) {
    const b = after[a];
    const isBuy = b.candle.close > vah;
    const isSell = b.candle.close < val;
    if (!isBuy && !isSell) continue;
    sawBreakout = true;
    const direction: Direction = isBuy ? 'BUY' : 'SELL';

    // retest zone: for BUY the band just above VAH, for SELL the band just below VAL
    const zoneLow = isBuy ? vah - zoneWidth : val - zoneWidth;
    const zoneHigh = isBuy ? vah + zoneTicks : val + zoneTicks;

    for (let r = a + 1; r <= Math.min(a + opts.retestWindowCandles, after.length - 2); r += 1) {
      const retest = after[r];
      const touched = retest.candle.low <= zoneHigh && retest.candle.high >= zoneLow;
      if (!touched) continue;
      sawRetest = true;

      const confirm = after[r + 1];
      const confirmed = isBuy ? confirm.candle.close > vah : confirm.candle.close < val;
      if (!confirmed) continue;
      sawConfirmation = true;

      const window = candles.slice(b.i, retest.i + 1);
      const swing = isBuy
        ? Math.min(...window.map((c) => c.low))
        : Math.max(...window.map((c) => c.high));

      const candidate = {
        direction,
        breakoutIdx: b.i,
        retestIdx: retest.i,
        confirmIdx: confirm.i,
        swing,
        evidence: {
          breakoutCandleTime: b.candle.time,
          breakoutClose: b.candle.close,
          retestCandleTime: retest.candle.time,
          retestLow: retest.candle.low,
          retestHigh: retest.candle.high,
          confirmationCandleTime: confirm.candle.time,
          confirmationClose: confirm.candle.close,
          candlesBetween: r - a,
        } as BreakoutEvidence,
      };
      if (!best || candidate.confirmIdx > best.confirmIdx) best = candidate;
      break; // take the first valid retest for this breakout candle
    }
  }

  if (!best) {
    conditions.push({
      key: 'breakout',
      label: 'اختراق مؤكَّد (إغلاق فوق VAH / تحت VAL)',
      passed: sawBreakout,
      detail: sawBreakout
        ? 'A breakout candle was found but no valid retest + confirmation completed.'
        : 'No candle closed beyond VAH/VAL after the profile range.',
    });
    conditions.push({
      key: 'retest',
      label: 'اختبار إعادة (Retest) داخل النطاق المحدد',
      passed: sawRetest,
      detail: sawRetest
        ? 'Retest touched the zone but no candle closed back beyond the boundary.'
        : 'Price never returned into the retest zone within the allowed window.',
    });
    conditions.push({
      key: 'confirmation',
      label: 'إغلاق تأكيد خارج VAH / VAL',
      passed: false,
      detail: 'No confirmation close.',
    });
    return {
      found: false,
      direction: null,
      breakoutIndex: null,
      retestIndex: null,
      confirmationIndex: null,
      evidence: NONE_EVIDENCE,
      swingExtreme: null,
      conditions,
      failureReason: sawBreakout
        ? 'Breakout happened but the retest/confirmation sequence did not complete.'
        : 'No valid breakout after the profile range.',
    };
  }

  const dir = best.direction;
  conditions.push({
    key: 'profile_available',
    label: 'Volume Profile متاح (VAH/VAL محسوبة)',
    passed: true,
    detail: `VAH=${vah.toFixed(2)} / VAL=${val.toFixed(2)} / POC=${profile.poc?.price.toFixed(2) ?? '—'}`,
  });
  conditions.push({
    key: 'breakout',
    label: dir === 'BUY' ? 'إغلاق شمعة فوق VAH' : 'إغلاق شمعة تحت VAL',
    passed: true,
    detail: `Breakout close ${best.evidence.breakoutClose}`,
  });
  conditions.push({
    key: 'retest',
    label: 'اختبار إعادة إلى منطقة VAH/VAL',
    passed: true,
    detail: `Retest after ${best.evidence.candlesBetween} candle(s), low=${best.evidence.retestLow}, high=${best.evidence.retestHigh}`,
  });
  conditions.push({
    key: 'confirmation',
    label: dir === 'BUY' ? 'إغلاق تأكيد فوق VAH' : 'إغلاق تأكيد تحت VAL',
    passed: true,
    detail: `Confirmation close ${best.evidence.confirmationClose}`,
  });
  conditions.push({
    key: 'distinct_candles',
    label: 'شموع مختلفة للاختراق/الاختبار/التأكيد (لا إعادة رسم)',
    passed: true,
    detail: 'Breakout, retest and confirmation use three distinct candles.',
  });

  return {
    found: true,
    direction: dir,
    breakoutIndex: best.breakoutIdx,
    retestIndex: best.retestIdx,
    confirmationIndex: best.confirmIdx,
    evidence: best.evidence,
    swingExtreme: best.swing,
    conditions,
    failureReason: null,
  };
}
