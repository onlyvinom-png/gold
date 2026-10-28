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
  /** spread cost per trade in price units */
  spread: number;
  /** slippage per trade in price units */
  slippage: number;
  /** commission per trade in account currency units */
  fee: number;
  /** maximum number of candles a trade may stay open */
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

interface ExitPlan {
  outcome: BacktestTrade['outcome'];
  exitTime: string | null;
  exitPrice: number | null;
  realizedR: number;
}

/**
 * Resolve a single trade against the candles that come AFTER the entry.
 *
 * LOOK-AHEAD SAFETY: the resolver only receives candles with an index strictly
 * greater than the entry index, so the outcome can never influence the entry.
 *
 * INTRABAR AMBIGUITY: when a candle touches both the stop and a target the
 * STOP is assumed to be hit first (the conservative assumption).
 */
export function resolveTrade(
  direction: 'BUY' | 'SELL',
  entry: number,
  stop: number,
  tp1: number,
  tp2: number,
  entryIndex: number,
  candles: Candle[],
  maxHoldingCandles: number,
): ExitPlan {
  const risk = Math.abs(entry - stop);
  const lastIndex = Math.min(candles.length - 1, entryIndex + maxHoldingCandles);
  if (risk <= 0) {
    return { outcome: 'UNRESOLVED', exitTime: null, exitPrice: null, realizedR: 0 };
  }

  for (let j = entryIndex + 1; j <= lastIndex; j += 1) {
    const c = candles[j];
    const hitStop = direction === 'BUY' ? c.low <= stop : c.high >= stop;
    const hitTp2 = direction === 'BUY' ? c.high >= tp2 : c.low <= tp2;
    const hitTp1 = direction === 'BUY' ? c.high >= tp1 : c.low <= tp1;

    if (hitStop) {
      return {
        outcome: 'STOP_HIT',
        exitTime: c.time,
        exitPrice: stop,
        realizedR: -1,
      };
    }
    if (hitTp2) {
      const r = Math.abs(tp2 - entry) / risk;
      return { outcome: 'TARGET_HIT', exitTime: c.time, exitPrice: tp2, realizedR: Number(r.toFixed(4)) };
    }
    if (hitTp1) {
      // Half the position is closed at TP1, the remainder runs to TP2 or the stop.
      const halfR = (Math.abs(tp1 - entry) / risk) * 0.5;
      let r = halfR;
      let exitTime: string | null = c.time;
      let exitPrice: number | null = tp1;
      let resolved = false;
      for (let k = j + 1; k <= lastIndex; k += 1) {
        const d = candles[k];
        const stopHit = direction === 'BUY' ? d.low <= stop : d.high >= stop;
        const tp2Hit = direction === 'BUY' ? d.high >= tp2 : d.low <= tp2;
        if (stopHit) {
          r += -0.5;
          exitTime = d.time;
          exitPrice = stop;
          resolved = true;
          break;
        }
        if (tp2Hit) {
          r += (Math.abs(tp2 - entry) / risk) * 0.5;
          exitTime = d.time;
          exitPrice = tp2;
          resolved = true;
          break;
        }
      }
      if (!resolved) {
        const last = candles[lastIndex];
        const unreal =
          direction === 'BUY' ? (last.close - entry) / risk : (entry - last.close) / risk;
        r += unreal * 0.5;
      }
      return {
        outcome: 'TARGET_HIT',
        exitTime,
        exitPrice,
        realizedR: Number(r.toFixed(4)),
      };
    }
  }

  const last = candles[lastIndex];
  const unreal = direction === 'BUY' ? (last.close - entry) / risk : (entry - last.close) / risk;
  return {
    outcome: 'UNRESOLVED',
    exitTime: last.time,
    exitPrice: null,
    realizedR: Number(unreal.toFixed(4)),
  };
}

function summarise(
  base: BacktestSummary,
  trades: BacktestTrade[],
  inSample: boolean,
  extraNotes: string[],
): BacktestSummary {
  const wins = trades.filter((t) => t.outcome === 'TARGET_HIT').length;
  const losses = trades.filter((t) => t.outcome === 'STOP_HIT').length;
  const unresolved = trades.filter((t) => t.outcome === 'UNRESOLVED').length;
  const resolved = wins + losses;
  const sumR = trades.reduce((s, t) => s + t.realizedR, 0);
  return {
    ...base,
    trades: trades.length,
    wins,
    losses,
    unresolved,
    winRate: resolved > 0 ? Number(((wins / resolved) * 100).toFixed(2)) : null,
    averageR: trades.length ? Number((sumR / trades.length).toFixed(4)) : null,
    expectancy: resolved > 0 ? Number((sumR / resolved).toFixed(4)) : null,
    maxDrawdownR: maxDrawdown(trades),
    totalFees: Number(trades.reduce((s, t) => s + t.fees, 0).toFixed(6)),
    inSample,
    notes: [...base.notes, ...extraNotes],
  };
}

function maxDrawdown(trades: BacktestTrade[]): number | null {
  if (!trades.length) return null;
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of trades) {
    equity += t.realizedR;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }
  return Number(maxDd.toFixed(4));
}

/**
 * Walk-forward backtest over historical candles.
 *
 * LOOK-AHEAD SAFETY: the engine only ever sees candles up to and including the
 * confirmation candle for each evaluation step. The Volume Profile is computed
 * from those candles only, and the trade outcome is resolved with strictly
 * later candles.
 */
export function runBacktest(candles: Candle[], config: BacktestConfig): BacktestResult {
  const notes: string[] = [];

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

  const trades: BacktestTrade[] = [];
  const warmup = Math.max(config.atrPeriod * 3, 40);
  let lastSignalIndex = -1;

  for (let i = warmup; i < candles.length - 2; i += 1) {
    if (lastSignalIndex >= 0 && i - lastSignalIndex < config.maxHoldingCandles) continue;

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
    if (!br.found || !br.direction || br.confirmationIndex !== i) continue;

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

    // Worsen the entry by half the spread plus slippage.
    const entry =
      dir === 'BUY'
        ? levels.entry + config.spread / 2 + config.slippage
        : levels.entry - config.spread / 2 - config.slippage;
    const stop = dir === 'BUY' ? levels.stopLoss - config.spread / 2 : levels.stopLoss + config.spread / 2;
    const tp1 = dir === 'BUY' ? levels.tp1 - config.spread / 2 : levels.tp1 + config.spread / 2;
    const tp2 = dir === 'BUY' ? levels.tp2 - config.spread / 2 : levels.tp2 + config.spread / 2;
    if (Math.abs(entry - stop) <= 0) continue;

    const plan = resolveTrade(dir, entry, stop, tp1, tp2, entryIndex, candles, config.maxHoldingCandles);

    trades.push({
      direction: dir,
      entryTime: entryCandle.time,
      entry: Number(entry.toFixed(config.pricePrecision)),
      stopLoss: Number(stop.toFixed(config.pricePrecision)),
      tp1: Number(tp1.toFixed(config.pricePrecision)),
      tp2: Number(tp2.toFixed(config.pricePrecision)),
      outcome: plan.outcome,
      exitTime: plan.exitTime,
      exitPrice: plan.exitPrice === null ? null : Number(plan.exitPrice.toFixed(config.pricePrecision)),
      realizedR: plan.realizedR,
      fees: config.fee,
      profileRangeStart: profile.rangeStart,
      profileRangeEnd: profile.rangeEnd,
      vah: profile.vah?.binHigh ?? 0,
      val: profile.val?.binLow ?? 0,
      poc: profile.poc?.price ?? null,
    });
    lastSignalIndex = i;
  }

  notes.push(
    `Spread ${config.spread} and slippage ${config.slippage} (price units) plus fee ${config.fee} applied per trade.`,
  );
  notes.push('When a candle touches both the stop and a target, the STOP is assumed to be hit first (conservative).');
  notes.push('Profile, ATR and signals use only candles available before the confirmation candle (no look-ahead).');
  if (trades.length < 30) {
    notes.push(`Sample size is small (${trades.length} trades) — treat the statistics as indicative only.`);
  }

  const base: BacktestSummary = {
    label: 'backtest',
    symbol: config.symbol,
    timeframe: config.timeframe,
    from: candles[0].time,
    to: candles[candles.length - 1].time,
    sampleSize: candles.length,
    trades: trades.length,
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
    notes,
  };

  return { summary: summarise(base, trades, false, []), trades };
}

/** Split the trade sequence chronologically into in-sample and out-of-sample halves. */
export function splitInOutOfSample(result: BacktestResult): {
  inSample: BacktestResult;
  outOfSample: BacktestResult;
} {
  const half = Math.floor(result.trades.length / 2);
  const inTrades = result.trades.slice(0, half);
  const outTrades = result.trades.slice(half);
  const build = (trades: BacktestTrade[], inSample: boolean): BacktestResult => ({
    summary: summarise(result.summary, trades, inSample, [
      inSample
        ? 'IN-SAMPLE segment (first half of the trade sequence).'
        : 'OUT-OF-SAMPLE segment (second half of the trade sequence).',
    ]),
    trades,
  });
  return { inSample: build(inTrades, true), outOfSample: build(outTrades, false) };
}
