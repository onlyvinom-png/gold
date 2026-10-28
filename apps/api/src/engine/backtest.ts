import type { BacktestSummary, Candle } from '@goldscope/shared';
import { calculateAtr } from './atr.js';
import { computeRiskLevels } from './risk.js';
import { computeVolumeProfile } from './volumeProfile.js';
import { detectBreakRetest } from './breakRetest.js';

export interface BacktestConfig {
  symbol: string;
  timeframe: string;
  timezone: string;
  sessionStart: string;
  sessionEnd: string;
  profileLookbackDays: number;
  valueAreaPercent: number;
  binSize: number | null;
  retestWindowCandles: number;
  retestZoneTicks: number;
  retestZoneAtrFraction: number;
  atrPeriod: number;
  atrFallbackEnabled: boolean;
  stopBufferTicks: number;
  stopBufferAtrFraction: number;
  maxStopAtr: number;
  minStopTicks: number;
  rrTarget1: number;
  rrTarget2: number;
  minRiskReward: number;
  entryType: 'confirmation_close' | 'next_bar_open';
  pricePrecision: number;
  tickSize: number;
  /** spread cost applied per trade, in price units */
  spread: number;
  /** slippage applied per trade, in price units */
  slippage: number;
  /** commission per trade, in account currency units */
  fee: number;
  /** how many candles a trade may stay open before it is closed as unresolved */
  maxHoldingCandles: number;
}

export interface BacktestTrade {
  direction: 'BUY' | 'SELL';
  entryTime: string;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  outcome: 'TARGET_HIT' | 'STOP_HIT' | 'UNRESOLVED';
  exitTime: string | null;
  exitPrice: number | null;
  realizedR: number;
  fees: number;
  profileRangeStart: string;
  profileRangeEnd: string;
  vah: number;
  val: number;
  poc: number | null;
}

export interface BacktestResult {
  summary: BacktestSummary;
  trades: BacktestTrade[];
}

/**
 * Walk-forward backtest.
 *
 * LOOK-AHEAD SAFETY: for every evaluation point the engine only ever sees the
 * candles up to and including the confirmation candle. The profile is computed
 * from candles that are strictly older than the profile range end, and trade
 * outcomes are resolved with candles that come strictly AFTER the entry.
 *
 * INTRABAR AMBIGUITY: when a single candle touches both the stop and a target,
 * the STOP is assumed to be hit first (the conservative assumption).
 */
export function runBacktest(candles: Candle[], config: BacktestConfig): BacktestResult {
  const notes: string[] = [];
  const trades: BacktestTrade[] = [];
  let totalFees = 0;

  if (candles.length < 60) {
    return {
      summary: {
        label: 'backtest',
        symbol: config.symbol,
        timeframe: config.timeframe,
        from: candles[0]?.time ?? new Date(0).toISOString(),
        to: candles[candles.length - 1]?.time ?? new Date(0).toISOString(),
        sampleSize: candles.length,
        trades: 0,
        wins: 0,
        losses: 0,
        unresolved: 0,
        winRate: null,
        averageR: null,
        expectancy: null,
        maxDrawdownR: null,
        totalFees: 0,
        spreadAssumption: config.spread,
        slippageAssumption: config.slippage,
        inSample: false,
        generatedAt: new Date().toISOString(),
        notes: ['Not enough candles to run a meaningful backtest.'],
      },
      trades: [],
    };
  }

  const warmup = Math.max(config.atrPeriod * 3, 40);
  let lastSignalIndex = -1;

  for (let i = warmup; i < candles.length - 2; i += 1) {
    const slice = candles.slice(0, i + 1);
    const now = new Date(candles[i].time);
    const atr = calculateAtr(slice, config.atrPeriod);
    const profile = computeVolumeProfile(slice, {
      timezone: config.timezone,
      sessionStart: config.sessionStart,
      sessionEnd: config.sessionEnd,
      lookbackDays: config.profileLookbackDays,
      valueAreaPercent: config.valueAreaPercent,
      binSize: config.binSize,
      tickSize: config.tickSize,
      pricePrecision: config.pricePrecision,
      now,
    });
    if (!profile.available) continue;

    const br = detectBreakRetest(slice, profile, {
      retestWindowCandles: config.retestWindowCandles,
      retestZoneTicks: config.retestZoneTicks,
      retestZoneAtrFraction: config.retestZoneAtrFraction,
      atr,
    });
    if (!br.found || !br.direction || br.confirmationIndex === null) continue;
    if (br.confirmationIndex !== i) continue; // only act on the newest confirmation
    if (lastSignalIndex >= 0 && i - lastSignalIndex < config.maxHoldingCandles) continue;

    const nextCandle = candles[i + 1] ?? null;
    const risk = computeRiskLevels({
      direction: br.direction,
      confirmationClose: br.evidence.confirmationClose as number,
      nextBarOpen: nextCandle ? nextCandle.open : null,
      entryType: config.entryType,
      swingExtreme: br.swingExtreme,
      atr,
      atrPeriod: config.atrPeriod,
      atrFallbackEnabled: config.atrFallbackEnabled,
      stopBufferTicks: config.stopBufferTicks,
      stopBufferAtrFraction: config.stopBufferAtrFraction,
      maxStopAtr: config.maxStopAtr,
      minStopTicks: config.minStopTicks,
      rrTarget1: config.rrTarget1,
      rrTarget2: config.rrTarget2,
      minRiskReward: config.minRiskReward,
      tickSize: config.tickSize,
      pricePrecision: config.pricePrecision,
    });
    if (!risk.ok) continue;

    const levels = risk.levels;
    const entryIndex = config.entryType === 'next_bar_open' && nextCandle ? i + 1 : i;
    const entryCandle = candles[entryIndex];
    const dir = br.direction;

    // Apply spread + slippage to the entry (worse price for the trader).
    const entry =
      dir === 'BUY'
        ? levels.entry + config.spread / 2 + config.slippage
        : levels.entry - config.spread / 2 - config.slippage;
    const stop = dir === 'BUY' ? levels.stopLoss - config.spread / 2 : levels.stopLoss + config.spread / 2;
    const tp1 = dir === 'BUY' ? levels.tp1 - config.spread / 2 : levels.tp1 + config.spread / 2;
    const tp2 = dir === 'BUY' ? levels.tp2 - config.spread / 2 : levels.tp2 + config.spread / 2;
    const risk = Math.abs(entry - stop);
    if (risk <= 0) continue;

    let outcome: BacktestTrade['outcome'] = 'UNRESOLVED';
    let exitTime: string | null = null;
    let exitPrice: number | null = null;
    const maxIndex = Math.min(candles.length - 1, entryIndex + config.maxHoldingCandles);
    for (let j = entryIndex + 1; j <= maxIndex; j += 1) {
      const c = candles[j];
      const hitStop = dir === 'BUY' ? c.low <= stop : c.high >= stop;
      const hitTp2 = dir === 'BUY' ? c.high >= tp2 : c.low <= tp2;
      const hitTp1 = dir === 'BUY' ? c.high >= tp1 : c.low <= tp1;
      if (hitStop) {
        outcome = 'STOP_HIT';
        exitTime = c.time;
        exitPrice = stop;
        break;
      }
      if (hitTp2) {
        outcome = 'TARGET_HIT';
        exitTime = c.time;
        exitPrice = tp2;
        break;
      }
      if (hitTp1) {
        // TP1 hit: close half at TP1 and let the rest run to TP2 or the stop.
        const half = risk > 0 ? (Math.abs(tp1 - entry) / risk) * 0.5 : 0;
        let r = half;
        let resolved = false;
        for (let k = j + 1; k <= maxIndex; k += 1) {
          const d = candles[k];
          const stopHit = dir === 'BUY' ? d.low <= stop : d.high >= stop;
          const tp2Hit = dir === 'BUY' ? d.high >= tp2 : d.low <= tp2;
          if (stopHit) {
            r += (dir === 'BUY' ? -1 : 1) * 0.5;
            exitTime = d.time;
            exitPrice = stop;
            resolved = true;
            break;
          }
          if (tp2Hit) {
            r += 0.5 * (Math.abs(tp2 - entry) / risk);
            exitTime = d.time;
            exitPrice = tp2;
            resolved = true;
            break;
          }
        }
        outcome = 'TARGET_HIT';
        exitTime = exitTime ?? c.time;
        exitPrice = exitPrice ?? tp1;
        if (!resolved) {
          const last = candles[maxIndex];
          const unreal = dir === 'BUY' ? (last.close - entry) / risk : (entry - last.close) / risk;
          r += unreal * 0.5;
        }
        trades.push({
          direction: dir,
          entryTime: entryCandle.time,
          entry: Number(entry.toFixed(config.pricePrecision)),
          stopLoss: Number(stop.toFixed(config.pricePrecision)),
          tp1: Number(tp1.toFixed(config.pricePrecision)),
          tp2: Number(tp2.toFixed(config.pricePrecision)),
          outcome,
          exitTime,
          exitPrice: exitPrice === null ? null : Number(exitPrice.toFixed(config.pricePrecision)),
          realizedR: Number(r.toFixed(4)),
          fees: config.fee,
          profileRangeStart: profile.rangeStart,
          profileRangeEnd: profile.rangeEnd,
          vah: profile.vah?.binHigh ?? 0,
          val: profile.val?.binLow ?? 0,
          poc: profile.poc?.price ?? null,
        });
        totalFees += config.fee;
        lastSignalIndex = i;
        goto nextEvaluation;
      }
    }
    if (outcome === 'UNRESOLVED') {
      const last = candles[maxIndex];
      const unreal = dir === 'BUY' ? (last.close - entry) / risk : (entry - last.close) / risk;
      trades.push({
        direction: dir,
        entryTime: entryCandle.time,
        entry: Number(entry.toFixed(config.pricePrecision)),
        stopLoss: Number(stop.toFixed(config.pricePrecision)),
        tp1: Number(tp1.toFixed(config.pricePrecision)),
        tp2: Number(tp2.toFixed(config.pricePrecision)),
        outcome,
        exitTime: candles[maxIndex].time,
        exitPrice: null,
        realizedR: Number(unreal.toFixed(4)),
        fees: config.fee,
        profileRangeStart: profile.rangeStart,
        profileRangeEnd: profile.rangeEnd,
        vah: profile.vah?.binHigh ?? 0,
        val: profile.val?.binLow ?? 0,
        poc: profile.poc?.price ?? null,
      });
      totalFees += config.fee;
      lastSignalIndex = i;
    }
    nextEvaluation: {
      // label used with goto
    }
  }

  const wins = trades.filter((t) => t.outcome === 'TARGET_HIT').length;
  const losses = trades.filter((t) => t.outcome === 'STOP_HIT').length;
  const unresolved = trades.filter((t) => t.outcome === 'UNRESOLVED').length;
  const resolved = wins + losses;
  const winRate = resolved > 0 ? Number(((wins / resolved) * 100).toFixed(2)) : null;
  const avgR = trades.length ? Number((trades.reduce((s, t) => s + t.realizedR, 0) / trades.length).toFixed(4)) : null;

  // Expectancy in R (resolved trades only).
  let expectancy: number | null = null;
  if (resolved > 0) {
    const sum = trades.reduce((s, t) => s + t.realizedR, 0);
    expectancy = Number((sum / resolved).toFixed(4));
  }

  // Maximum drawdown in R over the chronological equity (R) curve.
  let maxDrawdownR: number | null = null;
  if (trades.length) {
    let equity = 0;
    let peak = 0;
    let maxDd = 0;
    for (const t of trades) {
      equity += t.realizedR;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDd) maxDd = dd;
    }
    maxDrawdownR = Number(maxDd.toFixed(4));
  }

  notes.push(
    `Spread ${config.spread} and slippage ${config.slippage} (price units) and fee ${config.fee} applied per trade.`,
  );
  notes.push('When a candle touches both the stop and a target, the STOP is assumed to be hit first (conservative).');
  notes.push('Profile and indicators are computed only from candles available before the confirmation candle (no look-ahead).');
  if (trades.length < 30) {
    notes.push(`Sample size is small (${trades.length} trades) — treat the statistics as indicative only.`);
  }

  const summary: BacktestSummary = {
    label: 'backtest',
    symbol: config.symbol,
    timeframe: config.timeframe,
    from: candles[0].time,
    to: candles[candles.length - 1].time,
    sampleSize: candles.length,
    trades: trades.length,
    wins,
    losses,
    unresolved,
    winRate,
    averageR: avgR,
    expectancy,
    maxDrawdownR,
    totalFees: Number(totalFees.toFixed(6)),
    spreadAssumption: config.spread,
    slippageAssumption: config.slippage,
    inSample: false,
    generatedAt: new Date().toISOString(),
    notes,
  };

  return { summary, trades };
}

/** Split a result into an in-sample and an out-of-sample half (chronological). */
export function splitInOutOfSample(result: BacktestResult): {
  inSample: BacktestResult;
  outOfSample: BacktestResult;
} {
  const half = Math.floor(result.trades.length / 2);
  const inTrades = result.trades.slice(0, half);
  const outTrades = result.trades.slice(half);
  const build = (trades: BacktestTrade[], inSample: boolean): BacktestResult => {
    const wins = trades.filter((t) => t.outcome === 'TARGET_HIT').length;
    const losses = trades.filter((t) => t.outcome === 'STOP_HIT').length;
    const unresolved = trades.filter((t) => t.outcome === 'UNRESOLVED').length;
    const resolved = wins + losses;
    const summary: BacktestSummary = {
      ...result.summary,
      trades: trades.length,
      wins,
      losses,
      unresolved,
      winRate: resolved > 0 ? Number(((wins / resolved) * 100).toFixed(2)) : null,
      averageR: trades.length
        ? Number((trades.reduce((s, t) => s + t.realizedR, 0) / trades.length).toFixed(4))
        : null,
      expectancy: resolved > 0
        ? Number((trades.reduce((s, t) => s + t.realizedR, 0) / resolved).toFixed(4))
        : null,
      inSample,
      notes: [
        ...result.summary.notes,
        inSample
          ? 'IN-SAMPLE segment (first half of the trade sequence).'
          : 'OUT-OF-SAMPLE segment (second half of the trade sequence).',
      ],
    };
    return { summary, trades };
  };
  return { inSample: build(inTrades, true), outOfSample: build(outTrades, false) };
}
